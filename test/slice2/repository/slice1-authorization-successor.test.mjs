import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL(
  "../../../config/slice2/slice1-authorization-successor.v1.json",
  import.meta.url,
);
const repositoryRoot = new URL("../../../", import.meta.url);
const SHA256 = /^[A-F0-9]{64}$/u;

function exactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
    .toUpperCase();
}

test("binds the unchanged Slice 1 matrix to its additive Slice 2 successor", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  exactKeys(manifest, [
    "schemaVersion",
    "scope",
    "governingSpecSha256",
    "predecessor",
    "successor",
    "activationBoundary",
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.scope, "PO-001-SLICE-2");
  assert.equal(
    manifest.governingSpecSha256,
    "A699CCFC3E5A6D94E3E43066D66918E5B47CD4CE83F1EE57D92B6A1A18DB7EBD",
  );
  assert.equal(
    manifest.activationBoundary,
    "EXPLICIT_STANDARD_WORKSPACE_APPLICATION",
  );
  for (const [kind, artifact] of [
    ["predecessor", manifest.predecessor],
    ["successor", manifest.successor],
  ]) {
    exactKeys(artifact, ["artifactId", "path", "sha256"]);
    assert.match(artifact.sha256, SHA256);
    assert.equal(artifact.path.includes("\\"), false);
    assert.equal(artifact.path.split("/").includes(".."), false);
    assert.equal(
      await sha256(new URL(artifact.path, repositoryRoot)),
      artifact.sha256,
      `${kind} bytes drifted`,
    );
  }
  assert.notEqual(manifest.predecessor.path, manifest.successor.path);
  assert.notEqual(manifest.predecessor.sha256, manifest.successor.sha256);
});
