export const STANDARD_EVIDENCE_GRAPH_SCHEMA_VERSION =
  "standard-evidence-graph.v1" as const;

export const STANDARD_DIMENSIONS = [
  { dimension_id: "category_product_fit", weight: 25, critical: true },
  {
    dimension_id: "compliance_certification_fit",
    weight: 20,
    critical: true,
  },
  { dimension_id: "volume_capacity_fit", weight: 15, critical: true },
  { dimension_id: "price_tier_fit", weight: 15, critical: false },
  { dimension_id: "positioning_brand_fit", weight: 15, critical: false },
  { dimension_id: "geographic_reach_fit", weight: 10, critical: false },
] as const;

export type StandardDimensionId =
  (typeof STANDARD_DIMENSIONS)[number]["dimension_id"];
export type StandardFitBand = "strong_fit" | "potential_fit" | "low_fit";
export type StandardVerificationStatus =
  | "claimed"
  | "externally_verified"
  | "inferred"
  | "stale"
  | "conflicting"
  | "unknown";
export type StandardEvidenceConfidence = "high" | "medium" | "low";
export type StandardEvidenceAccessState =
  "available" | "blocked" | "unreachable";

export interface StandardDimensionScoreV1 {
  dimension_id: StandardDimensionId;
  weight: 25 | 20 | 15 | 10;
  score: number;
  confidence: StandardEvidenceConfidence;
}

interface StandardEvidenceItemBaseV1 {
  evidence_id: string;
  source_kind: "synthetic_fixture" | "local_fixture" | "reserved_url";
  title: string;
  publisher: string;
  publisher_domain: string;
  published_or_updated: string;
  accessed_at: string;
  source_tier: "primary" | "official_secondary" | "secondary";
  verification_status: StandardVerificationStatus;
  access_state: StandardEvidenceAccessState;
  volatility_class: "stable" | "moderate" | "volatile";
  extract: string;
  content_sha256: string;
  provenance: "synthetic_fixture" | "repository_fixture";
}

export type StandardEvidenceItemV1 = StandardEvidenceItemBaseV1 &
  ({ exact_url: string } | { fixture_identity: string }) &
  (
    | { verification_disposition: "accepted" }
    | { verification_disposition: "excluded"; exclusion_reason: string }
  );

export interface StandardClaimV1 {
  claim_id: string;
  candidate_id: string;
  text: string;
  decision_bearing: boolean;
  high_risk: boolean;
  verification_status: StandardVerificationStatus;
  evidence_confidence: StandardEvidenceConfidence;
  evidence_ids: string[];
  corroboration: {
    required: boolean;
    status: "not_required" | "satisfied" | "missing" | "conflicting";
    independent_evidence_ids: string[];
  };
}

interface StandardEvidencedValueBaseV1 {
  value_id: string;
  candidate_id: string;
  verification_status: StandardVerificationStatus;
  evidence_ids: string[];
}

export type StandardOrganizationContactChannel =
  "role_email" | "organization_phone" | "organization_web";

export type StandardEvidencedValueV1 = StandardEvidencedValueBaseV1 &
  (
    | {
        kind: "organization_contact";
        channel_type: StandardOrganizationContactChannel;
        value: string;
        organization_domain: string;
      }
    | {
        kind: "plant" | "approval" | "capacity";
        value: string;
      }
  );

export interface StandardHiddenCandidateV1 {
  candidate_id: string;
  display_name: string;
  country_code: string;
  rationale_extended: string;
  rationale_claim_ids: string[];
  mandatory_constraints_satisfied: boolean;
  failed_constraint_ids: string[];
  dimensions: [
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
  ];
  verification_status: StandardVerificationStatus;
  evidence_confidence: StandardEvidenceConfidence;
  deterministic_tie_breaker: string;
}

export interface StandardGateEvaluationV1 {
  gate_id: string;
  label: string;
  eliminated_count: number;
}

export interface StandardEvidenceGraphV1 {
  schema_version: typeof STANDARD_EVIDENCE_GRAPH_SCHEMA_VERSION;
  run_id: string;
  candidates: StandardHiddenCandidateV1[];
  claims: StandardClaimV1[];
  evidence: StandardEvidenceItemV1[];
  evidenced_values: StandardEvidencedValueV1[];
  eligible_candidate_ids: string[];
  gate_evaluations: StandardGateEvaluationV1[];
  unknown_count: number;
  not_asked_count: number;
  gate_evaluation_completed_at: string;
}
