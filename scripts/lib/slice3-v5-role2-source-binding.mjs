import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  sha256,
  verifyPinnedV5PublicMaterials,
  verifyPinnedV5Role2Acceptance,
  V5_TPM_CONTRACT,
} from "./slice3-v5-role2-tpm-verifier.mjs";
import { readExactRegularContainedSource } from "./slice3-v5-source-verifier.mjs";
import { validateV5ResponseContractArtifact } from "./slice3-v5-response-contract.mjs";
import {
  assertCanonicalV5ManagementRoot,
  assertCanonicalV5SigningRoot,
  assertCanonicalV5Workspace,
  V5_CANONICAL_REPOSITORY_ROOT,
} from "./slice3-v5-canonical-workspace.mjs";

const PM_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const REPO_ROOT = V5_CANONICAL_REPOSITORY_ROOT;
const POLICY_PATH = resolve("config/slice3/research-route-policy.v1.json");
const POLICY_SHA256 =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const DISCIPLINES = Object.freeze([
  "AI_EVIDENCE",
  "DATA_MIGRATION",
  "QA_ACCESSIBILITY",
  "REPOSITORY_RELEASE_PRESERVATION",
  "SECURITY_PRIVACY_IAM",
  "SRE_COST_RECOVERY",
]);

const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());

export function validateV5HostedObservation(observation, hosted) {
  if (
    !exactKeys(observation, [
      "schemaVersion",
      "repository",
      "runId",
      "jobId",
      "commit",
      "tree",
      "status",
      "conclusion",
      "independentAuthentication",
      "authenticatedApiEvidenceSha256",
      "observedAt",
      "providerCalls",
      "externalMutations",
      "activation",
    ]) ||
    observation.schemaVersion !== "matchbase.slice3-v5-hosted-observation/v1" ||
    observation.repository !== "banihashem/INNOBASE-MatchBASE" ||
    observation.runId !== hosted.runId ||
    observation.jobId !== hosted.jobId ||
    observation.commit !== hosted.commit ||
    observation.tree !== hosted.tree ||
    observation.status !== hosted.status ||
    observation.conclusion !== hosted.conclusion ||
    observation.independentAuthentication !==
      hosted.independentAuthentication ||
    observation.authenticatedApiEvidenceSha256 !==
      hosted.authenticatedApiEvidenceSha256 ||
    observation.observedAt !== hosted.observedAt ||
    observation.providerCalls !== 0 ||
    observation.externalMutations !== 0 ||
    observation.activation !== false
  )
    throw new Error("V5 hosted observation semantics are invalid.");
  return true;
}

const utf8ByteOrder = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error("V5 signed repository identity could not be recomputed.");
  return result.stdout.trim();
}

async function exactBinding(binding, root) {
  const bytes = await readExactRegularContainedSource(
    binding.path,
    root,
    binding.sha256,
  );
  if (bytes.length !== binding.bytes)
    throw new Error("V5 signed source byte length drifted.");
  return bytes;
}

async function authoritativeFiles(root) {
  const rootReal = await realpath(root);
  if (rootReal !== resolve(root))
    throw new Error("V5 authoritative source root is not canonical.");
  const files = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("V5 authoritative source set contains a link.");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error("V5 authoritative source set contains a non-file.");
    }
  };
  await walk(rootReal);
  return files.sort(utf8ByteOrder);
}

async function verifyAuthoritativeSourceSet(sourceSet) {
  const paths = await authoritativeFiles(sourceSet.root);
  if (
    paths.length !== 14 ||
    JSON.stringify(paths) !==
      JSON.stringify(sourceSet.sources.map(({ path }) => path))
  )
    throw new Error("V5 authoritative source path set drifted.");
  for (const source of sourceSet.sources)
    await exactBinding(source, sourceSet.root);
}

async function verifyManagementLogPrefix(prefix) {
  const bytes = await readExactRegularContainedSource(
    prefix.path,
    PM_ROOT,
    null,
  );
  if (
    bytes.length < prefix.byteLength ||
    sha256(bytes.subarray(0, prefix.byteLength)) !== prefix.sha256
  )
    throw new Error("V5 management log prefix drifted.");
}

function validCandidateManifest(value, payload) {
  if (
    value?.schemaVersion !== 1 ||
    value.algorithm !== "SHA256(PATH_NUL_SHA256_LF)" ||
    value.fileCount !== payload.candidate.fileCount ||
    value.aggregateSha256 !== payload.candidate.aggregateSha256 ||
    !Array.isArray(value.files) ||
    value.files.length !== value.fileCount ||
    JSON.stringify(value.files.map(({ path }) => path)) !==
      JSON.stringify(value.files.map(({ path }) => path).sort()) ||
    new Set(value.files.map(({ path }) => path)).size !== value.fileCount
  )
    return false;
  const aggregate = createHash("sha256");
  for (const file of value.files) {
    if (
      !file ||
      JSON.stringify(Object.keys(file)) !==
        JSON.stringify(["path", "sha256"]) ||
      typeof file.path !== "string" ||
      file.path.includes("..") ||
      !/^[A-F0-9]{64}$/u.test(file.sha256)
    )
      return false;
    aggregate.update(`${file.path}\0${file.sha256}\n`, "utf8");
  }
  return aggregate.digest("hex").toUpperCase() === value.aggregateSha256;
}

