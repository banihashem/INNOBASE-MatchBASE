import type {
  ConfidenceLevelV2,
  ConflictStatusV2,
  FreshnessStatusV2,
  RequestSnapshotV2,
  ResearchModeV2,
  ResearchStatusV2,
  SupplierTypeV2,
  VerificationStatusV2,
} from "../v2/consultant-research-output.js";
import type { ApprovedRequestSnapshotV3 } from "./approved-request.js";
import type { ResearchReview } from "./research-review.js";
import { validateResearchReview } from "./research-review.js";
import { verifyApprovedRequestSnapshotV3 } from "./approved-request.js";
import { contractSha256Hex } from "../sha256.js";
import {
  evaluateSearchDimensionPlan,
  verifySearchDimensionPlan,
  type SearchDimensionAssessment,
  type SearchDimensionObservation,
  type SearchDimensionPlan,
} from "./search-dimensions.js";

export const CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION =
  "consultant-research-output.v3" as const;
export const CONSULTANT_RESEARCH_OUTPUT_V3_VERSION = 1 as const;

export type ClassificationScheme =
  | "HS"
  | "CPC"
  | "ISIC"
  | "GS1_GPC"
  | "UNSPSC"
  | "ECLASS"
  | "ETIM"
  | "CUSTOM_MATCHBASE";

export interface ProductClassificationRecord {
  readonly classification_id: string; // UUID
  readonly scheme: ClassificationScheme;
  readonly code: string;
  readonly version: string;
  readonly jurisdiction?: string;
  readonly level: string;
  readonly label: string;
  readonly description: string;
  readonly is_primary: boolean;
  readonly confidence: ConfidenceLevelV2;
  readonly source_url?: string;
  readonly assigned_at: string;
}

export interface FourIdTrace {
  readonly user_profile_id: string; // UUID
  readonly research_run_id: string; // UUID
  readonly execution_id: string; // UUID
  readonly classification_id: string; // UUID
}

export interface VerifiedPublicContact {
  readonly contact_page_url?: string;
  readonly sales_email?: string;
  readonly export_email?: string;
  readonly general_email?: string;
  readonly phone?: string;
  readonly whatsapp_business?: string;
  readonly linkedin_company_url?: string;
  readonly other_official_social_urls?: readonly string[];
  readonly verification_status:
    "verified" | "claimed" | "unverified" | "illustrative" | "not_applicable";
  readonly verified_at?: string;
  readonly contact_evidence_ids: readonly string[];
}

export interface DigitalAssetCoverage {
  readonly asset_class: string;
  readonly url?: string;
  readonly status: "inspected" | "not_found" | "restricted";
  readonly retrieved_at?: string;
}

export interface SupplierOfferingV3 {
  readonly product_name: string;
  readonly product_family: string;
  readonly brand?: string;
  readonly model_or_sku?: string;
  readonly description?: string;
  readonly specifications: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  readonly grade_or_quality?: string;
  readonly use_cases: readonly string[];
  readonly country_of_origin: string;
  readonly manufacturing_site?: string;
  readonly customization_support?: boolean;
  readonly private_label?: boolean;
  readonly oem?: boolean;
  readonly sample_availability?: "available" | "on_request" | "unavailable";
  readonly product_evidence_ids: readonly string[];
}

export interface CommercialDataV3 {
  readonly price_min?: number;
  readonly price_max?: number;
  readonly currency?: string;
  readonly unit?: string;
  readonly price_type?: string;
  readonly incoterm?: string;
  readonly incoterm_location?: string;
  readonly moq?: string;
  readonly production_capacity?: string;
  readonly lead_time?: string;
  readonly payment_terms?: string;
  readonly quotation_required?: boolean;
  readonly commercial_confidence: ConfidenceLevelV2;
  /** Explicit source publication/update date for the price, never retrieval or expiry. */
  readonly price_date?: string;
  readonly price_validity?: string;
  readonly commercial_evidence_ids: readonly string[];
}

export interface PackagingAndLogisticsV3 {
  readonly packaging_type?: string;
  readonly pack_size?: string;
  readonly net_weight?: string;
  readonly gross_weight?: string;
  readonly carton_dimensions?: string;
  readonly palletization?: string;
  readonly container_loading?: string;
  readonly storage_conditions?: string;
  readonly temperature_requirements?: string;
  readonly shelf_life?: string;
  readonly remaining_shelf_life_on_arrival?: string;
  readonly origin_port?: string;
  readonly destination_fit?: string;
  readonly shipping_modes?: readonly string[];
  readonly logistics_notes?: string;
  readonly logistics_evidence_ids: readonly string[];
}

