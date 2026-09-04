import type {
  StandardDimensionScoreV1,
  StandardEvidenceConfidence,
  StandardFitBand,
  StandardOrganizationWebForm,
  StandardOrganizationWebPurpose,
  StandardVerificationStatus,
} from "./standard-evidence.js";
import { STANDARD_ORGANIZATION_WEB_POLICY_VERSION } from "./standard-evidence.js";
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
// Version 5 adds the Domain Pack disclosure fields without rewriting the
// immutable version 4 registry release.
export const STANDARD_DISCLOSURE_PROJECTION_VERSION = 5 as const;

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
  provenance: "synthetic_fixture" | "repository_fixture" | "live_secure_fetch";
}

export type StandardCitationV1 = StandardCitationProjectionV1 &
  ({ exact_url: string } | { fixture_identity: string });

export interface StandardExplanationItemV1 {
  dimension_id: string;
  explanation: string;
  claim_id: string;
  evidence_ids: string[];
}

interface StandardEvidencedValueProjectionBaseV1 {
  verification_status: StandardVerificationStatus;
  evidence_ids: string[];
}

export type StandardEvidencedValueProjectionV1 =
  StandardEvidencedValueProjectionBaseV1 &
    (
      | {
          kind: "organization_contact";
          channel_type: "role_email" | "organization_phone";
          value: string;
          organization_domain: string;
        }
      | {
          kind: "organization_contact";
          channel_type: "organization_web";
          value: string;
          organization_domain: string;
          organization_web_policy_version: typeof STANDARD_ORGANIZATION_WEB_POLICY_VERSION;
          organization_web_purpose: StandardOrganizationWebPurpose;
          organization_web_form: StandardOrganizationWebForm;
        }
      | {
          kind: "plant" | "approval" | "capacity";
          value: string;
        }
    );

export interface StandardCandidateProjectionV1 {
  candidate_id?: string;
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

export interface StandardScarcityAnalysisProjectionV1 {
  reducing_constraints: Array<{
    constraint_id: string;
    field_id: string;
    label: string;
    eliminated_count: number;
  }>;
  unmet_mandatory_constraints: Array<{
    constraint_id: string;
    field_id: string;
    label: string;
  }>;
  permitted_relaxations: Array<{
    constraint_id: string;
    field_id: string;
    label: string;
    direction: "higher_is_acceptable" | "lower_is_acceptable" | "exact";
    tolerance: string;
  }>;
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
  scarcity_analysis: StandardScarcityAnalysisProjectionV1;
  limitations: StandardLimitationsProjectionV1;
  synthetic_warning: string;
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
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
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
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
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
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
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
}

export interface StandardRequestVersionHistoryV1 {
  schema_version: typeof STANDARD_REQUEST_VERSION_HISTORY_SCHEMA_VERSION;
  items: StandardRequestVersionSummaryV1[];
  next_cursor?: string;
  synthetic_warning: string;
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
}

export type StandardRunHistoryItemV1 = StandardRunStateV1 & {
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
};

export interface StandardRunHistoryV1 {
  schema_version: typeof STANDARD_RUN_HISTORY_SCHEMA_VERSION;
  items: StandardRunHistoryItemV1[];
  next_cursor?: string;
  synthetic_warning: string;
  projection_version: typeof STANDARD_DISCLOSURE_PROJECTION_VERSION;
}
