import { STANDARD_DIMENSIONS } from "@matchbase/contracts";

export const CONSULTANT_REPORT_MODEL_VERSION =
  "consultant-report-model.v1" as const;
export const MATCHBASE_BRAND_MANIFEST_VERSION = "matchbase-brand.v1" as const;

export type ReportSectionStatus =
  "required" | "conditional" | "required_explicit_empty";

export interface ReportSectionDefinition {
  readonly section_id: string;
  readonly title: string;
  readonly status: ReportSectionStatus;
  readonly authoritative_condition?: string;
}

const sectionRegistry = [
  { section_id: "SEC-00", title: "Cover", status: "required" },
  {
    section_id: "SEC-01",
    title: "Contents, Document Control and How to Use This Document",
    status: "required",
  },
  {
    section_id: "SEC-02",
    title: "Confidentiality and Reliance Notice",
    status: "required",
  },
  { section_id: "SEC-03", title: "Executive Summary", status: "required" },
  {
    section_id: "SEC-03.1",
    title: "Opportunity Snapshot",
    status: "required",
  },
  {
    section_id: "SEC-03.2",
    title: "Recommended Supplier Path",
    status: "required",
  },
  {
    section_id: "SEC-03.3",
    title: "Priority Decisions",
    status: "required",
  },
  {
    section_id: "SEC-03.4",
    title: "Executive Determination and Decision Matrix",
    status: "conditional",
    authoritative_condition:
      "The engagement poses a determinable question and gate outcomes plus analyst determination answer it",
  },
  {
    section_id: "SEC-04",
    title: "Methodology and Validation Cycle",
    status: "required",
  },
  {
    section_id: "SEC-05",
    title: "Input Requirement Profile",
    status: "required",
  },
  {
    section_id: "SEC-05.1",
    title: "Normalized Procurement Requirement — Mandatory and Conditional",
    status: "required",
  },
  {
    section_id: "SEC-05.2",
    title: "Key Input Ambiguity and Governing Interpretation",
    status: "conditional",
    authoritative_condition:
      "A hard-constraint contradiction was detected during this engagement",
  },
  {
    section_id: "SEC-05.3",
    title: "Critical Data Still Required Before Final RFQ",
    status: "required_explicit_empty",
  },
  {
    section_id: "SEC-05.4",
    title: "Product or Model Identity Correction",
    status: "conditional",
    authoritative_condition:
      "A correction was proposed with evidence and adopted by an analyst",
  },
  {
    section_id: "SEC-06",
    title: "MatchBASE Scoring Model",
    status: "required",
  },
  {
    section_id: "SEC-06.1",
    title: "Dimensions, Weights, What Was Checked, Typical Evidence Required",
    status: "required",
  },
  {
    section_id: "SEC-06.2",
    title: "Fit Bands and How to Read a Score",
    status: "required",
  },
  {
    section_id: "SEC-06.3",
    title: "Evidence Grades Used",
    status: "required",
  },
  {
    section_id: "SEC-07",
    title: "Regulatory Route and Non-Negotiable Gate",
    status: "conditional",
    authoritative_condition:
      "The domain pack defines a mandatory regulatory route for the destination",
  },
  {
    section_id: "SEC-07.1",
    title: "Restricted-Party Screening Status",
    status: "required",
  },
  {
    section_id: "SEC-08",
    title: "Market, Price and Logistics Context",
    status: "conditional",
    authoritative_condition:
      "Public market context materially informs the shortlist and citable evidence exists",
  },
  {
    section_id: "SEC-09",
    title: "Supplier Landscape",
    status: "required",
  },
  {
    section_id: "SEC-09.1",
    title: "Landscape Table",
    status: "required",
  },
  {
    section_id: "SEC-09.2",
    title: "Score-Ordered View",
    status: "required",
  },
  {
    section_id: "SEC-09.3",
    title: "Scarcity Analysis",
    status: "conditional",
    authoritative_condition:
      "Fewer than three eligible candidates survived, or the eligible set was truncated at the cap",
  },
  {
    section_id: "SEC-10",
    title: "Product-Fit Matrix",
    status: "required",
  },
  {
    section_id: "SEC-10.1",
    title: "How to Read the Matrix",
    status: "required",
  },
  {
    section_id: "SEC-11",
    title: "Supplier Profiles",
    status: "required",
  },
  {
    section_id: "SEC-11.1",
    title: "Standard RFQ Question Set",
    status: "required",
  },
  { section_id: "SEC-11.2", title: "Profiles", status: "required" },
  {
    section_id: "SEC-12",
    title: "Reserve Candidates and Expansion Leads",
    status: "required_explicit_empty",
  },
  {
    section_id: "SEC-13",
    title: "Recommended RFQ Packet",
    status: "required",
  },
  {
    section_id: "SEC-14",
    title: "Due Diligence Checklist",
    status: "required",
  },
  {
    section_id: "SEC-15",
    title: "Recommended RFQ Wave Plan",
    status: "required",
  },
  {
    section_id: "SEC-16",
    title: "30-Day Execution Plan",
    status: "required",
  },
  {
    section_id: "SEC-17",
    title: "Final MatchBASE Recommendation",
    status: "required",
  },
  { section_id: "SEC-18", title: "Governance Note", status: "required" },
  { section_id: "SEC-19", title: "Source Register", status: "required" },
  {
    section_id: "SEC-20",
    title: "Sources Excluded After Validation",
    status: "required_explicit_empty",
  },
  {
    section_id: "SEC-21",
    title: "Research Limitations",
    status: "required",
  },
  {
    section_id: "SEC-22",
    title: "Validation Record",
    status: "required",
  },
  {
    section_id: "SEC-23",
    title: "Document History and Regeneration Record",
    status: "required",
  },
] as const satisfies readonly ReportSectionDefinition[];

