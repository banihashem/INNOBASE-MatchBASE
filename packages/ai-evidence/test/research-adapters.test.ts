import assert from "node:assert/strict";
import test from "node:test";
import { createQualifiedGeminiDirectAdapter } from "../src/adapters/gemini-direct.js";
import { createQualifiedOpenRouterAdapter } from "../src/adapters/openrouter.js";
import {
  RecordingFakeTransport,
  type ProviderAttemptOutcome,
} from "../src/transport.js";
import { qualifiedPolicy } from "./fixtures/research-route-policy.js";

const activatedAt = "2026-08-16T00:00:00.000Z";
const execution = {
  runId: "RUN-S3-ADAPTER-001",
  snapshotId: "SNAP-S3-ADAPTER-001",
  capturedAt: activatedAt,
} as const;
const sanitizedEvidence = [
  {
    sourceId: "SRC-PUBLIC-001",
    canonicalUrl: "https://example.com/source",
    contentSha256: "a".repeat(64),
    excerpt: "Public industrial evidence excerpt.",
  },
] as const;
const request = (
  evidence: ReadonlyArray<
    (typeof sanitizedEvidence)[number]
  > = sanitizedEvidence,
) => ({
  canonicalLanguage: "en" as const,
  canonicalEnglishRequest:
    "Identify qualified industrial suppliers for the canonical requirements.",
  sanitizedEvidence: evidence,
  outputSchema: { type: "object", additionalProperties: false },
});

test("Gemini adapter requires native search and snapshots exact served identity", async () => {
  const transport = new RecordingFakeTransport({
    status: 200,
    body: { candidates: [] },
    servedIdentity: { providerId: "google", modelId: "gemini-2.5-flash" },
    accounting: {
      state: "estimated",
      quantity: 1,
      unit: "request",
      amount: 0.0001,
      currency: "USD",
      pricingVersion: "fixture-pricing.v1",
      measurement: "estimated",
    },
  });
  const outcomes: ProviderAttemptOutcome[] = [];
  const result = await createQualifiedGeminiDirectAdapter({
    policy: qualifiedPolicy(),
    routeId: "RT-GEMINI-DIRECT-S3-V1",
    activatedAt,
    transport,
    onAttempt: (outcome) => {
      outcomes.push(outcome);
    },
  }).generateStructured(request([]), execution, new AbortController().signal);
  const capturedRequest = transport.requests[0];
  assert.ok(capturedRequest);
  assert.equal(
    capturedRequest.url.startsWith(
      "https://generativelanguage.googleapis.com/",
    ),
    true,
  );
  assert.equal("authorization" in capturedRequest.headers, false);
  const body = JSON.parse(capturedRequest.body) as {
    model: string;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    tools: unknown[];
    generationConfig: { responseMimeType: string; temperature: number };
  };
  assert.equal(body.model, "gemini-2.5-flash");
  assert.deepEqual(body.contents, [
    {
      role: "user",
      parts: [
        {
          text: "Identify qualified industrial suppliers for the canonical requirements.",
        },
      ],
    },
  ]);
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.temperature, 0);
  assert.equal(result.routeSnapshot.path, "gemini_direct");
  assert.equal(result.routeSnapshot.servedProviderId, "google");
  assert.equal(result.routeSnapshot.servedModelId, "gemini-2.5-flash");
  assert.deepEqual(
    outcomes.map((outcome) => outcome.outcome),
    ["ok"],
  );
  assert.equal(outcomes[0]?.requestedModelId, "gemini-2.5-flash");
  assert.equal(outcomes[0]?.servedProviderId, "google");
  assert.equal(outcomes[0]?.servedModelId, "gemini-2.5-flash");
});

test("OpenRouter adapter serializes one explicit provider and disables broker fallback", async () => {
  const transport = new RecordingFakeTransport({
    status: 200,
    body: { choices: [] },
    servedIdentity: {
      providerId: "google",
      modelId: "google/gemini-2.5-flash",
    },
    accounting: {
      state: "estimated",
      quantity: 1,
      unit: "request",
      amount: 0.0001,
      currency: "USD",
      pricingVersion: "fixture-pricing.v1",
      measurement: "estimated",
    },
  });
  const outcomes: ProviderAttemptOutcome[] = [];
  const result = await createQualifiedOpenRouterAdapter({
    policy: qualifiedPolicy(),
    routeId: "RT-OPENROUTER-GOOGLE-S3-V1",
    activatedAt,
    transport,
    onAttempt: (outcome) => {
      outcomes.push(outcome);
    },
  }).generateStructured(request(), execution, new AbortController().signal);
  const capturedRequest = transport.requests[0];
  assert.ok(capturedRequest);
  assert.equal(
    capturedRequest.url,
    "https://openrouter.ai/api/v1/chat/completions",
  );
  assert.equal("authorization" in capturedRequest.headers, false);
  const body = JSON.parse(capturedRequest.body) as {
    model: string;
    provider: {
      order: string[];
      require_parameters: boolean;
      allow_fallbacks: boolean;
    };
    messages: Array<{ role: string; content: string }>;
    plugins?: unknown;
  };
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.deepEqual(body.provider, {
    order: ["google"],
    require_parameters: true,
    allow_fallbacks: false,
  });
  assert.equal(body.plugins, undefined);
  assert.equal(body.messages[0]?.role, "user");
  assert.equal(
    body.messages[0]?.content,
    "Identify qualified industrial suppliers for the canonical requirements.",
  );
  assert.deepEqual(JSON.parse(body.messages[1]?.content ?? "null"), {
    kind: "untrusted_sanitized_evidence",
    documents: sanitizedEvidence,
  });
  assert.equal(result.routeSnapshot.path, "openrouter");
  assert.equal(result.routeSnapshot.servedProviderId, "google");
  assert.equal(Object.isFrozen(result.routeSnapshot), true);
  assert.equal(outcomes[0]?.requestedModelId, "google/gemini-2.5-flash");
  assert.equal(outcomes[0]?.servedProviderId, "google");
  assert.equal(outcomes[0]?.servedModelId, "google/gemini-2.5-flash");
});

