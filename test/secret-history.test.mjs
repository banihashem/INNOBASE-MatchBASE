import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("history scan detects a removed credential in text containing zero", () => {
  const root = mkdtempSync(join(tmpdir(), "matchbase-history-"));
  const scanner = resolve("scripts/secret-history-scan.mjs");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git("init", "--quiet");
    git("config", "user.name", "Synthetic Test");
    git("config", "user.email", "test@example.invalid");
    const credential = ["sk", "or", "v1", "A".repeat(30)].join("-");
    writeFileSync(join(root, "removed.txt"), `version 0\n${credential}\n`);
    git("add", "removed.txt");
    git("commit", "--quiet", "-m", "Synthetic historical input");
    git("rm", "--quiet", "removed.txt");
    git("commit", "--quiet", "-m", "Remove synthetic input");
    const result = spawnSync(process.execPath, [scanner], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(
      result.status,
      0,
      "A deleted historical credential must fail the gate",
    );
    assert.match(result.stderr, /Potential secrets in Git history objects/);
    assert.match(result.stderr, /removed\.txt/);
    assert.ok(
      !result.stderr.includes(credential),
      "Diagnostics must not print credentials",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
