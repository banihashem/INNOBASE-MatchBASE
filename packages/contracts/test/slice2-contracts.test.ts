import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_DIMENSIONS } from "../src/v1/standard-evidence.js";
import {
  assertNoSourceLanguagePersistence,
  assertStandardDimensionTuple,
  assertStandardHardConstraint,
  assertStandardIntakeServerAuthority,
  assertStandardTypedValue,
} from "../src/v1/standard-validation.js";
import { generateContractSchemas } from "../src/schema.js";

test("enforces discriminated Standard value and hard-constraint omissions", () => {
  for (const state of [
    "explicitly_unknown",
    "empty",
    "not_applicable",
    "not_asked",
  ]) {
    assert.doesNotThrow(() => assertStandardTypedValue({ value_state: state }));
    assert.throws(
      () => assertStandardTypedValue({ value_state: state, value: "" }),
      /forbidden fields/iu,
    );
  }
  assert.doesNotThrow(() =>
    assertStandardTypedValue({
      value_state: "provided",
      value: "100",
      unit: "pieces",
      raw_expression: "100 pcs",
    }),
  );
  const common = {
    constraint_id: "CON-1",
    field_id: "FLD-CORE-TR-01",
    operator: "minimum",
    target: { value_state: "provided", value: "100" },
  };
  assert.doesNotThrow(() =>
    assertStandardHardConstraint({
      ...common,
      relaxability: "relaxable",
      tolerance: "10 percent",
      direction: "lower_is_acceptable",
    }),
  );
  assert.doesNotThrow(() =>
    assertStandardHardConstraint({ ...common, relaxability: "non_relaxable" }),
  );
  assert.throws(
    () =>
      assertStandardHardConstraint({
        ...common,
        relaxability: "non_relaxable",
        tolerance: "",
      }),
    /forbidden fields/iu,
  );
});

test("rejects client authority and source-language persistence", () => {
  assert.throws(
    () => assertStandardIntakeServerAuthority({ request_id: "client-owned" }),
    /client-controlled authority/iu,
  );
  assert.throws(
    () => assertStandardIntakeServerAuthority({ compatibility_score: 100 }),
    /client-controlled authority/iu,
  );
  assert.throws(
    () =>
      assertNoSourceLanguagePersistence({
        conditional_requirements: [{ source_text: "canary" }],
      }),
    /forbidden source_text/iu,
  );
});

test("enforces exact dimension order, weights, and integer bounds", () => {
  const tuple = STANDARD_DIMENSIONS.map((dimension) => ({
    dimension_id: dimension.dimension_id,
    weight: dimension.weight,
    score: 70,
    confidence: "high",
  }));
  assert.doesNotThrow(() => assertStandardDimensionTuple(tuple));
  const wrongWeight = structuredClone(tuple);
  wrongWeight[0]!.weight = 20;
  assert.throws(
    () => assertStandardDimensionTuple(wrongWeight),
    /order, weight, or bounds/iu,
  );
  assert.throws(
    () => assertStandardDimensionTuple(tuple.slice(0, 5)),
    /exactly six/iu,
  );
});

test("separates transient conditional input from canonical review metadata", () => {
  const bundle = generateContractSchemas() as {
    schemas: Record<string, unknown>;
  };
  const schemas = bundle.schemas;
  const intake = schemas.standardIntakeSubmission as {
    properties: Record<string, unknown>;
  };
  const canonical = schemas.structuredStandardRequest as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.ok(intake.properties.conditional_requirements);
  assert.ok(canonical.required.includes("source_language"));
  assert.ok(canonical.properties.fields);
  assert.notDeepEqual(
    canonical.properties.fields,
    intake.properties.fields,
    "canonical fields must expose translation review metadata without expanding intake authority",
  );
  const detail = schemas.standardRequestDetail as {
    required: string[];
    additionalProperties: boolean;
  };
  assert.equal(detail.additionalProperties, false);
  assert.deepEqual(detail.required, [
    "schema_version",
    "canonical",
    "version_history",
    "links",
    "synthetic_warning",
    "projection_version",
  ]);
  for (const name of [
    "standardResultProjection",
    "standardRunProjection",
    "standardRequestHistory",
    "standardRequestDetail",
    "standardRequestVersionHistory",
    "standardRunHistory",
  ]) {
    const schema = schemas[name] as {
      properties: { projection_version: { enum: number[] } };
    };
    assert.deepEqual(schema.properties.projection_version.enum, [3], name);
  }
  const demo = schemas.demoProjection as {
    properties: { projection_version: { enum: number[] } };
  };
  assert.deepEqual(demo.properties.projection_version.enum, [1]);
});
