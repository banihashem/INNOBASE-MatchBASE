import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ingestLiveEvidence,
  evaluateLiveCandidate,
  revalidateRetainedLiveEvidence,
} from "../../../packages/application/dist/live-supplier-evidence.js";

const url = "https://carrier.example.com/air-freight";
const identity = "Example Freight GmbH registered office Berlin.";
const product = "We arrange international air freight and customs clearance.";
const text = `${identity} Our history and team. ${product} Contact us.`;
function fixture() {
  const proof = (quote) => ({ status: "verified", source_urls: [url], quote });
  const candidate = {
    legal_name: "Example Freight GmbH",
    country: "Germany",
    headquarters: "Unknown",
    website: "https://carrier.example.com",
    supplier_type: "service_provider",
    manufacturer_status: "unknown",
    identity: proof(identity),
    product: proof(product),
    product_name: "Air freight",
    product_family: "Logistics",
    product_origin: "Unknown",
    facts: [],
    certifications: [],
    constraints: [],
    unknowns: [],
    risks: [],
  };
  const payload = {
    candidates: [candidate],
    evidence: [
      {
        url,
        title: "Air freight",
        publisher: "Example Freight",
        source_type: "official_website",
        excerpt: "Contact us.",
      },
    ],
    remaining_gaps: [],
    evidence_exhausted: true,
    summary:
      "Identity and services occur outside the model's short selected excerpt.",
  };
  const citations = [{ url, title: "Air freight" }];
  const retrieved = new Map([
    [
      url,
      {
        url,
        text,
        content_sha256: "recorded-source-hash",
        retrieved_at: "2026-09-09T00:00:00Z",
      },
    ],
  ]);
  return { candidate, payload, citations, retrieved };
}
test("L11 individual exact proof quotations survive a different selected source excerpt", () => {
  const f = fixture();
  const evidence = new Map();
  ingestLiveEvidence(f.payload, f.citations, evidence, f.retrieved);
  assert.deepEqual(evaluateLiveCandidate(f.candidate, [], evidence), []);
  assert.ok(evidence.get(url).source.excerpt_summary.includes(identity));
  assert.ok(evidence.get(url).source.excerpt_summary.includes(product));
  assert.equal(evidence.get(url).source.source_type, "official_website");
});
test("L11 invalid model summaries do not suppress independently grounded proof quotations", () => {
  const f = fixture();
  const evidence = new Map();
  f.payload.evidence[0].excerpt =
    "Fabricated overview and unsupported full compliance.";
  ingestLiveEvidence(f.payload, f.citations, evidence, f.retrieved);
  assert.deepEqual(evaluateLiveCandidate(f.candidate, [], evidence), []);
  assert.ok(!evidence.get(url).source.excerpt_summary.includes("Fabricated"));
});
test("L11 forged, stitched and uncited proof quotations cannot qualify a supplier", () => {
  for (const forged of [
    "Example Freight GmbH is government certified.",
    `${identity} ${product}`,
  ]) {
    const f = fixture();
    const evidence = new Map();
    f.candidate.identity.quote = forged;
    ingestLiveEvidence(f.payload, f.citations, evidence, f.retrieved);
    assert.ok(evaluateLiveCandidate(f.candidate, [], evidence).length > 0);
    assert.ok(
      !evidence
        .get(url)
        .verified_excerpts.some((item) => item.excerpt === forged),
    );
  }
  const f = fixture();
  const evidence = new Map();
  ingestLiveEvidence(f.payload, [], evidence, f.retrieved);
  assert.equal(evidence.size, 0);
  assert.ok(evaluateLiveCandidate(f.candidate, [], evidence).length > 0);
});
test("L11 secondary source text and artificial page/snippet joins do not become primary proof", () => {
  const f = fixture();
  const evidence = new Map();
  f.payload.evidence[0].source_type = "trade_directory";
  ingestLiveEvidence(f.payload, f.citations, evidence, f.retrieved);
  assert.ok(evaluateLiveCandidate(f.candidate, [], evidence).length > 0);
  revalidateRetainedLiveEvidence([f.candidate], evidence);
  assert.ok(
    evidence
      .get(url)
      .verified_excerpts.every(
        (item) => item.source_type === "trade_directory",
      ),
  );
  const g = fixture();
  const separate = new Map();
  g.retrieved.get(url).text = identity;
  g.citations[0].content = product;
  g.candidate.identity.quote = `${identity} ${product}`;
  ingestLiveEvidence(g.payload, g.citations, separate, g.retrieved);
  assert.ok(evaluateLiveCandidate(g.candidate, [], separate).length > 0);
});
test("L11 retained evidence recovery is exact, traceable, idempotent and cannot invent a source", () => {
  const f = fixture();
  const evidence = new Map();
  ingestLiveEvidence(
    { ...f.payload, candidates: [] },
    f.citations,
    evidence,
    f.retrieved,
  );
  assert.ok(evaluateLiveCandidate(f.candidate, [], evidence).length > 0);
  const original = structuredClone(f.candidate);
  revalidateRetainedLiveEvidence([f.candidate], evidence);
  assert.deepEqual(evaluateLiveCandidate(f.candidate, [], evidence), []);
  assert.deepEqual(f.candidate, original);
  const saved = JSON.stringify([...evidence]);
  revalidateRetainedLiveEvidence([f.candidate], evidence);
  assert.equal(JSON.stringify([...evidence]), saved);
  assert.ok(evidence.get(url).source.excerpt_summary.includes(identity));
  const empty = new Map();
  revalidateRetainedLiveEvidence([f.candidate], empty);
  assert.equal(empty.size, 0);
});
test("L11 retained recovery rejects legacy page/native-snippet boundary stitching", () => {
  const f = fixture();
  const evidence = new Map();
  ingestLiveEvidence(
    { ...f.payload, candidates: [] },
    f.citations,
    evidence,
    f.retrieved,
  );
  const record = evidence.get(url);
  record.native_citation.content = product;
  record.authoritative_text = `${identity}\n${product}`;
  record.verified_excerpts = [
    {
      excerpt: identity,
      authoritative_text: record.authoritative_text,
      source_type: "official_website",
    },
  ];
  f.candidate.identity.quote = `${identity} ${product}`;
  revalidateRetainedLiveEvidence([f.candidate], evidence);
  assert.ok(
    !evidence
      .get(url)
      .verified_excerpts.some(
        (item) => item.excerpt === f.candidate.identity.quote,
      ),
  );
  assert.ok(evaluateLiveCandidate(f.candidate, [], evidence).length > 0);
});

