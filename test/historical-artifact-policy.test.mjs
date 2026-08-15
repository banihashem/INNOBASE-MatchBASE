import assert from "node:assert/strict";
import test from "node:test";

import { verifyHistoricalArtifact } from "../scripts/lib/historical-artifact-policy.mjs";

const acceptedCommit = "832fa68244eefa0dae4c079b9b94ecaea4b6a872";
const path = "scripts/generate-dashboard-ci-snapshot.mjs";
const sha256 =
  "620859D13930F584B46239693234900B2B05B4F8350D6DCE532C2438E9E73E10";

const exact = () => ({ repoRoot: ".", acceptedCommit, path, sha256 });

test("verifies accepted Slice 1 bytes from the pinned Git object", () => {
  assert.deepEqual(verifyHistoricalArtifact(exact()), {
    acceptedCommit,
    path,
    sha256,
  });
});

test("rejects forged commit, path, hash, and missing Git object", () => {
  const mutations = [
    (value) => (value.acceptedCommit = "f".repeat(40)),
    (value) => (value.path = "../outside"),
    (value) => (value.sha256 = "F".repeat(64)),
    (value) => (value.path = "scripts/does-not-exist.mjs"),
  ];
  for (const mutate of mutations) {
    const value = exact();
    mutate(value);
    assert.throws(() => verifyHistoricalArtifact(value));
  }
});
