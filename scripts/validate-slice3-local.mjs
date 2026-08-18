import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateResearchRoutePolicy } from "../packages/ai-evidence/dist/src/research-route-policy.js";
import {
  validateSlice3Evidence,
  validateSlice3Governance,
  verifySlice3CredentialPreflightSource,
} from "./lib/slice3-dashboard-policy.mjs";
import { validateSlice3WrapperResult } from "./lib/slice3-wrapper-result-policy.mjs";

const root = realpathSync(".");
const sha = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const containedWithin = (parent, path) => {
  const difference = relative(parent, path);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
};
const contained = (path) => containedWithin(root, path);
const evidencePath = resolve(root, "evidence/slice3/local-validation.json");
const manifestPath = resolve(root, "evidence/slice3/candidate-manifest.json");
const wrapperResultPath = resolve(
  root,
  "evidence/slice3/full-wrapper-result.json",
);
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const wrapperResult = JSON.parse(readFileSync(wrapperResultPath, "utf8"));
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
const expectedBlockerCodes = ["BLOCKED_CREDENTIAL"];
validateResearchRoutePolicy(policy);
if (
  policy.liveActivation !== "blocked" ||
  policy.routes.length !== 2 ||
  policy.routes.some((route) => route.enabled || route.liveQualified) ||
  policy.routes[0]?.path !== "gemini_direct" ||
  policy.routes[1]?.path !== "openrouter"
)
  throw new Error("Slice 3 blocked route policy is not closed and ordered.");
const expectedProviderSources = [
  "GOOGLE-GEMINI-3.6-SAMPLING-COMPATIBILITY",
  "GOOGLE-GEMINI-MODEL-3.6-FLASH",
  "GOOGLE-GEMINI-PAID-DATA-HANDLING",
  "GOOGLE-GEMINI-PRICING",
  "OPENROUTER-GEMINI-3.6-FLASH",
  "OPENROUTER-PROVIDER-ROUTING",
  "OPENROUTER-ZDR",
  "OPENROUTER-SOVEREIGN-AI",
  "OPENROUTER-USAGE-ACCOUNTING",
];
if (
  register.schemaVersion !== "provider-evidence-register.v1" ||
  register.registerVersion !==
    "slice3-provider-evidence.2026-08-16.d001-d003" ||
  register.accessedAt !== "2026-08-16T00:00:00.000Z" ||
  register.expiresAt !== "2026-08-23T00:00:00.000Z" ||
  JSON.stringify(register.sources?.map(({ sourceId }) => sourceId)) !==
    JSON.stringify(expectedProviderSources) ||
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
  evidence.schemaVersion !== 2 ||
  evidence.slice !== "SLICE-3" ||
  evidence.repositoryImplementation !== "PASS" ||
  evidence.liveQualification !== "BLOCKED_PREREQUISITE" ||
  evidence.environment?.providerNetworkCalls !== 0 ||
  evidence.qualificationPreflight?.schemaVersion !==
    "slice3-live-qualification-preflight.v4-safe-blocked" ||
  evidence.qualificationPreflight?.disposition !== "BLOCKED_CREDENTIAL" ||
  evidence.qualificationPreflight?.sourceBinding?.path !==
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json" ||
  evidence.qualificationPreflight?.sourceBinding?.verificationMode !==
    "EXACT_LOCAL_SHA256_OR_ANCHOR_ONLY_CI" ||
  evidence.qualificationPreflight?.sourceBinding?.sha256 !==
    "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08" ||
  evidence.qualificationPreflight?.sourceBinding?.httpStatus !== 401 ||
  evidence.qualificationPreflight?.sourceBinding?.sanitizedEnvelopeDigest !==
    "8CF8991C0372D72CEB99F18D9187DA4FB55E022D9BE264F02DB9BB0BB6EBF508" ||
  evidence.qualificationPreflight?.providerCalls !== 0 ||
  evidence.qualificationPreflight?.credentialValuesInspected !== false ||
  evidence.qualificationPreflight?.additionalAuthorizationGets !== 0 ||
  evidence.qualificationPreflight?.v4SessionCreated !== false ||
  evidence.qualificationPreflight?.externalMutations !== 0 ||
  evidence.localGate?.status !== evidence.localGate?.fullWrapper?.result ||
  JSON.stringify(evidence.blockerCodes) !==
    JSON.stringify(expectedBlockerCodes) ||
  JSON.stringify(evidence.qualificationPreflight?.blockers) !==
    JSON.stringify(expectedBlockerCodes) ||
  evidence.role2?.status !== "FAIL" ||
  evidence.role2?.acceptanceClaimed !== false ||
  JSON.stringify(evidence.role2?.defects) !==
    JSON.stringify(
      ["D001", "D002", "D003", "D004"].map((id) => ({
        id,
        status: "CORRECTED_PENDING_ROLE2",
      })),
    )
)
  throw new Error("Slice 3 lifecycle or external-state evidence is invalid.");
