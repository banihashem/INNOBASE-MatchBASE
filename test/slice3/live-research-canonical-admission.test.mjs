import assert from "node:assert/strict";
import test from "node:test";

import { liveProviderRequestFromCanonicalDocument } from "../../packages/application/dist/index.js";

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