export const REPORT_SECTION_REGISTRY = Object.freeze(
  sectionRegistry.map((definition) => Object.freeze({ ...definition })),
);

export type ReportSectionId = (typeof sectionRegistry)[number]["section_id"];

export const REPORT_SECTION_IDS = Object.freeze(
  REPORT_SECTION_REGISTRY.map(({ section_id }) => section_id),
);

export interface BrandAssetV1 {
  readonly asset_id: string;
  readonly media_type: "image/svg+xml" | "image/png" | "font/woff2";
  readonly content_sha256: string;
  readonly license_record_id: string;
}

export interface BrandManifestV1 {
  readonly schema_version: typeof MATCHBASE_BRAND_MANIFEST_VERSION;
  readonly product_name: "MatchBASE";
  readonly tokens: {
    readonly color: {
      readonly brand_red: "#FD4140";
      readonly primary_text: "#22252C";
      readonly secondary_text: "#3D4049";
      readonly muted: "#6E727C";
      readonly reverse: "#FFFFFF";
      readonly cover_text: "#1B1B1B";
      readonly small_red_text: {
        readonly state: "unresolved";
        readonly decision_id: "OD-TIER-057";
        readonly candidates: readonly ["#C4292A", "#D42B2A"];
      };
      readonly cover_field_background: {
        readonly state: "unresolved";
        readonly value: null;
      };
      readonly reverse_header_fill: {
        readonly state: "unresolved";
        readonly value: null;
      };
    };
    readonly spacing: { readonly state: "unresolved" };
    readonly typography: {
      readonly observed_families: readonly ["Montserrat", "Poppins", "Inter"];
      readonly embedding_license: {
        readonly state: "unresolved";
        readonly decision_id: "OD-TIER-055";
      };
    };
  };
  readonly asset_license: {
    readonly state: "unresolved";
    readonly decision_id: "OD-TIER-054";
  };
  readonly assets: readonly BrandAssetV1[];
}

export const MATCHBASE_BRAND_MANIFEST_V1: BrandManifestV1 = Object.freeze({
  schema_version: MATCHBASE_BRAND_MANIFEST_VERSION,
  product_name: "MatchBASE",
  tokens: Object.freeze({
    color: Object.freeze({
      brand_red: "#FD4140",
      primary_text: "#22252C",
      secondary_text: "#3D4049",
      muted: "#6E727C",
      reverse: "#FFFFFF",
      cover_text: "#1B1B1B",
      small_red_text: Object.freeze({
        state: "unresolved",
        decision_id: "OD-TIER-057",
        candidates: Object.freeze(["#C4292A", "#D42B2A"] as const),
      }),
      cover_field_background: Object.freeze({
        state: "unresolved",
        value: null,
      }),
      reverse_header_fill: Object.freeze({
        state: "unresolved",
        value: null,
      }),
    }),
    spacing: Object.freeze({ state: "unresolved" }),
    typography: Object.freeze({
      observed_families: Object.freeze([
        "Montserrat",
        "Poppins",
        "Inter",
      ] as const),
      embedding_license: Object.freeze({
        state: "unresolved",
        decision_id: "OD-TIER-055",
      }),
    }),
  }),
  asset_license: Object.freeze({
    state: "unresolved",
    decision_id: "OD-TIER-054",
  }),
  // Assets remain empty until a license record and content digest are available.
  assets: Object.freeze([]),
});

export const CONSULTANT_REPORT_DIMENSIONS = Object.freeze(
  STANDARD_DIMENSIONS.map(({ dimension_id, weight }) =>
    Object.freeze({ dimension_id, weight }),
  ),
);

export type ConsultantReportDimension =
  (typeof CONSULTANT_REPORT_DIMENSIONS)[number];

