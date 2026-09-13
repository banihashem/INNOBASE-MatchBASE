import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildFocusedWebContext,
  buildResearchFocusContext,
  planResearchFocus,
} from "../../../packages/application/dist/research-focus-planner.js";
import { buildFocusedResearchInstructions } from "../../../packages/application/dist/dual-lane-orchestrator.js";
import { buildResearchEvidenceMemory } from "../../../packages/application/dist/research-evidence-memory.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";
import { validateResearchReview } from "../../../packages/contracts/dist/src/v3/research-review.js";

const input = {
  product_requirement: "Network switches",
  technical_compliance: "Original requirements",
  order_profile: "10 units",
  deep_prompt: "Approved search",
};
const plan = {
  round_number: 2,
  extraction_model: "openai/gpt-5.2",
  max_input_tokens_per_call: 240000,
  purpose: "Resolve remaining evidence",
  follow_up: { question: "Which supplier has dated prices?", lead_ids: [] },
};
const lead = (i) => ({
  lead_id: researchLeadKey(`Seller ${i}`),
  name: `Seller ${i}`,
  anchor_quote: "Evidence ".repeat(1000),
  source_urls: [`https://seller-${i}.example.com/`],
  first_seen_round: 1,
  last_seen_round: 1,
});
const empty = () => ({
  roster: [],
  evidence: [],
  retrieved: [],
  remaining_gaps: [],
});

test("MB-UX-QUALITY-001 L01 analysis compacts excerpts without dropping lead/source inventory or mutating saved records", () => {
  const prior = {
    ...empty(),
    indexed_leads: Array.from({ length: 200 }, (_, i) => lead(i)),
    evidence: Array.from({ length: 200 }, (_, i) => [
      `e${i}`,
      {
        source: { source_url: `https://seller-${i}.example.com/` },
        authoritative_text: "Source text ".repeat(5000),
      },
    ]),
  };
  const original = structuredClone(prior);
  const serialized = buildResearchFocusContext(input, plan, prior);
  const context = JSON.parse(serialized);
  assert.ok(Buffer.byteLength(serialized) <= 200000);
  assert.equal(context.prior_leads.length, 200);
  assert.equal(context.prior_evidence.length, 200);
  assert.equal(context.prior_leads.at(-1).name, "Seller 199");
  assert.ok(context.context_disclosure.includes("Full records remain"));
  assert.deepEqual(prior, original);
  assert.deepEqual(context.approved_request, input);
});

test("MB-UX-QUALITY-001 L01 oversized immutable inventory stops before any provider call", () => {
  assert.throws(
    () =>
      buildResearchFocusContext(
        { ...input, deep_prompt: "x".repeat(250000) },
        plan,
        empty(),
      ),
    /exceeds this approved analysis allowance/,
  );
});

