import { validateResearchRoutePolicy } from "@matchbase/ai-evidence";
import type { ResearchRoutePolicyV1 } from "@matchbase/contracts";
import { ApplicationFault, type PersistedTier } from "./types.js";

export type ResearchModeId = "synthetic_reference" | "qualified_live_research";

export interface ResearchModeDecision {
  readonly id: ResearchModeId;
  readonly label: "Synthetic reference" | "Qualified live research";
  readonly liveQualified: boolean;
}

export interface ServerOwnedResearchAdmission {
  decide(tier: PersistedTier): ResearchModeDecision;
  isReady(): boolean;
}

const SYNTHETIC_DECISION: ResearchModeDecision = Object.freeze({
  id: "synthetic_reference",
  label: "Synthetic reference",
  liveQualified: false,
});

const QUALIFIED_LIVE_DECISION: ResearchModeDecision = Object.freeze({
  id: "qualified_live_research",
  label: "Qualified live research",
  liveQualified: true,
});

export const syntheticResearchAdmission: ServerOwnedResearchAdmission =
  Object.freeze({
    isReady() {
      return true;
    },
    decide() {
      return SYNTHETIC_DECISION;
    },
  });

export function createServerOwnedResearchAdmission(input: {
  readonly activationAuthorized: boolean;
  readonly environment: ResearchRoutePolicyV1["environment"];
  readonly policy: unknown;
  readonly verifiedCredentialHandles: Readonly<{
    gemini_direct: boolean;
    openrouter: boolean;
  }>;
  readonly eligibleTiers: readonly PersistedTier[];
  readonly now?: () => Date;
}): ServerOwnedResearchAdmission {
  const policy: ResearchRoutePolicyV1 = validateResearchRoutePolicy(
    input.policy,
  );
  const eligibleTiers = new Set(input.eligibleTiers);
  const qualifiedRoutes = policy.routes.filter(
    (route) => route.enabled && route.liveQualified,
  );
  const routeHandlesVerified = qualifiedRoutes.every(
    (route) => input.verifiedCredentialHandles[route.path],
  );
  const qualifiedConfiguration =
    input.activationAuthorized &&
    policy.liveActivation === "enabled" &&
    policy.environment === input.environment &&
    qualifiedRoutes.length === 2 &&
    routeHandlesVerified;

  const policyIsCurrent = (): boolean => {
    const now = (input.now?.() ?? new Date()).toISOString();
    return (
      policy.evaluatedAt <= now &&
      qualifiedRoutes.every(
        (route) => route.dataHandling.evidenceExpiresAt >= now,
      )
    );
  };
  const liveQualified = (): boolean =>
    qualifiedConfiguration && policyIsCurrent();
  const ready = (): boolean => !input.activationAuthorized || liveQualified();

  return Object.freeze({
    isReady: ready,
    decide(tier: PersistedTier): ResearchModeDecision {
      if (input.activationAuthorized && !liveQualified())
        throw new ApplicationFault(
          503,
          "live-research-admission-unavailable",
          "MB-503-LIVE-ADMISSION",
          "Qualified live research admission is temporarily unavailable.",
          true,
        );
      return liveQualified() && eligibleTiers.has(tier)
        ? QUALIFIED_LIVE_DECISION
        : SYNTHETIC_DECISION;
    },
  });
}
