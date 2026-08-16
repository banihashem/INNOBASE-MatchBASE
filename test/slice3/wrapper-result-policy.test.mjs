import assert from "node:assert/strict";
import test from "node:test";
import { validateSlice3WrapperResult } from "../../scripts/lib/slice3-wrapper-result-policy.mjs";

const sha = "A".repeat(64);
const candidate = {
  manifestSha256: "B".repeat(64),
  aggregateSha256: "C".repeat(64),
  fileCount: 34,
};
const wrapper = {
  schemaVersion: "matchbase.slice3-full-wrapper-result/v1",
  observedAt: "2026-08-16T04:00:00.000Z",
  command: "pnpm test:ci && pnpm dependency:audit",
  durationMs: 481900,
  result: "PASS",
  exitCode: 0,
  candidate,
  providerCalls: 0,
  externalMutations: 0,
};
const evidence = {
  observedAt: "2026-08-16T04:01:00.000Z",
  candidate,
  localGate: {
    fullWrapper: {
      command: wrapper.command,
      durationMs: wrapper.durationMs,
      result: wrapper.result,
      observedAt: wrapper.observedAt,
      sourceRef: {
        path: "evidence/slice3/full-wrapper-result.json",
        sha256: sha,
      },
    },
  },
};

test("binds the exact terminal wrapper result to its candidate and source", () => {
  assert.equal(validateSlice3WrapperResult(wrapper, evidence, sha), wrapper);
});

test("binds a pre-run PENDING record without claiming execution", () => {
  const pending = structuredClone(wrapper);
  pending.durationMs = null;
  pending.result = "PENDING";
  pending.exitCode = null;
  const bound = structuredClone(evidence);
  bound.localGate.fullWrapper.durationMs = null;
  bound.localGate.fullWrapper.result = "PENDING";
  assert.equal(validateSlice3WrapperResult(pending, bound, sha), pending);
});

test("rejects missing, stale, substituted, future, and unknown wrapper evidence", () => {
  const mutations = [
    ([value]) => delete value.durationMs,
    ([value]) => (value.command = "pnpm test"),
    ([value]) => (value.candidate.fileCount += 1),
    ([value]) => (value.observedAt = "2026-08-16T05:00:00.000Z"),
    ([value]) => (value.unknown = true),
    ([, bound]) =>
      (bound.localGate.fullWrapper.sourceRef.sha256 = "D".repeat(64)),
  ];
  for (const mutate of mutations) {
    const values = [structuredClone(wrapper), structuredClone(evidence)];
    mutate(values);
    assert.throws(() => validateSlice3WrapperResult(...values, sha));
  }
});