export interface CertificationItemV3 {
  readonly certification_name: string;
  readonly issuer?: string | null;
  readonly certificate_number?: string | null;
  readonly scope?: string;
  readonly status: "active" | "conditional" | "expired" | "unknown";
  readonly valid_from?: string;
  readonly valid_until?: string;
  readonly verification_status:
    "verified" | "claimed" | "unverified" | "illustrative" | "not_applicable";
  readonly destination_market_relevance?: string;
  readonly evidence_ids: readonly string[];
}

export interface DimensionScoresV3 {
  readonly category_product_fit: number; // 0-100, weight 25%
  readonly compliance_certification_fit: number; // 0-100, weight 20%
  readonly volume_capacity_fit: number; // 0-100, weight 15%
  readonly price_tier_fit: number; // 0-100, weight 15%
  readonly positioning_brand_fit: number; // 0-100, weight 15%
  readonly geographic_reach_fit: number; // 0-100, weight 10%
}

export interface MatchAssessmentV3 {
  readonly rank: number;
  readonly compatibility_score: number; // 0-100
  readonly fit_band: "Strong Fit" | "Potential Fit" | "Low Fit";
  readonly evidence_confidence: ConfidenceLevelV2;
  readonly identity_confidence: ConfidenceLevelV2;
  readonly data_completeness: number; // 0-100
  readonly dimension_scores: DimensionScoresV3;
  readonly mandatory_constraint_results: readonly {
    readonly constraint: string;
    readonly satisfied: boolean;
    readonly evidence_ids: readonly string[];
  }[];
  readonly positive_drivers: readonly string[];
  readonly limiting_gaps: readonly string[];
  readonly risk_flags: readonly string[];
  readonly unknowns: readonly string[];
  readonly required_validation: readonly string[];
  readonly recommended_next_action: string;
}

export interface SupplierEntityV3 {
  readonly supplier_entity_id: string; // UUID
  readonly candidate_id: string; // e.g. "cand-01"
  readonly legal_name: string;
  readonly trading_name?: string;
  readonly brand_names: readonly string[];
  readonly aliases: readonly string[];
  readonly parent_entity_id?: string;
  readonly subsidiary_relationship?: string;
  readonly entity_basis?: "synthetic_fixture" | "live_verified";
  readonly verification_status?: VerificationStatusV2;
  readonly evidence_basis?: "illustrative_fixture" | "live_evidence";
  readonly fixture_entity_id?: string;
  readonly supplier_type: SupplierTypeV2;
  readonly manufacturer_status:
    | "direct_manufacturer"
    | "oem_manufacturer"
    | "trader_distributor"
    | "unknown";
  readonly country_of_registration: string;
  readonly headquarters_address: string;
  readonly manufacturing_locations: readonly string[];
  readonly registry_identifiers?: Readonly<Record<string, string>>;
  readonly website: string | null;
  readonly primary_domain: string | null;
  readonly identity_confidence: ConfidenceLevelV2;
  readonly identity_evidence_ids: readonly string[];
  readonly contacts?: VerifiedPublicContact | null;
  readonly digital_assets: readonly DigitalAssetCoverage[];
  readonly offering: SupplierOfferingV3;
  readonly commercial: CommercialDataV3;
  readonly packaging_and_logistics?: PackagingAndLogisticsV3;
  readonly certifications: readonly CertificationItemV3[];
  readonly assessment: MatchAssessmentV3;
}

export interface ClaimV3 {
  readonly claim_id: string;
  readonly supplier_entity_id?: string;
  readonly claim_type:
    | "identity"
    | "product_spec"
    | "compliance"
    | "pricing"
    | "volume"
    | "logistics"
    | "market";
  readonly field_path?: string;
  readonly claim_text: string;
  readonly normalized_value?: string | number | boolean;
  readonly unit?: string;
  readonly status: VerificationStatusV2;
  readonly confidence: ConfidenceLevelV2;
  readonly conflict_status: ConflictStatusV2;
  readonly evidence_ids: readonly string[];
}

export interface EvidenceSourceV3 {
  readonly evidence_id: string;
  readonly source_id: string;
  readonly source_url: string;
  readonly source_title: string;
  readonly publisher: string;
  readonly source_type:
    | "official_website"
    | "official_registry"
    | "government_trade_portal"
    | "catalog_pdf"
    | "trade_directory"
    | "press_release"
    | "secondary_market"
    | "synthetic_fixture";
  readonly retrieved_at: string;
  readonly published_at?: string;
  readonly language?: string;
  readonly freshness_status: FreshnessStatusV2;
  readonly verification_status: VerificationStatusV2;
  readonly excerpt_summary: string;
  readonly supports_claim_ids: readonly string[];
  readonly contradicts_claim_ids: readonly string[];
}

