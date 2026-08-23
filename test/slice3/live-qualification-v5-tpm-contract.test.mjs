import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  rfc8785Canonicalize,
  assertV5ArchiveRootIdentity,
  sha256,
  validateV5Role2Envelope,
  validateV5Role2Payload,
  verifyPinnedV5PublicMaterials,
  verifyPinnedV5Role2Acceptance,
  V5_AUTHORITATIVE_SOURCE_PATHS,
  V5_DISCIPLINE_AUDIT_PATHS,
  V5_FIXED_SIGNED_PATHS,
  V5_TPM_CONTRACT,
} from "../../scripts/lib/slice3-v5-role2-tpm-verifier.mjs";

const REPLAY_PREDECESSOR_FIXTURE_PATH =
  "test/slice3/fixtures/v5-replay-predecessor-seq1.jsonl";
import {
  inspectCanonicalV5ReplayRegistry,
  validateV5ReplayRegistryBytes,
} from "../../scripts/lib/slice3-v5-replay-registry.mjs";
import * as replayRegistryModule from "../../scripts/lib/slice3-v5-replay-registry.mjs";
import {
  inspectV5ReplayRegistryAt,
  reserveV5ReplayIdentityAt,
  verifyV5ReplayReservationAt,
} from "./support/v5-replay-registry-test-harness.mjs";
import {
  assertV5SanitizedEnvelopeShape,
  validateV5ResponseContractArtifact,
  V5_RESPONSE_PERSISTED_FIELDS,
} from "../../scripts/lib/slice3-v5-response-contract.mjs";
import { reduceV5CredentialResponse } from "../../scripts/lib/slice3-live-qualification-v5.mjs";
import { assertCanonicalV5DirectoryIdentity } from "../../scripts/lib/slice3-v5-canonical-workspace.mjs";
import { validateV5HostedObservation } from "../../scripts/lib/slice3-v5-role2-source-binding.mjs";

const DIGEST = "A".repeat(64);
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const NOW = Date.parse("2026-08-22T12:00:00Z");
const CANONICAL_WINDOWS_WORKSPACE =
  process.platform === "win32" &&
  resolve(".") === V5_TPM_CONTRACT.repositoryPath;

const binding = (path, overrides = {}) => ({
  path,
  sha256: DIGEST,
  bytes: 1,
  ...overrides,
});

const passBinding = (path) => ({
  ...binding(path),
  status: "PASS",
  critical: 0,
  major: 0,
  minor: 0,
});

