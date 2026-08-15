import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const GIT_ID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[A-F0-9]{64}$/u;

export function verifyHistoricalArtifact({
  repoRoot,
  acceptedCommit,
  path,
  sha256,
}) {
  const root = realpathSync(repoRoot);
  if (
    !GIT_ID.test(acceptedCommit) ||
    !SHA256.test(sha256) ||
    typeof path !== "string" ||
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").includes("..")
  )
    throw new Error("Historical artifact identity is invalid.");

  const currentPath = resolve(root, path);
  const difference = relative(root, currentPath);
  if (
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  )
    throw new Error("Historical artifact path escapes the repository.");
  const currentStat = lstatSync(currentPath);
  if (currentStat.isSymbolicLink() || !currentStat.isFile())
    throw new Error("Historical artifact current path is not a regular file.");

  const result = spawnSync("git", ["show", `${acceptedCommit}:${path}`], {
    cwd: root,
    encoding: "buffer",
  });
  if (result.status !== 0)
    throw new Error("Historical artifact Git object is unavailable.");
  const actual = createHash("sha256")
    .update(result.stdout)
    .digest("hex")
    .toUpperCase();
  if (actual !== sha256)
    throw new Error("Historical artifact Git object hash does not match.");
  return { acceptedCommit, path, sha256 };
}
