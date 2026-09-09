/** MB-UX-COST-001 L01: one consent authorizes one bounded research round. */
export type ResearchDepth = "simple" | "deep";
export interface ResearchModelRate {
  model: string;
  provider: string;
  input_usd_per_token: number;
  output_usd_per_token: number;
  request_usd: number;
  web_search_usd: number;
  reasoning: boolean;
  source_url: string;
}
export interface ResearchRoundPlan {
  /** Local reprocessing keeps the source execution immutable and makes no paid calls. */
  recovery_source_execution_id?: string;
  version: "research-round.v1";
  round_number: number;
  depth: ResearchDepth;
  title: string;
  purpose: string;
  focus_requirements: string[];
  research_models: string[];
  extraction_model: string;
  synthesis_model: string;
  search_engine: "native" | "exa";
  candidate_limit_per_search: number;
  max_calls: number;
  max_input_tokens_per_call: number;
  max_output_tokens_per_call: number;
  estimated_low_usd: number;
  estimated_high_usd: number;
  pricing_checked_at: string;
  expires_at: string;
  rates: ResearchModelRate[];
  assumptions: string[];
  request_hash: string;
  parent_round_id: string | null;
  mode: "live" | "demonstration";
}
export interface ResearchRoundView {
  round_id: string;
  round_number: number;
  execution_id: string | null;
  status: "proposed" | "approved" | "completed" | "failed" | "cancelled";
  plan: ResearchRoundPlan;
  approved_at: string | null;
  completed_at: string | null;
  candidate_count: number | null;
  output_available: boolean;
}
export interface ResearchCostSummary {
  currency: "USD";
  recorded_total_usd: number;
  openrouter_charge_usd: number;
  byok_upstream_usd: number;
  preparation_usd: number;
  research_usd: number;
  unpriced_calls: number;
  calls: number;
  complete: boolean;
  by_execution: Record<
    string,
    { recorded_usd: number; unpriced_calls: number }
  >;
  disclosure: string;
}
