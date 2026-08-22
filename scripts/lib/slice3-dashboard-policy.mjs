import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

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
export const SLICE3_BLOCKER_CODES = ["BLOCKED_CREDENTIAL"];
export const SLICE3_ROLE2_DEFECTS = ["D001", "D002", "D003", "D004"].map(
  (id) => ({ id, status: "CORRECTED_PENDING_ROLE2" }),
);
export const SLICE3_LIFECYCLE_PHASES = ["DURING_REVIEW", "POST_REVIEW_CURRENT"];
const CANDIDATE_STATUS_BY_PHASE = {
  DURING_REVIEW: "LOCAL_REPOSITORY_IMPLEMENTATION_FROZEN_LIVE_BLOCKED",
  POST_REVIEW_CURRENT:
    "REPOSITORY_IMPLEMENTATION_POST_REVIEW_CURRENT_LIVE_BLOCKED",
};
const SLICE3_MANAGEMENT_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";

const exact = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message);
};
const closed = (value, keys, message) => {
  exact(Object.keys(value ?? {}).sort(), [...keys].sort(), message);
};
const auditRecordId = (id) =>
  `S3-AUDIT-${id.toUpperCase().replaceAll("_", "-")}`;

export function verifySlice3CredentialPreflightSource(
  sourceBinding,
  {
    anchorOnly = false,
    ci = process.env.CI === "true",
    sourceResolver,
    sourceRoot = SLICE3_MANAGEMENT_ROOT,
  } = {},
) {
  if (anchorOnly) {
    if (!ci)
      throw new Error(
        "Slice 3 credential source ANCHOR_ONLY_CI requires an explicit CI runner.",
      );
    return sourceBinding;
  }
  const resolvedSource = sourceResolver
    ? sourceResolver(sourceBinding.path)
    : sourceBinding.path;
  const rootReal = realpathSync(sourceRoot);
  const sourceStat = lstatSync(resolvedSource);
  const sourceReal = realpathSync(resolvedSource);
  const difference = relative(rootReal, sourceReal);
  if (
    sourceStat.isSymbolicLink() ||
    !sourceStat.isFile() ||
    difference === "" ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference) ||
    resolve(rootReal, difference) !== sourceReal ||
    createHash("sha256")
      .update(readFileSync(sourceReal))
      .digest("hex")
      .toUpperCase() !== sourceBinding.sha256
  )
    throw new Error(
      "Slice 3 credential preflight external source drifted or escaped containment.",
    );
  return sourceBinding;
}

const zeroAudit = (audit, expectedId, expectedStatus, label) => {
  closed(
    audit,
    ["id", "status", "critical", "major", "minor"],
    `${label} has unknown or missing fields.`,
  );
  if (
    audit.id !== expectedId ||
    audit.status !== expectedStatus ||
    ![audit.critical, audit.major, audit.minor].every(
      (count) => Number.isInteger(count) && count === 0,
    )
  )
    throw new Error(`${label} disposition is invalid.`);
};

const candidateIdentity = (candidate) => ({
  manifestSha256: candidate?.manifestSha256,
  aggregateSha256: candidate?.aggregateSha256,
  fileCount: candidate?.fileCount,
});

