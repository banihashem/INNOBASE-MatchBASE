import { createHash } from "node:crypto";
import type { CapabilityAttemptV1, CostEventV1 } from "@matchbase/contracts";

export function createSyntheticCostEvent(
  attempt: CapabilityAttemptV1,
): CostEventV1 {
  if (attempt.providerId !== "synthetic_fixture") {
    throw new Error(
      "Synthetic zero cost is valid only for the synthetic fixture provider.",
    );
  }
  return {
    schemaVersion: "cost-event.v1",
    costEventId: `COST-${createHash("sha256").update(attempt.attemptId).digest("hex").slice(0, 24)}`,
    attemptId: attempt.attemptId,
    runId: attempt.runId,
    canonicalizationRunId: attempt.canonicalizationRunId,
    userId: attempt.userId,
    accountId: attempt.accountId,
    capabilityId: attempt.capabilityId,
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    environment: attempt.environment,
    quantity: 1,
    unit: "attempt",
    amount: 0,
    currency: "USD",
    pricingBasis: "synthetic_fixture",
    pricingVersion: "fixture-pricing.v1",
    measurement: "explicit_fixture_zero",
    occurredAt: attempt.completedAt,
  };
}

export interface CostReconciliation {
  status: "PASS" | "BLOCKED";
  blockers: string[];
}

export function reconcileCapabilityCosts(
  attempts: readonly CapabilityAttemptV1[],
  events: readonly CostEventV1[],
): CostReconciliation {
  const blockers: string[] = [];
  const attemptsById = new Map(
    attempts.map((attempt) => [attempt.attemptId, attempt]),
  );
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    eventCounts.set(
      event.attemptId,
      (eventCounts.get(event.attemptId) ?? 0) + 1,
    );
    const attempt = attemptsById.get(event.attemptId);
    if (!attempt) blockers.push(`orphan_cost_event:${event.costEventId}`);
    if ((event.runId === null) === (event.canonicalizationRunId === null)) {
      blockers.push(`cost_attribution_invalid:${event.attemptId}`);
    }
    if (attempt) {
      const dimensions = [
        "runId",
        "canonicalizationRunId",
        "userId",
        "accountId",
        "capabilityId",
        "providerId",
        "modelId",
        "environment",
      ] as const;
      for (const dimension of dimensions) {
        if (event[dimension] !== attempt[dimension]) {
          blockers.push(
            `cost_attribution_mismatch:${event.attemptId}:${dimension}`,
          );
        }
      }
    }
    if (
      event.amount === "unknown" ||
      !event.pricingBasis ||
      !event.pricingVersion
    ) {
      blockers.push(`unpriced_attempt:${event.attemptId}`);
    }
    if (
      event.amount === 0 &&
      !(
        event.providerId === "synthetic_fixture" &&
        event.pricingBasis === "synthetic_fixture" &&
        event.measurement === "explicit_fixture_zero"
      )
    ) {
      blockers.push(`invalid_zero_cost:${event.attemptId}`);
    }
  }
  for (const attempt of attempts) {
    if ((attempt.runId === null) === (attempt.canonicalizationRunId === null)) {
      blockers.push(`attempt_attribution_invalid:${attempt.attemptId}`);
    }
    const count = eventCounts.get(attempt.attemptId) ?? 0;
    if (count === 0) blockers.push(`missing_cost_event:${attempt.attemptId}`);
    if (count > 1) blockers.push(`duplicate_cost_event:${attempt.attemptId}`);
  }
  return {
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: [...new Set(blockers)].sort(),
  };
}
