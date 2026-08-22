import { lstat, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

export const V5_CANONICAL_REPOSITORY_ROOT =
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE";
export const V5_CANONICAL_MANAGEMENT_ROOT =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
export const V5_CANONICAL_SIGNING_ROOT =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing";

export async function assertCanonicalV5DirectoryIdentity(
  path,
  expectedPath,
  label,
) {
  const item = await lstat(path);
  if (
    !item.isDirectory() ||
    item.isSymbolicLink() ||
    (await realpath(path)) !== path ||
    resolve(path) !== path ||
    path !== expectedPath
  )
    throw new Error(`V5 ${label} is not a canonical directory.`);
  return path;
}

export async function assertCanonicalV5Workspace() {
  await assertCanonicalV5DirectoryIdentity(
    V5_CANONICAL_REPOSITORY_ROOT,
    V5_CANONICAL_REPOSITORY_ROOT,
    "repository root",
  );
  if (resolve(".") !== V5_CANONICAL_REPOSITORY_ROOT)
    throw new Error("V5 execution cwd is not the canonical repository root.");
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: V5_CANONICAL_REPOSITORY_ROOT,
    encoding: "utf8",
  });
  if (
    top.status !== 0 ||
    resolve(top.stdout.trim()) !== V5_CANONICAL_REPOSITORY_ROOT
  )
    throw new Error("V5 Git top-level is not the canonical repository root.");
  return V5_CANONICAL_REPOSITORY_ROOT;
}

export async function assertCanonicalV5ManagementRoot() {
  return assertCanonicalV5DirectoryIdentity(
    V5_CANONICAL_MANAGEMENT_ROOT,
    V5_CANONICAL_MANAGEMENT_ROOT,
    "PM root",
  );
}

export async function assertCanonicalV5SigningRoot() {
  await assertCanonicalV5ManagementRoot();
  if (dirname(V5_CANONICAL_SIGNING_ROOT) !== V5_CANONICAL_MANAGEMENT_ROOT)
    throw new Error("V5 signing root is outside the canonical PM root.");
  return assertCanonicalV5DirectoryIdentity(
    V5_CANONICAL_SIGNING_ROOT,
    V5_CANONICAL_SIGNING_ROOT,
    "signing root",
  );
}
