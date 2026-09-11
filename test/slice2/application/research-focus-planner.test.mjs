import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildResearchFocusContext,
  planResearchFocus,
} from "../../../packages/application/dist/research-focus-planner.js";
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
