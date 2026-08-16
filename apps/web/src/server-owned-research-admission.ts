import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createServerOwnedResearchAdmission,
  LIVE_RESEARCH_CREDENTIAL_HANDLES,
  providerCredentialHandlePresent,
} from "@matchbase/application";
import type { WebConfig } from "./config";

const DEFAULT_POLICY_PATH = "config/slice3/research-route-policy.v1.json";

export function loadServerOwnedResearchAdmission(
  config: WebConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const policyPath = config.testLivePolicyPath
    ? config.testLivePolicyPath
    : [
        resolve(process.cwd(), DEFAULT_POLICY_PATH),
        resolve(process.cwd(), "../..", DEFAULT_POLICY_PATH),
      ].find((candidate) => existsSync(candidate));
  if (!policyPath)
    throw new Error("Server-owned research route policy is unavailable.");
  const policy = JSON.parse(readFileSync(policyPath, "utf8")) as unknown;
  return createServerOwnedResearchAdmission({
    activationAuthorized: config.liveResearchEnabled === true,
    environment: config.environment,
    policy,
    verifiedCredentialHandles: {
      gemini_direct: providerCredentialHandlePresent(
        environment,
        LIVE_RESEARCH_CREDENTIAL_HANDLES.geminiDirect,
      ),
      openrouter: providerCredentialHandlePresent(
        environment,
        LIVE_RESEARCH_CREDENTIAL_HANDLES.openrouter,
      ),
    },
    // Standard projections remain synthetic until a distinct live disclosure
    // contract exists. This allowlist is server-owned and never request-derived.
    eligibleTiers: ["demo"],
  });
}
