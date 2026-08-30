import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = resolve(".");
const outputPath = "evidence/p4/candidate-manifest.json";
const baselineCommit = "bfe1e64b903599f0b11b2168ee8119cb4d299d87";
const baselineTree = "cd0667b8554c1efd98aeea5ed9d8be488b486009";
const exactExclusions = Object.freeze([
  "-",
  "APIKeys.md",
  outputPath,
  "evidence/p4/local-validation.json",
  "evidence/p4/zero-defect-audit.json",
  "governance/agents.json",
  "governance/artifact-index.json",
  "apps/dashboard/public/current-snapshot.json",
  "apps/dashboard/dist/current-snapshot.json",
  "scripts/lib/slice3-s4-windows-durable-publication-contract.mjs",
]);

function gitPaths(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "buffer" });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
}

function gitText(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

if (gitText(["rev-parse", "HEAD"]) !== baselineCommit)
  throw new Error("P4 candidate generation requires the pinned baseline HEAD.");
if (gitText(["rev-parse", "HEAD^{tree}"]) !== baselineTree)
  throw new Error("P4 candidate generation requires the pinned baseline tree.");

const excluded = (path) =>
  exactExclusions.includes(path) || path === "tmp" || path.startsWith("tmp/");
const paths = [
  ...new Set([
    ...gitPaths(["diff", "--name-only", "-z", "HEAD"]),
    ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]),
]
  .filter((path) => !excluded(path))
  .sort((left, right) => left.localeCompare(right, "en"));

function fileSha256(path) {
  return createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")
    .toUpperCase();
}

const files = paths.map((path) => {
  const stat = lstatSync(resolve(root, path));
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Candidate path is not a regular file: ${path}`);
  return Object.freeze({ path, sha256: fileSha256(path) });
});
const aggregate = createHash("sha256");
for (const entry of files)
  aggregate.update(`${entry.path}\0${entry.sha256}\n`, "utf8");

const manifest = Object.freeze({
  schemaVersion: 1,
  candidateId: "MB-P4-RC-STAGING-2026-08-30",
  baselineCommit,
  baselineTree,
  algorithm: "SHA256(PATH_NUL_SHA256_LF)",
  excludedSelfReferentialMutableArtifacts: [...exactExclusions, "tmp/"],
  fileCount: files.length,
  aggregateSha256: aggregate.digest("hex").toUpperCase(),
  files,
});
const absoluteOutput = resolve(root, outputPath);
mkdirSync(dirname(absoluteOutput), { recursive: true });
writeFileSync(absoluteOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(
  `P4 candidate: ${manifest.fileCount} files; ${manifest.aggregateSha256}\n`,
);