async function verifyCandidate(payload) {
  const manifestBytes = await exactBinding(
    payload.candidate.manifest,
    REPO_ROOT,
  );
  const wrapperBytes = await exactBinding(payload.candidate.wrapper, REPO_ROOT);
  const manifest = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(manifestBytes),
  );
  const wrapper = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(wrapperBytes),
  );
  if (!validCandidateManifest(manifest, payload))
    throw new Error("V5 candidate manifest semantics are invalid.");
  for (const file of manifest.files) {
    const current = await readExactRegularContainedSource(
      resolve(REPO_ROOT, file.path),
      REPO_ROOT,
      file.sha256,
    );
    if (!current.length)
      throw new Error("V5 candidate contains an empty governed file.");
  }
  const policy = manifest.files.find(
    ({ path }) => path === "config/slice3/research-route-policy.v1.json",
  );
  if (
    !policy ||
    policy.sha256 !== POLICY_SHA256 ||
    sha256(
      await readExactRegularContainedSource(POLICY_PATH, REPO_ROOT, null),
    ) !== POLICY_SHA256
  )
    throw new Error("V5 research route policy is not equality-bound.");
  if (
    wrapper?.schemaVersion !== "matchbase.slice3-full-wrapper-result/v1" ||
    wrapper.result !== "PASS" ||
    wrapper.exitCode !== 0 ||
    !Number.isSafeInteger(wrapper.durationMs) ||
    wrapper.durationMs < 1 ||
    wrapper.providerCalls !== 0 ||
    wrapper.externalMutations !== 0 ||
    wrapper.candidate?.manifestSha256 !== payload.candidate.manifest.sha256 ||
    wrapper.candidate?.aggregateSha256 !== payload.candidate.aggregateSha256 ||
    wrapper.candidate?.fileCount !== payload.candidate.fileCount
  )
    throw new Error("V5 wrapper semantics are invalid.");
}

async function verifyReviewSources(payload) {
  for (const [
    index,
    binding,
  ] of payload.reviewEvidence.disciplineAudits.entries()) {
    const bytes = await exactBinding(binding, PM_ROOT);
    const audit = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes),
    );
    if (
      !exactKeys(audit, [
        "schemaVersion",
        "discipline",
        "status",
        "critical",
        "major",
        "minor",
        "candidate",
        "wrapperSha256",
        "providerCalls",
        "externalMutations",
        "activation",
      ]) ||
      audit.schemaVersion !==
        "matchbase.slice3-v5-successor-discipline-audit/v1" ||
      audit.discipline !== DISCIPLINES[index] ||
      audit.status !== "PASS" ||
      audit.critical !== 0 ||
      audit.major !== 0 ||
      audit.minor !== 0 ||
      !exactKeys(audit.candidate, [
        "commit",
        "tree",
        "manifestSha256",
        "aggregateSha256",
        "fileCount",
      ]) ||
      audit.candidate.commit !== payload.repository.commit ||
      audit.candidate.tree !== payload.repository.tree ||
      audit.candidate.manifestSha256 !== payload.candidate.manifest.sha256 ||
      audit.candidate.aggregateSha256 !== payload.candidate.aggregateSha256 ||
      audit.candidate.fileCount !== payload.candidate.fileCount ||
      audit.wrapperSha256 !== payload.candidate.wrapper.sha256 ||
      audit.providerCalls !== 0 ||
      audit.externalMutations !== 0 ||
      audit.activation !== false
    )
      throw new Error("V5 discipline audit semantics are invalid.");
  }
  const criticBytes = await exactBinding(
    payload.reviewEvidence.critic,
    PM_ROOT,
  );
  const critic = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(criticBytes),
  );
  if (
    !exactKeys(critic, [
      "schemaVersion",
      "status",
      "critical",
      "major",
      "minor",
      "candidate",
      "wrapperSha256",
      "sixAuditSha256s",
      "providerCalls",
      "externalMutations",
      "activation",
    ]) ||
    critic.schemaVersion !==
      "matchbase.slice3-v5-successor-final-integration-critic/v1" ||
    critic.status !== "PASS" ||
    critic.critical !== 0 ||
    critic.major !== 0 ||
    critic.minor !== 0 ||
    !exactKeys(critic.candidate, [
      "commit",
      "tree",
      "manifestSha256",
      "aggregateSha256",
      "fileCount",
    ]) ||
    critic.candidate.commit !== payload.repository.commit ||
    critic.candidate.tree !== payload.repository.tree ||
    critic.candidate.manifestSha256 !== payload.candidate.manifest.sha256 ||
    critic.candidate.aggregateSha256 !== payload.candidate.aggregateSha256 ||
    critic.candidate.fileCount !== payload.candidate.fileCount ||
    critic.wrapperSha256 !== payload.candidate.wrapper.sha256 ||
    JSON.stringify(critic.sixAuditSha256s) !==
      JSON.stringify(
        payload.reviewEvidence.disciplineAudits.map(({ sha256 }) => sha256),
      ) ||
    critic.providerCalls !== 0 ||
    critic.externalMutations !== 0 ||
    critic.activation !== false
  )
    throw new Error("V5 integration critic semantics are invalid.");
  await exactBinding(payload.reviewEvidence.preSignRole2Audit, PM_ROOT);
  const hosted = payload.reviewEvidence.hosted;
  const hostedBytes = await readExactRegularContainedSource(
    hosted.observationPath,
    PM_ROOT,
    hosted.observationSha256,
  );
  const observation = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(hostedBytes),
  );
  validateV5HostedObservation(observation, hosted);
}

