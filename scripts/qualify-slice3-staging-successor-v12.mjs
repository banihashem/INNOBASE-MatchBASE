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
import {
  buildGeminiQualificationRequest,
  buildOpenRouterQualificationRequest,
  executeGeminiQualificationCall,
  executeOpenRouterQualificationCall,
  qualificationWorstCaseCostUsd,
  readCanonicalCredentials,
  validateSanitizedQualificationEvidence,
} from "./lib/slice3-live-qualification-runner.mjs";
import { buildQualifiedStagingPolicy } from "./lib/slice3-staging-live-qualification-v1.mjs";

const AUTHORIZATION_ID =
  "OWNER-SLICE3-STAGING-LIVE-QUALIFICATION-2026-08-30-V12";
const EXECUTION_SIGNAL = "I_AUTHORIZE_SYNTHETIC_STAGING_QUALIFICATION_V12";
const AUTHORIZATION_SHA256 =
  "F1A41084FFB7932A8B7F09E2278FBB48FE58ABBD9319F18B5084BA6313FF1DBA";
const PRODUCTION_POLICY_SHA256 =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const PREDECESSOR_SESSION_ID = "v6-6E67532C6108E5E5F7C17003";
const PREDECESSOR_LEDGER_SHA256 =
  "9A1DC5C549ADCE3327887242DBF1378230CEBDE68912EB68F13E87FE884E951D";
const CREDENTIAL_GATE_SESSION_ID = "v6-6488F0D1148B973D0B912F38";
const CREDENTIAL_GATE_LEDGER_SHA256 =
  "053B4287A717C2EA39AA07C347A75FF207947E37D6348379AAE8B45D7EAA5C5B";
const SESSION_ID = "v6-45C8ED78EF3EA2400B318F33";
const MAX_EXTERNAL_HTTP_CALLS = 50;
const MAX_MODEL_POSTS = 2;
const MAX_COST_USD = 98.0922015;
const PRIOR_MODEL_POSTS = 28;
const PRIOR_COST_USD = 1.9077985;

