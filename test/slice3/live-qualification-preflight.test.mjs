import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  credentialHandlePresence,
  evaluateLiveQualificationPrerequisites,
  LIVE_RESEARCH_CREDENTIAL_HANDLES,
} from "../../scripts/qualify-slice3-live.mjs";

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
    budget: { maxCalls: 2, maxCostUsd: 1 },
  });
  assert.equal(result.disposition, "BLOCKED_PREREQUISITE");
  assert.equal(result.providerCalls, 0);
  assert.equal(result.credentialValuesInspected, false);
  assert.deepEqual(result.blockers, [
    "ROUTE_POLICY_NOT_ENABLED",
    "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
    "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
    "EXPLICIT_BILLABLE_QUALIFICATION_AUTHORIZATION_ABSENT",
  ]);
});

test("preflight rejects an unbounded or malformed call budget", () => {
  const result = evaluateLiveQualificationPrerequisites({
    policy: { ...policy, liveActivation: "enabled" },
    directCredentialPresent: true,
    openRouterCredentialPresent: true,
    explicitAuthorization: true,
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

test("preflight reaches READY only from exact canonical presence signals", () => {
  const readyPolicy = structuredClone(policy);
  readyPolicy.liveActivation = "enabled";
  for (const route of readyPolicy.routes) {
    route.enabled = true;
    route.liveQualified = true;
  }
  const present = credentialHandlePresence({
    MATCHBASE_GEMINI_API_KEY: "present",
    MATCHBASE_OPENROUTER_API_KEY: "present",
  });
  assert.equal(
    evaluateLiveQualificationPrerequisites({
      policy: readyPolicy,
      ...present,
      explicitAuthorization: true,
      budget: { maxCalls: 2, maxCostUsd: 1 },
    }).disposition,
    "READY_TO_EXECUTE",
  );
  const legacyOnly = credentialHandlePresence({
    GEMINI_API_KEY: "legacy-only",
    GOOGLE_APPLICATION_CREDENTIALS: "legacy-only",
    OPENROUTER_API_KEY: "legacy-only",
  });
  const blocked = evaluateLiveQualificationPrerequisites({
    policy: readyPolicy,
    ...legacyOnly,
    explicitAuthorization: true,
    budget: { maxCalls: 2, maxCostUsd: 1 },
  });
  assert.equal(blocked.disposition, "BLOCKED_PREREQUISITE");
  assert.deepEqual(blocked.blockers, [
    "APPROVED_DIRECT_CREDENTIAL_ABSENT",
    "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
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
        budget: { maxCalls: 2, maxCostUsd: 1 },
      }),
    /exact boolean signals/iu,
  );
});