function payloadFixture() {
  const sources = V5_AUTHORITATIVE_SOURCE_PATHS.map((path) => binding(path));
  const sourceAggregate = sha256(
    Buffer.from(
      sources
        .map(({ path, sha256: digest }) => `${path}\0${digest}\n`)
        .join(""),
      "utf8",
    ),
  );
  return {
    schemaVersion: "matchbase.role2-detached-acceptance/v6",
    payloadType: "V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION",
    decisionId: V5_TPM_CONTRACT.decisionId,
    sessionId: V5_TPM_CONTRACT.sessionId,
    payloadPath: V5_TPM_CONTRACT.payloadPath,
    signatureEnvelopePath: V5_TPM_CONTRACT.envelopePath,
    issuedAt: "2026-08-22T11:55:00Z",
    expiresAt: "2026-08-22T12:10:00Z",
    nonce: V5_TPM_CONTRACT.nonce,
    stateRoot: V5_TPM_CONTRACT.stateRoot,
    replayIdentity: {
      workspaceClaim: V5_TPM_CONTRACT.workspaceClaim,
      canonicalNonClonedWorkspaceOnly: true,
      decisionId: V5_TPM_CONTRACT.decisionId,
      sessionId: V5_TPM_CONTRACT.sessionId,
      nonce: V5_TPM_CONTRACT.nonce,
      keyId: V5_TPM_CONTRACT.keyId,
      registryPath: V5_TPM_CONTRACT.replayRegistryPath,
      registryPreSignSha256: V5_TPM_CONTRACT.replayPreSignSha256,
      registryPreSignBytes: V5_TPM_CONTRACT.replayPreSignBytes,
      registryPreSignRecordCount: V5_TPM_CONTRACT.replayPreSignRecordCount,
      registryPreSignLastSequence: V5_TPM_CONTRACT.replayPreSignLastSequence,
      registryPreSignTailSha256: V5_TPM_CONTRACT.replayPreSignTailSha256,
      nonceAbsentBeforeSign: true,
    },
    repository: {
      absolutePath: V5_TPM_CONTRACT.repositoryPath,
      repository: "banihashem/INNOBASE-MatchBASE",
      branch: "main",
      commit: COMMIT,
      tree: TREE,
      localOriginRemoteParity: true,
      clean: true,
      private: true,
    },
    candidate: {
      manifest: binding(V5_FIXED_SIGNED_PATHS.candidateManifest),
      aggregateSha256: DIGEST,
      fileCount: 1,
      wrapper: binding(V5_FIXED_SIGNED_PATHS.candidateWrapper),
    },
    governanceBindings: {
      ownerDecision: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DECISION_PO_001_SLICE_3_V5_ONE_GET_2026-08-22.md",
        {
          sha256:
            "7B9DC0E27F2DA3B0E20ED2A4220DFE26AA95B76FA4EC1B37D9B559AE3D0AD916",
          bytes: 4_915,
        },
      ),
      oneGetAllocation: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_ALLOCATION_PO_001_SLICE_3_V5_ONE_GET_PRE_EXECUTION_PENDING.md",
        {
          sha256:
            "484B8F82E08E97CBC40CA0E01115D735FA0446FB19D093DE06F41691CCF1C0C6",
          bytes: 5_876,
        },
      ),
      transitionDecision: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\OWNER_DELEGATED_DECISION_PO_001_SLICE_3_V5_TPM_ECDSA_P256_TRANSITION.md",
        {
          sha256: V5_TPM_CONTRACT.transitionSha256,
          bytes: V5_TPM_CONTRACT.transitionBytes,
        },
      ),
      successorAuthorization: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
        {
          sha256: V5_TPM_CONTRACT.successorAuthorizationSha256,
          bytes: V5_TPM_CONTRACT.successorAuthorizationBytes,
        },
      ),
      s2PayloadSchema: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.json",
        {
          sha256: V5_TPM_CONTRACT.s2SchemaSha256,
          bytes: V5_TPM_CONTRACT.s2SchemaBytes,
        },
      ),
      s2SigningContract: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V5.md",
        {
          sha256: V5_TPM_CONTRACT.s2ContractSha256,
          bytes: V5_TPM_CONTRACT.s2ContractBytes,
        },
      ),
      s2SuccessorAuthorization: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_REQUIREMENTS_AFTER_INVALID_200_SCHEMA_V1.md",
        {
          sha256: V5_TPM_CONTRACT.s2AuthorizationSha256,
          bytes: V5_TPM_CONTRACT.s2AuthorizationBytes,
        },
      ),
      recoveryGovernance: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_S3_SUCCESSOR_REQUIREMENTS_AFTER_S2_LOST_OUTPUT_SIGNING_V1.md",
        {
          sha256: V5_TPM_CONTRACT.successorAuthorizationSha256,
          bytes: V5_TPM_CONTRACT.successorAuthorizationBytes,
        },
      ),
      s2IndeterminateArchiveManifest: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_MANIFEST.json",
        {
          sha256: V5_TPM_CONTRACT.s2IndeterminateArchiveManifestSha256,
          bytes: V5_TPM_CONTRACT.s2IndeterminateArchiveManifestBytes,
        },
      ),
      s2IndeterminateArchiveAudit: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_S2_INDETERMINATE_SIGNING_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
        {
          sha256: V5_TPM_CONTRACT.s2IndeterminateArchiveAuditSha256,
          bytes: V5_TPM_CONTRACT.s2IndeterminateArchiveAuditBytes,
        },
      ),
      s2IndeterminateAttemptEvidence: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-S2-INDETERMINATE-SIGNING-001\\INDETERMINATE_SESSION_v5-6092A20EE13791B32198C4B6_ATTEMPT_EVIDENCE.json",
        {
          sha256: V5_TPM_CONTRACT.s2IndeterminateAttemptEvidenceSha256,
          bytes: V5_TPM_CONTRACT.s2IndeterminateAttemptEvidenceBytes,
        },
      ),
      payloadSchema: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNED_ACCEPTANCE_PAYLOAD_SCHEMA_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.json",
        {
          sha256: V5_TPM_CONTRACT.schemaSha256,
          bytes: V5_TPM_CONTRACT.schemaBytes,
        },
      ),
      signingContract: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_CONTRACT_AMENDMENT_PO_001_SLICE_3_V5_TPM_ECDSA_P256_V6.md",
        {
          sha256: V5_TPM_CONTRACT.contractSha256,
          bytes: V5_TPM_CONTRACT.contractBytes,
        },
      ),
      custodyEvidence: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_TPM_ECDSA_P256_CUSTODY_EVIDENCE_PO_001_SLICE_3_V5.json",
        {
          sha256: V5_TPM_CONTRACT.custodySha256,
          bytes: V5_TPM_CONTRACT.custodyBytes,
        },
      ),
      revokedEd25519Record: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_ED25519_REVOCATION.md",
        {
          sha256:
            "D38D03154C6C87576DEED07EB97A3557271D47E79EE4227D7005CFE7140A1665",
          bytes: 6_512,
        },
      ),
      priorHttp401: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json",
        {
          sha256:
            "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08",
          bytes: 886,
        },
      ),
      forensicArchiveManifest: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing\\archive\\V5-INVALID-200-SCHEMA-001\\CONSUMED_SESSION_v5-53676308BAD073D07FFC88B8_MANIFEST.json",
        {
          sha256: V5_TPM_CONTRACT.forensicArchiveManifestSha256,
          bytes: V5_TPM_CONTRACT.forensicArchiveManifestBytes,
        },
      ),
      officialDocsEvidence: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_2026-08-23.json",
        {
          sha256: V5_TPM_CONTRACT.officialDocsEvidenceSha256,
          bytes: V5_TPM_CONTRACT.officialDocsEvidenceBytes,
        },
      ),
      officialDocsEvidenceAudit: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_AUDIT_2026-08-23.json",
        {
          sha256: V5_TPM_CONTRACT.officialDocsEvidenceAuditSha256,
          bytes: V5_TPM_CONTRACT.officialDocsEvidenceAuditBytes,
        },
      ),
      rateLimitAmendment: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_GOVERNANCE_AMENDMENT_RATE_LIMIT_REQUESTS_V1.md",
        {
          sha256: V5_TPM_CONTRACT.rateLimitAmendmentSha256,
          bytes: V5_TPM_CONTRACT.rateLimitAmendmentBytes,
        },
      ),
      forensicArchiveAudit: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V5_INVALID_200_SCHEMA_FORENSIC_ARCHIVE_AUDIT_2026-08-23.json",
        {
          sha256: V5_TPM_CONTRACT.forensicArchiveAuditSha256,
          bytes: V5_TPM_CONTRACT.forensicArchiveAuditBytes,
        },
      ),
      v1Ledger: {
        root: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\session-7EA6B3997AF42571DBFE9483",
        evidenceDigest:
          "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8",
        digestSemantics:
          "HISTORICAL_IMMUTABLE_LEDGER_DIGEST_AS_RECORDED_IN_GOVERNING_ALLOCATION",
      },
      v2Ledger: {
        root: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\session-7327E59E65AA787E98E08968",
        evidenceDigest:
          "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748",
        digestSemantics:
          "HISTORICAL_IMMUTABLE_LEDGER_DIGEST_AS_RECORDED_IN_GOVERNING_ALLOCATION",
      },
      v3Ledger: {
        root: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\session-19AD2D3117AF9064AF90F879",
        evidenceDigest:
          "3030B12726EB31DA43BBEBD19E9D5C0E819AB5857371FBC843CF3F7D759F7BC8",
        digestSemantics:
          "HISTORICAL_IMMUTABLE_LEDGER_DIGEST_AS_RECORDED_IN_GOVERNING_ALLOCATION",
      },
      v4Ledger: binding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_SLICE_3_V4_SAFE_BLOCKED_STATE_2026-08-18.json",
        {
          sha256:
            "D4A545B7AFB70A08E2ECE3556BA43670FF367F620BF3252648CA5881C05C8A53",
          bytes: 4_971,
        },
      ),
    },
    authoritativeSourceSet: {
      root: V5_TPM_CONTRACT.authoritativeRoot,
      count: 14,
      aggregateSha256: sourceAggregate,
      aggregationMethod: "UTF8_SORTED_ABSOLUTE_PATH_NUL_SHA256_LF_V1",
      sources,
    },
    managementLogPrefix: {
      path: V5_TPM_CONTRACT.managementLogPath,
      byteLength: 1,
      sha256: DIGEST,
    },
    reviewEvidence: {
      disciplineAudits: V5_DISCIPLINE_AUDIT_PATHS.map(passBinding),
      critic: passBinding(V5_FIXED_SIGNED_PATHS.critic),
      hosted: {
        observationPath:
          "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_GITHUB_HOSTED_OBSERVATION_PO_001_SLICE_3_V5_SUCCESSOR_3.json",
        observationSha256: DIGEST,
        runId: 32_134_102_849,
        jobId: 95_701_395_827,
        commit: COMMIT,
        tree: TREE,
        status: "COMPLETED",
        conclusion: "SUCCESS",
        independentAuthentication: "GITHUB_API_AUTHENTICATED_READ_ONLY",
        authenticatedApiEvidenceSha256: DIGEST,
        observedAt: "2026-08-22T11:50:00Z",
      },
      preSignRole2Audit: passBinding(
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN_LOOP_3.md",
      ),
    },
    authorizationPolicy: {
      transitionFrom: "BLOCKED_CREDENTIAL",
      transitionTo: "CREDENTIAL_GET_AUTHORIZED",
      qualificationAuthorized: false,
      method: "GET",
      url: V5_TPM_CONTRACT.endpoint,
      credentialHandle: "MATCHBASE_OPENROUTER_API_KEY",
      maximumRequests: 1,
      retryCount: 0,
      redirectCount: 0,
      fallbackCount: 0,
      modelPosts: 0,
      searchCalls: 0,
      billableCalls: 0,
      maximumUsd: 0,
      timeoutMs: 10_000,
      maximumBodyBytes: 32_768,
      responseContentType: "application/json",
      responseContract: binding(V5_FIXED_SIGNED_PATHS.responseContract),
      afterParentLockRechecks: [
        "SIGNATURE_VALID",
        "PAYLOAD_UNEXPIRED",
        "ALL_DIGEST_BINDINGS_CURRENT",
        "REPOSITORY_CLEAN_PARITY_CURRENT",
        "HOSTED_IDENTITY_MATCH",
        "STATE_ROOT_CANONICAL",
        "SESSION_ABSENT",
        "REPLAY_IDENTITY_UNUSED",
        "CALL_COUNTER_ZERO",
        "CREDENTIAL_HANDLE_PRESENT_WITHOUT_VALUE_READ",
      ],
      preSendRechecks: [
        "PARENT_LOCK_STILL_OWNED",
        "SIGNATURE_VALID",
        "PAYLOAD_UNEXPIRED",
        "DURABLE_REPLAY_RESERVATION_PRESENT",
        "DURABLE_ONE_USE_CALL_RESERVATION_PRESENT",
        "SESSION_ID_MATCH",
        "METHOD_URL_POLICY_MATCH",
        "REDIRECT_RETRY_FALLBACK_ZERO",
        "TIMEOUT_10000_MS",
        "BODY_LIMIT_32768",
        "NO_NETWORK_BYTES_PREVIOUSLY_SENT",
      ],
      firstAttemptConsumes: true,
      prohibited: [
        "CREDENTIAL_VALUE_OUTPUT",
        "CREDENTIAL_VALUE_PERSISTENCE",
        "AUTHORIZATION_HEADER_LOGGING",
        "RAW_RESPONSE_PERSISTENCE",
        "MODEL_GENERATION",
        "WEB_SEARCH",
        "RETRY",
        "REDIRECT",
        "FALLBACK",
        "CREDENTIAL_MUTATION",
        "ACCOUNT_MUTATION",
        "CLOUD_MUTATION",
        "DEPLOYMENT_MUTATION",
        "REPOSITORY_MUTATION",
      ],
    },
    preservation: {
      v1ToV4Immutable: true,
      v3ContractImmutable: true,
      failedAttemptArchived: true,
      authoritativeSourcesImmutable: true,
      priorAuditHistoryImmutable: true,
      canonicalWorkspaceOnly: true,
    },
  };
}

