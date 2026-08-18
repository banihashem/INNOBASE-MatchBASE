import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  createQualificationAuthorizationBinding,
  executeAuthorizedQualification,
  isQualificationAuthorizationBinding,
  readCanonicalCredentials,
  SLICE3_LIVE_QUALIFICATION_CONSTANTS,
  validateFinalizedQualificationAttestation,
} from "./lib/slice3-live-qualification-runner.mjs";
import {
  LIVE_RESEARCH_CREDENTIAL_HANDLES,
  providerCredentialHandlePresent,
} from "../packages/application/dist/live-research-credential-policy.js";

export { LIVE_RESEARCH_CREDENTIAL_HANDLES };

const QUALIFICATION_PRICING = Object.freeze({
  currency: "USD",
  inputPerMillionUsd: 1.5,
  outputPerMillionUsd: 7.5,
  searchPerThousandUsd: 14,
  pricingVersion: "gemini-3.6-conservative-upper.2026-08-16",
});

const SYNTHETIC_FIXTURE = Object.freeze({
  fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
  classification: "benign_synthetic_public_only",
  containsRealUserData: false,
});

export { QUALIFICATION_PRICING, SYNTHETIC_FIXTURE };

export function credentialHandlePresence(environment) {
  return Object.freeze({
    directCredentialPresent: providerCredentialHandlePresent(
      environment,
      LIVE_RESEARCH_CREDENTIAL_HANDLES.geminiDirect,
    ),
    openRouterCredentialPresent: providerCredentialHandlePresent(
      environment,
      LIVE_RESEARCH_CREDENTIAL_HANDLES.openrouter,
    ),
  });
}

export function evaluateLiveQualificationPrerequisites(input) {
  if (
    typeof input?.directCredentialPresent !== "boolean" ||
    typeof input?.openRouterCredentialPresent !== "boolean"
  ) {
    throw new Error(
      "Qualification credential presence must use exact boolean signals.",
    );
  }
  const blockers = [];
  const routes = Array.isArray(input.policy?.routes) ? input.policy.routes : [];
  const paths = routes.map((route) => route.path);
  const stagedPolicyEligible =
    input.policy?.liveActivation === "blocked" &&
    routes.length === 2 &&
    new Set(routes.map((route) => route.routeId)).size === 2 &&
    paths.includes("gemini_direct") &&
    paths.includes("openrouter") &&
    routes.every(
      (route) =>
        route.enabled === false &&
        route.liveQualified === false &&
        route.parameterPolicy?.allowFallbacks === false &&
        route.parameterPolicy?.requireParameters === true &&
        route.parameterPolicy?.maxOutputTokens === 2048 &&
        route.parameterPolicy?.maxAttempts === 1 &&
        route.parameterPolicy?.backoffMs === 0,
    );
  if (!stagedPolicyEligible) blockers.push("QUALIFICATION_ROUTE_SET_INVALID");
  if (!input.skipCredentialEvaluation && !input.directCredentialPresent)
    blockers.push("APPROVED_DIRECT_CREDENTIAL_ABSENT");
  if (!input.skipCredentialEvaluation && !input.openRouterCredentialPresent)
    blockers.push("APPROVED_OPENROUTER_CREDENTIAL_ABSENT");
  if (!input.explicitAuthorization) {
    blockers.push("V3_DISTINCT_AUTHORIZATION_SIGNAL_ABSENT");
  }
  if (
    input.authorizationId !==
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId
  ) {
    blockers.push("V3_OWNER_REAUTHORIZATION_ABSENT");
  }
  let authorizationBinding = null;
  if (isQualificationAuthorizationBinding(input.authorizationBinding)) {
    authorizationBinding = input.authorizationBinding;
  } else {
    blockers.push("V3_PREFLIGHT_AUTHORIZATION_BINDING_ABSENT");
  }
  if (
    !input.budget ||
    input.budget.maxCalls !== 2 ||
    input.budget.maxCostUsd !== 100
  )
    blockers.push("QUALIFICATION_BUDGET_INVALID");
  return Object.freeze({
    schemaVersion: "slice3-live-qualification-preflight.v4",
    disposition:
      blockers.length === 0 ? "READY_TO_QUALIFY" : "BLOCKED_PREREQUISITE",
    blockers: Object.freeze(blockers),
    currentAcceptanceBlockers: Object.freeze([
      "ROUTE_POLICY_NOT_ENABLED",
      "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
    ]),
    providerCalls: 0,
    credentialValuesInspected: false,
    externalMutations: 0,
    authorizationBinding,
  });
}

