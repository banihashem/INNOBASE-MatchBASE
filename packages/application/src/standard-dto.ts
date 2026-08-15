import type {
  StandardExclusionV1,
  StandardFieldValueV1,
  StandardHardConstraintV1,
  StructuredStandardRequestV1,
  TransientConditionalRequirementV1,
} from "@matchbase/contracts";
import type {
  StandardIntakeInput,
  StandardVersionInput,
} from "./standard-types.js";
import { ApplicationFault } from "./types.js";

function schema(message = "Submitted Standard payload is invalid."): never {
  throw new ApplicationFault(422, "schema-violation", "MB-422-SCHEMA", message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) schema();
  return value as Record<string, unknown>;
}

function closed(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) schema();
}

function text(value: unknown, max = 20_000): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > max
  )
    schema();
  return value;
}

function id(value: unknown): string {
  const result = text(value, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(result)) schema();
  return result;
}

function typedValue(value: unknown): StandardFieldValueV1["typed_value"] {
  const input = object(value);
  if (input.value_state === "provided") {
    closed(input, ["value_state", "value", "unit", "raw_expression"]);
    const result = {
      value_state: "provided" as const,
      value: text(input.value, 2_000),
    };
    return {
      ...result,
      ...(input.unit === undefined ? {} : { unit: text(input.unit, 100) }),
      ...(input.raw_expression === undefined
        ? {}
        : { raw_expression: text(input.raw_expression, 2_000) }),
    };
  }
  closed(input, ["value_state"]);
  if (
    !["explicitly_unknown", "empty", "not_applicable", "not_asked"].includes(
      String(input.value_state),
    )
  )
    schema();
  return {
    value_state: input.value_state as
      "explicitly_unknown" | "empty" | "not_applicable" | "not_asked",
  };
}

function fields(
  value: unknown,
  allowCanonicalMetadata = false,
): StandardFieldValueV1[] {
  if (!Array.isArray(value) || value.length > 64) schema();
  return value.map((candidate) => {
    const input = object(candidate);
    closed(
      input,
      allowCanonicalMetadata
        ? [
            "field_id",
            "macro_parameter",
            "typed_value",
            "translated",
            "confidence",
          ]
        : ["field_id", "macro_parameter", "typed_value"],
    );
    if (
      allowCanonicalMetadata &&
      (typeof input.translated !== "boolean" ||
        typeof input.confidence !== "number" ||
        input.confidence < 0 ||
        input.confidence > 1)
    )
      schema();
    if (
      ![
        "product_specification",
        "supplier_producer_profile",
        "trade_structure_commercial_execution",
      ].includes(String(input.macro_parameter))
    )
      schema();
    return {
      field_id: id(input.field_id),
      macro_parameter:
        input.macro_parameter as StandardFieldValueV1["macro_parameter"],
      typed_value: typedValue(input.typed_value),
    };
  });
}

function constraints(value: unknown): StandardHardConstraintV1[] {
  if (!Array.isArray(value) || value.length > 64) schema();
  return value.map((candidate) => {
    const input = object(candidate);
    const relaxable = input.relaxability === "relaxable";
    closed(
      input,
      relaxable
        ? [
            "constraint_id",
            "field_id",
            "operator",
            "target",
            "relaxability",
            "tolerance",
            "direction",
          ]
        : ["constraint_id", "field_id", "operator", "target", "relaxability"],
    );
    if (
      ![
        "equals",
        "not_equals",
        "minimum",
        "maximum",
        "includes",
        "excludes",
      ].includes(String(input.operator))
    )
      schema();
    if (!relaxable && input.relaxability !== "non_relaxable") schema();
    const base = {
      constraint_id: id(input.constraint_id),
      field_id: id(input.field_id),
      operator: input.operator as StandardHardConstraintV1["operator"],
      target: typedValue(input.target),
    };
    if (!relaxable) return { ...base, relaxability: "non_relaxable" };
    if (
      !["higher_is_acceptable", "lower_is_acceptable", "exact"].includes(
        String(input.direction),
      ) ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(String(input.tolerance))
    )
      schema();
    return {
      ...base,
      relaxability: "relaxable",
      tolerance: String(input.tolerance),
      direction: input.direction as
        "higher_is_acceptable" | "lower_is_acceptable" | "exact",
    };
  });
}

function exclusions(value: unknown): StandardExclusionV1[] {
  if (!Array.isArray(value) || value.length > 64) schema();
  return value.map((candidate) => {
    const input = object(candidate);
    closed(input, ["exclusion_id", "field_id", "canonical_english_value"]);
    return {
      exclusion_id: id(input.exclusion_id),
      field_id: id(input.field_id),
      canonical_english_value: text(input.canonical_english_value, 2_000),
    };
  });
}

