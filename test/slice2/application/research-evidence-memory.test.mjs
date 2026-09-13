import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchEvidenceMemory,
  validateResearchFocusInsights,
} from "../../../packages/application/dist/research-evidence-memory.js";
import {
  buildResearchReview,
  researchLeadKey,
} from "../../../packages/application/dist/research-review.js";
import {
  validateResearchEvidenceMemory,
  validateResearchMethodReview,
  validateResearchReview,
} from "../../../packages/contracts/dist/src/v3/research-review.js";

function priorFixture(count = 2) {
  const prior = {
    indexed_leads: [],
    roster: [],
    evidence: [],
    retrieved: [],
    remaining_gaps: [],
  };
  for (let index = 0; index < count; index++) {
    const name = `Independent Company ${index}`,
      url = `https://company-${index}.example.com/legal`;
    const quote = `${name}; public sales email: trade@example.com; registered country: United Kingdom; headquarters: Shared Business Park.`;
    const proof = { status: "verified", source_urls: [url], quote };
    const facts = [
      {
        field_path: "contacts.sales_email",
        value: "trade@example.com",
        quote,
        source_urls: [url],
        claim_type: "identity",
      },
      {
        field_path: "headquarters_address",
        value: "Shared Business Park",
        quote,
        source_urls: [url],
        claim_type: "identity",
      },
      {
        field_path: "country_of_registration",
        value: "United Kingdom",
        quote,
        source_urls: [url],
        claim_type: "identity",
      },
    ];
    prior.indexed_leads.push({
      lead_id: researchLeadKey(name),
      name,
      anchor_quote: quote,
      source_urls: [url, "https://directory.example.com/members"],
      first_seen_round: 1,
      last_seen_round: 1,
    });
    prior.roster.push([
      name,
      {
        legal_name: name,
        country: "Unsupported Country",
        headquarters: "Unsupported Headquarters",
        website: url,
        identity: proof,
        product_name: "Unsupported Product",
        product: { ...proof, status: "unknown" },
        facts,
        constraints: [],
        certifications: [],
        unknowns: [],
        risks: [],
      },
    ]);
    prior.evidence.push([
      url,
      {
        source: {
          source_url: url,
          source_type: "official_website",
          excerpt_summary: quote,
        },
        authoritative_text: quote,
        native_citation: { url, content: quote },
      },
    ]);
  }
  return prior;
}
const draft = (prior) => ({
  kind: "research_opportunity",
  statement: "Clarify the public record's applicable date and entity scope.",
  lead_ids: [prior.indexed_leads[0].lead_id],
  source_urls: [prior.indexed_leads[0].source_urls[0]],
  next_question:
    "Which current registry record matches the exact legal entity?",
  status: "research_hypothesis",
});

test("MB-UX-QUALITY-001 L11 memory retains literal provenance without inferring country or unverified fields", () => {
  const prior = priorFixture(),
    original = structuredClone(prior);
  const memory = buildResearchEvidenceMemory(prior, 1);
  validateResearchEvidenceMemory(memory);
  assert.deepEqual(prior, original);
  assert.equal(memory.entities.length, 2);
  assert.equal(memory.source_urls.length, 3);
  assert.ok(memory.facts.some((fact) => fact.value === "United Kingdom"));
  assert.ok(!memory.facts.some((fact) => /Unsupported/.test(fact.value)));
  assert.ok(
    memory.relationships.some((insight) => insight.kind === "shared_contact"),
  );
  assert.ok(
    memory.relationships.some((insight) => insight.kind === "shared_location"),
  );
  assert.ok(
    memory.relationships.some((insight) => insight.kind === "shared_source"),
  );
  assert.ok(
    memory.relationships.every(
      (insight) => insight.status === "research_hypothesis",
    ),
  );
  assert.match(
    memory.limitations.join(" "),
    /not proof of ownership or independent corroboration/,
  );
});

test("MB-UX-QUALITY-001 L11 a quoted claim requires both retained excerpt and authoritative text", () => {
  const prior = priorFixture(1);
  prior.evidence[0][1].authoritative_text = "Unrelated source content";
  assert.equal(buildResearchEvidenceMemory(prior, 1).facts.length, 0);
  prior.evidence[0][1].verified_excerpts = [
    {
      excerpt: "Unrelated excerpt",
      authoritative_text: prior.indexed_leads[0].anchor_quote,
    },
  ];
  assert.equal(buildResearchEvidenceMemory(prior, 1).facts.length, 0);
});

test("MB-UX-QUALITY-001 L11 source-backed conflicting observations remain a research question", () => {
  const prior = priorFixture(1),
    candidate = prior.roster[0][1];
  const url = "https://company-0.example.com/old-address",
    quote = "Former headquarters: Different Business Park.";
  candidate.facts.push({
    field_path: "headquarters_address",
    value: "Different Business Park",
    quote,
    source_urls: [url],
  });
  prior.evidence.push([
    url,
    {
      source: { source_url: url, excerpt_summary: quote },
      authoritative_text: quote,
    },
  ]);
  const memory = buildResearchEvidenceMemory(prior, 2);
  assert.equal(
    memory.facts.filter((fact) => fact.field_path === "headquarters_address")
      .length,
    2,
  );
  assert.ok(
    memory.relationships.some(
      (insight) =>
        insight.kind === "contradiction" &&
        /different dates/.test(insight.statement),
    ),
  );
});

