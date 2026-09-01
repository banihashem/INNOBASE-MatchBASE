import {
  buildCompleteResultFoundationV2,
  readStoredCompleteResultDocumentWithoutRewrite,
  type CompleteResultFoundationV2Source,
  type TrustedLiveFetchLedgerV2,
} from "@matchbase/ai-evidence";
// Operational authority is deliberately absent from the public ai-evidence
// barrel. The explicit internal subpath remains package-safe after deployment.
import { sealTrustedLiveFetchLedgerV2 } from "@matchbase/ai-evidence/internal/complete-result-foundation-v2";
import {
  assertStandardPiiReleaseSafe,
  standardPiiFindings,
} from "@matchbase/ai-evidence/standard";
import {
  STANDARD_DIMENSIONS,
  type CompleteResultEvidenceV2,
  type CompleteResultFoundationV2,
  type EvidenceGraphV1,
  type StandardEvidenceConfidence,
  type StandardVerificationStatus,
  type TrustedLiveFetchRecordV2,
} from "@matchbase/contracts";
import type { LiveSourceBindingRecord } from "./live-source-binding.js";
import { createHash, timingSafeEqual } from "node:crypto";

const IDENTITY_RESOLUTION_CONSTRAINT = "identity_resolution";
const PERSONAL_DATA_WITHHELD = "[personal data withheld]";

export interface SmeWeightValidationV2 {
  readonly validation_record_id: string;
  readonly approved_at: string;
  readonly weight_config_sha256: string;
}

export const STANDARD_DIMENSION_WEIGHTS_SHA256 = createHash("sha256")
  .update(
    JSON.stringify(
      STANDARD_DIMENSIONS.map(({ dimension_id, weight }) => ({
        dimension_id,
        weight,
      })),
    ),
  )
  .digest("hex");

function assertProductionWeightQualification(
  mode: "synthetic_qualification" | "production",
  validation: SmeWeightValidationV2 | undefined,
): void {
  if (mode === "synthetic_qualification") return;
  if (
    !validation ||
    Object.keys(validation).sort().join(",") !==
      "approved_at,validation_record_id,weight_config_sha256" ||
    !validation.validation_record_id.trim() ||
    !Number.isFinite(Date.parse(validation.approved_at)) ||
    new Date(validation.approved_at).toISOString() !== validation.approved_at ||
    validation.weight_config_sha256 !== STANDARD_DIMENSION_WEIGHTS_SHA256
  )
    throw new Error(
      "Production result weights require a documented SME validation record with the exact weight digest.",
    );
}

function providerVerificationStatus(
  value: EvidenceGraphV1["claims"][number]["verificationStatus"],
): StandardVerificationStatus {
  if (value === "externally_verified")
    throw new Error(
      "Provider output cannot assert externally_verified without server-owned verification basis.",
    );
  if (value === "synthetic")
    throw new Error("Live provider output cannot use synthetic verification.");
  return value;
}

function providerClaimVerificationStatus(
  claim: EvidenceGraphV1["claims"][number],
): StandardVerificationStatus {
  const status = providerVerificationStatus(claim.verificationStatus);
  // A linked, decision-bearing live claim is still only a source claim. Some
  // providers use `unknown` to mean "not externally verified"; normalize that
  // narrow shape to `claimed` without minting verification or changing source
  // lineage. Stale and conflicting claims remain fail-closed.
  return status === "unknown" &&
    claim.decisionBearing &&
    claim.evidenceIds.length > 0
    ? "claimed"
    : status;
}

function sanitizedProviderText(value: string): string {
  try {
    assertStandardPiiReleaseSafe(value);
    return value;
  } catch {
    let sanitized = value;
    const findings = standardPiiFindings(value) as readonly {
      start: number;
      end: number;
    }[];
    for (const finding of [...findings].sort(
      (left, right) => right.start - left.start,
    ))
      sanitized = `${sanitized.slice(0, finding.start)}${PERSONAL_DATA_WITHHELD}${sanitized.slice(finding.end)}`;
    try {
      assertStandardPiiReleaseSafe(sanitized);
      return sanitized.trim() || PERSONAL_DATA_WITHHELD;
    } catch {
      return PERSONAL_DATA_WITHHELD;
    }
  }
}

