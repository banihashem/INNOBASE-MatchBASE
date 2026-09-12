import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleLiveSuppliers,
  ingestLiveEvidence,
  reconcileLiveCandidateRecords,
} from "../../../packages/application/dist/live-supplier-evidence.js";

const site = "https://example-supplier.com/about";
const identity = "Example Supplier LLC is registered in Germany.";
const product = "Example Supplier LLC supplies Network Switch X100.";
const proof = (quote, url = site) => ({
  status: "verified",
  source_urls: [url],
  quote,
});
const fact = (field_path, value, quote = value, url = site) => ({
  field_path,
  value,
  claim_type: field_path.startsWith("commercial.") ? "pricing" : "identity",
  source_urls: [url],
  quote,
});
function record(facts = [], unknowns = []) {
  return {
    legal_name: "Example Supplier LLC",
    country: "Germany",
    headquarters: "Berlin, Germany",
    website: site,
    supplier_type: "distributor",
    manufacturer_status: "trader_distributor",
    identity: proof(identity),
    product: proof(product),
    product_name: "Network Switch X100",
    product_family: "Network switches",
    product_origin: "Unknown",
    facts,
    certifications: [],
    constraints: [],
    unknowns,
    risks: [],
  };
}
function evidenceFor(records, overrides = new Map()) {
  const quotes = new Map([[site, [identity, product]]]);
  for (const candidate of records) {
    for (const entry of [...candidate.facts, ...candidate.certifications]) {
      for (const url of entry.source_urls)
        quotes.set(url, [...(quotes.get(url) ?? []), entry.quote]);
    }
  }
  const payload = {
    candidates: records,
    evidence: [...quotes].map(([url, text]) => ({
      url,
      title: "Published supplier information",
      publisher: "Example publisher",
      source_type: overrides.get(url)?.type ?? "official_website",
      excerpt: text[0],
    })),
    remaining_gaps: [],
    evidence_exhausted: true,
    summary: "Anonymized supplier evidence.",
  };
  const evidence = new Map();
  ingestLiveEvidence(
    payload,
    [...quotes].map(([url, text]) => ({
      url,
      title: "Published supplier information",
      content: overrides.get(url)?.text ?? text.join("\n"),
    })),
    evidence,
  );
  return evidence;
}
const assemble = (candidate, overrides) =>
  assembleLiveSuppliers(
    [candidate],
    [],
    evidenceFor([candidate], overrides),
    20,
  );

test("MB-UX-QUALITY-001 L06 placeholder facts cannot suppress a real observation or resolve missing fields", () => {
  const candidate = record(
    [
      fact("headquarters_address", "N/A"),
      fact("headquarters_address", "Berlin, Germany"),
      fact("contacts.phone", "Not recorded"),
      fact("commercial.production_capacity", "Unknown"),
    ],
    ["Phone not found.", "Production capacity not stated."],
  );
  const result = assemble(candidate);
  assert.equal(result.candidates[0].headquarters_address, "Berlin, Germany");
  assert.equal(result.candidates[0].contacts.phone, undefined);
  assert.equal(result.candidates[0].commercial.production_capacity, undefined);
  assert.deepEqual(
    result.candidates[0].assessment.unknowns,
    candidate.unknowns,
  );
  assert.ok(
    result.claims.every(
      (claim) =>
        !["N/A", "Not recorded", "Unknown"].includes(claim.normalized_value),
    ),
  );
});

test("MB-UX-QUALITY-001 L06 merge retains differing observations and deduplicates exact proofs without mutation", () => {
  const a = record([
    fact("headquarters_address", "Berlin, Germany"),
    fact("contacts.sales_email", "first@example-supplier.com"),
  ]);
  const b = record([
    fact("headquarters_address", "Paris, France"),
    fact("contacts.sales_email", "second@example-supplier.com"),
  ]);
  const original = structuredClone([a, b]);
  const e = evidenceFor([a, b]);
  const merged = reconcileLiveCandidateRecords([a, b, a, b], e);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].facts.length, 4);
  assert.deepEqual([a, b], original);
  assert.deepEqual(
    new Set(merged[0].facts.map((entry) => entry.value)),
    new Set(original.flatMap((entry) => entry.facts.map((f) => f.value))),
  );
});

test("MB-UX-QUALITY-001 L06 alternate headquarters remain unresolved with both sourced claims regardless of order", () => {
  const observations = [
    fact("headquarters_address", "Berlin, Germany"),
    fact("headquarters_address", "Paris, France"),
  ];
  for (const facts of [observations, [...observations].reverse()]) {
    const result = assemble(record(facts));
    const supplier = result.candidates[0];
    assert.equal(supplier.headquarters_address, "Not verified");
    assert.ok(
      supplier.assessment.unknowns.some((note) =>
        note.includes("Alternative headquarters addresses remain unresolved"),
      ),
    );
    const claims = result.claims.filter(
      (c) => c.field_path === "headquarters_address",
    );
    assert.equal(claims.length, 2);
    assert.deepEqual(
      new Set(claims.map((c) => c.normalized_value)),
      new Set(observations.map((f) => f.value)),
    );
    for (const claim of claims) {
      assert.equal(claim.conflict_status, "single_source");
      assert.ok(claim.evidence_ids.length);
      for (const id of claim.evidence_ids)
        assert.ok(
          result.evidence_sources
            .find((s) => s.evidence_id === id)
            .supports_claim_ids.includes(claim.claim_id),
        );
    }
  }
});

