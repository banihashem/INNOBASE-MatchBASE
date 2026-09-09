import assert from "node:assert/strict";
import { test } from "node:test";
import { repairSourceTranscription } from "../../../packages/application/dist/source-transcription-repair.js";
import {
  assembleLiveSuppliers,
  ingestLiveEvidence,
  restoreVerifiedOfficialWebsites,
} from "../../../packages/application/dist/live-supplier-evidence.js";

function fixture() {
  const identityUrl = "https://www.aster.example.com/about";
  const productUrl = "https://www.aster.example.com/model-123";
  const candidate = {
    legal_name: "Aster Industries L.L.C",
    country: "Unknown",
    headquarters: "Unknown",
    website: "https://www.aster.example.com",
    supplier_type: "distributor",
    manufacturer_status: "trader_distributor",
    identity: {
      status: "verified",
      source_urls: [identityUrl],
      quote: "Aster Industries LLC is a distributor",
    },
    product_name: "Model-123 industrial pump",
    product_family: "Pump",
    product_origin: "Unknown",
    product: {
      status: "verified",
      source_urls: ["https://aster.example.com/model-123"],
      quote: "Model-123 industrial pump",
    },
    facts: [],
    certifications: [],
    constraints: [],
    unknowns: ["", "Delivery date requires confirmation"],
    risks: [],
  };
  const citations = [
    { url: identityUrl, title: "About" },
    { url: productUrl, title: "Product" },
  ];
  const retrieved = new Map(
    citations.map((citation, index) => [
      citation.url,
      {
        url: citation.url,
        text: index
          ? "Model-123 industrial pump. Sold out. Phone +971 4 1234567 sales@aster.example.com"
          : "Company Name Aster Industries L.L.C. Registered commercial supplier.",
        retrieved_at: "2026-09-09T00:00:00Z",
        content_sha256: "a".repeat(64),
      },
    ]),
  );
  return { candidate, citations, retrieved };
}

test("L14 partial non-ASCII email matches cannot introduce a null proof or crash ingestion", () => {
  const { candidate, citations, retrieved } = fixture();
  retrieved.get(citations[1].url).text =
    "Model-123 industrial pump. Contact ésales@aster.example.com";
  const result = repairSourceTranscription([candidate], citations, retrieved);
  const evidence = new Map();
  assert.doesNotThrow(() =>
    ingestLiveEvidence(result, citations, evidence, retrieved),
  );
  assert.ok(
    result.candidates[0].facts.every((fact) => typeof fact.quote === "string"),
  );
  assert.ok(
    !result.candidates[0].facts.some(
      (fact) => fact.value === "sales@aster.example.com",
    ),
  );
});

test("L14 public listing price is copied literally only when its amount and currency are unambiguous", () => {
  for (const [prices, expected] of [
    ["Regular price AED 230.00 Sale price AED 230.00", "230.00"],
    ["Regular price AED 230.00 Sale price AED 199.00", undefined],
    ["Regular price AED 1,230.00", undefined],
    ["Price AED 230.00-250.00", undefined],
    ["Price AED 230.00 to 250.00", undefined],
  ]) {
    const { candidate, citations, retrieved } = fixture();
    retrieved.get(citations[1].url).text += ` ${prices}`;
    const result = repairSourceTranscription([candidate], citations, retrieved);
    assert.equal(
      result.candidates[0].facts.find(
        (fact) => fact.field_path === "commercial.price_min",
      )?.value,
      expected,
    );
    if (expected)
      assert.match(
        result.candidates[0].risks.join(" "),
        /not a current supplier quotation/,
      );
  }
});

test("L14 literal price repair never combines a new amount with an existing different currency", () => {
  const { candidate, citations, retrieved } = fixture();
  candidate.facts.push({
    field_path: "commercial.currency",
    value: "EUR",
    claim_type: "pricing",
    source_urls: [citations[1].url],
    quote: "Prior price EUR",
  });
  retrieved.get(citations[1].url).text += " Price AED 230.00";
  const result = repairSourceTranscription([candidate], citations, retrieved);
  assert.ok(
    !result.candidates[0].facts.some(
      (fact) => fact.field_path === "commercial.price_min",
    ),
  );
  assert.equal(
    result.candidates[0].facts.find(
      (fact) => fact.field_path === "commercial.currency",
    ).value,
    "EUR",
  );
});

