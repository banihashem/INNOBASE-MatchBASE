import { createHash } from "node:crypto";
import type {
  StandardClaimV1,
  StandardEvidenceGraphV1,
  StandardEvidenceItemV1,
  StandardVerificationStatus,
} from "@matchbase/contracts";
import { assertStandardDimensions } from "../scoring/standard.js";

export interface EvidenceVolatilityPolicyV1 {
  schema_version: "evidence-volatility-policy.v1";
  policy_version: string;
  maximum_age_days: {
    stable: number;
    moderate: number;
    volatile: number;
  };
}

export const STANDARD_EVIDENCE_VOLATILITY_POLICY: EvidenceVolatilityPolicyV1 = {
  schema_version: "evidence-volatility-policy.v1",
  policy_version: "2026-08-15.1",
  maximum_age_days: { stable: 365, moderate: 180, volatile: 30 },
};

const NON_SUPPORTING_STATUSES = new Set<StandardVerificationStatus>([
  "stale",
  "conflicting",
  "unknown",
]);
const OFFSET_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const DATE_OR_MISSING = /^(?:\d{4}-\d{2}-\d{2}|not stated by source)$/u;
const NAMED_PERSON_MARKER =
  /\b(?:mr|mrs|ms|miss|dr|professor)\.?\s+[\p{L}][\p{L}'’-]+/iu;
const UNPREFIXED_PERSON_SHAPE =
  /^[\p{Lu}][\p{Ll}'’-]{1,30}\s+[\p{Lu}][\p{Ll}'’-]{1,40}$/u;
const ARABIC_SCRIPT_PERSON_SHAPE =
  /^[\p{Script=Arabic}]{2,30}[\s\u200c]+[\p{Script=Arabic}]{2,40}$/u;

export function standardContentSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueById<T>(
  values: readonly T[],
  getId: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (!id || result.has(id)) {
      throw new Error(`${label} identifiers must be non-empty and unique.`);
    }
    result.set(id, value);
  }
  return result;
}

function validateCitationShape(item: StandardEvidenceItemV1): void {
  const sourceIdentity =
    "exact_url" in item ? item.exact_url : item.fixture_identity;
  if (!sourceIdentity.trim() || !item.publisher.trim()) {
    throw new Error(
      `Evidence ${item.evidence_id} lacks exact source identity.`,
    );
  }
  if (!DATE_OR_MISSING.test(item.published_or_updated)) {
    throw new Error(`Evidence ${item.evidence_id} has an invalid source date.`);
  }
  if (
    !OFFSET_TIMESTAMP.test(item.accessed_at) ||
    !Number.isFinite(Date.parse(item.accessed_at))
  ) {
    throw new Error(
      `Evidence ${item.evidence_id} requires an offset-bearing access time.`,
    );
  }
  if (!item.extract.trim() || item.extract.length > 600) {
    throw new Error(`Evidence ${item.evidence_id} extract is not bounded.`);
  }
  if (item.content_sha256 !== standardContentSha256(item.extract)) {
    throw new Error(`Evidence ${item.evidence_id} content hash is invalid.`);
  }
  if (item.source_kind === "synthetic_fixture") {
    const unreachable =
      ("fixture_identity" in item &&
        item.fixture_identity.startsWith("fixture://")) ||
      ("exact_url" in item &&
        /^https:\/\/[^/]+\.example\.invalid(?:\/[^/].*)?$/u.test(
          item.exact_url,
        ));
    if (!unreachable) {
      throw new Error(
        `Synthetic evidence ${item.evidence_id} uses a reachable URL shape.`,
      );
    }
  }
  if (
    "exact_url" in item &&
    /\b(?:google|bing)\.[^/]+\/search\b/iu.test(item.exact_url)
  ) {
    throw new Error(`Evidence ${item.evidence_id} uses a search-result URL.`);
  }
  if (item.source_kind === "reserved_url" && "exact_url" in item) {
    const parsed = new URL(item.exact_url);
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      throw new Error(`Evidence ${item.evidence_id} substitutes a homepage.`);
    }
  }
}

function linkedEvidence(
  claim: StandardClaimV1,
  evidenceById: ReadonlyMap<string, StandardEvidenceItemV1>,
): StandardEvidenceItemV1[] {
  return claim.evidence_ids.map((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      throw new Error(`Claim ${claim.claim_id} has dangling evidence.`);
    }
    return evidence;
  });
}

function canSupportDecision(item: StandardEvidenceItemV1): boolean {
  return (
    item.verification_disposition === "accepted" &&
    item.access_state === "available" &&
    !NON_SUPPORTING_STATUSES.has(item.verification_status)
  );
}