function accumulatedEvidence(roundNumber) {
  const indexed_leads = Array.from({ length: 51 }, (_, index) => ({
    ...lead(index),
    anchor_quote: `Seller ${index} supplies industrial equipment.`,
    last_seen_round: roundNumber - 1,
  }));
  const count = roundNumber === 4 ? 40 : 62;
  const quote = (value) =>
    `Published observation ${value}. ${"Retained literal evidence with its original scope. ".repeat(8)}`;
  const evidence = Array.from({ length: count }, (_, index) => {
    const url = `https://seller-${index}.example.com/`;
    const name = `Seller ${index}`;
    const text = [name, quote("10 bar"), quote("12 bar")].join(" ");
    return [
      url,
      {
        source: {
          evidence_id: `evidence-${index}`,
          source_id: `source-${index}`,
          source_url: url,
          source_title: `Original source ${index}`,
          publisher: name,
          source_type: "official_website",
          retrieved_at: "2026-09-13T00:00:00Z",
          published_at: "2026-09-12T00:00:00Z",
          language: "en",
          freshness_status: "current",
          verification_status: "verified",
          excerpt_summary:
            `${text} ${"Additional retained source prose. ".repeat(150)}`.slice(
              0,
              4000,
            ),
          supports_claim_ids: Array.from(
            { length: 8 },
            (_, claim) => `source-${index}-supports-${claim}`,
          ),
          contradicts_claim_ids: [`source-${index}-contradicts-0`],
        },
        authoritative_text: text,
      },
    ];
  });
  const roster = indexed_leads.slice(0, 29).map((item, index) => [
    `seller-${index}`,
    {
      legal_name: item.name,
      website: item.source_urls[0],
      identity: {
        status: "verified",
        quote: item.name,
        source_urls: item.source_urls,
      },
      product_name: "",
      product: { status: "unknown", quote: "", source_urls: [] },
      facts: ["10 bar", "12 bar"].map((value) => ({
        field_path: "specifications.operating_pressure",
        value,
        claim_type: "specification",
        quote: quote(value),
        source_urls: item.source_urls,
      })),
      constraints: [],
      certifications: [],
      unknowns: ["Current pressure applicability remains unresolved"],
      risks: [],
    },
  ]);
  const prior = {
    indexed_leads,
    roster,
    evidence,
    retrieved: evidence.map(([url]) => [
      url,
      {
        url,
        text: "Full retained page",
        retrieved_at: "2026-09-13T00:00:00Z",
        content_sha256: "a".repeat(64),
      },
    ]),
    remaining_gaps: [
      "Resolve contradictory pressure observations",
      "Current institutional records",
    ],
    focus_analysis: {
      objective:
        "Retain conflicting observations while investigating original records",
      question_summary: "Find current independent evidence",
      priority_lead_ids: indexed_leads.slice(0, 42).map((item) => item.lead_id),
      search_tasks: [
        "Compare the dates and applicable product scope of the original records",
      ],
      evidence_gaps: ["Conflicting operating pressures"],
      scope_notes: ["The approved requirements are unchanged"],
      insights: [],
    },
    method_reviews: Array.from({ length: roundNumber - 2 }, (_, index) => ({
      method: "public_social",
      round_number: index + 2,
      status: "references_found",
      searched_at: "2026-09-13T00:00:00Z",
      lead_ids: indexed_leads.slice(0, 20).map((item) => item.lead_id),
      sources: evidence.slice(0, 8).map(([url]) => ({
        url,
        title: "Public corporate reference",
        excerpt: "Reference text ".repeat(300),
        retrieved_at: null,
        access: "provider_citation_only",
      })),
      limitations: ["Corporate references are not independent confirmation"],
    })),
  };
  return prior;
}