test("L11 recovery removes a previously accepted stitched legacy excerpt before candidate evaluation", () => {
  const f = fixture();
  const evidence = new Map();
  ingestLiveEvidence(
    { ...f.payload, candidates: [] },
    f.citations,
    evidence,
    f.retrieved,
  );
  const record = evidence.get(url);
  record.native_citation.content = product;
  record.authoritative_text = `${identity}\n${product}`;
  const stitched = `${identity} ${product}`;
  record.source.excerpt_summary = stitched;
  record.verified_excerpts = [
    {
      excerpt: stitched,
      authoritative_text: record.authoritative_text,
      source_type: "official_website",
    },
  ];
  f.candidate.identity.quote = stitched;
  assert.deepEqual(evaluateLiveCandidate(f.candidate, [], evidence), []);
  revalidateRetainedLiveEvidence([f.candidate], evidence);
  assert.ok(
    !evidence
      .get(url)
      .verified_excerpts.some((item) => item.excerpt === stitched),
  );
  assert.equal(evidence.get(url).source.excerpt_summary, product);
  assert.ok(evaluateLiveCandidate(f.candidate, [], evidence).length > 0);
});

test("L11 invalid legacy excerpt does not discard independently valid source quotations", () => {
  const f = fixture();
  const evidence = new Map();
  ingestLiveEvidence(
    { ...f.payload, candidates: [] },
    f.citations,
    evidence,
    f.retrieved,
  );
  const record = evidence.get(url);
  record.native_citation.content = "Independent native snippet.";
  record.authoritative_text = `${text}\n${record.native_citation.content}`;
  const stitched = `${text} ${record.native_citation.content}`;
  record.source.excerpt_summary = stitched;
  record.verified_excerpts = [
    {
      excerpt: stitched,
      authoritative_text: record.authoritative_text,
      source_type: "official_website",
    },
  ];
  revalidateRetainedLiveEvidence([f.candidate], evidence);
  assert.deepEqual(evaluateLiveCandidate(f.candidate, [], evidence), []);
  assert.ok(
    !evidence
      .get(url)
      .verified_excerpts.some((item) => item.excerpt === stitched),
  );
  assert.ok(
    evidence
      .get(url)
      .verified_excerpts.some(
        (item) => item.excerpt === identity && item.authoritative_text === text,
      ),
  );
  assert.ok(
    evidence
      .get(url)
      .verified_excerpts.some(
        (item) => item.excerpt === product && item.authoritative_text === text,
      ),
  );
});
