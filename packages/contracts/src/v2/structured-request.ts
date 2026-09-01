import type {
  CanonicalConditionalRequirementV1,
  CanonicalStandardFieldValueV1,
  StandardContradictionV1,
  StandardExclusionV1,
  StandardHardConstraintV1,
} from "../v1/structured-request.js";

export const STRUCTURED_STANDARD_REQUEST_V2_SCHEMA_VERSION =
  "structured-standard-request.v2" as const;
export const DOMAIN_PACK_BINDING_V2_SCHEMA_VERSION =
  "domain-pack-binding.v2" as const;

export interface StructuredStandardRequestV2 {
  schema_version: typeof STRUCTURED_STANDARD_REQUEST_V2_SCHEMA_VERSION;
  request_id: string;
  canonical_version_id: string;
  version: number;
  source_language: string;
  canonical_language: "en";
  domain_pack: {
    schema_version: typeof DOMAIN_PACK_BINDING_V2_SCHEMA_VERSION;
    registry_version: string;
    pack_version: string;
    category_id: string;
    pack_schema_version: "domain-pack.v2";
    content_sha256: string;
    resolver_version: string;
  };
  fields: CanonicalStandardFieldValueV1[];
  hard_constraints: StandardHardConstraintV1[];
  exclusions: StandardExclusionV1[];
  conditional_requirements: CanonicalConditionalRequirementV1[];
  contradictions: StandardContradictionV1[];
  readiness: "ready" | "partially_ready" | "not_ready";
  created_at: string;
}

function closed(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  )
    throw new Error(`${label} is not closed.`);
  return item;
}

function nonempty(value: unknown, label: string): void {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
}

function typedValue(value: unknown, label: string): void {
  const initial = closed(
    value,
    ["value_state", "value", "unit", "raw_expression"],
    ["value_state"],
    label,
  );
  if (initial.value_state === "provided") {
    nonempty(initial.value, `${label} value`);
    for (const key of ["unit", "raw_expression"])
      if (key in initial && typeof initial[key] !== "string")
        throw new Error(`${label} ${key} is invalid.`);
  } else {
    if (
      !["explicitly_unknown", "empty", "not_applicable", "not_asked"].includes(
        String(initial.value_state),
      ) ||
      "value" in initial ||
      "unit" in initial ||
      "raw_expression" in initial
    )
      throw new Error(`${label} state is invalid.`);
  }
}

function uniqueIds(values: unknown[], key: string, label: string): void {
  const ids = values.map((entry) => {
    const item = entry as Record<string, unknown>;
    nonempty(item[key], `${label} id`);
    return String(item[key]);
  });
  if (new Set(ids).size !== ids.length)
    throw new Error(`${label} ids are duplicated.`);
}

