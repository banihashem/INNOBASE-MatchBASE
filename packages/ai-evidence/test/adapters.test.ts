import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderRouteV1 } from "@matchbase/contracts";
import { createGeminiDirectAdapter } from "../src/adapters/gemini-direct.js";
import { createOpenRouterAdapter } from "../src/adapters/openrouter.js";
import {
  RecordingFakeTransport,
  type ProviderAttemptOutcome,
} from "../src/transport.js";

const closeLedger = () => undefined;

function route(providerId: ProviderRouteV1["providerId"]): ProviderRouteV1 {
  return {
    routeId: `RT-${providerId}`,
    providerId,
    modelId: `${providerId}-test-model-v1`,
    enabled: true,
    environment: "test",
    realData: false,
    billingPath: "not_applicable",
    retentionPosture: providerId === "openrouter" ? "zdr" : "unknown",
    dataHandlingEvidenceRefs:
      providerId === "openrouter"
        ? ["https://example.invalid/openrouter-zdr"]
        : [],
    timeoutMs: 1000,
    retry: { maxAttempts: 1, backoffMs: 0 },
    requireParameters: true,
    allowFallbacks: false,
    capabilities: ["CAP-STRUCTURED-GENERATION"],
  };
}

test("provider adapters require validated factory construction", () => {
  const invalid = route("openrouter");
  invalid.modelId = "openrouter/auto";
  assert.throws(
    () =>
      createOpenRouterAdapter({
        route: invalid,
        transport: new RecordingFakeTransport({ status: 200, body: {} }),
        onAttempt: closeLedger,
      }),
    /auto/iu,
  );
  assert.throws(
    () =>
      createGeminiDirectAdapter({
        route: route("openrouter"),
        transport: new RecordingFakeTransport({ status: 200, body: {} }),
        onAttempt: closeLedger,
      }),
    /gemini/iu,
  );
});

test("provider adapters refuse transport construction without an attempt ledger", () => {
  const unsafeCreate = createGeminiDirectAdapter as unknown as (input: {
    route: ProviderRouteV1;
    transport: RecordingFakeTransport;
  }) => unknown;
  assert.throws(
    () =>
      unsafeCreate({
        route: route("gemini_direct"),
        transport: new RecordingFakeTransport({ status: 200, body: {} }),
      }),
    /mandatory attempt ledger/iu,
  );
});

test("OpenRouter serializes closed provider routing through injected transport", async () => {
  const configured = route("openrouter");
  const transport = new RecordingFakeTransport({
    status: 200,
    body: { model: configured.modelId, output: { ok: true } },
  });
  await createOpenRouterAdapter({
    route: configured,
    transport,
    onAttempt: closeLedger,
  }).generateStructured({ name: "schema" }, new AbortController().signal);
  assert.equal(transport.requests.length, 1);
  const request = JSON.parse(transport.requests[0]?.body ?? "null") as {
    model: string;
    provider: Record<string, unknown>;
  };
  assert.equal(request.model, configured.modelId);
  assert.deepEqual(request.provider, {
    zdr: true,
    data_collection: "deny",
    only: ["openrouter"],
    order: ["openrouter"],
    require_parameters: true,
    allow_fallbacks: false,
  });
});

test("OpenRouter fails a served-model mismatch", async () => {
  const configured = route("openrouter");
  const transport = new RecordingFakeTransport({
    status: 200,
    body: { model: "unexpected-model" },
  });
  await assert.rejects(
    createOpenRouterAdapter({
      route: configured,
      transport,
      onAttempt: closeLedger,
    }).generateStructured({}, new AbortController().signal),
    /outside the configured route/iu,
  );
});

test("enforces configured retry count and backoff while recording each outcome", async () => {
  const configured = route("gemini_direct");
  configured.retry = { maxAttempts: 3, backoffMs: 25 };
  const outcomes: ProviderAttemptOutcome[] = [];
  const backoffs: number[] = [];
  const transport = new RecordingFakeTransport([
    { status: 503, body: {} },
    new Error("synthetic provider failure"),
    { status: 200, body: { ok: true } },
  ]);
  const result = await createGeminiDirectAdapter({
    route: configured,
    transport,
    onAttempt: (outcome) => {
      outcomes.push(outcome);
    },
    backoff: async (milliseconds) => {
      backoffs.push(milliseconds);
    },
  }).generateStructured({}, new AbortController().signal);
  assert.deepEqual(result, { ok: true });
  assert.equal(transport.requests.length, 3);
  assert.deepEqual(backoffs, [25, 25]);
  assert.deepEqual(
    outcomes.map(({ attemptNumber, outcome, backoffMs }) => ({
      attemptNumber,
      outcome,
      backoffMs,
    })),
    [
      { attemptNumber: 1, outcome: "provider_error", backoffMs: 0 },
      { attemptNumber: 2, outcome: "provider_error", backoffMs: 25 },
      { attemptNumber: 3, outcome: "ok", backoffMs: 25 },
    ],
  );
});

test("does not retry when the mandatory attempt ledger cannot close", async () => {
  const configured = route("gemini_direct");
  configured.retry = { maxAttempts: 3, backoffMs: 25 };
  const backoffs: number[] = [];
  const transport = new RecordingFakeTransport([
    { status: 503, body: {} },
    { status: 200, body: { ok: true } },
  ]);
  await assert.rejects(
    createGeminiDirectAdapter({
      route: configured,
      transport,
      onAttempt: async () => {
        throw new Error("ledger unavailable");
      },
      backoff: async (milliseconds) => {
        backoffs.push(milliseconds);
      },
    }).generateStructured({}, new AbortController().signal),
    /ledger unavailable/iu,
  );
  assert.equal(transport.requests.length, 1);
  assert.deepEqual(backoffs, []);
});
