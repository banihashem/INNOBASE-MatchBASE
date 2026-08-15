import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve, win32 } from "node:path";
import { validateDashboardClosure } from "./lib/dashboard-closure-policy.mjs";
import {
  isPathWithinRoot,
  validateSourceReferenceShape,
} from "./lib/dashboard-source-policy.mjs";

import {
  externalClosurePredecessorSourceRef,
  validateExternalClosure,
} from "./lib/external-closure-policy.mjs";
import {
  slice2ClosureSourceRef,
  slice2DashboardAuditSourceRef,
  validateSlice2ExternalClosure,
} from "./lib/slice2-external-closure-policy.mjs";
import { validateSlice2DashboardClosure } from "./lib/slice2-dashboard-closure-policy.mjs";
import {
  assertSnapshotByteParity,
  slice3EvidenceSourceRef,
  validateSlice3Dashboard,
  validateSlice3Evidence,
} from "./lib/slice3-dashboard-policy.mjs";
import { SNAPSHOT_DIST_OUTPUT_PATH } from "./lib/snapshot-path-policy.mjs";

const actual = !process.argv.includes("--bootstrap");
const snapshotPath = resolve(
  actual
    ? "apps/dashboard/public/current-snapshot.json"
    : "apps/dashboard/public/bootstrap-snapshot.json",
);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const requiredViews = [
  "portfolio",
  "gates",
  "backlog",
  "decisions",
  "risks",
  "requirements",
  "tests",
  "defects",
  "deployments",
  "costs",
  "agents",
  "loops",
  "evidence",
];
const allowedRoots = [
  "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources",
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management",
  "C:\\INNOBASE\\MatchBASE\\02_Product_Research_and_Planning",
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE",
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\governance",
  process.cwd(),
].map((value) => resolve(value));
const requireSources = actual || process.argv.includes("--require-sources");

if (snapshot.schemaVersion !== "1.0" || snapshot.mode !== "READ_ONLY") {
  throw new Error("Dashboard snapshot contract is invalid.");
}
if (
  !snapshot.views ||
  requiredViews.some(
    (view) =>
      !snapshot.views[view] || !Array.isArray(snapshot.views[view].records),
  )
) {
  throw new Error("Dashboard snapshot is missing a required view.");
}

const records = requiredViews.flatMap(
  (view) => snapshot.views[view].records ?? [],
);
let verifiedSources = 0;

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex").toUpperCase()));
  });
}

for (const record of records) {
  if (
    !record.id ||
    !record.title ||
    !record.status ||
    !Array.isArray(record.sourceRefs)
  ) {
    throw new Error(`Invalid dashboard record: ${record.id ?? "UNKNOWN"}`);
  }
  for (const source of record.sourceRefs) {
    const { lexicalRoot, normalizedPath } = validateSourceReferenceShape(
      source,
      allowedRoots,
    );
    if (requireSources) {
      if (!existsSync(normalizedPath))
        throw new Error(`Missing source: ${source.path}`);
      const sourceStat = lstatSync(normalizedPath);
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile())
        throw new Error(`Source is not a regular file: ${source.path}`);
      const realSource = realpathSync(normalizedPath);
      const realRoot = realpathSync(lexicalRoot);
      if (!isPathWithinRoot(realRoot, realSource))
        throw new Error(
          `Source resolves outside allowlisted roots: ${source.path}`,
        );
      if ((await sha256File(realSource)) !== source.sha256.toUpperCase()) {
        throw new Error(`Source hash mismatch: ${source.path}`);
      }
      verifiedSources += 1;
    }
  }
}

