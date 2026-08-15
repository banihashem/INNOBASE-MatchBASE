import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  mergeSlice2ChangedPaths,
  validateSlice2AuditBindings,
  validateSlice2PredecessorParity,
} from "./lib/slice2-audit-policy.mjs";
import { verifyHistoricalArtifact } from "./lib/historical-artifact-policy.mjs";

const root = realpathSync(".");
const acceptedSlice2Commit = "f1a5429505616a61cdac87cf7f57c114fa5e43a6";
const sha = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const contained = (path) => {
  const difference = relative(root, path);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
};
const evidence = JSON.parse(
  readFileSync(resolve(root, "evidence/slice2/local-validation.json"), "utf8"),
);
const manifestPath = resolve(root, "evidence/slice2/candidate-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const closureAnchor = JSON.parse(
  readFileSync(
    resolve(root, "governance/slice2-external-closure-anchor-v1.json"),
    "utf8",
  ),
);
const expected = Array.from(
  { length: 34 },
  (_, index) => `S2-AC-${String(index + 1).padStart(3, "0")}`,
);

if (
  evidence.schemaVersion !== 1 ||
  evidence.slice !== "SLICE-2" ||
  evidence.role2?.status !== "PENDING"
)
  throw new Error("Slice 2 evidence identity or Role 2 state is invalid.");
if (
  !Array.isArray(evidence.acceptance) ||
  evidence.acceptance.length !== 34 ||
  evidence.acceptance.some((item, index) => item.id !== expected[index])
)
  throw new Error(
    "Slice 2 acceptance records must be exact, complete, unique, and ordered.",
  );
if (
  evidence.acceptance.some(
    (item) =>
      !["PASS", "PENDING", "BLOCKED", "FAIL"].includes(item.status) ||
      !item.command?.trim() ||
      !item.gateId?.trim() ||
      !Array.isArray(item.artifactIds) ||
      item.artifactIds.length === 0,
  )
)
  throw new Error("Slice 2 acceptance record is incomplete.");
if (
  evidence.acceptance.find((item) => item.id === "S2-AC-033")?.status !==
  "PENDING"
)
  throw new Error("Uncommitted hosted closure cannot pass.");
if (
  evidence.externalState?.liveProviders !== "NOT_STARTED" ||
  evidence.externalState?.liveOauth !== "BLOCKED" ||
  evidence.externalState?.gcp !== "BLOCKED" ||
  evidence.externalState?.cloudflare !== "BLOCKED" ||
  evidence.externalState?.deployment !== "NOT_STARTED"
)
  throw new Error("External Slice 2 state is not fail-closed.");
if (
  evidence.environment?.externalMutations !== 0 ||
  evidence.environment?.providerNetworkCalls !== 0 ||
  evidence.environment?.liveOauthCalls !== 0
)
  throw new Error("Prohibited external activity was claimed.");
validateSlice2PredecessorParity(
  evidence.hostedPredecessors,
  closureAnchor.predecessors,
);

const artifacts = new Map();
for (const artifact of evidence.artifacts ?? []) {
  if (
    !artifact.id ||
    artifacts.has(artifact.id) ||
    typeof artifact.path !== "string" ||
    isAbsolute(artifact.path) ||
    artifact.path.includes("\\") ||
    artifact.path.split("/").includes("..") ||
    !/^[A-F0-9]{64}$/u.test(artifact.sha256 ?? "")
  )
    throw new Error("Slice 2 artifact reference is invalid.");
  const path = resolve(root, artifact.path);
  if (
    !contained(path) ||
    lstatSync(path).isSymbolicLink() ||
    !lstatSync(path).isFile()
  )
    throw new Error(`Slice 2 artifact hash mismatch: ${artifact.path}`);
  verifyHistoricalArtifact({
    repoRoot: root,
    acceptedCommit: acceptedSlice2Commit,
    path: artifact.path,
    sha256: artifact.sha256,
  });
  artifacts.set(artifact.id, artifact);
}
for (const item of evidence.acceptance)
  if (item.artifactIds.some((id) => !artifacts.has(id)))
    throw new Error(`${item.id} references unknown evidence.`);

