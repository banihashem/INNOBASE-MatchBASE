import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { planResearchFocus } from "../../../packages/application/dist/research-focus-planner.js";
import { LiveResearchError } from "../../../packages/application/dist/openrouter-model-policy.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

const model = "openai/gpt-5.2";
const input = {
  product_requirement: "Industrial potassium hydroxide flakes",
  technical_compliance: "Purity at least 90%; ISO9001 or applicable standard",
  order_profile: "China manufacturer preferred; quantity not confirmed",
  deep_prompt: "Approved evidence-based research plan",
};
const leads = Array.from({ length: 36 }, (_, index) => ({
  lead_id: researchLeadKey(`Supplier ${index}`),
  name: `Supplier ${index}`,
  anchor_quote: `Public product listing for Supplier ${index}`,
  source_urls: [`https://supplier-${index}.example.com/product`],
  first_seen_round: 1,
  last_seen_round: 1,
}));
const prior = {
  indexed_leads: leads,
  roster: [],
  evidence: [],
  retrieved: [],
  remaining_gaps: ["Dated comparable price", "Applicable quality standard"],
};
const plan = {
  round_number: 2,
  extraction_model: model,
  max_input_tokens_per_call: 240000,
  max_output_tokens_per_call: 20000,
  purpose: "Resolve remaining commercial and technical evidence gaps",
  follow_up: {
    question: "Which promising leads provide dated comparable prices?",
    lead_ids: leads.slice(0, 33).map((lead) => lead.lead_id),
  },
};
const valid = () => ({
  objective: "Resolve dated comparable prices and relevant quality evidence",
  question_summary: "Check recent offers and source comparability",
  priority_lead_ids: [leads[35].lead_id],
  search_tasks: [
    "Inspect dated supplier offers and retain currency, unit and Incoterm",
    "Check ISO9001 or the applicable standard without imposing an ISO-only gate",
  ],
  evidence_gaps: ["Comparable offer date and commercial basis"],
  scope_notes: ["Order quantity remains unknown"],
});

function fixture(t, responses) {
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
  const requests = [];
  const checkpoints = [];
  const guards = [];
  const parameters = ["structured_outputs", "max_tokens", "reasoning"];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [{ id: model, supported_parameters: parameters }],
      });
    if (url.endsWith("/endpoints"))
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
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    requests.push(body);
    const scenario = responses[requests.length - 1];
    assert.ok(scenario, "No unapproved extra attempt may be dispatched");
    if (scenario.status)
      return new Response("Temporary upstream failure", {
        status: scenario.status,
      });
    return Response.json({
      id: `focus-recovery-${requests.length}`,
      model,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [{ selected: true, model, provider: "OpenAI" }],
        },
      },
      choices: [
        {
          finish_reason: scenario.finish_reason ?? "stop",
          message: {
            content:
              typeof scenario.content === "string"
                ? scenario.content
                : JSON.stringify(scenario.content ?? valid()),
          },
        },
      ],
      usage: {
        prompt_tokens: 36150,
        completion_tokens: scenario.finish_reason === "length" ? 5000 : 1200,
        completion_tokens_details: { reasoning_tokens: 700 },
        cost: 0,
        cost_details: { upstream_inference_cost: 0.01 },
      },
    });
  });
  return {
    requests,
    checkpoints,
    guards,
    options: {
      automatic_recovery_attempts: 3,
      reasoning_effort: "high",
      before_call: async (request, web) => guards.push({ request, web }),
      on_checkpoint: async (checkpoint) => checkpoints.push(checkpoint),
    },
  };
}

