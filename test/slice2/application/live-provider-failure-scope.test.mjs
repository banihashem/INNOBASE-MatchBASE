import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { callOpenRouterCompletion } from "../../../packages/application/dist/openrouter-model-policy.js";

const originalFetch = globalThis.fetch;
const names = [
  "MATCHBASE_OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "MATCHBASE_PROVIDER_GOOGLE",
];
const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
let metadata;
let requests;
beforeEach(() => {
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  delete process.env.OPENROUTER_API_KEY;
  requests = 0;
  metadata = undefined;
  globalThis.fetch = async (target, options) => {
    if (String(target).endsWith("/models/user"))
      return Response.json({
        data: [
          {
            id: "google/gemini-3.8-flash",
            supported_parameters: ["max_tokens"],
          },
        ],
      });
    if (String(target).endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: "google-ai-studio",
              provider_name: "Google AI Studio",
              supported_parameters: ["max_tokens"],
            },
          ],
        },
      });
    assert.equal(
      String(target),
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const body = JSON.parse(options.body);
    assert.deepEqual(body.provider.only, ["google-ai-studio"]);
    assert.equal(body.provider.allow_fallbacks, false);
    requests++;
    return Response.json(
      {
        error: {
          code: 400,
          message: "API key not valid. private-error-sentinel",
          metadata,
        },
      },
      { status: 400 },
    );
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});
const call = () =>
  callOpenRouterCompletion({
    model: "google/gemini-3.8-flash",
    messages: [{ role: "user", content: "Check provider access." }],
  });

test("MB-UX-QUALITY-001 L04 localizes only a catalog-matched upstream credential rejection without retaining raw errors", async () => {
  metadata = {
    provider_name: "Google AI Studio",
    is_byok: true,
    raw: "private-error-sentinel",
  };
  await assert.rejects(call(), (error) => {
    assert.equal(error.retryable, false);
    assert.deepEqual(error.provider_failure, {
      http_status: 400,
      category: "provider credential is not accepted",
      provider_name: "Google AI Studio",
      is_byok: true,
    });
    assert.doesNotMatch(JSON.stringify(error), /private-error-sentinel/);
    assert.doesNotMatch(error.message, /private-error-sentinel/);
    return true;
  });
  assert.equal(requests, 1);
});

test("MB-UX-QUALITY-001 L04 missing or mismatched upstream identity cannot authorize route substitution", async () => {
  for (const value of [
    undefined,
    { is_byok: true },
    { provider_name: "OpenAI", is_byok: true },
    { provider_name: "Google AI Studio", is_byok: "true" },
  ]) {
    metadata = value;
    await assert.rejects(call(), (error) => {
      assert.equal(error.provider_failure, undefined);
      assert.equal(error.retryable, false);
      return true;
    });
  }
  assert.equal(requests, 4);
});

test("MB-UX-QUALITY-001 L04 a shared-capacity upstream error never becomes a BYOK failure", async () => {
  metadata = { provider_name: "Google AI Studio", is_byok: false };
  await assert.rejects(call(), (error) => {
    assert.equal(error.provider_failure.is_byok, false);
    return true;
  });
});