function validatePostReview(value, evidence) {
  closed(
    value,
    [
      "schemaVersion",
      "observedAt",
      "candidate",
      "wrapperSource",
      "disciplines",
      "integrationCritic",
      "repositoryDisposition",
      "slice3Overall",
      "role2Status",
      "acceptanceClaimed",
      "providerCalls",
      "externalMutations",
    ],
    "Slice 3 post-review object is not closed.",
  );
  closed(
    value?.candidate,
    ["manifestSha256", "aggregateSha256", "fileCount"],
    "Slice 3 post-review candidate is not closed.",
  );
  closed(
    value?.wrapperSource,
    ["path", "sha256"],
    "Slice 3 post-review wrapper source is not closed.",
  );
  const observedAtMs = Date.parse(value?.observedAt ?? "");
  if (
    value?.schemaVersion !== "matchbase.slice3-post-review/v1" ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs < Date.parse(evidence.localGate.fullWrapper.observedAt) ||
    observedAtMs > Date.parse(evidence.observedAt) ||
    JSON.stringify(value.candidate) !==
      JSON.stringify(candidateIdentity(evidence.candidate)) ||
    JSON.stringify(value.wrapperSource) !==
      JSON.stringify(evidence.localGate.fullWrapper.sourceRef) ||
    evidence.localGate.fullWrapper.result !== "PASS" ||
    value.repositoryDisposition !== "READY_FOR_REPOSITORY_RELEASE" ||
    value.slice3Overall !== "BLOCKED_PREREQUISITE" ||
    value.role2Status !== "FAIL" ||
    value.acceptanceClaimed !== false ||
    value.providerCalls !== 0 ||
    value.externalMutations !== 0
  )
    throw new Error(
      "Slice 3 post-review lifecycle or source binding is invalid.",
    );
  exact(
    value.disciplines?.map(({ id }) => id),
    SLICE3_AUDIT_IDS.slice(0, 6),
    "Slice 3 post-review disciplines are incomplete or reordered.",
  );
  value.disciplines.forEach((audit, index) =>
    zeroAudit(
      audit,
      SLICE3_AUDIT_IDS[index],
      "PASS",
      `Slice 3 post-review discipline ${index}`,
    ),
  );
  closed(
    value.integrationCritic,
    ["status", "critical", "major", "minor"],
    "Slice 3 post-review critic is not closed.",
  );
  if (
    value.integrationCritic.status !== "PASS" ||
    ![
      value.integrationCritic.critical,
      value.integrationCritic.major,
      value.integrationCritic.minor,
    ].every((count) => Number.isInteger(count) && count === 0)
  )
    throw new Error("Slice 3 post-review critic disposition is invalid.");
}

function validateHistoricalLifecycle(value, postReview) {
  closed(
    value,
    [
      "schemaVersion",
      "phase",
      "observedAt",
      "current",
      "supersededBy",
      "audits",
      "gates",
      "acceptance",
    ],
    "Slice 3 historical lifecycle is not closed.",
  );
  if (
    value?.schemaVersion !== "matchbase.slice3-during-review-history/v1" ||
    value.phase !== "DURING_REVIEW_PENDING" ||
    value.current !== false ||
    value.supersededBy !== "postReview" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    Date.parse(value.observedAt) >= Date.parse(postReview.observedAt)
  )
    throw new Error("Slice 3 historical lifecycle phase is invalid.");
  exact(
    value.audits?.map(({ id }) => id),
    SLICE3_AUDIT_IDS,
    "Slice 3 historical audits are incomplete or reordered.",
  );
  value.audits.forEach((audit, index) =>
    zeroAudit(
      audit,
      SLICE3_AUDIT_IDS[index],
      "PENDING",
      `Slice 3 historical audit ${index}`,
    ),
  );
  exact(
    value.gates,
    [
      { id: "S3-G2", status: "PENDING" },
      { id: "S3-G6", status: "PENDING" },
    ],
    "Slice 3 historical gate lifecycle is invalid.",
  );
  exact(
    value.acceptance,
    [{ id: "S3-AC-022", status: "PENDING" }],
    "Slice 3 historical acceptance lifecycle is invalid.",
  );
}