function envelopeFixture(payload) {
  const payloadSha256 = sha256(
    Buffer.from(rfc8785Canonicalize(payload), "utf8"),
  );
  return {
    schemaVersion: "matchbase.role2-detached-signature/v6",
    sessionId: payload.sessionId,
    replayIdentitySha256: sha256(
      Buffer.from(rfc8785Canonicalize(payload.replayIdentity), "utf8"),
    ),
    payloadSha256,
    signature: "A".repeat(86),
    signedAt: payload.issuedAt,
  };
}

test("RFC 8785 canonicalization is deterministic and rejects invalid Unicode", () => {
  assert.equal(
    rfc8785Canonicalize({ z: -0, b: 1, a: "€", n: 1e30 }),
    '{"a":"€","b":1,"n":1e+30,"z":0}',
  );
  assert.equal(
    rfc8785Canonicalize({ value: "\u000f\n" }),
    '{"value":"\\u000f\\n"}',
  );
  assert.notEqual(
    rfc8785Canonicalize({ value: "é" }),
    rfc8785Canonicalize({ value: "e\u0301" }),
  );
  assert.throws(() => rfc8785Canonicalize({ value: "\ud800" }), /surrogate/u);
});

test("missing canonical roots fail with one host-neutral typed error", async () => {
  const missing = join(tmpdir(), `matchbase-v5-missing-${process.pid}`);
  await assert.rejects(
    assertCanonicalV5DirectoryIdentity(missing, missing, "fixture root"),
    /canonical fixture root is unavailable or invalid/u,
  );
});

