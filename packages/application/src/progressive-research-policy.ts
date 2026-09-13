import type { ResearchRoundPlan } from "@matchbase/contracts";
import { ResearchRoundFault } from "@matchbase/data";

type ResearchStrategyPlan = Pick<
  ResearchRoundPlan,
  "round_number" | "research_strategy"
>;
export type ProgressiveResearchMethod =
  "public_social" | "official_institutions";

export function progressiveResearchMethods(
  plan: ResearchStrategyPlan,
): ProgressiveResearchMethod[] {
  if (
    plan.research_strategy !== undefined &&
    plan.research_strategy !== "progressive-evidence.v1"
  )
    throw new ResearchRoundFault(
      409,
      "MB-409-RESEARCH-STRATEGY",
      "The approved research method is not supported. Review a new estimate before further work.",
    );
  if (
    plan.research_strategy === undefined ||
    plan.round_number < 2 ||
    plan.round_number > 5
  )
    return [];
  return plan.round_number >= 4
    ? ["public_social", "official_institutions"]
    : ["public_social"];
}

export function requiresPublicSocialReview(
  plan: ResearchStrategyPlan,
): boolean {
  const methods = progressiveResearchMethods(plan);
  return plan.research_strategy === undefined
    ? plan.round_number >= 4 && plan.round_number <= 5
    : methods.includes("public_social");
}

export function progressiveResearchInstructions(
  plan: ResearchStrategyPlan,
): string {
  const methods = progressiveResearchMethods(plan);
  if (!methods.length) return "";
  return [
    "Use the retained evidence and buyer focus to test specific gaps, contradictions and relationships. Link each research question to the earlier facts that motivated it. Treat inferred relationships as hypotheses, not proof of ownership, agency, manufacturing or trade. Shared names, addresses or domains do not establish the same legal entity.",
    "Review accessible public corporate social profiles and dated posts for relevant activities, facilities, products and counterparties. Corroborate profile identity and individual claims with independent primary sources. A verification badge does not verify every claim; copied or syndicated announcements are one originating assertion, not independent confirmations.",
    ...(methods.includes("official_institutions")
      ? [
          "Prioritize official business registries, customs publicity, trade and industry ministries, sector regulators and licensing bodies in evidenced countries of registration and operation. Keep incorporation, headquarters, factory, branch, agent and served-market locations distinct. Use sourced original legal names and authority-qualified registration identifiers, including relevant subnational jurisdictions.",
          "Follow official records to resolve material conflicts and verify the scope, status and effective dates of licences, filings and documented relationships. Registration is not proof of delivery capability. Accounting-consolidating parent records are not automatically beneficial ownership. Country-level trade statistics and customs identifiers are not company-specific shipment history or supplier quotations; company-level customs data is not public in every jurisdiction.",
        ]
      : []),
    "Use public access only. Do not bypass login, CAPTCHA or paywalls, contact suppliers, purchase documents or submit administrative forms. Distinguish no match, ambiguous entity, unavailable source, access restriction and non-public data. Preserve record URLs, publisher, identifiers, dates and claim scope; missing access is not evidence of nonexistence.",
    "Retain previous round evidence and explicitly report new support, contradictions, remaining gaps and access limitations. More references alone do not imply greater confidence. Stay within this round's approved model, billing, call and research scope; no later round starts automatically.",
  ].join("\n\n");
}