const DEFAULTS = Object.freeze({
  authorizationPath: resolve(
    "governance/slice3-staging-live-qualification-successor-authorization.v12.json",
  ),
  productionPolicyPath: resolve("config/slice3/research-route-policy.v1.json"),
  credentialPath: resolve("APIKeys.md"),
  executorPath: resolve("scripts/qualify-slice3-staging-successor-v12.mjs"),
  runnerPath: resolve("scripts/lib/slice3-live-qualification-runner.mjs"),
  policyBuilderPath: resolve(
    "scripts/lib/slice3-staging-live-qualification-v1.mjs",
  ),
  predecessorStateRoot: resolve(
    "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
  ),
  credentialGateStateRoot: resolve(
    "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
  ),
  stateRoot: resolve(
    "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state",
  ),
  evidencePath: resolve("evidence/slice3/staging-live-qualification.v1.json"),
  policyPath: resolve("config/slice3/research-route-policy.staging.v1.json"),
  manifestPath: resolve(
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

async function readRegular(path, root = dirname(path)) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink()) {
    throw new Error("Successor source is not a regular file.");
  }
  const fileReal = await realpath(path);
  const rel = relative(rootReal, fileReal);
  if (!rel || rel.startsWith("..") || resolve(rootReal, rel) !== fileReal) {
    throw new Error("Successor source escaped its root.");
  }
  return readFile(fileReal);
}

async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(path, bytes, { flag: "wx" });
  return Object.freeze({ bytes, sha256: sha256(bytes) });
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

function validateAuthorization(value) {
  if (
    value?.schemaVersion !==
      "matchbase.slice3-staging-live-qualification-successor-authorization/v12" ||
    value.authorizationId !== AUTHORIZATION_ID ||
    value.environment !== "staging" ||
    value.syntheticOnly !== true ||
    value.realUserDataAuthorized !== false ||
    value.fixtureId !== "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN" ||
    value.predecessor?.sessionId !== PREDECESSOR_SESSION_ID ||
    value.predecessor?.ledgerAggregateSha256 !== PREDECESSOR_LEDGER_SHA256 ||
    value.predecessor?.terminalDisposition !== "FAIL" ||
    JSON.stringify(value.predecessor?.failedRoutePaths) !==
      JSON.stringify(["openrouter"]) ||
    value.predecessor?.providerModelPostsConsumed !== 2 ||
    value.predecessor?.costConsumedUsd !== 0.04559875 ||
    value.predecessor?.cumulativeProviderModelPosts !== 28 ||
    value.predecessor?.cumulativeConservativeCostUsd !== 1.9077985 ||
    value.credentialGate?.sessionId !== CREDENTIAL_GATE_SESSION_ID ||
    value.credentialGate?.ledgerAggregateSha256 !==
      CREDENTIAL_GATE_LEDGER_SHA256 ||
    value.credentialGate?.httpStatus !== 200 ||
    value.credentialGate?.schemaValid !== true ||
    value.credentialGate?.paidCredential !== true ||
    value.credentialGate?.accountCreditsObservedUsd !== 10 ||
    value.ownerCeiling?.maximumProviderCalls !== 50 ||
    value.ownerCeiling?.maximumCostUsd !== 100 ||
    value.ownerCeiling?.remainingProviderCallsBeforeV12 !== 22 ||
    value.ownerCeiling?.remainingCostUsdBeforeV12 !== MAX_COST_USD ||
    value.allocation?.maximumExternalHttpCalls !== MAX_EXTERNAL_HTTP_CALLS ||
    value.allocation?.maximumProviderModelPosts !== MAX_MODEL_POSTS ||
    value.allocation?.maximumCostUsd !== MAX_COST_USD ||
    JSON.stringify(value.allocation?.routeOrder) !==
      JSON.stringify(["gemini_direct", "openrouter"]) ||
    value.allocation?.retriesWithinAllocation !== 0 ||
    value.allocation?.fallbacks !== 0 ||
    value.requestContract?.fixtureIdAuthority !== "server_owned" ||
    JSON.stringify(value.requestContract?.providerOutputKeys) !==
      JSON.stringify(["answer", "sourceSummary"]) ||
    value.requestContract?.openRouterSeed !== 7 ||
    value.requestContract?.openRouterGenerationMetadataMaximumGets !== 0 ||
    value.requestContract?.openRouterIdentityBasis !==
      "provider_reported_router_metadata_and_response" ||
    value.requestContract?.directGeminiSeeded !== false ||
    JSON.stringify(value.requestContract?.openRouterMetadataShapes) !==
      JSON.stringify([
        "legacy_attempts_pipeline",
        "current_summary_region_byok",
      ]) ||
    value.requestContract?.openRouterZdr !== true ||
    value.requestContract?.openRouterDataCollection !== "deny" ||
    value.requestContract?.openRouterRequireParameters !== true ||
    value.requestContract?.openRouterAllowFallbacks !== false ||
    JSON.stringify(value.requestContract?.openRouterProviderOnly) !==
      JSON.stringify(["google-vertex"]) ||
    value.requestContract?.directGeminiFreshSearchPrompt !== true ||
    value.requestContract?.minimumNonemptySearchQueries !== 1 ||
    value.requestContract?.groundingSupportRequired !== true ||
    value.requestContract?.rawPayloadPersistence !== false ||
    value.accounting?.providerModelPostsBeforeV12 !== PRIOR_MODEL_POSTS ||
    value.accounting?.conservativeCostUsdBeforeV12 !== PRIOR_COST_USD ||
    value.accounting?.diagnosticProviderModelPostsAfterV5 !== 3 ||
    value.accounting?.diagnosticConservativeCostUsdAfterV5 !== 0.079872 ||
    value.accounting?.singleAllocationConservativeReserveUsd !==
      qualificationWorstCaseCostUsd() ||
    value.productionPolicyMutationAuthorized !== false ||
    value.cloudMutationAuthorized !== false ||
    value.deploymentAuthorized !== false
  ) {
    throw new Error("Successor authorization is invalid.");
  }
  return value;
}

function validateProductionPolicy(policy) {
  if (
    policy?.environment !== "production" ||
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
    throw new Error("Production policy is not the frozen blocked policy.");
  }
  return policy;
}

function validateRequests(routes) {
  const direct = buildGeminiQualificationRequest(routes[0]);
  const openRouter = buildOpenRouterQualificationRequest(routes[1]);
  const directBody = JSON.parse(direct.body);
  const routerBody = JSON.parse(openRouter.body);
  if (
    JSON.stringify(directBody.tools) !==
      JSON.stringify([{ google_search: {} }]) ||
    !directBody.contents?.[0]?.parts?.[0]?.text?.includes(
      "Use Google Search before answering",
    ) ||
    JSON.stringify(
      Object.keys(directBody.generationConfig.responseJsonSchema.properties),
    ) !== JSON.stringify(["answer", "sourceSummary"]) ||
    JSON.stringify(directBody.generationConfig.responseJsonSchema.required) !==
      JSON.stringify(["answer", "sourceSummary"]) ||
    direct.body.includes("fixtureId") ||
    direct.body.includes("S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN") ||
    JSON.stringify(routerBody.provider) !==
      JSON.stringify({
        zdr: true,
        data_collection: "deny",
        only: ["google-vertex"],
        order: ["google-vertex"],
        require_parameters: true,
        allow_fallbacks: false,
      }) ||
    JSON.stringify(
      Object.keys(routerBody.response_format.json_schema.schema.properties),
    ) !== JSON.stringify(["answer", "sourceSummary"]) ||
    JSON.stringify(routerBody.response_format.json_schema.schema.required) !==
      JSON.stringify(["answer", "sourceSummary"]) ||
    routerBody.response_format.json_schema.strict !== true ||
    openRouter.body.includes("fixtureId") ||
    openRouter.body.includes("S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN")
  ) {
    throw new Error("Successor request contract drifted.");
  }
  return Object.freeze({ direct, openRouter });
}

async function sources(paths) {
  const [
    authorizationBytes,
    policyBytes,
    executorBytes,
    runnerBytes,
    builderBytes,
  ] = await Promise.all([
    readRegular(paths.authorizationPath),
    readRegular(paths.productionPolicyPath),
    readRegular(paths.executorPath),
    readRegular(paths.runnerPath),
    readRegular(paths.policyBuilderPath),
  ]);
  if (sha256(authorizationBytes) !== AUTHORIZATION_SHA256) {
    throw new Error("Successor authorization digest drifted.");
  }
  if (sha256(policyBytes) !== PRODUCTION_POLICY_SHA256) {
    throw new Error("Production policy digest drifted.");
  }
  const predecessor = await ledgerIdentity(
    join(paths.predecessorStateRoot, PREDECESSOR_SESSION_ID),
  );
  if (predecessor.aggregateSha256 !== PREDECESSOR_LEDGER_SHA256) {
    throw new Error("Predecessor terminal ledger drifted.");
  }
  const credentialGate = await ledgerIdentity(
    join(paths.credentialGateStateRoot, CREDENTIAL_GATE_SESSION_ID),
  );
  if (credentialGate.aggregateSha256 !== CREDENTIAL_GATE_LEDGER_SHA256) {
    throw new Error("Credential-gate terminal ledger drifted.");
  }
  const authorization = validateAuthorization(
    JSON.parse(authorizationBytes.toString("utf8")),
  );
  const productionPolicy = validateProductionPolicy(
    JSON.parse(policyBytes.toString("utf8")),
  );
  return Object.freeze({
    authorization,
    productionPolicy,
    requests: validateRequests(productionPolicy.routes),
    binding: Object.freeze({
      authorizationSha256: sha256(authorizationBytes),
      productionPolicySha256: sha256(policyBytes),
      predecessorLedgerSha256: predecessor.aggregateSha256,
      credentialGateLedgerSha256: credentialGate.aggregateSha256,
      executorSha256: sha256(executorBytes),
      runnerSha256: sha256(runnerBytes),
      policyBuilderSha256: sha256(builderBytes),
    }),
  });
}

function resolved(overrides = {}) {
  return Object.freeze({ ...DEFAULTS, ...overrides });
}

export async function assessSuccessor(overrides = {}) {
  const paths = resolved(overrides);
  const source = await sources(paths);
  const blockers = [];
  for (const [path, reason] of [
    [join(paths.stateRoot, SESSION_ID), "SUCCESSOR_SESSION_ALREADY_EXISTS"],
    [paths.evidencePath, "QUALIFICATION_EVIDENCE_ALREADY_EXISTS"],
    [paths.policyPath, "STAGING_POLICY_ALREADY_EXISTS"],
    [paths.manifestPath, "QUALIFICATION_MANIFEST_ALREADY_EXISTS"],
  ]) {
    if (!(await absent(path))) blockers.push(reason);
  }
  const credential = await lstat(paths.credentialPath);
  if (!credential.isFile() || credential.isSymbolicLink()) {
    blockers.push("CANONICAL_CREDENTIAL_FILE_INVALID");
  }
  const worstCaseCostUsd = qualificationWorstCaseCostUsd();
  if (
    worstCaseCostUsd <= 0 ||
    worstCaseCostUsd > MAX_COST_USD ||
    worstCaseCostUsd + PRIOR_COST_USD > 100
  ) {
    blockers.push("SUCCESSOR_COST_CAP_INVALID");
  }
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-successor-preflight/v12",
    disposition:
      blockers.length === 0 ? "READY_TO_QUALIFY" : "BLOCKED_PREREQUISITE",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    predecessorSessionId: PREDECESSOR_SESSION_ID,
    syntheticOnly: true,
    maximumExternalHttpCalls: MAX_EXTERNAL_HTTP_CALLS,
    maximumProviderModelPosts: MAX_MODEL_POSTS,
    maximumCostUsd: MAX_COST_USD,
    cumulativeMaximumProviderCalls: PRIOR_MODEL_POSTS + MAX_MODEL_POSTS,
    cumulativeWorstCaseCostUsd: Number(
      (PRIOR_COST_USD + worstCaseCostUsd).toFixed(9),
    ),
    sourceBinding: source.binding,
    blockers: Object.freeze(blockers),
    credentialValuesInspected: false,
    externalHttpCalls: 0,
    providerModelPosts: 0,
    cloudMutations: 0,
  });
}