test("MB-UX-QUALITY-001 L06 headquarters and raw discovery country never establish registration or product origin", () => {
  const c = record([fact("headquarters_address", "Berlin, Germany")]);
  const result = assemble(c);
  assert.equal(result.candidates[0].headquarters_address, "Berlin, Germany");
  assert.equal(result.candidates[0].country_of_registration, "Not verified");
  assert.equal(result.candidates[0].offering.country_of_origin, "Not verified");
  assert.ok(
    !result.claims.some((claim) =>
      ["country_of_registration", "country_of_origin"].includes(
        claim.field_path,
      ),
    ),
  );
});

test("MB-UX-QUALITY-001 L06 unsupported alternative facts do not suppress the grounded scalar", () => {
  const c = record([
    fact("headquarters_address", "Berlin, Germany"),
    fact("headquarters_address", "Paris, France"),
  ]);
  const result = assemble(
    c,
    new Map([[site, { text: `${identity}\n${product}\nBerlin, Germany` }]]),
  );
  assert.equal(result.candidates[0].headquarters_address, "Berlin, Germany");
  const claims = result.claims.filter(
    (claim) => claim.field_path === "headquarters_address",
  );
  assert.equal(claims.length, 1);
  assert.equal(claims[0].conflict_status, "single_source");
});

test("MB-UX-QUALITY-001 L06 case and whitespace variants are not conflicting observations", () => {
  const facts = [
    fact("headquarters_address", "BERLIN,  GERMANY"),
    fact("headquarters_address", "Berlin, Germany"),
  ];
  const a = assemble(record(facts));
  const b = assemble(record([...facts].reverse()));
  assert.notEqual(a.candidates[0].headquarters_address, "Not verified");
  assert.equal(
    a.candidates[0].headquarters_address,
    b.candidates[0].headquarters_address,
  );
  assert.ok(
    a.claims.every((claim) => claim.conflict_status === "single_source"),
  );
});

test("MB-UX-QUALITY-001 L06 multiple public contacts remain available without a fabricated conflict", () => {
  const facts = [
    fact("contacts.sales_email", "z@example-supplier.com"),
    fact("contacts.sales_email", "a@example-supplier.com"),
    fact("contacts.phone", "+49 30 1002"),
    fact("contacts.phone", "+49 30 1001"),
  ];
  for (const observations of [facts, [...facts].reverse()]) {
    const result = assemble(record(observations, ["Sales email not found."]));
    const c = result.candidates[0];
    assert.equal(c.contacts.sales_email, "a@example-supplier.com");
    assert.equal(c.contacts.phone, "+49 30 1001");
    assert.equal(c.contacts.verification_status, "verified");
    assert.equal(c.assessment.unknowns.length, 0);
    assert.equal(
      c.assessment.positive_drivers.filter((note) =>
        note.includes("additional contacts"),
      ).length,
      2,
    );
    const contacts = result.claims.filter((claim) =>
      claim.field_path.startsWith("contacts."),
    );
    assert.equal(contacts.length, 4);
    assert.ok(
      contacts.every((claim) => claim.conflict_status === "single_source"),
    );
  }
});

test("MB-UX-QUALITY-001 L06 multiple manufacturing sites retain all sourced locations", () => {
  const result = assemble(
    record([
      fact("manufacturing_location", "Berlin, Germany"),
      fact("manufacturing_location", "Paris, France"),
    ]),
  );
  assert.deepEqual(
    new Set(result.candidates[0].manufacturing_locations),
    new Set(["Berlin, Germany", "Paris, France"]),
  );
  assert.ok(
    result.claims.every((claim) => claim.conflict_status === "single_source"),
  );
});

test("MB-UX-QUALITY-001 L06 unresolved price alternatives cannot become a synthetic combined range", () => {
  const c = record([
    fact("commercial.price_min", "10"),
    fact("commercial.price_max", "15"),
    fact("commercial.price_min", "20"),
    fact("commercial.price_max", "25"),
    fact("commercial.currency", "USD"),
    fact("commercial.unit", "unit"),
  ]);
  const result = assemble(c);
  assert.equal(result.candidates[0].commercial.price_min, undefined);
  assert.equal(result.candidates[0].commercial.price_max, undefined);
  assert.equal(result.candidates[0].commercial.currency, "USD");
  assert.ok(
    result.candidates[0].assessment.unknowns.some((note) =>
      note.includes("unresolved price, date or product basis"),
    ),
  );
  assert.equal(
    result.claims.filter(
      (claim) =>
        /^commercial\.price_(?:min|max)$/.test(claim.field_path) &&
        claim.conflict_status === "single_source",
    ).length,
    4,
  );
});

