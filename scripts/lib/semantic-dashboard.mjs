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

function record(item, sourceRef, index, prefix) {
  const id = text(item.id, `${prefix}-${String(index + 1).padStart(3, "0")}`);
  return {
    id,
    title: text(item.title ?? item.name ?? item.role, id),
    summary: text(
      item.summary ?? item.reason ?? item.note ?? item.scope,
      "No additional summary is recorded.",
    ),
    status: evidenceState(item.status ?? item.disposition ?? item.readiness),
    ...(typeof item.owner === "string" ? { owner: item.owner } : {}),
    facts: Object.fromEntries(
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
              "evidence",
              "evidenceRefs",
            ].includes(key) &&
            ["string", "number", "boolean"].includes(typeof value),
        )
        .slice(0, 12),
    ),
    sourceRefs: [sourceRef],
  };
}

function aggregate(records) {
  if (records.length === 0) return "UNKNOWN";
  for (const state of STATE_ORDER) {
    if (records.some((entry) => entry.status === state)) return state;
  }
  return "UNKNOWN";
}

function decisionRecords(document) {
  const dispositions = [
    "CLOSED_BY_OWNER",
    "SUPERSEDED",
    "PARTIALLY_CLOSED",
    "DELEGATED_TECHNICAL",
    "REMAINS_OPEN",
  ];
  const residuals = document.value.specific_residuals ?? {};
  return dispositions.flatMap((disposition) =>
    (document.value[disposition] ?? []).map((id) => ({
      id,
      title: id,
      summary: text(
        residuals[id],
        document.value.semantics?.[disposition] ?? disposition,
      ),
      status: evidenceState(disposition),
      facts: { disposition },
      sourceRefs: [document.sourceRef],
    })),
  );
}

export function buildSemanticViews(documents) {
  const registers = documents.registers.value;
  const artifactIndex = documents.artifactIndex.value;
  const external = documents.externalState.value;
  const externalRecords = [
    {
      id: "EXT-GITHUB",
      title: "GitHub repository state",
      status: external.github.status,
      summary: `${external.github.visibility} repository ${external.github.repository}; ${external.github.refs} refs at observation time.`,
    },
    {
      id: "EXT-GCP",
      title: "Google Cloud readiness",
      status: external.gcp.readiness,
      summary: `Project ${external.gcp.project} is ${external.gcp.lifecycle}; mutation ${external.gcp.mutation}.`,
    },
    {
      id: "EXT-CLOUDFLARE",
      title: "Cloudflare readiness",
      status: external.cloudflare.readiness,
      summary: `Zone ${external.cloudflare.zone}; ${external.cloudflare.matchbaseDnsRecords} MatchBASE DNS records; mutation ${external.cloudflare.mutation}.`,
    },
    {
      id: "EXT-DEPLOYMENT",
      title: "MatchBASE deployment",
      status: external.deployment.status,
      summary: "No MatchBASE deployment has started in the current slice.",
    },
  ].map((item, index) =>
    record(item, documents.externalState.sourceRef, index, "EXTERNAL"),
  );
  const collections = {
    portfolio: (documents.slices.value.slices ?? []).map((item, index) =>
      record(item, documents.slices.sourceRef, index, "SLICE"),
    ),
    gates: (documents.gates.value.gates ?? []).map((item, index) =>
      record(item, documents.gates.sourceRef, index, "GATE"),
    ),
    backlog: (documents.backlog.value.items ?? []).map((item, index) =>
      record(item, documents.backlog.sourceRef, index, "WORK"),
    ),
    decisions: decisionRecords(documents.dispositions),
    risks: (registers.risks ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "RISK"),
    ),
    requirements: [
      ...(registers.requirements ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "REQ"),
      ),
      ...(documents.artifactRecordsByView.requirements ?? []),
    ],
    tests: [
      ...(registers.tests ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "TEST"),
      ),
      ...(documents.artifactRecordsByView.tests ?? []),
    ],
    defects: (registers.defects ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "DEFECT"),
    ),
    deployments: [
      ...(registers.deployments ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "DEPLOY"),
      ),
      ...(artifactIndex.deployments ?? []).map((item, index) =>
        record(
          item,
          documents.artifactIndex.sourceRef,
          index,
          "DEPLOY-ARTIFACT",
        ),
      ),
      ...externalRecords,
    ],
    costs: (registers.costs ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "COST"),
    ),
    agents: (documents.agents.value.agents ?? []).map((item, index) =>
      record(item, documents.agents.sourceRef, index, "AGENT"),
    ),
    loops: (registers.loops ?? []).map((item, index) =>
      record(item, documents.registers.sourceRef, index, "LOOP"),
    ),
    evidence: [
      ...(registers.evidence ?? []).map((item, index) =>
        record(item, documents.registers.sourceRef, index, "EVIDENCE"),
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
