import {
  COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
  CONSULTANT_UNAVAILABLE_SOURCES,
  CONSULTANT_UNAVAILABLE_SOURCE_IDS,
  type CompleteResultFoundationV1,
  type ConsultantProjectionReadinessV1,
  type ConsultantUnavailableSourceId,
  type ConsultantUnavailableSourceLedgerV1,
  type StandardClaimV1,
  type StandardEvidenceGraphV1,
  type StandardEvidenceItemV1,
  type StandardEvidencedValueV1,
  type StandardGateEvaluationV1,
  type StandardHiddenCandidateV1,
} from "@matchbase/contracts";
import { validateStandardEvidenceGraph } from "../evidence/standard.js";

export {
  COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
  CONSULTANT_REQUIRED_SOURCE_IDS,
  CONSULTANT_UNAVAILABLE_SOURCES,
  CONSULTANT_UNAVAILABLE_SOURCE_IDS,
} from "@matchbase/contracts";
export type {
  CompleteResultFoundationV1,
  ConsultantProjectionReadinessV1,
  ConsultantRequiredSourceId,
  ConsultantUnavailableSourceId,
  ConsultantUnavailableSourceLedgerV1,
  ConsultantUnavailableSourceV1,
} from "@matchbase/contracts";

const TOP_LEVEL_KEYS = [
  "schema_version",
  "run_id",
  "candidates",
  "claims",
  "evidence",
  "evidenced_values",
  "eligible_candidate_ids",
  "gate_evaluations",
  "unknown_count",
  "not_asked_count",
  "gate_evaluation_completed_at",
] as const;
const FOUNDATION_TOP_LEVEL_KEYS = [
  ...TOP_LEVEL_KEYS,
  "consultant_projection_readiness",
] as const;
const CANDIDATE_KEYS = [
  "candidate_id",
  "display_name",
  "country_code",
  "rationale_extended",
  "rationale_claim_ids",
  "mandatory_constraints_satisfied",
  "failed_constraint_ids",
  "dimensions",
  "verification_status",
  "evidence_confidence",
  "deterministic_tie_breaker",
] as const;
const DIMENSION_KEYS = [
  "dimension_id",
  "weight",
  "score",
  "confidence",
] as const;
const CLAIM_KEYS = [
  "claim_id",
  "candidate_id",
  "text",
  "decision_bearing",
  "high_risk",
  "verification_status",
  "evidence_confidence",
  "evidence_ids",
  "corroboration",
] as const;
const CORROBORATION_KEYS = [
  "required",
  "status",
  "independent_evidence_ids",
] as const;
const EVIDENCE_BASE_KEYS = [
  "evidence_id",
  "source_kind",
  "title",
  "publisher",
  "publisher_domain",
  "published_or_updated",
  "accessed_at",
  "source_tier",
  "verification_status",
  "access_state",
  "volatility_class",
  "extract",
  "content_sha256",
  "provenance",
  "verification_disposition",
] as const;
const EVIDENCED_VALUE_BASE_KEYS = [
  "value_id",
  "candidate_id",
  "kind",
  "value",
  "verification_status",
  "evidence_ids",
] as const;
const GATE_KEYS = ["gate_id", "label", "eliminated_count"] as const;
const VERIFICATION_STATUSES = [
  "claimed",
  "externally_verified",
  "inferred",
  "stale",
  "conflicting",
  "unknown",
] as const;
const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
const SOURCE_KINDS = [
  "synthetic_fixture",
  "local_fixture",
  "reserved_url",
] as const;
const SOURCE_TIERS = ["primary", "official_secondary", "secondary"] as const;
const ACCESS_STATES = ["available", "blocked", "unreachable"] as const;
const VOLATILITY_CLASSES = ["stable", "moderate", "volatile"] as const;
const PROVENANCE_VALUES = ["synthetic_fixture", "repository_fixture"] as const;
const CORROBORATION_STATUSES = [
  "not_required",
  "satisfied",
  "missing",
  "conflicting",
] as const;

function assertClosedKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0)
    throw new Error(
      `${label} contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length > 0)
    throw new Error(
      `${label} is missing required fields: ${missing.sort().join(", ")}.`,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is object {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
}

function assertString(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${label} must be an array of strings.`);
}

