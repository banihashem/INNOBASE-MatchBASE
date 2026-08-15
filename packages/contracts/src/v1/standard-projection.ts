import type {
  StandardDimensionScoreV1,
  StandardEvidenceConfidence,
  StandardFitBand,
  StandardVerificationStatus,
} from "./standard-evidence.js";
import type { StructuredStandardRequestV1 } from "./structured-request.js";

export const STANDARD_RESULT_PROJECTION_SCHEMA_VERSION =
  "standard-result-projection.v1" as const;
export const STANDARD_RUN_PROJECTION_SCHEMA_VERSION =
  "standard-run-projection.v1" as const;
export const STANDARD_REQUEST_HISTORY_SCHEMA_VERSION =
  "standard-request-history.v1" as const;
export const STANDARD_RUN_HISTORY_SCHEMA_VERSION =
  "standard-run-history.v1" as const;
export const STANDARD_REQUEST_DETAIL_SCHEMA_VERSION =
  "standard-request-detail.v1" as const;
export const STANDARD_REQUEST_VERSION_HISTORY_SCHEMA_VERSION =
  "standard-request-version-history.v1" as const;

export interface StandardCitationProjectionV1 {
  evidence_id: string;
  title: string;
  publisher: string;
  published_or_updated: string;
  accessed_at: string;
  source_tier: "primary" | "official_secondary" | "secondary";
  status: StandardVerificationStatus;
  access_state: "available" | "blocked" | "unreachable";
  extract: string;
  content_sha256: string;
  provenance: "synthetic_fixture" | "repository_fixture";
}

export type StandardCitationV1 = StandardCitationProjectionV1 &
  ({ exact_url: string } | { fixture_identity: string });

export interface StandardExplanationItemV1 {
  dimension_id: string;
  explanation: string;
  claim_id: string;
  evidence_ids: string[];
}

export interface StandardEvidencedValueProjectionV1 {
  kind: "organization_contact" | "plant" | "approval" | "capacity";
  value: string;
  verification_status: StandardVerificationStatus;
  evidence_ids: string[];
}

export interface StandardCandidateProjectionV1 {
  display_name: string;
  country_code: string;
  rationale_extended: string;
  compatibility_score: number;
  fit_band: StandardFitBand;
  band_ceiling: StandardFitBand;
  displayed_band: StandardFitBand;
  band_ceiling_reason?: string;
  dimension_scores: [
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
    StandardDimensionScoreV1,
  ];
  positive_drivers: StandardExplanationItemV1[];
  limiting_gaps: StandardExplanationItemV1[];
  citations: StandardCitationV1[];
  freshness: "current" | "stale" | "mixed";
  verification_status: StandardVerificationStatus;
  evidence_confidence: StandardEvidenceConfidence;
  contact_details?: StandardEvidencedValueProjectionV1[];
  plant_identifiers?: StandardEvidencedValueProjectionV1[];
  approval_identifiers?: StandardEvidencedValueProjectionV1[];
  capacity_figures?: StandardEvidencedValueProjectionV1[];
}

export interface StandardLimitationsProjectionV1 {
  unknown_count: number;
  not_asked_count: number;
  affected_low_confidence_dimensions: string[];
  evidence_states: StandardVerificationStatus[];
  cap_notice?: string;
  restricted_party_screening_notice: string;
  advisory_boundary: string;
}

export interface StandardResultProjectionV1 {
  schema_version: typeof STANDARD_RESULT_PROJECTION_SCHEMA_VERSION;
  run_id: string;
  outcome: "matched" | "no_responsible_match";
  scarcity: "none" | "limited" | "zero";
  candidates: StandardCandidateProjectionV1[];
  gate_eliminations: Array<{
    gate_id: string;
    label: string;
    eliminated_count: number;
  }>;
  limitations: StandardLimitationsProjectionV1;
  synthetic_warning: string;
  projection_version: 1;
}

export interface StandardProjectionLinksV1 {
  request: string;
  run: string;
  result?: string;
}

interface StandardRunStateBaseV1 {
  run_id: string;
  request_id: string;
  canonical_request_version: number;
  phase: string;
  phase_label: string;
  progress: number;
  started_at: string;
  updated_at: string;
  limitations_notice: string;
  links: StandardProjectionLinksV1;
}

export type StandardRunStateV1 = StandardRunStateBaseV1 &
  (
    | {
        state: "queued" | "running";
        terminal: false;
        result_available: false;
        outcome: "pending";
        scarcity: "pending";
        poll_after_ms: number;
        estimated_completion_at?: string;
      }
    | {
        state: "completed" | "failed" | "cancelled" | "superseded";
        terminal: true;
        result_available: boolean;
        outcome:
          | "matched"
          | "no_responsible_match"
          | "failed"
          | "cancelled"
          | "superseded";
        scarcity: "none" | "limited" | "zero" | "not_applicable";
      }
  );

export type StandardRunProjectionV1 = StandardRunStateV1 & {
  schema_version: typeof STANDARD_RUN_PROJECTION_SCHEMA_VERSION;
  synthetic_warning: string;
  projection_version: 1;
};

export interface StandardRequestHistoryItemV1 {
  request_id: string;
  canonical_summary: string;
  version_count: number;
  created_at: string;
  updated_at: string;
  latest_run_state:
    | "not_started"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "superseded";
  latest_run_outcome:
    | "not_started"
    | "pending"
    | "matched"
    | "no_responsible_match"
    | "failed"
    | "cancelled"
    | "superseded";
  links: StandardProjectionLinksV1;
}

export interface StandardRequestHistoryV1 {
  schema_version: typeof STANDARD_REQUEST_HISTORY_SCHEMA_VERSION;
  items: StandardRequestHistoryItemV1[];
  next_cursor?: string;
  synthetic_warning: string;
}

export interface StandardRequestVersionSummaryV1 {
  canonical_version_id: string;
  version: number;
  readiness: "ready" | "partially_ready" | "not_ready";
  created_at: string;
}

export interface StandardRequestDetailV1 {
  schema_version: typeof STANDARD_REQUEST_DETAIL_SCHEMA_VERSION;
  canonical: StructuredStandardRequestV1;
  version_history: StandardRequestVersionSummaryV1[];
  links: {
    request: string;
    versions: string;
    runs: string;
  };
  synthetic_warning: string;
}

export interface StandardRequestVersionHistoryV1 {
  schema_version: typeof STANDARD_REQUEST_VERSION_HISTORY_SCHEMA_VERSION;
  items: StandardRequestVersionSummaryV1[];
  next_cursor?: string;
  synthetic_warning: string;
}

export type StandardRunHistoryItemV1 = StandardRunStateV1 & {
  projection_version: 1;
};

export interface StandardRunHistoryV1 {
  schema_version: typeof STANDARD_RUN_HISTORY_SCHEMA_VERSION;
  items: StandardRunHistoryItemV1[];
  next_cursor?: string;
  synthetic_warning: string;
}
