import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  correctionCandidateAggregate,
  validateCorrectionCandidate,
} from "../scripts/lib/correction-candidate-policy.mjs";

const manifest = JSON.parse(
  readFileSync("evidence/slice1/correction-loop-1-candidate.json", "utf8"),
);

test("binds the correction disciplines to one exact candidate manifest", () => {
  assert.equal(
    validateCorrectionCandidate(structuredClone(manifest)).fileCount,
    41,
  );
});

for (const [name, mutate] of [
  ["missing file", (value) => value.files.pop()],
  ["forged hash", (value) => (value.files[0].sha256 = "0".repeat(64))],
  [
    "self reference",
    (value) => (value.files[0].path = "evidence/slice1/local-validation.json"),
  ],
  ["duplicate", (value) => (value.files[1] = structuredClone(value.files[0]))],
  ["reordered", (value) => value.files.reverse()],
  ["forged aggregate", (value) => (value.aggregateSha256 = "F".repeat(64))],
  [
    "empty manifest",
    (value) => {
      value.files = [];
      value.fileCount = 0;
      value.aggregateSha256 = correctionCandidateAggregate([]);
    },
  ],
  [
    "recomputed one-file subset",
    (value) => {
      value.files = value.files.slice(0, 1);
      value.fileCount = 1;
      value.aggregateSha256 = correctionCandidateAggregate(value.files);
    },
  ],
  ["unknown top-level field", (value) => (value.authority = "forged")],
  ["unknown entry field", (value) => (value.files[0].authority = "forged")],
]) {
  test(`rejects a ${name}`, () => {
    const value = structuredClone(manifest);
    mutate(value);
    assert.throws(() => validateCorrectionCandidate(value));
  });
}
