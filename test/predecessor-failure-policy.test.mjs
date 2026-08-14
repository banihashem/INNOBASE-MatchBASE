import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExactPredecessorHistory,
  validatePredecessorAttestation,
  validatePredecessorFailures,
} from "../scripts/lib/predecessor-failure-policy.mjs";

const failures = [
  {
    runId: 10,
    jobId: 20,
    commit: "a".repeat(40),
    conclusion: "failure",
  },
  {
    runId: 30,
    jobId: 40,
    commit: "b".repeat(40),
    conclusion: "failure",
  },
];
const reasons = [
  { runId: 10, reasonCode: "FIRST_FAILURE" },
  { runId: 30, reasonCode: "SECOND_FAILURE" },
];

const copy = () => structuredClone(failures);

test("accepts the closed canonical predecessor attestation", () => {
  const value = {
    schemaVersion: "matchbase.predecessor-failures/v1",
    failures: copy(),
    reasons: structuredClone(reasons),
  };
  assert.equal(validatePredecessorAttestation(value), value);
  assert.doesNotThrow(() =>
    assertExactPredecessorHistory(
      failures.map(({ conclusion, commit, jobId, runId }) => ({
        conclusion,
        commit,
        jobId,
        runId,
      })),
      reasons,
      failures,
      reasons,
    ),
  );
});

for (const [name, mutate] of [
  ["empty", (value) => value.splice(0)],
  ["unsafe run", (value) => (value[0].runId = Number.MAX_SAFE_INTEGER + 1)],
  ["invalid job", (value) => (value[0].jobId = 0)],
  ["uppercase commit", (value) => (value[0].commit = "A".repeat(40))],
  ["changed conclusion", (value) => (value[0].conclusion = "success")],
  ["unknown field", (value) => (value[0].unknown = true)],
  ["reordered", (value) => value.reverse()],
  ["duplicate run", (value) => (value[1].runId = value[0].runId)],
  ["duplicate job", (value) => (value[1].jobId = value[0].jobId)],
  [
    "duplicate pair",
    (value) => {
      value[1].runId = value[0].runId;
      value[1].jobId = value[0].jobId;
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const value = copy();
    mutate(value);
    assert.throws(() => validatePredecessorFailures(value));
  });
}

for (const [name, current] of [
  ["successful run reuse", { currentRunId: 10 }],
  ["successful job reuse", { currentJobId: 20 }],
  ["successful commit reuse", { currentCommit: "a".repeat(40) }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validatePredecessorFailures(copy(), current));
  });
}

test("rejects same-count tuple and reason substitution", () => {
  const changed = copy();
  changed[0].runId = 11;
  assert.throws(() =>
    assertExactPredecessorHistory(changed, reasons, failures, reasons),
  );
  const changedReasons = structuredClone(reasons);
  changedReasons[0].reasonCode = "FORGED_REASON";
  assert.throws(() =>
    assertExactPredecessorHistory(failures, changedReasons, failures, reasons),
  );
});