function assertBoolean(value: unknown, label: string): void {
  if (typeof value !== "boolean")
    throw new Error(`${label} must be a boolean.`);
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) < 0)
    throw new Error(`${label} must be a non-negative integer.`);
}

function assertEnum(
  value: unknown,
  allowed: readonly string[],
  label: string,
): void {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error(`${label} has an invalid value.`);
}

function assertClosedSharedGraph(graph: StandardEvidenceGraphV1): void {
  assertClosedKeys(graph, TOP_LEVEL_KEYS, "Complete-result source graph");
  assertString(graph.run_id, "Complete-result run_id");
  assertStringArray(
    graph.eligible_candidate_ids,
    "Complete-result eligible_candidate_ids",
  );
  assertNonNegativeInteger(
    graph.unknown_count,
    "Complete-result unknown_count",
  );
  assertNonNegativeInteger(
    graph.not_asked_count,
    "Complete-result not_asked_count",
  );
  assertString(
    graph.gate_evaluation_completed_at,
    "Complete-result gate_evaluation_completed_at",
  );
  if (
    !Array.isArray(graph.candidates) ||
    !Array.isArray(graph.claims) ||
    !Array.isArray(graph.evidence) ||
    !Array.isArray(graph.evidenced_values) ||
    !Array.isArray(graph.gate_evaluations)
  )
    throw new Error("Complete-result collections must be arrays.");
  for (const candidate of graph.candidates) {
    assertRecord(candidate, "Complete-result candidate");
    assertClosedKeys(candidate, CANDIDATE_KEYS, "Complete-result candidate");
    assertString(candidate.candidate_id, "Complete-result candidate_id");
    assertString(candidate.display_name, "Complete-result display_name");
    assertString(candidate.country_code, "Complete-result country_code");
    assertString(
      candidate.rationale_extended,
      "Complete-result rationale_extended",
    );
    assertStringArray(
      candidate.rationale_claim_ids,
      "Complete-result rationale_claim_ids",
    );
    assertBoolean(
      candidate.mandatory_constraints_satisfied,
      "Complete-result mandatory_constraints_satisfied",
    );
    assertStringArray(
      candidate.failed_constraint_ids,
      "Complete-result failed_constraint_ids",
    );
    assertEnum(
      candidate.verification_status,
      VERIFICATION_STATUSES,
      "Complete-result candidate verification_status",
    );
    assertEnum(
      candidate.evidence_confidence,
      CONFIDENCE_LEVELS,
      "Complete-result candidate evidence_confidence",
    );
    assertString(
      candidate.deterministic_tie_breaker,
      "Complete-result deterministic_tie_breaker",
    );
    if (!Array.isArray(candidate.dimensions))
      throw new Error("Complete-result dimensions must be an array.");
    for (const dimension of candidate.dimensions) {
      assertRecord(dimension, "Complete-result dimension");
      assertClosedKeys(dimension, DIMENSION_KEYS, "Complete-result dimension");
    }
  }
  for (const claim of graph.claims) {
    assertRecord(claim, "Complete-result claim");
    assertClosedKeys(claim, CLAIM_KEYS, "Complete-result claim");
    assertString(claim.claim_id, "Complete-result claim_id");
    assertString(claim.candidate_id, "Complete-result claim candidate_id");
    assertString(claim.text, "Complete-result claim text");
    assertBoolean(claim.decision_bearing, "Complete-result decision_bearing");
    assertBoolean(claim.high_risk, "Complete-result high_risk");
    assertEnum(
      claim.verification_status,
      VERIFICATION_STATUSES,
      "Complete-result claim verification_status",
    );
    assertEnum(
      claim.evidence_confidence,
      CONFIDENCE_LEVELS,
      "Complete-result claim evidence_confidence",
    );
    assertStringArray(claim.evidence_ids, "Complete-result claim evidence_ids");
    assertRecord(claim.corroboration, "Complete-result corroboration");
    assertClosedKeys(
      claim.corroboration,
      CORROBORATION_KEYS,
      "Complete-result corroboration",
    );
    assertBoolean(
      claim.corroboration.required,
      "Complete-result corroboration required",
    );
    assertEnum(
      claim.corroboration.status,
      CORROBORATION_STATUSES,
      "Complete-result corroboration status",
    );
    assertStringArray(
      claim.corroboration.independent_evidence_ids,
      "Complete-result corroboration evidence_ids",
    );
  }
  for (const evidence of graph.evidence) {
    assertRecord(evidence, "Complete-result evidence");
    const evidenceRecord = evidence as unknown as Record<string, unknown>;
    const locatorKey =
      "exact_url" in evidence ? "exact_url" : "fixture_identity";
    const dispositionKeys =
      evidence.verification_disposition === "excluded"
        ? ["exclusion_reason"]
        : [];
    assertClosedKeys(
      evidence,
      [...EVIDENCE_BASE_KEYS, locatorKey, ...dispositionKeys],
      "Complete-result evidence",
    );
    for (const field of [
      "evidence_id",
      locatorKey,
      "title",
      "publisher",
      "publisher_domain",
      "published_or_updated",
      "accessed_at",
      "extract",
      "content_sha256",
    ] as const)
      assertString(evidenceRecord[field], `Complete-result evidence ${field}`);
    assertEnum(
      evidence.source_kind,
      SOURCE_KINDS,
      "Complete-result evidence source_kind",
    );
    assertEnum(
      evidence.source_tier,
      SOURCE_TIERS,
      "Complete-result evidence source_tier",
    );
    assertEnum(
      evidence.verification_status,
      VERIFICATION_STATUSES,
      "Complete-result evidence verification_status",
    );
    assertEnum(
      evidence.access_state,
      ACCESS_STATES,
      "Complete-result evidence access_state",
    );
    assertEnum(
      evidence.volatility_class,
      VOLATILITY_CLASSES,
      "Complete-result evidence volatility_class",
    );
    assertEnum(
      evidence.provenance,
      PROVENANCE_VALUES,
      "Complete-result evidence provenance",
    );
    assertEnum(
      evidence.verification_disposition,
      ["accepted", "excluded"],
      "Complete-result evidence verification_disposition",
    );
    if (evidence.verification_disposition === "excluded")
      assertString(
        evidence.exclusion_reason,
        "Complete-result evidence exclusion_reason",
      );
  }
  for (const value of graph.evidenced_values) {
    assertRecord(value, "Complete-result evidenced value");
    const contactKeys =
      value.kind === "organization_contact"
        ? value.channel_type === "organization_web"
          ? [
              "channel_type",
              "organization_domain",
              "organization_web_policy_version",
              "organization_web_purpose",
              "organization_web_form",
            ]
          : ["channel_type", "organization_domain"]
        : [];
    assertClosedKeys(
      value,
      [...EVIDENCED_VALUE_BASE_KEYS, ...contactKeys],
      "Complete-result evidenced value",
    );
    assertString(value.value_id, "Complete-result value_id");
    assertString(value.candidate_id, "Complete-result value candidate_id");
    assertEnum(
      value.kind,
      ["organization_contact", "plant", "approval", "capacity"],
      "Complete-result value kind",
    );
    assertString(value.value, "Complete-result evidenced value");
    assertEnum(
      value.verification_status,
      VERIFICATION_STATUSES,
      "Complete-result value verification_status",
    );
    assertStringArray(value.evidence_ids, "Complete-result value evidence_ids");
  }
  for (const gate of graph.gate_evaluations) {
    assertRecord(gate, "Complete-result gate evaluation");
    assertClosedKeys(gate, GATE_KEYS, "Complete-result gate evaluation");
    assertString(gate.gate_id, "Complete-result gate_id");
    assertString(gate.label, "Complete-result gate label");
    assertNonNegativeInteger(
      gate.eliminated_count,
      "Complete-result gate eliminated_count",
    );
  }
}

