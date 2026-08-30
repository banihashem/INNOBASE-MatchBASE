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
import { validateResearchRoutePolicy } from "../../packages/ai-evidence/dist/src/research-route-policy.js";
import {
  buildGeminiQualificationRequest,
  buildOpenRouterQualificationRequest,
  executeGeminiQualificationCall,
  executeOpenRouterQualificationCall,
  qualificationWorstCaseCostUsd,
  readCanonicalCredentials,
  validateSanitizedQualificationEvidence,
} from "./slice3-live-qualification-runner.mjs";

const AUTHORIZATION_ID =
  "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V1";
const AUTHORIZATION_SHA256 =
  "9E61AFB728AE0F77C3E2E129B212D8E82C0D701357BB6B6478D144E70F4A0174";
const PRODUCTION_POLICY_SHA256 =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const SESSION_ID = "v6-40CB8BEE95ABACB012107300";
const FIXTURE_ID = "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN";
const MAX_EXTERNAL_HTTP_CALLS = 50;
const MAX_MODEL_POSTS = 2;
const MAX_COST_USD = 100;
const EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULTS = Object.freeze({
  authorizationPath: resolve(
    "governance/slice3-staging-live-qualification-authorization.v1.json",
  ),
  productionPolicyPath: resolve("config/slice3/research-route-policy.v1.json"),
  credentialPath: resolve("APIKeys.md"),
  executorPath: resolve("scripts/lib/slice3-staging-live-qualification-v1.mjs"),
  runnerPath: resolve("scripts/lib/slice3-live-qualification-runner.mjs"),
  stateRoot: resolve(
    "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
  ),
  evidencePath: resolve("evidence/slice3/staging-live-qualification.v1.json"),
  policyPath: resolve("config/slice3/research-route-policy.staging.v1.json"),
  manifestPath: resolve(
    "evidence/slice3/staging-live-qualification-manifest.v1.json",
  ),
});

const AUTHORIZATION_FIELDS = new Set([
  "schemaVersion",
  "authorizationId",
  "environment",
  "syntheticOnly",
  "realUserDataAuthorized",
  "fixtureId",
  "maximumExternalHttpCalls",
  "maximumProviderModelPosts",
  "maximumCostUsd",
  "currency",
  "routeOrder",
  "openRouterRequestPolicy",
  "directGeminiRequestPolicy",
  "productionPolicyMutationAuthorized",
  "cloudMutationAuthorized",
  "deploymentAuthorized",
]);

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

function exactKeys(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a closed object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
  return value;
}

