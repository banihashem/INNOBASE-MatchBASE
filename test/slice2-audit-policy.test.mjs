import assert from "node:assert/strict";
import test from "node:test";

import {
  SLICE2_AUDIT_IDS,
  mergeSlice2ChangedPaths,
  validateSlice2AuditBindings,
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
