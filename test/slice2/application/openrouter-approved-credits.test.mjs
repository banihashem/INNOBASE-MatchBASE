import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, beforeEach, after } from "node:test";
import {
  callOpenRouterCompletion,
  runLiveCompletion,
} from "../../../packages/application/dist/openrouter-model-policy.js";
const originalFetch = globalThis.fetch;
const names = [
  "MATCHBASE_OPENROUTER_API_KEY",
  "MATCHBASE_PROVIDER_ROUTES",
  "MATCHBASE_PROVIDER_ANTHROPIC",
  "MATCHBASE_PROVIDER_DEEPSEEK",
  "MATCHBASE_PROVIDER_XAI",
  "MATCHBASE_PROVIDER_OPENAI",
  "MATCHBASE_PROVIDER_GOOGLE",
];
const originalEnv = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
let posts, reads, model, provider, display, body, metadata, pricing;
let endpointName, endpointModel, zdrEligible, endpointStatus;
const rate = () => ({
  model,
  provider,
  provider_display_name: display,
  billing_mode: "openrouter_credits",
  input_usd_per_token: 0.000001,
  output_usd_per_token: 0.000002,
  request_usd: 0,
  web_search_usd: 0,
  reasoning: true,
  source_url: "https://openrouter.ai/api/v1/models/" + model + "/endpoints",
});
const request = () => ({
  model,
  messages: [{ role: "user", content: "Return supplier research." }],
});
function setupFamily(id, tag, name) {
  model = id;
  endpointName = `${name} | ${id}`;
  endpointModel = id;
  zdrEligible = true;
  endpointStatus = 0;
  provider = tag;
  display = name;
  body = {
    id: "gen-credit-test",
    model,
    provider: display,
    choices: [
      {
        finish_reason: "stop",
        message: { content: "Grounded research retained." },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.032 },
    openrouter_metadata: { is_byok: false },
  };
  metadata = {
    id: body.id,
    model,
    provider_name: display,
    is_byok: false,
    total_cost: 0.032,
  };
}
beforeEach(() => {
  for (const name of names) delete process.env[name];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  posts = [];
  reads = 0;
  pricing = { prompt: "0.000001", completion: "0.000002" };
  setupFamily("anthropic/claude-sonnet-4.6", "anthropic", "Anthropic");
  globalThis.fetch = async (target, options = {}) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [
          {
            id: model,
            supported_parameters: [
              "max_tokens",
              "reasoning",
              "structured_outputs",
            ],
          },
        ],
      });
    if (url.endsWith("/endpoints/zdr"))
      return Response.json({
        data: zdrEligible ? [{ model_id: model, tag: provider }] : [],
      });
    if (url.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: provider,
              model_id: endpointModel,
              status: endpointStatus,
              name: endpointName,
              provider_name: display,
              supported_parameters: [
                "max_tokens",
                "reasoning",
                "structured_outputs",
              ],
              pricing,
            },
          ],
        },
      });
    if (url.includes("/generation?")) {
      reads++;
      return Response.json({ data: metadata });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    posts.push(JSON.parse(options.body));
    return Response.json(body);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
for (const [id, tag, name] of [
  ["anthropic/claude-sonnet-4.6", "anthropic", "Anthropic"],
  ["deepseek/deepseek-v3.2", "novita", "NovitaAI"],
  ["x-ai/grok-4.1-fast", "xai", "xAI"],
])
  test(`explicit credit approval pins ${id} and retains the actual charge without inventing upstream cost`, async () => {
    setupFamily(id, tag, name);
    const events = [];
    let guards = 0;
    const result = await runLiveCompletion(
      request(),
      { phase: "discovery", loop: 1 },
      {
        approved_rates: [rate()],
        before_call: async () => {
          guards++;
        },
        on_checkpoint: (event) => events.push(event),
      },
    );
    assert.equal(guards, 1);
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].provider.only, [tag]);
    assert.equal(posts[0].provider.allow_fallbacks, false);
    assert.equal(posts[0].provider.max_price.prompt, 1);
    assert.equal(result.is_byok, false);
    assert.equal(result.cost_usd, 0.032);
    assert.equal(result.cost_reported, true);
    assert.equal(result.upstream_inference_cost, null);
    assert.equal(reads, 0);
    assert.equal(events.at(-1).approved_billing_mode, "openrouter_credits");
  });
