import type { ConsultantResultProjectionV1 } from "../v1/consultant-projection.js";

export const CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION =
  "consultant-research-output.v2" as const;
export const CONSULTANT_RESEARCH_OUTPUT_V2_VERSION = 1 as const;

export type ResearchModeV2 = "live" | "hybrid" | "fixture";

export type ResearchStatusV2 =
  | "complete"
  | "partial"
  | "insufficient_evidence"
  | "no_strong_match"
  | "out_of_scope"
  | "failed";

export type PrimaryQueryTypeV2 =
  | "sourcing"
  | "pricing"
  | "product_recommendation"
  | "product_catalog"
  | "market_overview"
  | "general_info";

export type ConfidenceLevelV2 = "high" | "medium" | "low";

export type VerificationStatusV2 =
  | "externally_verified"
  | "supplier_claimed"
  | "inferred"
  | "illustrative"
  | "unknown";

export type FreshnessStatusV2 = "current" | "aging" | "historical" | "unknown";

export type ConflictStatusV2 =
  "corroborated" | "single_source" | "conflicting" | "disputed";

export type SupplierTypeV2 =
  | "manufacturer"
  | "distributor"
  | "trading_company"
  | "cooperative"
  | "service_provider"
  | "unknown";

export interface StructuredRequirementV2 {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
  readonly requirement_level: "mandatory" | "preferred" | "informational";
}

export interface RequestSnapshotV2 {
  readonly primary_query_type: PrimaryQueryTypeV2;
  readonly secondary_query_types: readonly PrimaryQueryTypeV2[];
  readonly intent_scope:
    "global" | "regional" | "domestic" | "trade_lane" | "unspecified";
  readonly business_context: readonly string[];
  readonly product_category: string;
  readonly product_name: string;
  readonly confidence_level_required: ConfidenceLevelV2;
  readonly compliance_sensitive: boolean;
  readonly pricing_volatile: boolean;
  readonly product_attributes: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  readonly normalized_requirements: readonly StructuredRequirementV2[];
  readonly mandatory_constraints: readonly string[];
  readonly preferred_constraints: readonly string[];
  readonly excluded_constraints: readonly string[];
  readonly geographic_scope?: string;
  readonly destination_market?: string;
  readonly commercial_context?: string;
}

export interface ExecutiveSummaryV2 {
  readonly headline: string;
  readonly direct_answer: string;
  readonly key_findings: readonly string[];
  readonly candidate_count: number;
  readonly confidence_assessment: ConfidenceLevelV2;
  readonly primary_limitation?: string;
  readonly no_match_summary?: string;
}

export interface SourcingModuleV2 {
  readonly market_landscape_summary: string;
  readonly evaluated_supplier_count: number;
  readonly qualified_supplier_count: number;
  readonly shortlisted_candidate_ids: readonly string[];
  readonly trade_lane_evaluated?: string;
  readonly key_bottlenecks: readonly string[];
  readonly recommendations_summary: string;
}

export interface PricingObservationV2 {
  readonly observation_id: string;
  readonly price_type:
    "indicative" | "quoted" | "contracted" | "historical_index" | "inferred";
  readonly amount_min?: number;
  readonly amount_max?: number;
  readonly currency: string; // ISO 4217
  readonly unit: string; // UN/CEFACT (e.g. KGM, TNE, PCE)
  readonly quantity_basis?: string;
  readonly trade_basis?: string;
  readonly incoterm?: string; // Incoterms 2020 (FOB, CIF, EXW, etc.)
  readonly location_basis?: string;
  readonly valid_from?: string;
  readonly valid_until?: string;
  readonly retrieved_at: string;
  readonly source_date?: string;
  readonly confidence: ConfidenceLevelV2;
  readonly evidence_ids: readonly string[];
  readonly notes?: string;
}

export interface PricingBenchmarkV2 {
  readonly benchmark_name: string;
  readonly benchmark_price: number;
  readonly currency: string;
  readonly unit: string;
  readonly source: string;
  readonly as_of_date: string;
}

export interface PricingModuleV2 {
  readonly overview: string;
  readonly pricing_observations: readonly PricingObservationV2[];
  readonly price_factors: readonly string[];
  readonly volatility_rating: "high" | "medium" | "low" | "unknown";
  readonly volatility_notes?: string;
  readonly benchmarks: readonly PricingBenchmarkV2[];
}

export interface ProductRecommendationItemV2 {
  readonly product_id: string;
  readonly product_name: string;
  readonly brand_or_maker: string;
  readonly category: string;
  readonly description: string;
  readonly use_case_fit: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly functional_equivalency:
    | "direct_drop_in"
    | "adaptive_substitute"
    | "partial_match"
    | "custom_formulation";
  readonly tradeoffs: readonly string[];
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
}

export interface ProductRecommendationModuleV2 {
  readonly overview: string;
  readonly recommendations: readonly ProductRecommendationItemV2[];
  readonly selection_criteria: readonly string[];
}

export interface CatalogProductLineV2 {
  readonly line_id: string;
  readonly product_family: string;
  readonly sku_or_model: string;
  readonly variant_name: string;
  readonly specifications: Readonly<Record<string, string | number | boolean>>;
  readonly certifications_held: readonly string[];
  readonly packaging?: string;
  readonly moq?: string;
  readonly availability:
    "in_production" | "made_to_order" | "discontinued" | "unknown";
  readonly pricing_reference?: string;
  readonly evidence_ids: readonly string[];
}

export interface ProductCatalogModuleV2 {
  readonly catalog_id: string;
  readonly supplier_entity_id: string;
  readonly supplier_name: string;
  readonly catalog_name: string;
  readonly as_of_date: string;
  readonly product_lines: readonly CatalogProductLineV2[];
}

export interface TradeFlowV2 {
  readonly origin_country: string;
  readonly destination_country: string;
  readonly volume_description: string;
  readonly trend: "growing" | "stable" | "declining" | "unknown";
}

export interface MarketOverviewModuleV2 {
  readonly market_scope: string;
  readonly as_of_date: string;
  readonly supply_concentration:
    | "highly_concentrated"
    | "moderately_concentrated"
    | "fragmented"
    | "unknown";
  readonly supply_structure_summary: string;
  readonly demand_signals: readonly string[];
  readonly regulatory_context: readonly string[];
  readonly trade_flows: readonly TradeFlowV2[];
  readonly key_risks: readonly string[];
  readonly market_opportunities: readonly string[];
  readonly limitations: readonly string[];
  readonly evidence_ids: readonly string[];
}

export interface GeneralInfoDefinitionV2 {
  readonly term: string;
  readonly definition: string;
}

export interface GeneralInfoStandardV2 {
  readonly standard_code: string;
  readonly title: string;
  readonly issuing_body: string;
  readonly summary: string;
}

