import assert from "node:assert/strict";
import test from "node:test";
import {
  ApplicationFault,
  MatchBaseApplication,
  createServerOwnedResearchAdmission,
  syntheticResearchAdmission,
} from "../../packages/application/dist/index.js";
import { LIVE_WORKER_FIXTURE_POLICY } from "./fixtures/live-worker-runtime.mjs";

test("server-owned admission requires enabled qualified routes and both verified credential handles", () => {
  const admitted = createServerOwnedResearchAdmission({
    activationAuthorized: true,
    environment: "test",
    policy: LIVE_WORKER_FIXTURE_POLICY,
    verifiedCredentialHandles: {
      gemini_direct: true,
      openrouter: true,
    },
    eligibleTiers: ["demo"],
  });
  assert.deepEqual(admitted.decide("demo"), {
    id: "qualified_live_research",
    label: "Qualified live research",
    liveQualified: true,
  });
  assert.equal(admitted.isReady(), true);
  assert.deepEqual(admitted.decide("standard"), {
    id: "synthetic_reference",
    label: "Synthetic reference",
    liveQualified: false,
  });

  for (const blocked of [
    { activationAuthorized: false, direct: true, router: true },
    { activationAuthorized: true, direct: false, router: true },
    { activationAuthorized: true, direct: true, router: false },
  ]) {
    const admission = createServerOwnedResearchAdmission({
      activationAuthorized: blocked.activationAuthorized,
      environment: "test",
      policy: LIVE_WORKER_FIXTURE_POLICY,
      verifiedCredentialHandles: {
        gemini_direct: blocked.direct,
        openrouter: blocked.router,
      },
      eligibleTiers: ["demo"],
    });
    if (blocked.activationAuthorized)
      assert.throws(
        () => admission.decide("demo"),
        (error) =>
          error instanceof ApplicationFault &&
          error.code === "MB-503-LIVE-ADMISSION",
      );
    else assert.equal(admission.decide("demo").id, "synthetic_reference");
    assert.equal(admission.isReady(), blocked.activationAuthorized === false);
  }
  assert.equal(
    syntheticResearchAdmission.decide("demo").id,
    "synthetic_reference",
  );
  const environmentMismatch = createServerOwnedResearchAdmission({
    activationAuthorized: true,
    environment: "production",
    policy: LIVE_WORKER_FIXTURE_POLICY,
    verifiedCredentialHandles: {
      gemini_direct: true,
      openrouter: true,
    },
    eligibleTiers: ["demo"],
  });
  assert.throws(
    () => environmentMismatch.decide("demo"),
    /Qualified live research admission is temporarily unavailable/iu,
  );
});

test("route-policy evidence expiry closes readiness and live admission without restart", () => {
  let now = new Date("2026-09-01T00:00:00.000Z");
  const admission = createServerOwnedResearchAdmission({
    activationAuthorized: true,
    environment: "test",
    policy: LIVE_WORKER_FIXTURE_POLICY,
    verifiedCredentialHandles: {
      gemini_direct: true,
      openrouter: true,
    },
    eligibleTiers: ["demo"],
    now: () => now,
  });
  assert.equal(admission.isReady(), true);
  assert.equal(admission.decide("demo").id, "qualified_live_research");
  now = new Date("2026-09-15T00:00:00.001Z");
  assert.equal(admission.isReady(), false);
  assert.throws(
    () => admission.decide("demo"),
    (error) =>
      error instanceof ApplicationFault &&
      error.status === 503 &&
      error.code === "MB-503-LIVE-ADMISSION" &&
      error.retryable === true,
  );
});

test("expired live policy refuses submission before quota charge or run enqueue", async () => {
  const admission = createServerOwnedResearchAdmission({
    activationAuthorized: true,
    environment: "test",
    policy: LIVE_WORKER_FIXTURE_POLICY,
    verifiedCredentialHandles: {
      gemini_direct: true,
      openrouter: true,
    },
    eligibleTiers: ["demo"],
    now: () => new Date("2026-09-15T00:00:00.001Z"),
  });
  const queries = [];
  const application = new MatchBaseApplication({
    pool: {
      async query(text) {
        queries.push(text);
        throw new Error("Database must not be touched after failed admission.");
      },
    },
    privacyKey: Buffer.alloc(32, 9),
    canonicalizer: {
      async canonicalize() {
        throw new Error("Canonicalizer must not run.");
      },
    },
    researchAdmission: admission,
  });
  await assert.rejects(
    application.submitRun(
      {
        accountId: "00000000-0000-4000-8000-000000000301",
        userId: "00000000-0000-4000-8000-000000000302",
        tier: "demo",
        adminSubRoles: [],
        correlationId: "expired-policy-no-enqueue",
        deploymentId: "test-deployment",
      },
      "expired-policy-idempotency",
      {
        requestId: "00000000-0000-4000-8000-000000000303",
        version: 1,
      },
    ),
    (error) =>
      error instanceof ApplicationFault &&
      error.code === "MB-503-LIVE-ADMISSION",
  );
  assert.deepEqual(queries, []);
});

test("blocked repository policy cannot admit qualified live research", () => {
  const blockedPolicy = structuredClone(LIVE_WORKER_FIXTURE_POLICY);
  blockedPolicy.liveActivation = "blocked";
  for (const route of blockedPolicy.routes) {
    route.enabled = false;
    route.liveQualified = false;
    route.dataHandling.paidPath = "unverified";
  }
  const admission = createServerOwnedResearchAdmission({
    activationAuthorized: true,
    environment: "test",
    policy: blockedPolicy,
    verifiedCredentialHandles: {
      gemini_direct: true,
      openrouter: true,
    },
    eligibleTiers: ["demo"],
  });
  assert.throws(
    () => admission.decide("demo"),
    /Qualified live research admission is temporarily unavailable/iu,
  );
});
