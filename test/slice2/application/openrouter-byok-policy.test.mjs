import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, after, test } from "node:test";
import {
  callOpenRouterCompletion,
  runLiveCompletion,
} from "../../../packages/application/dist/openrouter-model-policy.js";
import { EnvironmentProviderTransport } from "../../../packages/application/dist/live-research-environment-runtime.js";

const originalFetch = globalThis.fetch;
const names = [
  "MATCHBASE_OPENROUTER_API_KEY",
  "MATCHBASE_PROVIDER_GOOGLE",
  "MATCHBASE_PROVIDER_OPENAI",
];
const originalEnvironment = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const model = "openai/gpt-5.2";
const request = {
  model,
  messages: [{ role: "user", content: "Return the result." }],
};
let posts, reads, responseBody, metadataResult;
function completion(overrides = {}) {
  return {
    id: "gen-byok-test",
    model,
    choices: [
      {
        finish_reason: "stop",
        message: { content: "Preserve this completed provider response." },
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 18,
      cost: 0,
      cost_details: { upstream_inference_cost: 0.42 },
    },
    openrouter_metadata: {
      requested: model,
      strategy: "direct",
      attempt: 1,
      is_byok: true,
      endpoints: { available: [{ provider: "OpenAI", model, selected: true }] },
    },
    ...overrides,
  };
}
beforeEach(() => {
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  posts = [];
  reads = 0;
  responseBody = completion();
  metadataResult = () =>
    new Response(
      JSON.stringify({
        data: {
          id: "gen-byok-test",
          model,
          provider_name: "OpenAI",
          is_byok: true,
          upstream_inference_cost: 0.42,
        },
      }),
    );
  globalThis.fetch = async (target, options = {}) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return new Response(
        JSON.stringify({
          data: [
            {
              id: model,
              supported_parameters: [
                "max_completion_tokens",
                "structured_outputs",
                "reasoning",
              ],
            },
          ],
        }),
      );
    if (url.endsWith("/endpoints"))
      return new Response(
        JSON.stringify({
          data: {
            endpoints: [
              { tag: "azure", supported_parameters: ["max_completion_tokens"] },
              {
                tag: "openai",
                model_id: model,
                name: "OpenAI | openai/gpt-5.2-20251211",
                supported_parameters: [
                  "max_tokens",
                  "structured_outputs",
                  "reasoning",
                ],
              },
            ],
          },
        }),
      );
    if (url.includes("/generation?")) {
      reads++;
      return metadataResult(reads);
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    posts.push({ body: JSON.parse(options.body), headers: options.headers });
    return new Response(JSON.stringify(responseBody));
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("Live pins the configured provider, uses its parameters, and persists reported BYOK and upstream cost", async () => {
  const events = [];
  const result = await runLiveCompletion(
    request,
    { phase: "step1", loop: 1 },
    { on_checkpoint: (event) => events.push(event) },
  );
  assert.deepEqual(posts[0].body.provider, {
    only: ["openai"],
    order: ["openai"],
    require_parameters: true,
    allow_fallbacks: false,
  });
  assert.equal(posts[0].headers["X-OpenRouter-Metadata"], "enabled");
  assert.ok(posts[0].body.max_tokens);
  assert.equal(posts[0].body.max_completion_tokens, undefined);
  assert.equal(result.is_byok, true);
  assert.equal(result.cost_usd, 0);
  assert.equal(result.cost_reported, true);
  assert.equal(events.at(-1).upstream_inference_cost, 0.42);
  assert.equal(events.at(-1).actual_provider, "OpenAI");
  assert.equal(events.at(-1).byok_verification_source, "response");
  assert.equal(reads, 0);
});

test("shared capacity fails closed and keeps completed response, generation, usage and BYOK evidence", async () => {
  responseBody.openrouter_metadata.is_byok = false;
  const events = [];
  await assert.rejects(
    runLiveCompletion(
      request,
      { phase: "step1", loop: 1 },
      { on_checkpoint: (event) => events.push(event) },
    ),
    /MB-502-LIVE-BYOK-REQUIRED/,
  );
  const failure = events.at(-1);
  assert.equal(failure.state, "failed");
  assert.equal(failure.is_byok, false);
  assert.equal(failure.actual_provider, "OpenAI");
  assert.equal(failure.provider_generation_id, "gen-byok-test");
  assert.equal(
    failure.response_content,
    responseBody.choices[0].message.content,
  );
  assert.equal(failure.input_tokens, 12);
  assert.equal(failure.upstream_inference_cost, 0.42);
  assert.equal(
    JSON.stringify(events).includes(process.env.MATCHBASE_OPENROUTER_API_KEY),
    false,
  );
  assert.equal(posts.length, 1);
  assert.equal(reads, 0);
});

test("missing response BYOK is verified by bounded read-only generation retry without another completion", async () => {
  delete responseBody.openrouter_metadata;
  const valid = metadataResult;
  metadataResult = (attempt) =>
    attempt === 1 ? new Response("", { status: 404 }) : valid();
  const result = await callOpenRouterCompletion(request);
  assert.equal(result.is_byok, true);
  assert.equal(result.byok_verification_source, "generation");
  assert.equal(result.generation_metadata_attempts, 2);
  assert.equal(posts.length, 1);
  assert.equal(reads, 2);
});

test("unknown BYOK after three metadata reads fails closed without a second billed request", async () => {
  delete responseBody.openrouter_metadata;
  metadataResult = () => new Response("", { status: 404 });
  await assert.rejects(callOpenRouterCompletion(request), (error) => {
    assert.match(error.message, /MB-502-LIVE-BYOK-UNVERIFIED/);
    assert.equal(error.audited_response.is_byok, null);
    assert.equal(error.audited_response.generation_metadata_attempts, 3);
    return true;
  });
  assert.equal(posts.length, 1);
  assert.equal(reads, 3);
});

test("generation reported false BYOK cannot authorize Live", async () => {
  delete responseBody.openrouter_metadata;
  metadataResult = () =>
    new Response(
      JSON.stringify({
        data: {
          id: "gen-byok-test",
          model,
          provider_name: "OpenAI",
          is_byok: false,
        },
      }),
    );
  await assert.rejects(callOpenRouterCompletion(request), (error) => {
    assert.match(error.message, /MB-502-LIVE-BYOK-REQUIRED/);
    assert.equal(error.audited_response.is_byok, false);
    return true;
  });
  assert.equal(posts.length, 1);
});

test("actual provider drift is rejected even when is_byok is true", async () => {
  responseBody.openrouter_metadata.endpoints.available[0].provider = "Azure";
  await assert.rejects(
    callOpenRouterCompletion(request),
    /MB-502-LIVE-PROVIDER-DRIFT/,
  );
  assert.equal(reads, 0);
  assert.equal(posts.length, 1);
});

test("actual model drift fails while a dated identity from the selected endpoint catalog is valid", async () => {
  responseBody.model = "openai/gpt-4o";
  await assert.rejects(
    callOpenRouterCompletion(request),
    /MB-502-LIVE-PROVIDER-DRIFT/,
  );
  responseBody = completion();
  responseBody.openrouter_metadata.endpoints.available[0].model =
    "openai/gpt-4o";
  await assert.rejects(
    callOpenRouterCompletion(request),
    /MB-502-LIVE-PROVIDER-DRIFT/,
  );
  responseBody = completion();
  responseBody.model = "openai/gpt-5.2-20251211";
  responseBody.openrouter_metadata.endpoints.available[0].model =
    responseBody.model;
  assert.equal((await callOpenRouterCompletion(request)).is_byok, true);
});

test("metadata for another generation cannot authorize the completed request", async () => {
  delete responseBody.openrouter_metadata;
  metadataResult = () =>
    new Response(
      JSON.stringify({
        data: {
          id: "gen-other",
          model,
          provider_name: "OpenAI",
          is_byok: true,
        },
      }),
    );
  await assert.rejects(
    callOpenRouterCompletion(request),
    /MB-502-LIVE-PROVIDER-DRIFT/,
  );
});

test("Live has no implicit provider route when server configuration is absent", async () => {
  delete process.env.MATCHBASE_PROVIDER_OPENAI;
  await assert.rejects(
    callOpenRouterCompletion(request),
    /MB-503-LIVE-PROVIDER-CONFIG/,
  );
  assert.equal(posts.length, 0);
});

test("MB-UX-LIVE-001 L10 output exhaustion retains billable usage and never retries", async () => {
  responseBody.choices[0].finish_reason = "length";
  responseBody.usage.completion_tokens = 12000;
  responseBody.usage.completion_tokens_details = { reasoning_tokens: 11687 };
  const checkpoints = [];
  await assert.rejects(
    runLiveCompletion(
      { ...request, max_tokens: 24000 },
      { phase: "discovery_openai", loop: 1 },
      {
        max_output_tokens: 12000,
        reasoning_effort: "low",
        on_checkpoint: (checkpoint) => checkpoints.push(checkpoint),
      },
    ),
    (error) => {
      assert.equal(error.code, "MB-422-LIVE-OUTPUT-LIMIT");
      assert.equal(error.retryable, false);
      assert.equal(error.audited_response.reasoning_tokens, 11687);
      assert.equal(error.audited_response.upstream_inference_cost, 0.42);
      return true;
    },
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.reasoning.effort, "low");
  assert.equal(posts[0].body.max_tokens, 12000);
  assert.equal(checkpoints.at(-1).finish_reason, "length");
  assert.equal(checkpoints.at(-1).output_tokens, 12000);
  assert.equal(checkpoints.at(-1).provider_generation_id, "gen-byok-test");
});

test("legacy qualified route accepts explicit BYOK and a genuinely reported zero fee", async () => {
  const legacyModel = "google/gemini-3.6-flash";
  const legacy = {
    ...completion(),
    model: legacyModel,
    openrouter_metadata: {
      requested: legacyModel,
      strategy: "direct",
      attempt: 1,
      is_byok: true,
      endpoints: {
        total: 1,
        available: [
          { provider: "Google Vertex", model: legacyModel, selected: true },
        ],
      },
    },
    choices: [
      { finish_reason: "stop", message: { content: '{"answer":"test"}' } },
    ],
  };
  globalThis.fetch = async () => new Response(JSON.stringify(legacy));
  const transport = new EnvironmentProviderTransport(
    "openrouter",
    "synthetic-credential",
    0.1,
    "test",
    "request",
  );
  const legacyRequest = {
    url: "https://openrouter.ai/api/v1/chat/completions",
    method: "POST",
    headers: {},
    body: "{}",
    signal: new AbortController().signal,
  };
  assert.equal((await transport.send(legacyRequest)).accounting.amount, 0);
  for (const byok of [false, undefined]) {
    legacy.openrouter_metadata.is_byok = byok;
    await assert.rejects(
      transport.send(legacyRequest),
      /routing metadata is invalid/,
    );
  }
  legacy.openrouter_metadata.is_byok = true;
  for (const invalidCost of [null, "", false]) {
    legacy.usage.cost = invalidCost;
    await assert.rejects(
      transport.send(legacyRequest),
      /generation metadata did not reconcile/,
    );
  }
});
