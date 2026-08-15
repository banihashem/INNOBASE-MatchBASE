import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { buildArtifactSnapshot } from "../packages/artifact-indexer/dist/src/indexer.js";
import { replaceRegularFileTransactionally } from "./lib/replace-regular-file.mjs";
import { validateAgentRoster } from "./lib/agent-policy.mjs";
import { buildSemanticViews } from "./lib/semantic-dashboard.mjs";
import { validateSlice2HistoricalGitObject } from "./lib/dashboard-provenance-policy.mjs";
import {
  externalClosurePredecessorSourceRef,
  externalClosureRole2SourceRef,
  externalClosureSourceRef,
  validateExternalClosure,
} from "./lib/external-closure-policy.mjs";
import {
  slice2AuditSourceRef,
  slice2ClosureSourceRef,
  slice2Role2SourceRef,
  validateSlice2ExternalClosure,
} from "./lib/slice2-external-closure-policy.mjs";
import {
  SNAPSHOT_CONFIG_PATH,
  SNAPSHOT_OUTPUT_PATH,
  assertSafeSnapshotOutput,
  validateGeneratorConfig,
} from "./lib/snapshot-path-policy.mjs";

const [asOfArgument] = process.argv.slice(2);
if (process.argv.slice(2).length > 1)
  throw new Error("usage: snapshot generator [as-of]");

const config = JSON.parse(await readFile(SNAPSHOT_CONFIG_PATH, "utf8"));
validateGeneratorConfig(config);
const effectiveAsOf = asOfArgument ?? new Date().toISOString();
if (Number.isNaN(Date.parse(effectiveAsOf)))
  throw new Error("as-of override must be ISO-8601");
config.asOf = new Date(effectiveAsOf).toISOString();
const artifactSnapshot = await buildArtifactSnapshot(config);
const anchorOnly =
  process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI";
const externalClosurePath = process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY
  ? resolve(process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY)
  : resolve("governance/external-closure-anchor-v1.json");
if (
  process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY &&
  (!win32.isAbsolute(process.env.MATCHBASE_EXTERNAL_CLOSURE_OVERLAY) ||
    anchorOnly)
)
  throw new Error(
    "External closure overlay must be an absolute local management path and cannot override CI anchor mode.",
  );
const externalClosureValue = validateExternalClosure(
  JSON.parse(await readFile(externalClosurePath, "utf8")),
  { anchorOnly },
);
const externalClosureDocument = {
  value: externalClosureValue,
  sourceRef: externalClosureSourceRef(externalClosureValue),
  predecessorSourceRef:
    externalClosurePredecessorSourceRef(externalClosureValue),
};
const slice2ClosurePath = process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY
  ? resolve(process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY)
  : resolve("governance/slice2-external-closure-anchor-v1.json");
if (
  process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY &&
  (!win32.isAbsolute(process.env.MATCHBASE_SLICE2_EXTERNAL_CLOSURE_OVERLAY) ||
    anchorOnly)
)
  throw new Error(
    "Slice 2 closure overlay must be an absolute local management path and cannot override CI anchor mode.",
  );
