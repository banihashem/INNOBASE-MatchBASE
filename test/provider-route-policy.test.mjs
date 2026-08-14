import assert from "node:assert/strict";
import test from "node:test";
import { validateProviderRoutes } from "../scripts/lib/provider-route-policy.mjs";

const base = {
  schemaVersion: 1,
  rules: {
    openRouterAutoAllowed: false,
    realDataRequiresPaidVerifiedRoute: true,
    credentialsInRepositoryAllowed: false,
  },
};

function policy(route) {
  return { ...base, routes: [route] };
}

test("accepts a canonical paid and verified real-data route", () => {
  assert.doesNotThrow(() =>
    validateProviderRoutes(
      policy({
        id: "direct-model",
        provider: "provider-a",
        model: "model-1",
        enabled: true,
        realData: true,
        billingPath: "PAID_VERIFIED",
        paidEvidenceRefs: ["matchbase://evidence/billing"],
        dataHandlingEvidenceRefs: ["matchbase://evidence/data-handling"],
      }),
    ),
  );
});

test("rejects canonical and ambiguous openrouter auto routes", () => {
  const canonical = {
    id: "bad",
    provider: "openrouter",
    model: "auto",
    enabled: true,
    realData: false,
    billingPath: "NOT_APPLICABLE",
  };
  assert.throws(() => validateProviderRoutes(policy(canonical)), /prohibited/);
  assert.throws(
    () =>
      validateProviderRoutes(
        policy({ ...canonical, providerModel: "openrouter/auto" }),
      ),
    /unsupported fields/,
  );
  assert.throws(
    () => validateProviderRoutes(policy({ ...canonical, model: " auto " })),
    /canonical text/,
  );
});

test("rejects non-boolean real-data flags and missing verification evidence", () => {
  const valid = {
    id: "route",
    provider: "provider-a",
    model: "model-1",
    enabled: true,
    realData: true,
    billingPath: "PAID_VERIFIED",
    paidEvidenceRefs: ["matchbase://evidence/billing"],
    dataHandlingEvidenceRefs: ["matchbase://evidence/data"],
  };
  assert.throws(
    () => validateProviderRoutes(policy({ ...valid, realData: "true" })),
    /must be booleans/,
  );
  assert.throws(
    () => validateProviderRoutes(policy({ ...valid, paidEvidenceRefs: [] })),
    /paidEvidenceRefs/,
  );
  assert.throws(
    () =>
      validateProviderRoutes(
        policy({ ...valid, dataHandlingEvidenceRefs: ["relative.md"] }),
      ),
    /invalid dataHandlingEvidenceRefs/,
  );
});