test("both adapters fail attempts closed when served identity is missing or altered", async () => {
  const cases = [
    {
      factory: () =>
        createQualifiedGeminiDirectAdapter({
          policy: qualifiedPolicy(),
          routeId: "RT-GEMINI-DIRECT-S3-V1",
          activatedAt,
          transport: new RecordingFakeTransport({
            status: 200,
            body: {},
            accounting: {
              state: "estimated",
              quantity: 1,
              unit: "request",
              amount: 0.0001,
              currency: "USD",
              pricingVersion: "fixture-pricing.v1",
              measurement: "estimated",
            },
          }),
          onAttempt: (outcome: ProviderAttemptOutcome) => {
            outcomes.push(outcome);
          },
        }),
    },
    {
      factory: () =>
        createQualifiedOpenRouterAdapter({
          policy: qualifiedPolicy(),
          routeId: "RT-OPENROUTER-GOOGLE-S3-V1",
          activatedAt,
          transport: new RecordingFakeTransport({
            status: 200,
            body: {},
            servedIdentity: {
              providerId: "other-provider",
              modelId: "google/gemini-2.5-flash",
            },
            accounting: {
              state: "estimated",
              quantity: 1,
              unit: "request",
              amount: 0.0001,
              currency: "USD",
              pricingVersion: "fixture-pricing.v1",
              measurement: "estimated",
            },
          }),
          onAttempt: (outcome: ProviderAttemptOutcome) => {
            outcomes.push(outcome);
          },
        }),
    },
  ];
  const outcomes: ProviderAttemptOutcome[] = [];
  for (const item of cases) {
    await assert.rejects(
      item
        .factory()
        .generateStructured(request(), execution, new AbortController().signal),
      /identity outside/iu,
    );
  }
  assert.deepEqual(
    outcomes.map((outcome) => outcome.outcome),
    ["provider_error", "provider_error"],
  );
  assert.equal(outcomes[1]?.servedProviderId, "other-provider");
  assert.equal(outcomes[1]?.servedModelId, "google/gemini-2.5-flash");
  assert.equal(outcomes[1]?.requestedModelId, "google/gemini-2.5-flash");
});

test("qualified adapters reject missing or noncanonical English before transport", async () => {
  const transport = new RecordingFakeTransport(new Error("must not run"));
  const gemini = createQualifiedGeminiDirectAdapter({
    policy: qualifiedPolicy(),
    routeId: "RT-GEMINI-DIRECT-S3-V1",
    activatedAt,
    transport,
    onAttempt: () => undefined,
  });
  const invalid = [
    { ...request([]), canonicalEnglishRequest: "" },
    { ...request([]), canonicalEnglishRequest: "  Not canonical  " },
    { ...request([]), canonicalEnglishRequest: "درخواست صنعتی" },
    { ...request([]), canonicalLanguage: "fa" },
  ];
  for (const candidate of invalid) {
    await assert.rejects(
      gemini.generateStructured(
        candidate as never,
        execution,
        new AbortController().signal,
      ),
      /canonical|English/iu,
    );
  }
  const openrouter = createQualifiedOpenRouterAdapter({
    policy: qualifiedPolicy(),
    routeId: "RT-OPENROUTER-GOOGLE-S3-V1",
    activatedAt,
    transport,
    onAttempt: () => undefined,
  });
  await assert.rejects(
    openrouter.generateStructured(
      request([]),
      execution,
      new AbortController().signal,
    ),
    /externally fetched sanitized evidence/iu,
  );
  assert.equal(transport.requests.length, 0);
});

test("qualified factories reject cross-wired route paths", () => {
  const transport = new RecordingFakeTransport({ status: 500, body: {} });
  assert.throws(
    () =>
      createQualifiedGeminiDirectAdapter({
        policy: qualifiedPolicy(),
        routeId: "RT-OPENROUTER-GOOGLE-S3-V1",
        activatedAt,
        transport,
        onAttempt: () => undefined,
      }),
    /direct Gemini route/iu,
  );
  assert.throws(
    () =>
      createQualifiedOpenRouterAdapter({
        policy: qualifiedPolicy(),
        routeId: "RT-GEMINI-DIRECT-S3-V1",
        activatedAt,
        transport,
        onAttempt: () => undefined,
      }),
    /OpenRouter route/iu,
  );
});