export interface GeneralInfoModuleV2 {
  readonly topic_title: string;
  readonly topic_summary: string;
  readonly key_definitions: readonly GeneralInfoDefinitionV2[];
  readonly regulatory_standards: readonly GeneralInfoStandardV2[];
  readonly procedural_guidance: readonly string[];
  readonly frequently_encountered_pitfalls: readonly string[];
  readonly sources_consulted: readonly string[];
}

export interface ResultModulesV2 {
  readonly sourcing?: SourcingModuleV2;
  readonly pricing?: PricingModuleV2;
  readonly product_recommendation?: ProductRecommendationModuleV2;
  readonly product_catalog?: ProductCatalogModuleV2;
  readonly market_overview?: MarketOverviewModuleV2;
  readonly general_info?: GeneralInfoModuleV2;
}

export interface StructuredQuantityV2 {
  readonly value: number;
  readonly unit: string;
  readonly description?: string;
}

export interface StructuredCapacityV2 {
  readonly annual_or_monthly:
    "annual" | "monthly" | "daily" | "batch" | "unspecified";
  readonly volume: number;
  readonly unit: string;
  readonly description?: string;
}

export interface StructuredShelfLifeV2 {
  readonly duration_months: number;
  readonly storage_temperature_celsius?: number;
  readonly storage_condition?: string;
}

export interface CandidateOfferingV2 {
  readonly sku_or_name: string;
  readonly description: string;
  readonly specifications: Readonly<Record<string, string | number | boolean>>;
}

export interface CandidateCertificationV2 {
  readonly certification_name: string;
  readonly issuer: string;
  readonly valid_until?: string;
  readonly verification_state: "verified" | "claimed" | "expired" | "unknown";
  readonly evidence_id?: string;
}

export interface CandidateComplianceV2 {
  readonly regulatory_clearance_status:
    "cleared" | "pending" | "restricted" | "unknown";
  readonly sfda_approved?: boolean;
  readonly halal_certified?: boolean;
  readonly iso_certifications: readonly string[];
  readonly notes?: string;
}

export interface CandidateLogisticsV2 {
  readonly supported_incoterms: readonly string[];
  readonly primary_shipping_ports: readonly string[];
  readonly cold_chain_guaranteed?: boolean;
  readonly typical_lead_time_days?: number;
}

export interface ConstraintEvaluationV2 {
  readonly constraint_name: string;
  readonly outcome: "pass" | "fail" | "unverifiable";
  readonly rationale: string;
}

export interface CandidateFitAssessmentV2 {
  readonly compatibility_score: number; // 0-100
  readonly fit_band: "strong" | "potential" | "low";
  readonly evidence_confidence: ConfidenceLevelV2;
  readonly dimension_scores: Readonly<Record<string, number>>;
  readonly positive_drivers: readonly string[];
  readonly limiting_gaps: readonly string[];
  readonly risk_flags: readonly string[];
  readonly mandatory_constraint_results: readonly ConstraintEvaluationV2[];
  readonly human_review_required: boolean;
}

export interface SupplierCandidateV2 {
  readonly candidate_id: string; // e.g. "CAND-V2-001" or UUID
  readonly entity_id: string; // e.g. "ENT-BR-BRF-001"
  readonly legal_name: string;
  readonly trading_name?: string;
  readonly brand_names: readonly string[];
  readonly country_code: string; // ISO 3166-1 alpha-2
  readonly manufacturing_locations: readonly string[];
  readonly website?: string;
  readonly supplier_type: SupplierTypeV2;
  readonly verification_status: VerificationStatusV2;
  readonly verification_summary: string;
  readonly offerings: readonly CandidateOfferingV2[];
  readonly moq: StructuredQuantityV2;
  readonly capacity: StructuredCapacityV2;
  readonly certifications: readonly CandidateCertificationV2[];
  readonly compliance: CandidateComplianceV2;
  readonly shelf_life?: StructuredShelfLifeV2;
  readonly logistics: CandidateLogisticsV2;
  readonly fit_assessment: CandidateFitAssessmentV2;
  readonly risks: readonly string[];
  readonly required_validation: readonly string[];
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
}

export interface ResearchClaimV2 {
  readonly claim_id: string;
  readonly claim_text: string;
  readonly claim_type:
    | "capability"
    | "compliance"
    | "pricing"
    | "capacity"
    | "identity"
    | "logistics"
    | "general";
  readonly subject_id: string;
  readonly confidence: ConfidenceLevelV2;
  readonly evidence_ids: readonly string[];
  readonly conflict_status: ConflictStatusV2;
}

export interface ResearchEvidenceItemV2 {
  readonly evidence_id: string;
  readonly source_url: string;
  readonly source_title: string;
  readonly publisher: string;
  readonly source_type:
    | "official_registry"
    | "manufacturer_portal"
    | "trade_directory"
    | "industry_report"
    | "regulatory_body"
    | "synthetic_reference";
  readonly published_at?: string;
  readonly retrieved_at: string;
  readonly verification_status: "verified" | "unverified" | "illustrative";
  readonly freshness_status: FreshnessStatusV2;
  readonly supports_claim_ids: readonly string[];
  readonly contradicts_claim_ids: readonly string[];
  readonly excerpt_summary: string;
  readonly content_sha256?: string;
}

export interface ResearchUnknownV2 {
  readonly field_or_topic: string;
  readonly reason: string;
  readonly impact: "blocking" | "degrading" | "informational";
  readonly recommended_validation: string;
}

export interface ResearchAssumptionV2 {
  readonly assumption_id: string;
  readonly description: string;
  readonly rationale: string;
  readonly sensitivity: "high" | "medium" | "low";
}

export interface ResearchLimitationV2 {
  readonly limitation_id: string;
  readonly title: string;
  readonly description: string;
  readonly scope:
    | "search_coverage"
    | "data_freshness"
    | "legal_compliance"
    | "commercial_commitment";
}

export interface DecisionSupportV2 {
  readonly advisory_notice: string;
  readonly recommended_actions: readonly string[];
  readonly questions_to_resolve: readonly string[];
  readonly validation_priorities: readonly string[];
  readonly shortlist_guidance?: string;
  readonly human_review_required: boolean;
}

export interface ConsultantResearchOutputV2 {
  readonly schema_version: typeof CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION;
  readonly result_id: string;
  readonly run_id: string;
  readonly generated_at: string;
  readonly research_mode: ResearchModeV2;
  readonly research_status: ResearchStatusV2;
  readonly request_snapshot: RequestSnapshotV2;
  readonly executive_summary: ExecutiveSummaryV2;
  readonly result_modules: ResultModulesV2;
  readonly supplier_candidates: readonly SupplierCandidateV2[];
  readonly claims: readonly ResearchClaimV2[];
  readonly evidence: readonly ResearchEvidenceItemV2[];
  readonly unknowns: readonly ResearchUnknownV2[];
  readonly assumptions: readonly ResearchAssumptionV2[];
  readonly limitations: readonly ResearchLimitationV2[];
  readonly decision_support: DecisionSupportV2;
}

