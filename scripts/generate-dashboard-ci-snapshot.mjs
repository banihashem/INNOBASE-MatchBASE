import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  externalClosureSourceRef,
  validateExternalClosure,
} from "./lib/external-closure-policy.mjs";
import {
  slice2DashboardAuditSourceRef,
  slice2HistoricalLocalClosure,
  validateSlice2ExternalClosure,
} from "./lib/slice2-external-closure-policy.mjs";
import { slice2LifecycleProjection } from "./lib/slice2-lifecycle-policy.mjs";
import { validateSlice2DashboardClosure } from "./lib/slice2-dashboard-closure-policy.mjs";
import {
  projectHistoricalLocalRecord,
  validateDashboardHistoricalProvenance,
  validateSlice2HistoricalGitObject,
} from "./lib/dashboard-provenance-policy.mjs";
import {
  assertExactPredecessorHistory,
  validatePredecessorAttestation,
} from "./lib/predecessor-failure-policy.mjs";
import { replaceRegularFileTransactionally } from "./lib/replace-regular-file.mjs";
import {
  applySlice3DashboardProjection,
  slice3EvidenceSourceRef,
  validateSlice3Dashboard,
  validateSlice3Evidence,
  validateSlice3Governance,
} from "./lib/slice3-dashboard-policy.mjs";
import {
  REPOSITORY_ROOT,
  SNAPSHOT_DIST_OUTPUT_PATH,
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
const slice2ClosureDocument = await document(
  "governance/slice2-external-closure-anchor-v1.json",
);
const slice2Closure = validateSlice2ExternalClosure(
  slice2ClosureDocument.value,
  {
    anchorOnly: true,
  },
);
const slice2Lifecycle = slice2LifecycleProjection(slice2Closure);
slice2ClosureDocument.sourceRef.observedAt = slice2Closure.observedAt;
const slice2DashboardAuditSource = slice2DashboardAuditSourceRef(
  slice2Closure,
  {
    anchorOnly: true,
    anchorSourceRef: slice2ClosureDocument.sourceRef,
  },
);
const [
  slices,
  gates,
  backlog,
  decisions,
  registers,
  agents,
  artifactIndex,
  slice1LocalEvidence,
  slice2LocalEvidence,
  predecessorHistory,
  externalState,
  slice3LocalEvidence,
] = await Promise.all([
  document("governance/slices.json"),
  document("governance/gates.json"),
  document("governance/backlog.json"),
  document("governance/decisions.json"),
  document("governance/registers.json"),
  document("governance/agents.json"),
  document("governance/artifact-index.json"),
  document("evidence/slice1/local-validation.json"),
  document("evidence/slice2/local-validation.json"),
  document("governance/predecessor-failures-v1.json"),
  document("governance/external-state.json"),
  document("evidence/slice3/local-validation.json"),
]);
validateSlice3Evidence(slice3LocalEvidence.value);
validateSlice3Governance(gates.value.gates, slice3LocalEvidence.value);
const slice3SourceRef = slice3EvidenceSourceRef(
  slice3LocalEvidence.sourceRef.path,
  await readFile(slice3LocalEvidence.sourceRef.path),
  slice3LocalEvidence.value,
);
validateSlice2HistoricalGitObject(
  artifactIndex.value,
  slice2HistoricalLocalClosure(slice2Closure),
  {
    repoRoot: REPOSITORY_ROOT,
  },
);
const predecessorAttestation = validatePredecessorAttestation(
  predecessorHistory.value,
  {
    currentRunId: closure.runId,
    currentJobId: closure.jobId,
    currentCommit: closure.commit,
  },
);
assertExactPredecessorHistory(
  predecessorAttestation.failures,
  predecessorAttestation.reasons,
  closure.predecessorFailures,
  closure.predecessorFailureReasons,
);

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
    predecessorFailureCount: closure.predecessorFailures.length,
  },
};
const predecessorFailureRecords = closure.predecessorFailures.map(
  (failure, index) => ({
    id: `EXT-GITHUB-FAILURE-${failure.runId}`,
    title: `Failed GitHub workflow run ${failure.runId}`,
    summary: `Run ${failure.runId}; job ${failure.jobId}; commit ${failure.commit}; failure; ${closure.predecessorFailureReasons[index].reasonCode}.`,
    status: "ACTIVE",
    facts: {
      ...failure,
      reasonCode: closure.predecessorFailureReasons[index].reasonCode,
    },
    sourceRefs: [predecessorHistory.sourceRef],
  }),
);
const closureEvidence = closureRecord(
  "EVIDENCE-S1-EXTERNAL-CLOSURE",
  "Authenticated hosted Slice 1 closure",
);
const defectRecords = closure.role2.defects.map((defect) => ({
  id: defect.id,
  title: defect.title,
  summary: `${defect.title}; correction status ${defect.status}; independent Role 2 re-audit pending.`,
  status: defect.status === "CLOSED_BY_ROLE2" ? "PASS" : "ACTIVE",
  facts: {
    lifecycleStatus: defect.status,
    severity: defect.severity,
    correctionStatus: defect.status,
    role2AuditStatus: closure.role2.status,
    role2Disposition: closure.role2.disposition,
  },
  sourceRefs: [closureDocument.sourceRef],
}));
const role2Loop = {
  id: "PO-001-R2-S1-L2",
  title: "Role 2 Slice 1 correction audit Loop 2",
  summary:
    "Role 2 reported one residual major defect; correction re-audit is pending.",
  status: "BLOCKED",
  facts: {
    critical: closure.role2.critical,
    major: closure.role2.major,
    minor: closure.role2.minor,
    disposition: closure.role2.disposition,
  },
  sourceRefs: [closureDocument.sourceRef],
};

