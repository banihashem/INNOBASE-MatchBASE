import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECTION_CHANGE_REVIEW_TIERS,
  PROJECTION_RESOURCE_KINDS,
  TASK139_PROJECTION_CHANGE_REVIEW,
  TASK139_PROJECTION_FIELD_REGISTRY,
  TASK139_SYNTHETIC_FUTURE_FIELD,
  validateProjectionChangeReviewV1,
  validateProjectionFieldRegistryV1,
} from "../src/v1/projection-change-review.js";

test("TASK139 records a deterministic projection decision with reviewer identity", () => {
  const first = validateProjectionChangeReviewV1(
    structuredClone(TASK139_PROJECTION_CHANGE_REVIEW),
  );
  const second = validateProjectionChangeReviewV1(
    structuredClone(TASK139_PROJECTION_CHANGE_REVIEW),
  );

  assert.deepEqual(first, second);
  assert.equal(
    first.reviewer.reviewerId,
    "matchbase-agent:task139-contract-reviewer",
  );
  assert.equal(first.reviewer.reviewerRole, "projection_contract_reviewer");
  assert.equal(
    first.decisionReference,
    "PO-001-TASK137-RESULT-CONTRACT-2026-08-25",
  );
  assert.equal(first.reviewedField, TASK139_SYNTHETIC_FUTURE_FIELD);
  assert.equal(first.requiredDefault, "deny_unregistered_fields");
  assert.equal(Object.isFrozen(TASK139_PROJECTION_CHANGE_REVIEW), true);
  assert.equal(
    Object.isFrozen(TASK139_PROJECTION_CHANGE_REVIEW.reviewer),
    true,
  );
});

test("TASK139 projection registry is the closed tier by resource matrix", () => {
  const registry = validateProjectionFieldRegistryV1(
    structuredClone(TASK139_PROJECTION_FIELD_REGISTRY),
  );
  assert.equal(
    registry.entries.length,
    PROJECTION_CHANGE_REVIEW_TIERS.length * PROJECTION_RESOURCE_KINDS.length,
  );

  const pairs = new Set(
    registry.entries.map((entry) => `${entry.tier}:${entry.resourceKind}`),
  );
  for (const tier of PROJECTION_CHANGE_REVIEW_TIERS) {
    for (const resourceKind of PROJECTION_RESOURCE_KINDS) {
      assert.equal(pairs.has(`${tier}:${resourceKind}`), true);
    }
  }
  assert.equal(
    registry.entries
      .filter(({ resourceKind }) => resourceKind === "artifact")
      .every(
        ({ verificationState }) =>
          verificationState === "registry_only_pending_runtime",
      ),
    true,
  );
  assert.equal(Object.isFrozen(TASK139_PROJECTION_FIELD_REGISTRY), true);
  assert.equal(
    Object.isFrozen(TASK139_PROJECTION_FIELD_REGISTRY.entries),
    true,
  );
  assert.equal(
    Object.isFrozen(TASK139_PROJECTION_FIELD_REGISTRY.entries[0]),
    true,
  );
});

test("TASK139 review and registry reject additive or incomplete records", () => {
  assert.throws(
    () =>
      validateProjectionChangeReviewV1({
        ...structuredClone(TASK139_PROJECTION_CHANGE_REVIEW),
        unreviewed: true,
      }),
    /closed v1 record/u,
  );

  const missing = structuredClone(TASK139_PROJECTION_FIELD_REGISTRY);
  missing.entries.pop();
  assert.throws(
    () => validateProjectionFieldRegistryV1(missing),
    /missing a closed matrix entry/u,
  );

  const unknown = structuredClone(TASK139_PROJECTION_FIELD_REGISTRY);
  (unknown.entries[0] as { tier: string }).tier = "admin";
  assert.throws(
    () => validateProjectionFieldRegistryV1(unknown),
    /unknown tier or resource/u,
  );
});
