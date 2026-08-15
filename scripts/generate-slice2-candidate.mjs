import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const exclusions = [
  "evidence/slice2/candidate-manifest.json",
  "evidence/slice2/local-validation.json",
  "governance/agents.json",
  "governance/artifact-index.json",
];
const gitPaths = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "buffer" });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
};
const paths = [
  ...new Set([
    ...gitPaths(["diff", "--name-only", "-z", "HEAD"]),
    ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]),
]
  .filter((path) => !exclusions.includes(path))
  .sort();
const sha = (path) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")
    .toUpperCase();
const files = paths.map((path) => {
  const stat = lstatSync(resolve(root, path));
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Candidate path is not a regular file: ${path}`);
  return { path, sha256: sha(path) };
});
const aggregate = createHash("sha256");
for (const entry of files)
  aggregate.update(`${entry.path}\0${entry.sha256}\n`, "utf8");
const manifest = {
  schemaVersion: 1,
  candidateId: "PO-001-SLICE-2-LOCAL-CANDIDATE",
  baselineCommit: "832fa68244eefa0dae4c079b9b94ecaea4b6a872",
  algorithm: "SHA256(PATH_NUL_SHA256_LF)",
  excludedSelfReferentialMutableArtifacts: exclusions,
  fileCount: files.length,
  aggregateSha256: aggregate.digest("hex").toUpperCase(),
  files,
};
writeFileSync(
  resolve(root, exclusions[0]),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(
  `slice2 candidate: ${files.length} files; ${manifest.aggregateSha256}`,
);
