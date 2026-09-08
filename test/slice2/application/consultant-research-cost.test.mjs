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
  const guard = createRoundCallGuard(plan);
  for (let i = 0; i < plan.max_calls; i++)
    await guard({ model: "demonstration", messages: [], max_tokens: 1 }, false);
  await assert.rejects(
    guard({ model: "demonstration", messages: [], max_tokens: 1 }, false),
    { code: "MB-409-ROUND-ALLOWANCE" },
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
});