test("L14 exact source transcription recovers own-site name, observed URL alias and public contact without another search", () => {
  const { candidate, citations, retrieved } = fixture();
  const before = structuredClone(candidate);
  const result = repairSourceTranscription([candidate], citations, retrieved);
  const evidence = new Map();
  ingestLiveEvidence(result, citations, evidence, retrieved);
  const output = assembleLiveSuppliers(result.candidates, [], evidence, 20);
  assert.equal(output.candidates.length, 1);
  assert.equal(
    output.candidates[0].contacts.sales_email,
    "sales@aster.example.com",
  );
  assert.equal(output.candidates[0].contacts.phone, "+971 4 1234567");
  assert.match(
    output.candidates[0].assessment.risk_flags.join(" "),
    /sold out/,
  );
  assert.equal(output.candidates[0].commercial.price_min, undefined);
  assert.deepEqual(candidate, before);
  assert.ok(
    result.evidence.every((entry) =>
      retrieved.get(entry.url).text.includes(entry.excerpt),
    ),
  );
});

test("L14 transcription never creates a legal alias, uncited URL or product from another supplier", () => {
  const { candidate, citations, retrieved } = fixture();
  candidate.legal_name = "Aster Industries Holdings L.L.C";
  const result = repairSourceTranscription([candidate], citations, retrieved);
  assert.equal(result.evidence.length, 0);
  candidate.legal_name = "Aster Industries L.L.C";
  candidate.product.source_urls = ["https://other.example.com/model-123"];
  const second = repairSourceTranscription([candidate], citations, retrieved);
  assert.deepEqual(second.candidates[0].product, candidate.product);
  assert.ok(
    second.evidence.every((entry) =>
      citations.some((citation) => citation.url === entry.url),
    ),
  );
});

test("L14 existing unmet capability and unknown mentions cannot become verified offerings through transcription", () => {
  for (const status of ["unmet", "unknown"]) {
    const { candidate, citations, retrieved } = fixture();
    candidate.product.status = status;
    candidate.product.quote = "We do not supply Model-123 industrial pump";
    retrieved.get(citations[1].url).text = candidate.product.quote;
    const result = repairSourceTranscription([candidate], citations, retrieved);
    assert.deepEqual(result.candidates[0].product, candidate.product);
    const evidence = new Map();
    ingestLiveEvidence(result, citations, evidence, retrieved);
    assert.equal(
      assembleLiveSuppliers(result.candidates, [], evidence, 20).candidates
        .length,
      0,
    );
  }
});

test("L04 omitted websites recover only from unambiguous verified official identity evidence", () => {
  const { candidate, citations, retrieved } = fixture();
  const repaired = repairSourceTranscription([candidate], citations, retrieved);
  const evidence = new Map();
  ingestLiveEvidence(repaired, citations, evidence, retrieved);
  const missing = { ...repaired.candidates[0], website: null };
  const restored = restoreVerifiedOfficialWebsites([missing], evidence)[0];
  assert.equal(restored.website, citations[0].url);
  assert.equal(missing.website, null);
  assert.equal(
    assembleLiveSuppliers([restored], [], evidence, 20).candidates.length,
    1,
  );
  for (const sourceType of [
    "company_registry",
    "government_trade_portal",
    "b2b_directory",
  ]) {
    const external = structuredClone(evidence);
    external.get(citations[0].url).source.source_type = sourceType;
    assert.equal(
      restoreVerifiedOfficialWebsites([missing], external)[0].website,
      null,
    );
  }
  const unsupported = {
    ...missing,
    identity: { ...missing.identity, quote: "invented legal identity" },
  };
  assert.equal(
    restoreVerifiedOfficialWebsites([unsupported], evidence)[0].website,
    null,
  );
  const second = structuredClone(evidence.get(citations[0].url));
  second.source.source_url = "https://other.example.com/about";
  evidence.set(second.source.source_url, second);
  const ambiguous = {
    ...missing,
    identity: {
      ...missing.identity,
      source_urls: [...missing.identity.source_urls, second.source.source_url],
    },
  };
  assert.equal(
    restoreVerifiedOfficialWebsites([ambiguous], evidence)[0].website,
    null,
  );
});

test("L04 masked email text cannot become a verified contact even with literal source proof", () => {
  const { candidate, citations, retrieved } = fixture();
  const hidden = "[email protected]";
  retrieved.get(citations[0].url).text += ` Email: ${hidden}`;
  candidate.facts.push({
    field_path: "contacts.general_email",
    value: hidden,
    claim_type: "identity",
    source_urls: [citations[0].url],
    quote: `Email: ${hidden}`,
  });
  const result = repairSourceTranscription([candidate], citations, retrieved);
  const evidence = new Map();
  ingestLiveEvidence(result, citations, evidence, retrieved);
  const assembled = assembleLiveSuppliers(result.candidates, [], evidence, 20);
  assert.equal(assembled.candidates.length, 1);
  assert.equal(assembled.candidates[0].contacts.general_email, undefined);
  assert.equal(
    assembled.candidates[0].contacts.sales_email,
    "sales@aster.example.com",
  );
  assert.equal(
    assembled.claims.some(
      (claim) => claim.field_path === "contacts.general_email",
    ),
    false,
  );
});