export interface ExecutionTelemetryV3 {
  readonly lanes_executed: readonly string[];
  readonly verification_loops_count: number; // Legacy verification loops or completed approved research round number.
  readonly total_input_tokens: number;
  readonly total_output_tokens: number;
  readonly total_cost_usd: number;
  readonly execution_latency_ms: number;
  readonly synthesis_model_id: string;
  readonly executed_at: string;
}

export interface ReportArtifactLinkV3 {
  readonly artifact_id: string;
  readonly artifact_type: "pdf_landscape_report" | "structured_json";
  readonly filename: string;
  readonly download_url: string;
  readonly sha256: string;
  readonly generated_at: string;
  readonly file_size_bytes?: number;
}

export interface AdvancedSearchQueryFilters {
  readonly min_compatibility_score?: number;
  readonly required_certifications?: readonly string[];
  readonly max_target_price?: number;
  readonly excluded_countries?: readonly string[];
  readonly direct_manufacturers_only?: boolean;
}

export interface PublicSocialCheckV3 {
  readonly supplier_name: string;
  readonly profile_url: string | null;
  readonly status: "reviewed" | "access_limited" | "not_executed";
  readonly ownership_basis: string;
  readonly checked_at: string;
  readonly limitation: string;
}
/** Public price observations remain separate from supplier-specific quotations. */
export interface ResearchPriceObservationV3 {
  readonly observation_id: string;
  readonly provenance: "supplier_listing" | "market_benchmark";
  readonly supplier_name: string | null;
  readonly source_url: string;
  readonly source_title: string;
  readonly quote: string;
  readonly date_quote: string;
  readonly price_min: number;
  readonly price_max: number;
  readonly currency: string;
  readonly unit: string | null;
  readonly product_or_service: string;
  readonly route_or_market: string | null;
  readonly quantity_basis: string | null;
  readonly incoterm: string | null;
  readonly source_published_at: string;
  readonly source_date_text: string;
  readonly valid_until: string | null;
  readonly date_basis: "published" | "price_effective";
  readonly age_days: number;
  readonly recency: "under_7_days" | "under_30_days";
  readonly relevance_note: string;
}
export interface ResearchPriceSearchV3 {
  readonly searched_at: string;
  readonly status: "prices_found" | "no_recent_prices" | "incomplete";
  readonly searched_windows_days: readonly number[];
  readonly observations: readonly ResearchPriceObservationV3[];
  readonly limitations: readonly string[];
}
export interface ConsultantResearchOutputV3 extends FourIdTrace {
  readonly search_dimension_plan?: SearchDimensionPlan;
  readonly search_dimension_assessments?: readonly SearchDimensionAssessment[];
  readonly search_dimension_observations?: readonly SearchDimensionObservation[];
  readonly research_review?: ResearchReview;
  readonly price_research?: ResearchPriceSearchV3;
  readonly public_social_checks?: readonly PublicSocialCheckV3[];
  readonly approved_request_snapshot?: ApprovedRequestSnapshotV3;
  readonly schema_version: typeof CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION;
  readonly schema_contract_version: typeof CONSULTANT_RESEARCH_OUTPUT_V3_VERSION;
  readonly title: string;
  readonly subtitle?: string;
  readonly generated_at: string;
  readonly as_of_date: string;
  readonly research_mode: ResearchModeV2;
  readonly research_status: ResearchStatusV2;
  readonly primary_classification: ProductClassificationRecord;
  readonly secondary_classifications: readonly ProductClassificationRecord[];
  readonly request_snapshot: RequestSnapshotV2;
  readonly executive_summary: {
    readonly headline: string;
    readonly direct_answer: string;
    readonly key_findings: readonly string[];
    readonly candidate_count: number;
    readonly confidence_assessment: ConfidenceLevelV2;
    readonly primary_limitation?: string;
    readonly no_match_summary?: string;
    readonly research_coverage_status?:
      "sufficient" | "partial" | "insufficient" | "not_assessed";
  };
  readonly target_candidates_count: 20;
  readonly total_candidates_found: number;
  readonly supplier_candidates: readonly SupplierEntityV3[];
  readonly claims: readonly ClaimV3[];
  readonly evidence_sources: readonly EvidenceSourceV3[];
  readonly telemetry: ExecutionTelemetryV3;
  readonly report_artifact?: ReportArtifactLinkV3;
  readonly limitations_and_disclosures: readonly {
    readonly title: string;
    readonly description: string;
    readonly severity: "info" | "advisory" | "critical";
  }[];
}

