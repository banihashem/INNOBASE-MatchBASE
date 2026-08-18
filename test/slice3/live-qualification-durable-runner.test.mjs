import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildGeminiQualificationRequest,
  buildOpenRouterQualificationRequest,
  executeGeminiQualificationCall,
  executeOpenRouterQualificationCall,
  readCanonicalCredentials,
  SLICE3_LIVE_QUALIFICATION_CONSTANTS,
  validateSanitizedQualificationEvidence,
} from "../../scripts/lib/slice3-live-qualification-runner.mjs";

const policy = JSON.parse(
  await readFile(
    new URL(
      "../../config/slice3/research-route-policy.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const direct = policy.routes.find((route) => route.path === "gemini_direct");
const openrouter = policy.routes.find((route) => route.path === "openrouter");

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function directEnvelope(overrides = {}) {
  return {
    modelVersion: "gemini-3.6-flash",
    responseId: "direct-id",
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: JSON.stringify({
                fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
                answer: "Reserved for documentation.",
                sourceSummary: "IANA public source.",
              }),
            },
          ],
        },
        groundingMetadata: {
          webSearchQueries: ["IANA example domains"],
          groundingChunks: [
            { web: { uri: "https://www.iana.org/help/example-domains" } },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 10 },
    ...overrides,
  };
}

function openRouterEnvelope(overrides = {}) {
  return {
    id: "openrouter-id",
    model: "google/gemini-3.6-flash",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
            answer: "Reserved for documentation.",
            sourceSummary: "IANA public source.",
          }),
        },
      },
    ],
    usage: { prompt_tokens: 209, completion_tokens: 496, cost: 0.00202 },
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
      attempts: [
        {
          provider: "Google Vertex",
          model: "google/gemini-3.6-flash",
          status: 200,
        },
      ],
      pipeline: [],
    },
    ...overrides,
  };
}

function openRouterFetch(envelope) {
  return async (url, options = {}) => {
    if (String(url).includes("/api/v1/generation?")) {
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      return jsonResponse({
        data: {
          id: envelope.id,
          provider_name: "Google Vertex",
          model: envelope.model,
          finish_reason: envelope.choices[0].finish_reason,
          tokens_prompt: envelope.usage.prompt_tokens,
          tokens_completion: envelope.usage.completion_tokens,
          total_cost: envelope.usage.cost,
        },
      });
    }
    if (options.method === "GET") {
      return String(url).endsWith("/endpoints/zdr")
        ? jsonResponse({
            data: [
              {
                model_id: "google/gemini-3.6-flash",
                tag: "google-vertex/global",
              },
            ],
          })
        : jsonResponse({
            data: {
              endpoints: [
                {
                  tag: "google-vertex/global",
                  provider_name: "Google Vertex",
                  supported_parameters: [
                    "max_tokens",
                    "response_format",
                    "structured_outputs",
                  ],
                  pricing: {
                    prompt: "0.0000015",
                    completion: "0.0000075",
                    web_search: "0.014",
                  },
                },
              ],
            },
          });
    }
    assert.equal(options.headers["X-OpenRouter-Metadata"], "enabled");
    return jsonResponse(envelope, 200, { "x-generation-id": envelope.id });
  };
}

