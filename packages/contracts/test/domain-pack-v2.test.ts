import assert from "node:assert/strict";
import test from "node:test";
import {
  domainPackV2ContentSha256,
  parseDomainPackResolutionV2,
  parseDomainPackV2,
} from "../src/v2/domain-pack.js";
import { parseStructuredStandardRequestV2 } from "../src/v2/structured-request.js";

const packDefinition = {
  schema_version: "domain-pack.v2",
  discriminator: "food_agricultural_commodity",
  registry_version: "2026-09-01.1",
  pack_version: "2026-09-01.1",
  category_id: "food_agricultural_commodities",
  category_label: "Food and Agricultural Commodities",
  macro_parameters: [
    "product_specification",
    "supplier_producer_profile",
    "trade_structure_commercial_execution",
  ],
  core_fields: [],
  domain_fields: [
    {
      field_id: "commodity_variety",
      macro_parameter: "product_specification",
      label: "Variety",
      description: "Named variety.",
      kind: "text",
      requirement: "required",
      allowed_units: [],
      allowed_values: [],
    },
  ],
  synthetic: false,
};
const pack = {
  ...packDefinition,
  content_sha256: domainPackV2ContentSha256(
    packDefinition as unknown as Parameters<
      typeof domainPackV2ContentSha256
    >[0],
  ),
};

test("parses closed additive domain-pack and resolution v2 contracts", () => {
  assert.equal(parseDomainPackV2(pack).schema_version, "domain-pack.v2");
  const resolution = parseDomainPackResolutionV2({
    schema_version: "domain-pack-resolution.v2",
    discriminator: "food_agricultural_commodity",
    resolver_version: "governed-agricultural-category-resolver.v2",
    confidence: 1,
    activation_state: "confirmed",
    synthetic: false,
    category_id: pack.category_id,
    pack_version: pack.pack_version,
    content_sha256: pack.content_sha256,
    activation_token: "signed-token",
  });
  assert.equal(resolution.activation_state, "confirmed");
  assert.throws(() => parseDomainPackV2({ ...pack, widened: true }));
  assert.throws(() =>
    parseDomainPackResolutionV2({
      schema_version: "domain-pack-resolution.v2",
      discriminator: "food_agricultural_commodity",
      resolver_version: "governed-agricultural-category-resolver.v2",
      confidence: 1,
      activation_state: "confirmed",
      synthetic: false,
      category_id: pack.category_id,
      pack_version: pack.pack_version,
      content_sha256: "b".repeat(64),
    }),
  );
});

test("parses a closed structured request v2 with exact pack provenance", () => {
  const document = {
    schema_version: "structured-standard-request.v2",
    request_id: "REQ-1",
    canonical_version_id: "VER-1",
    version: 1,
    source_language: "en",
    canonical_language: "en",
    domain_pack: {
      schema_version: "domain-pack-binding.v2",
      registry_version: pack.registry_version,
      pack_version: pack.pack_version,
      category_id: pack.category_id,
      pack_schema_version: "domain-pack.v2",
      content_sha256: pack.content_sha256,
      resolver_version: "governed-agricultural-category-resolver.v2",
    },
    fields: [],
    hard_constraints: [],
    exclusions: [],
    conditional_requirements: [],
    contradictions: [],
    readiness: "not_ready",
    created_at: "2026-09-01T00:00:00.000Z",
  };
  assert.equal(
    parseStructuredStandardRequestV2(document).domain_pack.content_sha256,
    pack.content_sha256,
  );
  assert.throws(() =>
    parseStructuredStandardRequestV2({
      ...document,
      domain_pack: { ...document.domain_pack, resolver_version: "" },
    }),
  );
});
