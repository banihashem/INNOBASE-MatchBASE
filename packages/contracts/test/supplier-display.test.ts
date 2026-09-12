import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displaySupplierText,
  getSupplierFactAlternatives,
  getSupplierLocationSummary,
  getSupplierProductOrigin,
  getSupplierWebsite,
} from "../src/v3/supplier-display.js";
import type {
  ClaimV3,
  EvidenceSourceV3,
} from "../src/v3/consultant-research-output.js";
import { GOLDEN_SCENARIO_V3_01 } from "../src/v3/golden-scenarios.js";

function observation(
  id: string,
  value: string,
  path = "headquarters_address",
): ClaimV3 {
  return {
    claim_id: id,
    supplier_entity_id: "supplier-a",
    claim_type: "identity",
    field_path: path,
    claim_text: `${path}: ${value}`,
    status: "supplier_claimed",
    confidence: "medium",
    conflict_status: "single_source",
    evidence_ids: [`evidence-${id}`],
  };
}

function source(claim: ClaimV3): EvidenceSourceV3 {
  return {
    evidence_id: claim.evidence_ids[0]!,
    source_id: `source-${claim.claim_id}`,
    source_url: "https://supplier.example/contact",
    source_title: "Supplier contact",
    publisher: "Supplier",
    source_type: "official_website",
    retrieved_at: "2026-09-12T00:00:00Z",
    freshness_status: "current",
    verification_status: "supplier_claimed",
    excerpt_summary: claim.claim_text,
    supports_claim_ids: [claim.claim_id],
    contradicts_claim_ids: [],
  };
}

test("reported headquarters remains visible when legal registration is not established", () => {
  const saved = {
    headquarters_address: "Weifang, Shandong, China",
    country_of_registration: "Not verified",
    manufacturing_locations: ["Vietnam"],
  };
  const original = structuredClone(saved);
  assert.deepEqual(getSupplierLocationSummary(saved), {
    label: "Headquarters",
    value: "Weifang, Shandong, China",
  });
  assert.deepEqual(saved, original);
});

test("MB-UX-QUALITY-001 L06 explicit origin specifications retain distinct wording and field identities without mutating canonical facts", () => {
  const base = GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!;
  const saved = {
    ...base,
    offering: {
      ...base.offering,
      country_of_origin: "Unknown",
      specifications: {
        origin: "Made In China",
        "Place Of Origin": "China",
        COUNTRY_OF_ORIGIN: ["India", "Not verified"],
      },
    },
  };
  const before = structuredClone(saved);
  assert.deepEqual(getSupplierProductOrigin(saved), {
    label: "Origin stated in specifications",
    value:
      "origin: Made In China; Place Of Origin: China; COUNTRY_OF_ORIGIN: India",
  });
  assert.deepEqual(saved, before);
  assert.deepEqual(
    getSupplierProductOrigin({
      ...saved,
      offering: { ...saved.offering, country_of_origin: "Germany" },
    }),
    {
      label: "Product origin",
      value: "Germany",
    },
  );
});

test("MB-UX-QUALITY-001 L06 origin fallback never substitutes company location, website, nearby specification keys or missing values", () => {
  const base = GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!;
  const saved = {
    ...base,
    headquarters_address: "Beijing, China",
    country_of_registration: "China",
    manufacturing_locations: ["China"],
    website: "https://supplier.cn",
    offering: {
      ...base.offering,
      country_of_origin: "Not verified",
      specifications: {
        origin: "N/A",
        place_of_origin: "Unknown",
        country_of_origin: 123,
        origin_port: "Shanghai",
        original_country: "China",
        headquarters: "China",
      },
    },
  };
  assert.deepEqual(getSupplierProductOrigin(saved), {
    label: "Product origin",
    value: "Not established",
  });
});

test("country and ambiguous addresses are not inferred or substituted across concepts", () => {
  assert.deepEqual(
    getSupplierLocationSummary({
      headquarters_address: "Cambridge; Singapore regional office",
      country_of_registration: "United States",
      manufacturing_locations: ["China"],
    }),
    { label: "Headquarters", value: "Cambridge; Singapore regional office" },
  );
});

