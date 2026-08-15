import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateResearchRoutePolicy } from "../packages/ai-evidence/dist/src/research-route-policy.js";
import {
  validateSlice3Evidence,
  validateSlice3Governance,
} from "./lib/slice3-dashboard-policy.mjs";

const root = realpathSync(".");
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
const evidencePath = resolve(root, "evidence/slice3/local-validation.json");
const manifestPath = resolve(root, "evidence/slice3/candidate-manifest.json");
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
validateSlice3Evidence(evidence);
validateSlice3Governance(
  JSON.parse(readFileSync(resolve(root, "governance/gates.json"), "utf8"))
    .gates,
  evidence,
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const policy = JSON.parse(
  readFileSync(
    resolve(root, "config/slice3/research-route-policy.v1.json"),
    "utf8",
  ),
);
const register = JSON.parse(
  readFileSync(
    resolve(root, "config/slice3/provider-evidence-register.v1.json"),
    "utf8",
  ),
);
const expectedBlockerCodes = [
  "ROUTE_POLICY_NOT_ENABLED",
  "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
  "APPROVED_DIRECT_CREDENTIAL_ABSENT",
  "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
  "EXPLICIT_BILLABLE_QUALIFICATION_AUTHORIZATION_ABSENT",
  "QUALIFICATION_BUDGET_INVALID",
];
validateResearchRoutePolicy(policy);
if (
  policy.liveActivation !== "blocked" ||
  policy.routes.length !== 2 ||
  policy.routes.some((route) => route.enabled || route.liveQualified) ||
  policy.routes[0]?.path !== "gemini_direct" ||
  policy.routes[1]?.path !== "openrouter"
)
  throw new Error("Slice 3 blocked route policy is not closed and ordered.");
if (
  register.schemaVersion !== "provider-evidence-register.v1" ||
  register.sources?.length !== 7 ||
  register.sources.some(
    (source) =>
      !["google", "openrouter"].includes(source.authority) ||
      !source.url.startsWith("https://") ||
      !source.sourceId ||
      !Array.isArray(source.supports) ||
      source.supports.length === 0,
  ) ||
  register.externalMutations?.providerCalls !== 0 ||
  register.externalMutations?.credentialWrites !== 0 ||
  register.externalMutations?.billingMutations !== 0 ||
  register.externalMutations?.cloudMutations !== 0
)
  throw new Error("Slice 3 provider evidence register is invalid.");
if (
  evidence.schemaVersion !== 1 ||
  evidence.slice !== "SLICE-3" ||
  evidence.repositoryImplementation !== "PASS" ||
  evidence.liveQualification !== "BLOCKED_PREREQUISITE" ||
  evidence.environment?.providerNetworkCalls !== 0 ||
  evidence.qualificationPreflight?.disposition !== "BLOCKED_PREREQUISITE" ||
  evidence.qualificationPreflight?.providerCalls !== 0 ||
  evidence.qualificationPreflight?.credentialValuesInspected !== false ||
  evidence.qualificationPreflight?.externalMutations !== 0 ||
  JSON.stringify(evidence.blockerCodes) !==
    JSON.stringify(expectedBlockerCodes) ||
  JSON.stringify(evidence.qualificationPreflight?.blockers) !==
    JSON.stringify(expectedBlockerCodes) ||
  evidence.role2?.status !== "PENDING" ||
  evidence.role2?.acceptanceClaimed !== false
)
  throw new Error("Slice 3 lifecycle or external-state evidence is invalid.");
const expectedAcceptance = Array.from(
  { length: 24 },
  (_, index) => `S3-AC-${String(index + 1).padStart(3, "0")}`,
);
if (
  evidence.acceptance?.length !== 24 ||
  evidence.acceptance.some(
    (item, index) => item.id !== expectedAcceptance[index],
  ) ||
  evidence.acceptance.find((item) => item.id === "S3-AC-003")?.status !==
    "BLOCKED" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-003")?.gateId !==
    "S3-G3" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-019")?.status !==
    "BLOCKED" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-019")?.gateId !==
    "S3-G4" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-022")?.gateId !==
    "S3-G6" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-024")?.status !==
    "PENDING" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-024")?.gateId !==
    "S3-G7" ||
  evidence.acceptance.filter((item) => item.status === "REPOSITORY_PASS")
    .length !== 19 ||
  evidence.acceptance.filter((item) => item.status === "BLOCKED").length !==
    2 ||
  evidence.acceptance.filter((item) => item.status === "PENDING").length !== 3
)
  throw new Error("Slice 3 acceptance lifecycle is invalid.");
const exclusions = [
  "evidence/slice3/candidate-manifest.json",
  "evidence/slice3/local-validation.json",
  "apps/dashboard/public/current-snapshot.json",
  "apps/dashboard/dist/current-snapshot.json",
];
if (
  manifest.schemaVersion !== 1 ||
  manifest.baselineCommit !== "f1a5429505616a61cdac87cf7f57c114fa5e43a6" ||
  manifest.baselineTree !== "a01673ade6cc08c8648b52d8ac560d9ba385906f" ||
  manifest.algorithm !== "SHA256(PATH_NUL_SHA256_LF)" ||
  JSON.stringify(manifest.excludedSelfReferentialMutableArtifacts) !==
    JSON.stringify(exclusions) ||
  manifest.fileCount !== manifest.files?.length ||
  evidence.candidate?.manifestSha256 !== sha(manifestPath) ||
  evidence.candidate?.aggregateSha256 !== manifest.aggregateSha256 ||
  evidence.candidate?.fileCount !== manifest.fileCount
)
  throw new Error("Slice 3 candidate identity is invalid.");
const aggregate = createHash("sha256");
let prior = "";
for (const file of manifest.files) {
  const path = resolve(root, file.path);
  if (
    file.path <= prior ||
    exclusions.includes(file.path) ||
    !contained(path) ||
    lstatSync(path).isSymbolicLink() ||
    !lstatSync(path).isFile() ||
    !/^[A-F0-9]{64}$/u.test(file.sha256) ||
    sha(realpathSync(path)) !== file.sha256
  )
    throw new Error(`Slice 3 candidate file mismatch: ${file.path}`);
  prior = file.path;
  aggregate.update(`${file.path}\0${file.sha256}\n`, "utf8");
}
if (aggregate.digest("hex").toUpperCase() !== manifest.aggregateSha256)
  throw new Error("Slice 3 candidate aggregate mismatch.");
for (const artifact of evidence.artifacts ?? []) {
  const path = resolve(root, artifact.path);
  if (
    !contained(path) ||
    lstatSync(path).isSymbolicLink() ||
    sha(path) !== artifact.sha256
  )
    throw new Error(`Slice 3 artifact mismatch: ${artifact.path}`);
}
console.log(
  `slice3: PASS repository implementation (${manifest.fileCount} files; live qualification BLOCKED_PREREQUISITE; Role2 PENDING)`,
);