verifySlice3CredentialPreflightSource(
  evidence.qualificationPreflight.sourceBinding,
  {
    anchorOnly:
      process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI",
  },
);
const expectedAcceptance = Array.from(
  { length: 24 },
  (_, index) => `S3-AC-${String(index + 1).padStart(3, "0")}`,
);
const postReviewCurrent = evidence.lifecyclePhase === "POST_REVIEW_CURRENT";
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
  evidence.acceptance.find((item) => item.id === "S3-AC-022")?.status !==
    (postReviewCurrent ? "REPOSITORY_PASS" : "PENDING") ||
  evidence.acceptance.find((item) => item.id === "S3-AC-023")?.status !==
    "PENDING" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-024")?.status !==
    "PENDING" ||
  evidence.acceptance.find((item) => item.id === "S3-AC-024")?.gateId !==
    "S3-G7" ||
  evidence.acceptance.filter((item) => item.status === "REPOSITORY_PASS")
    .length !== (postReviewCurrent ? 20 : 19) ||
  evidence.acceptance.filter((item) => item.status === "BLOCKED").length !==
    2 ||
  evidence.acceptance.filter((item) => item.status === "PENDING").length !==
    (postReviewCurrent ? 2 : 3)
)
  throw new Error("Slice 3 acceptance lifecycle is invalid.");
const exclusions = [
  "evidence/slice3/candidate-manifest.json",
  "evidence/slice3/local-validation.json",
  "evidence/slice3/full-wrapper-result.json",
  "apps/dashboard/public/current-snapshot.json",
  "apps/dashboard/dist/current-snapshot.json",
];
if (
  manifest.schemaVersion !== 1 ||
  manifest.baselineCommit !== "b992d371c467c3e185cc07bb5ac08fb8f38bf864" ||
  manifest.baselineTree !== "4d29c6cf1e2b044a9b6838c8ef5bf0cbc1010019" ||
  manifest.algorithm !== "SHA256(PATH_NUL_SHA256_LF)" ||
  JSON.stringify(manifest.excludedSelfReferentialMutableArtifacts) !==
    JSON.stringify(exclusions) ||
  manifest.fileCount !== manifest.files?.length ||
  evidence.candidate?.manifestSha256 !== sha(manifestPath) ||
  evidence.candidate?.aggregateSha256 !== manifest.aggregateSha256 ||
  evidence.candidate?.fileCount !== manifest.fileCount
)
  throw new Error("Slice 3 candidate identity is invalid.");
validateSlice3WrapperResult(wrapperResult, evidence, sha(wrapperResultPath));
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
  `slice3: PASS repository implementation (${manifest.fileCount} files; live qualification BLOCKED_PREREQUISITE; Role2 FAIL with D001-D004 CORRECTED_PENDING_ROLE2)`,
);
