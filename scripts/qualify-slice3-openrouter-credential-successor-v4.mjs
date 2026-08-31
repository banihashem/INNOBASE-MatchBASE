import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCanonicalCredentials } from "./lib/slice3-live-qualification-runner.mjs";
import { reduceV5CredentialResponse } from "./lib/slice3-live-qualification-v5.mjs";

const AUTHORIZATION_ID =
  "OWNER-SLICE3-OPENROUTER-CREDENTIAL-GATE-2026-08-30-V4";
const EXECUTION_SIGNAL = "I_AUTHORIZE_ONE_OPENROUTER_CREDENTIAL_STATUS_GET_V4";
const SESSION_ID = "v6-6488F0D1148B973D0B912F38";
const AUTHORIZATION_SHA256 =
  "17A581AB5942C481D883514704B84F15F8C97808BB8E30181884047E76221D7F";
const PREDECESSOR_SESSION_ID = "v6-A06CD705B4D7733589780E4C";
const PREDECESSOR_LEDGER_SHA256 =
  "C05F31E05E0BAAE15E6229971ED6AEB6D3EA245EC6B1DD6E07BC769B2F18C9E2";
const ENDPOINT = "https://openrouter.ai/api/v1/key";

const DEFAULTS = Object.freeze({
  authorizationPath: resolve(
    "governance/slice3-openrouter-credential-successor-authorization.v4.json",
  ),
  credentialPath: resolve("APIKeys.md"),
  executorPath: resolve(
    "scripts/qualify-slice3-openrouter-credential-successor-v4.mjs",
  ),
  reducerPath: resolve("scripts/lib/slice3-live-qualification-v5.mjs"),
  predecessorStateRoot: resolve(
    "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
  ),
  stateRoot: resolve(
    "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
  ),
});

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function readRegular(path, root = dirname(path)) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink()) {
    throw new Error("Credential-gate source must be a regular file.");
  }
  const fileReal = await realpath(path);
  const rel = relative(rootReal, fileReal);
  if (!rel || rel.startsWith("..") || resolve(rootReal, rel) !== fileReal) {
    throw new Error("Credential-gate source escaped its root.");
  }
  return readFile(fileReal);
}

async function ledgerIdentity(directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const bytes = await readRegular(join(directory, name), directory);
    files.push(
      Object.freeze({ name, sha256: sha256(bytes), bytes: bytes.length }),
    );
  }
  return Object.freeze({
    files: Object.freeze(files),
    aggregateSha256: sha256(JSON.stringify(files)),
  });
}

async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(path, bytes, { flag: "wx" });
  return Object.freeze({ sha256: sha256(bytes), bytes: bytes.length });
}

function validateAuthorization(value) {
  if (
    value?.schemaVersion !==
      "matchbase.slice3-openrouter-credential-successor-authorization/v4" ||
    value.authorizationId !== AUTHORIZATION_ID ||
    value.environment !== "staging" ||
    value.syntheticOnly !== true ||
    value.realUserDataAuthorized !== false ||
    value.predecessor?.sessionId !== PREDECESSOR_SESSION_ID ||
    value.predecessor?.ledgerAggregateSha256 !== PREDECESSOR_LEDGER_SHA256 ||
    value.predecessor?.openRouterHttpStatus !== 402 ||
    value.predecessor?.cumulativeProviderModelPosts !== 3 ||
    value.predecessor?.cumulativeCostUsd !== 0.0334865 ||
    value.ownerCeiling?.maximumProviderCalls !== 50 ||
    value.ownerCeiling?.maximumCostUsd !== 100 ||
    value.ownerCeiling?.remainingProviderCallsBeforeV4 !== 47 ||
    value.ownerCeiling?.remainingCostUsdBeforeV4 !== 99.9665135 ||
    value.allocation?.endpoint !== ENDPOINT ||
    value.allocation?.method !== "GET" ||
    value.allocation?.maximumCredentialGets !== 1 ||
    value.allocation?.maximumProviderModelPosts !== 0 ||
    value.allocation?.maximumSearchCalls !== 0 ||
    value.allocation?.maximumCostUsd !== 0 ||
    value.allocation?.retries !== 0 ||
    value.allocation?.fallbacks !== 0 ||
    value.requiredSuccess?.paidCredential !== true ||
    value.requiredSuccess?.managementKey !== false ||
    value.requiredSuccess?.provisioningKey !== false ||
    value.requiredSuccess?.unexpired !== true ||
    value.requiredSuccess?.positiveRemainingQuota !== true ||
    value.credentialValuePersistenceAuthorized !== false ||
    value.rawResponsePersistenceAuthorized !== false ||
    value.accountMutationAuthorized !== false ||
    value.cloudMutationAuthorized !== false ||
    value.deploymentAuthorized !== false
  ) {
    throw new Error("Credential-gate authorization is invalid.");
  }
  return value;
}