export function parseConsultantResearchOutputV3(
  value: unknown,
): ConsultantResearchOutputV3 {
  let normalized: unknown;
  try {
    normalized =
      typeof value === "string"
        ? JSON.parse(value)
        : JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("Consultant research output v3 is not serializable.");
  }

  if (!normalized || typeof normalized !== "object") {
    throw new Error("Consultant research output v3 must be an object.");
  }

  const root = normalized as Record<string, unknown>;

  if (root.schema_version !== CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION) {
    throw new Error(
      `Consultant research output v3 schema version must be "${CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION}".`,
    );
  }

  if (!root.research_run_id || typeof root.research_run_id !== "string") {
    throw new Error(
      "Consultant research output v3 requires a valid research_run_id.",
    );
  }

  if (!root.user_profile_id || typeof root.user_profile_id !== "string") {
    throw new Error(
      "Consultant research output v3 requires a valid user_profile_id.",
    );
  }

  if (!root.execution_id || typeof root.execution_id !== "string") {
    throw new Error(
      "Consultant research output v3 requires a valid execution_id.",
    );
  }

  if (!root.classification_id || typeof root.classification_id !== "string") {
    throw new Error(
      "Consultant research output v3 requires a valid classification_id.",
    );
  }

  if (!Array.isArray(root.supplier_candidates)) {
    throw new Error(
      "Consultant research output v3 requires a supplier_candidates array.",
    );
  }

  const object = (v: unknown, path: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new Error(`${path} must be an object.`);
    return v as Record<string, unknown>;
  };
  const string = (v: unknown, path: string): void => {
    if (typeof v !== "string" || !v.trim())
      throw new Error(`${path} must be non-empty text.`);
  };
  const array = (v: unknown, path: string): unknown[] => {
    if (!Array.isArray(v)) throw new Error(`${path} must be an array.`);
    return v;
  };
  const strings = (v: unknown, path: string): void => {
    array(v, path).forEach((item) => string(item, path));
  };
  const score = (v: unknown, path: string): void => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
      throw new Error(`${path} must be a finite score between 0 and 100.`);
  };
  if (root.price_research !== undefined) {
    const pricing = object(root.price_research, "price_research");
    string(pricing.searched_at, "price_research.searched_at");
    const asOf = Date.parse(String(pricing.searched_at));
    if (!Number.isFinite(asOf)) throw new Error("Invalid price search date.");
    if (
      !["prices_found", "no_recent_prices", "incomplete"].includes(
        String(pricing.status),
      )
    )
      throw new Error("Invalid price search status.");
    const windows = array(
      pricing.searched_windows_days,
      "price_research.searched_windows_days",
    );
    if (
      windows.length > 2 ||
      windows.some((value, index) => value !== (index === 0 ? 7 : 30))
    )
      throw new Error("Invalid price search window sequence.");
    strings(pricing.limitations, "price_research.limitations");
    const observations = array(
      pricing.observations,
      "price_research.observations",
    );
    if (
      observations.length > 20 ||
      (pricing.status === "prices_found" && observations.length === 0) ||
      (pricing.status === "no_recent_prices" && observations.length > 0)
    )
      throw new Error("Price search status conflicts with its observations.");
    const ids = new Set<string>();
    for (const value of observations) {
      const price = object(value, "price observation");
      for (const key of [
        "observation_id",
        "source_url",
        "source_title",
        "quote",
        "date_quote",
        "currency",
        "product_or_service",
        "source_published_at",
        "source_date_text",
        "relevance_note",
      ])
        string(price[key], `price.${key}`);
      if (ids.has(String(price.observation_id)))
        throw new Error("Duplicate price observation.");
      ids.add(String(price.observation_id));
      if (!/^https?:\/\//i.test(String(price.source_url)))
        throw new Error("Price source requires HTTP(S).");
      for (const key of [
        "supplier_name",
        "quantity_basis",
        "unit",
        "route_or_market",
        "incoterm",
        "valid_until",
      ])
        if (price[key] !== null) string(price[key], `price.${key}`);
      if (
        !["supplier_listing", "market_benchmark"].includes(
          String(price.provenance),
        ) ||
        (price.provenance === "supplier_listing" && !price.supplier_name) ||
        (price.provenance === "market_benchmark" &&
          price.supplier_name !== null)
      )
        throw new Error("Invalid price attribution.");
      if (!["published", "price_effective"].includes(String(price.date_basis)))
        throw new Error("Invalid price date basis.");
      for (const key of ["price_min", "price_max", "age_days"])
        if (
          typeof price[key] !== "number" ||
          !Number.isFinite(price[key]) ||
          Number(price[key]) < 0
        )
          throw new Error(`Invalid price.${key}.`);
      if (Number(price.price_min) > Number(price.price_max))
        throw new Error("Reversed price bounds.");
      const published = Date.parse(String(price.source_published_at));
      const literalDate = String(price.source_date_text);
      const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(literalDate)
        ? Date.parse(`${literalDate}T00:00:00.000Z`)
        : /^(?:\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})$/.test(
              literalDate,
            )
          ? Date.parse(`${literalDate} UTC`)
          : NaN;
      if (!Number.isFinite(sourceDate) || sourceDate !== published)
        throw new Error(
          "Price source date differs from its literal date evidence.",
        );
      const age = (asOf - published) / 86400000;
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        age >= 30 ||
        Math.abs(age - Number(price.age_days)) > 0.000001 ||
        price.recency !== (age < 7 ? "under_7_days" : "under_30_days")
      )
        throw new Error("Invalid price freshness.");
      if (
        price.valid_until !== null &&
        (!Number.isFinite(Date.parse(String(price.valid_until))) ||
          Date.parse(String(price.valid_until)) < asOf)
      )
        throw new Error("Price validity has expired or is invalid.");
      if (
        !String(price.date_quote)
          .normalize("NFKC")
          .replace(/\s+/g, " ")
          .includes(
            String(price.source_date_text)
              .normalize("NFKC")
              .replace(/\s+/g, " "),
          )
      )
        throw new Error("Price date is not supported by its date quotation.");
    }
  }
  for (const key of ["title", "generated_at", "as_of_date", "research_status"])
    string(root[key], key);
  if (!["live", "hybrid", "fixture"].includes(String(root.research_mode)))
    throw new Error("Unsupported research mode.");
  object(root.request_snapshot, "request_snapshot");
  const summary = object(root.executive_summary, "executive_summary");
  strings(summary.key_findings, "executive_summary.key_findings");
  const classification = object(
    root.primary_classification,
    "primary_classification",
  );
  string(classification.code, "primary_classification.code");
  string(
    classification.classification_id,
    "primary_classification.classification_id",
  );
  array(root.secondary_classifications, "secondary_classifications");
  if (
    root.approved_request_snapshot !== undefined &&
    !verifyApprovedRequestSnapshotV3(root.approved_request_snapshot)
  )
    throw new Error("Approved request snapshot hash or structure is invalid.");
  if (root.research_mode === "live" && !root.approved_request_snapshot)
    throw new Error(
      "Live output requires a trustworthy approved request snapshot.",
    );
  if (
    root.target_candidates_count !== 20 ||
    root.total_candidates_found !== root.supplier_candidates.length ||
    summary.candidate_count !== root.supplier_candidates.length
  )
    throw new Error(
      "Candidate counts disagree with the actual supplier population.",
    );
  const seen = new Set<string>();
  for (const raw of root.supplier_candidates) {
    const supplier = object(raw, "supplier");
    for (const key of [
      "supplier_entity_id",
      "candidate_id",
      "legal_name",
      "country_of_registration",
      "supplier_type",
      "manufacturer_status",
    ])
      string(supplier[key], `supplier.${key}`);
    for (const key of ["supplier_entity_id", "candidate_id"]) {
      const id = `${key}:${supplier[key]}`;
      if (seen.has(id)) throw new Error(`Duplicate supplier identity: ${id}`);
      seen.add(id);
    }
    for (const key of [
      "brand_names",
      "aliases",
      "manufacturing_locations",
      "identity_evidence_ids",
    ])
      strings(supplier[key], `supplier.${key}`);
    array(supplier.digital_assets, "supplier.digital_assets");
    const offering = object(supplier.offering, "supplier.offering");
    for (const key of ["product_name", "product_family", "country_of_origin"])
      string(offering[key], `offering.${key}`);
    object(offering.specifications, "offering.specifications");
    strings(offering.use_cases, "offering.use_cases");
    strings(offering.product_evidence_ids, "offering.product_evidence_ids");
    const commercial = object(supplier.commercial, "supplier.commercial");
    if (commercial.price_date !== undefined)
      string(commercial.price_date, "commercial.price_date");
    strings(
      commercial.commercial_evidence_ids,
      "commercial.commercial_evidence_ids",
    );
    for (const field of ["price_min", "price_max"])
      if (
        commercial[field] !== undefined &&
        (typeof commercial[field] !== "number" ||
          !Number.isFinite(commercial[field]) ||
          commercial[field] < 0)
      )
        throw new Error(`Invalid ${field}.`);
    if (
      typeof commercial.price_min === "number" &&
      typeof commercial.price_max === "number" &&
      commercial.price_min > commercial.price_max
    )
      throw new Error("Price lower bound exceeds its upper bound.");
    if (supplier.contacts)
      strings(
        object(supplier.contacts, "contacts").contact_evidence_ids,
        "contacts.contact_evidence_ids",
      );
    if (supplier.packaging_and_logistics)
      strings(
        object(supplier.packaging_and_logistics, "logistics")
          .logistics_evidence_ids,
        "logistics.logistics_evidence_ids",
      );
    array(supplier.certifications, "supplier.certifications").forEach((cert) =>
      strings(
        object(cert, "certification").evidence_ids,
        "certification.evidence_ids",
      ),
    );
    const assessment = object(supplier.assessment, "supplier.assessment");
    for (const field of ["compatibility_score", "data_completeness"])
      score(assessment[field], `assessment.${field}`);
    const dimensions = object(
      assessment.dimension_scores,
      "assessment.dimension_scores",
    );
    for (const key of [
      "category_product_fit",
      "compliance_certification_fit",
      "volume_capacity_fit",
      "price_tier_fit",
      "positioning_brand_fit",
      "geographic_reach_fit",
    ])
      score(dimensions[key], `dimension.${key}`);
    for (const key of [
      "positive_drivers",
      "limiting_gaps",
      "risk_flags",
      "unknowns",
      "required_validation",
    ])
      strings(assessment[key], `assessment.${key}`);
    array(
      assessment.mandatory_constraint_results,
      "mandatory_constraint_results",
    ).forEach((rawResult) => {
      const result = object(rawResult, "constraint");
      if (typeof result.satisfied !== "boolean")
        throw new Error("Constraint satisfaction must be boolean.");
      strings(result.evidence_ids, "constraint.evidence_ids");
    });
    if (
      root.research_mode === "live" &&
      (supplier.entity_basis === "synthetic_fixture" ||
        supplier.evidence_basis === "illustrative_fixture" ||
        supplier.fixture_entity_id)
    )
      throw new Error("Live output contains a synthetic fixture supplier.");
  }
  for (const claim of array(root.claims, "claims")) {
    const c = object(claim, "claim");
    string(c.claim_id, "claim.claim_id");
    string(c.claim_text, "claim.claim_text");
    strings(c.evidence_ids, "claim.evidence_ids");
  }
  for (const source of array(root.evidence_sources, "evidence_sources")) {
    const e = object(source, "evidence");
    string(e.evidence_id, "evidence.evidence_id");
    strings(e.supports_claim_ids, "evidence.supports_claim_ids");
    strings(e.contradicts_claim_ids, "evidence.contradicts_claim_ids");
    if (
      root.research_mode === "live" &&
      (e.source_type === "synthetic_fixture" ||
        !/^https?:\/\//i.test(String(e.source_url)))
    )
      throw new Error("Live evidence requires an actual HTTP(S) source URL.");
  }
  const telemetry = object(root.telemetry, "telemetry");
  for (const key of [
    "total_input_tokens",
    "total_output_tokens",
    "total_cost_usd",
    "execution_latency_ms",
    "verification_loops_count",
  ])
    if (
      typeof telemetry[key] !== "number" ||
      !Number.isFinite(telemetry[key]) ||
      telemetry[key] < 0
    )
      throw new Error(`Invalid telemetry.${key}.`);
  array(root.limitations_and_disclosures, "limitations_and_disclosures");
  if (root.research_review !== undefined)
    validateResearchReview(root.research_review);

  if (
    [
      root.search_dimension_plan,
      root.search_dimension_assessments,
      root.search_dimension_observations,
    ].some((entry) => entry !== undefined)
  ) {
    if (!verifySearchDimensionPlan(root.search_dimension_plan))
      throw new Error("Invalid pinned search dimension output plan.");
    const expected = projectSearchDimensionOutput(
      root.search_dimension_plan,
      root as unknown as ConsultantResearchOutputV3,
    );
    if (
      dimensionCanonical(root.search_dimension_assessments) !==
        dimensionCanonical(expected.search_dimension_assessments) ||
      dimensionCanonical(root.search_dimension_observations) !==
        dimensionCanonical(expected.search_dimension_observations)
    )
      throw new Error(
        "Search dimension output differs from admitted source evidence or pinned assessment lineage.",
      );
  }

  return root as unknown as ConsultantResearchOutputV3;
}

