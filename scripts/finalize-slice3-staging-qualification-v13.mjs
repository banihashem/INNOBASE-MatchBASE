import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSanitizedQualificationEvidence } from "./lib/slice3-live-qualification-runner.mjs";
import { buildQualifiedStagingPolicy } from "./lib/slice3-staging-live-qualification-v1.mjs";

const AUTHORIZATION_ID =
  "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V13";
const AUTHORIZATION_SHA256 =
  "0C692AF190A46F19D8E4CA732D8E371F98507BFAAB2BB14C872EB4DE0FCBF0FD";
const EXECUTION_SIGNAL = "I_AUTHORIZE_STAGING_QUALIFICATION_CONVERGENCE_V13";
const SESSION_ID = "v6-CONVERGENCE-48E39AA2E1642E97";
const PRODUCTION_POLICY_SHA256 =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const STATE_ROOT = resolve(
  "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
);
const ROUTES = Object.freeze([
  Object.freeze({
    routePath: "gemini_direct",
    sessionId: "v6-6E67532C6108E5E5F7C17003",
    ledgerAggregateSha256:
      "9A1DC5C549ADCE3327887242DBF1378230CEBDE68912EB68F13E87FE884E951D",
    resultFile: "2-gemini_direct-result.json",
    resultFileSha256:
      "816D436F2B4D441A5B0FA554759FEBBC47FEB2AED23FC7AD8BF7DAA4EA020803",
  }),
  Object.freeze({
    routePath: "openrouter",
    sessionId: "v6-45C8ED78EF3EA2400B318F33",
    ledgerAggregateSha256:
      "207CEE3ED46973291018145D5CCC2126168C5E1556B0045828B05ACA86687F9E",
    resultFile: "4-openrouter-result.json",
    resultFileSha256:
      "BF759F61D615913191956EE1F45CDEA1C98DF81FB365DEA9AB5B92853B903EDC",
  }),
]);
const PATHS = Object.freeze({
  authorization: resolve(
    "governance/slice3-staging-live-qualification-convergence-authorization.v13.json",
  ),
  productionPolicy: resolve("config/slice3/research-route-policy.v1.json"),
  evidence: resolve("evidence/slice3/staging-live-qualification.v1.json"),
  stagingPolicy: resolve("config/slice3/research-route-policy.staging.v1.json"),
  manifest: resolve(
    "evidence/slice3/staging-live-qualification-manifest.v1.json",
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

async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(path, bytes, { flag: "wx" });
  return Object.freeze({ sha256: sha256(bytes), bytes: bytes.length });
}

async function ledgerIdentity(directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Qualification ledger contains a non-regular file.");
    }
    const bytes = await readFile(path);
    files.push({ name, sha256: sha256(bytes), bytes: bytes.length });
  }
  return Object.freeze({
    files: Object.freeze(files),
    aggregateSha256: sha256(JSON.stringify(files)),
  });
}

