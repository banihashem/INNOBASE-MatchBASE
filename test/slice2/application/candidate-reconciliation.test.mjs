import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ingestLiveEvidence,
  sameLiveCandidateIdentity,
  reconcileLiveCandidateRecords,
  assembleLiveSuppliers,
  evaluateLiveCandidate,
} from "../../../packages/application/dist/live-supplier-evidence.js";

const host = "https://supplier.example.com";
const productQuote = "Example GmbH supplies Model 1500 S+ coffee machines.";
const identityQuote = "Example GmbH registered office Germany.";
const unknown = () => ({ status: "unknown", source_urls: [], quote: "" });
function record(name = "Example GmbH", website = host) {
  return {
    legal_name: name,
    country: "Germany",
    headquarters: "Unknown",
    website,
    supplier_type: "manufacturer",
    manufacturer_status: "direct_manufacturer",
    identity: unknown(),
    product: unknown(),
    product_name: "Model 1500 S+",
    product_family: "Coffee machines",
    product_origin: "Germany",
    facts: [],
    certifications: [],
    constraints: [],
    unknowns: [],
    risks: [],
  };
}
function evidenceFor(records) {
  const payload = {
    candidates: records,
    evidence: [
      {
        url: `${host}/catalog`,
        title: "Company catalog",
        publisher: "Example",
        source_type: "official_website",
        excerpt: identityQuote,
      },
    ],
    remaining_gaps: [],
    evidence_exhausted: true,
    summary: "Published company text.",
  };
  const evidence = new Map();
  ingestLiveEvidence(
    payload,
    [
      {
        url: `${host}/catalog`,
        title: "Catalog",
        content: `${identityQuote} ${productQuote} Product compliance is not met.`,
      },
    ],
    evidence,
  );
  return evidence;
}
const proof = (quote, status = "verified") => ({
  status,
  quote,
  source_urls: [`${host}/catalog`],
});

test("L13 exact complementary identity and product records form one grounded profile", () => {
  const a = record();
  a.identity = proof(identityQuote);
  const b = record("Example GmbH", null);
  b.country = "unknown";
  b.product = proof(productQuote);
  const evidence = evidenceFor([a, b]);
  assert.equal(sameLiveCandidateIdentity(a, b), true);
  const merged = reconcileLiveCandidateRecords([a, b], evidence);
  assert.equal(merged.length, 1);
  assert.deepEqual(evaluateLiveCandidate(merged[0], [], evidence), []);
  assert.equal(merged[0].country, "Germany");
  assert.equal(b.website, null);
});
test("L13 grounded proofs and evidenced unmet criteria survive a later unsupported record", () => {
  const a = record();
  a.identity = proof(identityQuote);
  a.product = proof(productQuote);
  a.constraints = [
    {
      ...proof("Product compliance is not met.", "unmet"),
      constraint: "Exact compliance",
      dimension: "compliance",
    },
  ];
  const b = record();
  b.identity = proof("Invented identity");
  b.product = unknown();
  b.constraints = [
    {
      ...proof("Invented compliance"),
      constraint: "Exact compliance",
      dimension: "compliance",
    },
  ];
  const e = evidenceFor([a, b]);
  const [merged] = reconcileLiveCandidateRecords([a, b], e);
  assert.equal(merged.identity.quote, identityQuote);
  assert.equal(merged.product.quote, productQuote);
  assert.equal(merged.constraints[0].status, "unmet");
  assert.ok(
    evaluateLiveCandidate(merged, ["Exact compliance"], e).some((reason) =>
      reason.includes("mismatch"),
    ),
  );
});
test("L13 exact names do not bridge countries, unrelated domains or ambiguous records", () => {
  const a = record();
  const b = record("Example GmbH", "https://different.example.net");
  assert.equal(sameLiveCandidateIdentity(a, b), false);
  const foreign = { ...a, country: "France" };
  assert.equal(sameLiveCandidateIdentity(a, foreign), false);
  assert.equal(
    sameLiveCandidateIdentity(a, {
      ...a,
      legal_name: "Example GmbH (affiliate)",
    }),
    false,
  );
  const missing = record("Example GmbH", null);
  missing.country = "unknown";
  assert.equal(
    reconcileLiveCandidateRecords([a, b, missing], new Map()).length,
    3,
  );
  assert.equal(
    sameLiveCandidateIdentity(
      record("Example GmbH", "https://a.co.uk"),
      record("Example GmbH", "https://b.co.uk"),
    ),
    false,
  );
});
test("L13 separate legal entities on one official host receive different stable entity IDs", () => {
  const a = record();
  a.identity = proof(identityQuote);
  a.product = proof(productQuote);
  const b = record("Another GmbH");
  b.identity = proof("Another GmbH registered office Germany.");
  b.product = proof(productQuote);
  const e = evidenceFor([a, b]);
  ingestLiveEvidence(
    {
      candidates: [b],
      evidence: [
        {
          url: `${host}/catalog`,
          title: "Group catalog",
          publisher: "Group",
          source_type: "official_website",
          excerpt: b.identity.quote,
        },
      ],
      remaining_gaps: [],
      evidence_exhausted: true,
      summary: "",
    },
    [
      {
        url: `${host}/catalog`,
        title: "Group catalog",
        content: b.identity.quote,
      },
    ],
    e,
  );
  assert.equal(reconcileLiveCandidateRecords([a, b], e).length, 2);
  const ids = new Map([
    ["supplier.example.com", "11111111-1111-4111-8111-111111111111"],
  ]);
  const first = assembleLiveSuppliers([a, b], [], e, 20, ids).candidates;
  assert.equal(first.length, 2);
  assert.notEqual(first[0].supplier_entity_id, first[1].supplier_entity_id);
  assert.equal(
    first[0].supplier_entity_id,
    "11111111-1111-4111-8111-111111111111",
  );
  const second = assembleLiveSuppliers([a, b], [], e, 20, ids).candidates;
  assert.deepEqual(
    second.map((item) => item.supplier_entity_id),
    first.map((item) => item.supplier_entity_id),
  );
  const reordered = assembleLiveSuppliers([b, a], [], e, 20, ids).candidates;
  assert.equal(
    reordered.find((item) => item.legal_name === a.legal_name)
      .supplier_entity_id,
    first[0].supplier_entity_id,
  );
  assert.equal(
    reordered.find((item) => item.legal_name === b.legal_name)
      .supplier_entity_id,
    first[1].supplier_entity_id,
  );
});
test("L13 decorative quote wrappers are accepted only around exact contiguous source text", () => {
  const a = record();
  a.identity = proof(`“${identityQuote}”`);
  a.product = proof(`“${productQuote}”`);
  const e = evidenceFor([a]);
  assert.deepEqual(evaluateLiveCandidate(a, [], e), []);
  const broken = { ...a, identity: proof("“Example GmbH … Germany.”") };
  const wrong = evidenceFor([broken]);
  assert.ok(evaluateLiveCandidate(broken, [], wrong).length > 0);
});

test("L13 wrapper-only proof quotes cannot verify an empty substring", () => {
  for (const quote of ['""', "“ ”", "‘ ’", "''"]) {
    const a = record();
    a.identity = proof(identityQuote);
    a.product = proof(quote);
    const e = evidenceFor([a]);
    assert.ok(
      evaluateLiveCandidate(a, [], e).some((reason) =>
        reason.includes("Product capability"),
      ),
    );
    assert.ok(
      !e
        .get(`${host}/catalog`)
        .verified_excerpts.some((item) => item.excerpt === quote),
    );
  }
});