function evidenceConfidence(
  candidateId: string,
  graph: EvidenceGraphV1,
): StandardEvidenceConfidence {
  const levels = graph.claims
    .filter((claim) => claim.candidateId === candidateId)
    .map((claim) => claim.evidenceConfidence);
  if (levels.includes("low")) return "low";
  if (levels.includes("medium")) return "medium";
  return "high";
}

function dimensions(
  candidate: EvidenceGraphV1["candidates"][number],
  confidence: StandardEvidenceConfidence,
): CompleteResultFoundationV2Source["candidates"][number]["dimensions"] {
  const expected = STANDARD_DIMENSIONS.map(
    (dimension) => dimension.dimension_id,
  ).sort();
  const actual = Object.keys(candidate.dimensionScores).sort();
  if (
    actual.length !== expected.length ||
    actual.some((dimensionId, index) => dimensionId !== expected[index])
  )
    throw new Error(
      "Live result dimensions do not match the closed six-dimension contract.",
    );
  return STANDARD_DIMENSIONS.map((dimension) => {
    const score = candidate.dimensionScores[dimension.dimension_id];
    if (
      !Number.isInteger(score) ||
      score === undefined ||
      score < 0 ||
      score > 100
    )
      throw new Error("Live result dimension score is invalid.");
    return {
      dimension_id: dimension.dimension_id,
      weight: dimension.weight,
      score,
      confidence,
    };
  }) as CompleteResultFoundationV2Source["candidates"][number]["dimensions"];
}

function trustedRecords(
  bindings: readonly LiveSourceBindingRecord[],
  authoritativeRegistryDomains: ReadonlySet<string>,
): TrustedLiveFetchRecordV2[] {
  return bindings.map((binding) => ({
    evidence_id: binding.evidenceId,
    canonical_url: binding.canonicalUrl,
    publisher_domain: binding.publisherDomain,
    retrieved_at: binding.retrievedAt,
    content_sha256: binding.contentSha256,
    bounded_excerpt: binding.boundedExcerpt,
    authority_class: authoritativeRegistryDomains.has(binding.publisherDomain)
      ? "authoritative_registry"
      : "ordinary_source",
  }));
}

