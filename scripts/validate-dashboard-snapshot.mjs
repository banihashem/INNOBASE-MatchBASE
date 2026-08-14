import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  isPathWithinRoot,
  validateSourceReferenceShape,
} from "./lib/dashboard-source-policy.mjs";

const actual =
  process.argv.includes("--actual") ||
  process.argv.includes("--require-sources");
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
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\governance",
].map((value) => resolve(value));
const requireSources = process.argv.includes("--require-sources");

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
  if (!snapshot.views.gates.records.some(({ id }) => id === "AG0"))
    throw new Error("Semantic gate records are missing.");
  if (!snapshot.views.backlog.records.some(({ id }) => id === "S0-001"))
    throw new Error("Semantic backlog records are missing.");
  if (snapshot.views.decisions.records.length !== 162)
    throw new Error(
      "Decision disposition projection does not reconcile to 162.",
    );
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