async function readBoundSources() {
  const authorizationBytes = await readFile(PATHS.authorization);
  if (sha256(authorizationBytes) !== AUTHORIZATION_SHA256) {
    throw new Error("Convergence authorization digest drifted.");
  }
  const authorization = JSON.parse(authorizationBytes.toString("utf8"));
  if (
    authorization?.schemaVersion !==
      "matchbase.slice3-staging-live-qualification-convergence-authorization/v13" ||
    authorization.authorizationId !== AUTHORIZATION_ID ||
    authorization.environment !== "staging" ||
    authorization.syntheticOnly !== true ||
    authorization.realUserDataAuthorized !== false ||
    authorization.accounting?.providerModelPostsConsumed !== 30 ||
    authorization.accounting?.maximumProviderModelPosts !== 50 ||
    authorization.accounting?.conservativeCostUsdConsumed !== 2.1495265 ||
    authorization.accounting?.maximumCostUsd !== 100 ||
    authorization.accounting?.convergenceExternalHttpCalls !== 0 ||
    authorization.accounting?.convergenceProviderModelPosts !== 0 ||
    authorization.historicalSessionsImmutable !== true ||
    authorization.productionPolicyMutationAuthorized !== false ||
    authorization.stagingPolicyGenerationAuthorized !== true ||
    authorization.cloudMutationAuthorized !== false
  ) {
    throw new Error("Convergence authorization is invalid.");
  }
  const productionPolicyBytes = await readFile(PATHS.productionPolicy);
  if (sha256(productionPolicyBytes) !== PRODUCTION_POLICY_SHA256) {
    throw new Error("Production policy digest drifted.");
  }
  const productionPolicy = JSON.parse(productionPolicyBytes.toString("utf8"));
  const routeEvidence = [];
  const routeBindings = [];
  for (const route of ROUTES) {
    const directory = join(STATE_ROOT, route.sessionId);
    const ledger = await ledgerIdentity(directory);
    if (ledger.aggregateSha256 !== route.ledgerAggregateSha256) {
      throw new Error(`${route.routePath} ledger digest drifted.`);
    }
    const resultPath = join(directory, route.resultFile);
    const resultBytes = await readFile(resultPath);
    if (sha256(resultBytes) !== route.resultFileSha256) {
      throw new Error(`${route.routePath} result digest drifted.`);
    }
    const evidence = validateSanitizedQualificationEvidence(
      JSON.parse(resultBytes.toString("utf8")),
    );
    if (
      evidence.routePath !== route.routePath ||
      evidence.terminalDisposition !== "PASS"
    ) {
      throw new Error(`${route.routePath} is not a PASS route evidence.`);
    }
    routeEvidence.push(evidence);
    routeBindings.push({
      routePath: route.routePath,
      sessionId: route.sessionId,
      ledgerAggregateSha256: ledger.aggregateSha256,
      resultFile: route.resultFile,
      resultFileSha256: route.resultFileSha256,
    });
  }
  return Object.freeze({
    authorizationBytes,
    productionPolicyBytes,
    productionPolicy,
    routeEvidence: Object.freeze(routeEvidence),
    routeBindings: Object.freeze(routeBindings),
  });
}

export async function assessConvergence() {
  const source = await readBoundSources();
  const blockers = [];
  for (const [path, blocker] of [
    [join(STATE_ROOT, SESSION_ID), "CONVERGENCE_SESSION_ALREADY_EXISTS"],
    [PATHS.evidence, "STAGING_EVIDENCE_ALREADY_EXISTS"],
    [PATHS.stagingPolicy, "STAGING_POLICY_ALREADY_EXISTS"],
    [PATHS.manifest, "STAGING_MANIFEST_ALREADY_EXISTS"],
  ]) {
    if (!(await absent(path))) blockers.push(blocker);
  }
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-convergence-preflight/v13",
    disposition: blockers.length === 0 ? "READY_TO_CONVERGE" : "BLOCKED",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    routePaths: source.routeEvidence.map((item) => item.routePath),
    blockers: Object.freeze(blockers),
    externalHttpCalls: 0,
    providerModelPosts: 0,
    credentialValuesInspected: false,
    cloudMutations: 0,
  });
}

