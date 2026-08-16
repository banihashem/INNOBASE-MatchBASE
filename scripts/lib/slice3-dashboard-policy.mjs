import { createHash } from "node:crypto";

export const SLICE3_ACCEPTANCE_IDS = Array.from(
  { length: 24 },
  (_, index) => `S3-AC-${String(index + 1).padStart(3, "0")}`,
);
export const SLICE3_AUDIT_IDS = [
  "security_privacy_iam",
  "ai_evidence",
  "data_migration",
  "qa_accessibility",
  "sre_cost_recovery",
  "repository_release_preservation",
  "integration_critic",
];
export const SLICE3_BLOCKER_CODES = [
  "ROUTE_POLICY_NOT_ENABLED",
  "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
  "APPROVED_DIRECT_CREDENTIAL_ABSENT",
  "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
  "EXPLICIT_BILLABLE_QUALIFICATION_AUTHORIZATION_ABSENT",
  "QUALIFICATION_BUDGET_INVALID",
];
export const SLICE3_ROLE2_DEFECTS = ["D001", "D002", "D003", "D004"].map(
  (id) => ({ id, status: "CORRECTED_PENDING_ROLE2" }),
);

const exact = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message);
};
const auditRecordId = (id) =>
  `S3-AUDIT-${id.toUpperCase().replaceAll("_", "-")}`;

export function validateSlice3Evidence(value, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 60_000;
  const observedAtMs = Date.parse(value?.observedAt ?? "");
  if (!Number.isFinite(observedAtMs) || observedAtMs > nowMs + maxFutureSkewMs)
    throw new Error("Slice 3 observedAt is invalid or in the future.");
  if (
    value?.schemaVersion !== 1 ||
    value?.slice !== "SLICE-3" ||
    value?.repositoryImplementation !== "PASS" ||
    value?.liveQualification !== "BLOCKED_PREREQUISITE" ||
    value?.role2?.status !== "FAIL" ||
    value?.role2?.acceptanceClaimed !== false ||
    value?.qualificationPreflight?.providerCalls !== 0 ||
    value?.qualificationPreflight?.externalMutations !== 0 ||
    value?.environment?.providerNetworkCalls !== 0
  )
    throw new Error("Slice 3 lifecycle evidence is invalid.");
  exact(
    value.role2.defects,
    SLICE3_ROLE2_DEFECTS,
    "Slice 3 Role 2 correction lifecycle is invalid.",
  );
  exact(
    value.blockerCodes,
    SLICE3_BLOCKER_CODES,
    "Slice 3 blocker order is invalid.",
  );
  exact(
    value.qualificationPreflight?.blockers,
    SLICE3_BLOCKER_CODES,
    "Slice 3 preflight blocker order is invalid.",
  );
  exact(
    value.acceptance?.map(({ id }) => id),
    SLICE3_ACCEPTANCE_IDS,
    "Slice 3 acceptance identities are incomplete or reordered.",
  );
  if (
    value.acceptance.filter(({ status }) => status === "REPOSITORY_PASS")
      .length !== 19 ||
    value.acceptance.filter(({ status }) => status === "BLOCKED").length !==
      2 ||
    value.acceptance.filter(({ status }) => status === "PENDING").length !== 3
  )
    throw new Error("Slice 3 acceptance lifecycle counts are invalid.");
  const audits = value.independentAudits;
  exact(
    audits?.map(({ id }) => id),
    SLICE3_AUDIT_IDS,
    "Slice 3 audits are incomplete or reordered.",
  );
  for (const audit of audits) {
    exact(
      Object.keys(audit).sort(),
      ["critical", "id", "major", "minor", "status"],
      `Slice 3 audit ${audit.id} has unknown or missing fields.`,
    );
    if (
      !["PENDING", "PASS"].includes(audit.status) ||
      ![audit.critical, audit.major, audit.minor].every(
        (count) => Number.isInteger(count) && count === 0,
      )
    )
      throw new Error(`Slice 3 audit ${audit.id} disposition is invalid.`);
  }
  const disciplineStatuses = audits.slice(0, 6).map(({ status }) => status);
  if (!disciplineStatuses.every((status) => status === disciplineStatuses[0]))
    throw new Error(
      "Slice 3 discipline audit lifecycle is partially advanced.",
    );
  if (audits[6].status === "PASS" && disciplineStatuses[0] !== "PASS")
    throw new Error(
      "Slice 3 critic cannot pass before all six discipline audits.",
    );
  return value;
}