test("unapproved extra families and credit calls without a round guard cannot dispatch", async () => {
  await assert.rejects(
    runLiveCompletion(request(), { phase: "discovery", loop: 1 }),
    /explicit supported server provider route/,
  );
  await assert.rejects(
    runLiveCompletion(
      request(),
      { phase: "discovery", loop: 1 },
      { approved_rates: [rate()] },
    ),
    /approved round guard/,
  );
  assert.equal(posts.length, 0);
});
test("configured BYOK, malformed route settings and Google/OpenAI cannot fall back to credits", async () => {
  process.env.MATCHBASE_PROVIDER_ANTHROPIC = "unhealthy";
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    /explicitly configured BYOK/,
  );
  delete process.env.MATCHBASE_PROVIDER_ANTHROPIC;
  for (const invalid of ["[]", "null", "{"]) {
    process.env.MATCHBASE_PROVIDER_ROUTES = invalid;
    await assert.rejects(
      callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
      /provider-route mapping/,
    );
  }
  delete process.env.MATCHBASE_PROVIDER_ROUTES;
  for (const id of ["openai/gpt-5.2", "google/gemini-3-pro-preview"]) {
    setupFamily(
      id,
      id.startsWith("openai") ? "openai" : "google-ai-studio",
      "Provider",
    );
    await assert.rejects(
      callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
      /Credit billing is not approved/,
    );
  }
  assert.equal(posts.length, 0);
});
test("legacy configured routes continue to reject shared capacity with no fallback", async () => {
  process.env.MATCHBASE_PROVIDER_ANTHROPIC = "anthropic";
  await assert.rejects(
    callOpenRouterCompletion(request()),
    (error) =>
      error.code === "MB-502-LIVE-BYOK-REQUIRED" &&
      error.audited_response.is_byok === false,
  );
  assert.equal(posts.length, 1);
});
test("credit provider display identity and higher current rates fail before a completion", async () => {
  await assert.rejects(
    callOpenRouterCompletion({
      ...request(),
      approved_rate: { ...rate(), provider_display_name: "Different" },
    }),
    /identity no longer matches/,
  );
  await assert.rejects(
    callOpenRouterCompletion({
      ...request(),
      approved_rate: { ...rate(), input_usd_per_token: 0.0000001 },
    }),
    /pricing no longer fits/,
  );
  assert.equal(posts.length, 0);
});
test("generation metadata supplies missing credit charge and billing mode without rebilling", async () => {
  delete body.usage.cost;
  delete body.openrouter_metadata;
  const result = await callOpenRouterCompletion({
    ...request(),
    approved_rate: rate(),
  });
  assert.equal(result.cost_usd, 0.032);
  assert.equal(result.cost_reported, true);
  assert.equal(result.is_byok, false);
  assert.equal(result.upstream_inference_cost, null);
  assert.equal(reads, 1);
  assert.equal(posts.length, 1);
});
test("credit billing drift preserves generation cost and response usage on the failed audit", async () => {
  delete body.usage.cost;
  delete body.openrouter_metadata;
  metadata.is_byok = true;
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    (error) => {
      assert.equal(error.code, "MB-502-LIVE-BILLING-DRIFT");
      assert.equal(error.audited_response.cost_usd, 0.032);
      assert.equal(error.audited_response.input_tokens, 10);
      assert.equal(error.audited_response.upstream_inference_cost, null);
      return true;
    },
  );
  assert.equal(posts.length, 1);
});
test("unknown credit charges are not converted into zero-cost successful results", async () => {
  delete body.usage.cost;
  delete metadata.total_cost;
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    (error) =>
      error.code === "MB-502-LIVE-COST-UNVERIFIED" &&
      error.audited_response.cost_reported === false,
  );
  assert.equal(reads, 3);
  assert.equal(posts.length, 1);
});
test("actual provider drift rejects the completed response with usage retained", async () => {
  body.provider = "Different";
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    (error) =>
      error.code === "MB-502-LIVE-PROVIDER-DRIFT" &&
      error.audited_response.cost_usd === 0.032,
  );
  assert.equal(posts.length, 1);
});

test("MB-UX-DEV-004 L04 accepts only the exact selected endpoint's declared canonical model alias", async () => {
  setupFamily(
    "deepseek/deepseek-v4-flash-0731",
    "open-inference/fp8",
    "OpenInference",
  );
  endpointName = "OpenInference | deepseek/deepseek-v4-flash-20260731";
  body.openrouter_metadata.endpoints = {
    available: [
      {
        selected: true,
        provider: display,
        model: "deepseek/deepseek-v4-flash-20260731",
      },
    ],
  };
  const result = await callOpenRouterCompletion({
    ...request(),
    approved_rate: rate(),
  });
  assert.equal(result.is_byok, false);
  body.openrouter_metadata.endpoints.available[0].model =
    "deepseek/deepseek-v4-pro-20260813";
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    (error) => error.code === "MB-502-LIVE-PROVIDER-DRIFT",
  );
  assert.equal(posts[0].provider.zdr, true);
});
test("MB-UX-DEV-004 L04 a non-ZDR credit endpoint is rejected before billing", async () => {
  zdrEligible = false;
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    (error) => error.code === "MB-409-ROUND-PRIVACY",
  );
  assert.equal(posts.length, 0);
});
test("MB-UX-DEV-004 L04 hosted Anthropic requires its explicitly priced Exa route", async () => {
  setupFamily(
    "anthropic/claude-sonnet-5",
    "amazon-bedrock/global",
    "Amazon Bedrock",
  );
  await assert.rejects(
    callOpenRouterCompletion({
      ...request(),
      approved_rate: rate(),
      plugins: [{ id: "web", engine: "native" }],
    }),
    (error) => error.code === "MB-409-ROUND-SEARCH-ENGINE",
  );
  assert.equal(posts.length, 0);
  await callOpenRouterCompletion({
    ...request(),
    approved_rate: rate(),
    plugins: [{ id: "web", engine: "exa", max_results: 8 }],
  });
  assert.deepEqual(posts[0].provider.only, ["amazon-bedrock/global"]);
  assert.equal(posts[0].plugins[0].engine, "exa");
});

test("MB-UX-DEV-004 L04 a catalog-declared offline approved endpoint fails before a completion", async () => {
  endpointStatus = -5;
  await assert.rejects(
    callOpenRouterCompletion({ ...request(), approved_rate: rate() }),
    (error) => error.code === "MB-422-MODEL-CAPABILITY",
  );
  assert.equal(posts.length, 0);
});
test("MB-UX-DEV-004 L04 transient catalog health does not silently replace a fixed BYOK route", async () => {
  process.env.MATCHBASE_PROVIDER_ANTHROPIC = "anthropic";
  endpointStatus = -2;
  body.openrouter_metadata.is_byok = true;
  body.usage.cost_details = { upstream_inference_cost: 0.01 };
  const result = await callOpenRouterCompletion(request());
  assert.equal(result.is_byok, true);
  assert.deepEqual(posts[0].provider.only, ["anthropic"]);
  assert.equal(posts.length, 1);
});