test("fallback location keeps its recorded semantic label and ignores missing markers", () => {
  const supplier = {
    headquarters_address: " Not verified ",
    country_of_registration: "Germany",
    manufacturing_locations: [
      " Unknown ",
      "Factory A, Poland",
      "Factory A, Poland",
    ],
  };
  assert.deepEqual(getSupplierLocationSummary(supplier), {
    label: "Registered country",
    value: "Germany",
  });
  assert.deepEqual(
    getSupplierLocationSummary({ ...supplier, country_of_registration: "n/a" }),
    { label: "Manufacturing location", value: "Factory A, Poland" },
  );
  assert.deepEqual(
    getSupplierLocationSummary({
      headquarters_address: " ",
      country_of_registration: "UNKNOWN",
      manufacturing_locations: ["Not found"],
    }),
    { label: "Supplier location", value: "Not established" },
  );
});

test("missing markers normalize without erasing substantive qualification or applicability", () => {
  for (const missing of [
    null,
    undefined,
    "",
    "  ",
    "Not verified.",
    "N/A",
    "—",
  ])
    assert.equal(displaySupplierText(missing), "Not established");
  assert.equal(
    displaySupplierText("Not applicable — service provider"),
    "Not applicable — service provider",
  );
  assert.equal(
    displaySupplierText("Address not independently verified"),
    "Address not independently verified",
  );
  assert.equal(
    displaySupplierText("Unknown Manufacturing Ltd."),
    "Unknown Manufacturing Ltd.",
  );
  assert.equal(displaySupplierText("0"), "0");
});

test("website labels use the actual target even when domain metadata is absent or stale", () => {
  assert.deepEqual(
    getSupplierWebsite({ website: " https://supplier.example/contact " }),
    {
      href: "https://supplier.example/contact",
      label: "supplier.example",
    },
  );
});

test("missing or non-web website values never become clickable company links", () => {
  for (const website of [
    null,
    "Not found",
    "supplier.example",
    "javascript:alert(1)",
    "https://user:password@supplier.example",
  ])
    assert.equal(getSupplierWebsite({ website }), undefined);
});

test("legacy and normalized field observations remain visible with reciprocal evidence without rewriting the saved supplier", () => {
  const supplier = { supplier_entity_id: "supplier-a" };
  const claims = [
    observation("a", "Berlin, Germany"),
    { ...observation("b", "unused"), normalized_value: "Paris, France" },
  ];
  const sources = claims.map(source);
  const before = JSON.stringify({ supplier, claims, sources });
  const result = getSupplierFactAlternatives(supplier, claims, sources);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.label, "Headquarters");
  assert.deepEqual(result[0]!.observations, [
    { value: "Berlin, Germany", evidence_ids: ["evidence-a"] },
    { value: "Paris, France", evidence_ids: ["evidence-b"] },
  ]);
  assert.equal(JSON.stringify({ supplier, claims, sources }), before);
});

test("alternative view rejects unrelated, orphan, missing and unsupported prose while normalizing trivial duplicates", () => {
  const claims = [
    observation("a", "Berlin, Germany"),
    observation("b", "BERLIN,   GERMANY"),
    {
      ...observation("foreign", "Paris, France"),
      supplier_entity_id: "supplier-b",
    },
    observation("orphan", "London, UK"),
    observation("missing", "Not verified"),
    {
      ...observation("prose", "Tokyo, Japan"),
      claim_text: "This company might have another office.",
    },
  ];
  const sources = claims
    .map(source)
    .map((s) =>
      s.evidence_id === "evidence-orphan"
        ? { ...s, supports_claim_ids: [] }
        : s,
    );
  assert.deepEqual(
    getSupplierFactAlternatives(
      { supplier_entity_id: "supplier-a" },
      claims,
      sources,
    ),
    [],
  );
});

test("plural contacts and sites are not presented as competing scalar values", () => {
  const claims = [
    observation("a", "one@supplier.example", "contacts.sales_email"),
    observation("b", "two@supplier.example", "contacts.sales_email"),
    observation("c", "Factory A", "manufacturing_location"),
    observation("d", "Factory B", "manufacturing_location"),
  ];
  assert.deepEqual(
    getSupplierFactAlternatives(
      { supplier_entity_id: "supplier-a" },
      claims,
      claims.map(source),
    ),
    [],
  );
});

test("inferred or unverified values are not promoted into published source observations", () => {
  const observed = observation("observed", "Berlin, Germany");
  const inferred: ClaimV3 = {
    ...observation("inferred", "Paris, France"),
    status: "inferred",
  };
  const unverifiedSource = observation("unverified", "London, UK");
  const sources = [
    source(observed),
    source(inferred),
    { ...source(unverifiedSource), verification_status: "unknown" as const },
  ];
  assert.deepEqual(
    getSupplierFactAlternatives(
      { supplier_entity_id: "supplier-a" },
      [observed, inferred, unverifiedSource],
      sources,
    ),
    [],
  );
});
