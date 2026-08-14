import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const root = realpathSync(".");
const evidencePath = resolve(root, "evidence/slice1/local-validation.json");
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const expectedIds = Array.from(
  { length: 22 },
  (_, index) => `S1-AC-${String(index + 1).padStart(3, "0")}`,
);

if (evidence.schemaVersion !== 1 || evidence.slice !== "SLICE-1")
  throw new Error("Slice 1 evidence schema is invalid.");
if (!Array.isArray(evidence.acceptance) || evidence.acceptance.length !== 22)
  throw new Error("Slice 1 must contain exactly 22 acceptance records.");
if (evidence.acceptance.some((item, index) => item.id !== expectedIds[index]))
  throw new Error(
    "Slice 1 acceptance IDs are missing, duplicated, or unordered.",
  );

const artifacts = new Map();
for (const artifact of evidence.artifacts ?? []) {
  if (
    typeof artifact.id !== "string" ||
    artifacts.has(artifact.id) ||
    typeof artifact.path !== "string" ||
    isAbsolute(artifact.path) ||
    artifact.path.includes("\\") ||
    artifact.path.split("/").includes("..") ||
    !/^[A-F0-9]{64}$/u.test(artifact.sha256)
  )
    throw new Error("Slice 1 artifact reference is invalid.");
  const path = resolve(root, artifact.path);
  const difference = relative(root, path);
  if (
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  )
    throw new Error(`Slice 1 artifact escapes repository: ${artifact.path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`Slice 1 artifact is not a regular file: ${artifact.path}`);
  const actual = createHash("sha256")
    .update(readFileSync(realpathSync(path)))
    .digest("hex")
    .toUpperCase();
  if (actual !== artifact.sha256)
    throw new Error(`Slice 1 artifact hash mismatch: ${artifact.path}`);
  artifacts.set(artifact.id, artifact);
}

for (const item of evidence.acceptance) {
  if (!new Set(["PASS", "PENDING", "BLOCKED", "FAIL"]).has(item.status))
    throw new Error(`${item.id} has an invalid status.`);
  if (typeof item.command !== "string" || !item.command.trim())
    throw new Error(`${item.id} lacks an executable method.`);
  if (!Array.isArray(item.artifactIds) || item.artifactIds.length === 0)
    throw new Error(`${item.id} lacks artifact evidence.`);
  if (item.artifactIds.some((id) => !artifacts.has(id)))
    throw new Error(`${item.id} references an unknown artifact.`);
}

const counts = evidence.rootGate?.testCounts;
if (
  evidence.rootGate?.status !== "PASS" ||
  counts?.failed !== 0 ||
  counts?.skipped !== 0 ||
  evidence.environment?.externalMutations !== 0 ||
  evidence.environment?.providerNetworkCalls !== 0 ||
  evidence.environment?.liveOauthCalls !== 0
)
  throw new Error("Slice 1 local gate or prohibited-mutation evidence failed.");

console.log(
  `slice1 evidence: PASS (${evidence.acceptance.length} criteria; ${artifacts.size} exact artifacts)`,
);