const slice2Facts = {
  repository: slice2Closure.repository,
  commit: slice2Closure.commit,
  tree: slice2Closure.tree,
  runId: slice2Closure.runId,
  jobId: slice2Closure.jobId,
  conclusion: slice2Closure.conclusion,
  role3Disposition: slice2Closure.role3Disposition,
  role2Status: slice2Closure.role2.status,
  candidateManifestSha256: slice2Closure.candidate.manifestSha256,
  candidateAggregateSha256: slice2Closure.candidate.aggregateSha256,
};
function slice2Record(id, title, status, extra = {}, audit = false) {
  return {
    id,
    title,
    summary: `${slice2Closure.commit}; run ${slice2Closure.runId}; job ${slice2Closure.jobId}; ${slice2Closure.role3Disposition}; Role 2 ${slice2Closure.role2.status}.`,
    status:
      status === "PASS"
        ? "PASS"
        : ["FAIL", "REOPENED", "OPEN"].includes(status)
          ? "BLOCKED"
          : "ACTIVE",
    facts: { lifecycleStatus: status, ...slice2Facts, ...extra },
    sourceRefs: [
      audit ? slice2DashboardAuditSource : slice2ClosureDocument.sourceRef,
    ],
  };
}
const slice2Predecessors = slice2Closure.predecessors.map((item) => ({
  id: `EXT-S2-GITHUB-PREDECESSOR-${item.runId}`,
  title: `Preserved Slice 2 workflow run ${item.runId}`,
  summary: `${item.conclusion}; ${item.reason}.`,
  status: "PASS",
  facts: {
    lifecycleStatus: "PASS",
    runId: item.runId,
    jobId: item.jobId,
    commit: item.commit,
    tree: item.tree,
    conclusion: item.conclusion,
    reasonCode: item.reason,
    evidenceIntegrity: "VERIFIED",
  },
  sourceRefs: [slice2ClosureDocument.sourceRef],
}));
const slice2Defects = slice2Closure.role2.defects.map((item) =>
  slice2Record(item.id, item.title, item.status, {
    role2Status: slice2Closure.role2.status,
    role2Disposition: slice2Closure.role2.disposition,
  }),
);
const slice2Audits = slice2Closure.audits.map((id) =>
  slice2Record(
    id,
    id,
    "PASS",
    {
      critical: 0,
      major: 0,
      minor: 0,
      candidateManifestSha256: slice2Closure.candidate.manifestSha256,
      candidateAggregateSha256: slice2Closure.candidate.aggregateSha256,
    },
    true,
  ),
);
const slice2Orchestrator = {
  id: "AGENT-S2-ORCHESTRATOR",
  title: "Slice 2 Role 3 executor and evidence orchestrator",
  summary: slice2Lifecycle.ready
    ? `Slice 2 execution and independent audit orchestration completed on ${slice2Closure.candidate.manifestSha256}; Role 2 ${slice2Closure.role2.status}.`
    : "Slice 2 execution and independent audit orchestration remain in progress.",
  status: slice2Lifecycle.orchestratorStatus,
  facts: {
    executionStatus: slice2Lifecycle.orchestratorExecutionStatus,
    auditDisposition: slice2Lifecycle.orchestratorAuditDisposition,
    ...slice2Facts,
  },
  sourceRefs: [slice2DashboardAuditSource],
};

const historicalProvenanceOptions = {
  artifactIndexSourceRef: artifactIndex.sourceRef,
  candidateSourceRefs: {
    "SLICE-1": slice1LocalEvidence.sourceRef,
    "SLICE-2": slice2LocalEvidence.sourceRef,
  },
  slice1Closure: closure,
  slice1ClosureSourceRef: closureDocument.sourceRef,
  slice2Closure: slice2HistoricalLocalClosure(slice2Closure),
  slice2ClosureSourceRef: slice2ClosureDocument.sourceRef,
};