function unavailableConsultantSources(): ConsultantUnavailableSourceLedgerV1 {
  return structuredClone(CONSULTANT_UNAVAILABLE_SOURCES);
}

function assertConsultantReadinessLedger(
  value: unknown,
): asserts value is ConsultantProjectionReadinessV1 {
  if (!isRecord(value))
    throw new Error("Complete-result foundation readiness is invalid.");
  assertClosedKeys(
    value,
    ["outcome", "missing_sources"],
    "Complete-result foundation readiness",
  );
  if (value.outcome !== "blocked" || !Array.isArray(value.missing_sources))
    throw new Error("Complete-result foundation readiness is invalid.");
  if (value.missing_sources.length !== CONSULTANT_UNAVAILABLE_SOURCE_IDS.length)
    throw new Error("Complete-result foundation source ledger is invalid.");
  value.missing_sources.forEach((item, index) => {
    if (!isRecord(item))
      throw new Error("Complete-result foundation source ledger is invalid.");
    assertClosedKeys(
      item,
      ["source_id", "status", "reason_code"],
      "Complete-result foundation source ledger item",
    );
    if (
      item.source_id !== CONSULTANT_UNAVAILABLE_SOURCE_IDS[index] ||
      item.status !== "unavailable" ||
      item.reason_code !== "not_produced_by_current_pipeline"
    )
      throw new Error("Complete-result foundation source ledger is invalid.");
  });
}

