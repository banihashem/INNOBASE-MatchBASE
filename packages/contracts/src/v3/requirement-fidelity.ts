import {
  parseApprovedRequestFactsV3,
  formatApprovedFactV3,
  normalizeRequirementText,
  type ApprovedRequestFactV3,
} from "./approved-request.js";
import { createHash, randomUUID } from "node:crypto";

export type RequirementSourceBox =
  "product_requirement" | "technical_compliance" | "order_profile";

export type RequirementModality = "mandatory" | "preferred" | "optional";

export type RequirementLevel = "mandatory" | "preferred" | "excluded";

export type RequirementDerivationType =
  | "explicit"
  | "language_translation"
  | "unit_normalization"
  | "user_accepted_suggestion"
  | "model_suggestion"
  | "unknown";

export type RequirementFidelityStatus =
  "preserved" | "normalized_equivalent" | "ambiguous" | "omitted" | "mutated";

export type ComparisonOperator =
  | "eq"
  | "gte"
  | "lte"
  | "range"
  | "contains"
  | "requires"
  | "prohibits"
  | "preferred";

export interface ExplicitRequirementItem {
  readonly requirement_id: string;
  readonly source_box: RequirementSourceBox;
  readonly source_text: string;
  readonly source_span_or_reference: string;
  readonly normalized_label: string;
  readonly normalized_value: string;
  readonly concept: string;
  readonly value?: string | undefined;
  readonly unit?: string | undefined;
  readonly comparison_operator?: ComparisonOperator | undefined;
  readonly lower_bound?: string | undefined;
  readonly upper_bound?: string | undefined;
  readonly duration?: string | undefined;
  readonly modality: RequirementModality;
  readonly requirement_level: RequirementLevel;
  readonly jurisdiction?: string | undefined;
  readonly supplier_role?: string | undefined;
  readonly evidence_qualifier?: string | undefined;
  readonly scope?: string | undefined;
  readonly derivation_type: RequirementDerivationType;
  readonly fidelity_status: RequirementFidelityStatus;
}

export interface ModelSuggestionItem {
  readonly suggestion_id: string;
  readonly title: string;
  readonly suggested_value: string;
  readonly reasoning: string;
  readonly status: "not_included_in_approved_request" | "user_accepted";
}

export interface ExplicitRequirementLedger {
  readonly ledger_id: string;
  readonly intake_hash: string;
  readonly requirements: readonly ExplicitRequirementItem[];
  readonly total_explicit_count: number;
}

export interface MutatedRequirementReport {
  readonly requirement: ExplicitRequirementItem;
  readonly prohibited_value?: string | undefined;
  readonly expected_operator?: ComparisonOperator | undefined;
  readonly observed_operator?: ComparisonOperator | undefined;
  readonly explanation: string;
}

export interface Step1FidelityValidationResult {
  readonly valid: boolean;
  readonly preserved_count: number;
  readonly normalized_count: number;
  readonly omitted_count: number;
  readonly mutated_count: number;
  readonly omitted_items: readonly ExplicitRequirementItem[];
  readonly mutated_items: readonly MutatedRequirementReport[];
  readonly ledger: ExplicitRequirementLedger;
  readonly model_suggestions: readonly ModelSuggestionItem[];
  readonly explanation?: string | undefined;
}

/**
 * Computes deterministic SHA-256 hash of the 3-box intake snapshot.
 */
export function computeSnapshotContentHash(intake: {
  product_requirement: string;
  technical_compliance: string;
  order_profile: string;
}): string {
  return createHash("sha256")
    .update(
      `${(intake.product_requirement || "").trim()}\n---\n${(intake.technical_compliance || "").trim()}\n---\n${(intake.order_profile || "").trim()}`,
    )
    .digest("hex");
}

function factToRequirement(
  fact: ApprovedRequestFactV3,
): ExplicitRequirementItem {
  return {
    requirement_id: fact.fact_id,
    source_box:
      fact.source_box === "approved_translation"
        ? "product_requirement"
        : fact.source_box,
    source_text: fact.source_clause,
    source_span_or_reference: fact.source_clause,
    normalized_label: fact.label,
    normalized_value: formatApprovedFactV3(fact),
    concept: fact.concept,
    value: String(fact.value),
    ...(fact.unit ? { unit: fact.unit } : {}),
    comparison_operator: fact.operator,
    modality: fact.modality,
    requirement_level:
      fact.modality === "mandatory" ? "mandatory" : "preferred",
    ...(fact.qualifiers.jurisdiction
      ? { jurisdiction: fact.qualifiers.jurisdiction }
      : {}),
    ...(fact.qualifiers.authorization === "authorized"
      ? { supplier_role: "authorized_distributor" }
      : {}),
    ...(fact.qualifiers.evidence
      ? { evidence_qualifier: fact.qualifiers.evidence }
      : {}),
    derivation_type: "explicit",
    fidelity_status: "preserved",
  };
}

