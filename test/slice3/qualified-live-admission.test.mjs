import assert from "node:assert/strict";
import test from "node:test";
import {
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
    assert.equal(admission.decide("demo").id, "synthetic_reference");
  }
  assert.equal(
    syntheticResearchAdmission.decide("demo").id,
    "synthetic_reference",
  );
  assert.equal(
    createServerOwnedResearchAdmission({
      activationAuthorized: true,
      environment: "production",
      policy: LIVE_WORKER_FIXTURE_POLICY,
      verifiedCredentialHandles: {
        gemini_direct: true,
        openrouter: true,
      },
      eligibleTiers: ["demo"],
    }).decide("demo").id,
    "synthetic_reference",
  );
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
  assert.equal(admission.decide("demo").id, "synthetic_reference");
});