test("v4 payload closes successor identity, exact paths, safe IDs, and exact 900-second UTC", () => {
  const payload = payloadFixture();
  assert.equal(
    validateV5Role2Payload(payload, { nowMs: NOW }).payload,
    payload,
  );
  for (const mutate of [
    (value) => (value.sessionId = "v5-FFFFFFFFFFFFFFFFFFFFFFFF"),
    (value) => (value.sessionId = "v5-968A9D69D38203E2E8B1375A"),
    (value) => (value.nonce = "16C743A6706C922C45383A161D5E9EC7"),
    (value) => (value.schemaVersion = "matchbase.role2-detached-acceptance/v3"),
    (value) => (value.replayIdentity.sessionId = "v5-968A9D69D38203E2E8B1375A"),
    (value) =>
      (value.replayIdentity.nonce = "16C743A6706C922C45383A161D5E9EC7"),
    (value) => (value.replayIdentity.registryPreSignSha256 = "F".repeat(64)),
    (value) =>
      (value.reviewEvidence.preSignRole2Audit.path =
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN.md"),
    (value) => (value.expiresAt = "2026-08-22T12:10:01Z"),
    (value) => (value.issuedAt = "2026-02-30T11:55:00Z"),
    (value) =>
      (value.reviewEvidence.hosted.observedAt = "2026-08-22T11:50:00.1Z"),
    (value) =>
      (value.reviewEvidence.hosted.observedAt = "2026-08-22T15:20:00+03:30"),
    (value) =>
      (value.reviewEvidence.hosted.observedAt = "2026-08-22T11:50:00z"),
    (value) => (value.reviewEvidence.hosted.observedAt = "2026-08-22T11:50Z"),
    (value) =>
      (value.reviewEvidence.hosted.observedAt = "2026-08-22T11:50:00.000001Z"),
    (value) =>
      (value.reviewEvidence.hosted.runId = Number.MAX_SAFE_INTEGER + 1),
    (value) => value.authoritativeSourceSet.sources.reverse(),
    (value) => value.reviewEvidence.disciplineAudits.reverse(),
    (value) => (value.candidate.manifest.path = "C:\\elsewhere.json"),
  ]) {
    const changed = structuredClone(payload);
    mutate(changed);
    assert.throws(() => validateV5Role2Payload(changed, { nowMs: NOW }));
  }
});

test("hosted source observedAt must exactly equal the signed whole-second value", () => {
  const hosted = payloadFixture().reviewEvidence.hosted;
  const observation = {
    schemaVersion: "matchbase.slice3-v5-hosted-observation/v1",
    repository: "banihashem/INNOBASE-MatchBASE",
    runId: hosted.runId,
    jobId: hosted.jobId,
    commit: hosted.commit,
    tree: hosted.tree,
    status: hosted.status,
    conclusion: hosted.conclusion,
    independentAuthentication: hosted.independentAuthentication,
    authenticatedApiEvidenceSha256: hosted.authenticatedApiEvidenceSha256,
    observedAt: hosted.observedAt,
    providerCalls: 0,
    externalMutations: 0,
    activation: false,
  };
  assert.equal(validateV5HostedObservation(observation, hosted), true);
  assert.throws(
    () =>
      validateV5HostedObservation(
        { ...observation, observedAt: "2026-08-22T11:50:01Z" },
        hosted,
      ),
    /hosted observation semantics/u,
  );
});

test("replayIdentity digest and six-field envelope are exact", () => {
  const payload = payloadFixture();
  const envelope = envelopeFixture(payload);
  assert.match(
    validateV5Role2Envelope(envelope, payload, envelope.payloadSha256),
    /^[A-F0-9]{64}$/u,
  );
  for (const mutate of [
    (value) => (value.signedAt = "2026-08-22T11:55:01Z"),
    (value) => (value.schemaVersion = "matchbase.role2-detached-signature/v3"),
    (value) => (value.replayIdentitySha256 = "F".repeat(64)),
    (value) => (value.extra = true),
  ]) {
    const changed = structuredClone(envelope);
    mutate(changed);
    assert.throws(() =>
      validateV5Role2Envelope(changed, payload, envelope.payloadSha256),
    );
  }
});

test("raw signed payload must be exact JCS with no whitespace, duplicate, escape, or newline variants", async () => {
  const payload = payloadFixture();
  const canonical = rfc8785Canonicalize(payload);
  const envelope = Buffer.from(
    JSON.stringify(envelopeFixture(payload)),
    "utf8",
  );
  const variants = [
    ` ${canonical}`,
    `${canonical}\n`,
    canonical.replaceAll("{", "{\r\n"),
    canonical.replace(
      '"schemaVersion":',
      '"schemaVersion":"x","schemaVersion":',
    ),
    canonical.replace("ROLE2", "\\u0052OLE2"),
    JSON.stringify(payload),
  ];
  for (const variant of variants) {
    assert.notEqual(variant, canonical);
    await assert.rejects(
      verifyPinnedV5Role2Acceptance({
        payloadBytes: Buffer.from(variant, "utf8"),
        envelopeBytes: envelope,
        nowMs: NOW,
      }),
      /JCS bytes/u,
    );
  }
});

test("invalid and high-S P1363 signatures fail closed under the pinned TPM key", async () => {
  const payload = payloadFixture();
  const payloadBytes = Buffer.from(rfc8785Canonicalize(payload), "utf8");
  const envelope = envelopeFixture(payload);
  await assert.rejects(
    verifyPinnedV5Role2Acceptance({
      payloadBytes,
      envelopeBytes: Buffer.from(JSON.stringify(envelope), "utf8"),
      nowMs: NOW,
    }),
    /low-S/u,
  );
  const order = BigInt(
    "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
  );
  const signature = Buffer.concat([
    Buffer.alloc(31),
    Buffer.from([1]),
    Buffer.from((order - 1n).toString(16).padStart(64, "0"), "hex"),
  ]);
  envelope.signature = signature.toString("base64url");
  await assert.rejects(
    verifyPinnedV5Role2Acceptance({
      payloadBytes,
      envelopeBytes: Buffer.from(JSON.stringify(envelope), "utf8"),
      nowMs: NOW,
    }),
    /low-S/u,
  );
});

test("repository-pinned public PEM has exact SPKI and P-256 curve on every host", async () => {
  const pem = await readFile(
    "config/slice3/role2-v5-tpm-ecdsa-p256-public.pem",
  );
  assert.equal(sha256(pem), V5_TPM_CONTRACT.publicPemSha256);
  const key = createPublicKey(pem);
  assert.equal(key.asymmetricKeyType, "ec");
  assert.equal(key.asymmetricKeyDetails.namedCurve, "prime256v1");
  assert.equal(
    sha256(key.export({ type: "spki", format: "der" })),
    V5_TPM_CONTRACT.publicSpkiDerSha256,
  );
});

test(
  "canonical Windows public CER, PEM, custody, and Key Usage verify",
  { skip: !CANONICAL_WINDOWS_WORKSPACE },
  async () => {
    const result = await verifyPinnedV5PublicMaterials();
    assert.equal(result.publicKey.asymmetricKeyType, "ec");
    assert.equal(
      result.publicKey.asymmetricKeyDetails.namedCurve,
      "prime256v1",
    );
    assert.equal(V5_TPM_CONTRACT.signatureProtocolVersion, "V1");
  },
);

test(
  "canonical Windows authoritative tree equals the frozen UTF-8 byte-ordered 14-path set",
  { skip: !CANONICAL_WINDOWS_WORKSPACE },
  async () => {
    const files = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) files.push(path);
        else assert.fail("authoritative tree contains a non-file");
      }
    };
    await walk(V5_TPM_CONTRACT.authoritativeRoot);
    files.sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    assert.deepEqual(files, V5_AUTHORITATIVE_SOURCE_PATHS);
  },
);