const collections = {
  portfolio: slices.value.slices.map((item, index) =>
    item.id === "SLICE-2"
      ? slice2Record("SLICE-2", item.name, slice2Lifecycle.portfolioStatus)
      : record(item, slices.sourceRef, "SLICE", index),
  ),
  gates: gates.value.gates.map((item, index) =>
    item.id === "S2-G1"
      ? slice2Record(
          item.id,
          item.name,
          slice2Lifecycle.auditGateStatus,
          {},
          true,
        )
      : ["S2-G2", "S2-G9"].includes(item.id)
        ? slice2Record(item.id, item.name, slice2Closure.gates[item.id])
        : item.id === "AG6"
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
  tests: [
    ...registers.value.tests.map((item, index) =>
      Object.hasOwn(slice2Closure.acceptance, item.id)
        ? slice2Record(item.id, item.title, slice2Closure.acceptance[item.id])
        : item.id === "S1-AC-022"
          ? closureTest
          : record(item, registers.sourceRef, "TEST", index),
    ),
    ...Object.entries(slice2Closure.acceptance)
      .filter(([id]) => !registers.value.tests.some((item) => item.id === id))
      .map(([id, status]) => slice2Record(id, id, status)),
  ],
  defects: [...defectRecords, ...slice2Defects],
  deployments: [
    ...registers.value.deployments.map((item, index) =>
      record(item, registers.sourceRef, "DEPLOY", index),
    ),
    closureDeployment,
    ...predecessorFailureRecords,
    slice2Record(
      "EXT-S2-GITHUB-CLOSURE",
      "GitHub hosted Slice 2 closure",
      "PASS",
      { predecessorCount: slice2Closure.predecessors.length },
    ),
    ...slice2Predecessors,
    record(
      {
        id: "EXT-GCP",
        title: "Google Cloud readiness",
        status: externalState.value.gcp.readiness,
      },
      externalState.sourceRef,
      "EXT",
    ),
    record(
      {
        id: "EXT-CLOUDFLARE",
        title: "Cloudflare readiness",
        status: externalState.value.cloudflare.readiness,
      },
      externalState.sourceRef,
      "EXT",
    ),
    record(
      {
        id: "EXT-DEPLOYMENT",
        title: "MatchBASE deployment",
        status: externalState.value.deployment.status,
      },
      externalState.sourceRef,
      "EXT",
    ),
  ],
  costs: registers.value.costs.map((item, index) =>
    record(item, registers.sourceRef, "COST", index),
  ),
  agents: agents.value.agents.map((item, index) =>
    item.id === "AGENT-S2-ORCHESTRATOR"
      ? slice2Orchestrator
      : record(item, agents.sourceRef, "AGENT", index),
  ),
  loops: [
    ...registers.value.loops.map((item, index) =>
      record(item, registers.sourceRef, "LOOP", index),
    ),
    role2Loop,
    slice2Record(
      "PO-001-R2-S2-L1",
      "Role 2 Slice 2 correction Loop 1",
      "OPEN",
      {
        critical: slice2Closure.role2.critical,
        major: slice2Closure.role2.major,
        minor: slice2Closure.role2.minor,
        disposition: slice2Closure.role2.disposition,
      },
    ),
  ],
  evidence: [
    closureEvidence,
    slice2Record(
      "EVIDENCE-S2-EXTERNAL-CLOSURE",
      "Authenticated hosted Slice 2 closure",
      "PASS",
    ),
    ...slice2Audits,
    ...[
      ...(artifactIndex.value.builds ?? []),
      ...(artifactIndex.value.artifacts ?? []),
      ...(artifactIndex.value.sboms ?? []),
      ...(artifactIndex.value.provenance ?? []),
    ].map(
      (item, index) =>
        projectHistoricalLocalRecord(
          item,
          artifactIndex.value,
          historicalProvenanceOptions,
        ) ?? record(item, artifactIndex.sourceRef, "EVIDENCE", index),
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
applySlice3DashboardProjection(
  views,
  slice3LocalEvidence.value,
  slice3SourceRef,
);
validateSlice3Dashboard(views, slice3LocalEvidence.value, slice3SourceRef);
validateDashboardHistoricalProvenance(
  views,
  artifactIndex.value,
  historicalProvenanceOptions,
);
validateSlice2DashboardClosure(views, slice2Closure, {
  closureSourceRef: slice2ClosureDocument.sourceRef,
  auditSourceRef: slice2DashboardAuditSource,
  predecessorSourceRef: slice2ClosureDocument.sourceRef,
});
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
const snapshotBytes = `${JSON.stringify(dashboard, null, 2)}\n`;
await replaceRegularFileTransactionally(SNAPSHOT_OUTPUT_PATH, snapshotBytes);
await mkdir(resolve(SNAPSHOT_DIST_OUTPUT_PATH, ".."), { recursive: true });
await replaceRegularFileTransactionally(
  SNAPSHOT_DIST_OUTPUT_PATH,
  snapshotBytes,
  SNAPSHOT_DIST_OUTPUT_PATH,
);
console.log(
  `dashboard CI snapshot: PASS (${Object.values(collections).flat().length} records; ${externalClosureSourceRef(closure).sha256})`,
);
