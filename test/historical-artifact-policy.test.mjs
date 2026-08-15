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

test("verifies accepted Slice 2 bytes independently of an evolved current path", () => {
  const historical = {
    repoRoot: ".",
    acceptedCommit: "f1a5429505616a61cdac87cf7f57c114fa5e43a6",
    path: "packages/contracts/schemas/v1/contracts.schema.json",
    sha256: "668F62393FF6FCD3F8C4B1A80DDE4E2B162292B5FCFDF03756895F50D53A311A",
  };
  assert.deepEqual(verifyHistoricalArtifact(historical), {
    acceptedCommit: historical.acceptedCommit,
    path: historical.path,
    sha256: historical.sha256,
  });
  assert.throws(() =>
    verifyHistoricalArtifact({
      ...historical,
      acceptedCommit: "f".repeat(40),
    }),
  );
  assert.throws(() =>
    verifyHistoricalArtifact({ ...historical, path: "../outside" }),
  );
  assert.throws(() =>
    verifyHistoricalArtifact({ ...historical, path: "missing-object" }),
  );
  assert.throws(() =>
    verifyHistoricalArtifact({ ...historical, sha256: "F".repeat(64) }),
  );
});
