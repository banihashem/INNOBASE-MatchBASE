export const DEMO_PROJECTION_SCHEMA_VERSION = "demo-projection.v1" as const;

export interface DemoCandidateV1 {
  display_name: string;
  country_code: string;
  rationale_short: string;
}

export interface DemoProjectionV1 {
  schema_version: typeof DEMO_PROJECTION_SCHEMA_VERSION;
  run_id: string;
  outcome: "matched" | "no_responsible_match";
  scarcity: "none" | "limited" | "zero";
  candidates: DemoCandidateV1[];
  unmet_mandatory_constraints: string[];
  limitations_notice: string;
  projection_version: 1;
}