const slice2ClosureBytes = await readFile(slice2ClosurePath);
const slice2ClosureValue = validateSlice2ExternalClosure(
  JSON.parse(slice2ClosureBytes.toString("utf8")),
  { anchorOnly },
);
const slice2ClosureDocument = {
  value: slice2ClosureValue,
  sourceRef: slice2ClosureSourceRef(slice2ClosureValue),
  auditSourceRef: slice2AuditSourceRef(slice2ClosureValue),
  predecessorSourceRef: {
    sourceId: "matchbase://slice2-external-closure/predecessor-anchor",
    path: slice2ClosurePath,
    sha256: createHash("sha256")
      .update(slice2ClosureBytes)
      .digest("hex")
      .toUpperCase(),
    observedAt: slice2ClosureValue.observedAt,
  },
};
const rootMap = new Map(
  config.roots.map((root) => [root.id, root.absolutePath]),
);
const viewNames = [
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
const labels = Object.fromEntries(
  viewNames.map((name) => [name, `${name[0].toUpperCase()}${name.slice(1)}`]),
);
function sourceRef(artifact) {
  const root = rootMap.get(artifact.sourceRootId);
  if (!root)
    throw new Error(`Missing configured root: ${artifact.sourceRootId}`);
  return {
    sourceId: artifact.sourceUri,
    path: join(root, ...artifact.relativePath.split("/")),
    ...(artifact.sha256 ? { sha256: artifact.sha256.toUpperCase() } : {}),
    observedAt: artifactSnapshot.generatedAt,
  };
}

function artifactRecord(artifact) {
  return {
    id: `ART-${artifact.id.slice(0, 16).toUpperCase()}`,
    title: artifact.relativePath,
    summary: artifact.errorCode
      ? `Indexed artifact metadata could not be read (${artifact.errorCode}).`
      : `Indexed ${artifact.extension || "untyped"} artifact; ${artifact.sizeBytes ?? "UNKNOWN"} bytes; no source content is copied.`,
    status:
      artifact.state === "CURRENT"
        ? "ACTIVE"
        : artifact.state === "STALE"
          ? "STALE"
          : artifact.state === "ERROR"
            ? "ERROR"
            : "UNKNOWN",
    owner: artifact.sourceRootId,
    facts: {
      bytes: artifact.sizeBytes,
      redactionsDetected: artifact.redactionCount,
      sourceState: artifact.state,
    },
    sourceRefs: [sourceRef(artifact)],
  };
}

async function indexedDocument(rootId, relativePath) {
  const artifact = artifactSnapshot.artifacts.find(
    (candidate) =>
      candidate.sourceRootId === rootId &&
      candidate.relativePath.toLowerCase() === relativePath.toLowerCase(),
  );
  if (!artifact?.sha256)
    throw new Error(
      `Required indexed JSON is unavailable: ${rootId}/${relativePath}`,
    );
  const root = rootMap.get(rootId);
  if (!root) throw new Error(`Missing configured root: ${rootId}`);
  return {
    value: JSON.parse(
      await readFile(join(root, ...relativePath.split("/")), "utf8"),
    ),
    sourceRef: sourceRef(artifact),
  };
}

const agentsDocument = await indexedDocument(
  "implementation-governance",
  "agents.json",
);
const artifactIndexDocument = await indexedDocument(
  "implementation-governance",
  "artifact-index.json",
);
validateSlice2HistoricalGitObject(
  artifactIndexDocument.value,
  slice2ClosureValue,
  { repoRoot: process.cwd() },
);
validateAgentRoster(agentsDocument.value, { repoRoot: process.cwd() });
const trustedAgentEvidenceRefs = agentsDocument.value.agents.flatMap((agent) =>
  [
    ...agent.deliverables.flatMap((deliverable) => deliverable.outputHashes),
    ...agent.testEvidence.flatMap((test) => test.evidenceRefs),
    ...agent.independentAudit.evidenceRefs,
  ].map((reference, index) => ({
    sourceId: `matchbase://agent-evidence/${agent.id}/${index + 1}`,
    path:
      isAbsolute(reference.path) || win32.isAbsolute(reference.path)
        ? reference.path
        : resolve(reference.path),
    sha256: reference.sha256,
    observedAt: artifactSnapshot.generatedAt,
  })),
);
trustedAgentEvidenceRefs.push(
  externalClosureDocument.sourceRef,
  externalClosureDocument.predecessorSourceRef,
  externalClosureRole2SourceRef(externalClosureValue),
);
trustedAgentEvidenceRefs.push(
  slice2ClosureDocument.sourceRef,
  slice2ClosureDocument.auditSourceRef,
  slice2ClosureDocument.predecessorSourceRef,
  slice2Role2SourceRef(slice2ClosureValue),
);

const semantic = buildSemanticViews({
  slices: await indexedDocument("implementation-governance", "slices.json"),
  gates: await indexedDocument("implementation-governance", "gates.json"),
  backlog: await indexedDocument("implementation-governance", "backlog.json"),
  registers: await indexedDocument(
    "implementation-governance",
    "registers.json",
  ),
  agents: agentsDocument,
  artifactIndex: artifactIndexDocument,
  externalState: await indexedDocument(
    "implementation-governance",
    "external-state.json",
  ),
  externalClosure: externalClosureDocument,
  slice2Closure: slice2ClosureDocument,
  dispositions: await indexedDocument(
    "product-management",
    "OWNER_DECISION_DISPOSITION_REGISTER_PO_001.json",
  ),
  artifactRecords: artifactSnapshot.artifacts.map(artifactRecord),
  trustedEvidenceRefs: trustedAgentEvidenceRefs,
  artifactRecordsByView: Object.fromEntries(
    viewNames.map((view) => {
      const ids = new Set(artifactSnapshot.views[view] ?? []);
      return [
        view,
        artifactSnapshot.artifacts
          .filter((artifact) => ids.has(artifact.id))
          .map(artifactRecord),
      ];
    }),
  ),
});

const views = Object.fromEntries(
  viewNames.map((view) => {
    const records = semantic[view].records;
    return [
      view,
      {
        label: labels[view],
        description: `${records.length} domain records parsed from governed current registers.`,
        status: semantic[view].status,
        records,
      },
    ];
  }),
);

const dashboard = {
  schemaVersion: "1.0",
  generatedAt: artifactSnapshot.generatedAt,
  mode: "READ_ONLY",
  buildRef: artifactSnapshot.snapshotId,
  notice: `Domain register projection backed by ${artifactSnapshot.summary.total} indexed source artifacts. ACTIVE means observed, not gate PASS.`,
  views,
};

await assertSafeSnapshotOutput();
await replaceRegularFileTransactionally(
  SNAPSHOT_OUTPUT_PATH,
  `${JSON.stringify(dashboard, null, 2)}\n`,
);
console.log(
  `dashboard snapshot: PASS (${artifactSnapshot.summary.total} artifacts; ${artifactSnapshot.snapshotId})`,
);
