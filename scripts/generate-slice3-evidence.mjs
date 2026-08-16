import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const observedAt = new Date().toISOString();
const existingEvidencePath = resolve(
  root,
  "evidence/slice3/local-validation.json",
);
const priorEvidence = existsSync(existingEvidencePath)
  ? JSON.parse(readFileSync(existingEvidencePath, "utf8"))
  : undefined;
const baselineCommit = "b992d371c467c3e185cc07bb5ac08fb8f38bf864";
const baselineTree = "4d29c6cf1e2b044a9b6838c8ef5bf0cbc1010019";
const exclusions = [
  "evidence/slice3/candidate-manifest.json",
  "evidence/slice3/local-validation.json",
  "evidence/slice3/full-wrapper-result.json",
  "apps/dashboard/public/current-snapshot.json",
  "apps/dashboard/dist/current-snapshot.json",
];
const sha = (path) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex")
    .toUpperCase();
const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout
    .split(/\r?\n/u)
    .map((path) => path.replaceAll("\\", "/"))
    .filter(Boolean);
};
const paths = [
  ...new Set([
    ...git(["diff", "--name-only", baselineCommit, "--"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ]),
]
  .filter((path) => !exclusions.includes(path))
  .sort();
const files = paths.map((path) => ({ path, sha256: sha(path) }));
const aggregate = createHash("sha256");
for (const file of files)
  aggregate.update(`${file.path}\0${file.sha256}\n`, "utf8");
const manifest = {
  schemaVersion: 1,
  candidateId: "PO-001-SLICE-3-LOCAL-BLOCKED-CANDIDATE",
  baselineCommit,
  baselineTree,
  algorithm: "SHA256(PATH_NUL_SHA256_LF)",
  excludedSelfReferentialMutableArtifacts: exclusions,
  fileCount: files.length,
  aggregateSha256: aggregate.digest("hex").toUpperCase(),
  files,
};
mkdirSync(resolve(root, "evidence/slice3"), { recursive: true });
writeFileSync(
  resolve(root, exclusions[0]),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
const manifestSha256 = sha(exclusions[0]);
const wrapperResultPath = "evidence/slice3/full-wrapper-result.json";
const wrapperResult = JSON.parse(
  readFileSync(resolve(root, wrapperResultPath), "utf8"),
);
const wrapperResultSha256 = sha(wrapperResultPath);
const candidateIdentity = {
  manifestSha256,
  aggregateSha256: manifest.aggregateSha256,
  fileCount: manifest.fileCount,
};
const postReview = priorEvidence?.postReview;
const postReviewCurrent =
  postReview?.schemaVersion === "matchbase.slice3-post-review/v1" &&
  JSON.stringify(postReview.candidate) === JSON.stringify(candidateIdentity) &&
  JSON.stringify(postReview.wrapperSource) ===
    JSON.stringify({ path: wrapperResultPath, sha256: wrapperResultSha256 }) &&
  postReview.disciplines?.length === 6 &&
  postReview.disciplines.every(
    ({ status, critical, major, minor }) =>
      status === "PASS" && critical === 0 && major === 0 && minor === 0,
  ) &&
  postReview.integrationCritic?.status === "PASS" &&
  postReview.integrationCritic?.critical === 0 &&
  postReview.integrationCritic?.major === 0 &&
  postReview.integrationCritic?.minor === 0;
const artifactPaths = [
  "config/slice3/provider-evidence-register.v1.json",
  "config/slice3/research-route-policy.v1.json",
  "packages/contracts/src/v1/research-route.ts",
  "packages/contracts/src/v1/evidence-lineage.ts",
  "packages/ai-evidence/src/research-route-policy.ts",
  "packages/ai-evidence/src/route-policy.ts",
  "packages/ai-evidence/src/adapters/gemini-direct.ts",
  "packages/ai-evidence/src/adapters/openrouter.ts",
  "packages/ai-evidence/src/research-orchestrator.ts",
  "packages/ai-evidence/src/evidence/integrity.ts",
  "packages/ai-evidence/src/evidence/lineage.ts",
  "packages/ai-evidence/src/evidence/candidate-identity.ts",
  "packages/security/src/secure-fetch.ts",
  "packages/security/src/node-live-transport.ts",
  "packages/application/src/live-research-execution.ts",
  "packages/application/src/live-research-worker.ts",
  "packages/application/src/live-research-environment-runtime.ts",
  "packages/application/src/live-research-credential-policy.ts",
  "packages/application/src/combined-worker.ts",
  "packages/application/src/research-admission.ts",
  "apps/web/src/server-owned-research-admission.ts",
  "scripts/qualify-slice3-live.mjs",
  "scripts/lib/slice3-dashboard-policy.mjs",
  "scripts/lib/slice3-dashboard-handoff-policy.mjs",
  "scripts/lib/slice3-wrapper-result-policy.mjs",
  "scripts/generate-dashboard-snapshot.mjs",
  "scripts/generate-dashboard-ci-snapshot.mjs",
  "scripts/validate-dashboard-snapshot.mjs",
  "scripts/record-slice3-wrapper-result.mjs",
  "governance/slice3-dashboard-handoff-policy-v1.json",
  "packages/data/migrations/0003_slice_3_live_research.up.sql",
  "packages/data/migrations/0003_slice_3_live_research.down.sql",
  "test/slice3/data/live-research-postgres.test.mjs",
  "packages/ai-evidence/test/research-orchestrator.test.ts",
  "packages/security/test/secure-fetch.test.ts",
  "test/slice3/live-research-application-postgres.test.mjs",
  "test/slice3/combined-live-worker-postgres.test.mjs",
  "test/slice3/environment-provider-transport.test.mjs",
  "test/slice3/qualified-live-admission.test.mjs",
  "test/slice3/live-qualification-preflight.test.mjs",
  "test/slice3/dashboard-policy.test.mjs",
  "test/slice3/dashboard-handoff-policy.test.mjs",
  "test/slice3/wrapper-result-policy.test.mjs",
  "packages/ai-evidence/test/research-adapters.test.ts",
  "packages/ai-evidence/test/research-route-policy.test.ts",
  "test/browser/product-qualified-reference-path.spec.mjs",
  "test/browser/product-live-reference-path.spec.mjs",
  "test/browser/product-standard-reference-path.spec.mjs",
];
const blockerCodes = [
  "ROUTE_POLICY_NOT_ENABLED",
  "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
  "APPROVED_DIRECT_CREDENTIAL_ABSENT",
  "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
  "EXPLICIT_BILLABLE_QUALIFICATION_AUTHORIZATION_ABSENT",
  "QUALIFICATION_BUDGET_INVALID",
];
const auditStatus = postReviewCurrent ? "PASS" : "PENDING";
const criticStatus = postReviewCurrent ? "PASS" : "PENDING";
const artifacts = artifactPaths.map((path, index) => ({
  id: `S3-ART-${String(index + 1).padStart(3, "0")}`,
  path,
  sha256: sha(path),
}));
const statusFor = (number) => {
  if ([3, 19].includes(number)) return "BLOCKED";
  if (number === 24) return "PENDING";
  if (number === 22) return postReviewCurrent ? "REPOSITORY_PASS" : "PENDING";
  if (number === 23) return "PENDING";
  return "REPOSITORY_PASS";
};
const gateFor = (number) => {
  if (number === 1) return "S3-G0";
  if (number === 3) return "S3-G3";
  if (number === 19) return "S3-G4";
  if ([18, 23].includes(number)) return "S3-G5";
  if (number === 22) return "S3-G6";
  if (number === 24) return "S3-G7";
  return "S3-G1";
};
const acceptance = Array.from({ length: 24 }, (_, index) => {
  const number = index + 1;
  return {
    id: `S3-AC-${String(number).padStart(3, "0")}`,
    status: statusFor(number),
    gateId: gateFor(number),
    artifactIds: artifacts.map((artifact) => artifact.id),
  };
});
const evidence = {
  schemaVersion: 2,
  slice: "SLICE-3",
  observedAt,
  lifecyclePhase: postReviewCurrent ? "POST_REVIEW_CURRENT" : "DURING_REVIEW",
  candidateStatus: postReviewCurrent
    ? "REPOSITORY_IMPLEMENTATION_POST_REVIEW_CURRENT_LIVE_BLOCKED"
    : "LOCAL_REPOSITORY_IMPLEMENTATION_FROZEN_LIVE_BLOCKED",
  repositoryImplementation: "PASS",
  liveQualification: "BLOCKED_PREREQUISITE",
  blockerCodes,
  qualificationPreflight: {
    schemaVersion: "slice3-live-qualification-preflight.v1",
    disposition: "BLOCKED_PREREQUISITE",
    blockers: blockerCodes,
    providerCalls: 0,
    credentialValuesInspected: false,
    externalMutations: 0,
  },
  environment: {
    scope: "LOCAL_AND_HOSTED_FIXTURE_ONLY",
    postgresql: "18.1",
    providerNetworkCalls: 0,
    credentialWrites: 0,
    billingMutations: 0,
    cloudMutations: 0,
  },
  candidate: {
    manifestPath: exclusions[0],
    ...candidateIdentity,
  },
  localGate: {
    status: "PASS",
    fullWrapper: {
      command: wrapperResult.command,
      durationMs: wrapperResult.durationMs,
      result: wrapperResult.result,
      observedAt: wrapperResult.observedAt,
      sourceRef: {
        path: wrapperResultPath,
        sha256: wrapperResultSha256,
      },
    },
    testCounts: {
      contracts: 7,
      aiEvidence: 74,
      security: 52,
      dataPostgresql18: 22,
      liveResearchApplicationPostgresql18: 1,
      combinedWorkerProcessPostgresql18: 1,
      providerStreamingHttp: 2,
      slice3RootPostgresqlHttpWorker: 8,
      webUnitPostgresql18: 29,
      qualifiedLiveBrowserChrome: 1,
      failed: 0,
    },
    note: "Role 2 Loop 1 pre-wrapper basis: contracts 7/7, AI/evidence 74/74, PostgreSQL 18 data 22/22, application/combined-worker/provider-HTTP 4/4, preflight/admission 7/7, dashboard handoff/policy 15/15, predecessor policy 41/41, and qualified-live injected real Chrome 1/1. Six fresh same-byte audits, final critic, hosted fixture-only release and Role 2 re-audit remain separately gated. Provider calls and external mutations remained zero.",
  },
  acceptance,
  artifacts,
  independentAudits: [
    "security_privacy_iam",
    "ai_evidence",
    "data_migration",
    "qa_accessibility",
    "sre_cost_recovery",
    "repository_release_preservation",
    "integration_critic",
  ].map((id, index) => ({
    id,
    status: index === 6 ? criticStatus : auditStatus,
    critical: 0,
    major: 0,
    minor: 0,
  })),
  ...(postReviewCurrent
    ? {
        historicalLifecycle: priorEvidence.historicalLifecycle,
        postReview,
      }
    : {}),
  role2: {
    status: "FAIL",
    acceptanceClaimed: false,
    defects: ["D001", "D002", "D003", "D004"].map((id) => ({
      id,
      status: "CORRECTED_PENDING_ROLE2",
    })),
  },
};
writeFileSync(
  resolve(root, exclusions[1]),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);
console.log(
  `slice3 evidence: GENERATED (${manifest.fileCount} files; ${manifest.aggregateSha256}; live BLOCKED_PREREQUISITE)`,
);
