import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Git preserves the public key bytes bound by the signed historical manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.json",
      "utf8",
    ),
  );
  const key = manifest.artifacts.publicKey;
  const stagedBytes = execFileSync("git", ["show", `:${key.path}`]);
  assert.equal(
    createHash("sha256").update(stagedBytes).digest("hex"),
    key.sha256,
  );
});
