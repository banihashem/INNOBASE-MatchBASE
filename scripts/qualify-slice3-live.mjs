import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function evaluateLiveQualificationPrerequisites(input) {
  const blockers = [];
  if (input.policy?.liveActivation !== "enabled")
    blockers.push("ROUTE_POLICY_NOT_ENABLED");
  if (
    input.policy?.routes?.length !== 2 ||
    input.policy.routes.some((route) => !route.enabled || !route.liveQualified)
  )
    blockers.push("TWO_QUALIFIED_ROUTES_NOT_PRESENT");
  if (!input.directCredentialPresent)
    blockers.push("APPROVED_DIRECT_CREDENTIAL_ABSENT");
  if (!input.openRouterCredentialPresent)
    blockers.push("APPROVED_OPENROUTER_CREDENTIAL_ABSENT");
  if (!input.explicitAuthorization)
    blockers.push("EXPLICIT_BILLABLE_QUALIFICATION_AUTHORIZATION_ABSENT");
  if (
    !input.budget ||
    input.budget.maxCalls !== 2 ||
    input.budget.maxCostUsd <= 0
  )
    blockers.push("QUALIFICATION_BUDGET_INVALID");
  return Object.freeze({
    schemaVersion: "slice3-live-qualification-preflight.v1",
    disposition:
      blockers.length === 0 ? "READY_TO_EXECUTE" : "BLOCKED_PREREQUISITE",
    blockers: Object.freeze(blockers),
    providerCalls: 0,
    credentialValuesInspected: false,
    externalMutations: 0,
  });
}

function run() {
  const policy = JSON.parse(
    readFileSync(
      resolve("config/slice3/research-route-policy.v1.json"),
      "utf8",
    ),
  );
  const maxCostUsd = Number(
    process.env.MATCHBASE_SLICE3_QUALIFICATION_MAX_COST_USD,
  );
  const result = evaluateLiveQualificationPrerequisites({
    policy,
    directCredentialPresent: Boolean(
      process.env.GEMINI_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS,
    ),
    openRouterCredentialPresent: Boolean(process.env.OPENROUTER_API_KEY),
    explicitAuthorization:
      process.env.MATCHBASE_SLICE3_LIVE_QUALIFICATION ===
      "I_ACKNOWLEDGE_BILLABLE_SYNTHETIC_ONLY",
    budget: {
      maxCalls: Number(process.env.MATCHBASE_SLICE3_QUALIFICATION_MAX_CALLS),
      maxCostUsd,
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.disposition === "READY_TO_EXECUTE" ? 3 : 2;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href)
  run();
