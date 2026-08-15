import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchRoutePolicyV1 } from "@matchbase/contracts";
import {
  createResearchRouteSnapshot,
  resolveActiveResearchRoute,
  validateResearchRoutePolicy,
  validateResearchRouteSnapshot,
} from "../src/research-route-policy.js";
import { qualifiedPolicy } from "./fixtures/research-route-policy.js";

function mutateRoute(
  mutation: (route: Record<string, unknown>) => void,
  routeIndex = 0,
): ResearchRoutePolicyV1 {
  const policy = structuredClone(qualifiedPolicy()) as unknown as {
    routes: Record<string, unknown>[];
  };
  const route = policy.routes[routeIndex];
  assert.ok(route);
  mutation(route);
  return policy as unknown as ResearchRoutePolicyV1;
}

test("accepts a closed direct Gemini plus explicit OpenRouter policy", () => {
  const policy = qualifiedPolicy();
  assert.equal(validateResearchRoutePolicy(policy), policy);
  assert.equal(
    resolveActiveResearchRoute(
      policy,
      "RT-OPENROUTER-GOOGLE-S3-V1",
      "2026-08-16T00:00:00.000Z",
    ).providerId,
    "google",
  );
});

test("rejects auto, wildcard, mutable, implicit, and mismatched identities", () => {
  const mutations: Array<[number, string, string]> = [
    [1, "requestedModelId", "openrouter/auto"],
    [1, "requestedModelId", "google/*"],
    [1, "requestedModelId", "google/gemini-latest"],
    [1, "providerId", "auto"],
    [1, "providerId", "openrouter"],
    [0, "providerId", "not-google"],
    [0, "expectedServedModelId", "gemini-2.5-pro"],
  ];
  for (const [routeIndex, field, value] of mutations) {
    assert.throws(
      () =>
        validateResearchRoutePolicy(
          mutateRoute((route) => {
            route[field] = value;
          }, routeIndex),
        ),
      /auto|wildcard|implicit|mutable|provider|identit/iu,
    );
  }
});

test("fails closed for paid, data-handling, freshness, and unknown-cost gaps", () => {
  const mutations: Array<(route: Record<string, unknown>) => void> = [
    (route) => {
      (route.dataHandling as Record<string, unknown>).paidPath = "unverified";
    },
    (route) => {
      (route.dataHandling as Record<string, unknown>).retentionTrainingPosture =
        "unknown";
    },
    (route) => {
      (route.dataHandling as Record<string, unknown>).evidenceRefs = [];
    },
    (route) => {
      (route.dataHandling as Record<string, unknown>).evidenceExpiresAt =
        "2026-08-14T00:00:00.000Z";
    },
    (route) => {
      (route.costPolicy as Record<string, unknown>).pricingState = "unknown";
      (route.costPolicy as Record<string, unknown>).accountingMode =
        "unavailable";
    },
  ];
  for (const mutate of mutations) {
    assert.throws(
      () => validateResearchRoutePolicy(mutateRoute(mutate)),
      /activation|evidence|current|cost/iu,
    );
  }
});

test("rejects secrets, unknown fields, open activation gaps, and stale runtime evidence", () => {
  assert.throws(
    () =>
      validateResearchRoutePolicy({
        ...qualifiedPolicy(),
        apiKey: "not-a-live-value",
      }),
    /secret-bearing/iu,
  );
  assert.throws(
    () =>
      validateResearchRoutePolicy(
        mutateRoute((route) => {
          (route.parameterPolicy as Record<string, unknown>).unbounded = true;
        }),
      ),
    /unsupported fields/iu,
  );
  const blocked = structuredClone(qualifiedPolicy()) as unknown as {
    liveActivation: string;
  };
  blocked.liveActivation = "blocked";
  assert.throws(
    () => validateResearchRoutePolicy(blocked),
    /blocked live activation/iu,
  );
  assert.throws(
    () =>
      resolveActiveResearchRoute(
        qualifiedPolicy(),
        "RT-GEMINI-DIRECT-S3-V1",
        "2026-09-16T00:00:00.000Z",
      ),
    /stale/iu,
  );
});

test("creates an exact deeply immutable route snapshot and denies identity drift", () => {
  const policy = qualifiedPolicy();
  const route = policy.routes[1];
  assert.ok(route);
  const snapshot = createResearchRouteSnapshot({
    policy,
    route,
    snapshotId: "SNAP-S3-001",
    runId: "RUN-S3-001",
    servedProviderId: "google",
    servedModelId: "google/gemini-2.5-flash",
    terminalDisposition: "ok",
    capturedAt: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(validateResearchRouteSnapshot(snapshot), snapshot);
  assert.equal(snapshot.requestedModelId, snapshot.servedModelId);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.parameterPolicy), true);
  assert.throws(
    () =>
      createResearchRouteSnapshot({
        policy,
        route,
        snapshotId: "SNAP-S3-002",
        runId: "RUN-S3-001",
        servedProviderId: "other-provider",
        servedModelId: route.expectedServedModelId,
        terminalDisposition: "ok",
        capturedAt: "2026-08-16T00:00:00.000Z",
      }),
    /does not match/iu,
  );
  assert.throws(
    () => validateResearchRouteSnapshot({ ...snapshot, routeTopology: [] }),
    /unsupported fields/iu,
  );
});