function trackedFetch(fetchImpl, counters) {
  return async (url, options = {}) => {
    if (counters.externalHttpCalls >= MAX_EXTERNAL_HTTP_CALLS) {
      throw new Error("Successor external HTTP ceiling reached.");
    }
    const target = String(url);
    const method = options.method ?? "GET";
    const modelPost =
      method === "POST" &&
      (target.startsWith("https://generativelanguage.googleapis.com/") ||
        target === "https://openrouter.ai/api/v1/chat/completions");
    if (modelPost) {
      if (counters.providerModelPosts >= MAX_MODEL_POSTS) {
        throw new Error("Successor model POST ceiling reached.");
      }
      counters.providerModelPosts += 1;
    }
    counters.externalHttpCalls += 1;
    return fetchImpl(url, options);
  };
}

function sanitizedFailure(error, routePath, counters) {
  const observed = error?.failure;
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-successor-failure/v12",
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
        : false,
    httpStatus:
      Number.isInteger(observed?.httpStatus) && observed.httpStatus >= 100
        ? observed.httpStatus
        : null,
    searchQueryCount:
      Number.isInteger(observed?.searchQueryCount) &&
      observed.searchQueryCount >= 0
        ? observed.searchQueryCount
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
    externalHttpCalls: counters.externalHttpCalls,
    providerModelPosts: counters.providerModelPosts,
    credentialValuesDisclosed: false,
    rawProviderPayloadPersisted: false,
    recordedAt: new Date().toISOString(),
  });
}

