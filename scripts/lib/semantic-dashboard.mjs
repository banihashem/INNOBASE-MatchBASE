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

const STATE_ORDER = ["ERROR", "BLOCKED", "STALE", "UNKNOWN", "ACTIVE", "PASS"];

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
    ].includes(normalized)
  )
    return "PASS";
  if (
    ["BLOCKED", "FAIL", "FAILED", "REMAINS_OPEN", "PARTIALLY_CLOSED"].includes(
      normalized,
    )
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
      "PUSHED_PRIVATE",
      "OPEN",
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
  const externalRecords = [
    {
      id: "EXT-GITHUB",
      title: "GitHub repository state",
      status: external.github.status,
      summary: `${external.github.visibility} repository ${external.github.repository}; ${external.github.refs} refs at observation time.`,
      evidenceRefs: external.github.evidenceRefs,
    },
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
    record(item, documents.externalState.sourceRef, index, "EXTERNAL", catalog),
  );
  const collections = {
    portfolio: (documents.slices.value.slices ?? []).map((item, index) =>
      record(item, documents.slices.sourceRef, index, "SLICE", catalog),
    ),
    gates: (documents.gates.value.gates ?? []).map((item, index) =>
      record(item, documents.gates.sourceRef, index, "GATE", catalog),
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
        record(item, documents.registers.sourceRef, index, "TEST", catalog),
      ),
      ...(documents.artifactRecordsByView.tests ?? []),
    ],
    defects: (registers.defects ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "DEFECT", catalog),
    ),
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
    ],
    costs: (registers.costs ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "COST", catalog),
    ),
    agents: (documents.agents.value.agents ?? []).map((item, index) =>
      record(item, documents.agents.sourceRef, index, "AGENT", catalog),
    ),
    loops: (registers.loops ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "LOOP", catalog),
    ),
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
        record(
          item,
          documents.artifactIndex.sourceRef,
          index,
          "EVIDENCE-ARTIFACT",
          catalog,
        ),
      ),
      ...documents.artifactRecords,
    ],
  };

  return Object.fromEntries(
    VIEW_KEYS.map((key) => {
      const records = collections[key];
      return [key, { records, status: aggregate(records) }];
    }),
  );
}
