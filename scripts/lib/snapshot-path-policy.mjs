import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const SNAPSHOT_CONFIG_PATH = resolve(
  REPOSITORY_ROOT,
  "packages/artifact-indexer/config.example.json",
);
export const SNAPSHOT_OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  "apps/dashboard/public/current-snapshot.json",
);
export const SNAPSHOT_DIST_OUTPUT_PATH = resolve(
  REPOSITORY_ROOT,
  "apps/dashboard/dist/current-snapshot.json",
);
export const TRUSTED_ROOTS = new Map([
  ["authoritative", "C:\\INNOBASE\\MatchBASE\\00_Authoritative_Sources"],
  ["product-management", "C:\\INNOBASE\\MatchBASE\\01_Product_Management"],
  ["planning", "C:\\INNOBASE\\MatchBASE\\02_Product_Research_and_Planning"],
  [
    "implementation-governance",
    "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\governance",
  ],
]);

export function validateGeneratorConfig(config) {
  if (
    !config ||
    !Array.isArray(config.roots) ||
    config.roots.length !== TRUSTED_ROOTS.size
  ) {
    throw new Error(
      "Snapshot configuration must contain exactly the trusted roots.",
    );
  }
  const observed = new Map(
    config.roots.map((root) => [root.id, resolve(root.absolutePath)]),
  );
  for (const [id, expectedPath] of TRUSTED_ROOTS) {
    const actual = observed.get(id);
    if (
      !actual ||
      actual.toLowerCase() !== resolve(expectedPath).toLowerCase()
    ) {
      throw new Error(`Snapshot root is not trusted: ${id}`);
    }
  }
}

export async function assertSafeOutputPath(
  candidate,
  expected = SNAPSHOT_OUTPUT_PATH,
) {
  if (resolve(candidate).toLowerCase() !== resolve(expected).toLowerCase()) {
    throw new Error("Snapshot output is outside the fixed local target.");
  }
  try {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Snapshot output must be a regular file or absent.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function assertSafeSnapshotOutput() {
  await assertSafeOutputPath(SNAPSHOT_OUTPUT_PATH);
  await assertSafeOutputPath(
    SNAPSHOT_DIST_OUTPUT_PATH,
    SNAPSHOT_DIST_OUTPUT_PATH,
  );
}
