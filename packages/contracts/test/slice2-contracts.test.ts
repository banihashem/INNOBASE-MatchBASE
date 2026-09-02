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
import {
  CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_VERSION,
  parseConsultantResultProjectionV1,
} from "../src/v1/consultant-projection.js";

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
    assert.deepEqual(schema.properties.projection_version.enum, [5], name);
    assert.equal(
      schema.properties.projection_version.enum.includes(4),
      false,
      `${name} must reject immutable disclosure projection v4`,
    );
  }
  const demo = schemas.demoProjection as {
    properties: { projection_version: { enum: number[] } };
  };
  assert.deepEqual(demo.properties.projection_version.enum, [1]);
});

test("closes the structured scarcity analysis schema", () => {
  type ObjectSchema = {
    required: string[];
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  type ArraySchema = { items: ObjectSchema };
  const assertClosedShape = (
    schema: ObjectSchema,
    value: Record<string, unknown>,
  ): void => {
    const missing = schema.required.filter((key) => !(key in value));
    const extra = Object.keys(value).filter(
      (key) => !(key in schema.properties),
    );
    if (
      missing.length > 0 ||
      (schema.additionalProperties === false && extra.length > 0)
    )
      throw new Error("closed schema rejection");
  };
  const bundle = generateContractSchemas() as {
    schemas: Record<string, ObjectSchema>;
  };
  const result = bundle.schemas.standardResultProjection!;
  assert.equal(result.additionalProperties, false);
  assert.ok(result.required.includes("scarcity_analysis"));
  const scarcity = result.properties.scarcity_analysis as ObjectSchema;
  assert.equal(scarcity.additionalProperties, false);
  assert.deepEqual(scarcity.required, [
    "reducing_constraints",
    "unmet_mandatory_constraints",
    "permitted_relaxations",
  ]);
  const reducing = (scarcity.properties.reducing_constraints as ArraySchema)
    .items;
  const unmet = (scarcity.properties.unmet_mandatory_constraints as ArraySchema)
    .items;
  const relaxations = (scarcity.properties.permitted_relaxations as ArraySchema)
    .items;
  assert.deepEqual(reducing.required, [
    "constraint_id",
    "field_id",
    "label",
    "eliminated_count",
  ]);
  assert.equal(reducing.additionalProperties, false);
  assert.deepEqual(unmet.required, ["constraint_id", "field_id", "label"]);
  assert.equal(unmet.additionalProperties, false);
  assert.deepEqual(relaxations.required, [
    "constraint_id",
    "field_id",
    "label",
    "direction",
    "tolerance",
  ]);
  assert.equal(relaxations.additionalProperties, false);

  const valid = {
    reducing_constraints: [],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [],
  };
  assert.doesNotThrow(() => assertClosedShape(scarcity, valid));
  assert.throws(
    () =>
      assertClosedShape(scarcity, {
        reducing_constraints: [],
        unmet_mandatory_constraints: [],
      }),
    /closed schema rejection/u,
  );
  assert.throws(
    () => assertClosedShape(scarcity, { ...valid, hidden_total: 12 }),
    /closed schema rejection/u,
  );
  assert.doesNotThrow(() =>
    assertClosedShape(reducing, {
      constraint_id: "CON-1",
      field_id: "FLD-1",
      label: "FLD-1 equals required",
      eliminated_count: 1,
    }),
  );
  assert.throws(
    () =>
      assertClosedShape(reducing, {
        constraint_id: "CON-1",
        field_id: "FLD-1",
        label: "FLD-1 equals required",
        eliminated_count: 1,
        source_text: "forbidden",
      }),
    /closed schema rejection/u,
  );
});

test("closes organization web contacts over a versioned purpose and form tuple", () => {
  const bundle = generateContractSchemas() as {
    schemas: Record<string, unknown>;
  };
  const serialized = JSON.stringify({
    graph: bundle.schemas.standardEvidenceGraph,
    projection: bundle.schemas.standardResultProjection,
  });
  for (const field of [
    "organization_web_policy_version",
    "organization_web_purpose",
    "organization_web_form",
    "organization-web-channel.v1",
    "organization_root",
    "role_path",
    "role_subdomain",
    "contact_role_path",
  ])
    assert.match(serialized, new RegExp(field.replaceAll(".", "\\."), "u"));
});

function validConsultantProjection(): Record<string, unknown> {
  return {
    schema_version: CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
    run_id: "00000000-0000-4000-8000-000000000001",
    outcome: "matched",
    scarcity: "limited",
    candidates: [
      {
        display_name: "Synthetic Candidate",
        country_code: "GB",
        rationale_extended: "Deterministic synthetic rationale.",
        compatibility_score: 70,
        fit_band: "potential_fit",
        band_ceiling: "potential_fit",
        displayed_band: "potential_fit",
        dimension_scores: STANDARD_DIMENSIONS.map((dimension) => ({
          dimension_id: dimension.dimension_id,
          weight: dimension.weight,
          score: 70,
          confidence: "medium",
        })),
        positive_drivers: [],
        limiting_gaps: [],
        citations: [],
        freshness: "current",
        verification_status: "unknown",
        evidence_confidence: "medium",
      },
    ],
    gate_eliminations: [],
    scarcity_analysis: {
      reducing_constraints: [],
      unmet_mandatory_constraints: [],
      permitted_relaxations: [],
    },
    limitations: {
      unknown_count: 0,
      not_asked_count: 0,
      affected_low_confidence_dimensions: [],
      evidence_states: ["unknown"],
      restricted_party_screening_notice: "Not a screening result.",
      advisory_boundary: "Advisory output only.",
    },
    synthetic_warning: "Synthetic contract fixture.",
    landscape: {
      eligible_count: 1,
      displayed_count: 1,
      soft_cap: 20,
      truncated: false,
      scarcity_override_applied: true,
    },
    consultant_source_readiness: {
      state: "limited",
      notice: "Governed Consultant sources are not released.",
    },
    projection_version: CONSULTANT_RESULT_PROJECTION_VERSION,
  };
}

test("publishes a closed shared Consultant projection schema", () => {
  const bundle = generateContractSchemas() as {
    schemas: Record<string, Record<string, unknown>>;
  };
  const schema = bundle.schemas.consultantResultProjection!;
  assert.equal(schema.additionalProperties, false);
  const properties = schema.properties as Record<
    string,
    { enum?: unknown[]; maxItems?: number }
  >;
  assert.deepEqual(properties.projection_version!.enum, [5]);
  const candidates = properties.candidates!;
  assert.equal(candidates.maxItems, undefined);
  assert.match(JSON.stringify(schema), /live_secure_fetch/u);
});

test("parses Consultant output and rejects unknown or inconsistent fields", () => {
  const valid = validConsultantProjection();
  const parsed = parseConsultantResultProjectionV1(valid);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.candidates), true);
  assert.throws(
    () =>
      parseConsultantResultProjectionV1({
        ...valid,
        hidden_supplier_score: 99,
      }),
    /not closed/iu,
  );
  const nested = structuredClone(valid);
  (nested.candidates as Array<Record<string, unknown>>)[0]!.hidden_claim = true;
  assert.throws(
    () => parseConsultantResultProjectionV1(nested),
    /not closed/iu,
  );
  const inconsistent = structuredClone(valid);
  (inconsistent.landscape as Record<string, unknown>).displayed_count = 0;
  assert.throws(
    () => parseConsultantResultProjectionV1(inconsistent),
    /landscape is inconsistent/iu,
  );
  assert.throws(
    () =>
      parseConsultantResultProjectionV1({
        ...valid,
        projection_version: 4,
      }),
    /version is invalid/iu,
  );
});