export function validateSlice3Evidence(value, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 60_000;
  const observedAtMs = Date.parse(value?.observedAt ?? "");
  if (!Number.isFinite(observedAtMs) || observedAtMs > nowMs + maxFutureSkewMs)
    throw new Error("Slice 3 observedAt is invalid or in the future.");
  closed(
    value,
    [
      "schemaVersion",
      "slice",
      "observedAt",
      "lifecyclePhase",
      "candidateStatus",
      "repositoryImplementation",
      "liveQualification",
      "blockerCodes",
      "qualificationPreflight",
      "environment",
      "candidate",
      "localGate",
      "acceptance",
      "artifacts",
      "independentAudits",
      ...(value?.lifecyclePhase === "POST_REVIEW_CURRENT"
        ? ["historicalLifecycle", "postReview"]
        : []),
      "role2",
    ],
    "Slice 3 evidence top-level object is not closed.",
  );
  if (
    value?.schemaVersion !== 2 ||
    value?.slice !== "SLICE-3" ||
    !SLICE3_LIFECYCLE_PHASES.includes(value.lifecyclePhase) ||
    value.candidateStatus !== CANDIDATE_STATUS_BY_PHASE[value.lifecyclePhase] ||
    value?.repositoryImplementation !== "PASS" ||
    value?.liveQualification !== "BLOCKED_PREREQUISITE" ||
    value?.role2?.status !== "FAIL" ||
    value?.role2?.acceptanceClaimed !== false ||
    value?.qualificationPreflight?.providerCalls !== 0 ||
    value?.qualificationPreflight?.externalMutations !== 0 ||
    value?.environment?.providerNetworkCalls !== 0
  )
    throw new Error("Slice 3 lifecycle evidence is invalid.");
  closed(
    value.role2,
    ["status", "acceptanceClaimed", "defects"],
    "Slice 3 Role 2 lifecycle is not closed.",
  );
  value.role2.defects?.forEach((defect, index) =>
    closed(
      defect,
      ["id", "status"],
      `Slice 3 Role 2 defect ${index} is not closed.`,
    ),
  );
  exact(
    value.role2.defects,
    SLICE3_ROLE2_DEFECTS,
    "Slice 3 Role 2 correction lifecycle is invalid.",
  );
  value.acceptance?.forEach((item, index) =>
    closed(
      item,
      ["id", "status", "gateId", "artifactIds"],
      `Slice 3 acceptance ${index} is not closed.`,
    ),
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
  closed(
    value.qualificationPreflight,
    [
      "schemaVersion",
      "disposition",
      "blockers",
      "sourceBinding",
      "providerCalls",
      "credentialValuesInspected",
      "additionalAuthorizationGets",
      "v4SessionCreated",
      "v5SessionCreated",
      "v5Admission",
      "externalMutations",
    ],
    "Slice 3 qualification preflight is not closed.",
  );
  closed(
    value.qualificationPreflight.sourceBinding,
    [
      "path",
      "verificationMode",
      "sha256",
      "httpStatus",
      "sanitizedEnvelopeDigest",
    ],
    "Slice 3 qualification preflight source binding is not closed.",
  );
  closed(
    value.qualificationPreflight.v5Admission,
    [
      "ownerDecision",
      "role2Allocation",
      "role2SigningRevocation",
      "role2TpmAuthority",
      "role2PublicKeyPinned",
      "reason",
      "executable",
      "credentialGets",
      "maxCredentialGets",
      "modelPosts",
      "searchCalls",
      "activation",
    ],
    "Slice 3 V5 admission is not closed.",
  );
  for (const [label, source] of Object.entries({
    ownerDecision: value.qualificationPreflight.v5Admission.ownerDecision,
    role2Allocation: value.qualificationPreflight.v5Admission.role2Allocation,
    role2SigningRevocation:
      value.qualificationPreflight.v5Admission.role2SigningRevocation,
    publicPem:
      value.qualificationPreflight.v5Admission.role2TpmAuthority.publicPem,
    publicCer:
      value.qualificationPreflight.v5Admission.role2TpmAuthority.publicCer,
    payloadSchema:
      value.qualificationPreflight.v5Admission.role2TpmAuthority.payloadSchema,
    signingContract:
      value.qualificationPreflight.v5Admission.role2TpmAuthority
        .signingContract,
    supersession:
      value.qualificationPreflight.v5Admission.role2TpmAuthority.supersession,
    custody: value.qualificationPreflight.v5Admission.role2TpmAuthority.custody,
    transition:
      value.qualificationPreflight.v5Admission.role2TpmAuthority.transition,
    replayInitialization:
      value.qualificationPreflight.v5Admission.role2TpmAuthority
        .replayInitialization,
    replayRegistry:
      value.qualificationPreflight.v5Admission.role2TpmAuthority.replayRegistry,
  }))
    closed(
      source,
      ["path", "sha256"],
      `Slice 3 V5 ${label} source is not closed.`,
    );
  closed(
    value.qualificationPreflight.v5Admission.role2TpmAuthority,
    [
      "keyId",
      "publicPem",
      "publicCer",
      "payloadSchema",
      "signingContract",
      "supersession",
      "custody",
      "transition",
      "replayInitialization",
      "replayRegistry",
    ],
    "Slice 3 V5 TPM authority is not closed.",
  );
  if (
    value.qualificationPreflight.schemaVersion !==
      "slice3-live-qualification-preflight.v5-pre-execution-pending" ||
    value.qualificationPreflight.disposition !== "PRE_EXECUTION_PENDING" ||
    value.qualificationPreflight.sourceBinding.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json" ||
    value.qualificationPreflight.sourceBinding.verificationMode !==
      "EXACT_LOCAL_SHA256_OR_ANCHOR_ONLY_CI" ||
    value.qualificationPreflight.sourceBinding.sha256 !==
      "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08" ||
    value.qualificationPreflight.sourceBinding.httpStatus !== 401 ||
    value.qualificationPreflight.sourceBinding.sanitizedEnvelopeDigest !==
      "8CF8991C0372D72CEB99F18D9187DA4FB55E022D9BE264F02DB9BB0BB6EBF508" ||
    value.qualificationPreflight.credentialValuesInspected !== false ||
    value.qualificationPreflight.additionalAuthorizationGets !== 0 ||
    value.qualificationPreflight.v4SessionCreated !== false ||
    value.qualificationPreflight.v5SessionCreated !== false ||
    value.qualificationPreflight.v5Admission.ownerDecision.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DECISION_PO_001_SLICE_3_V5_ONE_GET_2026-08-22.md" ||
    value.qualificationPreflight.v5Admission.ownerDecision.sha256 !==
      "7B9DC0E27F2DA3B0E20ED2A4220DFE26AA95B76FA4EC1B37D9B559AE3D0AD916" ||
    value.qualificationPreflight.v5Admission.role2Allocation.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_ALLOCATION_PO_001_SLICE_3_V5_ONE_GET_PRE_EXECUTION_PENDING.md" ||
    value.qualificationPreflight.v5Admission.role2Allocation.sha256 !==
      "484B8F82E08E97CBC40CA0E01115D735FA0446FB19D093DE06F41691CCF1C0C6" ||
    value.qualificationPreflight.v5Admission.role2SigningRevocation.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_ED25519_REVOCATION.md" ||
    value.qualificationPreflight.v5Admission.role2SigningRevocation.sha256 !==
      "D38D03154C6C87576DEED07EB97A3557271D47E79EE4227D7005CFE7140A1665" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.keyId !==
      "ROLE2-PO001-S3-V5-TPM-ECDSA-P256-0AED3F3F66C077CB" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.publicPem
      .sha256 !==
      "5897804885924CE5499494F9D00471A6B1D918671B6D17F7206C6007AFCDF1E4" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.publicCer
      .sha256 !==
      "5674E94E9D2F27AC16D9F0C793D6222F67C4EE4FFEDA0B10D2F9A09D50F99CFB" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.payloadSchema
      .sha256 !==
      "B9F704789FC30F368D8F297A9A5B18E0F5CDD7CBB6CFBD4486AFC746EFC2A68F" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.signingContract
      .sha256 !==
      "5865910AE5BE6A9E034B8C13BD4F718B3F845156E1E17172A8CC30194E09DDF1" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.supersession
      .sha256 !==
      "E15A8DA74FD84AA758C05B65D84935554AAFEF4DC71C479AF26D0248B650B90E" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.custody
      .sha256 !==
      "2E0FF67F9D7E0E9524B101F0EF3BB35B13F788D2FE035A113418031B0B1FD5C1" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.transition
      .sha256 !==
      "0967EE2C5AB9C7E7779F3E8AD2C2B1EF2AE528B6BC0CD54B7A7955A00246E911" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority
      .replayInitialization.sha256 !==
      "DF6F2B352BCE80ECC1B4BCFDC70041B3015E4866C5494A00F3DF94DF116EA146" ||
    value.qualificationPreflight.v5Admission.role2TpmAuthority.replayRegistry
      .sha256 !==
      "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" ||
    value.qualificationPreflight.v5Admission.role2PublicKeyPinned !== true ||
    value.qualificationPreflight.v5Admission.reason !==
      "ROLE2_ACCEPTANCE_PAYLOAD_ABSENT" ||
    value.qualificationPreflight.v5Admission.executable !== false ||
    value.qualificationPreflight.v5Admission.credentialGets !== 0 ||
    value.qualificationPreflight.v5Admission.maxCredentialGets !== 1 ||
    value.qualificationPreflight.v5Admission.modelPosts !== 0 ||
    value.qualificationPreflight.v5Admission.searchCalls !== 0 ||
    value.qualificationPreflight.v5Admission.activation !== false ||
    value.localGate?.status !== value.localGate?.fullWrapper?.result ||
    !["PENDING", "PASS"].includes(value.localGate?.status)
  )
    throw new Error(
      "Slice 3 credential blocker or wrapper lifecycle is stale.",
    );
  exact(
    value.acceptance?.map(({ id }) => id),
    SLICE3_ACCEPTANCE_IDS,
    "Slice 3 acceptance identities are incomplete or reordered.",
  );
  const postReviewCurrent = value.lifecyclePhase === "POST_REVIEW_CURRENT";
  const expectedRepositoryPass = postReviewCurrent ? 20 : 19;
  const expectedPending = postReviewCurrent ? 2 : 3;
  if (
    value.acceptance.filter(({ status }) => status === "REPOSITORY_PASS")
      .length !== expectedRepositoryPass ||
    value.acceptance.filter(({ status }) => status === "BLOCKED").length !==
      2 ||
    value.acceptance.filter(({ status }) => status === "PENDING").length !==
      expectedPending ||
    value.acceptance.find(({ id }) => id === "S3-AC-003")?.status !==
      "BLOCKED" ||
    value.acceptance.find(({ id }) => id === "S3-AC-019")?.status !==
      "BLOCKED" ||
    value.acceptance.find(({ id }) => id === "S3-AC-022")?.status !==
      (postReviewCurrent ? "REPOSITORY_PASS" : "PENDING") ||
    value.acceptance.find(({ id }) => id === "S3-AC-023")?.status !==
      "PENDING" ||
    value.acceptance.find(({ id }) => id === "S3-AC-024")?.status !== "PENDING"
  )
    throw new Error("Slice 3 acceptance lifecycle counts are invalid.");
  const audits = value.independentAudits;
  exact(
    audits?.map(({ id }) => id),
    SLICE3_AUDIT_IDS,
    "Slice 3 audits are incomplete or reordered.",
  );
  const expectedStatus =
    value.lifecyclePhase === "POST_REVIEW_CURRENT" ? "PASS" : "PENDING";
  audits.forEach((audit, index) =>
    zeroAudit(
      audit,
      SLICE3_AUDIT_IDS[index],
      expectedStatus,
      `Slice 3 current audit ${index}`,
    ),
  );
  if (value.lifecyclePhase === "POST_REVIEW_CURRENT") {
    validatePostReview(value.postReview, value);
    validateHistoricalLifecycle(value.historicalLifecycle, value.postReview);
    exact(
      audits.slice(0, 6),
      value.postReview.disciplines,
      "Slice 3 current disciplines contradict post-review authority.",
    );
    exact(
      audits[6],
      { id: "integration_critic", ...value.postReview.integrationCritic },
      "Slice 3 current critic contradicts post-review authority.",
    );
  }
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
  const terminalCurrent = evidence.lifecyclePhase === "POST_REVIEW_CURRENT";
  if (
    g2?.status !== (disciplinePassed ? "PASS" : "PENDING") &&
    !(terminalCurrent && g2?.status === "PENDING")
  )
    throw new Error("Slice 3 G2 governed lifecycle is stale.");
  if (
    g6?.status !== (criticPassed ? "PASS" : "PENDING") &&
    !(terminalCurrent && g6?.status === "PENDING")
  )
    throw new Error("Slice 3 G6 governed lifecycle is stale.");
  if (
    disciplinePassed &&
    g2?.status === "PASS" &&
    !g2.summary?.includes("pass with zero findings")
  )
    throw new Error("Slice 3 G2 governed summary is stale.");
  if (
    disciplinePassed &&
    !criticPassed &&
    !g6.summary?.includes("critic remains pending")
  )
    throw new Error("Slice 3 G6 governed summary is stale.");
  if (
    terminalCurrent &&
    (g2?.status === "PENDING" || g6?.status === "PENDING") &&
    ![g2, g6].every(({ summary }) =>
      summary?.toLowerCase().includes("base/pre-release"),
    )
  )
    throw new Error(
      "Slice 3 base governance is not explicitly separated from current post-review lifecycle.",
    );
}

function acceptanceStatus(status) {
  if (status === "REPOSITORY_PASS") return "PASS";
  if (status === "BLOCKED") return "BLOCKED";
  return "ACTIVE";
}

function projectedAcceptanceStatus(item, criticPassed) {
  if (item.id === "S3-AC-022" && criticPassed) return "REPOSITORY_PASS";
  return item.status;
}

export function applySlice3DashboardProjection(
  views,
  evidence,
  sourceRef,
  { repositoryReleaseClosed = false } = {},
) {
  validateSlice3Evidence(evidence);
  if (repositoryReleaseClosed)
    throw new Error(
      "Base Slice 3 projection cannot close repository release; use the source-bound handoff projection.",
    );
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
    const projectedStatus = projectedAcceptanceStatus(item, criticPassed);
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
  if (evidence.lifecyclePhase === "POST_REVIEW_CURRENT") {
    const historical = {
      id: "S3-HISTORICAL-DURING-REVIEW",
      title: "Slice 3 historical during-review lifecycle",
      summary:
        "Historical PENDING phase superseded by the source-bound post-review authority; excluded from current gate and acceptance counts.",
      status: "PASS",
      facts: {
        phase: evidence.historicalLifecycle.phase,
        observedAt: evidence.historicalLifecycle.observedAt,
        current: false,
        supersededBy: "postReview",
        currentGateCounted: false,
        currentAcceptanceCounted: false,
        evidenceIntegrity: "VERIFIED",
      },
      sourceRefs: [sourceRef],
    };
    const index = views.evidence.records.findIndex(
      ({ id }) => id === historical.id,
    );
    if (index >= 0) views.evidence.records[index] = historical;
    else views.evidence.records.push(historical);
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
  if (repositoryReleaseClosed)
    throw new Error(
      "Base Slice 3 dashboard cannot close repository release; use the source-bound handoff projection.",
    );
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
    const projectedStatus = projectedAcceptanceStatus(item, criticPassed);
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
      records[0].status !== (audit.status === "PASS" ? "PASS" : "ACTIVE") ||
      records[0].facts?.auditStatus !== audit.status ||
      records[0].facts?.critical !== audit.critical ||
      records[0].facts?.major !== audit.major ||
      records[0].facts?.minor !== audit.minor ||
      records[0].facts?.evidenceIntegrity !== "VERIFIED" ||
      records[0].sourceRefs?.length !== 1 ||
      !exactRef(records[0].sourceRefs[0], sourceRef)
    )
      throw new Error(`Slice 3 audit record is missing or stale: ${audit.id}`);
  }
  exact(
    views.evidence.records
      .filter(({ id }) => id.startsWith("S3-AUDIT-"))
      .map(({ facts }) => facts.auditId),
    SLICE3_AUDIT_IDS,
    "Slice 3 dashboard audits are reordered or substituted.",
  );
  if (evidence.lifecyclePhase === "POST_REVIEW_CURRENT") {
    const historical = views.evidence.records.filter(
      ({ id }) => id === "S3-HISTORICAL-DURING-REVIEW",
    );
    if (
      historical.length !== 1 ||
      historical[0].status !== "PASS" ||
      historical[0].facts?.phase !== "DURING_REVIEW_PENDING" ||
      historical[0].facts?.current !== false ||
      historical[0].facts?.supersededBy !== "postReview" ||
      historical[0].facts?.currentGateCounted !== false ||
      historical[0].facts?.currentAcceptanceCounted !== false ||
      historical[0].facts?.evidenceIntegrity !== "VERIFIED" ||
      historical[0].sourceRefs?.length !== 1 ||
      !exactRef(historical[0].sourceRefs[0], sourceRef)
    )
      throw new Error(
        "Slice 3 historical during-review dashboard record is missing or current.",
      );
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
