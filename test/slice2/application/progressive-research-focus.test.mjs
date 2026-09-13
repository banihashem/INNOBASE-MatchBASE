import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildResearchFocusContext,
  buildFocusedWebContext,
  planResearchFocus,
} from "../../../packages/application/dist/research-focus-planner.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

const model = "openai/gpt-5.2";
const input = {
  product_requirement: "Industrial pumps",
  technical_compliance: "ISO9001 or applicable equivalent",
  order_profile: "Supplier country unspecified",
  deep_prompt: "Approved research instructions",
};
const name = "Research Company",
  id = researchLeadKey(name),
  url = "https://company.example.com/product";
const prior = {
  indexed_leads: [
    {
      lead_id: id,
      name,
      anchor_quote: `${name} product source`,
      source_urls: [url],
      first_seen_round: 1,
      last_seen_round: 1,
    },
  ],
  roster: [],
  evidence: [],
  retrieved: [],
  remaining_gaps: ["Relevant official entity record"],
};
const plan = {
  research_strategy: "progressive-evidence.v1",
  round_number: 2,
  extraction_model: model,
  max_input_tokens_per_call: 240000,
  max_output_tokens_per_call: 20000,
  purpose: "Public social evidence and focused refinement",
  follow_up: { question: "RAW_FOLLOW_UP_MARKER", lead_ids: [id] },
};
const valid = () => ({
  objective: "Find entity-specific evidence",
  question_summary: "Clarify the company record",
  priority_lead_ids: [],
  search_tasks: [
    "Inspect the official legal record and company-linked public profile",
  ],
  evidence_gaps: ["Current registry evidence"],
  scope_notes: ["Jurisdiction remains unknown"],
  insights: [
    {
      kind: "research_opportunity",
      statement:
        "A retained company source offers a starting point for entity disambiguation.",
      lead_ids: [id],
      source_urls: [url],
      next_question:
        "Which official legal record matches this company's published identity?",
      status: "research_hypothesis",
    },
  ],
});

function fixture(t, responses) {
  const keys = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_OPENAI: "openai",
  };
  const old = Object.fromEntries(
    Object.keys(keys).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, keys);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const requests = [],
    checkpoints = [];
  const parameters = ["structured_outputs", "max_tokens", "reasoning"];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const targetUrl = String(target);
    if (targetUrl.endsWith("/models/user"))
      return Response.json({
        data: [{ id: model, supported_parameters: parameters }],
      });
    if (targetUrl.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: "openai",
              model_id: model,
              supported_parameters: parameters,
            },
          ],
        },
      });
    assert.equal(targetUrl, "https://openrouter.ai/api/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    const response = responses[requests.length - 1];
    assert.ok(response, "No unexpected extra paid-stage attempt");
    return Response.json({
      id: `progressive-fixture-${requests.length}`,
      model,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [{ selected: true, model, provider: "OpenAI" }],
        },
      },
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(response) },
        },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        cost: 0,
        cost_details: { upstream_inference_cost: 0.01 },
      },
    });
  });
  return {
    requests,
    checkpoints,
    options: {
      automatic_recovery_attempts: 3,
      before_call: async () => {},
      on_checkpoint: async (checkpoint) => checkpoints.push(checkpoint),
    },
  };
}

test("MB-UX-QUALITY-001 L11 progressive analysis returns source-bound deterministic hypotheses inside the existing paid focus call", async (t) => {
  const f = fixture(t, [valid()]),
    original = structuredClone(prior);
  const result = await planResearchFocus(input, plan, prior, f.options);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].plugins, undefined);
  assert.equal(result.analysis.insights.length, 1);
  assert.match(result.analysis.insights[0].insight_id, /^[a-f0-9]{24}$/);
  assert.deepEqual(result.analysis.priority_lead_ids, [id]);
  assert.deepEqual(prior, original);
  assert.match(
    f.requests[0].messages[0].content,
    /Shared sources, contacts, names/,
  );
  assert.match(f.requests[0].messages[0].content, /Never infer jurisdiction/);
  assert.ok(
    f.requests[0].response_format.json_schema.schema.required.includes(
      "insights",
    ),
  );
  const focus = JSON.parse(f.requests[0].messages[1].content);
  assert.equal(focus.buyer_follow_up.question, "RAW_FOLLOW_UP_MARKER");
  assert.deepEqual(focus.evidence_memory.entities, [{ lead_id: id, name }]);
  const web = buildFocusedWebContext(input, plan, prior, result.analysis);
  assert.ok(!web.includes("RAW_FOLLOW_UP_MARKER"));
  assert.deepEqual(
    JSON.parse(web).focused_research_plan.insights,
    result.analysis.insights,
  );
});