test("MB-UX-QUALITY-001 L05 focus planning retains 33 selections without expanding the generated plan", async (t) => {
  const f = fixture(t, [{}]);
  const original = structuredClone(prior);
  const result = await planResearchFocus(input, plan, prior, f.options);
  assert.deepEqual(result.analysis.priority_lead_ids, [
    ...plan.follow_up.lead_ids,
    leads[35].lead_id,
  ]);
  assert.deepEqual(prior, original);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].max_tokens, 12000);
  assert.deepEqual(f.requests[0].reasoning, { effort: "high", exclude: true });
  assert.equal(f.requests[0].model, model);
  assert.equal(f.requests[0].plugins, undefined);
  assert.equal(f.guards[0].web, false);
  const context = JSON.parse(f.requests[0].messages[1].content);
  assert.deepEqual(
    context.prior_leads.map((lead) => lead.name),
    leads.map((lead) => lead.name),
  );
  assert.deepEqual(context.buyer_follow_up.lead_ids, plan.follow_up.lead_ids);
  const instructions = f.requests[0].messages[0].content;
  assert.match(
    instructions,
    /Every buyer-selected lead is retained automatically/,
  );
  assert.match(instructions, /Do not repeat the lead inventory/);
  assert.match(instructions, /ALL supplied prior lead inventory/);
  assert.equal(f.checkpoints.at(-1).state, "completed");
});

test("MB-UX-QUALITY-001 L05 truncation is retained and repaired inside the existing approved stage", async (t) => {
  const partial = '{"objective":"Incomplete plan';
  const f = fixture(t, [{ content: partial, finish_reason: "length" }, {}]);
  const result = await planResearchFocus(input, plan, prior, f.options);
  assert.equal(result.analysis.objective, valid().objective);
  assert.equal(f.requests.length, 2);
  assert.equal(f.guards.length, 2);
  const failed = f.checkpoints.find(
    (checkpoint) => checkpoint.state === "failed",
  );
  assert.equal(failed.error, "MB-422-LIVE-OUTPUT-LIMIT");
  assert.equal(failed.response_content, partial);
  assert.equal(failed.output_tokens, 5000);
  assert.equal(failed.upstream_inference_cost, 0.01);
  assert.equal(failed.recovery_scheduled, true);
  assert.equal(failed.recovery_attempt, 1);
  assert.equal(failed.max_recovery_attempts, 3);
  assert.match(f.requests[1].messages[0].content, /shorter complete JSON/);
  assert.ok(
    !f.requests[1].messages.some((message) =>
      message.content.includes(partial),
    ),
  );
});

test("MB-UX-QUALITY-001 L05 invalid focus priorities recover before any successful checkpoint", async (t) => {
  const f = fixture(t, [
    {
      content: { ...valid(), priority_lead_ids: [researchLeadKey("Invented")] },
    },
    {},
  ]);
  await planResearchFocus(input, plan, prior, f.options);
  assert.equal(f.requests.length, 2);
  const completed = f.checkpoints.filter(
    (checkpoint) => checkpoint.state === "completed",
  );
  assert.equal(completed.length, 1);
  assert.equal(completed[0].recovery_attempt, 2);
  const failed = f.checkpoints.find(
    (checkpoint) => checkpoint.state === "failed",
  );
  assert.equal(failed.error, "MB-422-FOCUS-PLAN");
  assert.match(failed.response_content, /priority_lead_ids/);
});

test("MB-UX-QUALITY-001 L05 verbose schema output is repaired instead of truncating the accepted analysis", async (t) => {
  const f = fixture(t, [
    {
      content: {
        ...valid(),
        search_tasks: Array(9).fill("Repeated supplier task"),
      },
    },
    {},
  ]);
  const result = await planResearchFocus(input, plan, prior, f.options);
  assert.deepEqual(result.analysis.search_tasks, valid().search_tasks);
  assert.equal(f.requests.length, 2);
  assert.equal(
    f.checkpoints.find((event) => event.state === "failed").error,
    "MB-422-LIVE-SCHEMA",
  );
});