async function sources(paths) {
  const [authorizationBytes, executorBytes, reducerBytes] = await Promise.all([
    readRegular(paths.authorizationPath),
    readRegular(paths.executorPath),
    readRegular(paths.reducerPath),
  ]);
  if (sha256(authorizationBytes) !== AUTHORIZATION_SHA256) {
    throw new Error("Credential-gate authorization digest drifted.");
  }
  const predecessor = await ledgerIdentity(
    join(paths.predecessorStateRoot, PREDECESSOR_SESSION_ID),
  );
  if (predecessor.aggregateSha256 !== PREDECESSOR_LEDGER_SHA256) {
    throw new Error("Credential-gate predecessor ledger drifted.");
  }
  validateAuthorization(JSON.parse(authorizationBytes.toString("utf8")));
  return Object.freeze({
    authorizationSha256: sha256(authorizationBytes),
    predecessorLedgerSha256: predecessor.aggregateSha256,
    executorSha256: sha256(executorBytes),
    reducerSha256: sha256(reducerBytes),
  });
}

function resolved(overrides = {}) {
  return Object.freeze({ ...DEFAULTS, ...overrides });
}

export async function assessCredentialGate(overrides = {}) {
  const paths = resolved(overrides);
  const sourceBinding = await sources(paths);
  const blockers = [];
  const credential = await lstat(paths.credentialPath);
  if (!credential.isFile() || credential.isSymbolicLink()) {
    blockers.push("CANONICAL_CREDENTIAL_FILE_INVALID");
  }
  if (!(await absent(join(paths.stateRoot, SESSION_ID)))) {
    blockers.push("CREDENTIAL_GATE_SESSION_ALREADY_EXISTS");
  }
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-openrouter-credential-successor-preflight/v4",
    disposition:
      blockers.length === 0
        ? "READY_FOR_ONE_CREDENTIAL_GET"
        : "BLOCKED_PREREQUISITE",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    predecessorSessionId: PREDECESSOR_SESSION_ID,
    sourceBinding,
    maximumCredentialGets: 1,
    maximumProviderModelPosts: 0,
    maximumCostUsd: 0,
    blockers: Object.freeze(blockers),
    credentialValuesInspected: false,
    credentialGets: 0,
    providerModelPosts: 0,
    billableCalls: 0,
    cloudMutations: 0,
  });
}

