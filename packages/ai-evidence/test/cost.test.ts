import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityAttemptV1, CostEventV1 } from "@matchbase/contracts";
import {
  createSyntheticCostEvent,
  reconcileCapabilityCosts,
} from "../src/cost/reconcile.js";

function attempt(id: string): CapabilityAttemptV1 {
  return {
    attemptId: id,
    runId: "RUN-COST-001",
    canonicalizationRunId: null,
    userId: "USR-FIXTURE-001",
    accountId: "ACC-FIXTURE-001",
    capabilityId: "CAP-SEARCH",
    providerId: "synthetic_fixture",
    routeId: "RT-SYNTHETIC-FIXTURE-V1",
    modelId: "deterministic-fixture-v1",
    environment: "test",
    startedAt: "2026-08-14T00:00:00.000Z",
    completedAt: "2026-08-14T00:00:01.000Z",
    outcome: "ok",
  };
}

test("reconciles exactly one explicitly zero fixture event per attempt", () => {
  const attempts = [attempt("ATT-1"), attempt("ATT-2")];
  const events = attempts.map(createSyntheticCostEvent);
  assert.deepEqual(reconcileCapabilityCosts(attempts, events), {
    status: "PASS",
    blockers: [],
  });
  assert.equal(
    events.every(
      (event) =>
        event.amount === 0 &&
        event.pricingBasis === "synthetic_fixture" &&
        event.measurement === "explicit_fixture_zero",
    ),
    true,
  );
});

test("blocks missing, duplicate, orphan, unknown and unjustified zero cost", () => {
  const item = attempt("ATT-1");
  const valid = createSyntheticCostEvent(item);
  const invalidZero: CostEventV1 = {
    ...valid,
    costEventId: "COST-INVALID-ZERO",
    providerId: "unknown-provider",
    pricingBasis: "",
    measurement: "estimated",
  };
  const unknown: CostEventV1 = {
    ...valid,
    costEventId: "COST-UNKNOWN",
    attemptId: "ATT-ORPHAN",
    amount: "unknown",
  };
  const result = reconcileCapabilityCosts(
    [item, attempt("ATT-MISSING")],
    [valid, invalidZero, unknown],
  );
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockers.includes("duplicate_cost_event:ATT-1"), true);
  assert.equal(
    result.blockers.includes("missing_cost_event:ATT-MISSING"),
    true,
  );
  assert.equal(
    result.blockers.includes("orphan_cost_event:COST-UNKNOWN"),
    true,
  );
  assert.equal(result.blockers.includes("unpriced_attempt:ATT-ORPHAN"), true);
  assert.equal(result.blockers.includes("invalid_zero_cost:ATT-1"), true);
});

test("forbids synthetic zero attribution for a non-fixture provider", () => {
  assert.throws(
    () =>
      createSyntheticCostEvent({
        ...attempt("ATT-LIVE"),
        providerId: "openrouter",
      }),
    /only for the synthetic fixture/iu,
  );
});

test("blocks missing, dual, and mismatched attribution dimensions", () => {
  const item = attempt("ATT-DIMENSIONS");
  const mismatches = [
    "runId",
    "canonicalizationRunId",
    "userId",
    "accountId",
    "capabilityId",
    "providerId",
    "modelId",
    "environment",
  ] as const;
  for (const dimension of mismatches) {
    const event = createSyntheticCostEvent(item);
    const changed: CostEventV1 = {
      ...event,
      [dimension]:
        dimension === "canonicalizationRunId" ? "CAN-RUN-X" : "mismatch",
    };
    const result = reconcileCapabilityCosts([item], [changed]);
    assert.equal(result.status, "BLOCKED");
    assert.equal(
      result.blockers.includes(
        `cost_attribution_mismatch:${item.attemptId}:${dimension}`,
      ),
      true,
    );
  }
  const invalid = {
    ...item,
    runId: null,
    canonicalizationRunId: null,
  };
  assert.equal(
    reconcileCapabilityCosts(
      [invalid],
      [createSyntheticCostEvent(invalid)],
    ).blockers.includes("attempt_attribution_invalid:ATT-DIMENSIONS"),
    true,
  );
});