test("MB-UX-QUALITY-001 L11 unknown insight provenance repairs within existing recovery allowance before native research", async (t) => {
  const bad = valid();
  bad.insights[0].source_urls = ["https://invented.example.com/"];
  const f = fixture(t, [bad, valid()]);
  const result = await planResearchFocus(input, plan, prior, f.options);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(result.analysis.insights[0].source_urls, [url]);
  assert.equal(
    f.checkpoints.filter((checkpoint) => checkpoint.state === "completed")
      .length,
    1,
  );
  assert.equal(
    f.checkpoints.find((checkpoint) => checkpoint.state === "failed").error,
    "MB-422-FOCUS-PLAN",
  );
  assert.ok(
    !f.requests[1].messages[0].content.includes(
      "https://invented.example.com/",
    ),
  );
});

test("MB-UX-QUALITY-001 L11 an empty insight list is valid while the required new-strategy field is enforced", async (t) => {
  const bad = valid();
  delete bad.insights;
  const good = { ...valid(), insights: [] };
  const f = fixture(t, [bad, good]);
  const result = await planResearchFocus(input, plan, prior, f.options);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(result.analysis.insights, []);
});

test("MB-UX-QUALITY-001 L11 legacy approved plans retain their original focus schema and context", async (t) => {
  const legacy = { ...plan };
  delete legacy.research_strategy;
  const response = valid();
  delete response.insights;
  const f = fixture(t, [response]);
  const result = await planResearchFocus(input, legacy, prior, f.options);
  assert.equal(result.analysis.insights, undefined);
  assert.ok(
    !f.requests[0].response_format.json_schema.schema.required.includes(
      "insights",
    ),
  );
  assert.equal(
    JSON.parse(f.requests[0].messages[1].content).evidence_memory,
    undefined,
  );
});

test("MB-UX-QUALITY-001 L11 progressive context preserves every source and lead identity while shrinking excerpts", () => {
  const large = {
    ...prior,
    indexed_leads: Array.from({ length: 150 }, (_, index) => ({
      ...prior.indexed_leads[0],
      name: `Company ${index}`,
      lead_id: researchLeadKey(`Company ${index}`),
      source_urls: [`https://company-${index}.example.com/`],
      anchor_quote: "Long retained excerpt ".repeat(2000),
    })),
    method_reviews: [
      {
        method: "public_social",
        round_number: 2,
        searched_at: "2026-09-13T00:00:00Z",
        status: "references_found",
        lead_ids: [],
        sources: Array.from({ length: 30 }, (_, index) => ({
          url: `https://social.example.com/company-${index}`,
          title: `Corporate profile ${index}`,
          excerpt: "Very long source text ".repeat(500),
          access: "provider_citation_only",
          retrieved_at: null,
        })),
        limitations: ["References are observations, not ownership proof."],
      },
    ],
  };
  const later = {
    ...plan,
    round_number: 3,
    follow_up: { question: "Focus", lead_ids: [] },
  };
  const context = JSON.parse(buildResearchFocusContext(input, later, large));
  assert.equal(context.evidence_memory.entities.length, 150);
  assert.equal(context.evidence_memory.source_urls.length, 180);
  assert.equal(context.previous_method_reviews[0].sources.length, 30);
  assert.ok(
    context.previous_method_reviews[0].sources.every(
      (source) => source.excerpt.length <= 400,
    ),
  );
  const serialized = buildFocusedWebContext(input, later, large, {
    ...valid(),
    priority_lead_ids: [],
    insights: [],
  });
  assert.ok(Buffer.byteLength(serialized) < 240000);
  assert.equal(JSON.parse(serialized).evidence_memory.entities.length, 150);
});
