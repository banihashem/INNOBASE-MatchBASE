import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function parseNullList(value) {
  return value.split("\0").filter(Boolean);
}

function gitList(root, args) {
  const result = spawnSync("git", ["-C", root, ...args, "-z"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.error?.message || "git file inventory failed",
    );
  }
  return parseNullList(result.stdout);
}

export function repositoryCandidateFiles(root) {
  const tracked = gitList(root, ["ls-files", "--cached"]);
  const untracked = gitList(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  return [...new Set([...tracked, ...untracked])].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

export function trackedIgnoredFiles(root) {
  return gitList(root, [
    "ls-files",
    "--cached",
    "--ignored",
    "--exclude-standard",
  ]);
}

function isContained(root, candidate) {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

export function inspectRepositoryCandidate(root, relativePath) {
  const lexicalRoot = resolve(root);
  const candidate = resolve(lexicalRoot, relativePath);
  if (!isContained(lexicalRoot, candidate)) {
    throw new Error(`Repository candidate escapes root: ${relativePath}`);
  }
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) {
    throw new Error(`Repository candidate is a symbolic link: ${relativePath}`);
  }
  const realRoot = realpathSync(lexicalRoot);
  const realCandidate = realpathSync(candidate);
  if (!isContained(realRoot, realCandidate)) {
    throw new Error(
      `Repository candidate resolves outside root: ${relativePath}`,
    );
  }
  return { path: candidate, stat };
}