async function readRegularFile(path, root = dirname(path)) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink()) {
    throw new Error("Qualification input must be a regular non-linked file.");
  }
  const fileReal = await realpath(path);
  const rel = relative(rootReal, fileReal);
  if (!rel || rel.startsWith("..") || resolve(rootReal, rel) !== fileReal) {
    throw new Error("Qualification input escaped its expected root.");
  }
  return readFile(fileReal);
}

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function validateAuthorization(value) {
  exactKeys(value, AUTHORIZATION_FIELDS, "Staging authorization");
  const openRouter = exactKeys(
    value.openRouterRequestPolicy,
    new Set([
      "zdr",
      "dataCollection",
      "requireParameters",
      "allowFallbacks",
      "providerOnly",
      "providerOrder",
      "servedProviderId",
      "servedModelId",
    ]),
    "OpenRouter authorization",
  );
  const direct = exactKeys(
    value.directGeminiRequestPolicy,
    new Set([
      "servedProviderId",
      "servedModelId",
      "providerNativeSearchRequired",
    ]),
    "Direct Gemini authorization",
  );
  if (
    value.schemaVersion !==
      "matchbase.slice3-staging-live-qualification-authorization/v1" ||
    value.authorizationId !== AUTHORIZATION_ID ||
    value.environment !== "staging" ||
    value.syntheticOnly !== true ||
    value.realUserDataAuthorized !== false ||
    value.fixtureId !== FIXTURE_ID ||
    value.maximumExternalHttpCalls !== MAX_EXTERNAL_HTTP_CALLS ||
    value.maximumExternalHttpCalls > 50 ||
    value.maximumProviderModelPosts !== MAX_MODEL_POSTS ||
    value.maximumCostUsd !== MAX_COST_USD ||
    value.maximumCostUsd <= 0 ||
    value.maximumCostUsd > 100 ||
    value.currency !== "USD" ||
    JSON.stringify(value.routeOrder) !==
      JSON.stringify(["gemini_direct", "openrouter"]) ||
    openRouter.zdr !== true ||
    openRouter.dataCollection !== "deny" ||
    openRouter.requireParameters !== true ||
    openRouter.allowFallbacks !== false ||
    JSON.stringify(openRouter.providerOnly) !==
      JSON.stringify(["google-vertex"]) ||
    JSON.stringify(openRouter.providerOrder) !==
      JSON.stringify(["google-vertex"]) ||
    openRouter.servedProviderId !== "google-vertex" ||
    openRouter.servedModelId !== "google/gemini-3.6-flash" ||
    direct.servedProviderId !== "google" ||
    direct.servedModelId !== "gemini-3.6-flash" ||
    direct.providerNativeSearchRequired !== true ||
    value.productionPolicyMutationAuthorized !== false ||
    value.cloudMutationAuthorized !== false ||
    value.deploymentAuthorized !== false
  ) {
    throw new Error("Staging qualification authorization is invalid.");
  }
  return value;
}

function validateBlockedProductionPolicy(policy) {
  if (
    policy?.schemaVersion !== "research-route-policy.v1" ||
    policy.environment !== "production" ||
    policy.liveActivation !== "blocked" ||
    !Array.isArray(policy.routes) ||
    policy.routes.length !== 2 ||
    policy.routes[0]?.path !== "gemini_direct" ||
    policy.routes[1]?.path !== "openrouter" ||
    policy.routes.some(
      (route, index) =>
        route.enabled !== false ||
        route.liveQualified !== false ||
        route.fallbackPosition !== index ||
        route.parameterPolicy?.requireParameters !== true ||
        route.parameterPolicy?.allowFallbacks !== false ||
        route.parameterPolicy?.maxAttempts !== 1 ||
        route.parameterPolicy?.backoffMs !== 0,
    )
  ) {
    throw new Error("Frozen production policy is not safely blocked.");
  }
  return policy;
}

function validateFrozenRequests(routes) {
  const direct = buildGeminiQualificationRequest(routes[0]);
  const openRouter = buildOpenRouterQualificationRequest(routes[1]);
  const directBody = JSON.parse(direct.body);
  const routerBody = JSON.parse(openRouter.body);
  if (
    JSON.stringify(directBody.tools) !==
      JSON.stringify([{ google_search: {} }]) ||
    directBody.generationConfig?.maxOutputTokens !== 2048 ||
    routerBody.max_tokens !== 2048 ||
    JSON.stringify(routerBody.provider) !==
      JSON.stringify({
        zdr: true,
        data_collection: "deny",
        only: ["google-vertex"],
        order: ["google-vertex"],
        require_parameters: true,
        allow_fallbacks: false,
      })
  ) {
    throw new Error("Frozen qualification request policy drifted.");
  }
  return Object.freeze({ direct, openRouter });
}

