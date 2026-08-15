import assert from "node:assert/strict";
import test from "node:test";

import {
  SLICE2_AUDIT_IDS,
  mergeSlice2ChangedPaths,
  validateSlice2AuditBindings,
  validateSlice2PredecessorParity,
} from "../scripts/lib/slice2-audit-policy.mjs";

const manifestSha = "A".repeat(64);
const aggregateSha = "B".repeat(64);
const records = () =>
  SLICE2_AUDIT_IDS.map((id, index) => ({
    id,
    status: index === SLICE2_AUDIT_IDS.length - 1 ? "PENDING" : "PASS",
    critical: 0,
    major: 0,
    minor: 0,
    candidateManifestSha256: manifestSha,
    candidateAggregateSha256: aggregateSha,
    method: `Independent audit ${index + 1}`,
  }));

test("binds the closed ordered Slice 2 audit set to one exact candidate", () => {
  assert.doesNotThrow(() =>
    validateSlice2AuditBindings(records(), manifestSha, aggregateSha),
  );
  const pending = records().map((record) => ({ ...record, status: "PENDING" }));
  assert.doesNotThrow(() =>
    validateSlice2AuditBindings(pending, manifestSha, aggregateSha),
  );
  const mutations = [
    (items) => items.slice(0, -1),
    (items) => [...items, structuredClone(items[0])],
    (items) => [items[1], items[0], ...items.slice(2)],
    (items) => {
      items[0].id = items[1].id;
      return items;
    },
    (items) => {
      items[0].candidateManifestSha256 = "C".repeat(64);
      return items;
    },
    (items) => {
      items[0].candidateAggregateSha256 = "D".repeat(64);
      return items;
    },
    (items) => {
      items[0].unknown = "forged";
      return items;
    },
    (items) => {
      items[0].major = 1;
      return items;
    },
    (items) => {
      items[0].status = "PENDING";
      return items;
    },
  ];
  for (const mutate of mutations)
    assert.throws(() =>
      validateSlice2AuditBindings(mutate(records()), manifestSha, aggregateSha),
    );
});

test("binds the audit ledger to the exact ordered hosted predecessor set", () => {
  const expected = [
    {
      runId: 1,
      jobId: 2,
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      conclusion: "failure",
      reason: "FIRST_FAILURE",
    },
    {
      runId: 3,
      jobId: 4,
      commit: "c".repeat(40),
      tree: "d".repeat(40),
      conclusion: "success",
      reason: "HISTORICAL_SUCCESS",
    },
  ];
  assert.doesNotThrow(() =>
    validateSlice2PredecessorParity(structuredClone(expected), expected),
  );
  for (const mutation of [
    (value) => value.pop(),
    (value) => value.reverse(),
    (value) => (value[0].runId += 1),
    (value) => (value[0].reason = "SUBSTITUTED"),
    (value) => (value[0].unknown = true),
  ]) {
    const forged = structuredClone(expected);
    mutation(forged);
    assert.throws(() => validateSlice2PredecessorParity(forged, expected));
  }
});

test("reconciles both uncommitted and clean committed successor paths", () => {
  assert.deepEqual(
    mergeSlice2ChangedPaths({
      committedPaths: [],
      workingPaths: ["packages/application/src/index.ts"],
      untrackedPaths: ["evidence/slice2/local-validation.json"],
    }),
    [
      "evidence/slice2/local-validation.json",
      "packages/application/src/index.ts",
    ],
  );
  assert.deepEqual(
    mergeSlice2ChangedPaths({
      committedPaths: [
        "packages/application/src/index.ts",
        "evidence/slice2/local-validation.json",
      ],
      workingPaths: [],
      untrackedPaths: [],
    }),
    [
      "evidence/slice2/local-validation.json",
      "packages/application/src/index.ts",
    ],
  );
  assert.deepEqual(
    mergeSlice2ChangedPaths({
      committedPaths: ["a.txt"],
      workingPaths: ["a.txt", "b.txt"],
      untrackedPaths: ["c.txt"],
    }),
    ["a.txt", "b.txt", "c.txt"],
  );
  for (const path of ["../escape", "/absolute", "windows\\path"])
    assert.throws(() =>
      mergeSlice2ChangedPaths({
        committedPaths: [path],
        workingPaths: [],
        untrackedPaths: [],
      }),
    );
});