export function validateStandardEvidenceGraph(
  graph: StandardEvidenceGraphV1,
): void {
  if (graph.schema_version !== "standard-evidence-graph.v1") {
    throw new Error("Standard evidence graph schema version is invalid.");
  }
  if (graph.unknown_count < 0 || graph.not_asked_count < 0) {
    throw new Error("Limitation counts cannot be negative.");
  }
  const candidates = uniqueById(
    graph.candidates,
    (candidate) => candidate.candidate_id,
    "Candidate",
  );
  const claims = uniqueById(graph.claims, (claim) => claim.claim_id, "Claim");
  const evidence = uniqueById(
    graph.evidence,
    (item) => item.evidence_id,
    "Evidence",
  );
  uniqueById(
    graph.evidenced_values,
    (value) => value.value_id,
    "Evidenced value",
  );
  uniqueById(graph.gate_evaluations, (gate) => gate.gate_id, "Gate");
  graph.evidence.forEach(validateCitationShape);

  for (const claim of graph.claims) {
    if (!candidates.has(claim.candidate_id)) {
      throw new Error(`Claim ${claim.claim_id} has a dangling candidate.`);
    }
    const linked = linkedEvidence(claim, evidence);
    if (
      claim.decision_bearing &&
      (!linked.some(canSupportDecision) ||
        NON_SUPPORTING_STATUSES.has(claim.verification_status))
    ) {
      throw new Error(
        `Decision-bearing claim ${claim.claim_id} lacks usable evidence.`,
      );
    }
    if (claim.high_risk) {
      const independent = new Set(
        claim.corroboration.independent_evidence_ids.map((id) => {
          const item = evidence.get(id);
          if (!item || !claim.evidence_ids.includes(id)) {
            throw new Error(
              `High-risk claim ${claim.claim_id} has invalid corroboration.`,
            );
          }
          return item.publisher_domain;
        }),
      );
      if (
        !claim.corroboration.required ||
        claim.corroboration.status !== "satisfied" ||
        independent.size < 2
      ) {
        throw new Error(
          `High-risk claim ${claim.claim_id} requires independent corroboration.`,
        );
      }
    } else if (
      claim.corroboration.required ||
      claim.corroboration.status !== "not_required"
    ) {
      throw new Error(
        `Non-high-risk claim ${claim.claim_id} has inconsistent corroboration.`,
      );
    }
  }

  for (const candidate of graph.candidates) {
    assertStandardDimensions(candidate.dimensions);
    if (
      !candidate.rationale_extended.trim() ||
      candidate.rationale_claim_ids.length === 0
    ) {
      throw new Error(
        `Candidate ${candidate.candidate_id} requires a supported rationale.`,
      );
    }
    for (const claimId of candidate.rationale_claim_ids) {
      const claim = claims.get(claimId);
      if (
        !claim ||
        claim.candidate_id !== candidate.candidate_id ||
        !claim.decision_bearing
      ) {
        throw new Error(
          `Candidate ${candidate.candidate_id} has an invalid rationale claim.`,
        );
      }
    }
  }

  for (const value of graph.evidenced_values) {
    if (!candidates.has(value.candidate_id) || !value.value.trim()) {
      throw new Error(`Evidenced value ${value.value_id} is invalid.`);
    }
    if (
      NON_SUPPORTING_STATUSES.has(value.verification_status) ||
      value.evidence_ids.length === 0 ||
      !value.evidence_ids.every((id) => {
        const item = evidence.get(id);
        return item !== undefined && canSupportDecision(item);
      })
    ) {
      throw new Error(
        `Evidenced value ${value.value_id} lacks value-level passed evidence.`,
      );
    }
    if (
      value.kind === "organization_contact" &&
      (NAMED_PERSON_MARKER.test(value.value) ||
        UNPREFIXED_PERSON_SHAPE.test(value.value.trim()) ||
        ARABIC_SCRIPT_PERSON_SHAPE.test(value.value.trim()))
    ) {
      throw new Error(
        `Evidenced value ${value.value_id} contains named natural-person contact data.`,
      );
    }
  }

  const eligible = new Set(graph.eligible_candidate_ids);
  if (eligible.size !== graph.eligible_candidate_ids.length) {
    throw new Error("Eligible candidate identifiers must be unique.");
  }
  for (const candidateId of eligible) {
    const candidate = candidates.get(candidateId);
    if (!candidate || !candidate.mandatory_constraints_satisfied) {
      throw new Error(
        "An ineligible candidate entered the Standard result set.",
      );
    }
    const rationaleClaims = candidate.rationale_claim_ids.map((id) =>
      claims.get(id)!,
    );
    if (
      rationaleClaims.some((claim) =>
        NON_SUPPORTING_STATUSES.has(claim.verification_status),
      )
    ) {
      throw new Error(
        `Eligible candidate ${candidateId} relies on a non-supporting claim.`,
      );
    }
  }
}

export function evidenceStatusAtReadTime(
  item: StandardEvidenceItemV1,
  now: Date,
  policy: EvidenceVolatilityPolicyV1,
): StandardVerificationStatus {
  if (NON_SUPPORTING_STATUSES.has(item.verification_status)) {
    return item.verification_status;
  }
  const ageMilliseconds = now.getTime() - Date.parse(item.accessed_at);
  const maximumAgeDays = policy.maximum_age_days[item.volatility_class];
  if (ageMilliseconds > maximumAgeDays * 86_400_000) return "stale";
  return item.verification_status;
}

export function standardEvidenceReadStatuses(
  graph: StandardEvidenceGraphV1,
  now: Date,
  policy: EvidenceVolatilityPolicyV1 = STANDARD_EVIDENCE_VOLATILITY_POLICY,
): ReadonlyMap<string, StandardVerificationStatus> {
  return new Map(
    graph.evidence.map((item) => [
      item.evidence_id,
      evidenceStatusAtReadTime(item, now, policy),
    ]),
  );
}
