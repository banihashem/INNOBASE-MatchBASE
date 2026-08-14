import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXPECTED_REPOSITORY,
  validateExternalClosure,
} from "../scripts/lib/external-closure-policy.mjs";

const anchor = JSON.parse(
  readFileSync("governance/external-closure-anchor-v1.json", "utf8"),
);

function copy() {
  return structuredClone(anchor);
}

test("accepts the exact immutable hosted closure anchor", () => {
  assert.equal(
    validateExternalClosure(copy(), { anchorOnly: true }).repository,
    EXPECTED_REPOSITORY,
  );
});

test("binds a local management artifact hash to its exact hosted identity", () => {
  const value = copy();
  value.commit = "a".repeat(40);
  value.tree = "b".repeat(40);
  value.runId += 1;
  value.jobId += 1;
  assert.throws(
    () => validateExternalClosure(value),
    /cannot attest another identity/u,
  );
});

test("rejects forged, stale, failed, mismatched, relative, and unverified closure evidence", () => {
  const mutations = [
    (value) => (value.repository = "attacker/repository"),
    (value) => (value.commit = "0".repeat(40)),
    (value) => (value.tree = "not-a-tree"),
    (value) => (value.runId = 0),
    (value) => (value.jobId = -1),
    (value) => (value.conclusion = "failure"),
    (value) => (value.source.path = "relative-validation.md"),
    (value) => (value.source.sha256 = "0".repeat(64)),
    (value) => (value.predecessorFailures = []),
    (value) => (value.role2.auditPath = "relative-audit.md"),
    (value) => (value.role2.major = 0),
    (value) => (value.role2Status = "PASS"),
  ];
  for (const mutate of mutations) {
    const value = copy();
    mutate(value);
    assert.throws(() => validateExternalClosure(value, { anchorOnly: true }));
  }
});