test("MB-UX-QUALITY-001 L06 equivalent decimal price strings preserve one amount with both claims", () => {
  const result = assemble(
    record([
      fact("commercial.price_min", "10.00"),
      fact("commercial.price_min", "10"),
    ]),
  );
  assert.equal(result.candidates[0].commercial.price_min, 10);
  const claims = result.claims.filter(
    (claim) => claim.field_path === "commercial.price_min",
  );
  assert.equal(claims.length, 2);
  assert.ok(claims.every((claim) => claim.conflict_status === "single_source"));
});

test("MB-UX-QUALITY-001 L06 exact missing-field notes are superseded while qualified gaps and raw history survive", () => {
  const retained = [
    "Sales email has not been independently verified.",
    "Current email availability requires confirmation.",
    "A current quotation and stock confirmation are required.",
    "Price not found.",
    "Country of origin not found.",
    "Export email not found.",
    "No public contacts for the requested region found.",
    "Sales email not found; contact the supplier for an export account.",
  ];
  const c = record(
    [
      fact("contacts.sales_email", "sales@example-supplier.com"),
      fact("contacts.phone", "+49 30 12345"),
      fact("headquarters_address", "Berlin, Germany"),
      fact("commercial.moq", "10 units"),
    ],
    [
      "Sales email not found.",
      "No public phone found.",
      "Headquarters address: unknown.",
      "MOQ was not stated.",
      ...retained,
    ],
  );
  const before = structuredClone(c);
  const result = assemble(c);
  assert.deepEqual(result.candidates[0].assessment.unknowns, retained);
  for (const note of retained)
    assert.ok(result.candidates[0].assessment.limiting_gaps.includes(note));
  assert.deepEqual(c, before);
});

test("MB-UX-QUALITY-001 L06 masked contacts and unresolved scalar alternatives cannot resolve missing-field notes", () => {
  const c = record(
    [
      fact("contacts.sales_email", "[email protected]"),
      fact("headquarters_address", "Berlin, Germany"),
      fact("headquarters_address", "Paris, France"),
    ],
    ["Sales email not found.", "Headquarters address not recorded."],
  );
  const result = assemble(c);
  assert.equal(result.candidates[0].contacts.sales_email, undefined);
  assert.ok(
    c.unknowns.every((note) =>
      result.candidates[0].assessment.unknowns.includes(note),
    ),
  );
});

test("MB-UX-QUALITY-001 L06 repeated recovery notes do not alter facts or remove RFQ requirements", () => {
  const a = record(
    [],
    ["Sales email not found.", "Current quotation required."],
  );
  const b = record(
    [fact("contacts.sales_email", "sales@example-supplier.com")],
    [],
  );
  const e = evidenceFor([a, b]);
  const merged = reconcileLiveCandidateRecords([a, b], e);
  assert.ok(merged[0].unknowns.includes("Sales email not found."));
  const result = assembleLiveSuppliers(merged, [], e, 20);
  assert.deepEqual(result.candidates[0].assessment.unknowns, [
    "Current quotation required.",
  ]);
  assert.equal(result.candidates[0].commercial.quotation_required, true);
});

test("MB-UX-QUALITY-001 L06 a separate host alone cannot establish independent certification", () => {
  for (const [url, type, expected] of [
    [site, "official_website", "claimed"],
    ["https://cdn.example.net/certificate", "catalog_pdf", "claimed"],
    ["https://affiliate.example.net/quality", "official_website", "claimed"],
    [
      "https://registry.example.gov/certificate",
      "official_registry",
      "verified",
    ],
    [
      "https://trade.example.gov/certificate",
      "government_trade_portal",
      "verified",
    ],
  ]) {
    const c = record();
    c.certifications = [
      {
        name: "ISO 9001",
        issuer: "Example certification body",
        certificate_number: "CERT-123",
        scope: "Quality management",
        status: "active",
        valid_from: null,
        valid_until: null,
        source_urls: [url],
        quote: "Example Supplier LLC ISO 9001 CERT-123 Quality management.",
      },
    ];
    const result = assemble(c, new Map([[url, { type }]]));
    assert.equal(
      result.candidates[0].certifications[0].verification_status,
      expected,
      type,
    );
    const claim = result.claims.find(
      (entry) => entry.field_path === "certifications",
    );
    assert.equal(
      claim.status,
      expected === "verified" ? "externally_verified" : "supplier_claimed",
      type,
    );
    assert.ok(claim.evidence_ids.length);
  }
});