export function slice3EvidenceSourceRef(path, bytes, evidence) {
  return {
    sourceId: "matchbase://slice3/local-validation.json",
    path,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    observedAt: evidence.observedAt,
  };
}

export function validateSlice3Governance(gates, evidence) {
  validateSlice3Evidence(evidence);
  const disciplinePassed = evidence.independentAudits
    .slice(0, 6)
    .every(({ status }) => status === "PASS");
  const criticPassed = evidence.independentAudits[6].status === "PASS";
  const g2 = gates.find(({ id }) => id === "S3-G2");
  const g6 = gates.find(({ id }) => id === "S3-G6");
  if (g2?.status !== (disciplinePassed ? "PASS" : "PENDING"))
    throw new Error("Slice 3 G2 governed lifecycle is stale.");
  if (g6?.status !== (criticPassed ? "PASS" : "PENDING"))
    throw new Error("Slice 3 G6 governed lifecycle is stale.");
  if (disciplinePassed && !g2.summary?.includes("pass with zero findings"))
    throw new Error("Slice 3 G2 governed summary is stale.");
  if (
    disciplinePassed &&
    !criticPassed &&
    !g6.summary?.includes("critic remains pending")
  )
    throw new Error("Slice 3 G6 governed summary is stale.");
}

function acceptanceStatus(status) {
  if (status === "REPOSITORY_PASS") return "PASS";
  if (status === "BLOCKED") return "BLOCKED";
  return "ACTIVE";
}

function projectedAcceptanceStatus(
  item,
  criticPassed,
  repositoryReleaseClosed,
) {
  if (item.id === "S3-AC-022" && criticPassed) return "REPOSITORY_PASS";
  if (item.id === "S3-AC-023" && repositoryReleaseClosed)
    return "REPOSITORY_PASS";
  return item.status;
}

export function applySlice3DashboardProjection(
  views,
  evidence,
  sourceRef,
  { repositoryReleaseClosed = false } = {},
) {
  validateSlice3Evidence(evidence);
  const disciplinePassed = evidence.independentAudits
    .slice(0, 6)
    .every(({ status }) => status === "PASS");
  const criticPassed = evidence.independentAudits[6].status === "PASS";
  for (const gate of views.gates.records.filter(({ id }) =>
    /^S3-G[0-7]$/u.test(id),
  )) {
    gate.sourceRefs = [sourceRef];
    gate.facts = { ...gate.facts, evidenceIntegrity: "VERIFIED" };
    if (gate.id === "S3-G2") {
      gate.status = disciplinePassed ? "PASS" : "ACTIVE";
      gate.facts.lifecycleStatus = disciplinePassed ? "PASS" : "PENDING";
      gate.summary = disciplinePassed
        ? "Six repository-implementation audits pass with zero findings on the current evidence lifecycle."
        : "Six repository-implementation audits are pending on the current evidence lifecycle.";
    }
    if (gate.id === "S3-G6") {
      gate.status = criticPassed ? "PASS" : "ACTIVE";
      gate.facts.lifecycleStatus = criticPassed ? "PASS" : "PENDING";
      gate.summary = criticPassed
        ? "The final integration critic passes with zero findings."
        : disciplinePassed
          ? "Six repository audits pass; the final integration critic remains pending."
          : "The final integration critic remains pending until six repository audits pass.";
    }
  }
  const ids = new Set(views.tests.records.map(({ id }) => id));
  for (const item of evidence.acceptance) {
    const projectedStatus = projectedAcceptanceStatus(
      item,
      criticPassed,
      repositoryReleaseClosed,
    );
    const projected = {
      id: item.id,
      title: `Slice 3 acceptance ${item.id}`,
      summary: `${projectedStatus}; governed by ${item.gateId}.`,
      status: acceptanceStatus(projectedStatus),
      facts: {
        acceptanceStatus: projectedStatus,
        gateId: item.gateId,
        evidenceIntegrity: "VERIFIED",
      },
      sourceRefs: [sourceRef],
    };
    const index = views.tests.records.findIndex(({ id }) => id === item.id);
    if (index >= 0) views.tests.records[index] = projected;
    else {
      if (ids.has(item.id))
        throw new Error(`Duplicate Slice 3 acceptance record: ${item.id}`);
      views.tests.records.push(projected);
      ids.add(item.id);
    }
  }
  for (const audit of evidence.independentAudits) {
    const id = auditRecordId(audit.id);
    const projected = {
      id,
      title: `Slice 3 audit ${audit.id}`,
      summary: `${audit.status}; C${audit.critical}/M${audit.major}/m${audit.minor}.`,
      status: audit.status === "PASS" ? "PASS" : "ACTIVE",
      facts: {
        auditId: audit.id,
        auditStatus: audit.status,
        critical: audit.critical,
        major: audit.major,
        minor: audit.minor,
        evidenceIntegrity: "VERIFIED",
      },
      sourceRefs: [sourceRef],
    };
    const index = views.evidence.records.findIndex(
      ({ id: candidate }) => candidate === id,
    );
    if (index >= 0) views.evidence.records[index] = projected;
    else views.evidence.records.push(projected);
  }
  return views;
}