export type ReportSourceType =
  | "engagement"
  | "artifact_version"
  | "artifact_lineage"
  | "canonical_request"
  | "analyst_decision"
  | "run_record"
  | "classifier"
  | "contradiction"
  | "domain_pack"
  | "screening_record"
  | "result"
  | "evidence"
  | "gate_outcome"
  | "scoring_charter"
  | "versioned_configuration";

export interface ReportSourceReferenceV1 {
  readonly source_type: ReportSourceType;
  readonly source_id: string;
  readonly field_path: string;
}

export interface BudgetedTextV1 {
  readonly value: string;
  readonly max_characters: number;
}

export type ReportContentBlockV1 =
  | { readonly kind: "paragraph"; readonly text: BudgetedTextV1 }
  | { readonly kind: "bullet_list"; readonly items: readonly BudgetedTextV1[] }
  | {
      readonly kind: "key_value";
      readonly entries: readonly {
        readonly label: BudgetedTextV1;
        readonly value: BudgetedTextV1;
      }[];
    }
  | {
      readonly kind: "table";
      readonly columns: readonly BudgetedTextV1[];
      readonly rows: readonly (readonly BudgetedTextV1[])[];
    };

export const EXPLICIT_EMPTY_TEXT = Object.freeze({
  "SEC-05.3": "No further data is outstanding for RFQ issue",
  "SEC-12": "No reserve candidates were identified",
  "SEC-20": "No source was excluded after validation",
} as const);

export type ExplicitEmptySectionId = keyof typeof EXPLICIT_EMPTY_TEXT;
export type ExplicitEmptyText =
  (typeof EXPLICIT_EMPTY_TEXT)[ExplicitEmptySectionId];

export interface ConsultantReportSectionV1 {
  readonly section_id: ReportSectionId;
  readonly source_references: readonly ReportSourceReferenceV1[];
  readonly blocks: readonly ReportContentBlockV1[];
  readonly explicit_empty_reason?: ExplicitEmptyText;
}

export interface OmittedConditionalSectionV1 {
  readonly section_id: ReportSectionId;
  readonly authoritative_condition: string;
  readonly non_applicability_reason: BudgetedTextV1;
  readonly source_references: readonly ReportSourceReferenceV1[];
}

export interface ConsultantReportClaimV1 {
  readonly claim_id: string;
  readonly assertion: BudgetedTextV1;
  readonly materiality: "eligibility" | "score" | "context";
  readonly high_risk: boolean;
  readonly section_ids: readonly ReportSectionId[];
}

export interface CitationReferenceV1 {
  readonly claim_id: string;
  readonly url: string;
  readonly retrieval_run_id: string;
}

export interface ConsultantReportCitationV1 {
  readonly claim_id: string;
  readonly url: string;
  readonly publisher: BudgetedTextV1;
  readonly published_or_updated: BudgetedTextV1;
  readonly accessed_at: string;
  readonly source_tier:
    | "official_register"
    | "primary_vendor_or_company"
    | "recognised_trade_or_industry_body"
    | "secondary_commentary";
  readonly verification_status:
    | "claimed"
    | "externally_verified"
    | "inferred"
    | "stale"
    | "conflicting"
    | "unknown";
  readonly extracted_support: BudgetedTextV1;
  readonly corroborated_by: readonly CitationReferenceV1[];
  readonly retrieval_run_id: string;
}

export interface ConsultantReportModelV1 {
  readonly schema_version: typeof CONSULTANT_REPORT_MODEL_VERSION;
  readonly brand_manifest_version: typeof MATCHBASE_BRAND_MANIFEST_VERSION;
  readonly document_control: {
    readonly document: BudgetedTextV1;
    readonly prepared_by: BudgetedTextV1;
    readonly prepared_at: string;
    readonly classification: BudgetedTextV1;
    readonly status: "Working Draft" | "For Review" | "Final" | "Superseded";
    readonly basis: BudgetedTextV1;
  };
  readonly lineage: {
    readonly artifact_version: number;
    readonly generating_run_id: string;
    readonly canonical_request_version_id: string;
    readonly projection_version_id: string;
    readonly analyst_decision_set_id: string;
    readonly result_sha256: string;
    readonly template_version: string;
    readonly page_geometry: "a4" | "letter";
    readonly generated_by_subject_id: string;
    readonly composed_at: string;
  };
  readonly scoring_dimensions: readonly ConsultantReportDimension[];
  readonly sections: readonly ConsultantReportSectionV1[];
  readonly omitted_conditional_sections: readonly OmittedConditionalSectionV1[];
  readonly claims: readonly ConsultantReportClaimV1[];
  readonly citations: readonly ConsultantReportCitationV1[];
}
