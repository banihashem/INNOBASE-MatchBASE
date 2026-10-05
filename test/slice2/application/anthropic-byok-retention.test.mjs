import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { currentResearchModelRate } from "../../../packages/application/dist/consultant-research-cost.js";
import {
  callOpenRouterCompletion,
  getOpenRouterZdrEndpoints,
} from "../../../packages/application/dist/openrouter-model-policy.js";
import { requiresAnthropicByokZdr } from "../../../packages/application/dist/openrouter-byok-policy.js";

// MB-UX-QUALITY-002 L05: all metadata and completions are synthetic; no external access.
function fixture(t, options = {}) {
  const model = options.model ?? "anthropic/claude-sonnet-4.6";
  const provider = options.provider ?? "anthropic";
  const settings = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_ROUTES: "{}",
    MATCHBASE_PROVIDER_ANTHROPIC: options.credit ? "" : "anthropic",
    MATCHBASE_PROVIDER_DEEPSEEK: "",
    MATCHBASE_PROVIDER_XAI: "",
    MATCHBASE_ANTHROPIC_BYOK_RETENTION_ALLOWED: options.flag,
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const state = {
    posts: [],
    reads: [],
    zdr: options.zdr ?? false,
    isByok: !options.credit,
    directEndpoint: true,
    onEndpoint: () => {},
  };
  const pricing = { prompt: "0.000001", completion: "0.000002" };
  const supported_parameters = [
    "max_tokens",
    "reasoning",
    "structured_outputs",
  ];
  t.mock.method(globalThis, "fetch", async (target, init = {}) => {
    const url = String(target);
    if (url.endsWith("/chat/completions")) {
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      state.posts.push(body);
      if (body.provider.zdr && !state.zdr)
        return Response.json(
          { error: { message: "No endpoints match ZDR privacy policy" } },
          { status: 400 },
        );
      return Response.json({
        id: "synthetic-generation",
        model,
        provider: "Anthropic",
        choices: [
          { finish_reason: "stop", message: { content: "Synthetic response" } },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          cost: 0,
          cost_details: { upstream_inference_cost: 0.01 },
        },
        openrouter_metadata: { is_byok: state.isByok },
      });
    }
    assert.equal(init.method ?? "GET", "GET");
    state.reads.push(url);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [{ id: model, pricing, supported_parameters }],
      });
    if (url.endsWith("/endpoints/zdr"))
      return Response.json({
        data: state.zdr ? [{ model_id: model, tag: provider }] : [],
      });
    assert.ok(
      url.endsWith("/endpoints"),
      `Unexpected metadata request: ${url}`,
    );
    state.onEndpoint();
    return Response.json({
      data: {
        endpoints: [
          ...(state.directEndpoint
            ? [
                {
                  model_id: model,
                  tag: provider,
                  provider_name: "Anthropic",
                  status: 0,
                  pricing,
                  supported_parameters,
                },
              ]
            : []),
          {
            model_id: model,
            tag: "amazon-bedrock/global",
            provider_name: "Amazon Bedrock",
            status: 0,
            pricing,
            supported_parameters,
          },
        ],
      },
    });
  });
  return {
    state,
    model,
    request: {
      model,
      messages: [{ role: "user", content: "Synthetic input" }],
    },
  };
}

for (const flag of [
  undefined,
  "",
  "false",
  "TRUE",
  "1",
  " true",
  "true ",
  "invalid",
]) {
  test(`MB-UX-QUALITY-002 L05 absent or invalid opt-in ${JSON.stringify(flag)} retains default admission`, async (t) => {
    const f = fixture(t, { flag });
    await assert.rejects(currentResearchModelRate(f.model), {
      code: "MB-422-MODEL-PRIVACY",
    });
    await assert.rejects(callOpenRouterCompletion(f.request), {
      code: "MB-409-ROUND-PRIVACY",
    });
    assert.equal(f.state.posts.length, 0);
  });
}

test("MB-UX-QUALITY-002 L05 explicit retaining-key permission admits priced direct BYOK without claiming ZDR", async (t) => {
  const f = fixture(t, { flag: "true" });
  const rate = await currentResearchModelRate(f.model);
  assert.equal(rate.provider, "anthropic");
  assert.equal(rate.billing_mode, "byok");
  const result = await callOpenRouterCompletion({
    ...f.request,
    approved_rate: rate,
  });
  assert.equal(result.is_byok, true);
  assert.equal(f.state.posts.length, 1);
  const route = f.state.posts[0].provider;
  assert.deepEqual(route.only, ["anthropic"]);
  assert.deepEqual(route.order, ["anthropic"]);
  assert.equal(route.allow_fallbacks, false);
  assert.equal(route.zdr, undefined);
  assert.equal(
    route.data_collection,
    undefined,
    "The exception must not opt in to provider training",
  );
  assert.ok(
    !f.state.reads.some((url) => url.endsWith("/endpoints/zdr")),
    "Public ZDR catalogue is not a private retaining-key inventory",
  );
});

