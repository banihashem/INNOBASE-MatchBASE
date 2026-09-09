import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIVE_DISCOVERY_SCHEMA,
  LIVE_FACT_FIELD_PATHS,
  ingestLiveEvidence,
  assembleLiveSuppliers,
  evaluateLiveCandidate,
} from "../../../packages/application/dist/live-supplier-evidence.js";
import {
  parseLiveJson,
  validateJsonSchema,
} from "../../../packages/application/dist/live-json-schema.js";
const url = "https://example-supplier.com/catalog";
const identity = "Example Supplier LLC is registered in the UAE.";
const product = "Example Supplier LLC sells Network Switch X100.";
const factValues = {
  country_of_registration: "UAE",
  headquarters_address: "Office 12 Dubai",
  manufacturing_location: "Factory A",
  country_of_origin: "Germany",
  "contacts.sales_email": "sales@example-supplier.com",
  "contacts.export_email": "export@example-supplier.com",
  "contacts.general_email": "info@example-supplier.com",
  "contacts.phone": "+971 4 1234567",
  "contacts.contact_page_url": "https://example-supplier.com/contact",
  "commercial.moq": "3 units",
  "commercial.production_capacity": "100 units per month",
  "commercial.lead_time": "subject to confirmation",
  "commercial.payment_terms": "bank transfer",
  "commercial.incoterm": "EXW",
  "commercial.incoterm_location": "Dubai",
  "commercial.price_validity": "30 September 2026",
  "commercial.currency": "AED",
  "commercial.unit": "unit",
  "commercial.price_min": "230.00",
  "commercial.price_max": "230.00",
  "specifications.model": "X100",
  "specifications.stock_status": "Sold out",
};
const sourceText = [identity, product, ...Object.values(factValues)].join("\n");
const proof = (quote) => ({ status: "verified", source_urls: [url], quote });
function fixture() {
  const candidate = {
    legal_name: "Example Supplier LLC",
    country: "UAE",
    headquarters: "Dubai",
    website: "https://example-supplier.com",
    supplier_type: "distributor",
    manufacturer_status: "trader_distributor",
    identity: proof(identity),
    product: proof(product),
    product_name: "Network Switch X100",
    product_family: "Network switches",
    product_origin: "Unknown",
    facts: Object.entries(factValues).map(([field_path, value]) => ({
      field_path,
      value,
      claim_type: field_path.startsWith("commercial.")
        ? "pricing"
        : field_path.startsWith("specifications.")
          ? "product_spec"
          : "identity",
      source_urls: [url],
      quote: value,
    })),
    certifications: [],
    constraints: [],
    unknowns: ["Current stock and fulfillment require confirmation"],
    risks: [],
  };
  return {
    candidates: [candidate],
    evidence: [
      {
        url,
        title: "Official catalog",
        publisher: "Example Supplier LLC",
        source_type: "official_website",
        excerpt: identity,
      },
    ],
    remaining_gaps: ["Current stock confirmation"],
    evidence_exhausted: false,
    summary: "Supplier listing, public contacts and observed price.",
  };
}
function assemble(payload) {
  const evidence = new Map();
  ingestLiveEvidence(
    payload,
    [{ url, title: "Catalog", content: sourceText }],
    evidence,
  );
  return {
    evidence,
    ...assembleLiveSuppliers(payload.candidates, [], evidence, 20),
  };
}
test("L14 canonical contact, identity, specification and price fields project with exact source proofs", () => {
  const p = parseLiveJson(JSON.stringify(fixture()), LIVE_DISCOVERY_SCHEMA);
  const result = assemble(p);
  assert.equal(result.candidates.length, 1);
  const c = result.candidates[0];
  assert.equal(c.contacts.sales_email, factValues["contacts.sales_email"]);
  assert.equal(c.contacts.phone, factValues["contacts.phone"]);
  assert.equal(c.contacts.verification_status, "verified");
  assert.ok(c.contacts.contact_evidence_ids.length);
  assert.equal(c.country_of_registration, "UAE");
  assert.equal(c.offering.country_of_origin, "Germany");
  assert.equal(c.commercial.price_min, 230);
  assert.equal(c.commercial.price_max, 230);
  assert.equal(c.commercial.currency, "AED");
  assert.equal(c.commercial.quotation_required, true);
  assert.equal(c.offering.specifications.stock_status, "Sold out");
  for (const field of LIVE_FACT_FIELD_PATHS)
    assert.ok(result.claims.some((claim) => claim.field_path === field));
});
test("L14 noncanonical and malformed fact paths fail extraction schema validation", () => {
  for (const field of [
    "presence",
    "presence UAE",
    "identity.country",
    "product.name",
    "facts.interface",
    "offering.product_name",
    "contacts.email",
    "commercial.price",
    "specifications.",
    "specifications.__proto__",
    "specifications.Stock-status",
    "specifications." + "a".repeat(65),
  ]) {
    const p = fixture();
    p.candidates[0].facts[0].field_path = field;
    assert.throws(
      () => parseLiveJson(JSON.stringify(p), LIVE_DISCOVERY_SCHEMA),
      /MB-422-LIVE-SCHEMA|Structured response failed validation/,
      field,
    );
  }
});
test("L14 local string schema validation enforces pattern and maximum length", () => {
  assert.doesNotThrow(() =>
    validateJsonSchema("abc", {
      type: "string",
      pattern: "^[a-z]+$",
      maxLength: 3,
    }),
  );
  assert.throws(
    () => validateJsonSchema("abcd", { type: "string", maxLength: 3 }),
    /Structured response failed validation/,
  );
  assert.throws(
    () => validateJsonSchema("abc123", { type: "string", pattern: "^[a-z]+$" }),
    /Structured response failed validation/,
  );
});
test("L14 canonical names do not launder unsupported contact or price values", () => {
  const p = fixture();
  const email = p.candidates[0].facts.find(
    (f) => f.field_path === "contacts.sales_email",
  );
  email.value = "invented@example-supplier.com";
  email.quote = email.value;
  const price = p.candidates[0].facts.find(
    (f) => f.field_path === "commercial.price_min",
  );
  price.value = "199.00";
  price.quote = price.value;
  const c = assemble(p).candidates[0];
  assert.equal(c.contacts.sales_email, undefined);
  assert.equal(c.commercial.price_min, undefined);
  assert.equal(c.commercial.price_max, 230);
});
test("L14 another supplier's product page cannot qualify a candidate without a source-backed relationship", () => {
  const p = fixture();
  const c = p.candidates[0];
  c.facts = [];
  const other = "https://different-vendor.com/catalog";
  c.product = {
    status: "verified",
    source_urls: [other],
    quote: "Different Vendor sells Network Switch X100.",
  };
  p.evidence.push({
    url: other,
    title: "Different vendor catalog",
    publisher: "Different Vendor",
    source_type: "official_website",
    excerpt: c.product.quote,
  });
  const e = new Map();
  ingestLiveEvidence(
    p,
    [
      { url, title: "Identity", content: identity },
      { url: other, title: "Catalog", content: c.product.quote },
    ],
    e,
  );
  assert.ok(
    evaluateLiveCandidate(c, [], e).some((problem) =>
      problem.includes("relationship"),
    ),
  );
});
test("L14 manufacturer datasheets require an exact own-site product relationship", () => {
  const p = fixture();
  const c = p.candidates[0];
  const other = "https://manufacturer.com/x100";
  c.product = {
    status: "verified",
    source_urls: [other],
    quote: "Network Switch X100 supports 24 ports.",
  };
  p.evidence.push({
    url: other,
    title: "Manufacturer X100 datasheet",
    publisher: "Manufacturer",
    source_type: "official_website",
    excerpt: c.product.quote,
  });
  const e = new Map();
  ingestLiveEvidence(
    p,
    [
      { url, title: "Company catalog", content: sourceText },
      { url: other, title: "Datasheet", content: c.product.quote },
    ],
    e,
  );
  assert.deepEqual(evaluateLiveCandidate(c, [], e), []);
  c.facts.find((f) => f.field_path === "specifications.model").value = "X10";
  assert.ok(
    evaluateLiveCandidate(c, [], e).some((problem) =>
      problem.includes("relationship"),
    ),
  );
  c.facts.find((f) => f.field_path === "specifications.model").value = "X100";
  c.product.quote = "Network Switch X999 supports 24 ports.";
  p.evidence.at(-1).excerpt = c.product.quote;
  const unrelated = new Map();
  ingestLiveEvidence(
    p,
    [
      { url, title: "Company catalog", content: sourceText },
      { url: other, title: "Different datasheet", content: c.product.quote },
    ],
    unrelated,
  );
  assert.ok(
    evaluateLiveCandidate(c, [], unrelated).some((problem) =>
      problem.includes("relationship"),
    ),
  );
});