test("credential parser accepts only the two canonical handles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "matchbase-v2-credentials-"));
  const path = join(directory, "APIKeys.md");
  try {
    await writeFile(
      path,
      "MATCHBASE_GEMINI_API_KEY=direct-secret\nMATCHBASE_OPENROUTER_API_KEY=openrouter-secret\n",
      "utf8",
    );
    assert.deepEqual(Object.keys(await readCanonicalCredentials(path)).sort(), [
      "MATCHBASE_GEMINI_API_KEY",
      "MATCHBASE_OPENROUTER_API_KEY",
    ]);
    await writeFile(
      path,
      "GEMINI_API_KEY=legacy\nMATCHBASE_OPENROUTER_API_KEY=value\n",
      "utf8",
    );
    await assert.rejects(readCanonicalCredentials(path), /invalid/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requests freeze one send, 2048 output tokens, Search, and exact ZDR routing", () => {
  const gemini = buildGeminiQualificationRequest(direct);
  const geminiBody = JSON.parse(gemini.body);
  assert.equal(geminiBody.generationConfig.maxOutputTokens, 2048);
  assert.deepEqual(geminiBody.tools, [{ google_search: {} }]);
  const router = buildOpenRouterQualificationRequest(openrouter);
  const routerBody = JSON.parse(router.body);
  assert.equal(routerBody.max_tokens, 2048);
  assert.deepEqual(routerBody.provider, {
    only: ["google-vertex"],
    order: ["google-vertex"],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: "deny",
    zdr: true,
  });
  assert.equal("plugins" in routerBody, false);
});

test("direct Gemini accepts only exact canonical identity and one Search query", async () => {
  const evidence = await executeGeminiQualificationCall({
    route: direct,
    secret: "test-secret",
    fetchImpl: async () => jsonResponse(directEnvelope()),
  });
  assert.equal(evidence.servedModelId, direct.expectedServedModelId);
  assert.equal(
    evidence.identityBasis,
    "provider_reported_alias_direct_google_endpoint",
  );
  assert.equal(evidence.searchQueryCount, 1);
  validateSanitizedQualificationEvidence(evidence);
  for (const envelope of [
    directEnvelope({ modelVersion: "gemini-3.6-flash-20260721" }),
    directEnvelope({
      candidates: [
        {
          ...directEnvelope().candidates[0],
          groundingMetadata: { webSearchQueries: [] },
        },
      ],
    }),
  ]) {
    await assert.rejects(
      executeGeminiQualificationCall({
        route: direct,
        secret: "test-secret",
        fetchImpl: async () => jsonResponse(envelope),
      }),
    );
  }
});

test("OpenRouter binds Google Vertex catalog, canonical model, stop, and reported cost", async () => {
  const evidence = await executeOpenRouterQualificationCall({
    route: openrouter,
    secret: "test-secret",
    fetchImpl: openRouterFetch(openRouterEnvelope()),
  });
  assert.equal(evidence.servedProviderId, "google-vertex");
  assert.equal(evidence.servedModelId, openrouter.expectedServedModelId);
  assert.equal(evidence.costState, "provider_reported");
  assert.equal(evidence.costAmountUsd, 0.00202);
  assert.equal(
    evidence.identityBasis,
    "provider_reported_alias_generation_metadata",
  );
});

test("truncated OpenRouter output fails closed while preserving sanitized cost facts", async () => {
  await assert.rejects(
    executeOpenRouterQualificationCall({
      route: openrouter,
      secret: "test-secret",
      fetchImpl: openRouterFetch(
        openRouterEnvelope({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"fixtureId":"truncated"' },
            },
          ],
        }),
      ),
    }),
    (error) => {
      assert.equal(error.failure.phase, "FINISH_REASON");
      assert.equal(error.failure.costState, "provider_reported");
      assert.equal(error.failure.costAmountUsd, 0.00202);
      assert.equal(error.failure.finishReason, "length");
      return true;
    },
  );
});

