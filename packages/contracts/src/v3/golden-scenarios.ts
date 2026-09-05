import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
  EvidenceSourceV3,
  ClaimV3,
} from "./consultant-research-output.js";

// ============================================================================
// POLICY A: 20 SYNTHETIC ILLUSTRATIVE POULTRY SUPPLIERS (V3-01)
// - Fully synthetic illustrative entities (Policy A)
// - Non-routable internal domains, no generated public emails/phones
// - Non-sequential illustrative SIF identifiers
// - Zero orphan evidence IDs (all IDs resolve to V3_01_EVIDENCE_SOURCES)
// - Strict 60-point cap on candidates failing mandatory SFDA compliance
// - Candidate 1 explicitly flags Commercial-Term Mismatch (observed CIF vs requested CFR)
// ============================================================================

export const V3_01_EVIDENCE_SOURCES: readonly EvidenceSourceV3[] = [
  {
    evidence_id: "ev-sfda-registry-01",
    source_id: "src-sfda-portal",
    source_url: "https://sfda.gov.sa/establishments-foreign-meat-poultry",
    source_title:
      "Saudi Food and Drug Authority Foreign Establishment Registry (Brazil)",
    publisher: "Saudi Food and Drug Authority (SFDA)",
    source_type: "official_registry",
    retrieved_at: "2026-09-05T09:00:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Official list of approved Brazilian poultry slaughterhouses accredited for export to the Kingdom of Saudi Arabia.",
    supports_claim_ids: ["cl-poultry-01"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-mapa-sif-01",
    source_id: "src-mapa-sif",
    source_url:
      "https://www.gov.br/agricultura/pt-br/assuntos/inspecao/produtos-animal/sif",
    source_title: "MAPA Federal Inspection Service (SIF) Sanitary Database",
    publisher: "Ministério da Agricultura e Pecuária (Brazil)",
    source_type: "official_registry",
    retrieved_at: "2026-09-05T09:15:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "National Brazilian registry of federally inspected slaughterhouses and poultry processing facilities.",
    supports_claim_ids: ["cl-poultry-01"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-halal-cert-01",
    source_id: "src-fambras-halal",
    source_url: "https://fambrashalal.com.br/slaughter-certificates",
    source_title: "FAMBRAS Halal Export Certification Directory",
    publisher: "FAMBRAS Halal Brazil",
    source_type: "official_registry",
    retrieved_at: "2026-09-05T09:30:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Accredited Islamic slaughterhouse halal inspection certificates for GCC poultry exports.",
    supports_claim_ids: ["cl-poultry-02"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-abpa-benchmark-01",
    source_id: "src-abpa-market",
    source_url: "https://abpa-br.org/mercado-avicultura-exportacao-2026",
    source_title: "ABPA Brazilian Animal Protein Monthly Export Monitor",
    publisher: "Associação Brasileira de Proteína Animal",
    source_type: "trade_directory",
    retrieved_at: "2026-09-05T09:45:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Monthly benchmark pricing and container freight indications for frozen poultry exports to Middle Eastern ports.",
    supports_claim_ids: ["cl-poultry-03"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-paranagua-port-01",
    source_id: "src-port-paranagua",
    source_url: "https://www.portosdoparana.pr.gov.br/reefer-operations",
    source_title: "Port of Paranaguá Cold-Chain Reefer Terminal Schedule",
    publisher: "Portos do Paraná Authority",
    source_type: "trade_directory",
    retrieved_at: "2026-09-05T10:00:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Direct ocean reefer container liner service schedules connecting Southern Brazil to Jeddah Islamic Port.",
    supports_claim_ids: ["cl-poultry-03"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-fixture-policy-01",
    source_id: "src-matchbase-policy-a",
    source_url:
      "https://matchbase.internal/governance/policy-a-synthetic-fixtures",
    source_title:
      "MatchBASE Policy A Synthetic Demonstration Dataset Specification",
    publisher: "MatchBASE Platform Governance",
    source_type: "synthetic_fixture",
    retrieved_at: "2026-09-05T10:30:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Governed synthetic fixture definition providing 20 unique illustrative candidate entities without public contact fabrication.",
    supports_claim_ids: ["cl-poultry-04"],
    contradicts_claim_ids: [],
  },
];

export const V3_01_CLAIMS: readonly ClaimV3[] = [
  {
    claim_id: "cl-poultry-01",
    claim_type: "compliance",
    claim_text:
      "Top tier Brazilian poultry slaughterhouse establishments hold active sanitary approvals under MAPA SIF and SFDA foreign registries.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-sfda-registry-01", "ev-mapa-sif-01"],
  },
  {
    claim_id: "cl-poultry-02",
    claim_type: "compliance",
    claim_text:
      "Recognized Halal certifying bodies in Brazil audit slaughter lines according to GSO 993 standards.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-halal-cert-01"],
  },
  {
    claim_id: "cl-poultry-03",
    claim_type: "pricing",
    claim_text:
      "Indicative spot export pricing for Grade A frozen whole chicken ranges between $1,580 and $1,740 per MT on a containerized basis.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-abpa-benchmark-01", "ev-paranagua-port-01"],
  },
  {
    claim_id: "cl-poultry-04",
    claim_type: "identity",
    claim_text:
      "Demonstration fixture entities operate under Policy A non-routable synthetic parameters for UAT progressive disclosure testing.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-fixture-policy-01"],
  },
];

const SYNTHETIC_POULTRY_NAMES = [
  "Apex Avícola do Brasil S.A.",
  "Cruzeiro Agroindustrial de Aves Ltda.",
  "Sulina Alimentos e Proteínas S.A.",
  "Planalto Frigorífico Integrado Ltda.",
  "Paraná Frango Industrial S.A.",
  "Aurora do Sul Avicultura Ltda.",
  "Catarinense Aves e Carnes S.A.",
  "Rio Grande Frigorífico de Aves S.A.",
  "Bela Vista Agroavícola Ltda.",
  "Alvorada Frangos do Brasil S.A.",
  "Guarani Alimentos Avícolas Ltda.",
  "Pampa Proteínas e Aves S.A.",
  "Serrana Cooperativa Avícola Ltda.",
  "Centro-Oeste Frigorífico Avícola S.A.",
  "Nova Era Agroindustrial Ltda.",
  "Triângulo Aves do Brasil S.A.",
  "Vales do Iguaçu Avicultura S.A.",
  "Pioneira Alimentos Congelados Ltda.",
  "Horizonte Frigorífico de Aves S.A.",
  "Estrela Polar Agroindustrial Ltda.",
];

export const BRAZIL_POULTRY_20_SUPPLIERS: readonly SupplierEntityV3[] =
  SYNTHETIC_POULTRY_NAMES.map((name, idx) => {
    const rank = idx + 1;
    const candId = `cand-br-${String(rank).padStart(2, "0")}`;
    const entityId = `00000000-0000-4000-8000-${String(1000 + rank).padStart(12, "0")}`;
    const sifNum = `SIF-ILLUS-${String(100 + rank * 7)}`;
    const domainSlug = `illus-poultry-${String(rank).padStart(2, "0")}.matchbase.internal`;

    const sfdaApproved = rank <= 8;
    const isCandidate1 = rank === 1;

    const observedIncoterm = isCandidate1
      ? "CIF"
      : rank % 2 === 0
        ? "CFR"
        : "CIF";
    const priceMin = 1580 + (rank % 5) * 30;
    const priceMax = priceMin + 90;

    let score: number;
    let fitBand: "Strong Fit" | "Potential Fit" | "Low Fit";
    if (sfdaApproved) {
      if (rank <= 4) {
        score = 94 - (rank - 1) * 3;
        fitBand = "Strong Fit";
      } else {
        score = 74 - (rank - 5) * 3;
        fitBand = "Potential Fit";
      }
    } else {
      // MANDATORY CONSTRAINT FAILED: Must be capped at <= 60 and CANNOT be Strong Fit
      score = Math.max(42, 60 - (rank - 9) * 1.5);
      fitBand = score >= 55 ? "Potential Fit" : "Low Fit";
    }

    const limitingGaps: string[] = [];
    const requiredValidation: string[] = [];

    if (isCandidate1) {
      limitingGaps.push(
        "Commercial-term mismatch: Supplier observed price basis is CIF Jeddah; buyer approved request is CFR Jeddah. Quotation adjustment required to unbundle maritime insurance.",
      );
      limitingGaps.push(
        "Calibration gap: Observed offerings cover 900g-1000g whole birds; buyer requested 1000g-1200g. Facility confirmation required for heavier bird sizing allocation.",
      );
      requiredValidation.push(
        "Request revised commercial quote on exact CFR Jeddah terms.",
      );
      requiredValidation.push(
        "Validate plant capacity for continuous 1000g-1200g calibrated bird batches.",
      );
    } else if (!sfdaApproved) {
      limitingGaps.push(
        `SFDA listing pending renewal: Establishment ${sifNum} holds MAPA SIF export registration but is awaiting SFDA bilateral audit reinstatement.`,
      );
      requiredValidation.push(
        "Monitor SFDA foreign slaughterhouse portal for official re-listing prior to purchase order confirmation.",
      );
    } else if (observedIncoterm === "CIF") {
      limitingGaps.push(
        "Observed quote basis is CIF Jeddah; quotation conversion to CFR required.",
      );
      requiredValidation.push("Confirm willingness to contract on CFR basis.");
    }

    return {
      supplier_entity_id: entityId,
      candidate_id: candId,
      legal_name: `${name} [Illustrative]`,
      trading_name: `${name.split(" ")[0]} Export Brazil [Illustrative]`,
      brand_names: [`${name.split(" ")[0]} Griller`],
      aliases: [],
      supplier_type: "manufacturer",
      manufacturer_status: "direct_manufacturer",
      country_of_registration: "Brazil",
      headquarters_address: `Avenida Industrial ${rank * 100}, Paraná, Brazil (Demonstration Entity)`,
      manufacturing_locations: [`${sifNum} (Paraná Slaughterhouse Plant)`],
      website: `https://${domainSlug}`,
      primary_domain: domainSlug,
      identity_confidence: "high",
      identity_evidence_ids: ["ev-fixture-policy-01", "ev-mapa-sif-01"],
      contacts: {
        verification_status: "unverified",
        contact_evidence_ids: ["ev-fixture-policy-01"],
      },
      digital_assets: [
        {
          asset_class: "demonstration fixture record",
          url: `https://${domainSlug}`,
          status: "inspected",
        },
      ],
      offering: {
        product_name: "Frozen Whole Chicken Grade A",
        product_family: "Poultry Meat",
        specifications: {
          grilling_grade: "Grade A",
          weights: isCandidate1
            ? "900g and 1000g whole birds (1000g-1200g on request)"
            : "1000g - 1200g whole birds",
          moisture_glaze: "<4.5%",
          storage: "-18C deep freeze",
        },
        use_cases: [
          "Foodservice distribution",
          "Wholesale butchery",
          "Retail packaging",
        ],
        country_of_origin: "Brazil",
        manufacturing_site: `${sifNum} Industrial Plant`,
        customization_support: true,
        private_label: true,
        sample_availability: "available",
        product_evidence_ids: ["ev-fixture-policy-01"],
      },
      commercial: {
        price_min: priceMin,
        price_max: priceMax,
        currency: "USD",
        unit: "metric ton",
        incoterm: observedIncoterm,
        incoterm_location: "Jeddah Islamic Port",
        moq: "1 container (27 MT)",
        production_capacity: `${20000 + rank * 5000} MT/month`,
        lead_time: `${30 + (rank % 4) * 3} days`,
        commercial_confidence: "high",
        price_validity: "2026-10-31",
        commercial_evidence_ids: ["ev-abpa-benchmark-01"],
      },
      packaging_and_logistics: {
        packaging_type: "Corrugated export master carton",
        pack_size: "10 kg master (individually poly-bagged whole birds)",
        storage_conditions: "-18C continuous deep freeze",
        shelf_life: "12 months",
        origin_port: "Port of Paranaguá, Brazil",
        shipping_modes: ["Ocean reefer 40ft"],
        logistics_notes:
          "Direct containerized reefer lane to Jeddah Islamic Port",
        logistics_evidence_ids: ["ev-paranagua-port-01"],
      },
      certifications: [
        {
          certification_name: sfdaApproved
            ? "SFDA Approved Foreign Slaughterhouse"
            : "SFDA Re-listing Audit Pending",
          issuer: "Saudi Food and Drug Authority",
          certificate_number: sfdaApproved
            ? `SFDA-BR-${rank + 100}`
            : "SFDA-AUDIT-PENDING",
          status: sfdaApproved ? "active" : "conditional",
          verification_status: "claimed",
          evidence_ids: ["ev-sfda-registry-01"],
        },
        {
          certification_name: "Accredited Halal Slaughter Certification",
          issuer: "FAMBRAS Halal Brazil",
          status: "active",
          verification_status: "claimed",
          evidence_ids: ["ev-halal-cert-01"],
        },
      ],
      assessment: {
        rank,
        compatibility_score: score,
        fit_band: fitBand,
        evidence_confidence: "high",
        identity_confidence: "high",
        data_completeness: 94 - (rank % 5) * 2,
        dimension_scores: {
          category_product_fit: sfdaApproved ? 95 : 85,
          compliance_certification_fit: sfdaApproved ? 94 : 45,
          volume_capacity_fit: 90 - (rank % 5) * 2,
          price_tier_fit: 88,
          positioning_brand_fit: 85,
          geographic_reach_fit: 92,
        },
        mandatory_constraint_results: [
          {
            constraint: "Active SFDA Slaughterhouse Listing",
            satisfied: sfdaApproved,
            evidence_ids: ["ev-sfda-registry-01"],
          },
          {
            constraint: "Accredited Halal Slaughter Certification",
            satisfied: true,
            evidence_ids: ["ev-halal-cert-01"],
          },
          {
            constraint: "MAPA SIF Sanitary Traceability",
            satisfied: true,
            evidence_ids: ["ev-mapa-sif-01"],
          },
        ],
        positive_drivers: sfdaApproved
          ? [
              `Active SFDA foreign establishment approval with valid SIF registration (${sifNum})`,
              "Proven production capacity and export cold-chain infrastructure",
            ]
          : [
              `High industrial capacity (${20000 + rank * 5000} MT/month) under federal SIF inspection`,
              "Valid accredited Halal certification",
            ],
        limiting_gaps: limitingGaps,
        risk_flags: sfdaApproved
          ? []
          : ["Mandatory SFDA approval not active; score capped at <= 60"],
        unknowns: [],
        required_validation: requiredValidation,
        recommended_next_action: sfdaApproved
          ? isCandidate1
            ? "Request revised commercial quotation on CFR basis"
            : "Initiate formal RFQ wave"
          : "Hold commercial negotiations until SFDA re-listing verification is completed",
      },
    };
  });

// ============================================================================
// GOLDEN SCENARIO V3-01: 20-Supplier Progressive Disclosure Demonstration
// ============================================================================
export const GOLDEN_SCENARIO_V3_01: ConsultantResearchOutputV3 = {
  schema_version: "consultant-research-output.v3",
  schema_contract_version: 1,
  user_profile_id: "2efd403d-823e-4b3f-9fe8-fe3f800c460e",
  research_run_id: "00000000-0000-4000-8000-000000000401",
  execution_id: "00000000-0000-4000-8000-000000002401",
  classification_id: "00000000-0000-4000-8000-000000003401",
  title: "Frozen Whole Chicken Sourcing & Supplier Landscape (Demonstration)",
  subtitle:
    "20 Illustrative Candidate Profiles with SFDA Status & Trade-Term Lineage",
  generated_at: "2026-09-05T12:00:00Z",
  as_of_date: "2026-09-05",
  research_mode: "fixture",
  research_status: "complete",
  primary_classification: {
    classification_id: "00000000-0000-4000-8000-000000003401",
    scheme: "HS",
    code: "0207.12",
    version: "HS 2022",
    jurisdiction: "Global (WCO)",
    level: "6-digit subheading",
    label:
      "Meat and edible offal of poultry, frozen whole chickens (not cut in pieces)",
    description:
      "Harmonized System tariff code covering frozen whole chicken fowls of the species Gallus domesticus.",
    is_primary: true,
    confidence: "high",
    source_url: "https://www.wcoomd.org",
    assigned_at: "2026-09-05T12:00:00Z",
  },
  secondary_classifications: [],
  request_snapshot: {
    primary_query_type: "sourcing",
    secondary_query_types: ["pricing", "market_overview"],
    intent_scope: "trade_lane",
    business_context: [
      "Importer seeking direct Brazilian chicken slaughterhouse sources for Saudi Arabian distribution.",
    ],
    product_category: "Poultry & Frozen Meat",
    product_name: "Frozen Whole Chicken Grade A",
    confidence_level_required: "high",
    compliance_sensitive: true,
    pricing_volatile: true,
    product_attributes: {
      origin: "Brazil",
      destination: "Saudi Arabia (Jeddah Islamic Port)",
      sfda_mandatory: true,
      halal_mandatory: true,
      requested_quantity: "4 × 40-foot reefer containers",
      requested_incoterm: "CFR",
      requested_incoterm_location: "Jeddah Islamic Port",
      weight_spec: "1000g - 1200g",
    },
    normalized_requirements: [
      {
        name: "Approved Order Quantity",
        value: "4 × 40-foot reefer containers",
        requirement_level: "mandatory",
      },
      {
        name: "Approved Delivery Incoterm",
        value: "CFR Jeddah",
        requirement_level: "mandatory",
      },
      {
        name: "SFDA Establishment Approval",
        value: true,
        requirement_level: "mandatory",
      },
      {
        name: "Accredited Halal Certification",
        value: true,
        requirement_level: "mandatory",
      },
      {
        name: "Direct SIF Slaughterhouse Traceability",
        value: true,
        requirement_level: "mandatory",
      },
    ],
    mandatory_constraints: [
      "Active SFDA poultry establishment registration",
      "Recognized Halal slaughtering certification",
      "Exact quantity: 4 × 40-foot reefer containers",
      "Incoterm: CFR Jeddah",
    ],
    preferred_constraints: [
      "Direct slaughterhouse contract without intermediaries",
      "1000g - 1200g whole bird calibration",
    ],
    excluded_constraints: [
      "Unregistered slaughterhouses lacking MAPA/SFDA registration",
    ],
  },
  executive_summary: {
    headline:
      "20 Illustrative Candidate Profiles Synthesized for Brazil-Saudi Trade Corridor",
    direct_answer:
      "Demonstration dataset providing 20 illustrative candidate entities structured under MatchBASE Policy A. Top-tier candidates satisfy active SFDA foreign establishment listing and accredited Halal certification. Lineage tracing distinguishes the buyer approved CFR Jeddah requirement from observed supplier CIF terms.",
    key_findings: [
      "Demonstration mode: 20 illustrative profiles generated for progressive disclosure evaluation.",
      "Commercial lineage: Buyer approved CFR Jeddah; Rank 1 supplier observed basis is CIF Jeddah (term mismatch flagged).",
      "Compliance cap enforced: Candidates with pending SFDA renewal are strictly capped at compatibility score <= 60.",
      "Exact quantity: Request preserved as 4 × 40-foot reefer containers without unapproved range conversion.",
    ],
    candidate_count: 20,
    confidence_assessment: "high",
    research_coverage_status: "sufficient",
  },
  target_candidates_count: 20,
  total_candidates_found: 20,
  supplier_candidates: BRAZIL_POULTRY_20_SUPPLIERS,
  claims: V3_01_CLAIMS,
  evidence_sources: V3_01_EVIDENCE_SOURCES,
  telemetry: {
    lanes_executed: [],
    verification_loops_count: 5,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0.0,
    execution_latency_ms: 220,
    synthesis_model_id: "deterministic-fixture-engine.v3",
    executed_at: "2026-09-05T12:00:00Z",
  },
  report_artifact: {
    artifact_id: "00000000-0000-4000-8000-000000004401",
    artifact_type: "pdf_landscape_report",
    filename: "INNOBASE_MatchBASE_Brazil_Saudi_Poultry_Supplier_Landscape.pdf",
    download_url:
      "/api/v1/consultant/reports/00000000-0000-4000-8000-000000000401/pdf",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    generated_at: "2026-09-05T12:00:00Z",
  },
  limitations_and_disclosures: [
    {
      title: "Research Mode Disclosure",
      description:
        "Demonstration dataset — not live market evidence. All entity names and parameters are illustrative.",
      severity: "info",
    },
    {
      title: "Commercial Reliance Boundary",
      description:
        "Illustrative supplier profiles. Not for commercial reliance. Counterparty validation required prior to financial commitment.",
      severity: "info",
    },
    {
      title: "Trade Term Mismatch Notice",
      description:
        "Approved request specifies CFR Jeddah. Observed supplier terms include CIF; price adjustments required upon formal inquiry.",
      severity: "advisory",
    },
  ],
};

export const BRAZIL_POULTRY_GOLDEN_V3 = GOLDEN_SCENARIO_V3_01;
export const GOLDEN_SCENARIO_SC01_V3 = GOLDEN_SCENARIO_V3_01;

// ============================================================================
// GOLDEN SCENARIO V3-02: Truthful Fewer-Than-20 Result (Request B: Water Heaters)
// ============================================================================

export const V3_02_EVIDENCE_SOURCES: readonly EvidenceSourceV3[] = [
  {
    evidence_id: "ev-wh-moiat-01",
    source_id: "src-moiat-uae",
    source_url: "https://moiat.gov.ae/en/services/issue-conformity-certificate",
    source_title:
      "Ministry of Industry and Advanced Technology (MoIAT) Conformity Registry",
    publisher: "MoIAT United Arab Emirates",
    source_type: "official_registry",
    retrieved_at: "2026-09-05T10:00:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Official conformity registry for commercial pressure vessels and electrical water heating equipment.",
    supports_claim_ids: ["cl-wh-01"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-wh-ped-01",
    source_id: "src-tuv-ped",
    source_url: "https://www.tuv.com/certificates/ped-directive-2014-68-eu",
    source_title:
      "CE Pressure Equipment Directive (PED 2014/68/EU) Certification Database",
    publisher: "TUV Rheinland / Notified Body 0035",
    source_type: "official_registry",
    retrieved_at: "2026-09-05T10:15:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "EU conformity certificates verifying pressure vessel testing up to 15 bar for 10 bar working pressure calorifiers.",
    supports_claim_ids: ["cl-wh-01"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-wh-spec-01",
    source_id: "src-wh-tech-catalog",
    source_url:
      "https://matchbase.internal/fixtures/commercial-water-heaters/spec-catalog-2026",
    source_title:
      "Commercial Calorifier Engineering & Dimension Specifications Catalog",
    publisher: "European Commercial Heating Equipment Association",
    source_type: "synthetic_fixture",
    retrieved_at: "2026-09-05T10:30:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Technical dimensions confirming 500L storage calorifiers with outer diameter under 850mm and 3-phase 400V 50Hz configuration.",
    supports_claim_ids: ["cl-wh-02"],
    contradicts_claim_ids: [],
  },
];

export const V3_02_CLAIMS: readonly ClaimV3[] = [
  {
    claim_id: "cl-wh-01",
    claim_type: "compliance",
    claim_text:
      "Verified industrial electric water heaters hold mandatory CE PED 2014/68/EU certification and UAE MoIAT conformity.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-wh-moiat-01", "ev-wh-ped-01"],
  },
  {
    claim_id: "cl-wh-02",
    claim_type: "product_spec",
    claim_text:
      "Calorifier envelope diameter is strictly limited to <= 85 cm to ensure facility doorway clearance.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-wh-spec-01"],
  },
];

export const GOLDEN_SCENARIO_V3_02_SUPPLIERS: readonly SupplierEntityV3[] = [
  {
    supplier_entity_id: "00000000-0000-4000-8000-000000002001",
    candidate_id: "cand-wh-01",
    legal_name: "Caloria Thermal Systems Europe S.p.A. [Illustrative]",
    trading_name: "Caloria Middle East",
    brand_names: ["Caloria", "ThermorMax"],
    aliases: ["Caloria Industrial Heating"],
    supplier_type: "manufacturer",
    manufacturer_status: "direct_manufacturer",
    country_of_registration: "Italy",
    headquarters_address: "Via dell'Industria 45, Bergamo, Italy",
    manufacturing_locations: [
      "Bergamo Plant, Italy",
      "Dubai Regional Hub, UAE",
    ],
    website: "https://illus-caloria.matchbase.internal",
    primary_domain: "illus-caloria.matchbase.internal",
    identity_confidence: "high",
    identity_evidence_ids: ["ev-wh-spec-01"],
    contacts: {
      verification_status: "unverified",
      contact_evidence_ids: ["ev-wh-spec-01"],
    },
    digital_assets: [
      {
        asset_class: "demonstration fixture website",
        url: "https://illus-caloria.matchbase.internal",
        status: "inspected",
      },
    ],
    offering: {
      product_name: "Commercial Electric Storage Calorifier 500L",
      product_family: "Industrial Water Heating Equipment",
      specifications: {
        capacity: "500 Litres",
        working_pressure: "10 bar continuous (factory tested to 15 bar)",
        electrical_supply: "Three-Phase 400V 50Hz (18kW heating element)",
        outer_diameter: "810 mm (strictly within 85cm door limit)",
        corrosion_protection:
          "Titanium electronic anode + high-purity vitreous enamel",
        warranty: "5-year tank warranty, 2-year electrical components",
        service_support:
          "UAE local installation team and spares warehouse in Dubai",
      },
      use_cases: ["Hotels", "Commercial Laundry", "Central Domestic Hot Water"],
      country_of_origin: "Italy",
      manufacturing_site: "Bergamo Industrial Plant (ISO 9001 / PED Certified)",
      customization_support: true,
      private_label: false,
      sample_availability: "available",
      product_evidence_ids: ["ev-wh-spec-01"],
    },
    commercial: {
      price_min: 2450,
      price_max: 2850,
      currency: "USD",
      unit: "unit",
      incoterm: "DDP",
      incoterm_location: "Dubai Industrial Area, UAE",
      moq: "1 unit",
      production_capacity: "1,500 units/month",
      lead_time: "14 days from regional warehouse",
      commercial_confidence: "high",
      price_validity: "2026-10-31",
      commercial_evidence_ids: ["ev-wh-spec-01"],
    },
    packaging_and_logistics: {
      packaging_type: "Reinforced wooden crate on timber pallet",
      pack_size: "1 unit per crate",
      storage_conditions: "Enclosed dry warehouse",
      shelf_life: "Indefinite",
      origin_port: "Jebel Ali Port, Dubai",
      shipping_modes: ["Dedicated flatbed truck"],
      logistics_notes:
        "DDP Dubai on-site delivery with crane offloading support",
      logistics_evidence_ids: ["ev-wh-spec-01"],
    },
    certifications: [
      {
        certification_name: "CE Pressure Equipment Directive (PED 2014/68/EU)",
        issuer: "TUV Rheinland",
        certificate_number: "PED-CE-0035-2022",
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-wh-ped-01"],
      },
      {
        certification_name: "UAE MoIAT / G-Mark Conformity",
        issuer: "Ministry of Industry and Advanced Technology, UAE",
        certificate_number: "MoIAT-EQ-2024-8812",
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-wh-moiat-01"],
      },
    ],
    assessment: {
      rank: 1,
      compatibility_score: 95,
      fit_band: "Strong Fit",
      evidence_confidence: "high",
      identity_confidence: "high",
      data_completeness: 97,
      dimension_scores: {
        category_product_fit: 98,
        compliance_certification_fit: 96,
        volume_capacity_fit: 94,
        price_tier_fit: 92,
        positioning_brand_fit: 97,
        geographic_reach_fit: 95,
      },
      mandatory_constraint_results: [
        {
          constraint: "500L storage capacity",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "10 bar working pressure",
          satisfied: true,
          evidence_ids: ["ev-wh-ped-01"],
        },
        {
          constraint: "Outer diameter <= 85cm (81cm actual)",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "Three-phase electrical 400V 50Hz",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "CE mark & UAE MoIAT conformity",
          satisfied: true,
          evidence_ids: ["ev-wh-moiat-01", "ev-wh-ped-01"],
        },
        {
          constraint: "DDP Dubai delivery terms",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
      ],
      positive_drivers: [
        "Diameter of 810mm comfortably passes through standard 850mm mechanical room door",
        "Local spare parts depot and technician team based in Dubai Industrial City",
        "Complete compliance with CE PED and UAE MoIAT requirements",
      ],
      limiting_gaps: [],
      risk_flags: [],
      unknowns: [],
      required_validation: [
        "Confirm on-site electrical panel isolator ratings prior to hookup",
      ],
      recommended_next_action:
        "Issue formal RFQ for exact 10-unit project batch on DDP Dubai terms",
    },
  },
  {
    supplier_entity_id: "00000000-0000-4000-8000-000000002002",
    candidate_id: "cand-wh-02",
    legal_name: "ThermaVessel Industrial SAS [Illustrative]",
    trading_name: "ThermaVessel Gulf",
    brand_names: ["ThermaVessel"],
    aliases: ["ThermaVessel France"],
    supplier_type: "manufacturer",
    manufacturer_status: "direct_manufacturer",
    country_of_registration: "France",
    headquarters_address: "Zone Industrielle Nord, Lyon, France",
    manufacturing_locations: ["Lyon, France"],
    website: "https://illus-thermavessel.matchbase.internal",
    primary_domain: "illus-thermavessel.matchbase.internal",
    identity_confidence: "high",
    identity_evidence_ids: ["ev-wh-spec-01"],
    contacts: {
      verification_status: "unverified",
      contact_evidence_ids: ["ev-wh-spec-01"],
    },
    digital_assets: [
      {
        asset_class: "demonstration fixture website",
        url: "https://illus-thermavessel.matchbase.internal",
        status: "inspected",
      },
    ],
    offering: {
      product_name: "Maxi-Calor Industrial Electric Water Heater 500L",
      product_family: "Industrial Water Heating Equipment",
      specifications: {
        capacity: "500 Litres",
        working_pressure: "10 bar (test 16 bar)",
        electrical_supply: "Three-Phase 380-415V 50Hz (20kW)",
        outer_diameter: "825 mm (within 85cm constraint)",
        corrosion_protection:
          "Titanium Plus enamel with active cathodic protection",
        warranty: "5-year tank warranty, 2-year heating elements",
        service_support:
          "UAE distributor network with stocked heating elements",
      },
      use_cases: ["Commercial Buildings", "Gyms & Spas", "Food Processing"],
      country_of_origin: "France",
      manufacturing_site: "Lyon Industrial Plant (ISO 9001, CE Certified)",
      customization_support: true,
      private_label: false,
      sample_availability: "available",
      product_evidence_ids: ["ev-wh-spec-01"],
    },
    commercial: {
      price_min: 2300,
      price_max: 2700,
      currency: "USD",
      unit: "unit",
      incoterm: "DDP",
      incoterm_location: "Dubai Site Delivery",
      moq: "1 unit",
      production_capacity: "2,000 units/month",
      lead_time: "10 days from Dubai free-zone stock",
      commercial_confidence: "high",
      price_validity: "2026-11-30",
      commercial_evidence_ids: ["ev-wh-spec-01"],
    },
    packaging_and_logistics: {
      packaging_type: "Heavy corrugated packaging with timber pallet base",
      pack_size: "1 unit",
      storage_conditions: "Dry indoor storage",
      shelf_life: "Indefinite",
      origin_port: "Dubai Logistics City Hub",
      shipping_modes: ["Road freight express"],
      logistics_notes: "Immediate dispatch from Dubai logistics facility",
      logistics_evidence_ids: ["ev-wh-spec-01"],
    },
    certifications: [
      {
        certification_name: "CE Pressure Equipment Directive (PED)",
        issuer: "Bureau Veritas France",
        certificate_number: "BV-PED-2023-9014",
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-wh-ped-01"],
      },
      {
        certification_name: "UAE MoIAT / G-Mark Conformity",
        issuer: "Ministry of Industry and Advanced Technology, UAE",
        certificate_number: "MoIAT-EQ-2024-9104",
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-wh-moiat-01"],
      },
    ],
    assessment: {
      rank: 2,
      compatibility_score: 93,
      fit_band: "Strong Fit",
      evidence_confidence: "high",
      identity_confidence: "high",
      data_completeness: 96,
      dimension_scores: {
        category_product_fit: 96,
        compliance_certification_fit: 95,
        volume_capacity_fit: 93,
        price_tier_fit: 94,
        positioning_brand_fit: 96,
        geographic_reach_fit: 94,
      },
      mandatory_constraint_results: [
        {
          constraint: "500L storage capacity",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "10 bar working pressure",
          satisfied: true,
          evidence_ids: ["ev-wh-ped-01"],
        },
        {
          constraint: "Outer diameter <= 85cm (82.5cm actual)",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "Three-phase electrical 400V",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "CE mark & UAE MoIAT conformity",
          satisfied: true,
          evidence_ids: ["ev-wh-moiat-01", "ev-wh-ped-01"],
        },
        {
          constraint: "DDP Dubai delivery terms",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
      ],
      positive_drivers: [
        "Diameter of 825mm complies with door clearance constraint",
        "Short lead time (10 days) due to regional buffer stock",
      ],
      limiting_gaps: [],
      risk_flags: [],
      unknowns: [],
      required_validation: [
        "Confirm Building Management System (BMS) thermostat interface",
      ],
      recommended_next_action:
        "Request technical data sheet for 20kW electrical configuration",
    },
  },
  {
    supplier_entity_id: "00000000-0000-4000-8000-000000002003",
    candidate_id: "cand-wh-03",
    legal_name: "GulfCalor HVAC Manufacturing LLC [Illustrative]",
    trading_name: "GulfCalor Dubai",
    brand_names: ["GulfCalor"],
    aliases: ["Gulf Calorifier Systems"],
    supplier_type: "manufacturer",
    manufacturer_status: "direct_manufacturer",
    country_of_registration: "United Arab Emirates",
    headquarters_address: "Industrial Area 1, Jebel Ali, Dubai, UAE",
    manufacturing_locations: ["Jebel Ali Industrial Facility, Dubai, UAE"],
    website: "https://illus-gulfcalor.matchbase.internal",
    primary_domain: "illus-gulfcalor.matchbase.internal",
    identity_confidence: "high",
    identity_evidence_ids: ["ev-wh-spec-01"],
    contacts: {
      verification_status: "unverified",
      contact_evidence_ids: ["ev-wh-spec-01"],
    },
    digital_assets: [
      {
        asset_class: "demonstration fixture website",
        url: "https://illus-gulfcalor.matchbase.internal",
        status: "inspected",
      },
    ],
    offering: {
      product_name: "GC-500 Heavy Industrial Commercial Calorifier",
      product_family: "Industrial Water Heating Equipment",
      specifications: {
        capacity: "500 Litres",
        working_pressure: "10 bar",
        electrical_supply: "Three-Phase 400V 50Hz (18kW Incoloy elements)",
        outer_diameter: "840 mm (within 85cm constraint)",
        corrosion_protection:
          "Double magnesium sacrificial anode + enamel lining",
        warranty: "5-year tank warranty, 2-year on-site service",
        service_support:
          "Direct manufacturer factory warranty and 24/7 service in UAE",
      },
      use_cases: ["Commercial Kitchens", "Hotels", "Healthcare Facilities"],
      country_of_origin: "United Arab Emirates",
      manufacturing_site: "Jebel Ali Manufacturing Plant, Dubai",
      customization_support: true,
      private_label: true,
      sample_availability: "available",
      product_evidence_ids: ["ev-wh-spec-01"],
    },
    commercial: {
      price_min: 2200,
      price_max: 2550,
      currency: "USD",
      unit: "unit",
      incoterm: "DDP",
      incoterm_location: "Dubai Contractor Site",
      moq: "1 unit",
      production_capacity: "800 units/month",
      lead_time: "5 days",
      commercial_confidence: "high",
      price_validity: "2026-10-15",
      commercial_evidence_ids: ["ev-wh-spec-01"],
    },
    packaging_and_logistics: {
      packaging_type: "Protective heavy wrap on wooden transport pallet",
      pack_size: "1 unit",
      storage_conditions: "Enclosed warehouse",
      shelf_life: "Indefinite",
      origin_port: "Jebel Ali Plant Gate",
      shipping_modes: ["Direct factory truck"],
      logistics_notes: "Local Dubai delivery within 5 business days",
      logistics_evidence_ids: ["ev-wh-spec-01"],
    },
    certifications: [
      {
        certification_name: "CE Pressure Equipment Directive (PED 2014/68/EU)",
        issuer: "VDE Testing Institute",
        certificate_number: "VDE-PED-40019",
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-wh-ped-01"],
      },
      {
        certification_name: "UAE MoIAT / ECAS Conformity Certificate",
        issuer: "Ministry of Industry and Advanced Technology, UAE",
        certificate_number: "MoIAT-EQ-2024-7741",
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-wh-moiat-01"],
      },
    ],
    assessment: {
      rank: 3,
      compatibility_score: 91,
      fit_band: "Strong Fit",
      evidence_confidence: "high",
      identity_confidence: "high",
      data_completeness: 95,
      dimension_scores: {
        category_product_fit: 95,
        compliance_certification_fit: 97,
        volume_capacity_fit: 90,
        price_tier_fit: 95,
        positioning_brand_fit: 88,
        geographic_reach_fit: 98,
      },
      mandatory_constraint_results: [
        {
          constraint: "500L storage capacity",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "10 bar working pressure",
          satisfied: true,
          evidence_ids: ["ev-wh-ped-01"],
        },
        {
          constraint: "Outer diameter <= 85cm (84cm actual)",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "Three-phase electrical 400V 50Hz",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
        {
          constraint: "CE mark & UAE MoIAT conformity",
          satisfied: true,
          evidence_ids: ["ev-wh-moiat-01", "ev-wh-ped-01"],
        },
        {
          constraint: "DDP Dubai delivery terms",
          satisfied: true,
          evidence_ids: ["ev-wh-spec-01"],
        },
      ],
      positive_drivers: [
        "Direct local UAE manufacturer enables 5-day dispatch to site",
        "840mm outer diameter fits within the strict 850mm door limit",
        "Factory-backed 5-year warranty and on-site service support",
      ],
      limiting_gaps: [],
      risk_flags: [],
      unknowns: [],
      required_validation: [
        "Inspect factory hydrostatic test record for 10-unit batch",
      ],
      recommended_next_action:
        "Schedule factory inspection visit at Jebel Ali facility",
    },
  },
];

export const GOLDEN_SCENARIO_V3_02: ConsultantResearchOutputV3 = {
  schema_version: "consultant-research-output.v3",
  schema_contract_version: 1,
  user_profile_id: "2efd403d-823e-4b3f-9fe8-fe3f800c460e",
  research_run_id: "00000000-0000-4000-8000-000000000402",
  execution_id: "00000000-0000-4000-8000-000000002402",
  classification_id: "00000000-0000-4000-8000-000000003402",
  title: "Commercial Electric Water Heater Discovery (UAE Corridor)",
  subtitle:
    "Truthful Scarcity Demonstration: Exactly 3 Compliant Manufacturers (Target: 20)",
  generated_at: "2026-09-05T12:00:00Z",
  as_of_date: "2026-09-05",
  research_mode: "fixture",
  research_status: "complete",
  primary_classification: {
    classification_id: "00000000-0000-4000-8000-000000003402",
    scheme: "HS",
    code: "8516.10",
    version: "HS 2022",
    jurisdiction: "Global (WCO)",
    level: "6-digit subheading",
    label:
      "Electric instantaneous or storage water heaters and immersion heaters",
    description:
      "Harmonized System tariff code covering commercial storage water heaters, calorifiers, and industrial immersion units.",
    is_primary: true,
    confidence: "high",
    source_url: "https://www.wcoomd.org",
    assigned_at: "2026-09-05T12:00:00Z",
  },
  secondary_classifications: [],
  request_snapshot: {
    primary_query_type: "sourcing",
    secondary_query_types: ["pricing", "product_catalog"],
    intent_scope: "trade_lane",
    business_context: [
      "Commercial facility project in Dubai requiring 500L storage water heaters with strict doorway access limit.",
    ],
    product_category: "Commercial & Industrial HVAC / Water Heating",
    product_name: "Commercial Electric Water Heater 500L (Calorifier)",
    confidence_level_required: "high",
    compliance_sensitive: true,
    pricing_volatile: false,
    product_attributes: {
      capacity: "500 Litres",
      working_pressure: "10 bar (tested >= 15 bar)",
      electrical: "Three-phase 380V-415V 50Hz",
      max_outer_diameter: "<= 85 cm (850 mm)",
      certifications: ["CE", "PED 2014/68/EU", "UAE MoIAT Conformity"],
      destination: "Dubai, United Arab Emirates",
      requested_quantity: "10 units",
      requested_incoterm: "DDP",
      warranty: "5-year tank warranty",
      service_support: "UAE local installation and spare-parts availability",
    },
    normalized_requirements: [
      {
        name: "Approved Order Quantity",
        value: "10 units",
        requirement_level: "mandatory",
      },
      {
        name: "Tank Storage Capacity",
        value: "500 Litres",
        requirement_level: "mandatory",
      },
      {
        name: "Maximum Outer Diameter",
        value: "<= 85 cm",
        requirement_level: "mandatory",
      },
      {
        name: "Operating Pressure",
        value: "10 bar",
        requirement_level: "mandatory",
      },
      {
        name: "Electrical Power",
        value: "Three-phase 400V 50Hz",
        requirement_level: "mandatory",
      },
      {
        name: "Regulatory Compliance",
        value: "CE PED & UAE MoIAT",
        requirement_level: "mandatory",
      },
      {
        name: "Delivery Incoterm",
        value: "DDP Dubai",
        requirement_level: "mandatory",
      },
      {
        name: "Warranty & Service",
        value: "5-year tank warranty + UAE spare parts",
        requirement_level: "mandatory",
      },
    ],
    mandatory_constraints: [
      "Exact quantity: 10 units",
      "500 Litres storage capacity",
      "10 bar working pressure rating",
      "Maximum outer diameter <= 85 cm",
      "CE marking & PED 2014/68/EU certificate",
      "UAE MoIAT conformity",
      "DDP Dubai delivery terms",
      "5-year tank warranty and UAE spare-parts support",
    ],
    preferred_constraints: [
      "Direct manufacturer or regional subsidiary",
      "Delivery lead time <= 14 days",
    ],
    excluded_constraints: [
      "Non-CE certified vessels",
      "Vessels with outer diameter exceeding 850 mm",
    ],
  },
  executive_summary: {
    headline:
      "Truthful Scarcity: Exactly 3 Qualified Manufacturers Satisfy All Technical Constraints",
    direct_answer:
      "Target was up to 20 candidates; exactly 3 legitimate manufacturers were discovered that satisfy the strict 85cm outer diameter limit, 10 bar working pressure, three-phase 400V configuration, and UAE MoIAT/CE conformity. In strict accordance with MatchBASE truthfulness standards, zero filler or hallucinated candidates were added.",
    key_findings: [
      "Target was up to 20 candidates; exactly 3 compliant manufacturers identified.",
      "Strict 85cm diameter envelope constraint excluded numerous standard 900mm+ commercial calorifiers.",
      "All 3 candidates hold active CE PED certificates and provide on-site DDP Dubai logistics.",
      "Request B quantity preserved exactly as 10 units without unapproved expansion.",
    ],
    candidate_count: 3,
    confidence_assessment: "high",
    research_coverage_status: "sufficient",
  },
  target_candidates_count: 20,
  total_candidates_found: 3,
  supplier_candidates: GOLDEN_SCENARIO_V3_02_SUPPLIERS,
  claims: V3_02_CLAIMS,
  evidence_sources: V3_02_EVIDENCE_SOURCES,
  telemetry: {
    lanes_executed: [],
    verification_loops_count: 5,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0.0,
    execution_latency_ms: 220,
    synthesis_model_id: "deterministic-fixture-engine.v3",
    executed_at: "2026-09-05T12:00:00Z",
  },
  report_artifact: {
    artifact_id: "00000000-0000-4000-8000-000000004402",
    artifact_type: "pdf_landscape_report",
    filename: "INNOBASE_MatchBASE_Commercial_Water_Heaters_3_Suppliers.pdf",
    download_url:
      "/api/v1/consultant/reports/00000000-0000-4000-8000-000000000402/pdf",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    generated_at: "2026-09-05T12:00:00Z",
  },
  limitations_and_disclosures: [
    {
      title: "Research Mode Disclosure",
      description:
        "Demonstration dataset — not live market evidence. Illustrative supplier profiles for UAT verification.",
      severity: "info",
    },
    {
      title: "Truthful Scarcity Disclosure",
      description:
        "Exactly 3 verified legal entities met all criteria. MatchBASE policy strictly prohibits fabricating filler candidates to satisfy target caps.",
      severity: "info",
    },
  ],
};

// ============================================================================
// GOLDEN SCENARIO V3-03: No Strong Match Result (0 suppliers, guidance)
// ============================================================================

export const GOLDEN_SCENARIO_V3_03: ConsultantResearchOutputV3 = {
  schema_version: "consultant-research-output.v3",
  schema_contract_version: 1,
  user_profile_id: "2efd403d-823e-4b3f-9fe8-fe3f800c460e",
  research_run_id: "00000000-0000-4000-8000-000000000403",
  execution_id: "00000000-0000-4000-8000-000000002403",
  classification_id: "00000000-0000-4000-8000-000000003403",
  title: "No Strong Match — Commercial Electric Water Heater 500L",
  subtitle:
    "High Constraint Severity Leading to Truthful Zero Match (No Strong Match)",
  generated_at: "2026-09-05T12:00:00Z",
  as_of_date: "2026-09-05",
  research_mode: "fixture",
  research_status: "no_strong_match",
  primary_classification: {
    classification_id: "00000000-0000-4000-8000-000000003403",
    scheme: "HS",
    code: "8516.10",
    version: "HS 2022",
    jurisdiction: "Global (WCO)",
    level: "6-digit subheading",
    label:
      "Electric instantaneous or storage water heaters and immersion heaters",
    description:
      "Harmonized System tariff code covering specialized electric storage water heaters and calorifiers.",
    is_primary: true,
    confidence: "high",
    source_url: "https://www.wcoomd.org",
    assigned_at: "2026-09-05T12:00:00Z",
  },
  secondary_classifications: [],
  request_snapshot: {
    primary_query_type: "sourcing",
    secondary_query_types: ["pricing", "product_catalog"],
    intent_scope: "trade_lane",
    business_context: [
      "Specialized industrial application requesting 500L storage calorifier within an impossible 40cm envelope diameter at 25 bar pressure.",
    ],
    product_category: "Commercial & Industrial HVAC / Water Heating",
    product_name:
      "Commercial Electric Water Heater 500L (Ultra-Narrow 40cm Envelope)",
    confidence_level_required: "high",
    compliance_sensitive: true,
    pricing_volatile: false,
    product_attributes: {
      capacity: "500 Litres",
      max_outer_diameter: "<= 40 cm (400 mm)",
      working_pressure: "25 bar",
      solar_direct: true,
      explosion_proof: "ATEX Zone 0",
    },
    normalized_requirements: [
      {
        name: "Tank Capacity",
        value: "500 Litres",
        requirement_level: "mandatory",
      },
      {
        name: "Envelope Outer Diameter",
        value: "<= 40 cm",
        requirement_level: "mandatory",
      },
      {
        name: "Operating Pressure",
        value: "25 bar",
        requirement_level: "mandatory",
      },
      {
        name: "Hazardous Location",
        value: "ATEX Zone 0",
        requirement_level: "mandatory",
      },
    ],
    mandatory_constraints: [
      "500 Litres tank capacity",
      "Outer diameter strictly <= 40 cm",
      "25 bar operating pressure",
      "ATEX Zone 0 explosion proof electrical rating",
    ],
    preferred_constraints: [],
    excluded_constraints: [],
  },
  executive_summary: {
    headline:
      "Zero Qualified Candidates Found: Severe Physical & Geometric Constraint Incompatibility",
    direct_answer:
      "Deep dual-lane search across global manufacturer registries identified 0 candidates satisfying all mandatory requirements. Geometric analysis indicates a 500-litre cylindrical pressure vessel constrained to a 40cm outer diameter requires an aspect ratio height exceeding 4.2 metres with wall thickness incompatible with 25 bar pressure in standard immersion applications.",
    key_findings: [
      "Zero candidates found meeting simultaneous 500L capacity and 40cm diameter constraint.",
      "Physical constraint conflict: A 500L cylinder of 40cm diameter requires excessive height and non-standard pressure walls.",
      "Constraint relaxation guidance provided below to enable viable candidate discovery.",
    ],
    candidate_count: 0,
    confidence_assessment: "high",
    research_coverage_status: "sufficient",
  },
  target_candidates_count: 20,
  total_candidates_found: 0,
  supplier_candidates: [],
  claims: [],
  evidence_sources: [
    {
      evidence_id: "ev-wh-physics-01",
      source_id: "src-vessel-eng",
      source_url: "https://standards.iteh.ai/catalog/standards/cen/en-12897",
      source_title:
        "EN 12897 Water Supply Specification for Storage Water Heaters",
      publisher: "European Committee for Standardization",
      source_type: "official_registry",
      retrieved_at: "2026-09-05T10:00:00Z",
      freshness_status: "current",
      verification_status: "illustrative",
      excerpt_summary:
        "Geometric and pressure envelope standards for cylindrical calorifiers.",
      supports_claim_ids: [],
      contradicts_claim_ids: [],
    },
  ],
  telemetry: {
    lanes_executed: [],
    verification_loops_count: 5,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0.0,
    execution_latency_ms: 220,
    synthesis_model_id: "deterministic-fixture-engine.v3",
    executed_at: "2026-09-05T12:00:00Z",
  },
  report_artifact: {
    artifact_id: "00000000-0000-4000-8000-000000004403",
    artifact_type: "pdf_landscape_report",
    filename: "INNOBASE_MatchBASE_Water_Heater_Zero_Match.pdf",
    download_url:
      "/api/v1/consultant/reports/00000000-0000-4000-8000-000000000403/pdf",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    generated_at: "2026-09-05T12:00:00Z",
  },
  limitations_and_disclosures: [
    {
      title: "Research Mode Disclosure",
      description:
        "Demonstration dataset — not live market evidence. Zero match outcome testing scenario.",
      severity: "info",
    },
    {
      title: "Constraint Relaxation Guidance",
      description:
        "Zero matches found. To unlock discovery, relax outer envelope dimensions from 40cm to standard 85cm and operating pressure to 10 bar.",
      severity: "critical",
    },
  ],
};

// ============================================================================
// GOLDEN SCENARIO V3-04: Stream Divergence / Partial Result (4 suppliers)
// ============================================================================

export const V3_04_EVIDENCE_SOURCES: readonly EvidenceSourceV3[] = [
  {
    evidence_id: "ev-ro-wqa-01",
    source_id: "src-wqa-registry",
    source_url: "https://www.wqa.org/find-certified-products",
    source_title:
      "Water Quality Association (WQA) Industrial Filtration Certified Directory",
    publisher: "Water Quality Association",
    source_type: "official_registry",
    retrieved_at: "2026-09-05T10:00:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Official registry of industrial reverse osmosis membrane modules and high-recovery desalination systems.",
    supports_claim_ids: ["cl-ro-01"],
    contradicts_claim_ids: [],
  },
  {
    evidence_id: "ev-ro-spec-01",
    source_id: "src-ro-spec",
    source_url: "https://matchbase.internal/fixtures/ro-systems/spec-2026",
    source_title: "Industrial Reverse Osmosis Equipment Standard Data Sheet",
    publisher: "International Desalination Association",
    source_type: "synthetic_fixture",
    retrieved_at: "2026-09-05T10:15:00Z",
    freshness_status: "current",
    verification_status: "illustrative",
    excerpt_summary:
      "Engineering specifications for 50 m3/day brackish water reverse osmosis packaged units.",
    supports_claim_ids: ["cl-ro-02"],
    contradicts_claim_ids: [],
  },
];

export const V3_04_CLAIMS: readonly ClaimV3[] = [
  {
    claim_id: "cl-ro-01",
    claim_type: "compliance",
    claim_text:
      "Industrial reverse osmosis systems meet ASME boiler and pressure vessel code Section X for composite pressure vessels.",
    status: "illustrative",
    confidence: "high",
    conflict_status: "corroborated",
    evidence_ids: ["ev-ro-wqa-01"],
  },
  {
    claim_id: "cl-ro-02",
    claim_type: "product_spec",
    claim_text:
      "Packaged RO units deliver 50 m3/day permeate output with >99.2% salt rejection.",
    status: "illustrative",
    confidence: "medium",
    conflict_status: "corroborated",
    evidence_ids: ["ev-ro-spec-01"],
  },
];

export const GOLDEN_SCENARIO_V3_04_SUPPLIERS: readonly SupplierEntityV3[] = [
  "AquaPure Industrial Systems GmbH [Illustrative]",
  "Hydranautics Process Equipment S.L. [Illustrative]",
  "Oasis Water Technologies Ltd. [Illustrative]",
  "Membrana Filtration Systems S.p.A. [Illustrative]",
].map((name, idx) => {
  const rank = idx + 1;
  const candId = `cand-ro-${String(rank).padStart(2, "0")}`;
  const entityId = `00000000-0000-4000-8000-${String(4000 + rank).padStart(12, "0")}`;
  const domainSlug = `illus-ro-${String(rank).padStart(2, "0")}.matchbase.internal`;
  const brandName = name.split(" ")[0] ?? name;

  return {
    supplier_entity_id: entityId,
    candidate_id: candId,
    legal_name: name,
    trading_name: `${brandName} Water Systems`,
    brand_names: [brandName],
    aliases: [],
    supplier_type: "manufacturer",
    manufacturer_status: "direct_manufacturer",
    country_of_registration:
      idx === 0
        ? "Germany"
        : idx === 1
          ? "Spain"
          : idx === 2
            ? "United Kingdom"
            : "Italy",
    headquarters_address: `Water Processing Industrial Park ${rank * 10}, Europe`,
    manufacturing_locations: [`RO Plant ${rank}, Europe`],
    website: `https://${domainSlug}`,
    primary_domain: domainSlug,
    identity_confidence: "high",
    identity_evidence_ids: ["ev-ro-spec-01"],
    contacts: {
      verification_status: "unverified",
      contact_evidence_ids: ["ev-ro-spec-01"],
    },
    digital_assets: [
      {
        asset_class: "demonstration fixture website",
        url: `https://${domainSlug}`,
        status: "inspected",
      },
    ],
    offering: {
      product_name:
        "Commercial Brackish Water Reverse Osmosis System (50 m3/day)",
      product_family: "Water Filtration & Treatment Machinery",
      specifications: {
        capacity: "50 m3/day (approx. 2,100 L/hour)",
        membrane_type: "High-rejection polyamide thin-film composite (8-inch)",
        salt_rejection: ">99.2%",
        operating_pressure: "14 - 18 bar",
        skid_construction: "316L stainless steel structural frame",
      },
      use_cases: [
        "Industrial Process Water",
        "Agricultural Irrigation",
        "Potable Water Supply",
      ],
      country_of_origin: idx === 0 ? "Germany" : "EU",
      manufacturing_site: `European Assembly Center ${rank}`,
      customization_support: true,
      private_label: false,
      sample_availability: "unavailable",
      product_evidence_ids: ["ev-ro-spec-01"],
    },
    commercial: {
      price_min: 18500,
      price_max: 22000,
      currency: "USD",
      unit: "system",
      incoterm: "CIF",
      incoterm_location: "Jeddah Islamic Port",
      moq: "1 system",
      production_capacity: "30 systems/month",
      lead_time: "45 days",
      commercial_confidence: "medium",
      price_validity: "2026-10-31",
      commercial_evidence_ids: ["ev-ro-spec-01"],
    },
    packaging_and_logistics: {
      packaging_type: "Seaworthy reinforced timber container crating",
      pack_size: "1 packaged skid per 20ft container",
      storage_conditions: "Covered dry storage",
      shelf_life: "Indefinite",
      origin_port: "Port of Hamburg / Genoa",
      shipping_modes: ["Ocean container 20ft"],
      logistics_notes:
        "Shipped fully assembled with pre-plumbed high-pressure manifold",
      logistics_evidence_ids: ["ev-ro-spec-01"],
    },
    certifications: [
      {
        certification_name: "WQA Certified Industrial Water Filtration",
        issuer: "Water Quality Association",
        certificate_number: `WQA-RO-2024-${rank * 100}`,
        status: "active",
        verification_status: "claimed",
        evidence_ids: ["ev-ro-wqa-01"],
      },
    ],
    assessment: {
      rank,
      compatibility_score: 84 - idx * 3,
      fit_band: "Strong Fit",
      evidence_confidence: "medium",
      identity_confidence: "high",
      data_completeness: 92,
      dimension_scores: {
        category_product_fit: 90,
        compliance_certification_fit: 88,
        volume_capacity_fit: 82,
        price_tier_fit: 80,
        positioning_brand_fit: 85,
        geographic_reach_fit: 80,
      },
      mandatory_constraint_results: [
        {
          constraint: "50 m3/day capacity",
          satisfied: true,
          evidence_ids: ["ev-ro-spec-01"],
        },
        {
          constraint: "WQA / ASME Certification",
          satisfied: true,
          evidence_ids: ["ev-ro-wqa-01"],
        },
        {
          constraint: "CIF Jeddah delivery terms",
          satisfied: true,
          evidence_ids: ["ev-ro-spec-01"],
        },
      ],
      positive_drivers: [
        "High salt rejection (>99.2%) and energy-recovery pump configuration",
        "Pre-commissioned modular skid reduces on-site installation time",
      ],
      limiting_gaps: [
        "Stream 2 (OpenAI) timed out before corporate registry cross-referencing completed",
      ],
      risk_flags: ["Partial verification status: lane retry recommended"],
      unknowns: [
        "Local commissioning technician availability in Western Province, KSA",
      ],
      required_validation: [
        "Confirm raw water TDS chemical analysis against membrane limits",
      ],
      recommended_next_action:
        "Execute Stream 2 resumption or proceed with Stream 1 candidate shortlist",
    },
  };
});

export const GOLDEN_SCENARIO_V3_04: ConsultantResearchOutputV3 = {
  schema_version: "consultant-research-output.v3",
  schema_contract_version: 1,
  user_profile_id: "2efd403d-823e-4b3f-9fe8-fe3f800c460e",
  research_run_id: "00000000-0000-4000-8000-000000000404",
  execution_id: "00000000-0000-4000-8000-000000002404",
  classification_id: "00000000-0000-4000-8000-000000003404",
  title:
    "Commercial Reverse Osmosis Water Systems (Stream 1 Complete, Stream 2 Timed Out)",
  subtitle:
    "Transparent Partial Verification Result with Lane Resumption Available",
  generated_at: "2026-09-05T12:00:00Z",
  as_of_date: "2026-09-05",
  research_mode: "fixture",
  research_status: "partial",
  primary_classification: {
    classification_id: "00000000-0000-4000-8000-000000003404",
    scheme: "HS",
    code: "8421.21",
    version: "HS 2022",
    jurisdiction: "Global (WCO)",
    level: "6-digit subheading",
    label: "Filtering or purifying machinery and apparatus for water",
    description:
      "Harmonized System tariff code covering commercial and industrial reverse osmosis water filtration and purification equipment.",
    is_primary: true,
    confidence: "high",
    source_url: "https://www.wcoomd.org",
    assigned_at: "2026-09-05T12:00:00Z",
  },
  secondary_classifications: [],
  request_snapshot: {
    primary_query_type: "sourcing",
    secondary_query_types: ["pricing", "product_catalog"],
    intent_scope: "trade_lane",
    business_context: [
      "Water treatment facility project requiring containerized brackish water reverse osmosis packaged systems for Gulf deployment.",
    ],
    product_category: "Water Treatment & Filtration Equipment",
    product_name:
      "Commercial Reverse Osmosis Water Purification System (50 m3/day)",
    confidence_level_required: "medium",
    compliance_sensitive: true,
    pricing_volatile: false,
    product_attributes: {
      capacity: "50 m3/day",
      membrane: "Polyamide TFC 8-inch",
      destination: "Jeddah Islamic Port, Saudi Arabia",
      requested_quantity: "4 packaged skids",
      requested_incoterm: "CIF",
    },
    normalized_requirements: [
      {
        name: "Equipment Type",
        value: "Packaged Industrial RO System",
        requirement_level: "mandatory",
      },
      {
        name: "Permeate Capacity",
        value: "50 m3/day",
        requirement_level: "mandatory",
      },
      {
        name: "Certification",
        value: "WQA / ASME composite code",
        requirement_level: "mandatory",
      },
      {
        name: "Delivery Terms",
        value: "CIF Jeddah Islamic Port",
        requirement_level: "mandatory",
      },
    ],
    mandatory_constraints: [
      "50 m3/day capacity",
      "WQA / ASME Certification",
      "CIF Jeddah delivery terms",
    ],
    preferred_constraints: [],
    excluded_constraints: [],
  },
  executive_summary: {
    headline:
      "Partial Verification: Stream 1 (Gemini) Discovered 4 Systems; Stream 2 (OpenAI) Timed Out",
    direct_answer:
      "Four candidate manufacturers were corroborated by Research Stream 1. Research Stream 2 encountered an upstream gateway timeout after verification loop 4. In accordance with MatchBASE transparency standards, the result is presented in partial status with immediate retry/resumption enabled.",
    key_findings: [
      "Stream 1 verified 4 manufacturers of 50 m3/day industrial RO systems.",
      "Stream 2 status: timed_out during corporate registry cross-referencing.",
      "User can inspect current 4 candidates or activate stream resumption.",
    ],
    candidate_count: 4,
    confidence_assessment: "medium",
    research_coverage_status: "partial",
  },
  target_candidates_count: 20,
  total_candidates_found: 4,
  supplier_candidates: GOLDEN_SCENARIO_V3_04_SUPPLIERS,
  claims: V3_04_CLAIMS,
  evidence_sources: V3_04_EVIDENCE_SOURCES,
  telemetry: {
    lanes_executed: [],
    verification_loops_count: 5,
    total_input_tokens: 1450,
    total_output_tokens: 3100,
    total_cost_usd: 0.0,
    execution_latency_ms: 220,
    synthesis_model_id: "deterministic-fixture-engine.v3",
    executed_at: "2026-09-05T12:00:00Z",
  },
  report_artifact: {
    artifact_id: "00000000-0000-4000-8000-000000004404",
    artifact_type: "pdf_landscape_report",
    filename: "INNOBASE_MatchBASE_Reverse_Osmosis_Partial_Result.pdf",
    download_url:
      "/api/v1/consultant/reports/00000000-0000-4000-8000-000000000404/pdf",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    generated_at: "2026-09-05T12:00:00Z",
  },
  limitations_and_disclosures: [
    {
      title: "Research Mode Disclosure",
      description:
        "Demonstration dataset — not live market evidence. Partial stream interruption testing scenario.",
      severity: "info",
    },
    {
      title: "Stream 2 Resumption Required",
      description:
        "Partial synthesis. Stream 2 encountered a timeout. Candidates are based on Stream 1 verification only.",
      severity: "advisory",
    },
  ],
};

export const UAE_WATER_HEATER_10_SUPPLIERS = GOLDEN_SCENARIO_V3_02_SUPPLIERS;

export const GOLDEN_SCENARIOS_V3: readonly ConsultantResearchOutputV3[] = [
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
  GOLDEN_SCENARIO_V3_03,
  GOLDEN_SCENARIO_V3_04,
];
