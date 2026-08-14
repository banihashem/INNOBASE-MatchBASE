import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep, win32 } from "node:path";

const baseline = JSON.parse(
  await readFile(
    new URL("../evidence/slice1/protected-baseline.json", import.meta.url),
    "utf8",
  ),
);
const anchorOnly =
  process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI";
if (anchorOnly && process.env.CI !== "true")
  throw new Error("Protected anchor-only mode is restricted to CI=true.");

function validSha(value) {
  return typeof value === "string" && /^[A-F0-9]{64}$/u.test(value);
}

async function inventory(root, excludedFiles = []) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw new Error(`Protected source symlink refused: ${path}`);
      if (metadata.isDirectory()) await walk(path);
      else if (metadata.isFile() && !excludedFiles.includes(basename(path)))
        files.push(path);
    }
  }
  await walk(root);
  files.sort((left, right) =>
    relative(root, left)
      .replaceAll(sep, "/")
      .localeCompare(relative(root, right).replaceAll(sep, "/"), "en"),
  );
  const aggregate = createHash("sha256");
  for (const path of files) {
    const relativePath = relative(root, path).replaceAll(sep, "/");
    const sha = createHash("sha256")
      .update(await readFile(path))
      .digest("hex")
      .toUpperCase();
    aggregate.update(`${relativePath}\0${sha}\n`);
  }
  return { count: files.length, sha: aggregate.digest("hex").toUpperCase() };
}

for (const root of baseline.roots) {
  if (
    !["authoritative", "planning", "managementHistory"].includes(root.id) ||
    !win32.isAbsolute(root.path) ||
    !Number.isInteger(root.fileCount) ||
    root.fileCount < 1 ||
    !validSha(root.aggregateSha256)
  )
    throw new Error("Protected baseline anchor is invalid.");
  if (!anchorOnly) {
    const actual = await inventory(root.path, root.excludedFiles ?? []);
    if (actual.count !== root.fileCount || actual.sha !== root.aggregateSha256)
      throw new Error(`Protected baseline mismatch: ${root.id}`);
  }
}

const log = baseline.appendOnlyLog;
if (
  !win32.isAbsolute(log.path) ||
  !Number.isInteger(log.prefixBytes) ||
  !validSha(log.prefixSha256)
)
  throw new Error("Append-only log anchor is invalid.");
if (!anchorOnly) {
  const handle = await open(log.path, "r");
  try {
    const buffer = Buffer.alloc(log.prefixBytes);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== buffer.length)
      throw new Error("Append-only log is shorter than its protected prefix.");
    const sha = createHash("sha256").update(buffer).digest("hex").toUpperCase();
    if (sha !== log.prefixSha256)
      throw new Error("Append-only log prefix mismatch.");
  } finally {
    await handle.close();
  }
}
process.stdout.write(
  `protected baseline: PASS (${anchorOnly ? "ANCHOR_ONLY_CI" : "EXACT_LOCAL_SHA256"}; 14 authoritative, 67 planning, 36 management-history files)\n`,
);