export function extractExplicitRequirementLedger(intake: {
  product_requirement: string;
  technical_compliance: string;
  order_profile: string;
}): ExplicitRequirementLedger {
  const facts = (
    ["product_requirement", "technical_compliance", "order_profile"] as const
  ).flatMap((box) => parseApprovedRequestFactsV3(intake[box], box).facts);
  return {
    ledger_id: randomUUID(),
    intake_hash: computeSnapshotContentHash(intake),
    requirements: facts.map(factToRequirement),
    total_explicit_count: facts.length,
  };
}
export function validateStep1RequirementFidelity(
  intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  },
  step1: {
    english_translation: string;
    mandatory_requirements?: readonly string[] | undefined;
    explicit_requirements?: readonly any[] | undefined;
    model_suggestions?: readonly ModelSuggestionItem[] | undefined;
  },
): Step1FidelityValidationResult {
  const expected = (
    ["product_requirement", "technical_compliance", "order_profile"] as const
  ).flatMap((box) => parseApprovedRequestFactsV3(intake[box], box).facts);
  const observed = parseApprovedRequestFactsV3(
    step1.english_translation || "",
  ).facts;
  const requirementFor = factToRequirement;
  const ledger: ExplicitRequirementLedger = {
    ledger_id: randomUUID(),
    intake_hash: computeSnapshotContentHash(intake),
    requirements: expected.map(requirementFor),
    total_explicit_count: expected.length,
  };
  const omitted: ExplicitRequirementItem[] = [];
  const mutated: MutatedRequirementReport[] = [];
  let preserved = 0;
  const equivalent = (a: ApprovedRequestFactV3, b: ApprovedRequestFactV3) => {
    const valueMatches =
      typeof a.value === "number" && typeof b.value === "number"
        ? Math.abs(a.value - b.value) <= 0.000001
        : normalizeRequirementText(String(a.value)).toLowerCase() ===
          normalizeRequirementText(String(b.value)).toLowerCase();
    return (
      valueMatches &&
      a.unit === b.unit &&
      a.operator === b.operator &&
      a.modality === b.modality &&
      a.upper_bound === b.upper_bound &&
      Object.entries(a.qualifiers).every(
        ([key, value]) =>
          normalizeRequirementText(b.qualifiers[key] ?? "").toLowerCase() ===
          normalizeRequirementText(value).toLowerCase(),
      )
    );
  };
  for (const fact of expected) {
    const item = requirementFor(fact);
    const candidates = observed.filter(
      (candidate) => candidate.concept === fact.concept,
    );
    if (!candidates.length) {
      omitted.push({ ...item, fidelity_status: "omitted" });
      continue;
    }
    if (!candidates.some((candidate) => equivalent(fact, candidate))) {
      mutated.push({
        requirement: { ...item, fidelity_status: "mutated" },
        expected_operator: fact.operator,
        observed_operator: candidates[0]!.operator,
        prohibited_value: candidates.map(formatApprovedFactV3).join("; "),
        explanation: `Approved interpretation changes '${fact.label}': expected ${formatApprovedFactV3(fact)}; observed ${candidates.map(formatApprovedFactV3).join("; ")}.`,
      });
      continue;
    }
    // A matching value does not cancel a contradictory value in the same interpretation.
    if (
      candidates.some((candidate) => !equivalent(fact, candidate)) &&
      expected.filter((x) => x.concept === fact.concept).length === 1
    ) {
      mutated.push({
        requirement: { ...item, fidelity_status: "ambiguous" },
        explanation: `Conflicting values for '${fact.label}' appear in the interpretation.`,
      });
      continue;
    }
    preserved++;
  }
  const empty = !step1.english_translation?.trim();
  const valid = !empty && omitted.length === 0 && mutated.length === 0;
  return {
    valid,
    preserved_count: preserved,
    normalized_count: 0,
    omitted_count: omitted.length,
    mutated_count: mutated.length,
    omitted_items: omitted,
    mutated_items: mutated,
    ledger,
    model_suggestions: step1.model_suggestions ?? [],
    ...(!valid
      ? {
          explanation: empty
            ? "The current interpretation is empty; stale arrays cannot approve it."
            : [
                ...omitted.map(
                  (item) =>
                    `Missing explicit requirement: '${item.normalized_label}' (${item.normalized_value}).`,
                ),
                ...mutated.map((item) => item.explanation),
              ].join(" "),
        }
      : {}),
  };
}