// ---------------------------------------------------------------------------
// Runtime Validation Helpers
// ---------------------------------------------------------------------------

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function nonemptyString(value: unknown, label: string): string {
  const s = string(value, label);
  if (!s.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return s;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function member<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function parseConsultantResearchOutputV2(
  value: unknown,
): ConsultantResearchOutputV2 {
  let normalized: unknown;
  try {
    normalized = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new Error("Consultant research output v2 is not serializable.");
  }

  const root = record(normalized, "Consultant research output v2");

  if (root.schema_version !== CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION) {
    throw new Error(
      `Consultant research output v2 schema version must be "${CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION}".`,
    );
  }

  const result_id = nonemptyString(root.result_id, "Result ID");
  const run_id = nonemptyString(root.run_id, "Run ID");
  const generated_at = nonemptyString(root.generated_at, "Generated at");

  const research_mode = member<ResearchModeV2>(
    root.research_mode,
    ["live", "hybrid", "fixture"],
    "Research mode",
  );

  const research_status = member<ResearchStatusV2>(
    root.research_status,
    [
      "complete",
      "partial",
      "insufficient_evidence",
      "no_strong_match",
      "out_of_scope",
      "failed",
    ],
    "Research status",
  );

  // Validate request_snapshot
  const snapRaw = record(root.request_snapshot, "Request snapshot");
  const primary_query_type = member<PrimaryQueryTypeV2>(
    snapRaw.primary_query_type,
    [
      "sourcing",
      "pricing",
      "product_recommendation",
      "product_catalog",
      "market_overview",
      "general_info",
    ],
    "Primary query type",
  );

  const secondary_query_types = array(
    snapRaw.secondary_query_types,
    "Secondary query types",
  ).map((t) =>
    member<PrimaryQueryTypeV2>(
      t,
      [
        "sourcing",
        "pricing",
        "product_recommendation",
        "product_catalog",
        "market_overview",
        "general_info",
      ],
      "Secondary query type",
    ),
  );

  const intent_scope = member(
    snapRaw.intent_scope,
    ["global", "regional", "domestic", "trade_lane", "unspecified"],
    "Intent scope",
  );

  const business_context = array(
    snapRaw.business_context,
    "Business context",
  ).map((s) => string(s, "Business context item"));

  const product_category = string(snapRaw.product_category, "Product category");
  const product_name = string(snapRaw.product_name, "Product name");

  const confidence_level_required = member<ConfidenceLevelV2>(
    snapRaw.confidence_level_required,
    ["high", "medium", "low"],
    "Confidence level required",
  );

  const compliance_sensitive = boolean(
    snapRaw.compliance_sensitive,
    "Compliance sensitive",
  );
  const pricing_volatile = boolean(
    snapRaw.pricing_volatile,
    "Pricing volatile",
  );

  const product_attributes = record(
    snapRaw.product_attributes,
    "Product attributes",
  ) as Record<string, string | number | boolean | readonly string[]>;

  const normalized_requirements = array(
    snapRaw.normalized_requirements,
    "Normalized requirements",
  ).map((r) => {
    const rec = record(r, "Normalized requirement");
    return {
      name: nonemptyString(rec.name, "Requirement name"),
      value: rec.value as string | number | boolean,
      ...(rec.unit ? { unit: string(rec.unit, "Requirement unit") } : {}),
      requirement_level: member(
        rec.requirement_level,
        ["mandatory", "preferred", "informational"],
        "Requirement level",
      ),
    };
  });

  const mandatory_constraints = array(
    snapRaw.mandatory_constraints,
    "Mandatory constraints",
  ).map((s) => string(s, "Mandatory constraint"));

  const preferred_constraints = array(
    snapRaw.preferred_constraints,
    "Preferred constraints",
  ).map((s) => string(s, "Preferred constraint"));

  const excluded_constraints = array(
    snapRaw.excluded_constraints,
    "Excluded constraints",
  ).map((s) => string(s, "Excluded constraint"));

  const request_snapshot: RequestSnapshotV2 = {
    primary_query_type,
    secondary_query_types,
    intent_scope,
    business_context,
    product_category,
    product_name,
    confidence_level_required,
    compliance_sensitive,
    pricing_volatile,
    product_attributes,
    normalized_requirements,
    mandatory_constraints,
    preferred_constraints,
    excluded_constraints,
    ...(snapRaw.geographic_scope
      ? {
          geographic_scope: string(
            snapRaw.geographic_scope,
            "Geographic scope",
          ),
        }
      : {}),
    ...(snapRaw.destination_market
      ? {
          destination_market: string(
            snapRaw.destination_market,
            "Destination market",
          ),
        }
      : {}),
    ...(snapRaw.commercial_context
      ? {
          commercial_context: string(
            snapRaw.commercial_context,
            "Commercial context",
          ),
        }
      : {}),
  };

  // Validate executive_summary
  const execRaw = record(root.executive_summary, "Executive summary");
  const executive_summary: ExecutiveSummaryV2 = {
    headline: nonemptyString(execRaw.headline, "Executive summary headline"),
    direct_answer: nonemptyString(
      execRaw.direct_answer,
      "Executive summary direct answer",
    ),
    key_findings: array(execRaw.key_findings, "Key findings").map((s) =>
      string(s, "Key finding"),
    ),
    candidate_count: number(execRaw.candidate_count, "Candidate count"),
    confidence_assessment: member<ConfidenceLevelV2>(
      execRaw.confidence_assessment,
      ["high", "medium", "low"],
      "Confidence assessment",
    ),
    ...(execRaw.primary_limitation
      ? {
          primary_limitation: string(
            execRaw.primary_limitation,
            "Primary limitation",
          ),
        }
      : {}),
    ...(execRaw.no_match_summary
      ? {
          no_match_summary: string(
            execRaw.no_match_summary,
            "No match summary",
          ),
        }
      : {}),
  };

  // Validate result_modules
  const modRaw = record(root.result_modules, "Result modules");
  const sourcing: SourcingModuleV2 | undefined = modRaw.sourcing
    ? (() => {
        const s = record(modRaw.sourcing, "Sourcing module");
        return {
          market_landscape_summary: string(
            s.market_landscape_summary,
            "Market landscape summary",
          ),
          evaluated_supplier_count: number(
            s.evaluated_supplier_count,
            "Evaluated supplier count",
          ),
          qualified_supplier_count: number(
            s.qualified_supplier_count,
            "Qualified supplier count",
          ),
          shortlisted_candidate_ids: array(
            s.shortlisted_candidate_ids,
            "Shortlisted candidate IDs",
          ).map((id) => string(id, "Candidate ID")),
          ...(s.trade_lane_evaluated
            ? {
                trade_lane_evaluated: string(
                  s.trade_lane_evaluated,
                  "Trade lane evaluated",
                ),
              }
            : {}),
          key_bottlenecks: array(s.key_bottlenecks, "Key bottlenecks").map(
            (b) => string(b, "Bottleneck"),
          ),
          recommendations_summary: string(
            s.recommendations_summary,
            "Recommendations summary",
          ),
        };
      })()
    : undefined;

  const pricing: PricingModuleV2 | undefined = modRaw.pricing
    ? (() => {
        const p = record(modRaw.pricing, "Pricing module");
        return {
          overview: string(p.overview, "Pricing overview"),
          pricing_observations: array(
            p.pricing_observations,
            "Pricing observations",
          ).map((obs) => {
            const o = record(obs, "Pricing observation");
            return {
              observation_id: nonemptyString(
                o.observation_id,
                "Observation ID",
              ),
              price_type: member(
                o.price_type,
                [
                  "indicative",
                  "quoted",
                  "contracted",
                  "historical_index",
                  "inferred",
                ],
                "Price type",
              ),
              ...(o.amount_min !== undefined
                ? { amount_min: number(o.amount_min, "Amount min") }
                : {}),
              ...(o.amount_max !== undefined
                ? { amount_max: number(o.amount_max, "Amount max") }
                : {}),
              currency: string(o.currency, "Currency"),
              unit: string(o.unit, "Unit"),
              ...(o.quantity_basis
                ? { quantity_basis: string(o.quantity_basis, "Quantity basis") }
                : {}),
              ...(o.trade_basis
                ? { trade_basis: string(o.trade_basis, "Trade basis") }
                : {}),
              ...(o.incoterm
                ? { incoterm: string(o.incoterm, "Incoterm") }
                : {}),
              ...(o.location_basis
                ? { location_basis: string(o.location_basis, "Location basis") }
                : {}),
              ...(o.valid_from
                ? { valid_from: string(o.valid_from, "Valid from") }
                : {}),
              ...(o.valid_until
                ? { valid_until: string(o.valid_until, "Valid until") }
                : {}),
              retrieved_at: string(o.retrieved_at, "Retrieved at"),
              ...(o.source_date
                ? { source_date: string(o.source_date, "Source date") }
                : {}),
              confidence: member<ConfidenceLevelV2>(
                o.confidence,
                ["high", "medium", "low"],
                "Price confidence",
              ),
              evidence_ids: array(
                o.evidence_ids,
                "Observation evidence IDs",
              ).map((id) => string(id, "Evidence ID")),
              ...(o.notes ? { notes: string(o.notes, "Price notes") } : {}),
            };
          }),
          price_factors: array(p.price_factors, "Price factors").map((f) =>
            string(f, "Price factor"),
          ),
          volatility_rating: member(
            p.volatility_rating,
            ["high", "medium", "low", "unknown"],
            "Volatility rating",
          ),
          ...(p.volatility_notes
            ? {
                volatility_notes: string(
                  p.volatility_notes,
                  "Volatility notes",
                ),
              }
            : {}),
          benchmarks: array(p.benchmarks, "Pricing benchmarks").map((b) => {
            const bRec = record(b, "Pricing benchmark");
            return {
              benchmark_name: string(bRec.benchmark_name, "Benchmark name"),
              benchmark_price: number(bRec.benchmark_price, "Benchmark price"),
              currency: string(bRec.currency, "Benchmark currency"),
              unit: string(bRec.unit, "Benchmark unit"),
              source: string(bRec.source, "Benchmark source"),
              as_of_date: string(bRec.as_of_date, "Benchmark as of date"),
            };
          }),
        };
      })()
    : undefined;

  const product_recommendation: ProductRecommendationModuleV2 | undefined =
    modRaw.product_recommendation
      ? (() => {
          const pr = record(
            modRaw.product_recommendation,
            "Product recommendation module",
          );
          return {
            overview: string(pr.overview, "Recommendation overview"),
            recommendations: array(pr.recommendations, "Recommendations").map(
              (r) => {
                const rRec = record(r, "Recommendation item");
                return {
                  product_id: nonemptyString(rRec.product_id, "Product ID"),
                  product_name: nonemptyString(
                    rRec.product_name,
                    "Product name",
                  ),
                  brand_or_maker: string(rRec.brand_or_maker, "Brand or maker"),
                  category: string(rRec.category, "Category"),
                  description: string(rRec.description, "Description"),
                  use_case_fit: string(rRec.use_case_fit, "Use case fit"),
                  attributes: record(rRec.attributes, "Attributes") as Record<
                    string,
                    string | number | boolean
                  >,
                  functional_equivalency: member(
                    rRec.functional_equivalency,
                    [
                      "direct_drop_in",
                      "adaptive_substitute",
                      "partial_match",
                      "custom_formulation",
                    ],
                    "Functional equivalency",
                  ),
                  tradeoffs: array(rRec.tradeoffs, "Tradeoffs").map((t) =>
                    string(t, "Tradeoff"),
                  ),
                  claim_ids: array(rRec.claim_ids, "Claim IDs").map((id) =>
                    string(id, "Claim ID"),
                  ),
                  evidence_ids: array(rRec.evidence_ids, "Evidence IDs").map(
                    (id) => string(id, "Evidence ID"),
                  ),
                };
              },
            ),
            selection_criteria: array(
              pr.selection_criteria,
              "Selection criteria",
            ).map((s) => string(s, "Criterion")),
          };
        })()
      : undefined;

  const product_catalog: ProductCatalogModuleV2 | undefined =
    modRaw.product_catalog
      ? (() => {
          const pc = record(modRaw.product_catalog, "Product catalog module");
          return {
            catalog_id: nonemptyString(pc.catalog_id, "Catalog ID"),
            supplier_entity_id: string(
              pc.supplier_entity_id,
              "Supplier entity ID",
            ),
            supplier_name: string(pc.supplier_name, "Supplier name"),
            catalog_name: string(pc.catalog_name, "Catalog name"),
            as_of_date: string(pc.as_of_date, "As of date"),
            product_lines: array(pc.product_lines, "Product lines").map(
              (pl) => {
                const plRec = record(pl, "Product line");
                return {
                  line_id: nonemptyString(plRec.line_id, "Line ID"),
                  product_family: string(
                    plRec.product_family,
                    "Product family",
                  ),
                  sku_or_model: string(plRec.sku_or_model, "SKU or model"),
                  variant_name: string(plRec.variant_name, "Variant name"),
                  specifications: record(
                    plRec.specifications,
                    "Specifications",
                  ) as Record<string, string | number | boolean>,
                  certifications_held: array(
                    plRec.certifications_held,
                    "Certifications held",
                  ).map((c) => string(c, "Certification")),
                  ...(plRec.packaging
                    ? { packaging: string(plRec.packaging, "Packaging") }
                    : {}),
                  ...(plRec.moq ? { moq: string(plRec.moq, "MOQ") } : {}),
                  availability: member(
                    plRec.availability,
                    [
                      "in_production",
                      "made_to_order",
                      "discontinued",
                      "unknown",
                    ],
                    "Availability",
                  ),
                  ...(plRec.pricing_reference
                    ? {
                        pricing_reference: string(
                          plRec.pricing_reference,
                          "Pricing reference",
                        ),
                      }
                    : {}),
                  evidence_ids: array(
                    plRec.evidence_ids,
                    "Catalog evidence IDs",
                  ).map((id) => string(id, "Evidence ID")),
                };
              },
            ),
          };
        })()
      : undefined;

  const market_overview: MarketOverviewModuleV2 | undefined =
    modRaw.market_overview
      ? (() => {
          const mo = record(modRaw.market_overview, "Market overview module");
          return {
            market_scope: string(mo.market_scope, "Market scope"),
            as_of_date: string(mo.as_of_date, "As of date"),
            supply_concentration: member(
              mo.supply_concentration,
              [
                "highly_concentrated",
                "moderately_concentrated",
                "fragmented",
                "unknown",
              ],
              "Supply concentration",
            ),
            supply_structure_summary: string(
              mo.supply_structure_summary,
              "Supply structure summary",
            ),
            demand_signals: array(mo.demand_signals, "Demand signals").map(
              (d) => string(d, "Demand signal"),
            ),
            regulatory_context: array(
              mo.regulatory_context,
              "Regulatory context",
            ).map((r) => string(r, "Regulatory item")),
            trade_flows: array(mo.trade_flows, "Trade flows").map((tf) => {
              const tfRec = record(tf, "Trade flow");
              return {
                origin_country: string(tfRec.origin_country, "Origin country"),
                destination_country: string(
                  tfRec.destination_country,
                  "Destination country",
                ),
                volume_description: string(
                  tfRec.volume_description,
                  "Volume description",
                ),
                trend: member(
                  tfRec.trend,
                  ["growing", "stable", "declining", "unknown"],
                  "Trend",
                ),
              };
            }),
            key_risks: array(mo.key_risks, "Key risks").map((k) =>
              string(k, "Risk"),
            ),
            market_opportunities: array(
              mo.market_opportunities,
              "Market opportunities",
            ).map((o) => string(o, "Opportunity")),
            limitations: array(mo.limitations, "Market limitations").map((l) =>
              string(l, "Limitation"),
            ),
            evidence_ids: array(mo.evidence_ids, "Market evidence IDs").map(
              (id) => string(id, "Evidence ID"),
            ),
          };
        })()
      : undefined;

  const general_info: GeneralInfoModuleV2 | undefined = modRaw.general_info
    ? (() => {
        const gi = record(modRaw.general_info, "General info module");
        return {
          topic_title: string(gi.topic_title, "Topic title"),
          topic_summary: string(gi.topic_summary, "Topic summary"),
          key_definitions: array(gi.key_definitions, "Key definitions").map(
            (d) => {
              const dRec = record(d, "Key definition");
              return {
                term: string(dRec.term, "Term"),
                definition: string(dRec.definition, "Definition"),
              };
            },
          ),
          regulatory_standards: array(
            gi.regulatory_standards,
            "Regulatory standards",
          ).map((st) => {
            const stRec = record(st, "Regulatory standard");
            return {
              standard_code: string(stRec.standard_code, "Standard code"),
              title: string(stRec.title, "Standard title"),
              issuing_body: string(stRec.issuing_body, "Issuing body"),
              summary: string(stRec.summary, "Standard summary"),
            };
          }),
          procedural_guidance: array(
            gi.procedural_guidance,
            "Procedural guidance",
          ).map((g) => string(g, "Guidance step")),
          frequently_encountered_pitfalls: array(
            gi.frequently_encountered_pitfalls,
            "Pitfalls",
          ).map((p) => string(p, "Pitfall")),
          sources_consulted: array(
            gi.sources_consulted,
            "Sources consulted",
          ).map((s) => string(s, "Source")),
        };
      })()
    : undefined;

  const result_modules: ResultModulesV2 = {
    ...(sourcing ? { sourcing } : {}),
    ...(pricing ? { pricing } : {}),
    ...(product_recommendation ? { product_recommendation } : {}),
    ...(product_catalog ? { product_catalog } : {}),
    ...(market_overview ? { market_overview } : {}),
    ...(general_info ? { general_info } : {}),
  };

  // Validate supplier_candidates
  const candidateIds = new Set<string>();
  const supplier_candidates: SupplierCandidateV2[] = array(
    root.supplier_candidates,
    "Supplier candidates",
  ).map((c) => {
    const cRec = record(c, "Supplier candidate");
    const candidate_id = nonemptyString(cRec.candidate_id, "Candidate ID");
    if (candidateIds.has(candidate_id)) {
      throw new Error(`Duplicate candidate ID found: ${candidate_id}`);
    }
    candidateIds.add(candidate_id);

    const fit = record(
      cRec.fit_assessment,
      `Candidate ${candidate_id} fit assessment`,
    );
    const compatibility_score = number(
      fit.compatibility_score,
      "Compatibility score",
    );
    if (compatibility_score < 0 || compatibility_score > 100) {
      throw new Error("Compatibility score must be between 0 and 100.");
    }

    const fit_assessment: CandidateFitAssessmentV2 = {
      compatibility_score,
      fit_band: member(
        fit.fit_band,
        ["strong", "potential", "low"],
        "Fit band",
      ),
      evidence_confidence: member<ConfidenceLevelV2>(
        fit.evidence_confidence,
        ["high", "medium", "low"],
        "Evidence confidence",
      ),
      dimension_scores: record(
        fit.dimension_scores,
        "Dimension scores",
      ) as Record<string, number>,
      positive_drivers: array(fit.positive_drivers, "Positive drivers").map(
        (s) => string(s, "Positive driver"),
      ),
      limiting_gaps: array(fit.limiting_gaps, "Limiting gaps").map((s) =>
        string(s, "Limiting gap"),
      ),
      risk_flags: array(fit.risk_flags, "Risk flags").map((s) =>
        string(s, "Risk flag"),
      ),
      mandatory_constraint_results: array(
        fit.mandatory_constraint_results,
        "Constraint results",
      ).map((cr) => {
        const crRec = record(cr, "Constraint evaluation");
        return {
          constraint_name: string(crRec.constraint_name, "Constraint name"),
          outcome: member(
            crRec.outcome,
            ["pass", "fail", "unverifiable"],
            "Constraint outcome",
          ),
          rationale: string(crRec.rationale, "Constraint rationale"),
        };
      }),
      human_review_required: boolean(
        fit.human_review_required,
        "Human review required",
      ),
    };

    const moqRec = record(cRec.moq, "Candidate MOQ");
    const moq: StructuredQuantityV2 = {
      value: number(moqRec.value, "MOQ value"),
      unit: string(moqRec.unit, "MOQ unit"),
      ...(moqRec.description
        ? { description: string(moqRec.description, "MOQ description") }
        : {}),
    };

    const capRec = record(cRec.capacity, "Candidate capacity");
    const capacity: StructuredCapacityV2 = {
      annual_or_monthly: member(
        capRec.annual_or_monthly,
        ["annual", "monthly", "daily", "batch", "unspecified"],
        "Capacity timeframe",
      ),
      volume: number(capRec.volume, "Capacity volume"),
      unit: string(capRec.unit, "Capacity unit"),
      ...(capRec.description
        ? { description: string(capRec.description, "Capacity description") }
        : {}),
    };

    const compRec = record(cRec.compliance, "Candidate compliance");
    const compliance: CandidateComplianceV2 = {
      regulatory_clearance_status: member(
        compRec.regulatory_clearance_status,
        ["cleared", "pending", "restricted", "unknown"],
        "Regulatory clearance status",
      ),
      ...(compRec.sfda_approved !== undefined
        ? { sfda_approved: boolean(compRec.sfda_approved, "SFDA approved") }
        : {}),
      ...(compRec.halal_certified !== undefined
        ? {
            halal_certified: boolean(
              compRec.halal_certified,
              "Halal certified",
            ),
          }
        : {}),
      iso_certifications: array(
        compRec.iso_certifications,
        "ISO certifications",
      ).map((i) => string(i, "ISO certification")),
      ...(compRec.notes
        ? { notes: string(compRec.notes, "Compliance notes") }
        : {}),
    };

    const logRec = record(cRec.logistics, "Candidate logistics");
    const logistics: CandidateLogisticsV2 = {
      supported_incoterms: array(
        logRec.supported_incoterms,
        "Supported incoterms",
      ).map((i) => string(i, "Incoterm")),
      primary_shipping_ports: array(
        logRec.primary_shipping_ports,
        "Shipping ports",
      ).map((p) => string(p, "Shipping port")),
      ...(logRec.cold_chain_guaranteed !== undefined
        ? {
            cold_chain_guaranteed: boolean(
              logRec.cold_chain_guaranteed,
              "Cold chain guaranteed",
            ),
          }
        : {}),
      ...(logRec.typical_lead_time_days !== undefined
        ? {
            typical_lead_time_days: number(
              logRec.typical_lead_time_days,
              "Lead time days",
            ),
          }
        : {}),
    };

    let shelf_life: StructuredShelfLifeV2 | undefined;
    if (cRec.shelf_life) {
      const slRec = record(cRec.shelf_life, "Candidate shelf life");
      shelf_life = {
        duration_months: number(
          slRec.duration_months,
          "Shelf life duration months",
        ),
        ...(slRec.storage_temperature_celsius !== undefined
          ? {
              storage_temperature_celsius: number(
                slRec.storage_temperature_celsius,
                "Storage temp",
              ),
            }
          : {}),
        ...(slRec.storage_condition
          ? {
              storage_condition: string(
                slRec.storage_condition,
                "Storage condition",
              ),
            }
          : {}),
      };
    }

    return {
      candidate_id,
      entity_id: nonemptyString(cRec.entity_id, "Candidate entity ID"),
      legal_name: nonemptyString(cRec.legal_name, "Candidate legal name"),
      ...(cRec.trading_name
        ? { trading_name: string(cRec.trading_name, "Trading name") }
        : {}),
      brand_names: array(cRec.brand_names, "Brand names").map((b) =>
        string(b, "Brand name"),
      ),
      country_code: string(cRec.country_code, "Country code"),
      manufacturing_locations: array(
        cRec.manufacturing_locations,
        "Manufacturing locations",
      ).map((m) => string(m, "Location")),
      ...(cRec.website ? { website: string(cRec.website, "Website") } : {}),
      supplier_type: member<SupplierTypeV2>(
        cRec.supplier_type,
        [
          "manufacturer",
          "distributor",
          "trading_company",
          "cooperative",
          "service_provider",
          "unknown",
        ],
        "Supplier type",
      ),
      verification_status: member<VerificationStatusV2>(
        cRec.verification_status,
        [
          "externally_verified",
          "supplier_claimed",
          "inferred",
          "illustrative",
          "unknown",
        ],
        "Candidate verification status",
      ),
      verification_summary: string(
        cRec.verification_summary,
        "Verification summary",
      ),
      offerings: array(cRec.offerings, "Offerings").map((off) => {
        const offRec = record(off, "Offering");
        return {
          sku_or_name: string(offRec.sku_or_name, "Offering SKU or name"),
          description: string(offRec.description, "Offering description"),
          specifications: record(
            offRec.specifications,
            "Offering specifications",
          ) as Record<string, string | number | boolean>,
        };
      }),
      moq,
      capacity,
      certifications: array(cRec.certifications, "Certifications").map(
        (cert) => {
          const certRec = record(cert, "Certification");
          return {
            certification_name: string(
              certRec.certification_name,
              "Certification name",
            ),
            issuer: string(certRec.issuer, "Issuer"),
            ...(certRec.valid_until
              ? { valid_until: string(certRec.valid_until, "Valid until") }
              : {}),
            verification_state: member(
              certRec.verification_state,
              ["verified", "claimed", "expired", "unknown"],
              "Certification state",
            ),
            ...(certRec.evidence_id
              ? {
                  evidence_id: string(
                    certRec.evidence_id,
                    "Certification evidence ID",
                  ),
                }
              : {}),
          };
        },
      ),
      compliance,
      ...(shelf_life ? { shelf_life } : {}),
      logistics,
      fit_assessment,
      risks: array(cRec.risks, "Candidate risks").map((r) => string(r, "Risk")),
      required_validation: array(
        cRec.required_validation,
        "Required validation",
      ).map((v) => string(v, "Validation item")),
      claim_ids: array(cRec.claim_ids, "Candidate claim IDs").map((id) =>
        string(id, "Claim ID"),
      ),
      evidence_ids: array(cRec.evidence_ids, "Candidate evidence IDs").map(
        (id) => string(id, "Evidence ID"),
      ),
    };
  });

  // Validate claims
  const claimIds = new Set<string>();
  const claims: ResearchClaimV2[] = array(root.claims, "Claims").map((cl) => {
    const clRec = record(cl, "Research claim");
    const claim_id = nonemptyString(clRec.claim_id, "Claim ID");
    if (claimIds.has(claim_id)) {
      throw new Error(`Duplicate claim ID found: ${claim_id}`);
    }
    claimIds.add(claim_id);

    return {
      claim_id,
      claim_text: nonemptyString(clRec.claim_text, "Claim text"),
      claim_type: member(
        clRec.claim_type,
        [
          "capability",
          "compliance",
          "pricing",
          "capacity",
          "identity",
          "logistics",
          "general",
        ],
        "Claim type",
      ),
      subject_id: string(clRec.subject_id, "Subject ID"),
      confidence: member<ConfidenceLevelV2>(
        clRec.confidence,
        ["high", "medium", "low"],
        "Claim confidence",
      ),
      evidence_ids: array(clRec.evidence_ids, "Claim evidence IDs").map((id) =>
        string(id, "Evidence ID"),
      ),
      conflict_status: member<ConflictStatusV2>(
        clRec.conflict_status,
        ["corroborated", "single_source", "conflicting", "disputed"],
        "Conflict status",
      ),
    };
  });

  // Validate evidence
  const evidenceIds = new Set<string>();
  const evidence: ResearchEvidenceItemV2[] = array(
    root.evidence,
    "Evidence",
  ).map((ev) => {
    const evRec = record(ev, "Research evidence item");
    const evidence_id = nonemptyString(evRec.evidence_id, "Evidence ID");
    if (evidenceIds.has(evidence_id)) {
      throw new Error(`Duplicate evidence ID found: ${evidence_id}`);
    }
    evidenceIds.add(evidence_id);

    return {
      evidence_id,
      source_url: string(evRec.source_url, "Source URL"),
      source_title: nonemptyString(evRec.source_title, "Source title"),
      publisher: nonemptyString(evRec.publisher, "Publisher"),
      source_type: member(
        evRec.source_type,
        [
          "official_registry",
          "manufacturer_portal",
          "trade_directory",
          "industry_report",
          "regulatory_body",
          "synthetic_reference",
        ],
        "Source type",
      ),
      ...(evRec.published_at
        ? { published_at: string(evRec.published_at, "Published at") }
        : {}),
      retrieved_at: string(evRec.retrieved_at, "Retrieved at"),
      verification_status: member(
        evRec.verification_status,
        ["verified", "unverified", "illustrative"],
        "Evidence verification status",
      ),
      freshness_status: member<FreshnessStatusV2>(
        evRec.freshness_status,
        ["current", "aging", "historical", "unknown"],
        "Freshness status",
      ),
      supports_claim_ids: array(
        evRec.supports_claim_ids,
        "Supports claim IDs",
      ).map((id) => string(id, "Claim ID")),
      contradicts_claim_ids: array(
        evRec.contradicts_claim_ids,
        "Contradicts claim IDs",
      ).map((id) => string(id, "Claim ID")),
      excerpt_summary: string(evRec.excerpt_summary, "Excerpt summary"),
      ...(evRec.content_sha256
        ? { content_sha256: string(evRec.content_sha256, "Content SHA256") }
        : {}),
    };
  });

  // Validate unknowns, assumptions, limitations
  const unknowns: ResearchUnknownV2[] = array(root.unknowns, "Unknowns").map(
    (u) => {
      const uRec = record(u, "Research unknown");
      return {
        field_or_topic: string(uRec.field_or_topic, "Field or topic"),
        reason: string(uRec.reason, "Unknown reason"),
        impact: member(
          uRec.impact,
          ["blocking", "degrading", "informational"],
          "Unknown impact",
        ),
        recommended_validation: string(
          uRec.recommended_validation,
          "Recommended validation",
        ),
      };
    },
  );

  const assumptions: ResearchAssumptionV2[] = array(
    root.assumptions,
    "Assumptions",
  ).map((a) => {
    const aRec = record(a, "Research assumption");
    return {
      assumption_id: string(aRec.assumption_id, "Assumption ID"),
      description: string(aRec.description, "Assumption description"),
      rationale: string(aRec.rationale, "Assumption rationale"),
      sensitivity: member(
        aRec.sensitivity,
        ["high", "medium", "low"],
        "Assumption sensitivity",
      ),
    };
  });

  const limitations: ResearchLimitationV2[] = array(
    root.limitations,
    "Limitations",
  ).map((l) => {
    const lRec = record(l, "Research limitation");
    return {
      limitation_id: string(lRec.limitation_id, "Limitation ID"),
      title: string(lRec.title, "Limitation title"),
      description: string(lRec.description, "Limitation description"),
      scope: member(
        lRec.scope,
        [
          "search_coverage",
          "data_freshness",
          "legal_compliance",
          "commercial_commitment",
        ],
        "Limitation scope",
      ),
    };
  });

  // Validate decision_support
  const dsRaw = record(root.decision_support, "Decision support");
  const decision_support: DecisionSupportV2 = {
    advisory_notice: nonemptyString(dsRaw.advisory_notice, "Advisory notice"),
    recommended_actions: array(
      dsRaw.recommended_actions,
      "Recommended actions",
    ).map((s) => string(s, "Action")),
    questions_to_resolve: array(
      dsRaw.questions_to_resolve,
      "Questions to resolve",
    ).map((s) => string(s, "Question")),
    validation_priorities: array(
      dsRaw.validation_priorities,
      "Validation priorities",
    ).map((s) => string(s, "Priority")),
    ...(dsRaw.shortlist_guidance
      ? {
          shortlist_guidance: string(
            dsRaw.shortlist_guidance,
            "Shortlist guidance",
          ),
        }
      : {}),
    human_review_required: boolean(
      dsRaw.human_review_required,
      "Human review required",
    ),
  };

  return {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id,
    run_id,
    generated_at,
    research_mode,
    research_status,
    request_snapshot,
    executive_summary,
    result_modules,
    supplier_candidates,
    claims,
    evidence,
    unknowns,
    assumptions,
    limitations,
    decision_support,
  };
}

export function isConsultantResearchOutputV2(
  value: unknown,
): value is ConsultantResearchOutputV2 {
  try {
    parseConsultantResearchOutputV2(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Backward-compatibility adapter: maps a v1 ConsultantResultProjection into
 * the ConsultantResearchOutputV2 structure, ensuring historical runs remain viewable.
 */
export function adaptV1ToV2ConsultantOutput(
  v1: ConsultantResultProjectionV1,
): ConsultantResearchOutputV2 {
  const result_id = `ADAPT-${v1.run_id}`;
  const run_id = v1.run_id;
  const generated_at = new Date().toISOString();

  const evidenceMap = new Map<string, ResearchEvidenceItemV2>();
  for (const cand of v1.candidates) {
    for (const cit of cand.citations) {
      if (!evidenceMap.has(cit.evidence_id)) {
        evidenceMap.set(cit.evidence_id, {
          evidence_id: cit.evidence_id,
          source_url:
            "exact_url" in cit
              ? cit.exact_url
              : "https://matchbase.example.invalid",
          source_title: cit.title,
          publisher: cit.publisher,
          source_type: "synthetic_reference",
          retrieved_at: cit.accessed_at,
          verification_status:
            cit.status === "externally_verified" ? "verified" : "illustrative",
          freshness_status:
            cit.status === "externally_verified" ? "current" : "historical",
          supports_claim_ids: [],
          contradicts_claim_ids: [],
          excerpt_summary: cit.extract.slice(0, 280),
          content_sha256: cit.content_sha256,
        });
      }
    }
  }
  const evidence: ResearchEvidenceItemV2[] = Array.from(evidenceMap.values());

  const claims: ResearchClaimV2[] = [];
  const candidates: SupplierCandidateV2[] = v1.candidates.map((c, index) => {
    const candidate_id = `CAND-V1-${String(index + 1).padStart(2, "0")}`;
    const entity_id = `ENT-V1-${c.country_code}-${index + 1}`;

    for (const d of c.positive_drivers) {
      claims.push({
        claim_id: d.claim_id,
        claim_text: d.explanation,
        claim_type: "capability",
        subject_id: entity_id,
        confidence: "medium",
        evidence_ids: d.evidence_ids,
        conflict_status: "corroborated",
      });
    }
    for (const g of c.limiting_gaps) {
      claims.push({
        claim_id: g.claim_id,
        claim_text: g.explanation,
        claim_type: "capability",
        subject_id: entity_id,
        confidence: "medium",
        evidence_ids: g.evidence_ids,
        conflict_status: "corroborated",
      });
    }

    const fit_band: "strong" | "potential" | "low" =
      c.fit_band === "strong_fit"
        ? "strong"
        : c.fit_band === "potential_fit"
          ? "potential"
          : "low";

    const verification_status: VerificationStatusV2 =
      c.verification_status === "externally_verified"
        ? "externally_verified"
        : c.verification_status === "claimed"
          ? "supplier_claimed"
          : c.verification_status === "inferred"
            ? "inferred"
            : "unknown";

    const candClaimIds = [
      ...c.positive_drivers.map((d) => d.claim_id),
      ...c.limiting_gaps.map((g) => g.claim_id),
    ];

    return {
      candidate_id,
      entity_id,
      legal_name: c.display_name,
      trading_name: c.display_name,
      brand_names: [c.display_name],
      country_code: c.country_code,
      manufacturing_locations: [c.country_code],
      supplier_type: "manufacturer",
      verification_status,
      verification_summary: "Legacy v1 projection candidate",
      offerings: [
        {
          sku_or_name: "Primary Sourced Item",
          description: c.rationale_extended,
          specifications: {},
        },
      ],
      moq: { value: 1, unit: "PCE", description: "Legacy unstated MOQ" },
      capacity: { annual_or_monthly: "unspecified", volume: 0, unit: "PCE" },
      certifications: [],
      compliance: {
        regulatory_clearance_status: "unknown",
        iso_certifications: [],
      },
      logistics: {
        supported_incoterms: ["FOB"],
        primary_shipping_ports: [],
      },
      fit_assessment: {
        compatibility_score: c.compatibility_score,
        fit_band,
        evidence_confidence: c.evidence_confidence,
        dimension_scores: Object.fromEntries(
          c.dimension_scores.map((d) => [d.dimension_id, d.score]),
        ),
        positive_drivers: c.positive_drivers.map((d) => d.explanation),
        limiting_gaps: c.limiting_gaps.map((g) => g.explanation),
        risk_flags: [],
        mandatory_constraint_results: [],
        human_review_required: true,
      },
      risks: [],
      required_validation: [
        "Verify legal registry and compliance independently.",
      ],
      claim_ids: candClaimIds,
      evidence_ids: c.citations.map((cit) => cit.evidence_id),
    };
  });

  const sourcingModule: SourcingModuleV2 = {
    market_landscape_summary: `Evaluated ${v1.landscape.eligible_count} eligible candidates from historical run.`,
    evaluated_supplier_count: v1.landscape.eligible_count,
    qualified_supplier_count: v1.candidates.length,
    shortlisted_candidate_ids: candidates.map((c) => c.candidate_id),
    key_bottlenecks: [],
    recommendations_summary:
      "Adapted from historical v1 Consultant result projection.",
  };

  const limitations: ResearchLimitationV2[] = [
    {
      limitation_id: "LIM-V1-01",
      title: "Advisory Boundary",
      description: v1.limitations.advisory_boundary,
      scope: "commercial_commitment",
    },
    {
      limitation_id: "LIM-V1-02",
      title: "Restricted Party Screening",
      description: v1.limitations.restricted_party_screening_notice,
      scope: "legal_compliance",
    },
  ];
  if (v1.limitations.cap_notice) {
    limitations.push({
      limitation_id: "LIM-V1-03",
      title: "Candidate Cap Notice",
      description: v1.limitations.cap_notice,
      scope: "search_coverage",
    });
  }

  return {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id,
    run_id,
    generated_at,
    research_mode: "fixture",
    research_status: v1.outcome === "matched" ? "complete" : "no_strong_match",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "global",
      business_context: ["Historical run projection"],
      product_category: "General Commodity",
      product_name: "Historical Sourcing Query",
      confidence_level_required: "medium",
      compliance_sensitive: false,
      pricing_volatile: false,
      product_attributes: {},
      normalized_requirements: [],
      mandatory_constraints: [],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline: `Historical MatchBASE Sourcing Result: ${v1.candidates.length} Candidate(s)`,
      direct_answer:
        v1.outcome === "matched"
          ? `Identified ${v1.candidates.length} qualified candidate(s) from historical analysis.`
          : "No responsible match was identified in historical run.",
      key_findings: [
        `Historical landscape: ${v1.landscape.eligible_count} candidates evaluated.`,
      ],
      candidate_count: v1.candidates.length,
      confidence_assessment: "medium",
      primary_limitation: v1.consultant_source_readiness.notice,
    },
    result_modules: {
      sourcing: sourcingModule,
    },
    supplier_candidates: candidates,
    claims,
    evidence,
    unknowns: [
      {
        field_or_topic: "modular_query_types",
        reason:
          "Legacy v1 projection did not capture discrete pricing or catalog modules.",
        impact: "informational",
        recommended_validation:
          "Rerun query using Consultant research v2 pipeline.",
      },
    ],
    assumptions: [],
    limitations,
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. This historical result is an advisory assessment.",
      recommended_actions: [
        "Review candidate profiles with procurement team.",
        "Initiate direct contact for quotation and audit.",
      ],
      questions_to_resolve: ["Validate current supplier production schedule."],
      validation_priorities: [
        "Certificate authenticity and current valid dates.",
      ],
      human_review_required: true,
    },
  };
}
