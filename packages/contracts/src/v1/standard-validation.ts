import { STANDARD_DIMENSIONS } from "./standard-evidence.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function closedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains forbidden fields: ${unexpected.join(", ")}.`,
    );
  }
}

export function assertStandardTypedValue(value: unknown): void {
  const item = record(value, "Standard typed value");
  const state = item.value_state;
  if (state === "provided") {
    closedKeys(
      item,
      ["value_state", "value", "unit", "raw_expression"],
      "Standard typed value",
    );
    if (typeof item.value !== "string" || item.value.length === 0) {
      throw new Error("A provided Standard value requires a non-empty value.");
    }
    for (const optional of ["unit", "raw_expression"] as const) {
      if (optional in item && typeof item[optional] !== "string") {
        throw new Error(`Standard typed value ${optional} must be a string.`);
      }
    }
    return;
  }
  if (
    state !== "explicitly_unknown" &&
    state !== "empty" &&
    state !== "not_applicable" &&
    state !== "not_asked"
  ) {
    throw new Error("Standard value_state is invalid.");
  }
  closedKeys(item, ["value_state"], "Non-provided Standard typed value");
}

export function assertStandardHardConstraint(value: unknown): void {
  const item = record(value, "Standard hard constraint");
  const common = [
    "constraint_id",
    "field_id",
    "operator",
    "target",
    "relaxability",
  ];
  assertStandardTypedValue(item.target);
  if (item.relaxability === "relaxable") {
    closedKeys(
      item,
      [...common, "tolerance", "direction"],
      "Relaxable hard constraint",
    );
    if (
      typeof item.tolerance !== "string" ||
      item.tolerance.length === 0 ||
      !["higher_is_acceptable", "lower_is_acceptable", "exact"].includes(
        String(item.direction),
      )
    ) {
      throw new Error(
        "Relaxable hard constraint requires bounded tolerance and direction.",
      );
    }
    return;
  }
  if (item.relaxability !== "non_relaxable") {
    throw new Error("Hard constraint relaxability is invalid.");
  }
  closedKeys(item, common, "Non-relaxable hard constraint");
}

export function assertStandardDimensionTuple(value: unknown): void {
  if (!Array.isArray(value) || value.length !== STANDARD_DIMENSIONS.length) {
    throw new Error("Standard dimension_scores requires exactly six values.");
  }
  STANDARD_DIMENSIONS.forEach((expected, index) => {
    const dimension = record(value[index], "Standard dimension score");
    closedKeys(
      dimension,
      ["dimension_id", "weight", "score", "confidence"],
      "Standard dimension score",
    );
    if (
      dimension.dimension_id !== expected.dimension_id ||
      dimension.weight !== expected.weight ||
      !Number.isInteger(dimension.score) ||
      Number(dimension.score) < 0 ||
      Number(dimension.score) > 100
    ) {
      throw new Error(
        `Standard dimension ${expected.dimension_id} violates order, weight, or bounds.`,
      );
    }
  });
}

export function assertStandardIntakeServerAuthority(value: unknown): void {
  const item = record(value, "Standard intake submission");
  const forbidden = [
    "request_id",
    "tier",
    "domain_pack",
    "pack_version",
    "compatibility_score",
    "fit_band",
    "band_ceiling",
    "displayed_band",
    "evidence",
    "result_count",
  ];
  const present = forbidden.filter((key) => key in item);
  if (present.length > 0) {
    throw new Error(
      `Standard intake contains client-controlled authority: ${present.join(", ")}.`,
    );
  }
}

export function assertNoSourceLanguagePersistence(value: unknown): void {
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(item)) {
      if (
        key === "source_text" ||
        key === "sourceText" ||
        key === "original_text"
      ) {
        throw new Error(
          `Persisted Standard request contains forbidden ${key}.`,
        );
      }
      visit(nested);
    }
  };
  visit(value);
}
