import type {
  StandardClaimV1,
  StandardEvidenceItemV1,
  StandardEvidencedValueV1,
  StandardGateEvaluationV1,
  StandardHiddenCandidateV1,
} from "../v1/standard-evidence.js";
import type { ConsultantProjectionReadinessV1 } from "../v1/complete-result-foundation.js";

export const COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION =
  "complete-result-foundation.v2" as const;

export const DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME = {
  mandatory_rules_satisfied: "Passed all mandatory matching rules.",
  mandatory_rules_not_satisfied: "Did not pass all mandatory matching rules.",
} as const;

export type DemoRationaleRuleOutcomeV2 =
  keyof typeof DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME;

export type DemoRationaleSourceV2 = {
  [Outcome in DemoRationaleRuleOutcomeV2]: {
    readonly candidate_id: string;
    readonly rule_outcome: Outcome;
    readonly rationale_short: (typeof DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME)[Outcome];
  };
}[DemoRationaleRuleOutcomeV2];

export const DEMO_LOW_CONFIDENCE_CAUTION_TEXT =
  "Evidence confidence is low; treat this result as directional." as const;

export type DemoLowConfidenceCautionV2 =
  | { readonly state: "not_required"; readonly text: "" }
  | {
      readonly state: "present";
      readonly text: typeof DEMO_LOW_CONFIDENCE_CAUTION_TEXT;
    };

export type LiveExternalVerificationBasisV2 =
  | { readonly kind: "not_externally_verified" }
  | {
      readonly kind: "independent_corroboration";
      readonly independent_evidence_ids: readonly [string, string, ...string[]];
    }
  | {
      readonly kind: "authoritative_registry";
      readonly registry_evidence_id: string;
    };

export interface TrustedLiveFetchRecordV2 {
  readonly evidence_id: string;
  readonly canonical_url: string;
  readonly publisher_domain: string;
  readonly retrieved_at: string;
  readonly content_sha256: string;
  readonly bounded_excerpt: string;
  readonly authority_class: "ordinary_source" | "authoritative_registry";
}

type WithV2Provenance<T> = T extends StandardEvidenceItemV1
  ? T extends { exact_url: string }
    ? | T
      | (Omit<T, "provenance" | "source_kind" | "verification_status"> & {
          readonly provenance: "live_secure_fetch";
          readonly source_kind: "reserved_url";
        } & (
            | {
                readonly verification_status: Exclude<
                  T["verification_status"],
                  "externally_verified"
                >;
                readonly external_verification_basis: {
                  readonly kind: "not_externally_verified";
                };
              }
            | {
                readonly verification_status: "externally_verified";
                readonly external_verification_basis: Exclude<
                  LiveExternalVerificationBasisV2,
                  { readonly kind: "not_externally_verified" }
                >;
              }
          ))
    : T
  : never;

export type CompleteResultEvidenceV2 = WithV2Provenance<StandardEvidenceItemV1>;

export interface CompleteResultFoundationV2 {
  readonly schema_version: typeof COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION;
  readonly run_id: string;
  readonly candidates: readonly StandardHiddenCandidateV1[];
  readonly claims: readonly StandardClaimV1[];
  readonly evidence: readonly CompleteResultEvidenceV2[];
  readonly evidenced_values: readonly StandardEvidencedValueV1[];
  readonly eligible_candidate_ids: readonly string[];
  readonly gate_evaluations: readonly StandardGateEvaluationV1[];
  readonly unknown_count: number;
  readonly not_asked_count: number;
  readonly gate_evaluation_completed_at: string;
  readonly demo_rationale_sources: readonly DemoRationaleSourceV2[];
  readonly demo_low_confidence_caution: DemoLowConfidenceCautionV2;
  readonly consultant_projection_readiness: ConsultantProjectionReadinessV1;
}
