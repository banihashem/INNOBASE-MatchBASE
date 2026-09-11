import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  summarizeResearchCosts,
  buildResearchRoundPlan,
  createRoundCallGuard,
  researchModelChoices,
  configuredResearchTierAvailability,
  researchModelSuitability,
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
  assert.equal(plan.max_calls, 24); // Includes one focus-analysis and four dedicated price-stage calls.
  assert.equal(plan.focus_analysis_required, true);
  assert.deepEqual(plan.follow_up, { question: "", lead_ids: [] });
  assert.ok(plan.assumptions.some((text) => text.includes("one AI analysis")));
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
  assert.equal(plan.synthesis_model, "openai/gpt-5.2");
  assert.deepEqual(plan.focus_requirements, ["Missing seller identity"]);
  const extractionRate = plan.rates.find(
    (rate) => rate.model === plan.extraction_model,
  );
  assert.equal(extractionRate.input_usd_per_token, 0.00000175);
  assert.equal(extractionRate.output_usd_per_token, 0.000014);
  const extractionCalls = plan.max_calls - plan.research_models.length - 3;
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

test("MB-UX-DEV-004 L02 tiers preserve all required families, price engines and recent-price stages", async (t) => {
  const values = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_MODEL_GEMINI: "google/gemini-3.8-flash",
    MATCHBASE_MODEL_OPENAI: "openai/gpt-5.2",
    MATCHBASE_MODEL_SYNTHESIS: "openai/gpt-5.2",
    MATCHBASE_MODEL_PREPARATION: "openai/gpt-5.2",
    MATCHBASE_PROVIDER_ROUTES: JSON.stringify({
      anthropic: "anthropic",
      deepseek: "novita",
      "x-ai": "xai",
    }),
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const providers = {
    google: "google-ai-studio",
    openai: "openai",
    anthropic: "anthropic",
    deepseek: "novita",
    "x-ai": "xai",
  };
  const ids = [
    "google/gemini-3.8-flash",
    "openai/gpt-5.2",
    "anthropic/claude-sonnet-5",
    "deepseek/deepseek-v4-flash",
    "x-ai/grok-4.6",
  ];
  const parameters = (id) => [
    "reasoning",
    "max_tokens",
    ...(id.startsWith("deepseek/") ? [] : ["structured_outputs"]),
  ];
  t.mock.method(globalThis, "fetch", async (target) => {
    const url = String(target);
    assert.ok(
      !url.includes("chat/completions"),
      "Quotes must never start a paid completion",
    );
    if (url.endsWith("/models/user"))
      return Response.json({
        data: ids.map((id) => ({
          id,
          supported_parameters: parameters(id),
          pricing: { prompt: "0.000001", completion: "0.000002" },
        })),
      });
    if (url.endsWith("/endpoints/zdr"))
      return Response.json({
        data: ids.map((model_id) => ({
          model_id,
          tag: providers[model_id.split("/")[0]],
        })),
      });
    const id = decodeURIComponent(
      new URL(url).pathname.split("/models/")[1].replace(/\/endpoints$/, ""),
    );
    return Response.json({
      data: {
        endpoints: [
          {
            tag: providers[id.split("/")[0]],
            model_id: id,
            supported_parameters: parameters(id),
            pricing: {
              prompt: "0.000001",
              completion: "0.000002",
              request: "0",
              web_search: "0.01",
            },
          },
        ],
      },
    });
  });
  const input = {
    round_number: 1,
    depth: "simple",
    parent_round_id: null,
    request_hash: "request",
    focus_requirements: [],
    mode: "live",
  };
  const { plan: standard } = await buildResearchRoundPlan(input);
  const { plan: advanced } = await buildResearchRoundPlan({
    ...input,
    research_tier: "advanced",
  });
  const { plan: ultra } = await buildResearchRoundPlan({
    ...input,
    research_tier: "ultra",
  });
  assert.equal(standard.research_tier, "default");
  assert.equal(standard.research_models.length, 2);
  assert.equal(advanced.research_models.length, 3);
  assert.deepEqual(
    ultra.research_models.map((id) => id.split("/")[0]),
    ["google", "openai", "anthropic", "deepseek", "x-ai"],
  );
  assert.equal(ultra.search_engines["deepseek/deepseek-v4-flash"], "exa");
  assert.equal(ultra.search_engines["x-ai/grok-4.6"], "native");
  assert.equal(
    ultra.rates.find((r) => r.model.startsWith("deepseek/")).provider,
    "novita",
  );
  assert.equal(ultra.synthesis_model, "openai/gpt-5.2");
  assert.equal(ultra.price_research.max_calls, 4);
  assert.equal(ultra.price_research.preferred_window_days, 7);
  assert.equal(ultra.price_research.window_days, 30);
  assert.deepEqual(
    [standard.max_calls, advanced.max_calls, ultra.max_calls],
    [25, 29, 31],
  );
  assert.ok(
    ultra.estimated_high_usd > advanced.estimated_high_usd &&
      advanced.estimated_high_usd > standard.estimated_high_usd,
  );
  const guard = createRoundCallGuard(ultra);
  await assert.rejects(
    guard(
      {
        model: "deepseek/deepseek-v4-flash",
        messages: [],
        plugins: [{ id: "web", engine: "native" }],
      },
      true,
    ),
    { code: "MB-409-ROUND-SEARCH-ENGINE" },
  );
  await guard(
    {
      model: "deepseek/deepseek-v4-flash",
      messages: [],
      plugins: [{ id: "web", engine: "exa", max_results: 8 }],
    },
    true,
  );
  process.env.MATCHBASE_PROVIDER_ROUTES = "{}";
  assert.equal(configuredResearchTierAvailability().ultra.configured, true);
  const { plan: craftedDefault } = await buildResearchRoundPlan({
    ...input,
    depth: "deep",
    research_tier: "default",
    selected_model: "anthropic/claude-sonnet-5",
  });
  assert.equal(craftedDefault.extraction_model, "openai/gpt-5.2");
  assert.ok(
    craftedDefault.rates.every(
      (rate) =>
        /^(google|openai)\//.test(rate.model) && rate.billing_mode === "byok",
    ),
    "A stale or crafted later-round model cannot add credit models to Default",
  );
  const { plan: creditUltra } = await buildResearchRoundPlan({
    ...input,
    research_tier: "ultra",
  });
  assert.deepEqual(
    creditUltra.rates
      .filter((r) => r.billing_mode === "openrouter_credits")
      .map((r) => r.model.split("/")[0]),
    ["anthropic", "deepseek", "x-ai"],
  );
  assert.ok(
    creditUltra.rates
      .filter((r) => /^(google|openai)\//.test(r.model))
      .every((r) => r.billing_mode === "byok"),
  );
  assert.equal(
    creditUltra.rates.find((r) => r.model.startsWith("deepseek/")).provider,
    "novita",
  );
  assert.ok(
    ultra.rates.every((r) => r.billing_mode === "byok"),
    "A new credit quote does not mutate earlier BYOK approvals",
  );
  const deepseekRequest = {
    model: "deepseek/deepseek-v4-flash",
    messages: [],
    plugins: [{ id: "web", engine: "exa", max_results: 8 }],
  };
  await createRoundCallGuard(creditUltra)(deepseekRequest, true);
  process.env.MATCHBASE_PROVIDER_ROUTES = JSON.stringify({
    deepseek: "unavailable-provider",
  });
  await assert.rejects(
    createRoundCallGuard(creditUltra)(deepseekRequest, true),
    { code: "MB-409-ROUND-PROVIDER" },
  );
  await assert.rejects(
    buildResearchRoundPlan({ ...input, research_tier: "ultra" }),
    { code: "MB-422-RESEARCH-TIER-UNAVAILABLE" },
  );
  process.env.MATCHBASE_PROVIDER_ROUTES = "{";
  await assert.rejects(
    buildResearchRoundPlan({ ...input, research_tier: "ultra" }),
    { code: "MB-422-MODEL-UNAVAILABLE" },
  );
  process.env.MATCHBASE_PROVIDER_ROUTES = "{}";
  delete process.env.MATCHBASE_OPENROUTER_API_KEY;
  assert.equal(configuredResearchTierAvailability().ultra.configured, false);
});

test("MB-UX-DEV-004 L04 research suitability excludes coding-only and experimental variants before price", () => {
  for (const id of [
    "x-ai/grok-build-0.1",
    "openai/gpt-5-codex",
    "deepseek/deepseek-v4-flash-vision-exp",
    "deepseek/deepseek-r1-distill-llama-70b",
    "x-ai/grok-4.20-multi-agent",
  ])
    assert.equal(researchModelSuitability(id), -1, id);
  assert.ok(
    researchModelSuitability("deepseek/deepseek-v4-pro-0813") >
      researchModelSuitability("deepseek/deepseek-v4-flash-0731"),
  );
  assert.ok(
    researchModelSuitability("anthropic/claude-sonnet-5") >
      researchModelSuitability("anthropic/claude-haiku-4.5"),
  );
  assert.ok(
    researchModelSuitability("x-ai/grok-4.3") >
      researchModelSuitability("x-ai/grok-3"),
  );
});
test("MB-UX-DEV-004 L04 Ultra quotes search-fit models on ZDR routes and prices hosted Claude Exa", async (t) => {
  const values = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_ROUTES: "{}",
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_MODEL_LANE_OPENAI: "openai/gpt-5.2",
    MATCHBASE_MODEL_LANE_GEMINI: "google/gemini-3.8-flash",
    MATCHBASE_MODEL_SYNTHESIS: "openai/gpt-5.2",
    MATCHBASE_PROVIDER_ANTHROPIC: "",
    MATCHBASE_PROVIDER_DEEPSEEK: "",
    MATCHBASE_PROVIDER_XAI: "",
  };
  const old = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const models = [
    "openai/gpt-5.2",
    "google/gemini-3.8-flash",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-haiku-4.5",
    "deepseek/deepseek-v4-pro-0813",
    "deepseek/deepseek-v4-flash-0731",
    "deepseek/deepseek-v4-flash-vision-exp",
    "x-ai/grok-4.3",
    "x-ai/grok-build-0.1",
  ];
  const params = ["max_tokens", "reasoning", "structured_outputs"];
  const hosted = {
    google: "google-ai-studio",
    openai: "openai",
    anthropic: "amazon-bedrock/global",
    deepseek: "deepinfra/fp8",
    "x-ai": "xai/zdr",
  };
  const endpoint = (model, tag) => ({
    status: 0,
    model_id: model,
    tag,
    provider_name: tag === "amazon-bedrock/global" ? "Amazon Bedrock" : tag,
    supported_parameters: model.includes("v4-pro")
      ? params.filter((value) => value !== "structured_outputs")
      : params,
    pricing: {
      prompt: model.includes("pro") ? "0.00001" : "0.000001",
      completion: "0.000002",
      web_search: "0.01",
    },
  });
  t.mock.method(globalThis, "fetch", async (target) => {
    const url = String(target);
    assert.ok(
      !url.includes("chat/completions"),
      "Quote performs metadata reads only",
    );
    if (url.endsWith("/models/user"))
      return Response.json({
        data: models.map((id) => ({
          id,
          supported_parameters: params,
          pricing: {
            prompt: id.includes("build") ? "0.000000001" : "0.000001",
            completion: "0.000002",
          },
        })),
      });
    if (url.endsWith("/endpoints/zdr"))
      return Response.json({
        data: models.flatMap((id) => [
          endpoint(id, hosted[id.split("/")[0]]),
          ...(id.startsWith("deepseek/") ? [endpoint(id, "fireworks")] : []),
        ]),
      });
    const model = new URL(url).pathname
      .split("/models/")[1]
      .replace(/\/endpoints$/, "");
    const family = model.split("/")[0];
    const rows = [endpoint(model, hosted[family])];
    if (family === "deepseek")
      rows.unshift({
        ...endpoint(model, "fireworks"),
        status: -5,
        pricing: { prompt: "0.000000001", completion: "0.000000001" },
      });
    if (family === "anthropic")
      rows.unshift({
        ...endpoint(model, "anthropic"),
        pricing: { prompt: "0.00000001", completion: "0.00000001" },
      });
    return Response.json({ data: { endpoints: rows } });
  });
  const { plan, choices } = await buildResearchRoundPlan({
    mode: "live",
    round_number: 1,
    research_tier: "ultra",
    depth: "simple",
    request_hash: "research-fit",
    parent_round_id: null,
    focus_requirements: [],
  });
  assert.deepEqual(plan.research_models, [
    "google/gemini-3.8-flash",
    "openai/gpt-5.2",
    "anthropic/claude-sonnet-5",
    "deepseek/deepseek-v4-pro-0813",
    "x-ai/grok-4.3",
  ]);
  assert.ok(
    choices.every(
      (rate) =>
        !rate.model.includes("build") && !rate.model.includes("vision-exp"),
    ),
  );
  assert.equal(
    plan.rates.find((rate) => rate.model.startsWith("anthropic/")).provider,
    "amazon-bedrock/global",
  );
  assert.equal(plan.search_engines["anthropic/claude-sonnet-5"], "exa");
  assert.equal(plan.search_engines["deepseek/deepseek-v4-pro-0813"], "exa");
  assert.equal(
    plan.rates.find((rate) => rate.model.startsWith("deepseek/")).provider,
    "deepinfra/fp8",
    "An offline cheaper endpoint cannot win the quote",
  );
  assert.equal(plan.search_engines["x-ai/grok-4.3"], "native");
  const guard = createRoundCallGuard(plan);
  await assert.rejects(
    guard(
      {
        model: "anthropic/claude-sonnet-5",
        messages: [],
        plugins: [{ id: "web", engine: "native" }],
      },
      true,
    ),
    { code: "MB-409-ROUND-SEARCH-ENGINE" },
  );
  await guard(
    {
      model: "anthropic/claude-sonnet-5",
      messages: [],
      plugins: [{ id: "web", engine: "exa", max_results: 8 }],
    },
    true,
  );
});
