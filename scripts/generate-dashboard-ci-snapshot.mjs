import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  externalClosureSourceRef,
  validateExternalClosure,
} from "./lib/external-closure-policy.mjs";
import { replaceRegularFileTransactionally } from "./lib/replace-regular-file.mjs";
import {
  REPOSITORY_ROOT,
  SNAPSHOT_OUTPUT_PATH,
  assertSafeSnapshotOutput,
} from "./lib/snapshot-path-policy.mjs";

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
let observationTime = "1970-01-01T00:00:00.000Z";

async function document(relativePath) {
  const path = resolve(REPOSITORY_ROOT, relativePath);
  const bytes = await readFile(path);
  return {
    value: JSON.parse(bytes.toString("utf8")),
    sourceRef: {
      sourceId: `matchbase://ci-snapshot/${relativePath.replaceAll("\\", "/")}`,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
      observedAt: observationTime,
    },
  };
}

const closureDocument = await document(
  "governance/external-closure-anchor-v1.json",
);
const closure = validateExternalClosure(closureDocument.value, {
  anchorOnly: true,
});
observationTime = closure.observedAt;
closureDocument.sourceRef.observedAt = observationTime;
const [slices, gates, backlog, decisions, registers, agents, artifactIndex] =
  await Promise.all([
    document("governance/slices.json"),
    document("governance/gates.json"),
    document("governance/backlog.json"),
    document("governance/decisions.json"),
    document("governance/registers.json"),
    document("governance/agents.json"),
    document("governance/artifact-index.json"),
  ]);

function state(status) {
  if (["FAIL", "BLOCKED", "OPEN"].includes(status)) return "BLOCKED";
  if (["ERROR", "STALE", "UNKNOWN"].includes(status)) return status;
  return "ACTIVE";
}
function record(item, sourceRef, prefix, index = 0) {
  const id = String(item.id ?? `${prefix}-${index + 1}`);
  return {
    id,
    title: String(item.title ?? item.name ?? id),
    summary: String(
      item.summary ?? `${id} from the current governed register.`,
    ),
    status: state(item.status),
    ...(item.owner ? { owner: String(item.owner) } : {}),
    facts: Object.fromEntries(
      Object.entries(item)
        .filter(
          ([key, value]) =>
            !["id", "title", "name", "summary", "status"].includes(key) &&
            ["string", "number", "boolean"].includes(typeof value),
        )
        .map(([key, value]) => [key, value]),
    ),
    sourceRefs: [sourceRef],
  };
}
function closureRecord(id, title, sourceRef = closureDocument.sourceRef) {
  return {
    id,
    title,
    summary: `${closure.repository} commit ${closure.commit}; run ${closure.runId}; job ${closure.jobId}; hosted success; Role 2 correction re-audit pending.`,
    status: "ACTIVE",
    facts: {
      repository: closure.repository,
      commit: closure.commit,
      tree: closure.tree,
      runId: closure.runId,
      jobId: closure.jobId,
      conclusion: closure.conclusion,
      closureStatus: closure.closureStatus,
      role2Status: closure.role2Status,
    },
    sourceRefs: [sourceRef],
  };
}

const decisionRecords = [];
for (const [category, count] of [
  ["CLOSED_BY_OWNER", decisions.value.summary.closed],
  ["PARTIALLY_CLOSED", decisions.value.summary.partiallyClosed],
  ["DELEGATED_TECHNICAL", decisions.value.summary.delegatedTechnical],
  ["REMAINS_OPEN", decisions.value.summary.open],
]) {
  for (let index = 0; index < count; index += 1)
    decisionRecords.push({
      id: `CI-${category}-${String(index + 1).padStart(3, "0")}`,
      title: `${category} disposition ${index + 1}`,
      summary: `Deterministic CI projection of the governed ${category} count. Exact decision identities remain in the protected owner register referenced by governance/decisions.json.`,
      status: category === "REMAINS_OPEN" ? "ACTIVE" : "ACTIVE",
      facts: { category, ordinal: index + 1 },
      sourceRefs: [decisions.sourceRef],
    });
}
if (decisionRecords.length !== decisions.value.summary.total)
  throw new Error("CI decision projection does not reconcile to its register.");