function conditionals(value: unknown): TransientConditionalRequirementV1[] {
  if (!Array.isArray(value) || value.length > 32) schema();
  return value.map((candidate) => {
    const input = object(candidate);
    closed(input, [
      "requirement_id",
      "condition",
      "required_result",
      "source_text",
      "source_start_byte",
      "source_end_byte",
      "requirement_level",
    ]);
    if (
      !Number.isSafeInteger(input.source_start_byte) ||
      !Number.isSafeInteger(input.source_end_byte) ||
      !["mandatory", "preferred"].includes(String(input.requirement_level))
    )
      schema();
    return {
      requirement_id: id(input.requirement_id),
      condition: text(input.condition, 2_000),
      required_result: text(input.required_result, 2_000),
      source_text: text(input.source_text, 4_000),
      source_start_byte: input.source_start_byte as number,
      source_end_byte: input.source_end_byte as number,
      requirement_level: input.requirement_level as "mandatory" | "preferred",
    };
  });
}

export function parseStandardIntake(value: unknown): StandardIntakeInput {
  const input = object(value);
  closed(input, [
    "schema_version",
    "domain_pack_activation_token",
    "source_language",
    "source_text",
    "fields",
    "hard_constraints",
    "exclusions",
    "conditional_requirements",
  ]);
  if (input.schema_version !== "standard-intake-submission.v1") schema();
  const sourceLanguage = text(input.source_language, 35);
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(sourceLanguage)) schema();
  return {
    domain_pack_activation_token: text(
      input.domain_pack_activation_token,
      4_000,
    ),
    source_language: sourceLanguage,
    source_text: text(input.source_text),
    fields: fields(input.fields),
    hard_constraints: constraints(input.hard_constraints),
    exclusions: exclusions(input.exclusions),
    conditional_requirements: conditionals(input.conditional_requirements),
  };
}

export function parseStandardVersion(value: unknown): StandardVersionInput {
  const envelope = object(value);
  closed(envelope, ["structured_request"]);
  const input = object(envelope.structured_request);
  closed(input, [
    "schema_version",
    "request_id",
    "canonical_version_id",
    "version",
    "canonical_language",
    "domain_pack",
    "fields",
    "hard_constraints",
    "exclusions",
    "conditional_requirements",
    "contradictions",
    "readiness",
    "created_at",
    "source_language",
  ]);
  if (
    input.schema_version !== "structured-standard-request.v1" ||
    !["ready", "partially_ready", "not_ready"].includes(String(input.readiness))
  )
    schema();
  return {
    fields: fields(input.fields, true),
    hard_constraints: constraints(input.hard_constraints),
    exclusions: exclusions(input.exclusions),
    readiness: input.readiness as StandardVersionInput["readiness"],
  };
}

export function parseDomainResolution(value: unknown): {
  source_text: string;
  category_id?: string;
} {
  const input = object(value);
  closed(input, ["source_text", "confirmed_category_id"]);
  return {
    source_text: text(input.source_text),
    ...(input.confirmed_category_id === undefined
      ? {}
      : { category_id: id(input.confirmed_category_id) }),
  };
}

export function parseConfirmation(value: unknown): {
  accepted: boolean;
  contradiction_resolutions: Array<{
    contradiction_id: string;
    selected_alternative: unknown;
    reason_english: string;
  }>;
} {
  const input = object(value);
  closed(input, ["accepted", "contradiction_resolutions"]);
  if (
    typeof input.accepted !== "boolean" ||
    !Array.isArray(input.contradiction_resolutions) ||
    input.contradiction_resolutions.length > 32
  )
    schema();
  const contradiction_resolutions = input.contradiction_resolutions.map(
    (candidate) => {
      const row = object(candidate);
      closed(row, [
        "contradiction_id",
        "selected_alternative",
        "reason_english",
      ]);
      return {
        contradiction_id: id(row.contradiction_id),
        selected_alternative: row.selected_alternative,
        reason_english: text(row.reason_english, 2_000),
      };
    },
  );
  return { accepted: input.accepted, contradiction_resolutions };
}

export function parseRunSubmission(value: unknown): {
  request_id: string;
  canonical_request_version: number;
} {
  const input = object(value);
  closed(input, ["request_id", "canonical_request_version"]);
  if (
    !Number.isSafeInteger(input.canonical_request_version) ||
    Number(input.canonical_request_version) < 1
  )
    schema();
  return {
    request_id: text(input.request_id, 50),
    canonical_request_version: input.canonical_request_version as number,
  };
}

export type { StructuredStandardRequestV1 };
