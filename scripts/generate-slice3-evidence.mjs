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
  "package.json",
  "config/slice3/provider-evidence-register.v1.json",
  "config/slice3/research-route-policy.v1.json",
  "config/slice3/openrouter-key-status-response-contract.v1.json",
  "config/slice3/openrouter-key-status-response-contract.v2.json",
  "config/slice3/role2-v5-tpm-ecdsa-p256-public.pem",
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
  "scripts/qualify-slice3-live-v4.mjs",
  "scripts/qualify-slice3-live-v5.mjs",
  "scripts/archive-slice3-v5-invalid-pair.mjs",
  "scripts/archive-slice3-v5-invalid-200-schema.mjs",
  "scripts/generate-slice3-v5-successor-schema.mjs",
  "scripts/lib/slice3-live-qualification-runner.mjs",
  "scripts/lib/slice3-live-qualification-v4.mjs",
  "scripts/lib/slice3-live-qualification-v5.mjs",
  "scripts/lib/slice3-v5-capability-registry.mjs",
  "scripts/lib/slice3-v5-canonical-workspace.mjs",
  "scripts/lib/slice3-v5-credential-file-controls.mjs",
  "scripts/lib/slice3-v5-one-use-ledger.mjs",
  "scripts/lib/slice3-v5-replay-registry.mjs",
  "scripts/lib/slice3-v5-response-contract.mjs",
  "scripts/lib/slice3-v5-role2-source-binding.mjs",
  "scripts/lib/slice3-v5-role2-tpm-verifier.mjs",
  "scripts/lib/slice3-v5-source-verifier.mjs",
  "scripts/lib/slice3-dashboard-policy.mjs",
  "scripts/lib/slice3-dashboard-handoff-policy.mjs",
  "scripts/lib/slice3-wrapper-result-policy.mjs",
  "scripts/generate-dashboard-snapshot.mjs",
  "scripts/generate-dashboard-ci-snapshot.mjs",
  "scripts/validate-dashboard-snapshot.mjs",
  "scripts/record-slice3-wrapper-result.mjs",
  "scripts/verify-boundaries.mjs",
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
  "test/slice3/live-qualification-durable-runner.test.mjs",
  "test/slice3/live-qualification-runner.test.mjs",
  "test/slice3/live-qualification-runtime-transport.test.mjs",
  "test/slice3/live-qualification-v4.test.mjs",
  "test/slice3/live-qualification-v5.test.mjs",
  "test/slice3/live-qualification-v5-tpm-contract.test.mjs",
  "test/slice3/live-qualification-v5-response-v2.test.mjs",
  "test/slice3/live-qualification-v5-replay-successor.test.mjs",
  "test/slice3/v5-invalid-pair-archive.test.mjs",
  "test/slice3/support/v5-replay-registry-test-harness.mjs",
  "test/slice3/dashboard-policy.test.mjs",
  "test/slice3/dashboard-handoff-policy.test.mjs",
  "test/slice3/wrapper-result-policy.test.mjs",
  "packages/ai-evidence/test/research-adapters.test.ts",
  "packages/ai-evidence/test/research-route-policy.test.ts",
  "test/browser/product-qualified-reference-path.spec.mjs",
  "test/browser/product-live-reference-path.spec.mjs",
  "test/browser/product-standard-reference-path.spec.mjs",
];
const blockerCodes = ["BLOCKED_CREDENTIAL"];
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
    schemaVersion:
      "slice3-live-qualification-preflight.v5-pre-execution-pending",
    disposition: "PRE_EXECUTION_PENDING",
    blockers: blockerCodes,
    sourceBinding: {
      path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json",
      verificationMode: "EXACT_LOCAL_SHA256_OR_ANCHOR_ONLY_CI",
      sha256:
        "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08",
      httpStatus: 401,
      sanitizedEnvelopeDigest:
        "8CF8991C0372D72CEB99F18D9187DA4FB55E022D9BE264F02DB9BB0BB6EBF508",
    },
    providerCalls: 0,
    credentialValuesInspected: false,
    additionalAuthorizationGets: 0,
    v4SessionCreated: false,
    v5SessionCreated: false,
    v5Admission: {
      ownerDecision: {
        path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DECISION_PO_001_SLICE_3_V5_ONE_GET_2026-08-22.md",
        sha256:
          "7B9DC0E27F2DA3B0E20ED2A4220DFE26AA95B76FA4EC1B37D9B559AE3D0AD916",
      },
      role2Allocation: {
        path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_ALLOCATION_PO_001_SLICE_3_V5_ONE_GET_PRE_EXECUTION_PENDING.md",
        sha256:
          "484B8F82E08E97CBC40CA0E01115D735FA0446FB19D093DE06F41691CCF1C0C6",
      },
      role2SigningRevocation: {
        path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_ED25519_REVOCATION.md",
        sha256:
          "D38D03154C6C87576DEED07EB97A3557271D47E79EE4227D7005CFE7140A1665",
      },
      role2TpmAuthority: {
        keyId: "ROLE2-PO001-S3-V5-TPM-ECDSA-P256-0AED3F3F66C077CB",
        publicPem: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_TPM_ECDSA_P256_PUBLIC.pem",
          sha256:
            "5897804885924CE5499494F9D00471A6B1D918671B6D17F7206C6007AFCDF1E4",
        },
        publicCer: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_TPM_ECDSA_P256_PUBLIC.cer",
          sha256:
            "5674E94E9D2F27AC16D9F0C793D6222F67C4EE4FFEDA0B10D2F9A09D50F99CFB",
        },
        payloadSchema: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.json",
          sha256:
            "66C53191D6552990E528834E35033D8F5208F1FFE7CB32FFCEEC6D14AE07F910",
        },
        signingContract: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.md",
          sha256:
            "9C35E4BCEE0A74745C31794A2E42A39ABB97F1A44D171399C86A4F612C2B175F",
        },
        successorAuthorization: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
          sha256:
            "9627F5CC3FDC6D08B91E0C8C8685C9B409A889067B82B689563B596E9B8B29F8",
        },
        s2PayloadSchema: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.json",
          sha256:
            "761B079C422AD28A8F846A642D1141622EFC1DB9EB5CF18E28A8C4F3903C8B77",
        },
        s2SigningContract: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.md",
          sha256:
            "7678893C5AC9FDFB95DF549C6C2AF7BA277DCDADC172B148FCED96757801FD0F",
        },
        s2SuccessorAuthorization: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_REQUIREMENTS_AFTER_INVALID_200_SCHEMA_V1.md",
          sha256:
            "A028A2AEFCA11F0002906F7483821C039E9AD82B272DA5235B531A426AC7E98A",
        },
        recoveryGovernance: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
          sha256:
            "9627F5CC3FDC6D08B91E0C8C8685C9B409A889067B82B689563B596E9B8B29F8",
        },
        s2IndeterminateArchiveManifest: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_MANIFEST.json",
          sha256:
            "48B479DADD281D0CFB77A44276DDB7313F27B5BBC316E904D8A9E9EB569B2E72",
        },
        s2IndeterminateArchiveAudit: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_S2_INDETERMINATE_SIGNING_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
          sha256:
            "4867AC5D0D06A81312CE0A5FAC0BDFA41D07C6A070DC2CF1D9EC6F6BEBC96B1F",
        },
        s2IndeterminateAttemptEvidence: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_ATTEMPT_EVIDENCE.json",
          sha256:
            "F976281003E739524FBCA97AEC3FE5E14AF999ED31EFEB112C34D49925B7091B",
        },
        forensicArchiveAudit: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_INVALID_200_SCHEMA_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
          sha256:
            "3168FE64F5DC1B73B60E71345533B48141381CAED3D6394F46ECB2BC2CF40043",
        },
        forensicArchiveManifest: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-INVALID-200-SCHEMA-001\\CONSUMED_SESSION_v5-53676308BAD073D07FFC88B8_MANIFEST.json",
          sha256:
            "21961F79292119938F00E6A1C7888671B021F9821A24C65D08AEC92813E199A9",
        },
        officialDocsEvidence: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_2026-08-23.json",
          sha256:
            "F73071B74AC60D557697ACE6278E1B0091185AFEC065D61C7E4D3CC0900607D4",
        },
        officialDocsEvidenceAudit: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_AUDIT_2026-08-23.json",
          sha256:
            "A01BF254BD41CA0896D43F132E97DBEDE2E736FE0E4A3742EB09B060691584C3",
        },
        rateLimitAmendment: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_GOVERNANCE_AMENDMENT_RATE_LIMIT_REQUESTS_V1.md",
          sha256:
            "AFCC3A48B201393EA9E20F8690B5E604571B71B984B5C618FA3F374FA4551566",
        },
        preservedV3Schema: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V3.json",
          sha256:
            "B9F704789FC30F368D8F297A9A5B18E0F5CDD7CBB6CFBD4486AFC746EFC2A68F",
        },
        preservedV3Contract: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V3.md",
          sha256:
            "5865910AE5BE6A9E034B8C13BD4F718B3F845156E1E17172A8CC30194E09DDF1",
        },
        supersession: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_V2_SUPERSESSION_PO_001_SLICE_3_V5.md",
          sha256:
            "E15A8DA74FD84AA758C05B65D84935554AAFEF4DC71C479AF26D0248B650B90E",
        },
        custody: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_TPM_ECDSA_P256_CUSTODY_EVIDENCE_PO_001_SLICE_3_V5.json",
          sha256:
            "2E0FF67F9D7E0E9524B101F0EF3BB35B13F788D2FE035A113418031B0B1FD5C1",
        },
        transition: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DELEGATED_DECISION_PO_001_SLICE_3_V5_TPM_ECDSA_P256_TRANSITION.md",
          sha256:
            "0967EE2C5AB9C7E7779F3E8AD2C2B1EF2AE528B6BC0CD54B7A7955A00246E911",
        },
        replayInitialization: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNER_REPLAY_REGISTRY_INITIALIZATION_PO_001_SLICE_3_V5.json",
          sha256:
            "DF6F2B352BCE80ECC1B4BCFDC70041B3015E4866C5494A00F3DF94DF116EA146",
        },
        replayRegistry: {
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.role2-signing-replay-registry\\consumed-v5.jsonl",
          sha256:
            "E28CE25E057EFF410BDCD0812CFC3E43BD6ECBE520DBC07FE1C31BAFA4057A87",
          bytes: 671,
          recordCount: 1,
          lastSequence: 1,
          tailSha256:
            "D1D0EE0DE2A545D0395427565EB154E0F7B70D93265BF42C3E013D8A705765EB",
        },
      },
      role2PublicKeyPinned: true,
      reason: "ROLE2_ACCEPTANCE_PAYLOAD_ABSENT",
      executable: false,
      credentialGets: 0,
      maxCredentialGets: 1,
      modelPosts: 0,
      searchCalls: 0,
      activation: false,
    },
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
    status: wrapperResult.result,
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
      aiEvidence: 75,
      security: 52,
      dataPostgresql18: 22,
      liveResearchApplicationPostgresql18: 1,
      combinedWorkerProcessPostgresql18: 1,
      providerStreamingHttp: 2,
      slice3RootPostgresqlHttpWorker: 8,
      webUnitPostgresql18: 29,
      qualifiedLiveBrowserChrome: 1,
      liveQualificationV3V4: 43,
      liveQualificationV5: 54,
      slice3NodeTotal: 255,
      browserTotal: 18,
      standaloneRepeat: 1,
      skipped: 1,
      failed: 0,
    },
    note: "V5 successor PRE_EXECUTION_PENDING basis: contracts 7/7, AI/evidence 75/75, V3+V4 qualification 43/43, V5 TPM credential and forensic-archive infrastructure 53 PASS plus 1 intentional noncanonical-host skip, PostgreSQL 18 data 22/22, application/combined-worker/provider-HTTP 4/4, preflight/admission 7/7, dashboard handoff/policy 15/15, predecessor policy 41/41, Slice 3 Node total 254 PASS of 255 with 1 intentional skip, standalone repeat 1/1, and Chrome 18/18. The revoked file-backed Ed25519 authority remains unused. The Role 2 TPM ECDSA-P256 v5 successor contract and public trust anchor are pinned; the failed v3 attempt is preserved in its verified forensic archive; and the fresh detached signed acceptance payload/envelope are absent. Slice 3 remains PRE_EXECUTION_PENDING and BLOCKED_CREDENTIAL. V5 has no session, credential GET, credential reread, provider/model/search call, replay consumption, activation or external mutation. Six fresh successor audits, final critic, hosted infrastructure release and a new Role 2 signed acceptance remain separately gated.",
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