function sharedGraphFromFoundation(
  foundation: CompleteResultFoundationV1,
): StandardEvidenceGraphV1 {
  return {
    schema_version: "standard-evidence-graph.v1",
    run_id: foundation.run_id,
    candidates: structuredClone(
      foundation.candidates,
    ) as StandardHiddenCandidateV1[],
    claims: structuredClone(foundation.claims) as StandardClaimV1[],
    evidence: structuredClone(foundation.evidence) as StandardEvidenceItemV1[],
    evidenced_values: structuredClone(
      foundation.evidenced_values,
    ) as StandardEvidencedValueV1[],
    eligible_candidate_ids: [...foundation.eligible_candidate_ids],
    gate_evaluations: structuredClone(
      foundation.gate_evaluations,
    ) as StandardGateEvaluationV1[],
    unknown_count: foundation.unknown_count,
    not_asked_count: foundation.not_asked_count,
    gate_evaluation_completed_at: foundation.gate_evaluation_completed_at,
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

export class ConsultantProjectionSourceUnavailableError extends Error {
  readonly missingSourceIds: readonly ConsultantUnavailableSourceId[];

  constructor(missingSourceIds: readonly ConsultantUnavailableSourceId[]) {
    super("Consultant projection source material is unavailable.");
    this.name = "ConsultantProjectionSourceUnavailableError";
    this.missingSourceIds = Object.freeze([...missingSourceIds]);
  }
}

export function buildCompleteResultFoundation(
  graph: StandardEvidenceGraphV1,
): CompleteResultFoundationV1 {
  validateStandardEvidenceGraph(graph);
  assertClosedSharedGraph(graph);
  const source = structuredClone(graph);
  const foundation: CompleteResultFoundationV1 = {
    ...source,
    schema_version: COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
    consultant_projection_readiness: {
      outcome: "blocked",
      missing_sources: unavailableConsultantSources(),
    },
  };
  return deepFreeze(foundation);
}

export function validateCompleteResultFoundation(
  value: unknown,
): asserts value is CompleteResultFoundationV1 {
  if (!isRecord(value))
    throw new Error("Complete-result foundation must be an object.");
  assertClosedKeys(
    value,
    FOUNDATION_TOP_LEVEL_KEYS,
    "Complete-result foundation",
  );
  if (value.schema_version !== COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION)
    throw new Error("Complete-result foundation schema version is invalid.");
  assertConsultantReadinessLedger(value.consultant_projection_readiness);
  const graph = sharedGraphFromFoundation(
    value as unknown as CompleteResultFoundationV1,
  );
  validateStandardEvidenceGraph(graph);
  assertClosedSharedGraph(graph);
}

export function standardEvidenceGraphFromStoredCompleteResult(
  value: unknown,
): StandardEvidenceGraphV1 {
  if (!isRecord(value))
    throw new Error("Stored complete result must be an object.");
  if (value.schema_version === COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION) {
    validateCompleteResultFoundation(value);
    return deepFreeze(sharedGraphFromFoundation(value));
  }
  if (value.schema_version === "standard-evidence-graph.v1") {
    const legacy = structuredClone(value) as unknown as StandardEvidenceGraphV1;
    validateStandardEvidenceGraph(legacy);
    assertClosedSharedGraph(legacy);
    return deepFreeze(legacy);
  }
  throw new Error("Stored complete result schema version is unsupported.");
}

export function requireConsultantProjectionSources(
  foundation: CompleteResultFoundationV1,
): never {
  validateCompleteResultFoundation(foundation);
  const missing = foundation.consultant_projection_readiness.missing_sources;
  throw new ConsultantProjectionSourceUnavailableError(
    missing.map((item) => item.source_id),
  );
}