test("replay registry fixes the exact nonempty predecessor and rejects rollback", async () => {
  const predecessor = await readFile(REPLAY_PREDECESSOR_FIXTURE_PATH);
  const validated = validateV5ReplayRegistryBytes(predecessor);
  assert.equal(validated.digest, V5_TPM_CONTRACT.replayPreSignSha256);
  assert.equal(validated.byteLength, V5_TPM_CONTRACT.replayPreSignBytes);
  assert.equal(validated.records.length, 1);
  assert.equal(
    validated.lastRecordSha256,
    V5_TPM_CONTRACT.replayPreSignTailSha256,
  );
  assert.throws(
    () => validateV5ReplayRegistryBytes(Buffer.alloc(0)),
    /empty rollback/u,
  );
  const changed = JSON.parse(predecessor.toString("utf8"));
  changed.sequence = 9;
  assert.throws(() =>
    validateV5ReplayRegistryBytes(Buffer.from(`${JSON.stringify(changed)}\n`)),
  );
});

test(
  "canonical Windows replay registry is the checked nonempty predecessor with unused successor identity",
  { skip: !CANONICAL_WINDOWS_WORKSPACE },
  async () => {
    const payload = payloadFixture();
    const inspected = await inspectCanonicalV5ReplayRegistry(
      payload.replayIdentity,
    );
    assert.equal(inspected.digest, V5_TPM_CONTRACT.replayPreSignSha256);
    assert.equal(inspected.records.length, 1);
    assert.equal(inspected.identityUsed, false);
  },
);

