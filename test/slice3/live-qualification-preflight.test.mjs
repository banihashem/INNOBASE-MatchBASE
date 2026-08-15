import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateLiveQualificationPrerequisites } from "../../scripts/qualify-slice3-live.mjs";

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