test("MB-UX-QUALITY-001 L05 transport, schema and output recovery share three dispatches", async (t) => {
  const f = fixture(t, [
    { status: 503 },
    { content: { objective: "Missing fields" } },
    { content: '{"objective":', finish_reason: "length" },
  ]);
  await assert.rejects(planResearchFocus(input, plan, prior, f.options), {
    code: "MB-422-LIVE-OUTPUT-LIMIT",
  });
  assert.equal(f.requests.length, 3);
  assert.equal(f.guards.length, 3);
  assert.deepEqual(
    f.checkpoints
      .filter((event) => event.state === "started")
      .map((event) => event.recovery_attempt),
    [1, 2, 3],
  );
  assert.equal(f.checkpoints.at(-1).recovery_scheduled, false);
});

test("MB-UX-QUALITY-001 L05 historical dispatch is counted in the same three-attempt focus allowance", async (t) => {
  const f = fixture(t, [
    { content: '{"objective":', finish_reason: "length" },
    { content: '{"objective":', finish_reason: "length" },
  ]);
  await assert.rejects(
    planResearchFocus(input, plan, prior, f.options, {}, 1),
    {
      code: "MB-422-LIVE-OUTPUT-LIMIT",
    },
  );
  assert.equal(f.requests.length, 2);
  assert.deepEqual(
    f.checkpoints
      .filter((event) => event.state === "started")
      .map((event) => event.recovery_attempt),
    [2, 3],
  );
  assert.ok(f.checkpoints.every((event) => event.max_recovery_attempts === 3));
});

for (const used of [-1, 0.5, 3, 4]) {
  test(`MB-UX-QUALITY-001 L05 exhausted or invalid prior attempt count ${used} blocks dispatch`, async (t) => {
    const f = fixture(t, []);
    await assert.rejects(
      planResearchFocus(input, plan, prior, f.options, {}, used),
      {
        code: "MB-409-STAGE-ALLOWANCE",
      },
    );
    assert.equal(f.requests.length, 0);
    assert.equal(f.guards.length, 0);
  });
}

test("MB-UX-QUALITY-001 L05 retries require a call guard and never raise a lower approved output cap", async (t) => {
  const f = fixture(t, [{ content: '{"objective":', finish_reason: "length" }]);
  const { before_call: _guard, ...unguarded } = f.options;
  await assert.rejects(
    planResearchFocus(
      input,
      { ...plan, max_output_tokens_per_call: 4000 },
      prior,
      unguarded,
    ),
    {
      code: "MB-422-LIVE-OUTPUT-LIMIT",
    },
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].max_tokens, 4000);
  assert.equal(f.checkpoints.at(-1).max_recovery_attempts, 1);
});

test("MB-UX-QUALITY-001 L05 round guard rejection is terminal even if marked retryable", async (t) => {
  const f = fixture(t, []);
  const rejected = new LiveResearchError(
    "MB-503-LIVE-TRANSPORT",
    "Guard rejected dispatch",
    true,
  );
  let checks = 0;
  await assert.rejects(
    planResearchFocus(input, plan, prior, {
      ...f.options,
      before_call: async () => {
        checks++;
        throw rejected;
      },
    }),
    (error) => error === rejected,
  );
  assert.equal(checks, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.checkpoints.at(-1).recovery_scheduled, false);
});

test("MB-UX-QUALITY-001 L05 cancellation after a failed focus response prevents the next call", async (t) => {
  const f = fixture(t, [{ content: '{"objective":', finish_reason: "length" }]);
  const controller = new AbortController();
  await assert.rejects(
    planResearchFocus(input, plan, prior, {
      ...f.options,
      signal: controller.signal,
      on_checkpoint: async (checkpoint) => {
        f.checkpoints.push(checkpoint);
        if (checkpoint.state === "failed")
          controller.abort(new Error("Stopped by user"));
      },
    }),
    /Stopped by user/,
  );
  assert.equal(f.requests.length, 1);
});

test("MB-UX-QUALITY-001 L05 provider authorization failure does not trigger content repair", async (t) => {
  const f = fixture(t, [{ status: 403 }]);
  await assert.rejects(planResearchFocus(input, plan, prior, f.options), {
    code: "MB-502-LIVE-PROVIDER",
  });
  assert.equal(f.requests.length, 1);
  assert.equal(f.checkpoints.at(-1).recovery_scheduled, false);
});