export async function executeSuccessor({
  fetchImpl = fetch,
  now = () => new Date(),
  paths: overrides = {},
} = {}) {
  const paths = resolved(overrides);
  const preflight = await assessSuccessor(paths);
  if (preflight.disposition !== "READY_TO_QUALIFY") return preflight;
  const source = await sources(paths);
  const credentials = await readCanonicalCredentials(paths.credentialPath);
  await mkdir(paths.stateRoot, { recursive: true });
  const stateDirectory = join(paths.stateRoot, SESSION_ID);
  await mkdir(stateDirectory);
  await writeJsonExclusive(join(stateDirectory, "00-authorization.json"), {
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-successor-session/v12",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    predecessorSessionId: PREDECESSOR_SESSION_ID,
    syntheticOnly: true,
    maximumExternalHttpCalls: MAX_EXTERNAL_HTTP_CALLS,
    maximumProviderModelPosts: MAX_MODEL_POSTS,
    maximumCostUsd: MAX_COST_USD,
    sourceBinding: source.binding,
    credentialValuesPersisted: false,
  });
  const counters = { externalHttpCalls: 0, providerModelPosts: 0 };
  const safeFetch = trackedFetch(fetchImpl, counters);
  const passed = [];
  const failures = [];
  for (
    let index = 0;
    index < source.productionPolicy.routes.length;
    index += 1
  ) {
    const route = source.productionPolicy.routes[index];
    const request =
      route.path === "gemini_direct"
        ? source.requests.direct
        : source.requests.openRouter;
    await writeJsonExclusive(
      join(stateDirectory, `${index * 2 + 1}-${route.path}-reserved.json`),
      {
        schemaVersion:
          "matchbase.slice3-staging-live-qualification-successor-reservation/v12",
        authorizationId: AUTHORIZATION_ID,
        sessionId: SESSION_ID,
        callNumber: index + 1,
        routePath: route.path,
        requestDigest: request.requestDigest,
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
      passed.push(result);
      await writeJsonExclusive(
        join(stateDirectory, `${index * 2 + 2}-${route.path}-result.json`),
        result,
      );
    } catch (error) {
      const failure = sanitizedFailure(error, route.path, counters);
      failures.push(failure);
      await writeJsonExclusive(
        join(stateDirectory, `${index * 2 + 2}-${route.path}-result.json`),
        failure,
      );
    }
  }
  const currentCostUsd = Number(
    [...passed, ...failures]
      .reduce((sum, item) => sum + (item.costAmountUsd ?? 0), 0)
      .toFixed(9),
  );
  const cumulativeCostUsd = Number(
    (PRIOR_COST_USD + currentCostUsd).toFixed(9),
  );
  if (
    counters.providerModelPosts !== 2 ||
    PRIOR_MODEL_POSTS + counters.providerModelPosts > 50 ||
    currentCostUsd > MAX_COST_USD ||
    cumulativeCostUsd > 100
  ) {
    throw new Error(
      "Successor call or cost accounting violated owner ceilings.",
    );
  }
  const completedAt = now().toISOString();
  await writeJsonExclusive(join(stateDirectory, "05-terminal-summary.json"), {
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-successor-terminal/v12",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    disposition: failures.length === 0 ? "PASS" : "FAIL",
    passedRoutePaths: passed.map((item) => item.routePath),
    failedRoutePaths: failures.map((item) => item.routePath),
    externalHttpCalls: counters.externalHttpCalls,
    providerModelPosts: counters.providerModelPosts,
    currentCostUsd,
    cumulativeProviderModelPosts:
      PRIOR_MODEL_POSTS + counters.providerModelPosts,
    cumulativeCostUsd,
    credentialValuesDisclosed: false,
    rawProviderPayloadPersisted: false,
    productionPolicyMutated: false,
    cloudMutations: 0,
    completedAt,
  });
  if (failures.length > 0) {
    await chmod(stateDirectory, 0o555).catch(() => {});
    return Object.freeze({
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-execution/v12",
      disposition: "FAIL",
      authorizationId: AUTHORIZATION_ID,
      sessionId: SESSION_ID,
      failures: Object.freeze(
        failures.map(({ routePath, reasonCode, phase }) =>
          Object.freeze({ routePath, reasonCode, phase }),
        ),
      ),
      externalHttpCalls: counters.externalHttpCalls,
      providerModelPosts: counters.providerModelPosts,
      currentCostUsd,
      cumulativeProviderModelPosts:
        PRIOR_MODEL_POSTS + counters.providerModelPosts,
      cumulativeCostUsd,
      credentialValuesDisclosed: false,
      rawProviderPayloadPersisted: false,
      stagingPolicyGenerated: false,
      productionPolicyMutated: false,
      cloudMutations: 0,
    });
  }
  const finalSource = await sources(paths);
  if (JSON.stringify(finalSource.binding) !== JSON.stringify(source.binding)) {
    throw new Error("Successor source binding changed during execution.");
  }
  const stagingPolicy = buildQualifiedStagingPolicy({
    productionPolicy: source.productionPolicy,
    routeEvidence: passed,
    evaluatedAt: completedAt,
  });
  const evidenceArtifact = {
    schemaVersion: "matchbase.slice3-staging-live-qualification-evidence/v2",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    predecessorSessionId: PREDECESSOR_SESSION_ID,
    environment: "staging",
    fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
    syntheticOnly: true,
    containsRealUserData: false,
    sourceBinding: source.binding,
    callAccounting: {
      externalHttpCalls: counters.externalHttpCalls,
      providerModelPosts: counters.providerModelPosts,
      billableCalls: counters.providerModelPosts,
      openRouterMetadataGets: 0,
      retriesWithinAllocation: 0,
      fallbacks: 0,
      cumulativeProviderModelPosts:
        PRIOR_MODEL_POSTS + counters.providerModelPosts,
    },
    cost: {
      currentAmountUsd: currentCostUsd,
      cumulativeAmountUsd: cumulativeCostUsd,
      maximumOwnerCostUsd: 100,
      currency: "USD",
    },
    routeEvidence: passed,
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
  const ledger = await ledgerIdentity(stateDirectory);
  const manifestWrite = await writeJsonExclusive(paths.manifestPath, {
    schemaVersion: "matchbase.slice3-staging-live-qualification-manifest/v2",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    predecessorSessionId: PREDECESSOR_SESSION_ID,
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
  });
  await chmod(stateDirectory, 0o555).catch(() => {});
  return Object.freeze({
    schemaVersion:
      "matchbase.slice3-staging-live-qualification-successor-execution/v12",
    disposition: "PASS",
    authorizationId: AUTHORIZATION_ID,
    sessionId: SESSION_ID,
    externalHttpCalls: counters.externalHttpCalls,
    providerModelPosts: counters.providerModelPosts,
    currentCostUsd,
    cumulativeProviderModelPosts:
      PRIOR_MODEL_POSTS + counters.providerModelPosts,
    cumulativeCostUsd,
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

export async function run(
  args = process.argv.slice(2),
  environment = process.env,
) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--execute"))) {
    throw new Error("Successor qualification accepts only optional --execute.");
  }
  if (args.length === 0) return assessSuccessor();
  if (
    environment.MATCHBASE_SLICE3_STAGING_LIVE_QUALIFICATION !== EXECUTION_SIGNAL
  ) {
    return Object.freeze({
      schemaVersion:
        "matchbase.slice3-staging-live-qualification-successor-preflight/v12",
      disposition: "BLOCKED_PREREQUISITE",
      blockers: Object.freeze(["EXACT_SUCCESSOR_EXECUTION_SIGNAL_ABSENT"]),
      credentialValuesInspected: false,
      externalHttpCalls: 0,
      providerModelPosts: 0,
      cloudMutations: 0,
    });
  }
  return executeSuccessor();
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    result.disposition !== "PASS" &&
    result.disposition !== "READY_TO_QUALIFY"
  ) {
    process.exitCode = 2;
  }
}

export const SLICE3_STAGING_SUCCESSOR_V12_CONSTANTS = Object.freeze({
  authorizationId: AUTHORIZATION_ID,
  authorizationSha256: AUTHORIZATION_SHA256,
  executionSignal: EXECUTION_SIGNAL,
  predecessorSessionId: PREDECESSOR_SESSION_ID,
  predecessorLedgerSha256: PREDECESSOR_LEDGER_SHA256,
  credentialGateSessionId: CREDENTIAL_GATE_SESSION_ID,
  credentialGateLedgerSha256: CREDENTIAL_GATE_LEDGER_SHA256,
  sessionId: SESSION_ID,
  maximumExternalHttpCalls: MAX_EXTERNAL_HTTP_CALLS,
  maximumProviderModelPosts: MAX_MODEL_POSTS,
  maximumCostUsd: MAX_COST_USD,
  defaultPaths: DEFAULTS,
});