export interface SearchDimensionOutputFields {
  search_dimension_plan: SearchDimensionPlan;
  search_dimension_assessments: SearchDimensionAssessment[];
  search_dimension_observations: SearchDimensionObservation[];
}

function dimensionCanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(dimensionCanonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${dimensionCanonical(entry)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const dimensionLiteral = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
function sourceHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * MB-SEARCH-DIMENSIONS-002 L01: a deterministic admission adapter shared by publication
 * and parsing. Canonical paths are research clues, not exhaustive capability sets.
 * Arbitrary search_dimensions.* or specifications.* labels cannot prove predicates.
 */
export function projectSearchDimensionOutput(
  plan: SearchDimensionPlan,
  output: ConsultantResearchOutputV3,
): SearchDimensionOutputFields {
  if (
    !verifySearchDimensionPlan(plan) ||
    plan.owner_scope.user_profile_id !== output.user_profile_id ||
    plan.primary_classification_id !== output.classification_id ||
    output.primary_classification.classification_id !== output.classification_id
  )
    throw new Error(
      "Search dimension output owner or primary classification mismatch.",
    );
  const now = Date.parse(output.generated_at);
  if (!Number.isFinite(now))
    throw new Error("Invalid search dimension output time.");
  if (
    new Set(output.claims.map((claim) => claim.claim_id)).size !==
      output.claims.length ||
    new Set(output.evidence_sources.map((source) => source.evidence_id))
      .size !== output.evidence_sources.length
  )
    throw new Error("Ambiguous search dimension claim or source identity.");
  const trace: FourIdTrace = {
    user_profile_id: output.user_profile_id,
    research_run_id: output.research_run_id,
    execution_id: output.execution_id,
    classification_id: output.classification_id,
  };
  const sources = new Map(
    output.evidence_sources.map((source) => [source.evidence_id, source]),
  );
  const observations: SearchDimensionObservation[] = [];
  const admittedSource = (claim: ClaimV3, source: EvidenceSourceV3): boolean =>
    claim.status === "externally_verified" &&
    ["corroborated", "single_source"].includes(claim.conflict_status) &&
    source.source_type !== "synthetic_fixture" &&
    source.freshness_status === "current" &&
    ["externally_verified", "supplier_claimed"].includes(
      source.verification_status,
    ) &&
    source.supports_claim_ids.includes(claim.claim_id) &&
    !source.contradicts_claim_ids.includes(claim.claim_id) &&
    sourceHttpUrl(source.source_url) &&
    Boolean(source.source_id) &&
    Number.isFinite(Date.parse(source.retrieved_at)) &&
    Date.parse(source.retrieved_at) <= now &&
    (!source.published_at ||
      (Number.isFinite(Date.parse(source.published_at)) &&
        Date.parse(source.published_at) <= now)) &&
    typeof source.excerpt_summary === "string" &&
    source.excerpt_summary.trim().length > 0 &&
    typeof claim.normalized_value === "string" &&
    Boolean(claim.normalized_value.trim()) &&
    dimensionLiteral(source.excerpt_summary).includes(
      dimensionLiteral(claim.normalized_value),
    );
  const contactPaths = new Set([
    "contacts.sales_email",
    "contacts.export_email",
    "contacts.general_email",
    "contacts.phone",
  ]);
  for (const supplier of output.supplier_candidates) {
    if (
      output.research_mode === "fixture" ||
      supplier.entity_basis === "synthetic_fixture" ||
      supplier.evidence_basis === "illustrative_fixture"
    )
      continue;
    const claims = output.claims.filter(
      (claim) => claim.supplier_entity_id === supplier.supplier_entity_id,
    );
    for (const entry of plan.dimensions) {
      const { selection, definition } = entry;
      // These legacy facts do not identify a lot, shipment or contextual assignment.
      if (
        !selection.active ||
        selection.operator !== "research" ||
        selection.scope.lot_id !== "default" ||
        selection.scope.subject_id !== "request" ||
        selection.scope.context_assignment_id
      )
        continue;
      let added = 0;
      for (const claim of claims) {
        const field = claim.field_path ?? "";
        const contact =
          ["core.contact", "logistics.commercial_contact"].includes(
            definition.id,
          ) && contactPaths.has(field);
        const location =
          definition.id === "core.location" && field === "headquarters_address";
        const price =
          definition.id === "core.price" &&
          ["commercial.price_min", "commercial.price_max"].includes(field);
        if (
          (!contact && !location && !price) ||
          typeof claim.normalized_value !== "string"
        )
          continue;
        const value = claim.normalized_value;
        if (
          contact &&
          field.endsWith("_email") &&
          !/^[^\s<>()[\]@]+@[^\s<>()[\]@]+\.[^\s<>()[\]@]+$/u.test(value)
        )
          continue;
        for (const evidenceId of claim.evidence_ids) {
          const source = sources.get(evidenceId);
          if (!source || !admittedSource(claim, source) || added >= 20)
            continue;
          let publishedAt = source.published_at;
          let validUntil: string | undefined;
          if (price) {
            const sameSource = (path: string) =>
              claims.find(
                (item) =>
                  item.field_path === path &&
                  item.evidence_ids.includes(evidenceId) &&
                  admittedSource(item, source),
              );
            const date = sameSource("commercial.price_date");
            const currency = sameSource("commercial.currency");
            const unit = sameSource("commercial.unit");
            const literalDate = String(date?.normalized_value ?? "");
            const published = /^\d{4}-\d{2}-\d{2}$/u.test(literalDate)
              ? Date.parse(`${literalDate}T00:00:00.000Z`)
              : NaN;
            const amount =
              field === "commercial.price_min"
                ? supplier.commercial.price_min
                : supplier.commercial.price_max;
            if (
              !/^\d+(?:\.\d+)?$/u.test(value) ||
              Number(value) !== amount ||
              !date ||
              !currency ||
              !unit ||
              claim.claim_type !== "pricing" ||
              supplier.commercial.price_date !== literalDate ||
              supplier.commercial.currency !== currency.normalized_value ||
              supplier.commercial.unit !== unit.normalized_value ||
              !Number.isFinite(published) ||
              new Date(published).toISOString().slice(0, 10) !== literalDate ||
              published > now ||
              now - published >= 30 * 86400000 ||
              !/\b(?:updated|published|as of|dated|price date|quotation date|quoted on|effective from)\b/iu.test(
                source.excerpt_summary,
              )
            )
              continue;
            if (supplier.commercial.price_validity) {
              const validity = sameSource("commercial.price_validity");
              const literalValidity = String(validity?.normalized_value ?? "");
              if (
                !/^\d{4}-\d{2}-\d{2}$/u.test(literalValidity) ||
                supplier.commercial.price_validity !== literalValidity
              )
                continue;
              const expires = Date.parse(`${literalValidity}T23:59:59.999Z`);
              if (
                !Number.isFinite(expires) ||
                expires <= now ||
                new Date(expires).toISOString().slice(0, 10) !== literalValidity
              )
                continue;
              validUntil = new Date(expires).toISOString();
            }
            publishedAt = new Date(published).toISOString();
          }
          observations.push({
            observation_id: `dimension-${contractSha256Hex(JSON.stringify([plan.plan_hash, supplier.supplier_entity_id, selection.selection_id, claim.claim_id, evidenceId])).slice(0, 40)}`,
            selection_id: selection.selection_id,
            dimension_id: definition.id,
            definition_revision: definition.revision,
            trace: structuredClone(trace),
            entity_id: supplier.supplier_entity_id,
            scope: structuredClone(selection.scope),
            value,
            source: {
              source_id: source.source_id,
              uri: source.source_url,
              literal_excerpt: source.excerpt_summary,
              retrieved_at: source.retrieved_at,
              ...(publishedAt ? { published_at: publishedAt } : {}),
              ...(validUntil ? { valid_until: validUntil } : {}),
            },
          });
          added += 1;
        }
      }
    }
  }
  return {
    search_dimension_plan: structuredClone(plan),
    search_dimension_observations: observations,
    search_dimension_assessments: output.supplier_candidates.map((supplier) =>
      evaluateSearchDimensionPlan(plan, observations, {
        trace,
        entity_id: supplier.supplier_entity_id,
        now: output.generated_at,
        admitted_observation_ids: observations
          .filter(
            (observation) =>
              observation.entity_id === supplier.supplier_entity_id,
          )
          .map((observation) => observation.observation_id),
      }),
    ),
  };
}