export function buildOperationalLiveCompleteResultV2(input: {
  readonly graph: EvidenceGraphV1;
  readonly eligibleCandidateIds: readonly string[];
  readonly sourceBindings: readonly LiveSourceBindingRecord[];
  readonly authoritativeRegistryDomains?: readonly string[];
  readonly qualificationMode: "synthetic_qualification" | "production";
  readonly smeWeightValidation?: SmeWeightValidationV2;
}): {
  readonly foundation: CompleteResultFoundationV2;
  readonly trustedFetchLedger: TrustedLiveFetchLedgerV2;
} {
  assertProductionWeightQualification(
    input.qualificationMode,
    input.smeWeightValidation,
  );
  const authoritativeRegistryDomains = new Set(
    input.authoritativeRegistryDomains ?? [],
  );
  const trustedFetchRecords = trustedRecords(
    input.sourceBindings,
    authoritativeRegistryDomains,
  );
  const trustedFetchLedger = sealTrustedLiveFetchLedgerV2(trustedFetchRecords);
  const providerEvidenceById = new Map(
    input.graph.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const eligible = new Set(input.eligibleCandidateIds);
  const candidates = input.graph.candidates.map((candidate) => {
    const confidence = evidenceConfidence(candidate.candidateId, input.graph);
    const remainsEligible = eligible.has(candidate.candidateId);
    return {
      candidate_id: candidate.candidateId,
      display_name: sanitizedProviderText(candidate.displayName),
      country_code: candidate.countryCode,
      rationale_extended: sanitizedProviderText(candidate.rationaleShort),
      rationale_claim_ids: [...candidate.rationaleClaimIds],
      mandatory_constraints_satisfied: remainsEligible,
      failed_constraint_ids: remainsEligible
        ? []
        : candidate.failedConstraintIds.length > 0
          ? candidate.failedConstraintIds.map(sanitizedProviderText)
          : [IDENTITY_RESOLUTION_CONSTRAINT],
      dimensions: dimensions(candidate, confidence),
      verification_status: providerVerificationStatus(
        candidate.verificationStatus,
      ),
      evidence_confidence: confidence,
      deterministic_tie_breaker: sanitizedProviderText(
        candidate.deterministicRankKey,
      ),
    };
  });
  const claims = input.graph.claims.map((claim) => ({
    claim_id: claim.claimId,
    candidate_id: claim.candidateId,
    text: sanitizedProviderText(claim.text),
    decision_bearing: claim.decisionBearing,
    high_risk: false,
    verification_status: providerClaimVerificationStatus(claim),
    evidence_confidence: claim.evidenceConfidence,
    evidence_ids: [...claim.evidenceIds],
    corroboration: {
      required: false,
      status: "not_required" as const,
      independent_evidence_ids: [],
    },
  }));
  const evidence = trustedFetchRecords.map((trusted) => {
    const providerEvidence = providerEvidenceById.get(trusted.evidence_id);
    const accepted = providerEvidence?.verificationDisposition === "accepted";
    const common = {
      evidence_id: trusted.evidence_id,
      source_kind: "reserved_url",
      exact_url: trusted.canonical_url,
      title:
        providerEvidence?.title.trim() ||
        "Fetched source retained without provider use",
      publisher: providerEvidence?.publisher.trim() || trusted.publisher_domain,
      publisher_domain: trusted.publisher_domain,
      published_or_updated: "not stated by source",
      accessed_at: trusted.retrieved_at,
      source_tier:
        trusted.authority_class === "authoritative_registry"
          ? "primary"
          : "secondary",
      verification_status: "claimed",
      access_state: "available",
      volatility_class: "moderate",
      extract: trusted.bounded_excerpt,
      content_sha256: trusted.content_sha256,
      provenance: "live_secure_fetch",
      external_verification_basis: {
        kind: "not_externally_verified",
      },
    } as const;
    if (accepted)
      return {
        ...common,
        verification_disposition: "accepted",
      } as const satisfies CompleteResultEvidenceV2;
    return {
      ...common,
      verification_disposition: "excluded",
      exclusion_reason:
        providerEvidence?.exclusionReason.trim() ||
        "Fetched source was not used by the provider result.",
    } as const satisfies CompleteResultEvidenceV2;
  });
  const source: CompleteResultFoundationV2Source = {
    schema_version: "standard-evidence-graph.v1",
    run_id: input.graph.runId,
    candidates,
    claims,
    evidence,
    evidenced_values: [],
    eligible_candidate_ids: [...input.eligibleCandidateIds],
    gate_evaluations: [
      {
        gate_id: "mandatory_constraints",
        label: "Mandatory constraints",
        eliminated_count: candidates.filter(
          (candidate) => !candidate.mandatory_constraints_satisfied,
        ).length,
      },
    ],
    unknown_count: 0,
    not_asked_count: 0,
    gate_evaluation_completed_at: input.graph.gateEvaluationCompletedAt,
  };
  return {
    foundation: buildCompleteResultFoundationV2(source, trustedFetchLedger),
    trustedFetchLedger,
  };
}

export function readOperationalLiveCompleteResultV2(input: {
  readonly document: unknown;
  readonly resultSha256: Uint8Array;
  readonly expectedRunId: string;
  readonly sourceBindings: readonly LiveSourceBindingRecord[];
  readonly authoritativeRegistryDomains?: readonly string[];
}): CompleteResultFoundationV2 {
  if (
    !(input.resultSha256 instanceof Uint8Array) ||
    input.resultSha256.byteLength !== 32
  )
    throw new Error("Operational live result integrity digest is invalid.");
  const actualDigest = createHash("sha256")
    .update(JSON.stringify(input.document))
    .digest();
  if (!timingSafeEqual(actualDigest, Buffer.from(input.resultSha256)))
    throw new Error("Operational live result integrity check failed.");
  const trustedFetchLedger = sealTrustedLiveFetchLedgerV2(
    trustedRecords(
      input.sourceBindings,
      new Set(input.authoritativeRegistryDomains ?? []),
    ),
  );
  const stored = readStoredCompleteResultDocumentWithoutRewrite(
    input.document,
    trustedFetchLedger,
  );
  if (stored.kind !== "foundation_v2")
    throw new Error("Operational live result is not foundation v2.");
  if (stored.document.run_id !== input.expectedRunId)
    throw new Error("Operational live result run identity is invalid.");
  return stored.document;
}