test("validates live Consultant citation locators and integer scores", () => {
  const valid = validConsultantProjection();
  const candidate = (valid.candidates as Array<Record<string, unknown>>)[0]!;
  candidate.citations = [
    {
      evidence_id: "EVID-LIVE-1",
      exact_url: "https://example.test/source",
      title: "Display claim",
      publisher: "Example",
      published_or_updated: "2026-08-25",
      accessed_at: "2026-08-25T00:00:00.000Z",
      source_tier: "primary",
      status: "claimed",
      access_state: "available",
      extract: "Bounded excerpt.",
      content_sha256: "a".repeat(64),
      provenance: "live_secure_fetch",
    },
  ];
  assert.doesNotThrow(() => parseConsultantResultProjectionV1(valid));

  for (const locator of [
    { exact_url: { hidden: true } },
    { exact_url: "http://example.test/source" },
    { fixture_identity: 42 },
  ]) {
    const malformed = structuredClone(valid);
    (malformed.candidates as Array<Record<string, unknown>>)[0]!.citations = [
      {
        ...(candidate.citations as Array<Record<string, unknown>>)[0],
        exact_url: undefined,
        ...locator,
      },
    ].map((citation) =>
      Object.fromEntries(
        Object.entries(citation).filter(([, value]) => value !== undefined),
      ),
    );
    assert.throws(() => parseConsultantResultProjectionV1(malformed));
  }

  const fractional = structuredClone(valid);
  (
    fractional.candidates as Array<Record<string, unknown>>
  )[0]!.compatibility_score = 70.5;
  assert.throws(
    () => parseConsultantResultProjectionV1(fractional),
    /must be an integer/iu,
  );
});
