import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildResearchRoundPlan,
  createRoundCallGuard,
} from "../../../packages/application/dist/consultant-research-cost.js";

const gemini = "google/gemini-3.8-flash";
const gpt = "openai/gpt-5.2";
const claude = "anthropic/claude-sonnet-5";
const deepseek = "deepseek/deepseek-v4-pro";
const secondGoogle = "google/gemini-3.1-pro";
const supported = ["max_tokens", "reasoning", "structured_outputs"];
const providers = {
  google: "google-ai-studio",
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "novita",
};
const input = {
  mode: "live",
  round_number: 3,
  depth: "deep",
  selected_model: gemini,
  parent_round_id: "previous-completed-round",
  request_hash: "approved-request-hash",
  focus_requirements: ["Resolve retained source gaps"],
};

function fixture(t, options = {}) {
  const catalog = options.models ?? [
    gemini,
    gpt,
    secondGoogle,
    claude,
    deepseek,
  ];
  const settings = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_ROUTES: "{}",
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_ANTHROPIC: "",
    MATCHBASE_PROVIDER_DEEPSEEK: "",
    MATCHBASE_PROVIDER_XAI: "",
    MATCHBASE_MODEL_GEMINI: gemini,
    MATCHBASE_MODEL_OPENAI: gpt,
    MATCHBASE_MODEL_PREPARATION: options.synthesis ?? gpt,
    MATCHBASE_MODEL_SYNTHESIS: options.synthesis ?? gpt,
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  let inferenceCalls = 0;
  const parameters = (id) =>
    options.nonReasoning?.includes(id)
      ? supported.filter((value) => value !== "reasoning")
      : options.unstructured?.includes(id)
        ? supported.filter((value) => value !== "structured_outputs")
        : supported;
  const pricing = (id) => ({
    prompt: id === gpt ? "0.000010" : "0.000001",
    completion: id === gpt ? "0.000020" : "0.000002",
    request: "0",
    web_search: "0",
  });
  t.mock.method(globalThis, "fetch", async (target) => {
    const url = new URL(String(target));
    assert.equal(url.origin, "https://openrouter.ai");
    if (url.pathname.includes("chat/completions")) inferenceCalls++;
    assert.equal(inferenceCalls, 0, "Quoting must never invoke inference");
    if (url.pathname.endsWith("/models/user"))
      return Response.json({
        data: catalog.map((id) => ({
          id,
          pricing: pricing(id),
          supported_parameters: parameters(id),
        })),
      });
    if (url.pathname.endsWith("/endpoints/zdr"))
      return Response.json({
        data: catalog.map((id) => ({
          model_id: id,
          tag: providers[id.split("/")[0]],
        })),
      });
    assert.ok(url.pathname.endsWith("/endpoints"));
    const id = decodeURIComponent(
      url.pathname.split("/models/")[1].replace(/\/endpoints$/, ""),
    );
    if (!catalog.includes(id)) return Response.json({}, { status: 404 });
    return Response.json({
      data: {
        endpoints: [
          {
            model_id: id,
            tag: providers[id.split("/")[0]],
            provider_name: providers[id.split("/")[0]],
            status: 0,
            supported_parameters: parameters(id),
            pricing: pricing(id),
          },
        ],
      },
    });
  });
  return { inferenceCalls: () => inferenceCalls };
}

test("MB-UX-QUALITY-001 L09 a fresh follow-up quotes one independent same-billing alternative and its conservative cost", async (t) => {
  const f = fixture(t);
  const { plan, choices } = await buildResearchRoundPlan(input);
  assert.deepEqual(plan.research_models, [gemini]);
  assert.equal(plan.extraction_model, gemini);
  assert.equal(plan.synthesis_model, gemini);
  assert.deepEqual(plan.model_fallbacks, { [gemini]: [gpt] });
  assert.equal(plan.search_engines[gpt], "exa");
  assert.deepEqual(
    plan.rates.map((rate) => rate.model),
    [gemini, gpt],
  );
  assert.ok(plan.rates.every((rate) => rate.billing_mode === "byok"));
  assert.ok(choices.some((rate) => rate.billing_mode === "openrouter_credits"));
  assert.equal(plan.max_calls, 24);
  assert.equal(plan.recovery_call_reserve, 6);
  assert.equal(plan.automatic_recovery_attempts, 3);
  const highRate = plan.rates.find((rate) => rate.model === gpt);
  assert.ok(
    plan.estimated_high_usd >=
      plan.max_calls *
        (240000 * highRate.input_usd_per_token +
          20000 * highRate.output_usd_per_token),
    "The high estimate covers primary role calls that recover on the more expensive alternative",
  );
  assert.ok(plan.estimated_low_usd < plan.estimated_high_usd);
  assert.match(
    plan.assumptions.join(" "),
    /openai\/gpt-5\.2 through openai \(byok\)/,
  );
  assert.match(
    plan.assumptions.join(" "),
    /Refusals, safety blocks, authentication, billing/,
  );
  assert.equal(f.inferenceCalls(), 0);
});

test("MB-UX-QUALITY-001 L09 first-round and demonstration quotes never gain automatic alternative lanes", async (t) => {
  fixture(t);
  const { plan: initial } = await buildResearchRoundPlan({
    ...input,
    round_number: 1,
    parent_round_id: null,
    depth: "simple",
  });
  assert.equal(initial.model_fallbacks, undefined);
  assert.deepEqual(initial.research_models, [gemini, gpt]);
  const { plan: demonstration } = await buildResearchRoundPlan({
    ...input,
    mode: "demonstration",
  });
  assert.equal(demonstration.model_fallbacks, undefined);
  assert.equal(demonstration.estimated_high_usd, 0);
});