export function finalizeQualifiedRoutePolicy(input) {
  const qualificationSession = validateFinalizedQualificationAttestation(
    input.qualificationAttestation,
    input.policy,
  );
  const finalizedAt = new Date(input.finalizedAt);
  if (!Number.isFinite(finalizedAt.getTime())) {
    throw new Error("Policy finalization time is invalid.");
  }
  return Object.freeze({
    ...structuredClone(input.policy),
    policyVersion: `${input.policy.policyVersion}.qualified`,
    evaluatedAt: finalizedAt.toISOString(),
    liveActivation: "enabled",
    routes: input.policy.routes.map((route, index) => {
      const evidence = qualificationSession.routes[index].result;
      return {
        ...route,
        expectedServedModelId: route.expectedServedModelId,
        enabled: true,
        liveQualified: true,
        dataHandling: {
          ...route.dataHandling,
          evidenceVersion: `${route.dataHandling.evidenceVersion}.qualified`,
          paidPath: "verified",
          retentionTrainingPosture:
            route.path === "openrouter"
              ? "verified_zdr"
              : "verified_no_training",
        },
        costPolicy: {
          ...route.costPolicy,
          pricingState: "known",
          pricingVersion: evidence.pricingVersion,
          accountingMode: evidence.costState,
        },
      };
    }),
  });
}

async function run() {
  const policyFile = resolve("config/slice3/research-route-policy.v1.json");
  const policy = JSON.parse(readFileSync(policyFile, "utf8"));
  const maxCostUsd = Number(
    process.env.MATCHBASE_SLICE3_QUALIFICATION_MAX_COST_USD,
  );
  const execute = process.argv.includes("--execute");
  const preflightOnly = process.argv.includes("--preflight-only");
  const credentialFile = process.env.MATCHBASE_SLICE3_QUALIFICATION_KEY_FILE;
  const stateDirectory = process.env.MATCHBASE_SLICE3_QUALIFICATION_STATE_DIR;
  const ownerDecisionFile = process.env.MATCHBASE_SLICE3_V3_OWNER_DECISION_FILE;
  const explicitAuthorization =
    process.env.MATCHBASE_SLICE3_LIVE_QUALIFICATION_V3 ===
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.v3AuthorizationSignal;
  const authorizationId =
    process.env.MATCHBASE_SLICE3_QUALIFICATION_AUTHORIZATION_ID_V3;
  let authorizationBinding = null;
  if (
    explicitAuthorization &&
    authorizationId === SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId &&
    ownerDecisionFile &&
    stateDirectory
  ) {
    try {
      authorizationBinding = await createQualificationAuthorizationBinding({
        ownerDecisionFile,
        policyFile,
        policy,
        stateDirectory,
      });
    } catch {
      authorizationBinding = null;
    }
  }
  const credentials =
    authorizationBinding && preflightOnly && credentialFile
      ? await readCanonicalCredentials(credentialFile)
      : undefined;
  const credentialPresence = authorizationBinding
    ? credentials
      ? credentialHandlePresence(credentials)
      : execute && credentialFile
        ? {
            directCredentialPresent: true,
            openRouterCredentialPresent: true,
          }
        : credentialHandlePresence(process.env)
    : {
        directCredentialPresent: false,
        openRouterCredentialPresent: false,
      };
  const result = evaluateLiveQualificationPrerequisites({
    policy,
    ...credentialPresence,
    skipCredentialEvaluation: authorizationBinding === null,
    explicitAuthorization,
    authorizationId,
    authorizationBinding,
    budget: {
      maxCalls: Number(process.env.MATCHBASE_SLICE3_QUALIFICATION_MAX_CALLS),
      maxCostUsd,
    },
  });
  if (!execute) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.disposition === "READY_TO_QUALIFY" ? 0 : 2;
    return;
  }
  if (result.disposition !== "READY_TO_QUALIFY") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 2;
    return;
  }
  if (!stateDirectory) {
    throw new Error("Qualification state directory is required.");
  }
  const execution = await executeAuthorizedQualification({
    policy,
    preflight: result,
    budget: { maxCalls: 2, maxCostUsd },
    credentialFile,
    stateDirectory,
    ownerDecisionFile,
    policyFile,
  });
  process.stdout.write(`${JSON.stringify(execution)}\n`);
  process.exitCode = execution.disposition === "PASS" ? 0 : 4;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href)
  await run();