test("MB-UX-QUALITY-001 L11 bounded fact memory retains every entity and source identity with explicit omission disclosure", () => {
  const prior = priorFixture(100),
    memory = buildResearchEvidenceMemory(prior, 2);
  assert.equal(memory.entities.length, 100);
  assert.equal(memory.source_urls.length, 101);
  assert.ok(memory.facts.length <= 240);
  assert.ok(Buffer.byteLength(JSON.stringify(memory.facts)) < 49000);
  assert.match(
    memory.limitations.join(" "),
    /[1-9]\d* qualifying observations were omitted/,
  );
  assert.ok(
    memory.facts.some(
      (fact) => fact.lead_id === prior.indexed_leads[99].lead_id,
    ),
  );
});

test("MB-UX-QUALITY-001 L11 stable insight IDs survive repeated reconstruction and cannot be model-selected", () => {
  const prior = priorFixture(),
    insight = validateResearchFocusInsights([draft(prior)], prior)[0];
  const changed = validateResearchFocusInsights(
    [{ ...draft(prior), insight_id: "a".repeat(24) }],
    prior,
  )[0];
  assert.equal(insight.insight_id, changed.insight_id);
  prior.focus_analysis = { insights: [insight] };
  const first = buildResearchEvidenceMemory(prior, 2);
  const second = buildResearchEvidenceMemory(
    { ...prior, evidence_memory: first },
    3,
  );
  assert.deepEqual(
    first.relationships.map((item) => item.insight_id),
    second.relationships.map((item) => item.insight_id),
  );
});

for (const [label, mutate] of [
  [
    "invented lead",
    (insight) => {
      insight.lead_ids = [researchLeadKey("Missing")];
    },
  ],
  [
    "invented URL",
    (insight) => {
      insight.source_urls = ["https://invented.example.com/"];
    },
  ],
  [
    "unverified promotion",
    (insight) => {
      insight.status = "verified";
    },
  ],
  [
    "empty references",
    (insight) => {
      insight.source_urls = [];
    },
  ],
])
  test(`MB-UX-QUALITY-001 L11 rejects ${label} in AI insights`, () => {
    const prior = priorFixture(),
      insight = draft(prior);
    mutate(insight);
    assert.throws(
      () => validateResearchFocusInsights([insight], prior),
      /unknown lead or source|invalid structure/,
    );
  });

test("MB-UX-QUALITY-001 L11 memory validator rejects orphaned facts and hypotheses", () => {
  const memory = buildResearchEvidenceMemory(priorFixture(), 1);
  const invalidFact = structuredClone(memory);
  invalidFact.facts[0].source_urls = ["https://missing.example.com/"];
  assert.throws(
    () => validateResearchEvidenceMemory(invalidFact),
    /Unknown research memory fact source/,
  );
  const invalidInsight = structuredClone(memory);
  invalidInsight.relationships[0].lead_ids = [researchLeadKey("Missing")];
  assert.throws(
    () => validateResearchEvidenceMemory(invalidInsight),
    /Unknown research memory insight reference/,
  );
});

test("MB-UX-QUALITY-001 L11 method coverage preserves access limits and rejects false retrieval status", () => {
  const method = {
    method: "public_social",
    round_number: 2,
    status: "references_found",
    searched_at: "2026-09-13T00:00:00Z",
    lead_ids: [],
    sources: [
      {
        url: "https://social.example.com/company",
        title: "Public corporate profile",
        excerpt: "",
        retrieved_at: null,
        access: "provider_citation_only",
      },
    ],
    limitations: ["Company ownership is not independently established."],
  };
  validateResearchMethodReview(method);
  assert.throws(
    () =>
      validateResearchMethodReview({ ...method, status: "no_cited_sources" }),
    /disagrees with sources/,
  );
  assert.throws(
    () =>
      validateResearchMethodReview({
        ...method,
        sources: [{ ...method.sources[0], access: "retrieved" }],
      }),
    /requires a date/,
  );
});

test("MB-UX-QUALITY-001 L11 review projects durable extensions without mutating previous snapshots", () => {
  const prior = priorFixture();
  prior.evidence_memory = buildResearchEvidenceMemory(prior, 2);
  prior.method_reviews = [
    {
      method: "official_institutions",
      round_number: 2,
      status: "incomplete",
      searched_at: "2026-09-13T00:00:00Z",
      lead_ids: [],
      sources: [],
      limitations: ["No current institutional record was returned."],
    },
  ];
  const review = buildResearchReview(prior, [], [], 2);
  validateResearchReview(review);
  assert.deepEqual(review.evidence_memory, prior.evidence_memory);
  review.evidence_memory.limitations.push("Modified presentation copy");
  assert.ok(
    !prior.evidence_memory.limitations.includes("Modified presentation copy"),
  );
  const legacy = buildResearchReview(
    { roster: [], evidence: [], retrieved: [], remaining_gaps: [] },
    [],
    [],
    1,
  );
  validateResearchReview(legacy);
  assert.equal(legacy.evidence_memory, undefined);
});
