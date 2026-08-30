import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assessStagingLiveQualification,
  buildQualifiedStagingPolicy,
  executeStagingLiveQualification,
  verifyStagingLiveQualificationArtifacts,
} from "../../scripts/lib/slice3-staging-live-qualification-v1.mjs";

const productionPolicy = JSON.parse(
  await readFile(
    new URL(
      "../../config/slice3/research-route-policy.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function directEnvelope() {
  return {
    modelVersion: "gemini-3.6-flash",
    responseId: "direct-v6-test-id",
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
  };
}

function openRouterEnvelope() {
  return {
    id: "openrouter-v6-test-id",
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
  };
}

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "matchbase-staging-qualification-"),
  );
  const paths = {
    credentialPath: join(root, "APIKeys.md"),
    stateRoot: join(root, "state"),
    evidencePath: join(root, "evidence.json"),
    policyPath: join(root, "policy.json"),
    manifestPath: join(root, "manifest.json"),
  };
  await writeFile(
    paths.credentialPath,
    "MATCHBASE_GEMINI_API_KEY=direct-test-secret\nMATCHBASE_OPENROUTER_API_KEY=openrouter-test-secret\n",
    "utf8",
  );
  return { root, paths };
}

function qualifiedFetch(calls) {
  const router = openRouterEnvelope();
  return async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, method: options.method ?? "GET" });
    if (target.startsWith("https://generativelanguage.googleapis.com/")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["x-goog-api-key"], "direct-test-secret");
      return jsonResponse(directEnvelope());
    }
    if (target.endsWith("/endpoints/zdr")) {
      return jsonResponse({
        data: [
          {
            model_id: "google/gemini-3.6-flash",
            tag: "google-vertex/global",
          },
        ],
      });
    }
    if (target.endsWith("/endpoints")) {
      return jsonResponse({
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
    if (target.includes("/api/v1/generation?")) {
      assert.equal(
        options.headers.Authorization,
        "Bearer openrouter-test-secret",
      );
      return jsonResponse({
        data: {
          id: router.id,
          provider_name: "Google Vertex",
          model: router.model,
          finish_reason: "stop",
          tokens_prompt: 209,
          tokens_completion: 496,
          total_cost: 0.00202,
        },
      });
    }
    assert.equal(target, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(
      options.headers.Authorization,
      "Bearer openrouter-test-secret",
    );
    const body = JSON.parse(options.body);
    assert.deepEqual(body.provider, {
      zdr: true,
      data_collection: "deny",
      only: ["google-vertex"],
      order: ["google-vertex"],
      require_parameters: true,
      allow_fallbacks: false,
    });
    return jsonResponse(router, 200, { "x-generation-id": router.id });
  };
}

test("preflight is zero-call, synthetic-only, bounded, and source-bound", async () => {
  const { root, paths } = await fixture();
  try {
    const result = await assessStagingLiveQualification(paths);
    assert.equal(result.disposition, "READY_TO_QUALIFY");
    assert.equal(result.syntheticOnly, true);
    assert.equal(result.maximumExternalHttpCalls, 50);
    assert.equal(result.maximumProviderModelPosts, 2);
    assert.equal(result.maximumCostUsd, 100);
    assert.equal(result.credentialValuesInspected, false);
    assert.equal(result.externalHttpCalls, 0);
    assert.match(result.sourceBinding.authorizationSha256, /^[A-F0-9]{64}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("success executes exactly two model posts and emits verified staging-only artifacts", async () => {
  const { root, paths } = await fixture();
  const calls = [];
  try {
    const result = await executeStagingLiveQualification({
      paths,
      fetchImpl: qualifiedFetch(calls),
      now: () => new Date("2026-08-30T13:30:00.000Z"),
    });
    assert.equal(result.disposition, "PASS");
    assert.equal(result.providerModelPosts, 2);
    assert.equal(result.billableCalls, 2);
    assert.equal(result.externalHttpCalls, 5);
    assert.equal(result.costUsd, 0.016155);
    assert.equal(result.stagingPolicyGenerated, true);
    assert.equal(result.productionPolicyMutated, false);
    assert.equal(result.cloudMutations, 0);
    assert.equal(calls.filter((call) => call.method === "POST").length, 2);
    const policy = JSON.parse(await readFile(paths.policyPath, "utf8"));
    assert.equal(policy.environment, "staging");
    assert.equal(policy.liveActivation, "enabled");
    assert.ok(policy.routes.every((route) => route.liveQualified));
    assert.ok(policy.routes.every((route) => route.enabled));
    assert.equal(
      productionPolicy.liveActivation,
      "blocked",
      "production policy stays blocked",
    );
    const verified = await verifyStagingLiveQualificationArtifacts(paths);
    assert.equal(verified.disposition, "PASS");
    assert.equal(verified.billableCalls, 2);
    assert.equal(verified.syntheticOnly, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a direct-route failure is terminal and cannot generate a staging policy", async () => {
  const { root, paths } = await fixture();
  try {
    const result = await executeStagingLiveQualification({
      paths,
      fetchImpl: async () => jsonResponse({ error: "synthetic failure" }, 503),
    });
    assert.equal(result.disposition, "FAIL");
    assert.equal(result.providerModelPosts, 1);
    assert.equal(result.externalHttpCalls, 1);
    assert.equal(result.stagingPolicyGenerated, false);
    await assert.rejects(readFile(paths.policyPath), /ENOENT/u);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("direct-test-secret"), false);
    assert.equal(serialized.includes("openrouter-test-secret"), false);
    const restarted = await assessStagingLiveQualification(paths);
    assert.equal(restarted.disposition, "BLOCKED_PREREQUISITE");
    assert.ok(restarted.blockers.includes("ONE_USE_SESSION_ALREADY_EXISTS"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("policy construction rejects detached, reversed, or partial evidence", () => {
  const route = productionPolicy.routes[0];
  assert.throws(() =>
    buildQualifiedStagingPolicy({
      productionPolicy,
      routeEvidence: [
        { routePath: "openrouter", routeId: route.routeId },
        { routePath: "gemini_direct", routeId: route.routeId },
      ],
      evaluatedAt: new Date().toISOString(),
    }),
  );
  assert.throws(() =>
    buildQualifiedStagingPolicy({
      productionPolicy,
      routeEvidence: [],
      evaluatedAt: new Date().toISOString(),
    }),
  );
});

test("the default production policy remains byte-identical to its pinned digest", async () => {
  const bytes = await readFile(
    resolve("config/slice3/research-route-policy.v1.json"),
  );
  const { createHash } = await import("node:crypto");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23",
  );
});
