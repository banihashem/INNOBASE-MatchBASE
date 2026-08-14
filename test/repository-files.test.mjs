import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  parseNullList,
  inspectRepositoryCandidate,
  repositoryCandidateFiles,
  trackedIgnoredFiles,
} from "../scripts/lib/repository-files.mjs";
import { runSecretlint } from "../scripts/run-secretlint.mjs";

test("Git null-list parsing retains ignored-looking tracked paths", () => {
  assert.deepEqual(parseNullList("src/app.ts\0dist/forced.log\0.env\0"), [
    "src/app.ts",
    "dist/forced.log",
    ".env",
  ]);
});

test("option-like tracked filenames cannot bypass Secretlint", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "matchbase-secretlint-"));
  const executable = resolve("node_modules/secretlint/bin/secretlint.js");
  try {
    const runGit = (...args) => {
      const result = spawnSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
        shell: false,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    runGit("init", "--quiet");
    await writeFile(
      resolve(directory, ".secretlintrc.json"),
      JSON.stringify({
        rules: [{ id: "@secretlint/secretlint-rule-preset-recommend" }],
      }),
      "utf8",
    );
    await writeFile(
      resolve(directory, ".gitignore"),
      "--help\n*.txt\n",
      "utf8",
    );
    await writeFile(resolve(directory, "--help"), "ordinary", "utf8");
    const syntheticSecret = [
      "https://",
      "alice",
      ":",
      "CorrectHorseBattery9",
      "@example.com",
    ].join("");
    await writeFile(resolve(directory, "secret.txt"), syntheticSecret, "utf8");
    runGit("add", ".gitignore", ".secretlintrc.json");
    runGit("add", "--force", "--", "--help", "secret.txt");
    const result = runSecretlint(directory, executable);
    assert.equal(result.passed, false);
    assert.doesNotMatch(result.output, /Usage:\s+secretlint/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file and directory links are rejected before repository reads", async (context) => {
  const parent = await mkdtemp(resolve(tmpdir(), "matchbase-links-"));
  const repository = resolve(parent, "repo");
  const outsideFile = resolve(parent, "outside.txt");
  const outsideDirectory = resolve(parent, "outside-directory");
  try {
    await mkdir(repository);
    await mkdir(outsideDirectory);
    await writeFile(outsideFile, "outside", "utf8");
    const fileLink = resolve(repository, "linked.txt");
    const directoryLink = resolve(repository, "linked-directory");
    try {
      await symlink(outsideFile, fileLink, "file");
      await symlink(outsideDirectory, directoryLink, "junction");
    } catch (error) {
      context.skip(`symbolic link unavailable: ${error?.code ?? "unknown"}`);
      return;
    }
    assert.throws(
      () => inspectRepositoryCandidate(repository, "linked.txt"),
      /symbolic link/,
    );
    assert.throws(
      () => inspectRepositoryCandidate(repository, "linked-directory"),
      /symbolic link/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("force-added ignored files remain visible to repository controls", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "matchbase-git-files-"));
  try {
    const runGit = (...args) => {
      const result = spawnSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
        shell: false,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    runGit("init", "--quiet");
    await writeFile(resolve(directory, ".gitignore"), "dist/\n*.log\n", "utf8");
    await writeFile(resolve(directory, "forced.log"), "synthetic", "utf8");
    runGit("add", ".gitignore");
    runGit("add", "--force", "forced.log");
    assert(repositoryCandidateFiles(directory).includes("forced.log"));
    assert(trackedIgnoredFiles(directory).includes("forced.log"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