const closureGate = closureRecord("AG6", "Hosted CI and repository parity");
const closureTest = closureRecord(
  "S1-AC-022",
  "Hosted CI and independent audit closure",
);
const closureDeployment = {
  ...closureRecord("EXT-GITHUB-CLOSURE", "GitHub hosted Slice 1 closure"),
  facts: {
    ...closureRecord("unused", "unused").facts,
    predecessorFailures: closure.predecessorFailures.length,
  },
};
const closureEvidence = closureRecord(
  "EVIDENCE-S1-EXTERNAL-CLOSURE",
  "Authenticated hosted Slice 1 closure",
);
const defectRecords = closure.role2.defects.map((defect) => ({
  id: defect.id,
  title: defect.title,
  summary: `${defect.title}; correction status ${defect.status}; independent Role 2 re-audit pending.`,
  status: "ACTIVE",
  facts: {
    lifecycleStatus: "OPEN",
    severity: defect.severity,
    correctionStatus: defect.status,
    role2AuditStatus: closure.role2.status,
    role2Disposition: closure.role2.disposition,
  },
  sourceRefs: [closureDocument.sourceRef],
}));
const role2Loop = {
  id: "PO-001-R2-S1-L1",
  title: "Role 2 Slice 1 correction audit Loop 1",
  summary:
    "Role 2 reported FAIL with three major defects; correction re-audit is pending.",
  status: "BLOCKED",
  facts: {
    critical: closure.role2.critical,
    major: closure.role2.major,
    minor: closure.role2.minor,
    disposition: closure.role2.disposition,
  },
  sourceRefs: [closureDocument.sourceRef],
};

const collections = {
  portfolio: slices.value.slices.map((item, index) =>
    record(item, slices.sourceRef, "SLICE", index),
  ),
  gates: gates.value.gates.map((item, index) =>
    item.id === "AG6"
      ? closureGate
      : item.id === "AG1"
        ? { ...closureGate, id: "AG1", title: item.name }
        : record(item, gates.sourceRef, "GATE", index),
  ),
  backlog: backlog.value.items.map((item, index) =>
    record(item, backlog.sourceRef, "WORK", index),
  ),
  decisions: decisionRecords,
  risks: registers.value.risks.map((item, index) =>
    record(item, registers.sourceRef, "RISK", index),
  ),
  requirements: registers.value.requirements.map((item, index) =>
    record(item, registers.sourceRef, "REQ", index),
  ),
  tests: registers.value.tests.map((item, index) =>
    item.id === "S1-AC-022"
      ? closureTest
      : record(item, registers.sourceRef, "TEST", index),
  ),
  defects: defectRecords,
  deployments: [
    ...registers.value.deployments.map((item, index) =>
      record(item, registers.sourceRef, "DEPLOY", index),
    ),
    closureDeployment,
  ],
  costs: registers.value.costs.map((item, index) =>
    record(item, registers.sourceRef, "COST", index),
  ),
  agents: agents.value.agents.map((item, index) =>
    record(item, agents.sourceRef, "AGENT", index),
  ),
  loops: [
    ...registers.value.loops.map((item, index) =>
      record(item, registers.sourceRef, "LOOP", index),
    ),
    role2Loop,
  ],
  evidence: [
    closureEvidence,
    ...[
      ...(artifactIndex.value.builds ?? []),
      ...(artifactIndex.value.artifacts ?? []),
      ...(artifactIndex.value.sboms ?? []),
      ...(artifactIndex.value.provenance ?? []),
    ].map((item, index) =>
      record(item, artifactIndex.sourceRef, "EVIDENCE", index),
    ),
  ],
};
for (const view of viewNames)
  if (collections[view].length === 0)
    throw new Error(`CI snapshot view is empty: ${view}`);

const views = Object.fromEntries(
  viewNames.map((view) => [
    view,
    {
      label: labels[view],
      description: `${collections[view].length} deterministic current-control records from repository evidence.`,
      status: collections[view].some(({ status }) => status === "BLOCKED")
        ? "BLOCKED"
        : "ACTIVE",
      records: collections[view],
    },
  ]),
);
const dashboard = {
  schemaVersion: "1.0",
  generatedAt: closure.observedAt,
  mode: "READ_ONLY",
  buildRef: createHash("sha256")
    .update(JSON.stringify({ closure: closure.commit, views }))
    .digest("hex"),
  notice:
    "Deterministic repository-only CI projection. Hosted closure is verified; Role 2 correction re-audit remains pending.",
  views,
};

await assertSafeSnapshotOutput();
await replaceRegularFileTransactionally(
  SNAPSHOT_OUTPUT_PATH,
  `${JSON.stringify(dashboard, null, 2)}\n`,
);
console.log(
  `dashboard CI snapshot: PASS (${Object.values(collections).flat().length} records; ${externalClosureSourceRef(closure).sha256})`,
);