function exactRef(actual, expected) {
  return (
    actual?.sourceId === expected.sourceId &&
    actual?.path === expected.path &&
    actual?.sha256 === expected.sha256 &&
    actual?.observedAt === expected.observedAt
  );
}

export function validateSlice3Dashboard(
  views,
  evidence,
  sourceRef,
  { repositoryReleaseClosed = false, handoffProjected = false } = {},
) {
  validateSlice3Evidence(evidence);
  const disciplinePassed = evidence.independentAudits
    .slice(0, 6)
    .every(({ status }) => status === "PASS");
  const criticPassed = evidence.independentAudits[6].status === "PASS";
  for (const gateId of Array.from(
    { length: 8 },
    (_, index) => `S3-G${index}`,
  )) {
    if (handoffProjected && gateId === "S3-G5") continue;
    const records = views.gates.records.filter(({ id }) => id === gateId);
    if (
      records.length !== 1 ||
      records[0].facts?.evidenceIntegrity !== "VERIFIED" ||
      !exactRef(records[0].sourceRefs?.[0], sourceRef)
    )
      throw new Error(
        `Slice 3 gate ${gateId} is missing exact verified evidence.`,
      );
  }
  const g2 = views.gates.records.find(({ id }) => id === "S3-G2");
  const g6 = views.gates.records.find(({ id }) => id === "S3-G6");
  if (g2.status !== (disciplinePassed ? "PASS" : "ACTIVE"))
    throw new Error("Slice 3 G2 audit lifecycle is stale.");
  if (g6.status !== (criticPassed ? "PASS" : "ACTIVE"))
    throw new Error("Slice 3 G6 critic lifecycle is stale.");
  for (const item of evidence.acceptance) {
    const projectedStatus = projectedAcceptanceStatus(
      item,
      criticPassed,
      repositoryReleaseClosed,
    );
    const records = views.tests.records.filter(({ id }) => id === item.id);
    if (
      records.length !== 1 ||
      records[0].status !== acceptanceStatus(projectedStatus) ||
      records[0].facts?.acceptanceStatus !== projectedStatus ||
      records[0].facts?.gateId !== item.gateId ||
      records[0].facts?.evidenceIntegrity !== "VERIFIED" ||
      records[0].sourceRefs?.length !== 1 ||
      !exactRef(records[0].sourceRefs[0], sourceRef)
    )
      throw new Error(
        `Slice 3 acceptance record is missing or stale: ${item.id}`,
      );
  }
  for (const audit of evidence.independentAudits) {
    const id = auditRecordId(audit.id);
    const records = views.evidence.records.filter(
      ({ id: candidate }) => candidate === id,
    );
    if (
      records.length !== 1 ||
      records[0].facts?.auditStatus !== audit.status ||
      records[0].facts?.evidenceIntegrity !== "VERIFIED" ||
      records[0].sourceRefs?.length !== 1 ||
      !exactRef(records[0].sourceRefs[0], sourceRef)
    )
      throw new Error(`Slice 3 audit record is missing or stale: ${audit.id}`);
  }
  const slice3Records = Object.values(views)
    .flatMap(({ records }) => records)
    .filter(({ id }) => id.startsWith("S3-"));
  if (slice3Records.some(({ facts }) => facts?.evidenceIntegrity === "ERROR"))
    throw new Error("Slice 3 dashboard contains ERROR evidence integrity.");
}

export function assertSnapshotByteParity(publicBytes, distBytes) {
  if (!Buffer.from(publicBytes).equals(Buffer.from(distBytes)))
    throw new Error("Public and dist current snapshot bytes diverge.");
}