test("replay production export surface is canonical-only", () => {
  assert.deepEqual(Object.keys(replayRegistryModule).sort(), [
    "inspectCanonicalV5ReplayRegistry",
    "reserveCanonicalV5ReplayIdentity",
    "validateV5ReplayRegistryBytes",
    "verifyCanonicalV5ReplayReservation",
  ]);
});

test("replay append retains its crash lock after any partial write boundary", async () => {
  const source = await readFile(
    "scripts/lib/slice3-v5-replay-registry.mjs",
    "utf8",
  );
  const writeStarted = source.indexOf("writeStarted = true;");
  const writeCall = source.indexOf("await registry.write(", writeStarted);
  const bytesWritten = source.indexOf(
    "writeResult.bytesWritten !== line.length",
    writeCall,
  );
  const sync = source.indexOf("await registry.sync();", bytesWritten);
  const guardedCleanup = source.indexOf(
    "if (!writeStarted || completed) await rm(lockPath, { force: true });",
    sync,
  );
  assert.ok(writeStarted > 0);
  assert.ok(writeCall > writeStarted);
  assert.ok(bytesWritten > writeCall);
  assert.ok(sync > bytesWritten);
  assert.ok(guardedCleanup > sync);
});

test("replay reservation is one-winner, durable, restart-safe, and rejects unsafe storage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v5-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registryRoot = join(root, "registry");
  const registryPath = join(registryRoot, "consumed-v5.jsonl");
  await mkdir(registryRoot);
  await writeFile(
    registryPath,
    await readFile(REPLAY_PREDECESSOR_FIXTURE_PATH),
    { flag: "wx" },
  );
  const replayIdentity = payloadFixture().replayIdentity;
  const input = {
    registryPath,
    replayIdentity,
    payloadSha256: DIGEST,
    observedAt: "2026-08-23T09:00:00Z",
  };
  const attempts = await Promise.allSettled([
    reserveV5ReplayIdentityAt(input),
    reserveV5ReplayIdentityAt(input),
  ]);
  assert.equal(
    attempts.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.filter(({ status }) => status === "rejected").length,
    1,
  );
  const record = attempts.find(({ status }) => status === "fulfilled").value;
  assert.equal(record.sequence, 2);
  assert.equal(record.decisionId, V5_TPM_CONTRACT.decisionId);
  assert.equal(record.sessionId, V5_TPM_CONTRACT.sessionId);
  assert.equal(record.nonce, V5_TPM_CONTRACT.nonce);
  assert.equal(
    (await verifyV5ReplayReservationAt(registryPath, record.recordSha256))
      .recordSha256,
    record.recordSha256,
  );
  const restarted = await inspectV5ReplayRegistryAt(
    registryPath,
    replayIdentity,
  );
  assert.equal(restarted.identityUsed, true);
  await assert.rejects(reserveV5ReplayIdentityAt(input), /stale|consumed/u);

  const historicalS2Core = {
    schemaVersion: "matchbase.role2-v5-replay-consumption/v1",
    sequence: 2,
    workspaceClaim: replayIdentity.workspaceClaim,
    decisionId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S2",
    sessionId: "v5-6092A20EE13791B32198C4B6",
    nonce: "7F974EECA2C846990DD06499284DA28A",
    keyId: replayIdentity.keyId,
    payloadSha256: DIGEST,
    registryPreSignSha256: replayIdentity.registryPreSignSha256,
    previousRecordSha256: V5_TPM_CONTRACT.replayPreSignTailSha256,
    observedAt: "2026-08-23T09:00:00Z",
  };
  const historicalS2Record = {
    ...historicalS2Core,
    recordSha256: sha256(
      Buffer.from(rfc8785Canonicalize(historicalS2Core), "utf8"),
    ),
  };
  const historicalS2Bytes = Buffer.concat([
    await readFile(REPLAY_PREDECESSOR_FIXTURE_PATH),
    Buffer.from(`${JSON.stringify(historicalS2Record)}\n`, "utf8"),
  ]);
  assert.throws(
    () => validateV5ReplayRegistryBytes(historicalS2Bytes),
    /hash chain/u,
  );

  const malformedRoot = join(root, "malformed");
  await mkdir(malformedRoot);
  const malformed = join(malformedRoot, "consumed-v5.jsonl");
  await writeFile(malformed, "{}", "utf8");
  await assert.rejects(
    inspectV5ReplayRegistryAt(malformed, replayIdentity),
    /LF-terminated/u,
  );
  await assert.rejects(
    inspectV5ReplayRegistryAt(join(root, "missing", "file"), replayIdentity),
  );

  const hardRoot = join(root, "hard");
  await mkdir(hardRoot);
  const hard = join(hardRoot, "consumed-v5.jsonl");
  await writeFile(hard, "", "utf8");
  await link(hard, join(hardRoot, "copy"));
  await assert.rejects(
    inspectV5ReplayRegistryAt(hard, replayIdentity),
    /replay file is invalid/u,
  );

  const linkRoot = join(root, "link-root");
  await mkdir(linkRoot);
  const target = join(linkRoot, "target.jsonl");
  await writeFile(target, "", "utf8");
  const linked = join(linkRoot, "consumed-v5.jsonl");
  await symlink(target, linked, "file");
  await assert.rejects(
    inspectV5ReplayRegistryAt(linked, replayIdentity),
    /replay file is invalid/u,
  );

  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "consumed-v5.jsonl"), "", "utf8");
  const junction = join(root, "junction");
  await symlink(outside, junction, "junction");
  await assert.rejects(
    inspectV5ReplayRegistryAt(
      join(junction, "consumed-v5.jsonl"),
      replayIdentity,
    ),
    /root is invalid/u,
  );
});

