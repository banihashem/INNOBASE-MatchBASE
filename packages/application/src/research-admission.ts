import { validateResearchRoutePolicy } from "@matchbase/ai-evidence";
import type { ResearchRoutePolicyV1 } from "@matchbase/contracts";
import type { PersistedTier } from "./types.js";

export type ResearchModeId = "synthetic_reference" | "qualified_live_research";

export interface ResearchModeDecision {
  readonly id: ResearchModeId;
  readonly label: "Synthetic reference" | "Qualified live research";
  readonly liveQualified: boolean;
}

export interface ServerOwnedResearchAdmission {
  decide(tier: PersistedTier): ResearchModeDecision;
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
  const qualified =
    input.activationAuthorized &&
    policy.liveActivation === "enabled" &&
    policy.environment === input.environment &&
    qualifiedRoutes.length === 2 &&
    routeHandlesVerified;

  return Object.freeze({
    decide(tier: PersistedTier): ResearchModeDecision {
      return qualified && eligibleTiers.has(tier)
        ? QUALIFIED_LIVE_DECISION
        : SYNTHETIC_DECISION;
    },
  });
}
