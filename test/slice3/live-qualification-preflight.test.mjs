import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  credentialHandlePresence,
  evaluateLiveQualificationPrerequisites,
  LIVE_RESEARCH_CREDENTIAL_HANDLES,
} from "../../scripts/qualify-slice3-live.mjs";
import { SLICE3_LIVE_QUALIFICATION_CONSTANTS } from "../../scripts/lib/slice3-live-qualification-runner.mjs";

const policy = JSON.parse(
  readFileSync(
    new URL(
      "../../config/slice3/research-route-policy.v1.json",
      import.meta.url,
    ),
  ),
);

test("live qualification preflight remains blocked without inspecting credential values", () => {
  const result = evaluateLiveQualificationPrerequisites({
    policy,
    directCredentialPresent: true,
    openRouterCredentialPresent: false,
    explicitAuthorization: false,
    authorizationId: null,
    budget: { maxCalls: 2, maxCostUsd: 100 },
  });
  assert.equal(result.disposition, "BLOCKED_PREREQUISITE");
  assert.equal(result.providerCalls, 0);
  assert.equal(result.credentialValuesInspected, false);
  assert.deepEqual(result.blockers, [
    "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
    "V3_DISTINCT_AUTHORIZATION_SIGNAL_ABSENT",
    "V3_OWNER_REAUTHORIZATION_ABSENT",
    "V3_PREFLIGHT_AUTHORIZATION_BINDING_ABSENT",
  ]);
  assert.deepEqual(result.currentAcceptanceBlockers, [
    "ROUTE_POLICY_NOT_ENABLED",
    "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
  ]);
});

test("preflight rejects an unbounded or malformed call budget", () => {
  const result = evaluateLiveQualificationPrerequisites({
    policy,
    directCredentialPresent: true,
    openRouterCredentialPresent: true,
    explicitAuthorization: true,
    authorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId,
    budget: { maxCalls: 3, maxCostUsd: 0 },
  });
  assert.equal(result.disposition, "BLOCKED_PREREQUISITE");
  assert.ok(result.blockers.includes("QUALIFICATION_BUDGET_INVALID"));
  assert.equal(result.externalMutations, 0);
});

test("credential presence uses only the two canonical runtime handles", () => {
  assert.deepEqual(LIVE_RESEARCH_CREDENTIAL_HANDLES, {
    geminiDirect: "MATCHBASE_GEMINI_API_KEY",
    openrouter: "MATCHBASE_OPENROUTER_API_KEY",
  });
  const cases = [
    [{}, false, false],
    [{ MATCHBASE_GEMINI_API_KEY: "present" }, true, false],
    [
      {
        GEMINI_API_KEY: "legacy-only",
        GOOGLE_APPLICATION_CREDENTIALS: "legacy-only",
        OPENROUTER_API_KEY: "legacy-only",
      },
      false,
      false,
    ],
    [{ MATCHBASE_GEMINI_API_KEY: undefined }, false, false],
    [
      {
        MATCHBASE_GEMINI_API_KEY: "",
        MATCHBASE_OPENROUTER_API_KEY: "",
      },
      false,
      false,
    ],
    [{ MATCHBASE_GEMINI_API_KEY: "   " }, false, false],
    [{ MATCHBASE_GEMINI_API_KEY: "present\n" }, false, false],
    [{ MATCHBASE_GEMINI_API_KEY: "present\0" }, false, false],
  ];
  for (const [environment, direct, openrouter] of cases) {
    assert.deepEqual(credentialHandlePresence(environment), {
      directCredentialPresent: direct,
      openRouterCredentialPresent: openrouter,
    });
  }
});

test("preflight remains blocked until a source-anchored owner capability exists", () => {
  const present = credentialHandlePresence({
    MATCHBASE_GEMINI_API_KEY: "present",
    MATCHBASE_OPENROUTER_API_KEY: "present",
  });
  const pendingOwner = evaluateLiveQualificationPrerequisites({
    policy,
    ...present,
    explicitAuthorization: true,
    authorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId,
    authorizationBinding: null,
    budget: { maxCalls: 2, maxCostUsd: 100 },
  });
  assert.equal(pendingOwner.disposition, "BLOCKED_PREREQUISITE");
  assert.deepEqual(pendingOwner.blockers, [
    "V3_PREFLIGHT_AUTHORIZATION_BINDING_ABSENT",
  ]);
  const legacyOnly = credentialHandlePresence({
    GEMINI_API_KEY: "legacy-only",
    GOOGLE_APPLICATION_CREDENTIALS: "legacy-only",
    OPENROUTER_API_KEY: "legacy-only",
  });
  const blocked = evaluateLiveQualificationPrerequisites({
    policy,
    ...legacyOnly,
    explicitAuthorization: true,
    authorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId,
    budget: { maxCalls: 2, maxCostUsd: 100 },
  });
  assert.equal(blocked.disposition, "BLOCKED_PREREQUISITE");
  assert.deepEqual(blocked.blockers, [
    "APPROVED_DIRECT_CREDENTIAL_ABSENT",
    "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
    "V3_PREFLIGHT_AUTHORIZATION_BINDING_ABSENT",
  ]);
});

test("preflight rejects already-enabled or partially qualified route state", () => {
  for (const mutate of [
    (candidate) => (candidate.liveActivation = "enabled"),
    (candidate) => (candidate.routes[0].enabled = true),
    (candidate) => (candidate.routes[1].liveQualified = true),
    (candidate) => (candidate.routes[0].parameterPolicy.maxAttempts = 2),
    (candidate) => (candidate.routes[1].parameterPolicy.backoffMs = 500),
  ]) {
    const candidate = structuredClone(policy);
    mutate(candidate);
    const result = evaluateLiveQualificationPrerequisites({
      policy: candidate,
      directCredentialPresent: true,
      openRouterCredentialPresent: true,
      explicitAuthorization: true,
      authorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId,
      budget: { maxCalls: 2, maxCostUsd: 100 },
    });
    assert.equal(result.disposition, "BLOCKED_PREREQUISITE");
    assert.ok(result.blockers.includes("QUALIFICATION_ROUTE_SET_INVALID"));
  }
});

test("preflight rejects the exhausted V1 authorization identity", () => {
  const result = evaluateLiveQualificationPrerequisites({
    policy,
    directCredentialPresent: true,
    openRouterCredentialPresent: true,
    explicitAuthorization: true,
    authorizationId: "PO-001-SLICE3-LIVE-QUALIFICATION-2026-08-16-V1",
    budget: { maxCalls: 2, maxCostUsd: 100 },
  });
  assert.equal(result.disposition, "BLOCKED_PREREQUISITE");
  assert.deepEqual(result.blockers, [
    "V3_OWNER_REAUTHORIZATION_ABSENT",
    "V3_PREFLIGHT_AUTHORIZATION_BINDING_ABSENT",
  ]);
});

test("preflight rejects malformed presence signals without accepting values", () => {
  assert.throws(
    () =>
      evaluateLiveQualificationPrerequisites({
        policy,
        directCredentialPresent: "present",
        openRouterCredentialPresent: false,
        explicitAuthorization: false,
        authorizationId: null,
        budget: { maxCalls: 2, maxCostUsd: 100 },
      }),
    /exact boolean signals/iu,
  );
});
