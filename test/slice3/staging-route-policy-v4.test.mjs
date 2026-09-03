import assert from "node:assert/strict";
import { createHash, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateResearchRoutePolicy } from "../../packages/ai-evidence/dist/src/index.js";
import {
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
  canonicalResearchRoutePolicySha256,
} from "../../packages/application/dist/live-research-pipeline-identity.js";

const at = (path) => new URL(`../../${path}`, import.meta.url);
const paths = {
  policy: "config/slice3/research-route-policy.staging.v4.json",
  priorPolicy: "config/slice3/research-route-policy.staging.v3.json",
  authorization: "governance/staging-route-qualification-authorization.v1.json",
  runner: "scripts/qualify-staging-openrouter-azure-v2.mjs",
  evidence:
    "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.json",
  evidenceSignature:
    "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.sig",
  publicKey:
    "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.pub.pem",
  manifest:
    "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.json",
  manifestSignature:
    "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.sig",
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test("Staging v4 keeps Gemini unchanged and closes fallback to qualified Azure OpenAI", async () => {
  const [bytes, priorBytes] = await Promise.all([
    readFile(at(paths.policy)),
    readFile(at(paths.priorPolicy)),
  ]);
  assert.equal(
    sha256(bytes),
    "0c95528d528d7237c90d7bde792d5700e41878cf7f6f0a12b52d5ff4edb4ee02",
  );
  const policy = validateResearchRoutePolicy(JSON.parse(bytes));
  const prior = validateResearchRoutePolicy(JSON.parse(priorBytes));
  assert.equal(
    policy.policyVersion,
    "slice3-routes.2026-09-02.staging-qualified-v4",
  );
  assert.equal(policy.environment, "staging");
  assert.equal(policy.routes.length, 2);
  const direct = policy.routes[0];
  const priorDirect = prior.routes[0];
  const fallback = policy.routes[1];
  assert.deepEqual(
    { ...direct, costPolicy: { ...direct.costPolicy, pricingVersion: null } },
    {
      ...priorDirect,
      costPolicy: { ...priorDirect.costPolicy, pricingVersion: null },
    },
  );
  assert.equal(fallback.path, "openrouter");
  assert.equal(fallback.providerId, "azure");
  assert.equal(fallback.requestedModelId, "openai/gpt-5.4-mini");
  assert.equal(fallback.expectedServedModelId, "openai/gpt-5.4-mini");
  assert.deepEqual(
    {
      timeoutMs: fallback.parameterPolicy.timeoutMs,
      maxAttempts: fallback.parameterPolicy.maxAttempts,
      backoffMs: fallback.parameterPolicy.backoffMs,
      requireParameters: fallback.parameterPolicy.requireParameters,
      allowFallbacks: fallback.parameterPolicy.allowFallbacks,
      retention: fallback.dataHandling.retentionTrainingPosture,
    },
    {
      timeoutMs: 60_000,
      maxAttempts: 1,
      backoffMs: 0,
      requireParameters: true,
      allowFallbacks: false,
      retention: "verified_zdr",
    },
  );
  assert.ok(
    fallback.dataHandling.evidenceRefs.includes(
      "https://openrouter.ai/api/v1/endpoints/zdr",
    ),
  );
  assert.equal(
    fallback.dataHandling.evidenceRefs.some((value) =>
      value.includes("list-endpoints-zdr"),
    ),
    false,
  );
  assert.equal(
    direct.costPolicy.pricingVersion,
    fallback.costPolicy.pricingVersion,
  );
});

test("Staging v4 qualification is KMS-signed and bound to exact runtime policy, schema, request runner, identity, privacy, and cost", async () => {
  const [
    policyBytes,
    authorizationBytes,
    runnerBytes,
    evidenceBytes,
    evidenceSignature,
    publicKey,
    manifestBytes,
    manifestSignature,
  ] = await Promise.all([
    readFile(at(paths.policy)),
    readFile(at(paths.authorization)),
    readFile(at(paths.runner)),
    readFile(at(paths.evidence)),
    readFile(at(paths.evidenceSignature)),
    readFile(at(paths.publicKey)),
    readFile(at(paths.manifest)),
    readFile(at(paths.manifestSignature)),
  ]);
  assert.equal(
    verify("sha256", evidenceBytes, publicKey, evidenceSignature),
    true,
  );
  assert.equal(
    verify("sha256", manifestBytes, publicKey, manifestSignature),
    true,
  );
  const policy = validateResearchRoutePolicy(JSON.parse(policyBytes));
  const authorization = JSON.parse(authorizationBytes);
  const evidence = JSON.parse(evidenceBytes);
  const manifest = JSON.parse(manifestBytes);

  assert.equal(
    evidence.schemaVersion,
    "matchbase.staging-openrouter-route-qualification/v2",
  );
  assert.equal(evidence.environment, "staging");
  assert.equal(
    evidence.authorization.authorizationId,
    authorization.authorizationId,
  );
  assert.equal(
    evidence.authorization.authorizationFileSha256,
    sha256(authorizationBytes),
  );
  assert.match(evidence.authorization.sessionId, UUID);
  assert.equal(evidence.authorization.syntheticOnly, true);
  assert.equal(evidence.authorization.realUserDataTransmitted, false);
  assert.equal(evidence.authorization.authorizedMaxCalls, 50);
  assert.equal(evidence.authorization.authorizedMaxCostUsd, 100);

  assert.equal(evidence.policyBinding.policyVersion, policy.policyVersion);
  assert.equal(evidence.policyBinding.policyFileSha256, sha256(policyBytes));
  assert.equal(
    evidence.policyBinding.policyCanonicalSha256,
    canonicalResearchRoutePolicySha256(policy),
  );
  assert.equal(
    evidence.policyBinding.routeId,
    "RT-OPENROUTER-AZURE-OPENAI-GPT-5.4-MINI-S3-V1",
  );
  assert.equal(evidence.policyBinding.requestedProviderId, "azure");
  assert.equal(evidence.policyBinding.requestedModelId, "openai/gpt-5.4-mini");
  assert.equal(
    evidence.policyBinding.outputSchemaCanonicalSha256,
    LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
  );
  assert.equal(evidence.policyBinding.responseSchemaStrict, false);
  assert.equal(evidence.requestBinding.runnerFileSha256, sha256(runnerBytes));
  for (const value of Object.values(evidence.requestBinding))
    assert.match(value, SHA256);

  assert.equal(
    evidence.liveCatalogObservation.endpoint,
    "https://openrouter.ai/api/v1/endpoints/zdr",
  );
  assert.equal(evidence.liveCatalogObservation.httpStatus, 200);
  assert.equal(evidence.liveCatalogObservation.modelId, "openai/gpt-5.4-mini");
  assert.equal(evidence.liveCatalogObservation.providerName, "Azure");
  assert.equal(evidence.liveCatalogObservation.providerTag, "azure");
  assert.equal(evidence.liveCatalogObservation.status, 0);
  assert.deepEqual(evidence.liveCatalogObservation.requiredCapabilities, [
    "response_format",
    "structured_outputs",
    "max_completion_tokens",
  ]);
  assert.match(evidence.liveCatalogObservation.responseSha256, SHA256);

  const call = evidence.providerCall;
  assert.equal(call.httpStatus, 200);
  assert.equal(call.strategy, "direct");
  assert.equal(call.attempt, 1);
  assert.equal(call.isByok, false);
  assert.equal(call.servedProviderName, "Azure");
  assert.equal(call.servedProviderId, "azure");
  assert.equal(call.requestedModelId, "openai/gpt-5.4-mini");
  assert.ok(
    ["openai/gpt-5.4-mini", "openai/gpt-5.4-mini-20260317"].includes(
      call.servedRouterModelId,
    ),
  );
  assert.equal(call.finishReason, "stop");
  assert.ok(Number.isSafeInteger(call.inputTokens) && call.inputTokens > 0);
  assert.ok(Number.isSafeInteger(call.outputTokens) && call.outputTokens > 0);
  assert.ok(
    Number.isSafeInteger(call.elapsedMs) &&
      call.elapsedMs > 0 &&
      call.elapsedMs <= 60_000,
  );
  const observedElapsed = new Date(call.completedAt) - new Date(call.startedAt);
  assert.ok(observedElapsed >= 0 && observedElapsed <= 60_000);
  for (const field of [
    "generationIdSha256",
    "responseContentSha256",
    "routerMetadataSha256",
    "evidenceGraphSha256",
  ])
    assert.match(call[field], SHA256);
  assert.equal(call.evidenceGraphValidation, "passed");

  assert.deepEqual(evidence.privacy, {
    requestLevelZdr: true,
    dataCollection: "deny",
    requireParameters: true,
    allowFallbacks: false,
    providerOnly: ["azure"],
    providerOrder: ["azure"],
    rawProviderPayloadPersisted: false,
    credentialsPersistedOrDisclosed: false,
  });
  assert.equal(evidence.accounting.sessionConsumedCalls, 1);
  assert.equal(evidence.accounting.sessionCostUsd, call.costUsd);
  assert.equal(evidence.accounting.supersededSessionCalls, 4);
  assert.equal(evidence.accounting.supersededSessionKnownCostUsd, 0.01900875);
  assert.equal(evidence.accounting.authorizationAggregateObservedCalls, 5);
  assert.equal(
    evidence.accounting.authorizationAggregateKnownCostUsd,
    0.02378175,
  );
  assert.equal(evidence.accounting.authorizationRemainingCalls, 45);
  assert.equal(
    evidence.accounting.authorizationRemainingKnownCostUsd,
    99.97621825,
  );
  assert.ok(
    call.costUsd > 0 && call.costUsd <= authorization.authorizedMaxCostUsd,
  );
  assert.equal(evidence.accounting.callsWithinAuthorization, true);
  assert.equal(evidence.accounting.costWithinAuthorization, true);
  assert.equal(
    evidence.accounting.pricingVersion,
    policy.routes[1].costPolicy.pricingVersion,
  );
  assert.equal(
    evidence.pricingBundle.version,
    policy.routes[0].costPolicy.pricingVersion,
  );
  assert.equal(
    evidence.pricingBundle.directGemini.inheritedPolicyFileSha256,
    "b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155",
  );
  assert.equal(evidence.pricingBundle.directGemini.requestCostCeilingUsd, 1);
  assert.equal(evidence.pricingBundle.directGemini.searchCostCeilingUsd, 1);
  assert.equal(
    evidence.pricingBundle.openRouterAzure.providerReportedCostUsd,
    call.costUsd,
  );
  assert.equal(evidence.terminalDisposition, "PASS");

  assert.equal(
    manifest.schemaVersion,
    "matchbase.staging-route-qualification-manifest/v2",
  );
  assert.equal(
    manifest.authorizationId,
    evidence.authorization.authorizationId,
  );
  assert.equal(manifest.sessionId, evidence.authorization.sessionId);
  assert.equal(manifest.policyFileSha256, sha256(policyBytes));
  assert.equal(
    manifest.outputSchemaCanonicalSha256,
    LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
  );
  assert.equal(manifest.artifacts.evidence.sha256, sha256(evidenceBytes));
  assert.equal(
    manifest.artifacts.evidenceSignature.sha256,
    sha256(evidenceSignature),
  );
  assert.equal(manifest.artifacts.publicKey.sha256, sha256(publicKey));
  assert.equal(manifest.signatureAlgorithm, "RSA_SIGN_PKCS1_3072_SHA256");
  assert.equal(manifest.terminalDisposition, "PASS");

  const serialized = evidenceBytes.toString("utf8");
  assert.doesNotMatch(
    serialized,
    /Bearer\s|MATCHBASE_OPENROUTER_API_KEY|sk-or-|@gmail\.com/iu,
  );
});

test("Staging v4 database registration is append-only, supports read-only verification, and keeps PlanAll on a coherent deployed v3 baseline", async () => {
  const [registration, migration] = await Promise.all([
    readFile(at("scripts/register-staging-route-policy-v4.mjs"), "utf8"),
    readFile(at("deployment/gcp/Migrate-StagingRegion.ps1"), "utf8"),
  ]);
  assert.match(registration, /--execute/u);
  assert.match(registration, /--verify/u);
  assert.match(registration, /REPEATABLE READ READ ONLY/u);
  assert.match(registration, /SERIALIZABLE/u);
  assert.match(registration, /INSERT INTO research_route_policy/u);
  assert.match(registration, /INSERT INTO provider_route/u);
  assert.match(registration, /INSERT INTO provider_route_capability/u);
  assert.doesNotMatch(
    registration,
    /\b(?:UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s+(?:research_route_policy|provider_route|provider_route_capability)\b/iu,
  );
  assert.match(registration, /expectedRoutes = policy\.routes\.map/u);
  assert.match(registration, /kms_signed_qualification_manifest/u);
  assert.match(
    migration,
    /ExpectedRoutePolicySha256 = "b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155"/u,
  );
  assert.match(migration, /staging-worker-b752d2d42a63aaad@sha256:/u);
});