test("missing OpenRouter cost and adjacent served identity fail closed", async () => {
  for (const envelope of [
    openRouterEnvelope({
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    openRouterEnvelope({ model: "google/gemini-3.6-flash-20260722" }),
  ]) {
    await assert.rejects(
      executeOpenRouterQualificationCall({
        route: openrouter,
        secret: "test-secret",
        fetchImpl: openRouterFetch(envelope),
      }),
    );
  }
});

test("closed evidence rejects raw payload and unknown topology fields", async () => {
  const evidence = await executeOpenRouterQualificationCall({
    route: openrouter,
    secret: "test-secret",
    fetchImpl: openRouterFetch(openRouterEnvelope()),
  });
  assert.throws(
    () => validateSanitizedQualificationEvidence({ ...evidence, choices: [] }),
    /unsupported fields/iu,
  );
  assert.equal(JSON.stringify(evidence).includes("test-secret"), false);
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.ownerDecisionDigest,
    "B112BF95B40F06787568F71207D6A0A5A1C9F022F9C6F5BB1353D212127FA362",
  );
});

test("OpenRouter generation identity and metadata reconciliation fail closed", async () => {
  const base = openRouterEnvelope();
  const cases = [
    async (url, options = {}) => {
      if (options.method === "POST") {
        return jsonResponse(
          openRouterEnvelope({
            openrouter_metadata: {
              ...base.openrouter_metadata,
              unknown_topology: true,
            },
          }),
          200,
          { "x-generation-id": base.id },
        );
      }
      return openRouterFetch(base)(url, options);
    },
    async (url, options = {}) => {
      if (options.method === "POST") {
        return jsonResponse(
          openRouterEnvelope({
            openrouter_metadata: {
              ...base.openrouter_metadata,
              attempt: 2,
              attempts: [
                ...base.openrouter_metadata.attempts,
                {
                  provider: "Google AI Studio",
                  model: base.model,
                  status: 200,
                },
              ],
            },
          }),
          200,
          { "x-generation-id": base.id },
        );
      }
      return openRouterFetch(base)(url, options);
    },
    async (url, options = {}) => {
      const response = await openRouterFetch(base)(url, options);
      return options.method === "POST"
        ? jsonResponse(base, 200, { "x-generation-id": "different-id" })
        : response;
    },
    async (url, options = {}) => {
      if (String(url).includes("/api/v1/generation?")) {
        return jsonResponse({
          data: {
            id: base.id,
            provider_name: "Google AI Studio",
            model: base.model,
            finish_reason: "stop",
            tokens_prompt: 209,
            tokens_completion: 496,
            total_cost: 0.00202,
          },
        });
      }
      return openRouterFetch(base)(url, options);
    },
    async (url, options = {}) => {
      if (String(url).includes("/api/v1/generation?")) {
        return jsonResponse({
          data: {
            id: base.id,
            provider_name: "Google Vertex",
            model: base.model,
            finish_reason: "stop",
            tokens_prompt: 209,
            tokens_completion: 495,
            total_cost: 0.00202,
          },
        });
      }
      return openRouterFetch(base)(url, options);
    },
    async (url, options = {}) => {
      if (options.method === "POST") {
        const withoutId = { ...base };
        delete withoutId.id;
        return jsonResponse(withoutId);
      }
      return openRouterFetch(base)(url, options);
    },
    async (url, options = {}) => {
      if (String(url).includes("/api/v1/generation?")) {
        return jsonResponse({
          data: {
            id: base.id,
            provider_name: "Google Vertex",
            model: "google/gemini-3.6-flash-20260721",
            finish_reason: "length",
            tokens_prompt: 209,
            tokens_completion: 496,
            total_cost: 0.002021,
          },
        });
      }
      return openRouterFetch(base)(url, options);
    },
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(
      executeOpenRouterQualificationCall({
        route: openrouter,
        secret: "test-secret",
        fetchImpl,
      }),
    );
  }
});

test("OpenRouter performs one metadata GET and persists only digests", async () => {
  const calls = [];
  const base = openRouterEnvelope();
  const delegated = openRouterFetch(base);
  const evidence = await executeOpenRouterQualificationCall({
    route: openrouter,
    secret: "test-secret",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method });
      return delegated(url, options);
    },
  });
  assert.equal(
    calls.filter((entry) => entry.url.includes("/api/v1/generation?")).length,
    1,
  );
  assert.equal(
    calls.some((entry) => entry.url.includes("/generation/content")),
    false,
  );
  assert.equal(JSON.stringify(evidence).includes(base.id), false);
  assert.match(evidence.providerRequestIdDigest, /^[A-F0-9]{64}$/u);
  assert.match(evidence.generationMetadataDigest, /^[A-F0-9]{64}$/u);
  assert.deepEqual(evidence.metadataReadCostEvent, {
    capability: "OPENROUTER_GENERATION_METADATA_READ",
    calls: 1,
    amountUsd: 0,
    currency: "USD",
    costState: "explicit_zero",
  });
  assert.throws(
    () =>
      validateSanitizedQualificationEvidence({
        ...evidence,
        metadataReadCostEvent: {
          ...evidence.metadataReadCostEvent,
          amountUsd: 0.000001,
        },
      }),
    /metadata read cost event/iu,
  );
});

test("the V3 route pair performs exactly two POSTs and one metadata GET", async () => {
  let posts = 0;
  let metadataGets = 0;
  await executeGeminiQualificationCall({
    route: direct,
    secret: "test-secret",
    fetchImpl: async (_url, options = {}) => {
      if (options.method === "POST") posts += 1;
      return jsonResponse(directEnvelope());
    },
  });
  const delegated = openRouterFetch(openRouterEnvelope());
  await executeOpenRouterQualificationCall({
    route: openrouter,
    secret: "test-secret",
    fetchImpl: async (url, options = {}) => {
      if (options.method === "POST") posts += 1;
      if (String(url).includes("/api/v1/generation?")) metadataGets += 1;
      return delegated(url, options);
    },
  });
  assert.equal(posts, 2);
  assert.equal(metadataGets, 1);
});
