import assert from "node:assert/strict";
import test from "node:test";
import { requiredResearchDiscoveryPaths } from "../../../packages/contracts/dist/src/index.js";

test("MB-UX-QUALITY-002 L08 quorum requires distinct approved independent model families", () => {
  const models = [
    "google/g",
    "openai/o",
    "anthropic/a",
    "deepseek/d",
    "x-ai/x",
  ];
  assert.equal(requiredResearchDiscoveryPaths(models.slice(0, 2)), 2);
  assert.equal(requiredResearchDiscoveryPaths(models.slice(0, 3)), 2);
  assert.equal(requiredResearchDiscoveryPaths(models), 3);
  assert.equal(requiredResearchDiscoveryPaths(models.slice(0, 4)), 4);
  assert.equal(
    requiredResearchDiscoveryPaths(["google/g", "google/g2", "openai/o"]),
    Infinity,
  );
  assert.equal(
    requiredResearchDiscoveryPaths(["google/g", "google/g", "openai/o"]),
    Infinity,
  );
  assert.equal(
    requiredResearchDiscoveryPaths(["google/g", "openai/o", "malformed"]),
    Infinity,
  );
  assert.ok(requiredResearchDiscoveryPaths([]) > 0);
});
