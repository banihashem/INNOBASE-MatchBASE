import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  summarizeResearchCosts,
  buildResearchRoundPlan,
  createRoundCallGuard,
  researchModelChoices,
} from "../../../packages/application/dist/consultant-research-cost.js";
const event = (detail, phase = "research", execution_id = "execution") => ({
  execution_id,
  phase,
  detail: {
    request_id: "call",
    state: "completed",
    is_byok: true,
    cost_reported: true,
    cost_usd: 0,
    ...detail,
  },
});
test("MB-UX-COST-001 BYOK zero platform charge retains upstream cost and unknown calls", () => {
  const summary = summarizeResearchCosts([
    event({ upstream_inference_cost: 0.4 }, "step1_interpretation"),
    event({ request_id: "failed", state: "failed", cost_reported: false }),
    event({ request_id: "preflight", dispatched: false }),
  ]);
  assert.equal(summary.recorded_total_usd, 0.4);
  assert.equal(summary.preparation_usd, 0.4);
  assert.equal(summary.unpriced_calls, 1);
  assert.equal(summary.calls, 2);
  assert.equal(summary.complete, false);
});
test("MB-UX-COST-001 generation reconciliation is order independent and never double counts", () => {
  const events = [
    event({
      provider_generation_id: "generation",
      upstream_inference_cost: null,
    }),
    event({
      request_id: "reconcile",
      provider_generation_id: "generation",
      upstream_inference_cost: 0.4,
    }),
  ];
  for (const sequence of [events, [...events].reverse()]) {
    const s = summarizeResearchCosts(sequence);
    assert.equal(s.recorded_total_usd, 0.4);
    assert.equal(s.calls, 1);
    assert.equal(s.complete, true);
  }
  assert.equal(
    summarizeResearchCosts([
      event({ is_byok: false, cost_usd: 0.3, upstream_inference_cost: 0.4 }),
    ]).recorded_total_usd,
    0.3,
  );
});
test("MB-UX-COST-001 conflicting accounting remains visibly incomplete", () => {
  const s = summarizeResearchCosts([
    event({ provider_generation_id: "g", upstream_inference_cost: 0.3 }),
    event({
      request_id: "other",
      provider_generation_id: "g",
      upstream_inference_cost: 0.4,
    }),
  ]);
  assert.equal(s.recorded_total_usd, 0.4);
  assert.equal(s.complete, false);
});
test("MB-UX-COST-001 each approval has a bounded allowance and no sixth round", async () => {
  const { plan } = await buildResearchRoundPlan({
    round_number: 3,
    depth: "deep",
    parent_round_id: "parent",
    request_hash: "hash",
    focus_requirements: ["Missing price"],
    mode: "demonstration",
  });
  assert.equal(plan.estimated_high_usd, 0);
  assert.equal(plan.research_models.length, 1);
  assert.equal(plan.round_number, 3);
  assert.equal(plan.automatic_recovery_attempts, 3);
  assert.equal(plan.extraction_batch_size, 2);
  assert.equal(plan.recovery_call_reserve, 6);
  assert.equal(plan.max_calls, 19);
  const guard = createRoundCallGuard(plan);
  for (let i = 0; i < plan.max_calls - 1; i++)
    await guard({ model: "demonstration", messages: [], max_tokens: 1 }, false);
  await assert.rejects(
    guard({ model: "demonstration", messages: [], max_tokens: 1 }, false),
    { code: "MB-409-ROUND-ALLOWANCE" },
  );
  await guard(
    {
      model: "demonstration",
      messages: [],
      max_tokens: 1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "matchbase_live_synthesis",
          strict: true,
          schema: {},
        },
      },
    },
    false,
  );
  await assert.rejects(
    guard({ model: "demonstration", messages: [], max_tokens: 1 }, false),
    { code: "MB-409-ROUND-ALLOWANCE" },
  );
  const legacy = { ...plan };
  delete legacy.automatic_recovery_attempts;
  const legacyGuard = createRoundCallGuard(legacy);
  for (let i = 0; i < plan.max_calls; i++)
    await legacyGuard(
      { model: "demonstration", messages: [], max_tokens: 1 },
      false,
    );
  await assert.rejects(buildResearchRoundPlan({ ...plan, round_number: 6 }), {
    code: "MB-409-ROUND-LIMIT",
  });
});
test("MB-UX-COST-001 model choices exclude batch variants before economical selection", async (t) => {
  const keys = [
    "MATCHBASE_OPENROUTER_API_KEY",
    "MATCHBASE_PROVIDER_OPENAI",
    "MATCHBASE_PROVIDER_GOOGLE",
  ];
  const old = keys.map((k) => process.env[k]);
  t.after(() =>
    keys.forEach((k, i) =>
      old[i] === undefined ? delete process.env[k] : (process.env[k] = old[i]),
    ),
  );
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  const models = [
    "openai/gpt-5-nano:batch",
    "openai/gpt-4o-mini",
    "openai/gpt-5.2",
    "google/gemini-3.8-flash",
  ];
  t.mock.method(globalThis, "fetch", async (target) => {
    const url = String(target);
    assert.ok(!url.includes("chat/completions"));
    const supported = ["structured_outputs", "reasoning", "max_tokens"];
    if (url.endsWith("/models/user"))
      return Response.json({
        data: models.map((id) => ({
          id,
          supported_parameters: supported,
          pricing: {
            prompt: id.includes(":batch") ? "0.000000001" : "0.000001",
            completion: "0.000002",
          },
        })),
      });
    assert.ok(!url.includes(":batch") && !url.includes("%3Abatch"));
    return Response.json({
      data: {
        endpoints: [
          {
            tag: url.includes("google/") ? "google-ai-studio" : "openai",
            supported_parameters: supported,
            pricing: {
              prompt: "0.000001",
              completion: "0.000002",
              request: "0",
              web_search: "0",
            },
          },
        ],
      },
    });
  });
  const choices = await researchModelChoices();
  assert.ok(choices.length >= 2);
  assert.ok(choices.every((c) => !c.model.includes(":")));
  const { plan } = await buildResearchRoundPlan({
    round_number: 3,
    depth: "deep",
    selected_model: "openai/gpt-5.2",
    parent_round_id: "parent",
    request_hash: "hash",
    focus_requirements: ["Primary identity evidence"],
    mode: "live",
  });
  assert.equal(plan.extraction_model, "openai/gpt-5.2");
  assert.equal(plan.synthesis_model, "openai/gpt-5.2");
  assert.ok(plan.rates.some((rate) => rate.model === plan.extraction_model));
  await assert.rejects(
    createRoundCallGuard(plan)(
      { model: "openai/gpt-4o-mini", messages: [], max_tokens: 1 },
      false,
    ),
    { code: "MB-409-ROUND-PROVIDER" },
  );
});