const requiredCounts = {
  applicationPostgresql: 8,
  webPostgresql: 28,
  aiEvidence: 44,
  browserChrome: 2,
  slice1Criteria: 22,
  slice1Artifacts: 60,
  failed: 0,
  skipped: 0,
};
for (const [key, value] of Object.entries(requiredCounts))
  if (evidence.localGate?.testCounts?.[key] !== value)
    throw new Error(`Slice 2 test count mismatch: ${key}`);
if (!["PASS", "PENDING"].includes(evidence.localGate?.status))
  throw new Error("Slice 2 local gate lifecycle is invalid.");
validateSlice2AuditBindings(
  evidence.independentAudits,
  sha(manifestPath),
  manifest.aggregateSha256,
);

const exclusions = [
  "evidence/slice2/candidate-manifest.json",
  "evidence/slice2/local-validation.json",
  "governance/agents.json",
  "governance/artifact-index.json",
];
if (
  manifest.schemaVersion !== 1 ||
  manifest.candidateId !== "PO-001-SLICE-2-LOCAL-CANDIDATE" ||
  manifest.baselineCommit !== "832fa68244eefa0dae4c079b9b94ecaea4b6a872" ||
  manifest.algorithm !== "SHA256(PATH_NUL_SHA256_LF)" ||
  JSON.stringify(manifest.excludedSelfReferentialMutableArtifacts) !==
    JSON.stringify(exclusions) ||
  manifest.fileCount !== manifest.files?.length
)
  throw new Error("Slice 2 candidate manifest schema is invalid.");
let aggregate = createHash("sha256");
let prior = "";
for (const entry of manifest.files) {
  if (
    entry.path <= prior ||
    exclusions.includes(entry.path) ||
    !/^[A-F0-9]{64}$/u.test(entry.sha256 ?? "")
  )
    throw new Error(
      "Slice 2 candidate paths are not strictly ordered or contain an invalid exclusion.",
    );
  prior = entry.path;
  const path = resolve(root, entry.path);
  if (
    !contained(path) ||
    lstatSync(path).isSymbolicLink() ||
    !lstatSync(path).isFile()
  )
    throw new Error(`Slice 2 candidate hash mismatch: ${entry.path}`);
  verifyHistoricalArtifact({
    repoRoot: root,
    acceptedCommit: acceptedSlice2Commit,
    path: entry.path,
    sha256: entry.sha256,
  });
  aggregate.update(`${entry.path}\0${entry.sha256}\n`, "utf8");
}
if (aggregate.digest("hex").toUpperCase() !== manifest.aggregateSha256)
  throw new Error("Slice 2 candidate aggregate mismatch.");

const gitPaths = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "buffer" });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
};
const ancestry = spawnSync(
  "git",
  [
    "merge-base",
    "--is-ancestor",
    manifest.baselineCommit,
    acceptedSlice2Commit,
  ],
  { cwd: root, encoding: "buffer" },
);
if (ancestry.status !== 0)
  throw new Error("Slice 2 baseline is not an ancestor of HEAD.");
const actualChanged = mergeSlice2ChangedPaths({
  committedPaths: gitPaths([
    "diff",
    "--name-only",
    "-z",
    manifest.baselineCommit,
    acceptedSlice2Commit,
  ]),
  workingPaths: [],
  untrackedPaths: [],
});
const expectedChanged = [
  ...manifest.files.map((entry) => entry.path),
  ...exclusions,
].sort();
if (JSON.stringify(actualChanged) !== JSON.stringify(expectedChanged))
  throw new Error("Slice 2 candidate changed-set reconciliation failed.");

console.log(
  `slice2 evidence: PASS (${evidence.acceptance.length} criteria; ${artifacts.size} exact artifacts; ${manifest.fileCount} frozen candidate files; Role 2 PENDING)`,
);