if (actual) {
  if (records.length === 0)
    throw new Error("Current dashboard snapshot cannot be empty.");
  for (const view of requiredViews)
    if (snapshot.views[view].records.length === 0)
      throw new Error(`Current dashboard view cannot be empty: ${view}`);
  if (!snapshot.views.gates.records.some(({ id }) => id === "AG0"))
    throw new Error("Semantic gate records are missing.");
  if (!snapshot.views.backlog.records.some(({ id }) => id === "S0-001"))
    throw new Error("Semantic backlog records are missing.");
  if (snapshot.views.decisions.records.length !== 162)
    throw new Error(
      "Decision disposition projection does not reconcile to 162.",
    );
  const anchorOnly =
    process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI";
  const closurePath = process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY
    ? resolve(process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY)
    : resolve("governance/external-closure-anchor-v1.json");
  if (
    process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY &&
    (!win32.isAbsolute(process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY) ||
      anchorOnly)
  )
    throw new Error("Dashboard closure overlay is not allowed in this mode.");
  const closure = validateExternalClosure(
    JSON.parse(readFileSync(closurePath, "utf8")),
    { anchorOnly },
  );
  const predecessorSourceRef = anchorOnly
    ? {
        sourceId:
          "matchbase://ci-snapshot/governance/predecessor-failures-v1.json",
        path: resolve("governance/predecessor-failures-v1.json"),
        sha256: closure.predecessorSource.sha256,
        observedAt: closure.observedAt,
      }
    : externalClosurePredecessorSourceRef(closure);
  validateDashboardClosure(snapshot.views, closure, {
    predecessorSourceRef,
  });
  const slice2ClosurePath = process.env
    .MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY
    ? resolve(process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY)
    : resolve("governance/slice2-external-closure-anchor-v1.json");
  if (
    process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY &&
    (!win32.isAbsolute(process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY) ||
      anchorOnly)
  )
    throw new Error(
      "Slice 2 dashboard closure overlay is not allowed in this mode.",
    );
  const slice2Closure = validateSlice2ExternalClosure(
    JSON.parse(readFileSync(slice2ClosurePath, "utf8")),
    { anchorOnly },
  );
  const slice2ClosureRef = anchorOnly
    ? {
        sourceId:
          "matchbase://ci-snapshot/governance/slice2-external-closure-anchor-v1.json",
        path: resolve("governance/slice2-external-closure-anchor-v1.json"),
        sha256: await sha256File(
          resolve("governance/slice2-external-closure-anchor-v1.json"),
        ),
        observedAt: slice2Closure.observedAt,
      }
    : slice2ClosureSourceRef(slice2Closure);
  const slice2AuditRef = slice2DashboardAuditSourceRef(slice2Closure, {
    anchorOnly,
    anchorSourceRef: slice2ClosureRef,
  });
  const slice2PredecessorRef = {
    sourceId: anchorOnly
      ? "matchbase://ci-snapshot/governance/slice2-external-closure-anchor-v1.json"
      : "matchbase://slice2-external-closure/predecessor-anchor",
    path: slice2ClosurePath,
    sha256: await sha256File(slice2ClosurePath),
    observedAt: slice2Closure.observedAt,
  };
  validateSlice2DashboardClosure(snapshot.views, slice2Closure, {
    closureSourceRef: slice2ClosureRef,
    auditSourceRef: slice2AuditRef,
    predecessorSourceRef: slice2PredecessorRef,
  });
  const slice3EvidencePath = resolve("evidence/slice3/local-validation.json");
  const slice3EvidenceBytes = readFileSync(slice3EvidencePath);
  const slice3Evidence = validateSlice3Evidence(
    JSON.parse(slice3EvidenceBytes.toString("utf8")),
  );
  const slice3SourceRef = slice3EvidenceSourceRef(
    slice3EvidencePath,
    slice3EvidenceBytes,
    slice3Evidence,
  );
  validateSlice3Dashboard(snapshot.views, slice3Evidence, slice3SourceRef);
  if (existsSync(SNAPSHOT_DIST_OUTPUT_PATH))
    assertSnapshotByteParity(
      readFileSync(snapshotPath),
      readFileSync(SNAPSHOT_DIST_OUTPUT_PATH),
    );
  if (requireSources && verifiedSources === 0)
    throw new Error("Current dashboard source verification was vacuous.");
}

if (
  /redactedExcerpt|PRIVATE KEY|\bgh[pousr]_[A-Za-z0-9_]{30,}\b/.test(
    JSON.stringify(snapshot),
  )
) {
  throw new Error("Snapshot contains source excerpts or secret-like material.");
}

console.log(
  `dashboard snapshot: PASS (${requiredViews.length} views; ${records.length} rendered records; ${verifiedSources} source references verified)`,
);
