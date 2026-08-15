import type {
  StandardFieldValueV1,
  StandardHardConstraintV1,
  StandardExclusionV1,
  TransientConditionalRequirementV1,
} from "@matchbase/contracts";

export interface StandardIntakeInput {
  domain_pack_activation_token: string;
  source_language: string;
  source_text: string;
  fields: StandardFieldValueV1[];
  hard_constraints: StandardHardConstraintV1[];
  exclusions: StandardExclusionV1[];
  conditional_requirements: TransientConditionalRequirementV1[];
}

export interface StandardVersionInput {
  fields: StandardFieldValueV1[];
  hard_constraints: StandardHardConstraintV1[];
  exclusions: StandardExclusionV1[];
  readiness: "ready" | "partially_ready" | "not_ready";
}

export interface StandardContradictionResolutionInput {
  contradiction_id: string;
  selected_alternative: unknown;
  reason_english: string;
}

export interface StandardConfirmationInput {
  accepted: boolean;
  contradiction_resolutions: StandardContradictionResolutionInput[];
}

export interface StandardIdempotentResult<T extends Record<string, unknown>> {
  body: T;
  replayed: boolean;
}

export interface StandardRouteResult {
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}