async function sourceBinding(paths) {
  const [authorizationBytes, policyBytes, executorBytes, runnerBytes] =
    await Promise.all([
      readRegularFile(paths.authorizationPath),
      readRegularFile(paths.productionPolicyPath),
      readRegularFile(paths.executorPath),
      readRegularFile(paths.runnerPath),
    ]);
  if (sha256(authorizationBytes) !== AUTHORIZATION_SHA256) {
    throw new Error("Staging authorization digest drifted.");
  }
  if (sha256(policyBytes) !== PRODUCTION_POLICY_SHA256) {
    throw new Error("Frozen production policy digest drifted.");
  }
  const authorization = validateAuthorization(
    JSON.parse(authorizationBytes.toString("utf8")),
  );
  const productionPolicy = validateBlockedProductionPolicy(
    JSON.parse(policyBytes.toString("utf8")),
  );
  const requests = validateFrozenRequests(productionPolicy.routes);
  const binding = Object.freeze({
    authorizationSha256: sha256(authorizationBytes),
    productionPolicySha256: sha256(policyBytes),
    executorSha256: sha256(executorBytes),
    runnerSha256: sha256(runnerBytes),
  });
  return Object.freeze({ authorization, productionPolicy, requests, binding });
}

function resolvePaths(overrides = {}) {
  return Object.freeze({ ...DEFAULTS, ...overrides });
}

export async function assessStagingLiveQualification(overrides = {}) {
  const paths = resolvePaths(overrides);
  const source = await sourceBinding(paths);
  const stateDirectory = join(paths.stateRoot, SESSION_ID);
  const credentialItem = await lstat(paths.credentialPath);
  const blockers = [];
  if (!credentialItem.isFile() || credentialItem.isSymbolicLink()) {
    blockers.push("CANONICAL_CREDENTIAL_FILE_INVALID");
  }
  for (const [path, reason] of [
    [stateDirectory, "ONE_USE_SESSION_ALREADY_EXISTS"],
    [paths.evidencePath, "QUALIFICATION_EVIDENCE_ALREADY_EXISTS"],
    [paths.policyPath, "STAGING_POLICY_ALREADY_EXISTS"],
    [paths.manifestPath, "QUALIFICATION_MANIFEST_ALREADY_EXISTS"],
  ]) {
    if (!(await absent(path))) blockers.push(reason);
  }
  const worstCaseCostUsd = qualificationWorstCaseCostUsd();
  if (
    worstCaseCostUsd <= 0 ||
    worstCaseCostUsd > source.authorization.maximumCostUsd
  ) {
    blockers.push("QUALIFICATION_COST_CAP_INVALID");
  }
  return Object.freeze({
    schemaVersion: "matchbase.slice3-staging-live-qualification-preflight/v1",
    disposition:
      blockers.length === 0 ? "READY_TO_QUALIFY" : "BLOCKED_PREREQUISITE",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    syntheticOnly: true,
    fixtureId: FIXTURE_ID,
    maximumExternalHttpCalls: MAX_EXTERNAL_HTTP_CALLS,
    maximumProviderModelPosts: MAX_MODEL_POSTS,
    maximumCostUsd: MAX_COST_USD,
    worstCaseCostUsd,
    sourceBinding: source.binding,
    blockers: Object.freeze(blockers),
    credentialValuesInspected: false,
    externalHttpCalls: 0,
    providerModelPosts: 0,
    billableCalls: 0,
    cloudMutations: 0,
  });
}

function isoPlus(instant, milliseconds) {
  return new Date(new Date(instant).getTime() + milliseconds).toISOString();
}

