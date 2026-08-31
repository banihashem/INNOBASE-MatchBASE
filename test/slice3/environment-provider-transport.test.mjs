import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  EnvironmentProviderTransport,
  readBoundedProviderJson,
} from "../../packages/application/dist/live-research-environment-runtime.js";
import { canonicalSourceUrls } from "../../packages/application/dist/live-research-execution.js";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("provider JSON reader cuts off chunked and compressed bodies before unbounded materialization", async () => {
  const oversizedJson = JSON.stringify({
    payload: "x".repeat(2 * 1024 * 1024),
  });
  const compressed = gzipSync(oversizedJson);
  await withServer(
    (request, response) => {
      if (request.url === "/chunked") {
        response.writeHead(200, { "content-type": "application/json" });
        for (let offset = 0; offset < oversizedJson.length; offset += 16_384)
          response.write(oversizedJson.slice(offset, offset + 16_384));
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(compressed.byteLength),
      });
      response.end(compressed);
    },
    async (origin) => {
      await assert.rejects(
        readBoundedProviderJson(await fetch(`${origin}/chunked`)),
        /bounded JSON limit/u,
      );
      await assert.rejects(
        readBoundedProviderJson(await fetch(`${origin}/compressed`)),
        /bounded JSON limit/u,
      );
    },
  );
});

test("provider JSON reader accepts a bounded streamed object", async () => {
  const body = JSON.stringify({ result: "bounded" });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body.slice(0, 8)));
      controller.enqueue(new TextEncoder().encode(body.slice(8)));
      controller.close();
    },
  });
  assert.deepEqual(
    await readBoundedProviderJson(
      new Response(stream, { headers: { "content-type": "application/json" } }),
    ),
    { result: "bounded" },
  );
});

test("server-owned source URLs canonicalize root paths before deduplication", () => {
  assert.deepEqual(canonicalSourceUrls(["https://example.org"]), [
    "https://example.org/",
  ]);
  assert.throws(
    () => canonicalSourceUrls(["https://example.org", "https://example.org/"]),
    /invalid URLs/u,
  );
});

test("Gemini interaction transport requires closed Google Search lineage", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        created: "2026-08-31T00:00:00Z",
        id: "interaction-matchbase-1",
        model: "gemini-3.6-flash",
        object: "interaction",
        service_tier: "default",
        status: "completed",
        steps: [
          {
            type: "google_search_call",
            id: "search-1",
            arguments: { queries: ["industrial pump HS code"] },
            search_type: "web",
            signature: "bounded",
          },
          {
            type: "google_search_result",
            call_id: "search-1",
            is_error: false,
            result: [],
            signature: "bounded",
          },
          { type: "thought", signature: "bounded" },
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  sourceUrls: ["https://example.org/evidence"],
                }),
              },
            ],
          },
        ],
        updated: "2026-08-31T00:00:01Z",
        usage: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const transport = new EnvironmentProviderTransport(
      "gemini_direct",
      "test-secret",
      1,
      "gemini-3.6-conservative-upper.2026-08-16",
      "search",
    );
    const response = await transport.send({
      url: "https://generativelanguage.googleapis.com/v1beta/interactions",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: new AbortController().signal,
    });
    assert.deepEqual(response.body, {
      sourceUrls: ["https://example.org/evidence"],
    });
    assert.deepEqual(response.servedIdentity, {
      providerId: "google",
      modelId: "gemini-3.6-flash",
    });
    assert.equal(response.accounting?.unit, "search");
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("Gemini interaction transport rejects ungrounded model output", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        created: "2026-08-31T00:00:00Z",
        id: "interaction-matchbase-2",
        model: "gemini-3.6-flash",
        object: "interaction",
        service_tier: "default",
        status: "completed",
        steps: [
          { type: "thought", signature: "bounded" },
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  sourceUrls: ["https://example.org/unverified"],
                }),
              },
            ],
          },
        ],
        updated: "2026-08-31T00:00:01Z",
        usage: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const transport = new EnvironmentProviderTransport(
      "gemini_direct",
      "test-secret",
      1,
      "gemini-3.6-conservative-upper.2026-08-16",
      "search",
    );
    await assert.rejects(
      transport.send({
        url: "https://generativelanguage.googleapis.com/v1beta/interactions",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: new AbortController().signal,
      }),
      /interaction envelope|search lineage/u,
    );
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("OpenRouter transport audits in-band served identity without a secondary metadata request", async () => {
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response(
      JSON.stringify({
        id: "gen-matchbase-1",
        model: "google/gemini-3.6-flash",
        openrouter_metadata: {
          requested: "google/gemini-3.6-flash",
          strategy: "direct",
          attempt: 1,
          endpoints: {
            total: 1,
            available: [
              {
                provider: "Google Vertex",
                model: "google/gemini-3.6-flash-20260721",
                selected: true,
              },
            ],
          },
          attempts: [
            {
              provider: "Google Vertex",
              model: "google/gemini-3.6-flash-20260721",
              status: 200,
            },
          ],
          pipeline: [],
          region: null,
          summary: "direct",
          is_byok: false,
          params: {},
        },
        usage: { prompt_tokens: 12, completion_tokens: 8, cost: 0.000078 },
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ answer: "bounded" }) },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-generation-id": "gen-matchbase-1",
        },
      },
    );
  };
  try {
    const transport = new EnvironmentProviderTransport(
      "openrouter",
      "test-secret",
      1,
      "gemini-3.6-conservative-upper.2026-08-16",
      "request",
    );
    const response = await transport.send({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: new AbortController().signal,
    });
    assert.deepEqual(calls, [
      {
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
      },
    ]);
    assert.deepEqual(response.servedIdentity, {
      providerId: "google-vertex",
      modelId: "google/gemini-3.6-flash",
    });
    assert.equal(response.accounting?.state, "priced");
    assert.equal(response.accounting?.amount, 0.000078);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
