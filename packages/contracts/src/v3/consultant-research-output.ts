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

export const CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION =
  "consultant-research-output.v3" as const;
export const CONSULTANT_RESEARCH_OUTPUT_V3_VERSION = 1 as const;

export type ClassificationScheme =
  "HS" | "GS1_GPC" | "UNSPSC" | "ECLASS" | "ETIM" | "CUSTOM_MATCHBASE";

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
  readonly verification_status: "verified" | "claimed" | "unverified";
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
  readonly issuer?: string;
  readonly certificate_number?: string;
  readonly scope?: string;
  readonly status: "active" | "conditional" | "expired" | "unknown";
  readonly valid_from?: string;
  readonly valid_until?: string;
  readonly verification_status: "verified" | "claimed" | "unverified";
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
  readonly website: string;
  readonly primary_domain: string;
  readonly identity_confidence: ConfidenceLevelV2;
  readonly identity_evidence_ids: readonly string[];
  readonly contacts: VerifiedPublicContact;
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
  readonly lanes_executed: readonly ("lane_gemini" | "lane_openai")[];
  readonly verification_loops_count: number; // min 5, max 15
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

export interface ConsultantResearchOutputV3 extends FourIdTrace {
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
      "sufficient" | "partial" | "insufficient";
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
