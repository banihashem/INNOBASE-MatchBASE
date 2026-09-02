import assert from "node:assert/strict";
import test from "node:test";
import { createQualifiedGeminiDirectAdapter } from "../src/adapters/gemini-direct.js";
import { createQualifiedOpenRouterAdapter } from "../src/adapters/openrouter.js";
import { validateOpenRouterProviderRequestPolicy } from "../src/adapters/openrouter.js";
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
    publisherDomain: "example.com",
    retrievedAt: "2026-08-15T00:00:00.000Z",
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

test("Gemini adapter generates only from fetched evidence and snapshots exact served identity", async () => {
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
    tools?: unknown[];
    generationConfig: Record<string, unknown>;
  };
  assert.equal(body.model, "gemini-2.5-flash");
  assert.equal(body.contents[0]?.role, "user");
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Set runId exactly to RUN-S3-ADAPTER-001\./u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Canonical request: Identify qualified industrial suppliers for the canonical requirements\./u,
  );
  assert.match(body.contents[0]?.parts[0]?.text ?? "", /failedConstraintIds/u);
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /must remain in candidates/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Set the top-level evidence field exactly to the empty array \[\]\./u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Every claim evidenceIds value must exactly equal a supplied sourceId/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /compatibilityScore as a JSON integer.*mandatoryConstraintsSatisfied as a JSON boolean/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /stale, conflicting, and unknown claims must set decisionBearing false/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Do not include personal names, personal email addresses, personal phone numbers/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /rationaleClaimIds, citations, failedConstraintIds, claim evidenceIds, and eligibleCandidateIds as JSON arrays of strings/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /dimensionScores to a closed object containing exactly these six integer keys.*category_product_fit.*geographic_reach_fit/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Return dimensionScores as a JSON object value, never as a quoted or JSON-encoded string/u,
  );
  assert.match(
    body.contents[0]?.parts[0]?.text ?? "",
    /Never echo or reproduce supplied canonicalUrl, publisherDomain, retrievedAt, contentSha256, excerpt/u,
  );
  assert.doesNotMatch(
    body.contents[0]?.parts[0]?.text ?? "",
    /Include every supplied document exactly once in evidence/u,
  );
  assert.doesNotMatch(
    body.contents[0]?.parts[0]?.text ?? "",
    /copy evidenceId from sourceId/u,
  );
  assert.equal(body.tools, undefined);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.thinkingConfig, {
    thinkingLevel: "minimal",
  });
  for (const field of ["temperature", "topP", "topK"]) {
    assert.equal(field in body.generationConfig, false);
  }
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
      zdr: boolean;
      data_collection: string;
      only: string[];
      order: string[];
      require_parameters: boolean;
      allow_fallbacks: boolean;
    };
    messages: Array<{ role: string; content: string }>;
    plugins?: unknown;
    temperature?: unknown;
    top_p?: unknown;
    top_k?: unknown;
    max_tokens?: unknown;
    max_completion_tokens?: unknown;
    response_format?: unknown;
  };
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.deepEqual(body.provider, {
    zdr: true,
    data_collection: "deny",
    only: ["google"],
    order: ["google"],
    require_parameters: true,
    allow_fallbacks: false,
  });
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
  assert.equal(body.top_k, undefined);
  assert.equal(body.plugins, undefined);
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.max_completion_tokens, undefined);
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: {
      name: "matchbase_evidence_graph_v1",
      strict: false,
      schema: request().outputSchema,
    },
  });
  assert.equal(body.messages[0]?.role, "user");
  assert.match(
    body.messages[0]?.content,
    /Set runId exactly to RUN-S3-ADAPTER-001\./u,
  );
  assert.match(
    body.messages[0]?.content,
    /Canonical request: Identify qualified industrial suppliers for the canonical requirements\./u,
  );
  assert.match(
    body.messages[0]?.content,
    /Set the top-level evidence field exactly to the empty array \[\]\./u,
  );
  assert.match(
    body.messages[0]?.content,
    /Each candidate citation must be a supplied sourceId already referenced by one of that candidate's rationale claims/u,
  );
  assert.match(
    body.messages[0]?.content,
    /Do not quote supplied excerpts in claim text or rationale text/u,
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

test("OpenRouter rejects every provider privacy and allowlist mismatch", () => {
  const context = {
    orderedProviderAllowlist: ["google", "anthropic"],
    retentionTrainingPosture: "verified_zdr",
    requireParameters: true,
    allowFallbacks: false,
  } as const;
  const exact = {
    zdr: true,
    data_collection: "deny",
    only: ["google", "anthropic"],
    order: ["google", "anthropic"],
    require_parameters: true,
    allow_fallbacks: false,
  };
  validateOpenRouterProviderRequestPolicy(exact, context);
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => delete value.zdr,
    (value) => {
      value.zdr = false;
    },
    (value) => {
      value.data_collection = "allow";
    },
    (value) => {
      value.unknown = true;
    },
    (value) => {
      value.only = ["google", "mistral"];
    },
    (value) => {
      value.order = ["anthropic", "google"];
    },
    (value) => {
      value.only = ["google", "anthropic", "mistral"];
      value.order = ["google", "anthropic", "mistral"];
    },
    (value) => {
      value.require_parameters = false;
    },
    (value) => {
      value.allow_fallbacks = true;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(exact) as unknown as Record<
      string,
      unknown
    >;
    mutate(candidate);
    assert.throws(
      () => validateOpenRouterProviderRequestPolicy(candidate, context),
      /policy|privacy|allowlist|unsupported/iu,
    );
  }
  assert.throws(
    () =>
      validateOpenRouterProviderRequestPolicy(exact, {
        ...context,
        retentionTrainingPosture: "verified_no_training",
      }),
    /verified ZDR/iu,
  );
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

test("OpenRouter adapter uses the OpenAI completion-token parameter on the qualified Azure route", async () => {
  const policy = qualifiedPolicy();
  const openrouter = policy.routes[1]!;
  const azurePolicy = {
    ...policy,
    routes: [
      policy.routes[0]!,
      {
        ...openrouter,
        routeId: "RT-OPENROUTER-AZURE-OPENAI-S3-V1",
        providerId: "azure",
        requestedModelId: "openai/gpt-5.4-mini",
        expectedServedModelId: "openai/gpt-5.4-mini",
      },
    ],
  };
  const transport = new RecordingFakeTransport({
    status: 200,
    body: { candidates: [] },
    servedIdentity: {
      providerId: "azure",
      modelId: "openai/gpt-5.4-mini",
    },
    accounting: {
      state: "priced",
      quantity: 1,
      unit: "request",
      amount: 0.01,
      currency: "USD",
      pricingVersion: "openrouter-openai-test.v1",
      measurement: "measured",
    },
  });
  await createQualifiedOpenRouterAdapter({
    policy: azurePolicy,
    routeId: "RT-OPENROUTER-AZURE-OPENAI-S3-V1",
    activatedAt,
    transport,
    onAttempt: () => undefined,
  }).generateStructured(request(), execution, new AbortController().signal);
  const body = JSON.parse(transport.requests[0]?.body ?? "null");
  assert.equal(body.max_completion_tokens, 2048);
  assert.equal(body.max_tokens, undefined);
  assert.deepEqual(body.provider.only, ["azure"]);
  assert.deepEqual(body.provider.order, ["azure"]);
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
