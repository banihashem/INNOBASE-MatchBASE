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
            provider: "Google",
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

test("production OpenRouter transport reconciles in-band POST metadata without fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      headers: options.headers,
    });
    return jsonResponse(completion(), {
      "x-generation-id": "generation-runtime-id",
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
    const result = await transport.send({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: new AbortController().signal,
    });
    assert.equal(calls.filter((entry) => entry.method === "POST").length, 1);
    assert.equal(calls.filter((entry) => entry.method === "GET").length, 0);
    const post = calls.find((entry) => entry.method === "POST");
    assert.equal(post.headers["X-OpenRouter-Metadata"], "enabled");
    assert.equal(
      calls.some((entry) => entry.url.includes("/generation")),
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

test("production OpenRouter transport accepts additive metadata and an opaque bounded pipeline without a secondary GET", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const base = completion();
    return jsonResponse(
      completion({
        openrouter_metadata: {
          ...base.openrouter_metadata,
          future_optional_field: { version: 2 },
          endpoints: {
            ...base.openrouter_metadata.endpoints,
            future_endpoint_summary: "additive",
            available: base.openrouter_metadata.endpoints.available.map(
              (candidate) => ({ ...candidate, future_latency_ms: 12 }),
            ),
          },
          attempts: base.openrouter_metadata.attempts.map((attempt) => ({
            ...attempt,
            future_trace: "opaque",
          })),
          pipeline: [
            { type: "future_stage", version: 1, opaque: { enabled: true } },
          ],
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
    const result = await transport.send({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: new AbortController().signal,
    });
    assert.deepEqual(result.servedIdentity, {
      providerId: "google-vertex",
      modelId: "google/gemini-3.6-flash",
    });
    assert.equal(result.accounting?.state, "priced");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production OpenRouter transport accepts an omitted optional attempts field when one endpoint is selected", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const base = completion();
    const metadata = { ...base.openrouter_metadata };
    delete metadata.attempts;
    return jsonResponse(
      completion({
        openrouter_metadata: metadata,
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
    const result = await transport.send({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: new AbortController().signal,
    });
    assert.deepEqual(result.servedIdentity, {
      providerId: "google-vertex",
      modelId: "google/gemini-3.6-flash",
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production OpenRouter transport rejects in-band metadata identity drift without retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const base = completion();
    return jsonResponse(
      completion({
        openrouter_metadata: {
          ...base.openrouter_metadata,
          endpoints: {
            total: 1,
            available: [
              {
                provider: "Google AI Studio",
                model: "google/gemini-3.6-flash",
                selected: true,
              },
            ],
          },
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

test("production OpenRouter transport rejects a selected provider outside the closed Google Vertex route", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const base = completion();
    return jsonResponse(
      completion({
        openrouter_metadata: {
          ...base.openrouter_metadata,
          endpoints: {
            total: 1,
            available: [
              {
                provider: "Amazon Bedrock",
                model: "google/gemini-3.6-flash",
                selected: true,
              },
            ],
          },
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

test("production OpenRouter transport rejects selected and attempted model drift", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const base = completion();
    return jsonResponse(
      completion({
        openrouter_metadata: {
          ...base.openrouter_metadata,
          attempts: [
            {
              provider: "Google",
              model: "google/gemini-3.6-flash-20260721",
              status: 200,
            },
          ],
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

test("production OpenRouter transport rejects generation ID drift without a secondary GET", async () => {
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