async function verifyResponseContract(binding) {
  const bytes = await exactBinding(binding, REPO_ROOT);
  const value = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
  );
  validateV5ResponseContractArtifact(value);
}

async function verifyGovernanceSources(payload) {
  for (const binding of [
    payload.governanceBindings.ownerDecision,
    payload.governanceBindings.oneGetAllocation,
    payload.governanceBindings.transitionDecision,
    payload.governanceBindings.successorAuthorization,
    payload.governanceBindings.payloadSchema,
    payload.governanceBindings.signingContract,
    payload.governanceBindings.custodyEvidence,
    payload.governanceBindings.revokedEd25519Record,
    payload.governanceBindings.priorHttp401,
    payload.governanceBindings.forensicArchiveAudit,
    payload.governanceBindings.v4Ledger,
  ])
    await exactBinding(binding, PM_ROOT);
  await verifyResponseContract(payload.authorizationPolicy.responseContract);
}

export async function loadCurrentPinnedV5Acceptance({
  nowMs = Date.now(),
} = {}) {
  await Promise.all([
    assertCanonicalV5Workspace(),
    assertCanonicalV5ManagementRoot(),
  ]);
  await verifyPinnedV5PublicMaterials();
  const payloadAbsent = await absent(V5_TPM_CONTRACT.payloadPath);
  const envelopeAbsent = await absent(V5_TPM_CONTRACT.envelopePath);
  if (payloadAbsent && envelopeAbsent) return null;
  if (payloadAbsent !== envelopeAbsent)
    throw new Error("V5 acceptance payload/envelope pair is incomplete.");
  await assertCanonicalV5SigningRoot();
  const signingRoot = dirname(V5_TPM_CONTRACT.payloadPath);
  const [payloadBytes, envelopeBytes] = await Promise.all([
    readExactRegularContainedSource(
      V5_TPM_CONTRACT.payloadPath,
      signingRoot,
      null,
    ),
    readExactRegularContainedSource(
      V5_TPM_CONTRACT.envelopePath,
      signingRoot,
      null,
    ),
  ]);
  const verified = await verifyPinnedV5Role2Acceptance({
    payloadBytes,
    envelopeBytes,
    nowMs,
  });
  const payload = verified.payload;
  await Promise.all([
    verifyGovernanceSources(payload),
    verifyAuthoritativeSourceSet(payload.authoritativeSourceSet),
    verifyManagementLogPrefix(payload.managementLogPrefix),
    verifyCandidate(payload),
    verifyReviewSources(payload),
  ]);
  const head = git(["rev-parse", "HEAD"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  const originMain = git(["rev-parse", "origin/main"]);
  const branch = git(["branch", "--show-current"]);
  const originUrl = git(["remote", "get-url", "origin"]);
  if (
    head !== payload.repository.commit ||
    originMain !== head ||
    tree !== payload.repository.tree ||
    branch !== "main" ||
    git(["status", "--porcelain=v1"]) !== "" ||
    !new Set([
      "https://github.com/banihashem/INNOBASE-MatchBASE.git",
      "git@github.com:banihashem/INNOBASE-MatchBASE.git",
    ]).has(originUrl)
  )
    throw new Error("V5 repository clean parity or remote identity drifted.");
  return Object.freeze({
    ...verified,
    sourceSetSha256: sha256(
      Buffer.from(
        [
          payload.candidate.manifest.sha256,
          payload.candidate.wrapper.sha256,
          payload.managementLogPrefix.sha256,
          ...payload.reviewEvidence.disciplineAudits.map(
            ({ sha256 }) => sha256,
          ),
          payload.reviewEvidence.critic.sha256,
          payload.reviewEvidence.preSignRole2Audit.sha256,
          payload.reviewEvidence.hosted.observationSha256,
        ].join("\n"),
        "utf8",
      ),
    ),
  });
}

export function assertSameV5Acceptance(left, right) {
  if (
    !left ||
    !right ||
    left.payloadSha256 !== right.payloadSha256 ||
    left.signatureSha256 !== right.signatureSha256 ||
    left.sourceSetSha256 !== right.sourceSetSha256 ||
    left.payload.sessionId !== right.payload.sessionId ||
    left.payload.nonce !== right.payload.nonce
  )
    throw new Error("V5 signed acceptance or source set changed.");
}