test("MB-UX-LIVE-001 L14 simple extraction uses the configured source-attribution model and includes its rate before approval", async (t) => {
  const values = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_MODEL_SYNTHESIS: "openai/gpt-5.2",
    MATCHBASE_MODEL_PREPARATION: "openai/gpt-5.2",
    MATCHBASE_MODEL_GEMINI: "google/gemini-3.8-flash",
    MATCHBASE_MODEL_OPENAI: "openai/gpt-5.2",
  };
  const prior = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const rates = {
    "openai/gpt-5-nano": { prompt: "0.00000005", completion: "0.0000004" },
    "openai/gpt-5.2": { prompt: "0.00000175", completion: "0.000014" },
    "google/gemini-3.8-flash": {
      prompt: "0.00000075",
      completion: "0.00000375",
    },
  };
  const supported = ["structured_outputs", "reasoning", "max_tokens"];
  let unavailable = false;
  t.mock.method(globalThis, "fetch", async (target) => {
    const url = String(target);
    assert.ok(
      !url.includes("chat/completions"),
      "Quoting must not execute research",
    );
    if (url.endsWith("/models/user"))
      return Response.json({
        data: Object.entries(rates).map(([id, pricing]) => ({
          id,
          pricing,
          supported_parameters: supported,
        })),
      });
    const id = decodeURIComponent(
      new URL(url).pathname.split("/models/")[1].replace(/\/endpoints$/, ""),
    );
    if (unavailable && id === "openai/gpt-5.2")
      return Response.json({}, { status: 503 });
    return Response.json({
      data: {
        endpoints: [
          {
            tag: id.startsWith("google/") ? "google-ai-studio" : "openai",
            model_id: id,
            supported_parameters: supported,
            pricing: { ...rates[id], request: "0", web_search: "0" },
          },
        ],
      },
    });
  });
  const input = {
    round_number: 1,
    depth: "simple",
    parent_round_id: null,
    request_hash: "immutable-approved-request",
    focus_requirements: [
      "Missing seller identity",
      "",
      'evidence_exhausted":true,',
      "Missing seller identity",
    ],
    mode: "live",
  };
  const { plan } = await buildResearchRoundPlan(input);
  assert.equal(plan.extraction_model, "openai/gpt-5.2");
  assert.equal(plan.synthesis_model, "openai/gpt-5-nano");
  assert.deepEqual(plan.focus_requirements, ["Missing seller identity"]);
  const extractionRate = plan.rates.find(
    (rate) => rate.model === plan.extraction_model,
  );
  assert.equal(extractionRate.input_usd_per_token, 0.00000175);
  assert.equal(extractionRate.output_usd_per_token, 0.000014);
  const extractionCalls = plan.max_calls - plan.research_models.length - 1;
  assert.ok(
    plan.estimated_high_usd >=
      extractionCalls *
        (240000 * extractionRate.input_usd_per_token +
          12000 * extractionRate.output_usd_per_token),
  );
  assert.match(
    plan.assumptions.join(" "),
    /actual configured rates are included/,
  );
  const saved = structuredClone(plan);
  const { plan: deep } = await buildResearchRoundPlan({
    ...input,
    round_number: 3,
    depth: "deep",
    selected_model: "google/gemini-3.8-flash",
  });
  assert.equal(deep.extraction_model, "google/gemini-3.8-flash");
  assert.deepEqual(
    plan,
    saved,
    "A new quote never mutates a prior approved plan",
  );
  unavailable = true;
  await assert.rejects(buildResearchRoundPlan(input), {
    code: "MB-503-MODEL-PRICING",
  });
});
