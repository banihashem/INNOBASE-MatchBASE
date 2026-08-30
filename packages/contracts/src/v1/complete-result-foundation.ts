import type {
  StandardClaimV1,
  StandardEvidenceItemV1,
  StandardEvidencedValueV1,
  StandardGateEvaluationV1,
  StandardHiddenCandidateV1,
} from "./standard-evidence.js";

export const COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION =
  "complete-result-foundation.v1" as const;

export const CONSULTANT_REQUIRED_SOURCE_IDS = [
  "full_candidate_rationales",
  "rfq_question_sets",
  "rfq_wave_recommendations",
  "reserve_candidates_and_expansion_leads",
  "due_diligence_checklist",
  "excluded_sources",
  "full_limitations",
  "soft_cap_configuration",
] as const;

export type ConsultantRequiredSourceId =
  (typeof CONSULTANT_REQUIRED_SOURCE_IDS)[number];

/**
 * Authoritative source categories that the current pipeline cannot produce.
 * The order is part of the persisted v1 readiness ledger.
 */
export const CONSULTANT_UNAVAILABLE_SOURCE_IDS = [
  "full_candidate_rationales",
  "rfq_question_sets",
  "rfq_wave_recommendations",
  "reserve_candidates_and_expansion_leads",
  "due_diligence_checklist",
  "full_limitations",
  "soft_cap_configuration",
] as const satisfies readonly ConsultantRequiredSourceId[];

export type ConsultantUnavailableSourceId =
  (typeof CONSULTANT_UNAVAILABLE_SOURCE_IDS)[number];

export interface ConsultantUnavailableSourceV1<
  SourceId extends ConsultantUnavailableSourceId =
    ConsultantUnavailableSourceId,
> {
  readonly source_id: SourceId;
  readonly status: "unavailable";
  readonly reason_code: "not_produced_by_current_pipeline";
}

type ConsultantUnavailableSourceLedger<
  SourceIds extends readonly ConsultantUnavailableSourceId[],
> = SourceIds extends readonly [
  infer Head extends ConsultantUnavailableSourceId,
  ...infer Tail extends readonly ConsultantUnavailableSourceId[],
]
  ? readonly [
      ConsultantUnavailableSourceV1<Head>,
      ...ConsultantUnavailableSourceLedger<Tail>,
    ]
  : readonly [];

export type ConsultantUnavailableSourceLedgerV1 =
  ConsultantUnavailableSourceLedger<typeof CONSULTANT_UNAVAILABLE_SOURCE_IDS>;

export const CONSULTANT_UNAVAILABLE_SOURCES = [
  {
    source_id: "full_candidate_rationales",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
  {
    source_id: "rfq_question_sets",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
  {
    source_id: "rfq_wave_recommendations",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
  {
    source_id: "reserve_candidates_and_expansion_leads",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
  {
    source_id: "due_diligence_checklist",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
  {
    source_id: "full_limitations",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
  {
    source_id: "soft_cap_configuration",
    status: "unavailable",
    reason_code: "not_produced_by_current_pipeline",
  },
] as const satisfies ConsultantUnavailableSourceLedgerV1;

export interface ConsultantProjectionReadinessV1 {
  readonly outcome: "blocked";
  readonly missing_sources: ConsultantUnavailableSourceLedgerV1;
}

/**
 * Tier-neutral, closed persisted result document for newly completed Standard
 * runs. It contains only facts already validated by the Standard evidence
 * graph. Projection-only, RFQ, analyst and artifact facts are intentionally
 * absent.
 */
export interface CompleteResultFoundationV1 {
  readonly schema_version: typeof COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION;
  readonly run_id: string;
  readonly candidates: readonly StandardHiddenCandidateV1[];
  readonly claims: readonly StandardClaimV1[];
  readonly evidence: readonly StandardEvidenceItemV1[];
  readonly evidenced_values: readonly StandardEvidencedValueV1[];
  readonly eligible_candidate_ids: readonly string[];
  readonly gate_evaluations: readonly StandardGateEvaluationV1[];
  readonly unknown_count: number;
  readonly not_asked_count: number;
  readonly gate_evaluation_completed_at: string;
  readonly consultant_projection_readiness: ConsultantProjectionReadinessV1;
}
