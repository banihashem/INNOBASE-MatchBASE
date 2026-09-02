import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assessSuccessor,
  executeSuccessor,
} from "../../scripts/qualify-slice3-staging-successor-v2.mjs";
import { materializeQualificationPredecessor } from "./fixtures/staging-qualification-ledgers.mjs";

const routerEnvelope = {
  id: "openrouter-successor-test-id",
  model: "google/gemini-3.6-flash",
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          answer: "Reserved for documentation.",
          sourceSummary: "IANA public source.",
        }),
      },
    },
  ],
  usage: { prompt_tokens: 200, completion_tokens: 20, cost: 0.00045 },
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

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function directEnvelope({ grounded = true } = {}) {
  return {
    modelVersion: "gemini-3.6-flash",
    responseId: "direct-successor-test-id",
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: JSON.stringify({
                answer: "Reserved for documentation.",
                sourceSummary: "IANA public source.",
              }),
            },
          ],
        },
        groundingMetadata: grounded
          ? {
              webSearchQueries: ["IANA example domains"],
              groundingChunks: [
                {
                  web: {
                    uri: "https://www.iana.org/help/example-domains",
                  },
                },
              ],
              groundingSupports: [{ groundingChunkIndices: [0] }],
            }
          : { webSearchQueries: [] },
      },
    ],
    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "matchbase-successor-v2-"));
  const paths = {
    credentialPath: join(root, "APIKeys.md"),
    predecessorStateRoot: join(root, "predecessor"),
    stateRoot: join(root, "state"),
    evidencePath: join(root, "evidence.json"),
    policyPath: join(root, "policy.json"),
    manifestPath: join(root, "manifest.json"),
  };
  await materializeQualificationPredecessor(
    paths.predecessorStateRoot,
    "v6-40CB8BEE95ABACB012107300",
  );
  await writeFile(
    paths.credentialPath,
    "MATCHBASE_GEMINI_API_KEY=direct-test-secret\nMATCHBASE_OPENROUTER_API_KEY=openrouter-test-secret\n",
    "utf8",
  );
  return { root, paths };
}

function qualifiedFetch(calls, { grounded = true } = {}) {
  return async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, method: options.method ?? "GET" });
    if (target.startsWith("https://generativelanguage.googleapis.com/")) {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.match(prompt, /Use Google Search before answering/u);
      return json(directEnvelope({ grounded }));
    }
    if (target.endsWith("/endpoints/zdr")) {
      return json({
        data: [
          {
            model_id: "google/gemini-3.6-flash",
            tag: "google-vertex/global",
          },
        ],
      });
    }
    if (target.endsWith("/endpoints")) {
      return json({
        data: {
          endpoints: [
            {
              tag: "google-vertex/global",
              provider_name: "Google Vertex",
              supported_parameters: [
                "max_tokens",
                "response_format",
                "structured_outputs",
                "seed",
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
      return json({
        data: {
          id: routerEnvelope.id,
          provider_name: "Google Vertex",
          model: routerEnvelope.model,
          finish_reason: "stop",
          tokens_prompt: 200,
          tokens_completion: 20,
          total_cost: 0.00045,
        },
      });
    }
    return json(routerEnvelope, 200, {
      "x-generation-id": routerEnvelope.id,
    });
  };
}

test("successor preflight binds the terminal V1 ledger and remaining owner ceiling", async () => {
  const { root, paths } = await fixture();
  try {
    const result = await assessSuccessor(paths);
    assert.equal(result.disposition, "READY_TO_QUALIFY");
    assert.equal(
      result.sourceBinding.predecessorLedgerSha256,
      "DA4F6075133A448C021B49E4FF0CE520FF62FBA0A61D3B64744F4B2CB4504588",
    );
    assert.equal(result.cumulativeMaximumProviderCalls, 3);
    assert.ok(result.cumulativeWorstCaseCostUsd < 100);
    assert.equal(result.credentialValuesInspected, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successor uses exactly one call per route and creates staging-only policy after both pass", async () => {
  const { root, paths } = await fixture();
  const calls = [];
  try {
    const result = await executeSuccessor({
      paths,
      fetchImpl: qualifiedFetch(calls),
      now: () => new Date("2026-08-30T14:00:00.000Z"),
    });
    assert.equal(result.disposition, "PASS");
    assert.equal(result.providerModelPosts, 2);
    assert.equal(result.externalHttpCalls, 4);
    assert.equal(result.cumulativeProviderModelPosts, 3);
    assert.ok(result.cumulativeCostUsd < 100);
    assert.equal(calls.filter((call) => call.method === "POST").length, 2);
    const policy = JSON.parse(await readFile(paths.policyPath, "utf8"));
    assert.equal(policy.environment, "staging");
    assert.equal(policy.liveActivation, "enabled");
    assert.ok(policy.routes.every((route) => route.enabled));
    assert.ok(policy.routes.every((route) => route.liveQualified));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successor still exercises the explicit OpenRouter route when direct grounding fails", async () => {
  const { root, paths } = await fixture();
  const calls = [];
  try {
    const result = await executeSuccessor({
      paths,
      fetchImpl: qualifiedFetch(calls, { grounded: false }),
    });
    assert.equal(result.disposition, "FAIL");
    assert.equal(result.providerModelPosts, 2);
    assert.equal(result.externalHttpCalls, 4);
    assert.deepEqual(result.failures, [
      {
        routePath: "gemini_direct",
        reasonCode: "QUALIFICATION_SEARCH_GROUNDING_FAILED",
        phase: "SEARCH_GROUNDING",
      },
    ]);
    await assert.rejects(readFile(paths.policyPath), /ENOENT/u);
    assert.equal(JSON.stringify(result).includes("test-secret"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