export async function executeConvergence(now = () => new Date()) {
  const preflight = await assessConvergence();
  if (preflight.disposition !== "READY_TO_CONVERGE") return preflight;
  const source = await readBoundSources();
  const completedAt = now().toISOString();
  const stateDirectory = join(STATE_ROOT, SESSION_ID);
  await mkdir(stateDirectory);
  await writeJsonExclusive(join(stateDirectory, "00-authorization.json"), {
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-convergence-session/v13",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    sourceAuthorizationSha256: sha256(source.authorizationBytes),
    routeBindings: source.routeBindings,
    externalHttpCalls: 0,
    providerModelPosts: 0,
    credentialValuesPersisted: false,
  });
  const stagingPolicy = buildQualifiedStagingPolicy({
    productionPolicy: source.productionPolicy,
    routeEvidence: source.routeEvidence,
    evaluatedAt: completedAt,
  });
  const selectedRouteCostUsd = Number(
    source.routeEvidence
      .reduce((sum, item) => sum + item.costAmountUsd, 0)
      .toFixed(9),
  );
  const sourceBinding = {
    authorizationSha256: sha256(source.authorizationBytes),
    productionPolicySha256: sha256(source.productionPolicyBytes),
    routeBindings: source.routeBindings,
  };
  const evidenceWrite = await writeJsonExclusive(PATHS.evidence, {
    schemaVersion: "matchbase.slice3-staging-live-qualification-evidence/v3",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    environment: "staging",
    fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
    syntheticOnly: true,
    containsRealUserData: false,
    sourceBinding,
    callAccounting: {
      convergenceExternalHttpCalls: 0,
      convergenceProviderModelPosts: 0,
      totalProviderModelPostsConsumed: 30,
      maximumProviderModelPosts: 50,
      retriesWithinConvergence: 0,
      fallbacks: 0,
    },
    cost: {
      selectedRouteEvidenceAmountUsd: selectedRouteCostUsd,
      conservativeTotalConsumedUsd: 2.1495265,
      maximumOwnerCostUsd: 100,
      currency: "USD",
    },
    routeEvidence: source.routeEvidence,
    credentialValuesDisclosed: false,
    credentialValuesPersisted: false,
    rawProviderPayloadPersisted: false,
    productionPolicyMutated: false,
    cloudMutations: 0,
    completedAt,
  });
  const policyWrite = await writeJsonExclusive(
    PATHS.stagingPolicy,
    stagingPolicy,
  );
  await writeJsonExclusive(join(stateDirectory, "01-terminal-summary.json"), {
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-convergence-terminal/v13",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    disposition: "PASS",
    routePaths: source.routeEvidence.map((item) => item.routePath),
    evidenceSha256: evidenceWrite.sha256,
    stagingPolicySha256: policyWrite.sha256,
    externalHttpCalls: 0,
    providerModelPosts: 0,
    completedAt,
  });
  const ledger = await ledgerIdentity(stateDirectory);
  const manifestWrite = await writeJsonExclusive(PATHS.manifest, {
    schemaVersion: "matchbase.slice3-staging-live-qualification-manifest/v3",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    evidencePath: relative(resolve("."), PATHS.evidence).replaceAll("\\", "/"),
    evidenceSha256: evidenceWrite.sha256,
    stagingPolicyPath: relative(resolve("."), PATHS.stagingPolicy).replaceAll(
      "\\",
      "/",
    ),
    stagingPolicySha256: policyWrite.sha256,
    sourceBinding,
    ledger,
    completedAt,
  });
  await chmod(stateDirectory, 0o555).catch(() => {});
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-convergence-execution/v13",
    disposition: "PASS",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    externalHttpCalls: 0,
    providerModelPosts: 0,
    evidenceSha256: evidenceWrite.sha256,
    stagingPolicySha256: policyWrite.sha256,
    manifestSha256: manifestWrite.sha256,
    productionPolicyMutated: false,
    cloudMutations: 0,
  });
}

export async function run(
  args = process.argv.slice(2),
  environment = process.env,
) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--execute"))) {
    throw new Error("Convergence accepts only optional --execute.");
  }
  if (args.length === 0) return assessConvergence();
  if (
    environment.MATCHBASE_SLICE3_STAGING_LIVE_QUALIFICATION !== EXECUTION_SIGNAL
  ) {
    return Object.freeze({
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-convergence-preflight/v13",
      disposition: "BLOCKED",
      blockers: Object.freeze(["EXACT_CONVERGENCE_EXECUTION_SIGNAL_ABSENT"]),
      externalHttpCalls: 0,
      providerModelPosts: 0,
      cloudMutations: 0,
    });
  }
  return executeConvergence();
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!["PASS", "READY_TO_CONVERGE"].includes(result.disposition)) {
    process.exitCode = 2;
  }
}