export function buildQualifiedStagingPolicy({
  productionPolicy,
  routeEvidence,
  evaluatedAt,
}) {
  validateBlockedProductionPolicy(productionPolicy);
  if (
    !Array.isArray(routeEvidence) ||
    routeEvidence.length !== 2 ||
    routeEvidence[0]?.routePath !== "gemini_direct" ||
    routeEvidence[1]?.routePath !== "openrouter"
  ) {
    throw new Error("Qualified route evidence is incomplete or unordered.");
  }
  routeEvidence.forEach(validateSanitizedQualificationEvidence);
  const instant = new Date(evaluatedAt);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("Staging policy evaluation time is invalid.");
  }
  const canonicalAt = instant.toISOString();
  const policy = {
    ...structuredClone(productionPolicy),
    policyVersion: "slice3-routes.2026-08-30.staging-qualified-v1",
    environment: "staging",
    evaluatedAt: canonicalAt,
    liveActivation: "enabled",
    routes: productionPolicy.routes.map((route, index) => ({
      ...structuredClone(route),
      enabled: true,
      liveQualified: true,
      dataHandling: {
        ...structuredClone(route.dataHandling),
        evidenceVersion:
          "slice3-provider-evidence.2026-08-30.staging-live-qualified-v1",
        evidenceAccessedAt: canonicalAt,
        evidenceExpiresAt: isoPlus(canonicalAt, EVIDENCE_TTL_MS),
        paidPath: "verified",
        retentionTrainingPosture:
          route.path === "openrouter" ? "verified_zdr" : "verified_no_training",
      },
      costPolicy: {
        ...structuredClone(route.costPolicy),
        pricingState: "known",
        pricingVersion: routeEvidence[index].pricingVersion,
        currency: "USD",
        accountingMode:
          route.path === "openrouter"
            ? "provider_reported"
            : "conservative_estimate",
      },
    })),
  };
  return validateResearchRoutePolicy(policy);
}

async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(path, bytes, { flag: "wx" });
  return Object.freeze({ bytes, sha256: sha256(bytes) });
}

function sanitizedFailure(error, routePath, externalHttpCalls, modelPosts) {
  const observed = error?.failure;
  return Object.freeze({
    schemaVersion: "matchbase.slice3-staging-live-qualification-failure/v1",
    terminalDisposition: "FAIL",
    routePath,
    reasonCode:
      typeof observed?.reasonCode === "string"
        ? observed.reasonCode
        : "QUALIFICATION_INTERNAL_FAILURE",
    phase:
      typeof observed?.phase === "string"
        ? observed.phase
        : "EVIDENCE_VALIDATION",
    callOccurred:
      typeof observed?.callOccurred === "boolean"
        ? observed.callOccurred
        : modelPosts > 0,
    httpStatus:
      Number.isInteger(observed?.httpStatus) && observed.httpStatus >= 100
        ? observed.httpStatus
        : null,
    costState:
      observed?.costState === "provider_reported" ||
      observed?.costState === "conservative_estimate"
        ? observed.costState
        : "unknown",
    costAmountUsd:
      Number.isFinite(observed?.costAmountUsd) && observed.costAmountUsd > 0
        ? observed.costAmountUsd
        : null,
    requestDigest:
      typeof observed?.requestDigest === "string" &&
      /^[A-F0-9]{64}$/u.test(observed.requestDigest)
        ? observed.requestDigest
        : null,
    externalHttpCalls,
    providerModelPosts: modelPosts,
    credentialValuesDisclosed: false,
    rawProviderPayloadPersisted: false,
    recordedAt: new Date().toISOString(),
  });
}

function trackedFetch(fetchImpl, counters) {
  return async (url, options = {}) => {
    if (counters.externalHttpCalls >= MAX_EXTERNAL_HTTP_CALLS) {
      throw new Error("Qualification external call ceiling reached.");
    }
    const method = options.method ?? "GET";
    const target = String(url);
    const isModelPost =
      method === "POST" &&
      (target.startsWith("https://generativelanguage.googleapis.com/") ||
        target === "https://openrouter.ai/api/v1/chat/completions");
    if (isModelPost) {
      if (counters.providerModelPosts >= MAX_MODEL_POSTS) {
        throw new Error("Qualification model-call ceiling reached.");
      }
      const expected =
        counters.providerModelPosts === 0
          ? "https://generativelanguage.googleapis.com/"
          : "https://openrouter.ai/api/v1/chat/completions";
      if (
        (counters.providerModelPosts === 0 && !target.startsWith(expected)) ||
        (counters.providerModelPosts === 1 && target !== expected)
      ) {
        throw new Error("Qualification model-call order drifted.");
      }
      counters.providerModelPosts += 1;
    }
    counters.externalHttpCalls += 1;
    return fetchImpl(url, options);
  };
}

