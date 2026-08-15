import { slice2LifecycleProjection } from "./slice2-lifecycle-policy.mjs";
import { validateSlice2DashboardClosure } from "./slice2-dashboard-closure-policy.mjs";
import {
  projectHistoricalLocalRecord,
  validateDashboardHistoricalProvenance,
} from "./dashboard-provenance-policy.mjs";
import { slice2HistoricalLocalClosure } from "./slice2-external-closure-policy.mjs";

const VIEW_KEYS = [
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

const STATE_ORDER = [
  "ERROR",
  "BLOCKED",
  "STALE",
  "UNKNOWN",
  "HISTORICAL",
  "ACTIVE",
  "PASS",
];

function exactSourceRef(value) {
  return (
    value &&
    typeof value.sourceId === "string" &&
    typeof value.path === "string" &&
    /^(?:[A-Za-z]:\\|\/)/u.test(value.path) &&
    typeof value.sha256 === "string" &&
    /^[A-F0-9]{64}$/u.test(value.sha256) &&
    typeof value.observedAt === "string" &&
    !Number.isNaN(Date.parse(value.observedAt))
  );
}

function pathKey(value) {
  return String(value).replaceAll("/", "\\").toLowerCase();
}

function sourceCatalog(documents) {
  const references = (documents.trustedEvidenceRefs ?? []).filter(
    exactSourceRef,
  );
  for (const value of Object.values(documents)) {
    if (exactSourceRef(value?.sourceRef)) references.push(value.sourceRef);
    if (exactSourceRef(value?.predecessorSourceRef))
      references.push(value.predecessorSourceRef);
  }
  for (const record of [
    ...(documents.artifactRecords ?? []),
    ...Object.values(documents.artifactRecordsByView ?? {}).flat(),
  ]) {
    references.push(...(record.sourceRefs ?? []).filter(exactSourceRef));
  }
  const byPath = new Map();
  for (const reference of references) {
    const key = pathKey(reference.path);
    const values = byPath.get(key) ?? [];
    if (!values.some((candidate) => candidate.sha256 === reference.sha256))
      values.push(reference);
    byPath.set(key, values);
  }
  return { references: [...byPath.values()].flat(), byPath };
}

function evidenceClaims(item) {
  return [
    ...(Array.isArray(item.evidence) ? item.evidence : []),
    ...(Array.isArray(item.evidenceRefs) ? item.evidenceRefs : []),
    ...(item.deliverables ?? []).flatMap(
      (deliverable) => deliverable.outputHashes ?? [],
    ),
    ...(item.testEvidence ?? []).flatMap((test) => test.evidenceRefs ?? []),
    ...(item.independentAudit?.evidenceRefs ?? []),
  ];
}

function matchingReference(claim, catalog) {
  const claimedPath = typeof claim === "string" ? claim : claim?.path;
  if (typeof claimedPath !== "string" || !claimedPath.trim()) return null;
  const normalized = pathKey(claimedPath);
  const candidates = /^(?:[a-z]:\\|\\)/u.test(normalized)
    ? (catalog.byPath.get(normalized) ?? [])
    : catalog.references.filter((reference) =>
        pathKey(reference.path).endsWith(`\\${normalized}`),
      );
  if (typeof claim === "object" && claim?.sha256) {
    const expected = String(claim.sha256).toUpperCase();
    return (
      candidates.find((candidate) => candidate.sha256 === expected) ?? null
    );
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function resolvedEvidence(item, catalog) {
  const claims = evidenceClaims(item);
  const refs = [];
  let failed = false;
  for (const claim of claims) {
    const match = matchingReference(claim, catalog);
    if (!match) {
      failed = true;
      continue;
    }
    if (
      !refs.some(
        (reference) =>
          reference.path === match.path && reference.sha256 === match.sha256,
      )
    )
      refs.push(match);
  }
  return {
    refs,
    integrity: failed ? "ERROR" : refs.length > 0 ? "VERIFIED" : "ABSENT",
  };
}

function evidenceState(value) {
  const normalized = String(value ?? "UNKNOWN")
    .trim()
    .toUpperCase();
  if (
    [
      "PASS",
      "PASSED",
      "COMPLETE",
      "COMPLETED",
      "CLOSED_BY_OWNER",
      "SUPERSEDED",
      "CLOSED",
      "CLOSED_BY_ROLE2",
    ].includes(normalized)
  )
    return "PASS";
  if (
    [
      "BLOCKED",
      "FAIL",
      "FAILED",
      "REOPENED",
      "REMAINS_OPEN",
      "PARTIALLY_CLOSED",
    ].includes(normalized)
  )
    return "BLOCKED";
  if (
    [
      "ACTIVE",
      "CURRENT",
      "IN_PROGRESS",
      "READY_FOR_ROLE2",
      "DELEGATED_TECHNICAL",
      "LOCAL_ONLY",
      "BOOTSTRAP_IN_PROGRESS",
      "INITIAL_PUSH_COMPLETE",
      "NOT_STARTED",
      "NOT_APPLICABLE",
      "PUSHED_PRIVATE",
      "OPEN",
      "CORRECTED_PENDING_ROLE2",
    ].includes(normalized)
  )
    return "ACTIVE";
  if (normalized === "ERROR") return "ERROR";
  if (normalized === "STALE") return "STALE";
  return "UNKNOWN";
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function record(item, sourceRef, index, prefix, catalog) {
  const id = text(item.id, `${prefix}-${String(index + 1).padStart(3, "0")}`);
  const evidence = resolvedEvidence(item, catalog);
  const claimedStatus = evidenceState(
    item.status ?? item.disposition ?? item.readiness ?? item.executionStatus,
  );
  const auditPending =
    item.independentAudit && item.independentAudit.disposition !== "PASS";
  const status =
    evidence.integrity === "ERROR"
      ? "ERROR"
      : claimedStatus === "PASS"
        ? evidence.integrity === "VERIFIED" && !auditPending
          ? "PASS"
          : "ACTIVE"
        : claimedStatus;
  const sourceRefs = [sourceRef, ...evidence.refs].filter(
    (reference, position, values) =>
      exactSourceRef(reference) &&
      values.findIndex(
        (candidate) =>
          candidate.path === reference.path &&
          candidate.sha256 === reference.sha256,
      ) === position,
  );
  return {
    id,
    title: text(item.title ?? item.name ?? item.role, id),
    summary: text(
      item.summary ?? item.reason ?? item.note ?? item.scope,
      "No additional summary is recorded.",
    ),
    status,
    ...(typeof item.owner === "string" ? { owner: item.owner } : {}),
    facts: {
      ...(typeof item.status === "string"
        ? { lifecycleStatus: item.status }
        : {}),
      ...(typeof item.disposition === "string"
        ? { disposition: item.disposition }
        : {}),
      ...Object.fromEntries(
        Object.entries(item)
          .filter(
            ([key, value]) =>
              ![
                "id",
                "title",
                "name",
                "role",
                "summary",
                "reason",
                "note",
                "scope",
                "status",
                "disposition",
                "readiness",
                "owner",
                "independentAudit",
                "deliverables",
                "testEvidence",
                "allowedTargets",
                "dependencies",
                "evidence",
                "evidenceRefs",
              ].includes(key) &&
              ["string", "number", "boolean"].includes(typeof value),
          )
          .slice(0, 12),
      ),
      evidenceIntegrity: evidence.integrity,
      ...(item.independentAudit
        ? {
            independentAuditor: item.independentAudit.auditorRole,
            auditDisposition: item.independentAudit.disposition,
          }
        : {}),
      ...(Array.isArray(item.deliverables)
        ? {
            deliverables: item.deliverables.length,
            outputHashes: item.deliverables.flatMap(
              (deliverable) => deliverable.outputHashes ?? [],
            ).length,
          }
        : {}),
      ...(Array.isArray(item.testEvidence)
        ? { testEvidence: item.testEvidence.length }
        : {}),
      ...(Array.isArray(item.allowedTargets)
        ? { allowedTargets: item.allowedTargets.length }
        : {}),
      ...(Array.isArray(item.dependencies)
        ? { dependencies: item.dependencies.length }
        : {}),
    },
    sourceRefs,
  };
}

function aggregate(records) {
  if (records.length === 0) return "UNKNOWN";
  for (const state of STATE_ORDER) {
    if (records.some((entry) => entry.status === state)) return state;
  }
  return "UNKNOWN";
}

function decisionRecords(document, catalog) {
  const dispositions = [
    "CLOSED_BY_OWNER",
    "SUPERSEDED",
    "PARTIALLY_CLOSED",
    "DELEGATED_TECHNICAL",
    "REMAINS_OPEN",
  ];
  const residuals = document.value.specific_residuals ?? {};
  return dispositions.flatMap((disposition) =>
    (document.value[disposition] ?? []).map((id, index) =>
      record(
        {
          id,
          title: id,
          summary: text(
            residuals[id],
            document.value.semantics?.[disposition] ?? disposition,
          ),
          disposition,
        },
        document.sourceRef,
        index,
        "DECISION",
        catalog,
      ),
    ),
  );
}

export function buildSemanticViews(documents) {
  const catalog = sourceCatalog(documents);
  const registers = documents.registers.value;
  const artifactIndex = documents.artifactIndex.value;
  const external = documents.externalState.value;
  const closure = documents.externalClosure?.value;
  const slice2Closure = documents.slice2Closure?.value;
  const slice2SourceRef = documents.slice2Closure?.sourceRef;
  const slice2AuditSourceRef = documents.slice2Closure?.auditSourceRef;
  const slice2PredecessorSourceRef =
    documents.slice2Closure?.predecessorSourceRef ?? slice2SourceRef;
  const slice2Lifecycle = slice2LifecycleProjection(slice2Closure);
  const slice2HistoricalClosure = slice2Closure
    ? slice2HistoricalLocalClosure(slice2Closure)
    : null;
  const slice2Ready = slice2Lifecycle.ready;
  const historicalProvenanceOptions =
    closure && slice2Closure
      ? {
          artifactIndexSourceRef: documents.artifactIndex.sourceRef,
          candidateSourceRefs: {
            "SLICE-1": matchingReference(
              {
                path: "evidence/slice1/local-validation.json",
                sha256: artifactIndex.artifacts?.find(
                  ({ id }) => id === "ARTIFACT-SLICE-1-LOCAL-VALIDATION",
                )?.sha256,
              },
              catalog,
            ),
            "SLICE-2": matchingReference(
              {
                path: "evidence/slice2/local-validation.json",
                sha256: artifactIndex.artifacts?.find(
                  ({ id }) => id === "ARTIFACT-SLICE-2-LOCAL-VALIDATION",
                )?.sha256,
              },
              catalog,
            ),
          },
          slice1Closure: closure,
          slice1ClosureSourceRef: documents.externalClosure.sourceRef,
          slice2Closure: slice2HistoricalClosure,
          slice2ClosureSourceRef: slice2PredecessorSourceRef,
        }
      : null;
  const slice2Evidence = slice2Closure
    ? [
        {
          path: slice2SourceRef.path,
          sha256: slice2SourceRef.sha256,
        },
        {
          path: slice2AuditSourceRef.path,
          sha256: slice2AuditSourceRef.sha256,
        },
      ]
    : [];
  const closureEvidence = closure
    ? [
        {
          path: documents.externalClosure.sourceRef.path,
          sha256: documents.externalClosure.sourceRef.sha256,
        },
        {
          path: closure.role2.auditPath,
          sha256: closure.role2.auditSha256,
        },
      ]
    : [];
  const predecessorEvidence = closure
    ? [
        {
          path: documents.externalClosure.predecessorSourceRef.path,
          sha256: documents.externalClosure.predecessorSourceRef.sha256,
        },
      ]
    : [];
  const closureGate = (item) =>
    closure
      ? {
          id: item.id,
          name: item.name,
          status: "ACTIVE",
          owner: "Repository safety",
          summary: `HOSTED_VERIFIED for ${closure.commit} at run ${closure.runId}, job ${closure.jobId}; Role 2 remains PENDING_ROLE2.`,
          closureStatus: closure.closureStatus,
          role2Status: closure.role2Status,
          repository: closure.repository,
          commit: closure.commit,
          tree: closure.tree,
          runId: closure.runId,
          jobId: closure.jobId,
          conclusion: closure.conclusion,
          evidenceRefs: closureEvidence,
        }
      : null;
  const closureTest = closure
    ? {
        id: "S1-AC-022",
        title: "Independent, remote, and hosted closure",
        status: "ACTIVE",
        summary: `${closure.closureStatus}; exact remote and hosted evidence verified; ${closure.role2Status}.`,
        closureStatus: closure.closureStatus,
        role2Status: closure.role2Status,
        repository: closure.repository,
        commit: closure.commit,
        tree: closure.tree,
        runId: closure.runId,
        jobId: closure.jobId,
        conclusion: closure.conclusion,
        evidenceRefs: closureEvidence,
      }
    : null;
  const externalRecords = [
    {
      id: "EXT-GITHUB",
      title: "GitHub repository state",
      status: external.github.status,
      summary: `${external.github.visibility} repository ${external.github.repository}; ${external.github.refs} refs at observation time.`,
      evidenceRefs: external.github.evidenceRefs,
    },
    ...(closure
      ? [
          {
            id: "EXT-GITHUB-CLOSURE",
            title: "GitHub hosted Slice 1 closure",
            status: "ACTIVE",
            summary: `${closure.repository} commit ${closure.commit}; run ${closure.runId}; job ${closure.jobId}; ${closure.closureStatus}; ${closure.role2Status}.`,
            repository: closure.repository,
            commit: closure.commit,
            tree: closure.tree,
            runId: closure.runId,
            jobId: closure.jobId,
            conclusion: closure.conclusion,
            closureStatus: closure.closureStatus,
            role2Status: closure.role2Status,
            predecessorFailureCount: closure.predecessorFailures.length,
            evidenceRefs: closureEvidence,
            _sourceRef: documents.externalClosure.sourceRef,
          },
          ...closure.predecessorFailures.map((failure, index) => ({
            id: `EXT-GITHUB-FAILURE-${failure.runId}`,
            title: `Failed GitHub workflow run ${failure.runId}`,
            status: "ACTIVE",
            summary: `Run ${failure.runId}; job ${failure.jobId}; commit ${failure.commit}; failure; ${closure.predecessorFailureReasons[index].reasonCode}.`,
            ...failure,
            reasonCode: closure.predecessorFailureReasons[index].reasonCode,
            evidenceRefs: predecessorEvidence,
            _sourceRef: documents.externalClosure.predecessorSourceRef,
          })),
        ]
      : []),
    {
      id: "EXT-GCP",
      title: "Google Cloud readiness",
      status: external.gcp.readiness,
      summary: `Project ${external.gcp.project} is ${external.gcp.lifecycle}; mutation ${external.gcp.mutation}.`,
      evidenceRefs: external.gcp.evidenceRefs,
    },
    {
      id: "EXT-CLOUDFLARE",
      title: "Cloudflare readiness",
      status: external.cloudflare.readiness,
      summary: `Zone ${external.cloudflare.zone}; ${external.cloudflare.matchbaseDnsRecords} MatchBASE DNS records; mutation ${external.cloudflare.mutation}.`,
      evidenceRefs: external.cloudflare.evidenceRefs,
    },
    {
      id: "EXT-DEPLOYMENT",
      title: "MatchBASE deployment",
      status: external.deployment.status,
      summary: "No MatchBASE deployment has started in the current slice.",
    },
  ].map((item, index) =>
    record(
      item,
      item._sourceRef ?? documents.externalState.sourceRef,
      index,
      "EXTERNAL",
      catalog,
    ),
  );
  const slice2Facts = slice2Closure
    ? {
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
      }
    : null;
  const slice2Gate = (item) => ({
    ...item,
    status: slice2Closure.gates[item.id],
    summary: `${slice2Closure.repository} commit ${slice2Closure.commit}; run ${slice2Closure.runId}; job ${slice2Closure.jobId}; ${slice2Closure.role3Disposition}; Role 2 ${slice2Closure.role2.status}.`,
    ...slice2Facts,
    evidenceRefs: slice2Evidence,
  });
  const slice2AuditGate = (item) => ({
    ...item,
    status: slice2Lifecycle.auditGateStatus,
    summary: slice2Ready
      ? `All seven independent audits passed on ${slice2Closure.candidate.manifestSha256}; Role 2 ${slice2Closure.role2.status}.`
      : item.summary,
    ...slice2Facts,
    evidenceRefs: slice2Evidence,
  });
  const slice2Orchestrator = (item) => ({
    ...item,
    executionStatus: slice2Lifecycle.orchestratorExecutionStatus,
    summary: slice2Ready
      ? `Slice 2 execution and independent audit orchestration completed on ${slice2Closure.candidate.manifestSha256}; Role 2 ${slice2Closure.role2.status}.`
      : item.summary,
    deliverables: (item.deliverables ?? []).map((deliverable) => ({
      ...deliverable,
      status: slice2Ready
        ? slice2Lifecycle.orchestratorDeliverableStatus
        : deliverable.status,
      outputHashes: slice2Ready ? slice2Evidence : deliverable.outputHashes,
    })),
    independentAudit: {
      ...item.independentAudit,
      disposition: slice2Lifecycle.orchestratorAuditDisposition,
      evidenceRefs: slice2Evidence,
    },
    evidenceRefs: slice2Evidence,
  });
  const slice2Acceptance = (item) => ({
    ...item,
    status: slice2Closure.acceptance[item.id],
    summary: `${item.title}; ${slice2Closure.acceptance[item.id]}; Role 2 ${slice2Closure.role2.status}.`,
    ...slice2Facts,
    evidenceRefs: slice2Evidence,
  });
  const slice2DeploymentRecords = slice2Closure
    ? [
        {
          id: "EXT-S2-GITHUB-CLOSURE",
          title: "GitHub hosted Slice 2 closure",
          status: "PASS",
          summary: `${slice2Closure.commit}; run ${slice2Closure.runId}; job ${slice2Closure.jobId}; ${slice2Closure.conclusion}.`,
          ...slice2Facts,
          predecessorCount: slice2Closure.predecessors.length,
          evidenceRefs: slice2Evidence,
        },
        ...slice2Closure.predecessors.map((predecessor) => ({
          id: `EXT-S2-GITHUB-PREDECESSOR-${predecessor.runId}`,
          title: `Preserved Slice 2 workflow run ${predecessor.runId}`,
          status: "PASS",
          summary: `${predecessor.conclusion}; ${predecessor.reason}.`,
          ...predecessor,
          reasonCode: predecessor.reason,
          evidenceRefs: [slice2PredecessorSourceRef],
          _sourceRef: slice2PredecessorSourceRef,
        })),
      ]
    : [];
  const collections = {
    portfolio: (documents.slices.value.slices ?? []).map((item, index) =>
      record(
        item.id === "SLICE-2" && slice2Closure
          ? {
              ...item,
              status: slice2Lifecycle.portfolioStatus,
              summary: `${item.name}; ${slice2Closure.role3Disposition}; Role 2 ${slice2Closure.role2.status}.`,
              ...slice2Facts,
              evidenceRefs: slice2Evidence,
            }
          : item,
        item.id === "SLICE-2" && slice2Closure
          ? slice2SourceRef
          : documents.slices.sourceRef,
        index,
        "SLICE",
        catalog,
      ),
    ),
    gates: (documents.gates.value.gates ?? []).map((item, index) =>
      record(
        item.id === "S2-G1" && slice2Closure
          ? slice2AuditGate(item)
          : ["S2-G2", "S2-G9"].includes(item.id) && slice2Closure
            ? slice2Gate(item)
            : ["AG1", "AG6"].includes(item.id) && closure
              ? closureGate(item)
              : item,
        ["S2-G1", "S2-G2", "S2-G9"].includes(item.id) && slice2Closure
          ? item.id === "S2-G1"
            ? slice2AuditSourceRef
            : slice2SourceRef
          : ["AG1", "AG6"].includes(item.id) && closure
            ? documents.externalClosure.sourceRef
            : documents.gates.sourceRef,
        index,
        "GATE",
        catalog,
      ),
    ),
    backlog: (documents.backlog.value.items ?? []).map((item, index) =>
      record(item, documents.backlog.sourceRef, index, "WORK", catalog),
    ),
    decisions: decisionRecords(documents.dispositions, catalog),
    risks: (registers.risks ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "RISK", catalog),
    ),
    requirements: [
      ...(registers.requirements ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "REQ", catalog),
      ),
      ...(documents.artifactRecordsByView.requirements ?? []),
    ],
    tests: [
      ...(registers.tests ?? []).map((item, index) =>
        record(
          slice2Closure && Object.hasOwn(slice2Closure.acceptance, item.id)
            ? slice2Acceptance(item)
            : item.id === "S1-AC-022" && closureTest
              ? closureTest
              : item,
          slice2Closure && Object.hasOwn(slice2Closure.acceptance, item.id)
            ? slice2SourceRef
            : item.id === "S1-AC-022" && closureTest
              ? documents.externalClosure.sourceRef
              : documents.registers.sourceRef,
          index,
          "TEST",
          catalog,
        ),
      ),
      ...Object.entries(slice2Closure?.acceptance ?? {})
        .filter(
          ([id]) => !(registers.tests ?? []).some((item) => item.id === id),
        )
        .map(([id, status], index) =>
          record(
            slice2Acceptance({ id, title: id, status }),
            slice2SourceRef,
            index,
            "S2-LOOP2-TEST",
            catalog,
          ),
        ),
      ...(documents.artifactRecordsByView.tests ?? []),
    ],
    defects: [
      ...(registers.defects ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "DEFECT", catalog),
      ),
      ...(closure?.role2.defects ?? []).map((item, index) =>
        record(
          {
            ...item,
            summary: `${item.title}; Role 2 correction re-audit status ${item.status}.`,
            role2AuditStatus: closure.role2.status,
            role2Disposition: closure.role2.disposition,
            evidenceRefs: closureEvidence,
          },
          documents.externalClosure.sourceRef,
          index,
          "S1-L1-DEFECT",
          catalog,
        ),
      ),
      ...(slice2Closure?.role2.defects ?? []).map((item, index) =>
        record(
          {
            ...item,
            summary: `${item.title}; ${item.status}; Role 2 ${slice2Closure.role2.status}.`,
            role2Status: slice2Closure.role2.status,
            role2Disposition: slice2Closure.role2.disposition,
            evidenceRefs: slice2Evidence,
          },
          slice2SourceRef,
          index,
          "S2-R2-DEFECT",
          catalog,
        ),
      ),
    ],
    deployments: [
      ...(registers.deployments ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "DEPLOY", catalog),
      ),
      ...(artifactIndex.deployments ?? []).map((item, index) =>
        record(
          item,
          documents.artifactIndex.sourceRef,
          index,
          "DEPLOY-ARTIFACT",
          catalog,
        ),
      ),
      ...externalRecords,
      ...slice2DeploymentRecords.map((item, index) =>
        record(
          item,
          item._sourceRef ?? slice2SourceRef,
          index,
          "S2-DEPLOY",
          catalog,
        ),
      ),
    ],
    costs: (registers.costs ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "COST", catalog),
    ),
    agents: (documents.agents.value.agents ?? []).map((item, index) =>
      record(
        item.id === "AGENT-S2-ORCHESTRATOR" && slice2Closure
          ? slice2Orchestrator(item)
          : item,
        item.id === "AGENT-S2-ORCHESTRATOR" && slice2Closure
          ? slice2AuditSourceRef
          : documents.agents.sourceRef,
        index,
        "AGENT",
        catalog,
      ),
    ),
    loops: [
      ...(registers.loops ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "LOOP", catalog),
      ),
      ...(closure
        ? [
            record(
              {
                id: "PO-001-R2-S1-L2",
                title: "Role 2 Slice 1 correction audit Loop 2",
                status: closure.role2.status,
                summary: `Role 2 FAIL with ${closure.role2.critical} critical, ${closure.role2.major} major, and ${closure.role2.minor} minor defects; correction re-audit pending.`,
                critical: closure.role2.critical,
                major: closure.role2.major,
                minor: closure.role2.minor,
                disposition: closure.role2.disposition,
                evidenceRefs: closureEvidence,
              },
              documents.externalClosure.sourceRef,
              0,
              "ROLE2-LOOP",
              catalog,
            ),
          ]
        : []),
      ...(slice2Closure
        ? [
            record(
              {
                id: "PO-001-R2-S2-L1",
                title: "Role 2 Slice 2 correction Loop 1",
                status: slice2Ready ? "CORRECTED_PENDING_ROLE2" : "OPEN",
                summary: `Three Role 2 Major defects; ${slice2Closure.role3Disposition}; Role 2 ${slice2Closure.role2.status}.`,
                critical: slice2Closure.role2.critical,
                major: slice2Closure.role2.major,
                minor: slice2Closure.role2.minor,
                disposition: slice2Closure.role2.disposition,
                ...slice2Facts,
                evidenceRefs: slice2Evidence,
              },
              slice2SourceRef,
              0,
              "S2-ROLE2-LOOP",
              catalog,
            ),
          ]
        : []),
    ],
    evidence: [
      ...(registers.evidence ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "EVIDENCE", catalog),
      ),
      ...[
        ...(artifactIndex.builds ?? []),
        ...(artifactIndex.artifacts ?? []),
        ...(artifactIndex.sboms ?? []),
        ...(artifactIndex.provenance ?? []),
      ].map((item, index) =>
        historicalProvenanceOptions
          ? (projectHistoricalLocalRecord(
              item,
              artifactIndex,
              historicalProvenanceOptions,
            ) ??
            record(
              item,
              documents.artifactIndex.sourceRef,
              index,
              "EVIDENCE-ARTIFACT",
              catalog,
            ))
          : record(
              item,
              documents.artifactIndex.sourceRef,
              index,
              "EVIDENCE-ARTIFACT",
              catalog,
            ),
      ),
      ...documents.artifactRecords,
      ...(closure
        ? [
            record(
              {
                id: "EVIDENCE-S1-EXTERNAL-CLOSURE",
                title: "Authenticated hosted Slice 1 closure",
                status: "ACTIVE",
                summary: `${closure.closureStatus} for ${closure.commit}, run ${closure.runId}, job ${closure.jobId}; ${closure.role2Status}.`,
                repository: closure.repository,
                commit: closure.commit,
                tree: closure.tree,
                runId: closure.runId,
                jobId: closure.jobId,
                conclusion: closure.conclusion,
                closureStatus: closure.closureStatus,
                role2Status: closure.role2Status,
                evidenceRefs: closureEvidence,
              },
              documents.externalClosure.sourceRef,
              0,
              "EXTERNAL-CLOSURE",
              catalog,
            ),
          ]
        : []),
      ...(slice2Closure
        ? [
            record(
              {
                id: "EVIDENCE-S2-EXTERNAL-CLOSURE",
                title: "Authenticated hosted Slice 2 closure",
                status: "PASS",
                summary: `${slice2Closure.commit}; run ${slice2Closure.runId}; job ${slice2Closure.jobId}; ${slice2Closure.role3Disposition}.`,
                ...slice2Facts,
                evidenceRefs: slice2Evidence,
              },
              slice2SourceRef,
              0,
              "S2-EXTERNAL-CLOSURE",
              catalog,
            ),
            ...slice2Closure.audits.map((id, index) =>
              record(
                {
                  id,
                  title: id,
                  status: "PASS",
                  summary: `PASS 0C/0M/0m on ${slice2Closure.candidate.manifestSha256}.`,
                  critical: 0,
                  major: 0,
                  minor: 0,
                  candidateManifestSha256:
                    slice2Closure.candidate.manifestSha256,
                  candidateAggregateSha256:
                    slice2Closure.candidate.aggregateSha256,
                  evidenceRefs: slice2Evidence,
                },
                slice2AuditSourceRef,
                index,
                "S2-AUDIT",
                catalog,
              ),
            ),
          ]
        : []),
    ],
  };

  const views = Object.fromEntries(
    VIEW_KEYS.map((key) => {
      const records = collections[key];
      return [key, { records, status: aggregate(records) }];
    }),
  );
  if (historicalProvenanceOptions)
    validateDashboardHistoricalProvenance(
      views,
      artifactIndex,
      historicalProvenanceOptions,
    );
  if (slice2Closure)
    validateSlice2DashboardClosure(views, slice2Closure, {
      closureSourceRef: slice2SourceRef,
      auditSourceRef: slice2AuditSourceRef,
      predecessorSourceRef: slice2PredecessorSourceRef,
    });
  return views;
}
