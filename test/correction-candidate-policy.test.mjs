import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  correctionCandidateAggregate,
  validateCorrectionCandidate,
} from "../scripts/lib/correction-candidate-policy.mjs";

const loop1Manifest = JSON.parse(
  readFileSync("evidence/slice1/correction-loop-1-candidate.json", "utf8"),
);
const loop2Manifest = JSON.parse(
  readFileSync("evidence/slice1/correction-loop-2-candidate.json", "utf8"),
);

test("preserves the exact Loop 1 candidate manifest", () => {
  assert.equal(
    createHash("sha256")
      .update(readFileSync("evidence/slice1/correction-loop-1-candidate.json"))
      .digest("hex")
      .toUpperCase(),
    "23042BC6807DCB310953E9EAF20C5E7A6F57354F23C0A8A94AB0DBC2BB1814C6",
  );
  assert.equal(loop1Manifest.fileCount, 41);
});

test("binds Loop 2 disciplines to one exact candidate manifest", () => {
  assert.equal(
    validateCorrectionCandidate(structuredClone(loop2Manifest)).fileCount,
    17,
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
    const value = structuredClone(loop2Manifest);
    mutate(value);
    assert.throws(() => validateCorrectionCandidate(value));
  });
}
