import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ProviderRegistryV1 } from "@matchbase/contracts";
import { validateProviderRegistry } from "../src/route-policy.js";

const configPath = new URL(
  "../../../../config/slice1/capability-registry.fixture.v1.json",
  import.meta.url,
);

async function fixtureRegistry(): Promise<ProviderRegistryV1> {
  return JSON.parse(await readFile(configPath, "utf8")) as ProviderRegistryV1;
}

test("accepts the fixture-only registry with live routes disabled", async () => {
  const registry = await fixtureRegistry();
  assert.equal(validateProviderRegistry(registry), registry);
  assert.equal(registry.routes.filter((route) => route.enabled).length, 1);
  assert.equal(
    registry.routes.find((route) => route.enabled)?.providerId,
    "synthetic_fixture",
  );
});

test("rejects auto, wildcard and implicit model identifiers", async () => {
  const registry = await fixtureRegistry();
  for (const modelId of ["openrouter/auto", "vendor/*", "default", ""]) {
    const invalid = structuredClone(registry);
    const route = invalid.routes[2];
    assert.ok(route);
    route.modelId = modelId;
    assert.throws(() => validateProviderRegistry(invalid), /model|auto/iu);
  }
});

test("rejects secret fields, unknown real-data posture and production fixtures", async () => {
  const registry = await fixtureRegistry();
  assert.throws(
    () => validateProviderRegistry({ ...registry, apiKey: "not-a-real-value" }),
    /secret-bearing/iu,
  );

  const realData = structuredClone(registry);
  const gemini = realData.routes[1];
  assert.ok(gemini);
  realData.realData = true;
  gemini.enabled = true;
  gemini.realData = true;
  gemini.billingPath = "paid_verified";
  gemini.retentionPosture = "unknown";
  assert.throws(() => validateProviderRegistry(realData), /posture/iu);

  const production = structuredClone(registry);
  production.environment = "production";
  for (const route of production.routes) route.environment = "production";
  assert.throws(
    () => validateProviderRegistry(production),
    /fixtures outside local\/test/iu,
  );
});

test("requires OpenRouter parameter enforcement and closed fallback", async () => {
  const registry = await fixtureRegistry();
  const openRouter = registry.routes[2];
  assert.ok(openRouter);
  openRouter.requireParameters = false;
  openRouter.allowFallbacks = true;
  assert.throws(
    () => validateProviderRegistry(registry),
    /require parameters/iu,
  );
});

test("rejects malformed nested values, invalid enums, and secret-like values", async () => {
  const base = await fixtureRegistry();
  const mutations: Array<(registry: ProviderRegistryV1) => void> = [
    (registry) => {
      (registry.routes[0]!.retry as unknown as Record<string, unknown>).extra =
        true;
    },
    (registry) => {
      registry.routes[0]!.enabled = "true" as never;
    },
    (registry) => {
      registry.routes[0]!.capabilities = ["CAP-UNKNOWN" as never];
    },
    (registry) => {
      registry.routes[0]!.dataHandlingEvidenceRefs = [
        `Bearer ${["s", "k"].join("")}-example-secret-material`,
      ];
    },
    (registry) => {
      registry.routes[0]!.environment = "staging";
      registry.environment = "staging";
    },
  ];
  for (const mutate of mutations) {
    const registry = structuredClone(base);
    mutate(registry);
    assert.throws(() => validateProviderRegistry(registry));
  }
});
