import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateResearchRoutePolicy } from "../../packages/ai-evidence/dist/src/index.js";

const policyUrl = new URL(
  "../../config/slice3/research-route-policy.staging.v4.json",
  import.meta.url,
);
const evidenceUrl = new URL(
  "../../evidence/slice3/staging-openrouter-azure-openai-qualification.v1.json",
  import.meta.url,
);

test("Staging v4 preserves direct Gemini and closes the fallback to qualified Azure OpenAI", async () => {
  const bytes = await readFile(policyUrl);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "aa6b7e3e1c720fdc6c30ef7ebfa4fcc0e60fd4dbb41d73cee33f511b0adbddec",
  );
  const policy = validateResearchRoutePolicy(JSON.parse(bytes.toString()));
  assert.equal(
    policy.policyVersion,
    "slice3-routes.2026-09-02.staging-qualified-v4",
  );
  assert.equal(policy.environment, "staging");
  assert.equal(policy.routes.length, 2);
  const direct = policy.routes[0];
  const fallback = policy.routes[1];
  assert.equal(direct?.path, "gemini_direct");
  assert.equal(direct?.providerId, "google");
  assert.equal(direct?.requestedModelId, "gemini-3.6-flash");
  assert.equal(direct?.parameterPolicy.maxAttempts, 1);
  assert.equal(fallback?.path, "openrouter");
  assert.equal(fallback?.providerId, "azure");
  assert.equal(fallback?.requestedModelId, "openai/gpt-5.4-mini");
  assert.equal(fallback?.expectedServedModelId, "openai/gpt-5.4-mini");
  assert.equal(fallback?.parameterPolicy.timeoutMs, 60_000);
  assert.equal(fallback?.parameterPolicy.maxAttempts, 1);
  assert.equal(fallback?.parameterPolicy.backoffMs, 0);
  assert.equal(fallback?.parameterPolicy.requireParameters, true);
  assert.equal(fallback?.parameterPolicy.allowFallbacks, false);
  assert.equal(fallback?.dataHandling.retentionTrainingPosture, "verified_zdr");
  assert.equal(
    direct?.costPolicy.pricingVersion,
    fallback?.costPolicy.pricingVersion,
  );
});

test("Staging v4 Azure OpenAI qualification contains two passing billable probes and no raw payload", async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));
  assert.equal(evidence.syntheticOnly, true);
  assert.equal(evidence.rawProviderPayloadPersisted, false);
  assert.equal(evidence.credentialsDisclosed, false);
  assert.equal(evidence.route.requestLevelZdr, true);
  assert.equal(evidence.route.dataCollection, "deny");
  assert.deepEqual(evidence.route.providerOnly, ["azure"]);
  assert.deepEqual(evidence.route.providerOrder, ["azure"]);
  assert.equal(evidence.route.allowFallbacks, false);
  assert.equal(evidence.billableSyntheticProbes.length, 2);
  for (const probe of evidence.billableSyntheticProbes) {
    assert.equal(probe.httpStatus, 200);
    assert.equal(probe.evidenceGraphValidation, "passed");
    assert.ok(probe.costUsd > 0 && probe.costUsd < 100);
  }
  assert.equal(evidence.terminalDisposition, "PASS");
});