test("MB-UX-QUALITY-002 L05 permission cannot substitute a hosted route for missing direct Anthropic BYOK", async (t) => {
  const f = fixture(t, { flag: "true" });
  f.state.directEndpoint = false;
  await assert.rejects(currentResearchModelRate(f.model), {
    code: "MB-422-MODEL-PRICING",
  });
  assert.equal(f.state.posts.length, 0);
});

test("MB-UX-QUALITY-002 L05 opted-in server still sends ZDR for an independently approved eligible credit route", async (t) => {
  const f = fixture(t, { flag: "true", credit: true, zdr: true });
  const approved_rate = await currentResearchModelRate(f.model);
  assert.equal(approved_rate.billing_mode, "openrouter_credits");
  const result = await callOpenRouterCompletion({
    ...f.request,
    approved_rate,
  });
  assert.equal(result.is_byok, false);
  assert.equal(f.state.posts[0].provider.zdr, true);
  assert.equal(f.state.posts[0].provider.allow_fallbacks, false);
});

test("MB-UX-QUALITY-002 L05 a retaining BYOK exception still rejects shared-capacity receipts and crafted credit approvals", async (t) => {
  const f = fixture(t, { flag: "true" });
  const approved_rate = await currentResearchModelRate(f.model);
  await assert.rejects(
    callOpenRouterCompletion({
      ...f.request,
      approved_rate: { ...approved_rate, billing_mode: "openrouter_credits" },
    }),
    { code: "MB-409-ROUND-BILLING" },
  );
  assert.equal(f.state.posts.length, 0);
  f.state.isByok = false;
  await assert.rejects(
    callOpenRouterCompletion({ ...f.request, approved_rate }),
    { code: "MB-502-LIVE-BYOK-REQUIRED" },
  );
  assert.equal(f.state.posts.length, 1);
  assert.equal(f.state.posts[0].provider.allow_fallbacks, false);
});

test("MB-UX-QUALITY-002 L05 revocation blocks retaining dispatch from an already qualified rate and cached metadata", async (t) => {
  const f = fixture(t, { flag: "true" });
  const approved_rate = await currentResearchModelRate(f.model);
  await getOpenRouterZdrEndpoints();
  process.env.MATCHBASE_ANTHROPIC_BYOK_RETENTION_ALLOWED = "false";
  await assert.rejects(
    callOpenRouterCompletion({ ...f.request, approved_rate }),
    { code: "MB-409-ROUND-PRIVACY" },
  );
  assert.equal(f.state.posts.length, 0);
  assert.equal(approved_rate.billing_mode, "byok");
});

test("MB-UX-QUALITY-002 L05 revocation during metadata lookup is checked before dispatch", async (t) => {
  const f = fixture(t, { flag: "true" });
  f.state.onEndpoint = () => {
    process.env.MATCHBASE_ANTHROPIC_BYOK_RETENTION_ALLOWED = "false";
  };
  await assert.rejects(callOpenRouterCompletion(f.request), {
    code: "MB-409-ROUND-PRIVACY",
  });
  assert.equal(f.state.posts.length, 0);
});

test("MB-UX-QUALITY-002 L05 default ZDR-qualified direct BYOK retains request-level enforcement despite stale catalogue", async (t) => {
  const f = fixture(t, { zdr: true });
  const approved_rate = await currentResearchModelRate(f.model);
  f.state.zdr = false; // The five-minute public catalogue still contains this endpoint.
  await assert.rejects(
    callOpenRouterCompletion({ ...f.request, approved_rate }),
  );
  assert.equal(f.state.posts.length, 1);
  assert.equal(f.state.posts[0].provider.zdr, true);
  assert.equal(f.state.posts[0].provider.allow_fallbacks, false);
});

for (const [model, provider] of [
  ["anthropic/claude-sonnet-4.6", "anthropic"],
  ["deepseek/deepseek-v4-pro", "ionstream"],
  ["x-ai/grok-4.3", "xai"],
]) {
  test(`MB-UX-QUALITY-002 L05 retaining opt-in never relaxes ${model} credit privacy`, async (t) => {
    const f = fixture(t, { model, provider, flag: "true", credit: true });
    await assert.rejects(currentResearchModelRate(model), {
      code: "MB-422-MODEL-PRICING",
    });
    const approved_rate = {
      model,
      provider,
      billing_mode: "openrouter_credits",
      input_usd_per_token: 0.000001,
      output_usd_per_token: 0.000002,
      request_usd: 0,
      web_search_usd: 0,
    };
    await assert.rejects(
      callOpenRouterCompletion({ ...f.request, approved_rate }),
      { code: "MB-409-ROUND-PRIVACY" },
    );
    assert.equal(f.state.posts.length, 0);
  });
}

test("MB-UX-QUALITY-002 L05 retention scope never changes another family or a hosted provider policy", () => {
  for (const [model, provider, billing] of [
    ["google/gemini", "google-ai-studio", "byok"],
    ["openai/gpt", "openai", "byok"],
    ["anthropic/claude", "amazon-bedrock", "byok"],
    ["anthropic/claude", "anthropic", "openrouter_credits"],
  ])
    assert.equal(requiresAnthropicByokZdr(model, provider, billing), false);
});