async function ledgerManifest(stateDirectory) {
  const names = (await readdir(stateDirectory)).sort();
  const files = [];
  for (const name of names) {
    const bytes = await readRegularFile(
      join(stateDirectory, name),
      stateDirectory,
    );
    files.push(
      Object.freeze({ name, sha256: sha256(bytes), bytes: bytes.length }),
    );
  }
  return Object.freeze({
    files: Object.freeze(files),
    aggregateSha256: sha256(JSON.stringify(files)),
  });
}

export async function executeStagingLiveQualification({
  fetchImpl = fetch,
  now = () => new Date(),
  paths: pathOverrides = {},
} = {}) {
  const paths = resolvePaths(pathOverrides);
  const preflight = await assessStagingLiveQualification(paths);
  if (preflight.disposition !== "READY_TO_QUALIFY") {
    return preflight;
  }
  const source = await sourceBinding(paths);
  const credentials = await readCanonicalCredentials(paths.credentialPath);
  await mkdir(paths.stateRoot, { recursive: true });
  const stateDirectory = join(paths.stateRoot, SESSION_ID);
  await mkdir(stateDirectory);
  const counters = { externalHttpCalls: 0, providerModelPosts: 0 };
  const safeFetch = trackedFetch(fetchImpl, counters);
  await writeJsonExclusive(join(stateDirectory, "00-authorization.json"), {
    schemaVersion: "matchbase.slice3-staging-live-qualification-session/v1",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    syntheticOnly: true,
    fixtureId: FIXTURE_ID,
    maximumExternalHttpCalls: MAX_EXTERNAL_HTTP_CALLS,
    maximumProviderModelPosts: MAX_MODEL_POSTS,
    maximumCostUsd: MAX_COST_USD,
    sourceBinding: source.binding,
    credentialValuesPersisted: false,
  });
  const evidence = [];
  const routes = source.productionPolicy.routes;
  const requests = [source.requests.direct, source.requests.openRouter];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    await writeJsonExclusive(
      join(stateDirectory, `${index * 2 + 1}-${route.path}-reserved.json`),
      {
        schemaVersion:
          "matchbase.slice3-staging-live-qualification-reservation/v1",
        authorizationId: AUTHORIZATION_ID,
        sessionId: SESSION_ID,
        callNumber: index + 1,
        routePath: route.path,
        requestDigest: requests[index].requestDigest,
        syntheticOnly: true,
        retries: 0,
        fallbacks: 0,
        reservedAt: now().toISOString(),
      },
    );
    try {
      const result =
        route.path === "gemini_direct"
          ? await executeGeminiQualificationCall({
              route,
              secret: credentials.MATCHBASE_GEMINI_API_KEY,
              fetchImpl: safeFetch,
            })
          : await executeOpenRouterQualificationCall({
              route,
              secret: credentials.MATCHBASE_OPENROUTER_API_KEY,
              fetchImpl: safeFetch,
            });
      validateSanitizedQualificationEvidence(result);
      await writeJsonExclusive(
        join(stateDirectory, `${index * 2 + 2}-${route.path}-result.json`),
        result,
      );
      evidence.push(result);
    } catch (error) {
      const failure = sanitizedFailure(
        error,
        route.path,
        counters.externalHttpCalls,
        counters.providerModelPosts,
      );
      await writeJsonExclusive(
        join(stateDirectory, `${index * 2 + 2}-${route.path}-result.json`),
        failure,
      );
      await chmod(stateDirectory, 0o555).catch(() => {});
      return Object.freeze({
        schemaVersion:
          "matchbase.slice3-staging-live-qualification-execution/v1",
        disposition: "FAIL",
        authorizationId: AUTHORIZATION_ID,
        sessionId: SESSION_ID,
        routePath: route.path,
        reasonCode: failure.reasonCode,
        externalHttpCalls: counters.externalHttpCalls,
        providerModelPosts: counters.providerModelPosts,
        billableCalls: counters.providerModelPosts,
        costUsd: failure.costAmountUsd,
        credentialValuesDisclosed: false,
        rawProviderPayloadPersisted: false,
        stagingPolicyGenerated: false,
        cloudMutations: 0,
      });
    }
  }
  if (
    evidence.length !== 2 ||
    counters.providerModelPosts !== 2 ||
    counters.externalHttpCalls > MAX_EXTERNAL_HTTP_CALLS
  ) {
    throw new Error("Qualification call accounting is invalid.");
  }
  const totalCostUsd = Number(
    evidence.reduce((sum, route) => sum + route.costAmountUsd, 0).toFixed(9),
  );
  if (totalCostUsd <= 0 || totalCostUsd > MAX_COST_USD) {
    throw new Error("Qualification actual cost violates the authorized cap.");
  }
  const currentSource = await sourceBinding(paths);
  if (
    JSON.stringify(currentSource.binding) !== JSON.stringify(source.binding)
  ) {
    throw new Error("Qualification source binding changed during execution.");
  }
  const completedAt = now().toISOString();
  const stagingPolicy = buildQualifiedStagingPolicy({
    productionPolicy: source.productionPolicy,
    routeEvidence: evidence,
    evaluatedAt: completedAt,
  });
  const evidenceArtifact = {
    schemaVersion: "matchbase.slice3-staging-live-qualification-evidence/v1",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    environment: "staging",
    fixtureId: FIXTURE_ID,
    syntheticOnly: true,
    containsRealUserData: false,
    sourceBinding: source.binding,
    callAccounting: {
      externalHttpCalls: counters.externalHttpCalls,
      providerModelPosts: counters.providerModelPosts,
      billableCalls: counters.providerModelPosts,
      openRouterMetadataGets: 1,
      retries: 0,
      fallbacks: 0,
    },
    cost: {
      amountUsd: totalCostUsd,
      maximumCostUsd: MAX_COST_USD,
      currency: "USD",
    },
    routeEvidence: evidence,
    credentialValuesDisclosed: false,
    credentialValuesPersisted: false,
    rawProviderPayloadPersisted: false,
    productionPolicyMutated: false,
    cloudMutations: 0,
    completedAt,
  };
  const evidenceWrite = await writeJsonExclusive(
    paths.evidencePath,
    evidenceArtifact,
  );
  const policyWrite = await writeJsonExclusive(paths.policyPath, stagingPolicy);
  const ledger = await ledgerManifest(stateDirectory);
  const manifest = {
    schemaVersion: "matchbase.slice3-staging-live-qualification-manifest/v1",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    evidencePath: relative(resolve("."), paths.evidencePath).replaceAll(
      "\\",
      "/",
    ),
    evidenceSha256: evidenceWrite.sha256,
    stagingPolicyPath: relative(resolve("."), paths.policyPath).replaceAll(
      "\\",
      "/",
    ),
    stagingPolicySha256: policyWrite.sha256,
    sourceBinding: source.binding,
    ledger,
    completedAt,
  };
  const manifestWrite = await writeJsonExclusive(paths.manifestPath, manifest);
  await chmod(stateDirectory, 0o555).catch(() => {});
  return Object.freeze({
    schemaVersion: "matchbase.slice3-staging-live-qualification-execution/v1",
    disposition: "PASS",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    externalHttpCalls: counters.externalHttpCalls,
    providerModelPosts: counters.providerModelPosts,
    billableCalls: counters.providerModelPosts,
    costUsd: totalCostUsd,
    evidenceSha256: evidenceWrite.sha256,
    stagingPolicySha256: policyWrite.sha256,
    manifestSha256: manifestWrite.sha256,
    credentialValuesDisclosed: false,
    rawProviderPayloadPersisted: false,
    stagingPolicyGenerated: true,
    productionPolicyMutated: false,
    cloudMutations: 0,
  });
}

