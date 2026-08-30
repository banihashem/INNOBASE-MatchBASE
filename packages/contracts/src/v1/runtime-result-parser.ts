import type { DemoProjectionV1 } from "./result-projection.js";
import type { StandardResultProjectionV1 } from "./standard-projection.js";
import {
  CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_VERSION,
  parseConsultantResultProjectionV1,
} from "./consultant-projection.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !actual.includes(key))
  )
    throw new Error(`${label} is not closed.`);
}

function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function parseDemoProjectionV1(value: unknown): DemoProjectionV1 {
  const projection = record(value, "Demo result projection");
  exactKeys(
    projection,
    [
      "schema_version",
      "run_id",
      "outcome",
      "scarcity",
      "candidates",
      "unmet_mandatory_constraints",
      "limitations_notice",
      "projection_version",
    ],
    "Demo result projection",
  );
  if (
    projection.schema_version !== "demo-projection.v1" ||
    projection.projection_version !== 1 ||
    !["matched", "no_responsible_match"].includes(String(projection.outcome)) ||
    !["none", "limited", "zero"].includes(String(projection.scarcity))
  )
    throw new Error("Demo result projection discriminator is invalid.");
  nonempty(projection.run_id, "Demo result run id");
  nonempty(projection.limitations_notice, "Demo result limitations notice");
  array(
    projection.unmet_mandatory_constraints,
    "Demo unmet constraints",
  ).forEach((item) => nonempty(item, "Demo unmet constraint"));
  array(projection.candidates, "Demo candidates").forEach((entry) => {
    const candidate = record(entry, "Demo candidate");
    exactKeys(
      candidate,
      ["display_name", "country_code", "rationale_short"],
      "Demo candidate",
    );
    for (const key of ["display_name", "country_code", "rationale_short"])
      nonempty(candidate[key], `Demo candidate ${key}`);
  });
  return deepFreeze(structuredClone(value) as DemoProjectionV1);
}

export function parseStandardResultProjectionV1(
  value: unknown,
): StandardResultProjectionV1 {
  const projection = record(value, "Standard result projection");
  exactKeys(
    projection,
    [
      "schema_version",
      "run_id",
      "outcome",
      "scarcity",
      "candidates",
      "gate_eliminations",
      "scarcity_analysis",
      "limitations",
      "synthetic_warning",
      "projection_version",
    ],
    "Standard result projection",
  );
  if (
    projection.schema_version !== "standard-result-projection.v1" ||
    projection.projection_version !== 4
  )
    throw new Error("Standard result projection discriminator is invalid.");
  const candidateCount = array(
    projection.candidates,
    "Standard result candidates",
  ).length;
  parseConsultantResultProjectionV1({
    ...structuredClone(projection),
    schema_version: CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
    landscape: {
      eligible_count: candidateCount,
      displayed_count: candidateCount,
      soft_cap: Math.max(3, candidateCount),
      truncated: false,
      scarcity_override_applied: candidateCount === 1 || candidateCount === 2,
    },
    consultant_source_readiness: {
      state: "limited",
      notice: "Runtime validation adapter for immutable Standard projection.",
    },
    projection_version: CONSULTANT_RESULT_PROJECTION_VERSION,
  });
  return deepFreeze(structuredClone(value) as StandardResultProjectionV1);
}