for (const roundNumber of [4, 5]) {
  test(`MB-UX-QUALITY-001 L13 round ${roundNumber} fits accumulated source summaries while retaining all claim links and conflicting evidence`, () => {
    const prior = accumulatedEvidence(roundNumber);
    const original = structuredClone(prior);
    const approvedInput = {
      ...input,
      deep_prompt: "Immutable approved research scope. ".repeat(390),
    };
    const approvedPlan = {
      ...plan,
      research_strategy: "progressive-evidence.v1",
      round_number: roundNumber,
      focus_requirements: ["Resolve current entity and offering evidence"],
      follow_up: {
        question: "RAW_FOLLOW_UP_MUST_BE_ANALYSED",
        lead_ids: prior.indexed_leads.slice(0, 42).map((item) => item.lead_id),
      },
    };
    const memory = buildResearchEvidenceMemory(prior, roundNumber - 1);
    assert.ok(
      memory.relationships.some((insight) => insight.kind === "contradiction"),
    );
    const raw = buildResearchFocusContext(approvedInput, approvedPlan, prior);
    const context = JSON.parse(raw);
    const formerMinimal = {
      ...context,
      prior_evidence: prior.evidence.map(([id, record]) => ({
        id,
        source: record.source,
        excerpt: "",
      })),
    };
    assert.ok(
      Buffer.byteLength(JSON.stringify(formerMinimal)) > 200000,
      "Unbounded source summaries reproduce the former local rejection even without evidence excerpts.",
    );
    assert.ok(Buffer.byteLength(raw, "utf8") <= 200000);
    assert.ok(
      Buffer.byteLength(
        JSON.stringify([
          { role: "system", content: " ".repeat(12000) },
          { role: "user", content: raw },
        ]),
        "utf8",
      ) +
        512 <=
        approvedPlan.max_input_tokens_per_call,
    );
    assert.deepEqual(context.approved_request, approvedInput);
    assert.deepEqual(context.buyer_follow_up, approvedPlan.follow_up);
    assert.deepEqual(context.evidence_memory, memory);
    assert.deepEqual(context.previous_analysis, prior.focus_analysis);
    assert.deepEqual(
      context.prior_leads.map(
        ({ anchor_excerpt: _anchorExcerpt, ...item }) => item,
      ),
      prior.indexed_leads.map(
        ({ anchor_quote: _anchorQuote, ...item }) => item,
      ),
    );
    for (const [index, [, record]] of prior.evidence.entries()) {
      const projected = context.prior_evidence[index].source;
      const { excerpt_summary: originalSummary, ...originalMetadata } =
        record.source;
      const { excerpt_summary: projectedSummary, ...projectedMetadata } =
        projected;
      assert.deepEqual(projectedMetadata, originalMetadata);
      assert.ok(originalSummary.startsWith(projectedSummary));
      assert.ok(projectedSummary.length < originalSummary.length);
    }
    const instructions = buildFocusedResearchInstructions(approvedPlan);
    const preflight = buildFocusedWebContext(
      approvedInput,
      approvedPlan,
      prior,
      undefined,
      instructions,
    );
    assert.ok(
      Buffer.byteLength(
        JSON.stringify([
          { role: "system", content: instructions.system_instruction },
          { role: "user", content: preflight },
        ]),
        "utf8",
      ) +
        512 +
        60000 <=
        approvedPlan.max_input_tokens_per_call,
    );
    const nativeRaw = buildFocusedWebContext(
      approvedInput,
      approvedPlan,
      prior,
      prior.focus_analysis,
      instructions,
    );
    const native = JSON.parse(nativeRaw);
    assert.deepEqual(native.evidence_memory, memory);
    assert.deepEqual(native.selected_lead_ids, approvedPlan.follow_up.lead_ids);
    assert.deepEqual(
      native.retained_discovery_leads.map((item) => item.source_urls),
      prior.indexed_leads.map((item) => item.source_urls),
    );
    assert.deepEqual(native.focused_research_plan, prior.focus_analysis);
    assert.ok(!nativeRaw.includes("RAW_FOLLOW_UP_MUST_BE_ANALYSED"));
    assert.deepEqual(prior, original);
  });
}

test("MB-UX-QUALITY-001 L13 source summary projection preserves multilingual metadata and measures escaped UTF-8 messages", () => {
  const prior = accumulatedEvidence(4);
  for (const [, record] of prior.evidence) {
    record.source.source_title += ' 供應商 "\\" 🧭';
    record.source.excerpt_summary = '來源 "\\" 🧭 '.repeat(700);
  }
  const original = structuredClone(prior);
  const approvedPlan = {
    ...plan,
    research_strategy: "progressive-evidence.v1",
    round_number: 4,
  };
  const raw = buildResearchFocusContext(input, approvedPlan, prior);
  assert.ok(
    Buffer.byteLength(
      JSON.stringify([
        { role: "system", content: " ".repeat(12000) },
        { role: "user", content: raw },
      ]),
      "utf8",
    ) +
      512 <=
      approvedPlan.max_input_tokens_per_call,
  );
  const projected = JSON.parse(raw);
  for (const [index, [, record]] of prior.evidence.entries()) {
    const source = projected.prior_evidence[index].source;
    assert.equal(source.source_title, record.source.source_title);
    assert.deepEqual(
      source.supports_claim_ids,
      record.source.supports_claim_ids,
    );
    assert.deepEqual(
      source.contradicts_claim_ids,
      record.source.contradicts_claim_ids,
    );
    assert.ok(record.source.excerpt_summary.startsWith(source.excerpt_summary));
    assert.equal(source.excerpt_summary.isWellFormed(), true);
  }
  assert.deepEqual(prior, original);
});