export function parseStructuredStandardRequestV2(
  value: unknown,
): StructuredStandardRequestV2 {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  )
    throw new Error("Structured Standard request v2 must be an object.");
  const item = normalized as Record<string, unknown>;
  const keys = [
    "schema_version",
    "request_id",
    "canonical_version_id",
    "version",
    "source_language",
    "canonical_language",
    "domain_pack",
    "fields",
    "hard_constraints",
    "exclusions",
    "conditional_requirements",
    "contradictions",
    "readiness",
    "created_at",
  ];
  if (
    Object.keys(item).length !== keys.length ||
    Object.keys(item).some((key) => !keys.includes(key))
  )
    throw new Error("Structured Standard request v2 is not closed.");
  if (
    item.schema_version !== STRUCTURED_STANDARD_REQUEST_V2_SCHEMA_VERSION ||
    item.canonical_language !== "en"
  )
    throw new Error(
      "Structured Standard request v2 version or language is invalid.",
    );
  for (const key of [
    "request_id",
    "canonical_version_id",
    "source_language",
    "created_at",
  ])
    if (typeof item[key] !== "string" || !String(item[key]).trim())
      throw new Error(`Structured Standard request v2 ${key} is invalid.`);
  try {
    if (new Date(String(item.created_at)).toISOString() !== item.created_at)
      throw new Error();
  } catch {
    throw new Error("Structured Standard request v2 created_at is invalid.");
  }
  if (!Number.isSafeInteger(item.version) || Number(item.version) < 1)
    throw new Error("Structured Standard request v2 version is invalid.");
  if (
    !["ready", "partially_ready", "not_ready"].includes(String(item.readiness))
  )
    throw new Error("Structured Standard request v2 readiness is invalid.");
  for (const key of [
    "fields",
    "hard_constraints",
    "exclusions",
    "conditional_requirements",
    "contradictions",
  ])
    if (!Array.isArray(item[key]))
      throw new Error(`Structured Standard request v2 ${key} is invalid.`);
  if (
    !item.domain_pack ||
    typeof item.domain_pack !== "object" ||
    Array.isArray(item.domain_pack)
  )
    throw new Error("Structured Standard request v2 pack binding is invalid.");
  const binding = item.domain_pack as Record<string, unknown>;
  const bindingKeys = [
    "schema_version",
    "registry_version",
    "pack_version",
    "category_id",
    "pack_schema_version",
    "content_sha256",
    "resolver_version",
  ];
  if (
    Object.keys(binding).length !== bindingKeys.length ||
    Object.keys(binding).some((key) => !bindingKeys.includes(key))
  )
    throw new Error(
      "Structured Standard request v2 pack binding is not closed.",
    );
  if (
    binding.schema_version !== DOMAIN_PACK_BINDING_V2_SCHEMA_VERSION ||
    binding.pack_schema_version !== "domain-pack.v2"
  )
    throw new Error(
      "Structured Standard request v2 pack binding version is invalid.",
    );
  for (const key of [
    "registry_version",
    "pack_version",
    "category_id",
    "resolver_version",
  ])
    if (typeof binding[key] !== "string" || !String(binding[key]).trim())
      throw new Error(
        `Structured Standard request v2 pack binding ${key} is invalid.`,
      );
  if (!/^[a-f0-9]{64}$/u.test(String(binding.content_sha256)))
    throw new Error(
      "Structured Standard request v2 pack binding digest is invalid.",
    );
  const fields = item.fields as unknown[];
  fields.forEach((entry) => {
    const field = closed(
      entry,
      [
        "field_id",
        "macro_parameter",
        "typed_value",
        "translated",
        "confidence",
      ],
      [
        "field_id",
        "macro_parameter",
        "typed_value",
        "translated",
        "confidence",
      ],
      "Structured Standard request v2 field",
    );
    nonempty(field.field_id, "Structured Standard request v2 field id");
    if (
      ![
        "product_specification",
        "supplier_producer_profile",
        "trade_structure_commercial_execution",
      ].includes(String(field.macro_parameter)) ||
      typeof field.translated !== "boolean" ||
      typeof field.confidence !== "number" ||
      field.confidence < 0 ||
      field.confidence > 1
    )
      throw new Error(
        "Structured Standard request v2 field metadata is invalid.",
      );
    typedValue(field.typed_value, "Structured Standard request v2 field value");
  });
  uniqueIds(fields, "field_id", "Structured Standard request v2 field");
  const fieldIds = new Set(
    fields.map((field) => String((field as Record<string, unknown>).field_id)),
  );

  const constraints = item.hard_constraints as unknown[];
  constraints.forEach((entry) => {
    const candidate = closed(
      entry,
      [
        "constraint_id",
        "field_id",
        "operator",
        "target",
        "relaxability",
        "tolerance",
        "direction",
      ],
      ["constraint_id", "field_id", "operator", "target", "relaxability"],
      "Structured Standard request v2 hard constraint",
    );
    nonempty(
      candidate.constraint_id,
      "Structured Standard request v2 constraint id",
    );
    nonempty(
      candidate.field_id,
      "Structured Standard request v2 constraint field",
    );
    if (!fieldIds.has(String(candidate.field_id)))
      throw new Error(
        "Structured Standard request v2 constraint field is unknown.",
      );
    if (
      ![
        "equals",
        "not_equals",
        "minimum",
        "maximum",
        "includes",
        "excludes",
      ].includes(String(candidate.operator))
    )
      throw new Error(
        "Structured Standard request v2 constraint operator is invalid.",
      );
    typedValue(
      candidate.target,
      "Structured Standard request v2 constraint target",
    );
    if (candidate.relaxability === "relaxable") {
      nonempty(
        candidate.tolerance,
        "Structured Standard request v2 constraint tolerance",
      );
      if (
        !["higher_is_acceptable", "lower_is_acceptable", "exact"].includes(
          String(candidate.direction),
        )
      )
        throw new Error(
          "Structured Standard request v2 constraint direction is invalid.",
        );
    } else if (
      candidate.relaxability !== "non_relaxable" ||
      "tolerance" in candidate ||
      "direction" in candidate
    )
      throw new Error(
        "Structured Standard request v2 constraint relaxability is invalid.",
      );
  });
  uniqueIds(
    constraints,
    "constraint_id",
    "Structured Standard request v2 constraint",
  );

  const exclusions = item.exclusions as unknown[];
  exclusions.forEach((entry) => {
    const exclusion = closed(
      entry,
      ["exclusion_id", "field_id", "canonical_english_value"],
      ["exclusion_id", "field_id", "canonical_english_value"],
      "Structured Standard request v2 exclusion",
    );
    for (const key of ["exclusion_id", "field_id", "canonical_english_value"])
      nonempty(
        exclusion[key],
        `Structured Standard request v2 exclusion ${key}`,
      );
    if (!fieldIds.has(String(exclusion.field_id)))
      throw new Error(
        "Structured Standard request v2 exclusion field is unknown.",
      );
  });
  uniqueIds(
    exclusions,
    "exclusion_id",
    "Structured Standard request v2 exclusion",
  );

  const conditionals = item.conditional_requirements as unknown[];
  conditionals.forEach((entry) => {
    const conditional = closed(
      entry,
      [
        "requirement_id",
        "canonical_english_condition",
        "canonical_english_result",
        "requirement_level",
        "source_validation",
      ],
      [
        "requirement_id",
        "canonical_english_condition",
        "canonical_english_result",
        "requirement_level",
        "source_validation",
      ],
      "Structured Standard request v2 conditional requirement",
    );
    for (const key of [
      "requirement_id",
      "canonical_english_condition",
      "canonical_english_result",
    ])
      nonempty(
        conditional[key],
        `Structured Standard request v2 conditional ${key}`,
      );
    if (
      !["mandatory", "preferred"].includes(
        String(conditional.requirement_level),
      )
    )
      throw new Error(
        "Structured Standard request v2 conditional level is invalid.",
      );
    const source = closed(
      conditional.source_validation,
      [
        "algorithm",
        "key_id",
        "source_digest",
        "source_start_byte",
        "source_end_byte",
        "byte_length",
      ],
      [
        "algorithm",
        "key_id",
        "source_digest",
        "source_start_byte",
        "source_end_byte",
        "byte_length",
      ],
      "Structured Standard request v2 conditional source validation",
    );
    if (
      source.algorithm !== "HMAC-SHA-256" ||
      !/^[a-f0-9]{64}$/u.test(String(source.source_digest))
    )
      throw new Error(
        "Structured Standard request v2 conditional source digest is invalid.",
      );
    nonempty(
      source.key_id,
      "Structured Standard request v2 conditional key id",
    );
    for (const key of ["source_start_byte", "source_end_byte", "byte_length"])
      if (!Number.isSafeInteger(source[key]) || Number(source[key]) < 0)
        throw new Error(
          "Structured Standard request v2 conditional source bounds are invalid.",
        );
    if (Number(source.source_end_byte) <= Number(source.source_start_byte))
      throw new Error(
        "Structured Standard request v2 conditional source range is invalid.",
      );
    if (
      Number(source.source_end_byte) - Number(source.source_start_byte) !==
      Number(source.byte_length)
    )
      throw new Error(
        "Structured Standard request v2 conditional source length is invalid.",
      );
  });
  uniqueIds(
    conditionals,
    "requirement_id",
    "Structured Standard request v2 conditional",
  );

  const contradictions = item.contradictions as unknown[];
  contradictions.forEach((entry) => {
    const contradiction = closed(
      entry,
      [
        "contradiction_id",
        "contradiction_class",
        "alternatives",
        "resolution_state",
        "selected_alternative_id",
      ],
      [
        "contradiction_id",
        "contradiction_class",
        "alternatives",
        "resolution_state",
      ],
      "Structured Standard request v2 contradiction",
    );
    nonempty(
      contradiction.contradiction_id,
      "Structured Standard request v2 contradiction id",
    );
    if (
      !["hard_constraint", "conditional", "field_value"].includes(
        String(contradiction.contradiction_class),
      ) ||
      !Array.isArray(contradiction.alternatives) ||
      contradiction.alternatives.length < 2
    )
      throw new Error(
        "Structured Standard request v2 contradiction is invalid.",
      );
    const alternativeIds = new Set<string>();
    contradiction.alternatives.forEach((entry) => {
      const alternative = closed(
        entry,
        ["alternative_id", "canonical_english_value", "field_ids"],
        ["alternative_id", "canonical_english_value", "field_ids"],
        "Structured Standard request v2 contradiction alternative",
      );
      nonempty(
        alternative.alternative_id,
        "Structured Standard request v2 alternative id",
      );
      if (alternativeIds.has(String(alternative.alternative_id)))
        throw new Error(
          "Structured Standard request v2 alternative ids are duplicated.",
        );
      alternativeIds.add(String(alternative.alternative_id));
      nonempty(
        alternative.canonical_english_value,
        "Structured Standard request v2 alternative value",
      );
      if (
        !Array.isArray(alternative.field_ids) ||
        alternative.field_ids.some(
          (fieldId) => typeof fieldId !== "string" || !fieldId.trim(),
        )
      )
        throw new Error(
          "Structured Standard request v2 alternative field ids are invalid.",
        );
      if (
        alternative.field_ids.some((fieldId) => !fieldIds.has(String(fieldId)))
      )
        throw new Error(
          "Structured Standard request v2 alternative field is unknown.",
        );
    });
    if (contradiction.resolution_state === "resolved_by_owner") {
      nonempty(
        contradiction.selected_alternative_id,
        "Structured Standard request v2 selected alternative",
      );
      if (!alternativeIds.has(String(contradiction.selected_alternative_id)))
        throw new Error(
          "Structured Standard request v2 selected alternative is unknown.",
        );
    } else if (
      contradiction.resolution_state !== "unresolved" ||
      "selected_alternative_id" in contradiction
    )
      throw new Error(
        "Structured Standard request v2 contradiction resolution is invalid.",
      );
  });
  uniqueIds(
    contradictions,
    "contradiction_id",
    "Structured Standard request v2 contradiction",
  );
  return Object.freeze(normalized as StructuredStandardRequestV2);
}