test("MB-UX-QUALITY-001 L09 an explicitly quoted credit primary retains credit billing for its named alternative", async (t) => {
  fixture(t);
  const { plan } = await buildResearchRoundPlan({
    ...input,
    selected_model: claude,
  });
  assert.deepEqual(plan.model_fallbacks, { [claude]: [deepseek] });
  assert.ok(
    plan.rates.every((rate) => rate.billing_mode === "openrouter_credits"),
  );
  assert.equal(plan.search_engines[deepseek], "exa");
  await createRoundCallGuard(plan)(
    {
      model: deepseek,
      messages: [],
      max_tokens: 1,
      plugins: [{ id: "web", engine: "exa", max_results: 8 }],
    },
    true,
  );
});

test("MB-UX-QUALITY-001 L09 missing or incompatible same-billing alternatives remain explicit without credit switching", async (t) => {
  for (const options of [
    { models: [gemini, claude], synthesis: gemini },
    { models: [gemini, gpt], nonReasoning: [gpt] },
    { models: [gemini, gpt], unstructured: [gpt] },
  ])
    await t.test("No compatible alternative", async (subtest) => {
      fixture(subtest, options);
      const { plan } = await buildResearchRoundPlan(input);
      assert.equal(plan.model_fallbacks, undefined);
      assert.deepEqual(
        plan.rates.map((rate) => rate.model),
        [gemini],
      );
      assert.match(
        plan.assumptions.join(" "),
        /No compatible same-billing alternative/,
      );
    });
});

test("MB-UX-QUALITY-001 L09 round guard binds the named alternative to role engine provider and existing allowance", async (t) => {
  fixture(t);
  const { plan } = await buildResearchRoundPlan(input);
  const snapshot = structuredClone(plan);
  const web = {
    model: gpt,
    messages: [],
    max_tokens: 1,
    plugins: [{ id: "web", engine: "exa", max_results: 8 }],
  };
  await createRoundCallGuard(plan)(web, true);
  await createRoundCallGuard(plan)(
    { model: gpt, messages: [], max_tokens: 1 },
    false,
  );
  const historical = structuredClone(plan);
  delete historical.model_fallbacks;
  await assert.rejects(createRoundCallGuard(historical)(web, true), {
    code: "MB-409-ROUND-MODEL",
  });
  await assert.rejects(
    createRoundCallGuard(plan)(
      { ...web, plugins: [{ id: "web", engine: "native" }] },
      true,
    ),
    { code: "MB-409-ROUND-SEARCH-ENGINE" },
  );
  await assert.rejects(createRoundCallGuard(plan, 23)(web, true), {
    code: "MB-409-ROUND-ALLOWANCE",
  });
  await createRoundCallGuard(plan, 23)(
    {
      model: gpt,
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
  process.env.MATCHBASE_PROVIDER_OPENAI = "azure";
  await assert.rejects(createRoundCallGuard(plan)(web, true), {
    code: "MB-409-ROUND-PROVIDER",
  });
  assert.deepEqual(plan, snapshot);
});

test("MB-UX-QUALITY-001 L09 malformed unpriced and cross-billing recovery maps fail before dispatch", async (t) => {
  fixture(t);
  const { plan } = await buildResearchRoundPlan(input);
  const invalid = [
    { ...plan, round_number: 1 },
    { ...plan, automatic_recovery_attempts: 1 },
    { ...plan, recovery_call_reserve: 0 },
    { ...plan, model_fallbacks: { [gemini]: [gpt, claude] } },
    { ...plan, model_fallbacks: { [gemini]: [gemini] } },
    { ...plan, model_fallbacks: { [gemini]: [claude] } },
    { ...plan, model_fallbacks: { "unapproved/primary": [gpt] } },
    { ...plan, model_fallbacks: { [gemini]: gpt } },
    { ...plan, search_engines: { [gemini]: "exa" } },
    ...["billing_mode", "structured_outputs", "reasoning"].map((field) => ({
      ...plan,
      rates: plan.rates.map((rate) =>
        rate.model === gpt
          ? {
              ...rate,
              [field]: field === "billing_mode" ? "openrouter_credits" : false,
            }
          : rate,
      ),
    })),
  ];
  for (const altered of invalid)
    assert.throws(() => createRoundCallGuard(altered), {
      code: "MB-409-ROUND-FALLBACK",
    });
});

test("MB-UX-QUALITY-001 L09 alternatives cannot transitively expand the approved search role", async (t) => {
  fixture(t);
  process.env.MATCHBASE_PROVIDER_ROUTES = JSON.stringify({
    deepseek: "novita",
  });
  const { plan, choices } = await buildResearchRoundPlan(input);
  const extra = choices.find((rate) => rate.model === deepseek);
  const scoped = {
    ...plan,
    extraction_model: gpt,
    rates: [...plan.rates, extra],
    model_fallbacks: { [gemini]: [gpt], [gpt]: [deepseek] },
  };
  await assert.rejects(
    createRoundCallGuard(scoped)(
      {
        model: deepseek,
        messages: [],
        max_tokens: 1,
        plugins: [{ id: "web", engine: "exa" }],
      },
      true,
    ),
    { code: "MB-409-ROUND-MODEL" },
  );
  await createRoundCallGuard(scoped)(
    { model: deepseek, messages: [], max_tokens: 1 },
    false,
  );
});
