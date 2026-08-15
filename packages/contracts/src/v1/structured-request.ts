import type { StandardMacroParameterId } from "./domain-pack.js";

export const STANDARD_INTAKE_SUBMISSION_SCHEMA_VERSION =
  "standard-intake-submission.v1" as const;
export const STRUCTURED_STANDARD_REQUEST_SCHEMA_VERSION =
  "structured-standard-request.v1" as const;

export type StandardValueState =
  "provided" | "explicitly_unknown" | "empty" | "not_applicable" | "not_asked";

export interface StandardProvidedValueV1 {
  value_state: "provided";
  value: string;
  unit?: string;
  raw_expression?: string;
}

export type StandardTypedValueV1 =
  | StandardProvidedValueV1
  | {
      value_state: Exclude<StandardValueState, "provided">;
    };

export interface StandardFieldValueV1 {
  field_id: string;
  macro_parameter: StandardMacroParameterId;
  typed_value: StandardTypedValueV1;
}

export interface CanonicalStandardFieldValueV1 extends StandardFieldValueV1 {
  translated: boolean;
  confidence: number;
}

export interface TransientConditionalRequirementV1 {
  requirement_id: string;
  condition: string;
  required_result: string;
  source_text: string;
  source_start_byte: number;
  source_end_byte: number;
  requirement_level: "mandatory" | "preferred";
}

export interface StandardIntakeSubmissionV1 {
  schema_version: typeof STANDARD_INTAKE_SUBMISSION_SCHEMA_VERSION;
  domain_pack_activation_token: string;
  source_language: string;
  source_text: string;
  fields: StandardFieldValueV1[];
  hard_constraints: StandardHardConstraintV1[];
  exclusions: StandardExclusionV1[];
  conditional_requirements: TransientConditionalRequirementV1[];
}

interface StandardHardConstraintBaseV1 {
  constraint_id: string;
  field_id: string;
  operator:
    "equals" | "not_equals" | "minimum" | "maximum" | "includes" | "excludes";
  target: StandardTypedValueV1;
}

export type StandardHardConstraintV1 = StandardHardConstraintBaseV1 &
  (
    | {
        relaxability: "relaxable";
        tolerance: string;
        direction: "higher_is_acceptable" | "lower_is_acceptable" | "exact";
      }
    | { relaxability: "non_relaxable" }
  );

export interface StandardExclusionV1 {
  exclusion_id: string;
  field_id: string;
  canonical_english_value: string;
}

export interface CanonicalConditionalRequirementV1 {
  requirement_id: string;
  canonical_english_condition: string;
  canonical_english_result: string;
  requirement_level: "mandatory" | "preferred";
  source_validation: {
    algorithm: "HMAC-SHA-256";
    key_id: string;
    source_digest: string;
    source_start_byte: number;
    source_end_byte: number;
    byte_length: number;
  };
}

export interface StandardContradictionAlternativeV1 {
  alternative_id: string;
  canonical_english_value: string;
  field_ids: string[];
}

interface StandardContradictionBaseV1 {
  contradiction_id: string;
  contradiction_class: "hard_constraint" | "conditional" | "field_value";
  alternatives: StandardContradictionAlternativeV1[];
}

export type StandardContradictionV1 = StandardContradictionBaseV1 &
  (
    | { resolution_state: "unresolved" }
    | {
        resolution_state: "resolved_by_owner";
        selected_alternative_id: string;
      }
  );

export interface StructuredStandardRequestV1 {
  schema_version: typeof STRUCTURED_STANDARD_REQUEST_SCHEMA_VERSION;
  request_id: string;
  canonical_version_id: string;
  version: number;
  source_language: string;
  canonical_language: "en";
  domain_pack: {
    registry_version: string;
    pack_version: string;
    category_id: string;
  };
  fields: CanonicalStandardFieldValueV1[];
  hard_constraints: StandardHardConstraintV1[];
  exclusions: StandardExclusionV1[];
  conditional_requirements: CanonicalConditionalRequirementV1[];
  contradictions: StandardContradictionV1[];
  readiness: "ready" | "partially_ready" | "not_ready";
  created_at: string;
}
