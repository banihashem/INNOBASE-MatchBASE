import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanFilesForCanaries } from "../packages/security/dist/index.js";
import { SOURCE_LANGUAGE_CANARIES } from "../config/source-language-canaries.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [
  "apps/web/.next",
  "apps/dashboard/dist",
  "packages/application/dist",
  "packages/auth/dist",
  "packages/data/dist",
  "packages/security/dist",
  "test-results",
  "evidence/slice1",
  "apps/dashboard/public/current-snapshot.json",
].map((path) => join(repositoryRoot, path));
let skippedSymlinks = 0;

async function collect(path, output) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    skippedSymlinks += 1;
    return;
  }
  if (metadata.isFile()) {
    output.push(path);
    return;
  }
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(path))
    await collect(join(path, entry), output);
}

const files = [];
for (const root of roots) await collect(root, files);
await scanFilesForCanaries({
  root: repositoryRoot,
  paths: files,
  canaries: SOURCE_LANGUAGE_CANARIES,
});
process.stdout.write(
  `Slice 1 runtime privacy scan PASS: ${files.length} regular artifacts, ${skippedSymlinks} symlinks not followed, ${SOURCE_LANGUAGE_CANARIES.length} canaries, 0 findings.\n`,
);