test("MB-UX-QUALITY-001 L13 immutable claim provenance overflow still stops before paid planning", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected provider request");
  });
  const prior = accumulatedEvidence(4);
  prior.evidence[0][1].source.supports_claim_ids = Array.from(
    { length: 9000 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  const original = structuredClone(prior);
  const beforeCall = t.mock.fn(() => {
    throw new Error("No provider call may be admitted");
  });
  await assert.rejects(
    planResearchFocus(input, plan, prior, { before_call: beforeCall }),
    {
      code: "MB-409-FOCUS-CONTEXT",
      message:
        "MB-409-FOCUS-CONTEXT: The saved research inventory exceeds this approved analysis allowance. No focused search was started.",
    },
  );
  assert.equal(beforeCall.mock.callCount(), 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.deepEqual(prior, original);
});

test("MB-UX-QUALITY-001 L01 unknown selected lead stops before provider invocation", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected provider call");
  });
  await assert.rejects(
    planResearchFocus(
      input,
      {
        ...plan,
        follow_up: {
          question: "Focus",
          lead_ids: [researchLeadKey("Missing")],
        },
      },
      empty(),
      {},
    ),
    /no longer belong/,
  );
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("MB-UX-QUALITY-001 L01 invalid AI priority ID is never handed to web research", async (t) => {
  const keys = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_OPENAI: "openai",
  };
  const saved = Object.fromEntries(
    Object.keys(keys).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, keys);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [
          {
            id: plan.extraction_model,
            supported_parameters: ["structured_outputs", "max_tokens"],
          },
        ],
      });
    if (url.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: "openai",
              model_id: plan.extraction_model,
              supported_parameters: ["structured_outputs", "max_tokens"],
            },
          ],
        },
      });
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.plugins, undefined);
    assert.equal(body.response_format.json_schema.name, "research_focus_plan");
    return Response.json({
      id: "focus-fixture",
      model: plan.extraction_model,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [
            {
              selected: true,
              model: plan.extraction_model,
              provider: "OpenAI",
            },
          ],
        },
      },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              objective: "Inspect sources",
              question_summary: "Find prices",
              priority_lead_ids: [researchLeadKey("Invented")],
              search_tasks: ["Inspect official sources"],
              evidence_gaps: [],
              scope_notes: [],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 100,
        cost: 0,
        cost_details: { upstream_inference_cost: 0.01 },
      },
    });
  });
  await assert.rejects(
    planResearchFocus(
      input,
      plan,
      { ...empty(), indexed_leads: [lead(0)] },
      {},
    ),
    /unknown lead/,
  );
  assert.equal(calls, 1);
});

test("MB-UX-QUALITY-001 L01 public review rejects misleading counts, unsafe links and impossible histories", () => {
  const review = {
    version: "research-review.v1",
    round_number: 1,
    leads: [
      {
        lead_id: researchLeadKey("Seller"),
        name: "Seller",
        source_urls: ["https://seller.example.com"],
        status: "needs_review",
        reason: "Identity unconfirmed",
        missing_evidence: ["Official identity"],
        first_seen_round: 1,
        last_seen_round: 1,
      },
    ],
    coverage_gaps: [],
    summary: { discovered: 1, documented: 0, needs_review: 1, excluded: 0 },
    changes: { new_leads: 1, promoted: 0 },
  };
  validateResearchReview(review);
  assert.throws(
    () =>
      validateResearchReview({
        ...review,
        summary: { ...review.summary, needs_review: 0 },
      }),
    /counts disagree/,
  );
  const unsafe = structuredClone(review);
  unsafe.leads[0].source_urls = ["javascript:alert(1)"];
  assert.throws(() => validateResearchReview(unsafe), /source URL/);
  const impossible = structuredClone(review);
  impossible.leads[0].last_seen_round = 5;
  assert.throws(() => validateResearchReview(impossible), /history/);
});
