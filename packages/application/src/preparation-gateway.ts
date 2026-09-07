import {
  createApprovedRequestSnapshotV3,
  formatApprovedFactV3,
  type ApprovedRequestSnapshotV3,
} from "@matchbase/contracts";
import crypto from "node:crypto";
import type {
  ProductClassificationRecord,
  ExplicitRequirementLedger,
  ModelSuggestionItem,
  Step1FidelityValidationResult,
} from "@matchbase/contracts";
import { validateStep1RequirementFidelity } from "@matchbase/contracts";

export interface NormalizedRequirement {
  readonly requirement_id: string;
  readonly source_box:
    "product_requirement" | "technical_compliance" | "order_profile";
  readonly source_text_reference: string;
  readonly normalized_value: string;
  readonly unit?: string | undefined;
  readonly requirement_level: "mandatory" | "preferred" | "excluded";
  readonly derivation_type:
    "explicit" | "normalized" | "inferred_suggestion" | "unknown";
}

export interface Step1InterpretationResult {
  readonly original_language: string;
  readonly english_translation: string;
  readonly product_category: string;
  readonly product_name: string;
  readonly explicit_requirements: readonly NormalizedRequirement[];
  readonly mandatory_requirements: readonly string[];
  readonly preferred_requirements: readonly string[];
  readonly excluded_requirements: readonly string[];
  readonly ambiguities: readonly string[];
  readonly unknowns: readonly string[];
  readonly suggested_clarifications: readonly string[];
  readonly classification: ProductClassificationRecord;
  readonly ledger?: ExplicitRequirementLedger | undefined;
  readonly model_suggestions?: readonly ModelSuggestionItem[] | undefined;
  readonly fidelity_validation?: Step1FidelityValidationResult | undefined;
}

export interface Step2AdvisoryResult {
  readonly loop1_trade_lane: string;
  readonly loop2_regulatory: string;
  readonly loop3_supply_structure: string;
  readonly sources: readonly {
    readonly title: string;
    readonly url: string;
    readonly publisher?: string;
    readonly as_of_date?: string;
  }[];
  readonly sourcing_risks: readonly string[];
  readonly verification_priorities: readonly string[];
}

export interface Step3PromptResult {
  readonly prompt_text: string;
  readonly discovery_criteria: readonly string[];
  readonly evidence_thresholds: readonly string[];
  readonly target_supplier_count: number;
}

export interface ApprovedRequestRevision {
  readonly revision_id: string;
  readonly english_translation: string;
  readonly product_category: string;
  readonly product_name: string;
  readonly key_specifications: readonly string[];
  readonly incoterm?: string;
  readonly destination?: string;
  readonly approved_at: string;
  readonly canonical_snapshot?: ApprovedRequestSnapshotV3;
}

export function detectDomainFromText(
  text: string,
): "poultry" | "water_heater" | "generic" {
  if (
    /poultry|chicken|broiler|slaughterhouse|مرغ|طیور|کشتارگاه|دواجن|دجاج/i.test(
      text,
    )
  )
    return "poultry";
  if (/water\s*heater|calorifier|آب[‌ ]?گرمکن|ابگرمکن|سخان/i.test(text))
    return "water_heater";
  return "generic";
}

