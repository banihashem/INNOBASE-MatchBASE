import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildResearchFocusContext,
  buildFocusedWebContext,
  planResearchFocus,
  PROGRESSIVE_RESEARCH_FOCUS_SCHEMA,
} from "../../../packages/application/dist/research-focus-planner.js";
import { researchFocusWireSchema } from "../../../packages/application/dist/research-focus-wire-schema.js";
import { validateJsonSchema } from "../../../packages/application/dist/live-json-schema.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

const model = "openai/gpt-5.2";
const gemini = "google/gemini-3.8-flash";
const anthropic = "anthropic/claude-sonnet-5";
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

function fixture(t, responses, selectedModel = model) {
  const keys = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_PROVIDER_ANTHROPIC: "anthropic",
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
        data: [...new Set([model, selectedModel])].map((id) => ({
          id,
          supported_parameters: parameters,
        })),
      });
    if (targetUrl.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: targetUrl.includes("google/")
                ? "google-ai-studio"
                : targetUrl.includes("anthropic/")
                  ? "anthropic"
                  : "openai",
              provider_name: targetUrl.includes("google/")
                ? "Google AI Studio"
                : targetUrl.includes("anthropic/")
                  ? "Anthropic"
                  : "OpenAI",
              model_id:
                targetUrl.includes("google/") ||
                targetUrl.includes("anthropic/")
                  ? selectedModel
                  : model,
              supported_parameters: parameters,
            },
          ],
        },
      });
    assert.equal(targetUrl, "https://openrouter.ai/api/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    const response = responses[requests.length - 1];
    assert.ok(response, "No unexpected extra paid-stage attempt");
    if (response instanceof Response) return response;
    const requestedModel = requests.at(-1).model;
    return Response.json({
      id: `progressive-fixture-${requests.length}`,
      model: requestedModel,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [
            {
              selected: true,
              model: requestedModel,
              provider: requestedModel.startsWith("google/")
                ? "Google AI Studio"
                : "OpenAI",
            },
          ],
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

test("MB-UX-QUALITY-001 L12 Gemini focus uses a smaller grammar while every local value and provenance constraint remains required", async (t) => {
  const original = structuredClone(PROGRESSIVE_RESEARCH_FOCUS_SCHEMA);
  const wire = researchFocusWireSchema(original, gemini);
  assert.deepEqual(original, PROGRESSIVE_RESEARCH_FOCUS_SCHEMA);
  assert.deepEqual(wire.required, original.required);
  assert.equal(wire.additionalProperties, false);
  assert.equal(wire.properties.insights.items.additionalProperties, false);
  assert.deepEqual(
    wire.properties.insights.items.properties.kind.enum,
    original.properties.insights.items.properties.kind.enum,
  );
  assert.ok(
    !/"(?:maxLength|minLength|pattern|maxItems|minItems)"/.test(
      JSON.stringify(wire),
    ),
  );
  assert.equal(researchFocusWireSchema(original, model), original);
  for (const mutate of [
    (value) => {
      value.objective = "";
    },
    (value) => {
      value.objective = "x".repeat(501);
    },
    (value) => {
      value.search_tasks = [];
    },
    (value) => {
      value.insights = Array.from({ length: 9 }, () => valid().insights[0]);
    },
    (value) => {
      value.insights[0].lead_ids = ["invalid-id"];
    },
    (value) => {
      value.insights[0].source_urls = ["x".repeat(12001)];
    },
    (value) => {
      value.insights[0].unrequested = true;
    },
  ]) {
    const value = valid();
    mutate(value);
    assert.throws(
      () => validateJsonSchema(value, original),
      /MB-422-LIVE-SCHEMA/,
    );
  }
  const malformed = valid();
  malformed.insights[0].source_urls = ["https://unretained.example.com/"];
  const f = fixture(t, [malformed, valid()], gemini);
  const result = await planResearchFocus(
    input,
    { ...plan, round_number: 3, extraction_model: gemini },
    prior,
    f.options,
  );
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[0].response_format.json_schema.schema, wire);
  assert.ok(
    f.requests[0].messages[0].content.includes(JSON.stringify(original)),
  );
  assert.deepEqual(result.analysis.insights[0].source_urls, [url]);
  assert.equal(
    f.checkpoints.find((event) => event.state === "failed").error,
    "MB-422-FOCUS-PLAN",
  );
});

test("MB-UX-QUALITY-001 L12 explicit schema rejection switches focus to the approved BYOK alternative within one shared stage", async (t) => {
  const rejected = Response.json(
    {
      error: {
        code: 400,
        message: "The response schema is too complex for serving.",
        metadata: { provider_name: "Google AI Studio", is_byok: true },
      },
    },
    { status: 400 },
  );
  const f = fixture(t, [rejected, valid()], gemini);
  const rates = [
    {
      model: gemini,
      provider: "google-ai-studio",
      billing_mode: "byok",
      structured_outputs: true,
      reasoning: true,
    },
    {
      model,
      provider: "openai",
      billing_mode: "byok",
      structured_outputs: true,
      reasoning: true,
    },
  ];
  const result = await planResearchFocus(
    input,
    { ...plan, round_number: 3, extraction_model: gemini },
    prior,
    {
      ...f.options,
      approved_rates: rates,
      approved_model_fallbacks: { [gemini]: [model] },
      approved_search_engines: { [gemini]: "exa", [model]: "exa" },
    },
  );
  assert.deepEqual(
    f.requests.map((request) => request.model),
    [gemini, model],
  );
  assert.ok(
    f.requests.every(
      (request) =>
        request.provider.allow_fallbacks === false &&
        request.plugins === undefined,
    ),
  );
  assert.equal(result.result.model, model);
  assert.deepEqual(result.analysis.priority_lead_ids, [id]);
  assert.deepEqual(f.requests[0].messages[1], f.requests[1].messages[1]);
  const recovered = f.checkpoints.find((event) => event.state === "failed");
  assert.equal(recovered.recovery_scheduled, true);
  assert.equal(recovered.recovery_next_model, model);
  assert.equal(recovered.recovery_attempt, 1);
  assert.equal(f.checkpoints.at(-1).recovery_attempt, 2);
});

test("MB-UX-QUALITY-001 L17 Anthropic privacy-route rejection switches focus to the approved BYOK alternative", async (t) => {
  const rejected = Response.json(
    {
      error: {
        code: 404,
        message:
          "No endpoints found matching the requested zero data retention privacy policy.",
        metadata: { provider_name: "Anthropic", is_byok: false },
      },
    },
    { status: 404 },
  );
  const f = fixture(t, [rejected, valid()], anthropic);
  const result = await planResearchFocus(
    input,
    { ...plan, round_number: 3, extraction_model: anthropic },
    prior,
    {
      ...f.options,
      approved_rates: [
        {
          model: anthropic,
          provider: "anthropic",
          billing_mode: "byok",
          structured_outputs: true,
          reasoning: true,
        },
        {
          model,
          provider: "openai",
          billing_mode: "byok",
          structured_outputs: true,
          reasoning: true,
        },
      ],
      approved_model_fallbacks: { [anthropic]: [model] },
      approved_search_engines: { [anthropic]: "exa", [model]: "exa" },
    },
  );
  assert.deepEqual(
    f.requests.map((request) => request.model),
    [anthropic, model],
  );
  assert.ok(
    f.requests.every((request) => request.provider.allow_fallbacks === false),
  );
  assert.equal(result.result.model, model);
  const failed = f.checkpoints.find((event) => event.state === "failed");
  assert.equal(failed.provider_http_failure.category, "privacy");
  assert.equal(failed.provider_dispatch_rejected, true);
  assert.equal(failed.provider_receipt_received, false);
  assert.equal(failed.recovery_scheduled, true);
  assert.equal(failed.recovery_next_model, model);
  assert.equal(f.checkpoints.at(-1).recovery_attempt, 2);
});

test("MB-UX-QUALITY-001 L17 durable focus resume skips the retained rejected Anthropic route", async (t) => {
  const f = fixture(t, [valid()], anthropic);
  const result = await planResearchFocus(
    input,
    { ...plan, round_number: 3, extraction_model: anthropic },
    prior,
    {
      ...f.options,
      approved_rates: [
        {
          model: anthropic,
          provider: "anthropic",
          billing_mode: "byok",
          structured_outputs: true,
          reasoning: true,
        },
        {
          model,
          provider: "openai",
          billing_mode: "byok",
          structured_outputs: true,
          reasoning: true,
        },
      ],
      approved_model_fallbacks: { [anthropic]: [model] },
      approved_search_engines: { [anthropic]: "exa", [model]: "exa" },
    },
    {},
    1,
    {
      model: anthropic,
      phase: "research_focus_analysis",
      error: "The Anthropic privacy route was rejected.",
      provider_http_failure: {
        http_status: 404,
        request_format: "json_schema",
        category: "privacy",
      },
    },
  );
  assert.deepEqual(
    f.requests.map((request) => request.model),
    [model],
  );
  assert.equal(result.result.model, model);
  assert.equal(f.checkpoints[0].recovery_attempt, 2);
});

test("MB-UX-QUALITY-001 L12 unknown HTTP400 remains terminal and does not misreport an exhausted allowance", async (t) => {
  const f = fixture(
    t,
    [
      Response.json(
        { error: { message: "Unclassified upstream failure" } },
        { status: 400 },
      ),
    ],
    gemini,
  );
  await assert.rejects(
    planResearchFocus(
      input,
      { ...plan, extraction_model: gemini },
      prior,
      f.options,
    ),
    /HTTP 400/,
  );
  assert.equal(f.requests.length, 1);
  const failed = f.checkpoints.at(-1);
  assert.equal(failed.recovery_scheduled, false);
  assert.match(failed.message, /provider rejected/i);
  assert.doesNotMatch(failed.message, /exhausted|could not complete within/i);
});

test("MB-UX-QUALITY-001 L12 focus applies Gemini grammar to the effective approved replacement model", async (t) => {
  const f = fixture(
    t,
    [new Response("Temporary upstream failure", { status: 503 }), valid()],
    gemini,
  );
  const result = await planResearchFocus(
    input,
    { ...plan, round_number: 3 },
    prior,
    {
      ...f.options,
      approved_rates: [
        {
          model,
          provider: "openai",
          billing_mode: "byok",
          structured_outputs: true,
          reasoning: true,
        },
        {
          model: gemini,
          provider: "google-ai-studio",
          billing_mode: "byok",
          structured_outputs: true,
          reasoning: true,
        },
      ],
      approved_model_fallbacks: { [model]: [gemini] },
      approved_search_engines: { [gemini]: "exa", [model]: "exa" },
    },
  );
  assert.deepEqual(
    f.requests.map((request) => request.model),
    [model, gemini],
  );
  assert.deepEqual(
    f.requests[0].response_format.json_schema.schema,
    PROGRESSIVE_RESEARCH_FOCUS_SCHEMA,
  );
  assert.deepEqual(
    f.requests[1].response_format.json_schema.schema,
    researchFocusWireSchema(PROGRESSIVE_RESEARCH_FOCUS_SCHEMA, gemini),
  );
  assert.equal(result.result.model, gemini);
  assert.equal(result.analysis.insights[0].status, "research_hypothesis");
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