test("response contract is exhaustive, ordered, and identical to runtime sanitized evidence", async () => {
  const contract = JSON.parse(
    await readFile(
      "config/slice3/openrouter-key-status-response-contract.v2.json",
      "utf8",
    ),
  );
  validateV5ResponseContractArtifact(contract);
  const response = new Response(
    JSON.stringify({
      data: {
        byok_usage: 0,
        byok_usage_daily: 0,
        byok_usage_monthly: 0,
        byok_usage_weekly: 0,
        creator_user_id: null,
        expires_at: null,
        include_byok_in_limit: false,
        is_free_tier: false,
        is_management_key: false,
        is_provisioning_key: false,
        label: "discard",
        limit: null,
        limit_remaining: 1,
        limit_reset: null,
        rate_limit: { requests: -1, interval: "legacy", note: "discard" },
        usage: 0,
        usage_daily: 0,
        usage_monthly: 0,
        usage_weekly: 0,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
  Object.defineProperty(response, "url", { value: V5_TPM_CONTRACT.endpoint });
  const reduced = await reduceV5CredentialResponse(response);
  assert.deepEqual(
    Object.keys(assertV5SanitizedEnvelopeShape(reduced.sanitizedEnvelope)),
    V5_RESPONSE_PERSISTED_FIELDS,
  );
  for (const key of [
    "extractedDataKeys",
    "persistedFields",
    "prohibitedPersistence",
  ]) {
    for (const mutation of [
      (values) => values.slice(1),
      (values) => [...values, "extra"],
      (values) => [...values].reverse(),
    ]) {
      const changed = structuredClone(contract);
      changed[key] = mutation(changed[key]);
      assert.throws(() => validateV5ResponseContractArtifact(changed));
    }
  }
});

test("TPM verifier source has private immutable V1 protocol-domain construction", async () => {
  const source = await readFile(
    "scripts/lib/slice3-v5-role2-tpm-verifier.mjs",
    "utf8",
  );
  assert.match(source, /const SIGNATURE_DOMAIN_TEXT/u);
  assert.match(source, /Buffer\.from\(SIGNATURE_DOMAIN_TEXT, "utf8"\)/u);
  assert.doesNotMatch(source, /domain:\s*Buffer/u);
});

test("new invalid-200 archive root is explicitly non-reparse checked on every public-material load", async () => {
  const source = await readFile(
    "scripts/lib/slice3-v5-role2-tpm-verifier.mjs",
    "utf8",
  );
  assert.match(
    source,
    /const invalid200ArchiveRoot =\s*dirname\(\s*PUBLIC_MATERIALS\.forensicArchiveManifest,?\s*\)/u,
  );
  assert.match(
    source,
    /assertV5ArchiveRootIdentity\(dirname\(invalid200ArchiveRoot\)\)/u,
  );
  assert.match(source, /assertV5ArchiveRootIdentity\(invalid200ArchiveRoot\)/u);
  const root = await mkdtemp(join(tmpdir(), "matchbase-v5-archive-root-"));
  const canonical = join(root, "canonical");
  const linked = join(root, "linked");
  await mkdir(canonical);
  try {
    assert.equal(await assertV5ArchiveRootIdentity(canonical), true);
    await symlink(
      canonical,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      assertV5ArchiveRootIdentity(linked),
      /identity|reparse/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