export async function executeCredentialGate({
  fetchImpl = fetch,
  paths: overrides = {},
  verificationInstantMs = Date.now(),
} = {}) {
  const paths = resolved(overrides);
  const preflight = await assessCredentialGate(paths);
  if (preflight.disposition !== "READY_FOR_ONE_CREDENTIAL_GET")
    return preflight;
  const sourceBinding = await sources(paths);
  const credentials = await readCanonicalCredentials(paths.credentialPath);
  await mkdir(paths.stateRoot, { recursive: true });
  const stateDirectory = join(paths.stateRoot, SESSION_ID);
  await mkdir(stateDirectory);
  await writeJsonExclusive(join(stateDirectory, "00-authorization.json"), {
    schemaVersion:
      "matchbase.slice3-openrouter-credential-successor-session/v4",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    predecessorSessionId: PREDECESSOR_SESSION_ID,
    maximumCredentialGets: 1,
    maximumProviderModelPosts: 0,
    maximumCostUsd: 0,
    sourceBinding,
    credentialValuesPersisted: false,
  });
  await writeJsonExclusive(join(stateDirectory, "01-key-get-reserved.json"), {
    schemaVersion:
      "matchbase.slice3-openrouter-credential-successor-reservation/v4",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    endpointCapability: "OPENROUTER_KEY_STATUS_READ",
    method: "GET",
    retries: 0,
    fallbacks: 0,
    credentialValuesPersisted: false,
  });
  let result;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("credential_gate_timeout"),
    10_000,
  );
  timer.unref();
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${credentials.MATCHBASE_OPENROUTER_API_KEY}`,
      },
    });
    result = await reduceV5CredentialResponse(response, controller, {
      verificationInstantMs,
    });
  } catch {
    result = Object.freeze({
      schemaVersion: "matchbase.slice3-v5-credential-result/v2",
      disposition: "BLOCKED_CREDENTIAL",
      sanitizedEnvelope: Object.freeze({
        endpointCapability: "OPENROUTER_KEY_STATUS_READ",
        httpStatus: null,
        callOccurred: null,
        urlValid: null,
        contentTypeValid: null,
        schemaValid: false,
        paidCredential: null,
        failureClass: "UNKNOWN_TRANSPORT_TIMEOUT_OR_REDIRECT",
        responseBodyPersisted: false,
        rawHeadersPersisted: false,
        decisionDiagnostics: Object.freeze([]),
      }),
      allocationConsumed: true,
      credentialGets: 1,
      modelPosts: 0,
      searchCalls: 0,
      metadataGets: 0,
      retries: 0,
      fallbacks: 0,
      billableCalls: 0,
      providerQualificationCalls: 0,
      accountMutations: 0,
      cloudMutations: 0,
      deploymentMutations: 0,
      externalMutations: 0,
      activation: false,
      terminal: true,
    });
  } finally {
    clearTimeout(timer);
  }
  await writeJsonExclusive(
    join(stateDirectory, "02-key-get-result.json"),
    result,
  );
  const ledger = await ledgerIdentity(stateDirectory);
  await writeJsonExclusive(join(stateDirectory, "03-terminal-manifest.json"), {
    schemaVersion:
      "matchbase.slice3-openrouter-credential-successor-manifest/v4",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    disposition: result.disposition,
    sanitizedEnvelopeDigest:
      result.sanitizedEnvelopeDigest ??
      sha256(JSON.stringify(result.sanitizedEnvelope)),
    sourceBinding,
    predecessorLedgerSha256: PREDECESSOR_LEDGER_SHA256,
    preManifestLedger: ledger,
    credentialValuesDisclosed: false,
    rawResponsePersisted: false,
    accountMutations: 0,
    cloudMutations: 0,
  });
  await chmod(stateDirectory, 0o555).catch(() => {});
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-openrouter-credential-successor-execution/v4",
    disposition: result.disposition,
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    failureClass: result.sanitizedEnvelope.failureClass,
    paidCredential: result.sanitizedEnvelope.paidCredential,
    schemaValid: result.sanitizedEnvelope.schemaValid,
    httpStatus: result.sanitizedEnvelope.httpStatus,
    credentialGets: 1,
    providerModelPosts: 0,
    billableCalls: 0,
    costUsd: 0,
    credentialValuesDisclosed: false,
    rawResponsePersisted: false,
    accountMutations: 0,
    cloudMutations: 0,
  });
}

export async function run(
  args = process.argv.slice(2),
  environment = process.env,
) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--execute"))) {
    throw new Error("Credential gate accepts only optional --execute.");
  }
  if (args.length === 0) return assessCredentialGate();
  if (
    environment.MATCHBASE_SLICE3_OPENROUTER_CREDENTIAL_GATE !== EXECUTION_SIGNAL
  ) {
    return Object.freeze({
      schemaVersion:
        "matchbase.slice3-openrouter-credential-successor-preflight/v4",
      disposition: "BLOCKED_PREREQUISITE",
      blockers: Object.freeze(["EXACT_CREDENTIAL_GATE_SIGNAL_ABSENT"]),
      credentialGets: 0,
      providerModelPosts: 0,
      billableCalls: 0,
      cloudMutations: 0,
    });
  }
  return executeCredentialGate();
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    result.disposition !== "READY_FOR_ONE_CREDENTIAL_GET" &&
    result.disposition !==
      "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION"
  ) {
    process.exitCode = 2;
  }
}

export const SLICE3_OPENROUTER_CREDENTIAL_SUCCESSOR_V4 = Object.freeze({
  authorizationId: AUTHORIZATION_ID,
  authorizationSha256: AUTHORIZATION_SHA256,
  executionSignal: EXECUTION_SIGNAL,
  sessionId: SESSION_ID,
  predecessorSessionId: PREDECESSOR_SESSION_ID,
  predecessorLedgerSha256: PREDECESSOR_LEDGER_SHA256,
  endpoint: ENDPOINT,
  defaultPaths: DEFAULTS,
});