export async function verifyStagingLiveQualificationArtifacts(overrides = {}) {
  const paths = resolvePaths(overrides);
  const source = await sourceBinding(paths);
  const [manifestBytes, evidenceBytes, policyBytes] = await Promise.all([
    readRegularFile(paths.manifestPath),
    readRegularFile(paths.evidencePath),
    readRegularFile(paths.policyPath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  const policy = validateResearchRoutePolicy(
    JSON.parse(policyBytes.toString("utf8")),
  );
  if (
    manifest.schemaVersion !==
      "matchbase.slice3-staging-live-qualification-manifest/v1" ||
    manifest.authorizationId !== AUTHORIZATION_ID ||
    manifest.sessionId !== SESSION_ID ||
    manifest.evidenceSha256 !== sha256(evidenceBytes) ||
    manifest.stagingPolicySha256 !== sha256(policyBytes) ||
    JSON.stringify(manifest.sourceBinding) !== JSON.stringify(source.binding) ||
    evidence.schemaVersion !==
      "matchbase.slice3-staging-live-qualification-evidence/v1" ||
    evidence.authorizationId !== AUTHORIZATION_ID ||
    evidence.sessionId !== SESSION_ID ||
    evidence.environment !== "staging" ||
    evidence.fixtureId !== FIXTURE_ID ||
    evidence.syntheticOnly !== true ||
    evidence.containsRealUserData !== false ||
    evidence.callAccounting?.providerModelPosts !== 2 ||
    evidence.callAccounting?.billableCalls !== 2 ||
    evidence.callAccounting?.externalHttpCalls > 50 ||
    evidence.callAccounting?.retries !== 0 ||
    evidence.callAccounting?.fallbacks !== 0 ||
    evidence.cost?.currency !== "USD" ||
    !Number.isFinite(evidence.cost?.amountUsd) ||
    evidence.cost.amountUsd <= 0 ||
    evidence.cost.amountUsd > 100 ||
    evidence.credentialValuesDisclosed !== false ||
    evidence.credentialValuesPersisted !== false ||
    evidence.rawProviderPayloadPersisted !== false ||
    evidence.productionPolicyMutated !== false ||
    evidence.cloudMutations !== 0 ||
    policy.environment !== "staging" ||
    policy.liveActivation !== "enabled" ||
    policy.routes.length !== 2 ||
    policy.routes.some(
      (route, index) =>
        route.enabled !== true ||
        route.liveQualified !== true ||
        route.fallbackPosition !== index,
    )
  ) {
    throw new Error("Staging qualification artifacts are invalid.");
  }
  evidence.routeEvidence.forEach(validateSanitizedQualificationEvidence);
  const ledger = await ledgerManifest(join(paths.stateRoot, SESSION_ID));
  if (JSON.stringify(ledger) !== JSON.stringify(manifest.ledger)) {
    throw new Error("Staging qualification ledger digest drifted.");
  }
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-verification/v1",
    disposition: "PASS",
    manifestSha256: sha256(manifestBytes),
    evidenceSha256: sha256(evidenceBytes),
    stagingPolicySha256: sha256(policyBytes),
    totalCostUsd: evidence.cost.amountUsd,
    billableCalls: evidence.callAccounting.billableCalls,
    syntheticOnly: true,
    credentialValuesDisclosed: false,
    productionPolicyMutated: false,
    cloudMutations: 0,
  });
}

export const SLICE3_STAGING_LIVE_QUALIFICATION_CONSTANTS = Object.freeze({
  authorizationId: AUTHORIZATION_ID,
  authorizationSha256: AUTHORIZATION_SHA256,
  productionPolicySha256: PRODUCTION_POLICY_SHA256,
  sessionId: SESSION_ID,
  fixtureId: FIXTURE_ID,
  maximumExternalHttpCalls: MAX_EXTERNAL_HTTP_CALLS,
  maximumProviderModelPosts: MAX_MODEL_POSTS,
  maximumCostUsd: MAX_COST_USD,
  defaultPaths: DEFAULTS,
});
