import assert from "node:assert/strict";
import test from "node:test";

import { liveProviderRequestFromCanonicalDocument } from "../../packages/application/dist/index.js";
import { requestRequiresDatedCurrentStockEvidence } from "../../packages/application/dist/live-complete-result-v2.js";

test("live provider admission preserves canonical-request.v1", () => {
  assert.equal(
    liveProviderRequestFromCanonicalDocument({
      schema_version: "canonical-request.v1",
      canonical_text: "Identify qualified industrial automation suppliers.",
    }),
    "Identify qualified industrial automation suppliers.",
  );
});

test("live provider admission deterministically derives structured canonical truth", () => {
  const document = {
    schema_version: "structured-standard-request.v1",
    request_id: "request-1",
    canonical_version_id: "version-1",
    version: 1,
    source_language: "en",
    canonical_language: "en",
    domain_pack: {
      registry_version: "registry-1",
      pack_version: "pack-1",
      category_id: "industrial_automation",
    },
    fields: [
      {
        field_id: "product_need",
        macro_parameter: "product_specification",
        typed_value: {
          value_state: "provided",
          value: "Industrial automation control system PLC S7-1500",
          raw_expression: "must never reach a provider",
        },
        translated: false,
        confidence: 1,
      },
      {
        field_id: "unknown_supplier_claim",
        macro_parameter: "supplier_producer_profile",
        typed_value: { value_state: "explicitly_unknown" },
        translated: false,
        confidence: 1,
      },
    ],
    hard_constraints: [
      {
        constraint_id: "constraint-1",
        field_id: "destination_market",
        operator: "equals",
        target: { value_state: "provided", value: "United Arab Emirates" },
        relaxability: "non_relaxable",
      },
    ],
    exclusions: [
      {
        exclusion_id: "exclusion-1",
        field_id: "named_exclusions",
        canonical_english_value: "Exclude unsupported PLC families",
      },
    ],
    conditional_requirements: [
      {
        requirement_id: "conditional-1",
        canonical_english_condition: "If remote monitoring is enabled",
        canonical_english_result: "Encrypted telemetry is required",
        requirement_level: "mandatory",
        source_validation: {
          algorithm: "HMAC-SHA-256",
          key_id: "hidden-key-id",
          source_digest: "hidden-source-digest",
          source_start_byte: 0,
          source_end_byte: 1,
          byte_length: 1,
        },
      },
    ],
    contradictions: [],
    readiness: "ready",
    created_at: "2026-09-01T00:00:00.000Z",
  };
  const first = liveProviderRequestFromCanonicalDocument(document);
  const second = liveProviderRequestFromCanonicalDocument(
    structuredClone(document),
  );
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.schema_version, "live-provider-request.v1");
  assert.deepEqual(parsed.fields, [
    {
      field_id: "product_need",
      value: "Industrial automation control system PLC S7-1500",
    },
  ]);
  assert.equal(first.includes("must never reach a provider"), false);
  assert.equal(first.includes("hidden-source-digest"), false);
  assert.equal(first.includes("unknown_supplier_claim"), false);
});

test("exact Ahmad Aghaei v2 canonical request reaches research without a buyer-supplied date", () => {
  const field = (fieldId, macroParameter, value, unit, rawExpression) => ({
    field_id: fieldId,
    macro_parameter: macroParameter,
    typed_value: {
      value_state: "provided",
      value,
      ...(unit ? { unit } : {}),
      ...(rawExpression ? { raw_expression: rawExpression } : {}),
    },
    translated: false,
    confidence: 1,
  });
  const canonical = {
    schema_version: "structured-standard-request.v2",
    request_id: "ahmad-aghaei-request",
    canonical_version_id: "ahmad-aghaei-version",
    version: 1,
    source_language: "en",
    canonical_language: "en",
    domain_pack: {
      schema_version: "domain-pack-binding.v2",
      registry_version: "standard-domain-registry.v2",
      pack_version: "food-agricultural-commodity.v2",
      category_id: "food_agricultural_commodities",
      pack_schema_version: "domain-pack.v2",
      content_sha256: "a".repeat(64),
      resolver_version: "governed-agricultural-category-resolver.v2",
    },
    fields: [
      field(
        "commodity_variety",
        "product_specification",
        "Ahmad Aghaei pistachios",
      ),
      field("commodity_origin", "supplier_producer_profile", "Iranian origin"),
      field(
        "container_quantity",
        "trade_structure_commercial_execution",
        "3",
        "container",
      ),
      field("routing_via", "trade_structure_commercial_execution", "Dubai"),
      field(
        "distribution_destination",
        "trade_structure_commercial_execution",
        "African market",
      ),
      field(
        "current_stock",
        "supplier_producer_profile",
        "1",
        "container",
        "currently available in stock",
      ),
    ],
    hard_constraints: [],
    exclusions: [],
    conditional_requirements: [],
    contradictions: [],
    readiness: "ready",
    created_at: "2026-09-01T00:00:00.000Z",
  };
  const providerRequest = liveProviderRequestFromCanonicalDocument(canonical);
  const admitted = JSON.parse(providerRequest);
  assert.equal(requestRequiresDatedCurrentStockEvidence(providerRequest), true);
  assert.equal(admitted.category_id, "food_agricultural_commodities");
  assert.deepEqual(
    Object.fromEntries(admitted.fields.map((item) => [item.field_id, item])),
    {
      commodity_origin: {
        field_id: "commodity_origin",
        value: "Iranian origin",
      },
      commodity_variety: {
        field_id: "commodity_variety",
        value: "Ahmad Aghaei pistachios",
      },
      container_quantity: {
        field_id: "container_quantity",
        value: "3",
        unit: "container",
      },
      current_stock: {
        field_id: "current_stock",
        value: "1",
        unit: "container",
      },
      distribution_destination: {
        field_id: "distribution_destination",
        value: "African market",
      },
      routing_via: { field_id: "routing_via", value: "Dubai" },
    },
  );
  assert.doesNotMatch(
    JSON.stringify(admitted),
    /currently available in stock/u,
  );
});

test("live provider admission fails closed for unknown canonical schemas", () => {
  assert.throws(
    () =>
      liveProviderRequestFromCanonicalDocument({
        schema_version: "future-canonical-request.v99",
        canonical_text: "Do not admit this request.",
      }),
    /schema is unsupported/u,
  );
});