export class PreparationModelGateway {
  /** Deterministic preparation retains supplied text; it never invents a translation or product specification. */
  async extractAndInterpret(intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  }): Promise<Step1InterpretationResult> {
    const english_translation = [
      intake.product_requirement,
      intake.technical_compliance,
      intake.order_profile,
    ]
      .filter(Boolean)
      .join("\n");
    const fidelity_validation = validateStep1RequirementFidelity(intake, {
      english_translation,
    });
    const ledger = fidelity_validation.ledger;
    const explicit_requirements = ledger.requirements.map((r) => ({
      requirement_id: r.requirement_id,
      source_box: r.source_box,
      source_text_reference: r.source_text,
      normalized_value: r.normalized_value,
      ...(r.unit ? { unit: r.unit } : {}),
      requirement_level: r.requirement_level,
      derivation_type: "explicit" as const,
    }));
    const product_name =
      intake.product_requirement.split(/[.;\n]/)[0]?.trim() ||
      "Unspecified product";
    const classification: ProductClassificationRecord = {
      classification_id: crypto.randomUUID(),
      scheme: "CUSTOM_MATCHBASE",
      code: "UNCLASSIFIED",
      version: "1",
      level: "provisional",
      label: "Classification requires verification",
      description: product_name,
      is_primary: true,
      confidence: "not_assessed",
      assigned_at: new Date().toISOString(),
    };
    const nonEnglish = /[\u0600-\u06ff]/.test(english_translation);
    return {
      original_language: nonEnglish ? "fa" : "en",
      english_translation,
      product_name,
      product_category: "Not classified",
      explicit_requirements,
      mandatory_requirements: ledger.requirements
        .filter((r) => r.modality === "mandatory")
        .map((r) => r.normalized_value),
      preferred_requirements: ledger.requirements
        .filter((r) => r.modality === "preferred")
        .map((r) => r.normalized_value),
      excluded_requirements: ledger.requirements
        .filter((r) => r.comparison_operator === "prohibits")
        .map((r) => r.normalized_value),
      ambiguities: [],
      unknowns: [
        "Product classification has not been externally verified.",
        ...(nonEnglish
          ? [
              "Demonstration preserves source-language text; English translation requires live preparation or a human edit.",
            ]
          : []),
      ],
      suggested_clarifications: [],
      classification,
      ledger,
      model_suggestions: [],
      fidelity_validation,
    };
  }

  private snapshot(
    request: ApprovedRequestRevision,
  ): ApprovedRequestSnapshotV3 {
    return (
      request.canonical_snapshot ??
      createApprovedRequestSnapshotV3({
        revision_id: request.revision_id,
        approved_translation: request.english_translation,
        product_name: request.product_name,
        product_category: request.product_category,
        approved_at: request.approved_at,
      })
    );
  }

  async generateAdvisoryLoops(
    approvedRequest: ApprovedRequestRevision,
    classification: ProductClassificationRecord,
  ): Promise<Step2AdvisoryResult> {
    const snapshot = this.snapshot(approvedRequest);
    const delivery = snapshot.facts
      .filter((f) => f.concept === "delivery_terms")
      .map(formatApprovedFactV3);
    const certifications = snapshot.facts
      .filter((f) => f.concept === "certification")
      .map(formatApprovedFactV3);
    return {
      loop1_trade_lane: `Approved commercial scope: ${delivery.join("; ") || "Delivery terms and destination were not specified."} Verify origin, destination, logistics, quotations and market access against official sources during research.`,
      loop2_regulatory: `Approved compliance requirements: ${certifications.join("; ") || "No certification was extracted; retain all requirements in the approved text."} Classification ${classification.scheme} ${classification.code} (${classification.confidence}) remains subject to independent verification.`,
      loop3_supply_structure: `Research supplier capability against the exact approved request below. An observed offer must remain separate from buyer requirements.\n${snapshot.approved_translation}`,
      sources: [],
      sourcing_risks: [
        "Demonstration advisory has not inspected live market or regulatory evidence.",
      ],
      verification_priorities: snapshot.facts.map(
        (fact) => `${fact.label}: ${formatApprovedFactV3(fact)}`,
      ),
    };
  }

  async generateDeepResearchPrompt(
    approvedRequest: ApprovedRequestRevision,
    _advisory: Step2AdvisoryResult,
    classification: ProductClassificationRecord,
  ): Promise<Step3PromptResult> {
    const snapshot = this.snapshot(approvedRequest);
    const criteria = snapshot.facts.map(
      (fact) => `${fact.label}: ${formatApprovedFactV3(fact)}`,
    );
    const prompt_text = `Research and compare up to 20 distinct legitimate suppliers for this human-approved B2B request.\n\nApproved request (verbatim; preserve every clause):\n${snapshot.approved_translation}\n\nStructured approved facts:\n${criteria.map((c) => `- ${c}`).join("\n")}\n\nRevision: ${snapshot.revision_id}\nRequest content hash: ${snapshot.content_hash}\nProvisional classification: ${classification.scheme} ${classification.code}; confidence ${classification.confidence}.\n\nUse official company websites, registries, product catalogues and dated primary sources. Verify legal identity, manufacturer/distributor role, exact product/model/specifications, certificates and scope, public business contacts, prices with currency/unit/Incoterm/location/date, MOQ, production capacity, lead time, payment terms, packaging and logistics. Cite each factual claim to its source URL and record conflicts and unknowns. Preserve buyer requirements separately from observed supplier offers. Never infer stock, compliance, authorization, exportability or matching capability from an unrelated claim. Return fewer than 20 when evidence is exhausted; do not invent companies, contacts, prices or citations. Rank fit separately from evidence confidence. Include per-supplier gaps and required RFQ validation.`;
    return {
      prompt_text,
      discovery_criteria: criteria,
      evidence_thresholds: [
        "Official identity and business contact evidence",
        "Product and requirement-level primary-source citations",
        "Commercial observations with currency, unit, Incoterm, place and date",
        "Explicit gaps, conflicts and required validation",
      ],
      target_supplier_count: 20,
    };
  }
}
