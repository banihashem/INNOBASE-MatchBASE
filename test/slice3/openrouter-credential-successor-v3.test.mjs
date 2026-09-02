import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assessCredentialGate,
  executeCredentialGate,
} from "../../scripts/qualify-slice3-openrouter-credential-successor-v3.mjs";
import { materializeQualificationPredecessor } from "./fixtures/staging-qualification-ledgers.mjs";

const ENDPOINT = "https://openrouter.ai/api/v1/key";

function keyData(overrides = {}) {
  return {
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_monthly: 0,
    byok_usage_weekly: 0,
    creator_user_id: null,
    expires_at: null,
    include_byok_in_limit: false,
    is_free_tier: false,
    is_management_key: false,
    is_provisioning_key: false,
    label: "must-not-persist",
    limit: null,
    limit_remaining: 1,
    limit_reset: null,
    rate_limit: { requests: -1, interval: "legacy", note: "hidden" },
    usage: 0,
    usage_daily: 0,
    usage_monthly: 0,
    usage_weekly: 0,
    ...overrides,
  };
}

function response(data) {
  const value = new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(value, "url", { value: ENDPOINT });
  return value;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "matchbase-credential-v3-"));
  const paths = {
    credentialPath: join(root, "APIKeys.md"),
    predecessorStateRoot: join(root, "predecessor"),
    stateRoot: join(root, "state"),
  };
  await materializeQualificationPredecessor(
    paths.predecessorStateRoot,
    "v6-4FA7336D74F38010CBEE9D66",
  );
  await writeFile(
    paths.credentialPath,
    "MATCHBASE_GEMINI_API_KEY=direct-test-secret\nMATCHBASE_OPENROUTER_API_KEY=openrouter-test-secret\n",
    "utf8",
  );
  return { root, paths };
}

test("credential successor is one-GET, zero-model, zero-cost, and predecessor-bound", async () => {
  const { root, paths } = await fixture();
  try {
    const result = await assessCredentialGate(paths);
    assert.equal(result.disposition, "READY_FOR_ONE_CREDENTIAL_GET");
    assert.equal(result.maximumCredentialGets, 1);
    assert.equal(result.maximumProviderModelPosts, 0);
    assert.equal(result.maximumCostUsd, 0);
    assert.equal(result.credentialValuesInspected, false);
    assert.equal(
      result.sourceBinding.predecessorLedgerSha256,
      "667F420151D3737063973C8E8C4A61E46981463A43553660CD92B6537EF8027F",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paid usable key passes without persisting key or account fields", async () => {
  const { root, paths } = await fixture();
  try {
    let gets = 0;
    const result = await executeCredentialGate({
      paths,
      fetchImpl: async (url, options) => {
        gets += 1;
        assert.equal(url, ENDPOINT);
        assert.equal(options.method, "GET");
        assert.equal(
          options.headers.Authorization,
          "Bearer openrouter-test-secret",
        );
        return response(keyData());
      },
    });
    assert.equal(gets, 1);
    assert.equal(
      result.disposition,
      "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
    );
    assert.equal(result.paidCredential, true);
    assert.equal(result.providerModelPosts, 0);
    assert.equal(result.billableCalls, 0);
    assert.equal(result.costUsd, 0);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("openrouter-test-secret"), false);
    assert.equal(serialized.includes("must-not-persist"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unpaid key is a terminal sanitized capability blocker", async () => {
  const { root, paths } = await fixture();
  try {
    const result = await executeCredentialGate({
      paths,
      fetchImpl: async () => response(keyData({ is_free_tier: true })),
    });
    assert.equal(result.disposition, "BLOCKED_CREDENTIAL");
    assert.equal(result.failureClass, "UNPAID_CREDENTIAL");
    assert.equal(result.paidCredential, false);
    assert.equal(result.providerModelPosts, 0);
    assert.equal(result.billableCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
