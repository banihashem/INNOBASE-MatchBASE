import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const executionSource = await readFile(
  new URL(
    "../../packages/application/src/live-research-execution.ts",
    import.meta.url,
  ),
  "utf8",
);
const workerSource = await readFile(
  new URL("../../packages/application/src/combined-worker.ts", import.meta.url),
  "utf8",
);
const environmentRuntimeSource = await readFile(
  new URL(
    "../../packages/application/src/live-research-environment-runtime.ts",
    import.meta.url,
  ),
  "utf8",
);

test("live reservation preserves immutable configuration under a read-only runtime role", () => {
  assert.match(
    executionSource,
    /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/u,
  );
  assert.match(executionSource, /FOR SHARE OF r`/u);
  assert.doesNotMatch(executionSource, /FOR SHARE OF r,mp,sc,rp/u);
  assert.doesNotMatch(executionSource, /FOR SHARE OF mp,sc,rp/u);
  assert.doesNotMatch(executionSource, /FOR SHARE OF sc/u);
  assert.doesNotMatch(
    executionSource,
    /FROM research_route_health_observation[\s\S]{0,200}FOR UPDATE/u,
  );
  assert.doesNotMatch(
    environmentRuntimeSource,
    /FROM research_route_health_observation[\s\S]{0,200}FOR UPDATE/u,
  );
});

test("combined worker emits only a closed failure category", () => {
  assert.match(workerSource, /matchbase\.worker\.cycle_failed/u);
  assert.match(workerSource, /database_permission_denied/u);
  assert.match(workerSource, /database_serialization_retry/u);
  assert.doesNotMatch(workerSource, /errorMessage/u);
});
