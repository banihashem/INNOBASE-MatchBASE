import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentProviderTransport } from "../../packages/application/dist/live-research-environment-runtime.js";

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function completion(overrides = {}) {
  return {
    id: "generation-runtime-id",
    model: "google/gemini-3.6-flash",
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify({ answer: "synthetic" }) },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.000078 },
    openrouter_metadata: {
      requested: "google/gemini-3.6-flash",
      strategy: "direct",
      attempt: 1,
      endpoints: {
        total: 1,
        available: [
          {
            provider: "Google Vertex",
            model: "google/gemini-3.6-flash",
            selected: true,
          },
        ],
      },
      attempts: [],
      pipeline: [],
    },
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    data: {
      id: "generation-runtime-id",
      provider_name: "Google Vertex",
      model: "google/gemini-3.6-flash",
      finish_reason: "stop",
      tokens_prompt: 12,
      tokens_completion: 8,
      total_cost: 0.000078,
      ...overrides,
    },
  };
}

test("production OpenRouter transport reconciles one metadata GET without fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      headers: options.headers,
    });
    return options.method === "POST"
      ? jsonResponse(completion(), {
          "x-generation-id": "generation-runtime-id",
        })
      : jsonResponse(metadata());
  };
  try {
    const transport = new EnvironmentProviderTransport(
      "openrouter",
      "test-secret",
      0.1,
      "test-pricing",
      "request",
    );
    const result = await transport.send({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: new AbortController().signal,
    });
    assert.equal(calls.filter((entry) => entry.method === "POST").length, 1);
    assert.equal(calls.filter((entry) => entry.method === "GET").length, 1);
    const post = calls.find((entry) => entry.method === "POST");
    const metadataGet = calls.find((entry) => entry.method === "GET");
    assert.equal(post.headers["X-OpenRouter-Metadata"], "enabled");
    assert.equal(metadataGet.headers.Authorization, "Bearer test-secret");
    assert.match(metadataGet.url, /\/api\/v1\/generation\?id=/u);
    assert.equal(
      calls.some((entry) => entry.url.includes("/generation/content")),
      false,
    );
    assert.deepEqual(result.servedIdentity, {
      providerId: "google-vertex",
      modelId: "google/gemini-3.6-flash",
    });
    assert.equal(result.accounting?.state, "priced");
    assert.equal(result.accounting?.amount, 0.000078);
    assert.equal(
      JSON.stringify(result).includes("generation-runtime-id"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production OpenRouter transport rejects unknown routing topology before metadata GET", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const base = completion();
    return jsonResponse(
      completion({
        openrouter_metadata: {
          ...base.openrouter_metadata,
          unknown_topology: true,
        },
      }),
      { "x-generation-id": "generation-runtime-id" },
    );
  };
  try {
    const transport = new EnvironmentProviderTransport(
      "openrouter",
      "test-secret",
      0.1,
      "test-pricing",
      "request",
    );
    await assert.rejects(
      transport.send({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: new AbortController().signal,
      }),
      /routing metadata is invalid/iu,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production OpenRouter transport rejects metadata identity drift without retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    return options.method === "POST"
      ? jsonResponse(completion(), {
          "x-generation-id": "generation-runtime-id",
        })
      : jsonResponse(metadata({ provider_name: "Google AI Studio" }));
  };
  try {
    const transport = new EnvironmentProviderTransport(
      "openrouter",
      "test-secret",
      0.1,
      "test-pricing",
      "request",
    );
    await assert.rejects(
      transport.send({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: new AbortController().signal,
      }),
      /did not reconcile/iu,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production OpenRouter transport rejects generation ID drift before metadata GET", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(completion(), {
      "x-generation-id": "different-generation-id",
    });
  };
  try {
    const transport = new EnvironmentProviderTransport(
      "openrouter",
      "test-secret",
      0.1,
      "test-pricing",
      "request",
    );
    await assert.rejects(
      transport.send({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: new AbortController().signal,
      }),
      /generation identities differ/iu,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
