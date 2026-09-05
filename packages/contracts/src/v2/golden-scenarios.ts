import {
  CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
  type ConsultantResearchOutputV2,
} from "./consultant-research-output.js";

export const GOLDEN_SCENARIOS: readonly ConsultantResearchOutputV2[] = [
  // SC-01: sourcing_poultry_brazil
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-01-RES-POULTRY-BR",
    run_id: "00000000-0000-4000-8000-000000000301",
    generated_at: "2026-09-05T10:00:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "trade_lane",
      business_context: ["Poultry supply for GCC wholesale distribution"],
      product_category: "Poultry",
      product_name: "Frozen Whole Chicken Grade A",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: {
        form: "frozen_whole",
        weight_range: "1000g-1200g",
        slaughter_standard: "GSO 993:2015",
      },
      normalized_requirements: [
        {
          name: "Halal Certification",
          value: true,
          requirement_level: "mandatory",
        },
        {
          name: "SFDA Approved Plant",
          value: true,
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: [
        "SFDA clearance active",
        "FAMBRAS or Cibal Halal certification",
      ],
      preferred_constraints: ["Port of Santos or Paranagua direct vessel"],
      excluded_constraints: ["Air-chilled or non-frozen"],
      geographic_scope: "Brazil to Saudi Arabia",
      destination_market: "Saudi Arabia",
    },
    executive_summary: {
      headline:
        "Identified 3 qualified Brazilian poultry producers with SFDA approval and GSO 993 Halal certification",
      direct_answer:
        "Three established Brazilian exporters meet all mandatory export, SFDA registration, and ritual slaughter requirements.",
      key_findings: [
        "BRF S.A. operates 4 SFDA-listed plants with dedicated GCC lines.",
        "Seara Alimentos maintains active SFDA listing with regular reefer liner departures to Jeddah.",
        "Cooperativa Central Aurora holds active FAMBRAS accreditation for plant SIF 3548.",
      ],
      candidate_count: 3,
      confidence_assessment: "high",
      primary_limitation:
        "Reefer spot rates subject to monthly liner adjustment.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Evaluated 18 Brazilian poultry slaughterhouses; 3 meet verified SFDA foreign establishment standards.",
        evaluated_supplier_count: 18,
        qualified_supplier_count: 3,
        shortlisted_candidate_ids: [
          "CAND-SC01-01",
          "CAND-SC01-02",
          "CAND-SC01-03",
        ],
        trade_lane_evaluated:
          "Santos/Paranagua (Brazil) -> Jeddah Islamic Port (Saudi Arabia)",
        key_bottlenecks: [
          "High reefer container booking demand ahead of Ramadan",
        ],
        recommendations_summary:
          "Secure Q4 allocation across BRF and Aurora for risk diversification.",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC01-01",
        entity_id: "ENT-BR-BRF-001",
        legal_name: "BRF S.A.",
        trading_name: "BRF Global Foods",
        brand_names: ["Sadia", "Perdix"],
        country_code: "BR",
        manufacturing_locations: ["BR-PR", "BR-SC"],
        website: "https://www.brf-global.com",
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary:
          "SFDA plant list registered SIF 1030 and FAMBRAS Halal certified.",
        offerings: [
          {
            sku_or_name: "Sadia Frozen Whole Chicken",
            description:
              "Individually poly-bagged, 1000g-1200g, 10 birds/carton.",
            specifications: { weight: "1000-1200g", halal: true },
          },
        ],
        moq: {
          value: 27,
          unit: "TNE",
          description: "1x 40ft High Cube Reefer",
        },
        capacity: { annual_or_monthly: "annual", volume: 300000, unit: "TNE" },
        certifications: [
          {
            certification_name: "GSO 993:2015 Halal Certificate",
            issuer: "FAMBRAS Halal",
            verification_state: "verified",
            valid_until: "2027-12-31",
            evidence_id: "EVD-SC01-01",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          halal_certified: true,
          iso_certifications: ["ISO 22000", "FSSC 22000"],
        },
        shelf_life: { duration_months: 12, storage_condition: "-18C" },
        logistics: {
          supported_incoterms: ["FOB", "CIF"],
          primary_shipping_ports: ["Port of Paranagua", "Port of Santos"],
          cold_chain_guaranteed: true,
          typical_lead_time_days: 35,
        },
        fit_assessment: {
          compatibility_score: 95,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            category_product_fit: 96,
            compliance_certification_fit: 98,
            volume_capacity_fit: 95,
            price_tier_fit: 92,
            positioning_brand_fit: 94,
            geographic_reach_fit: 95,
          },
          positive_drivers: [
            "Direct SFDA listing",
            "Recognized brand presence in KSA retail",
          ],
          limiting_gaps: ["Premium brand pricing"],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA clearance",
              outcome: "pass",
              rationale: "Active on SFDA portal.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: [
          "Inspect bill of lading for certified plant SIF number.",
        ],
        claim_ids: ["CLM-SC01-01"],
        evidence_ids: ["EVD-SC01-01"],
      },
      {
        candidate_id: "CAND-SC01-02",
        entity_id: "ENT-BR-SEARA-001",
        legal_name: "Seara Alimentos Ltda",
        trading_name: "Seara Meats",
        brand_names: ["Seara"],
        country_code: "BR",
        manufacturing_locations: ["BR-SC", "BR-MS"],
        website: "https://www.seara.com.br",
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary:
          "SFDA plant list SIF 2014 active with Cibal Halal clearance.",
        offerings: [
          {
            sku_or_name: "Seara Frozen Griller Chicken",
            description: "Calibrated frozen poultry for GCC foodservice.",
            specifications: { weight: "1100g", halal: true },
          },
        ],
        moq: { value: 27, unit: "TNE", description: "1x 40ft Reefer" },
        capacity: { annual_or_monthly: "annual", volume: 220000, unit: "TNE" },
        certifications: [
          {
            certification_name: "GSO 993:2015 Halal Slaughter",
            issuer: "Cibal Halal",
            verification_state: "verified",
            valid_until: "2027-08-31",
            evidence_id: "EVD-SC01-01",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          halal_certified: true,
          iso_certifications: ["ISO 9001", "BRCGS"],
        },
        shelf_life: { duration_months: 12, storage_condition: "-18C" },
        logistics: {
          supported_incoterms: ["FOB", "CIF"],
          primary_shipping_ports: ["Port of Itajai", "Port of Santos"],
          cold_chain_guaranteed: true,
          typical_lead_time_days: 38,
        },
        fit_assessment: {
          compatibility_score: 93,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            category_product_fit: 94,
            compliance_certification_fit: 96,
            volume_capacity_fit: 92,
            price_tier_fit: 93,
            positioning_brand_fit: 91,
            geographic_reach_fit: 92,
          },
          positive_drivers: [
            "Active SFDA plant listing",
            "Competitive wholesale volume pricing",
          ],
          limiting_gaps: ["Lead times subject to Santos congestion"],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA clearance",
              outcome: "pass",
              rationale: "Listed on SFDA register.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: [
          "Verify Cibal Halal batch certificate upon customs arrival.",
        ],
        claim_ids: ["CLM-SC01-01"],
        evidence_ids: ["EVD-SC01-01"],
      },
      {
        candidate_id: "CAND-SC01-03",
        entity_id: "ENT-BR-AURORA-001",
        legal_name: "Cooperativa Central Aurora Alimentos",
        trading_name: "Aurora Coop",
        brand_names: ["Aurora"],
        country_code: "BR",
        manufacturing_locations: ["BR-SC"],
        website: "https://www.auroraalimentos.com.br",
        supplier_type: "cooperative",
        verification_status: "externally_verified",
        verification_summary:
          "Cooperative slaughterhouse SIF 3548 approved by SFDA.",
        offerings: [
          {
            sku_or_name: "Aurora Frozen Whole Poultry",
            description:
              "High quality cooperative raised chicken, Halal certified.",
            specifications: { weight: "1000-1300g", halal: true },
          },
        ],
        moq: { value: 54, unit: "TNE", description: "2x 40ft Reefers" },
        capacity: { annual_or_monthly: "annual", volume: 150000, unit: "TNE" },
        certifications: [
          {
            certification_name: "Halal Production Certificate",
            issuer: "FAMBRAS Halal",
            verification_state: "verified",
            valid_until: "2027-10-31",
            evidence_id: "EVD-SC01-01",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          halal_certified: true,
          iso_certifications: ["ISO 22000"],
        },
        shelf_life: { duration_months: 12, storage_condition: "-18C" },
        logistics: {
          supported_incoterms: ["FOB"],
          primary_shipping_ports: ["Port of Paranagua"],
          cold_chain_guaranteed: true,
          typical_lead_time_days: 40,
        },
        fit_assessment: {
          compatibility_score: 90,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            category_product_fit: 92,
            compliance_certification_fit: 94,
            volume_capacity_fit: 88,
            price_tier_fit: 91,
            positioning_brand_fit: 85,
            geographic_reach_fit: 90,
          },
          positive_drivers: [
            "Direct farmer-owned cooperative transparency",
            "SFDA verified",
          ],
          limiting_gaps: ["Higher MOQ (54 MT)"],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA clearance",
              outcome: "pass",
              rationale: "Active on register.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: ["Check container pre-cooling certification."],
        claim_ids: ["CLM-SC01-01"],
        evidence_ids: ["EVD-SC01-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC01-01",
        claim_text:
          "Brazilian poultry facilities hold active SFDA import clearance for commercial slaughter.",
        claim_type: "compliance",
        subject_id: "ENT-BR-POULTRY-SECTOR",
        confidence: "high",
        evidence_ids: ["EVD-SC01-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC01-01",
        source_url:
          "https://www.sfda.gov.sa/en/food/establishments/meat-poultry",
        source_title: "SFDA Approved Foreign Establishments - Brazil Poultry",
        publisher: "Saudi Food and Drug Authority",
        source_type: "official_registry",
        published_at: "2026-08-15",
        retrieved_at: "2026-09-05T09:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-SC01-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Official registry of approved slaughterhouses in Brazil authorized for poultry meat exports to the Kingdom.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC01-01",
        title: "Maritime Freight Advisory",
        description: "Transit times subject to Red Sea navigation routing.",
        scope: "commercial_commitment",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Commercial terms require bilateral agreement.",
      recommended_actions: ["Issue RFQ to BRF and Seara for Q4 delivery."],
      questions_to_resolve: ["Confirm availability of 1000g vs 1200g ratio."],
      validation_priorities: [
        "Verify SIF numbers on proforma matches current SFDA list.",
      ],
      human_review_required: false,
    },
  },

  // SC-02: pricing_coffee_ethiopia
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-02-RES-COFFEE-PRICING",
    run_id: "00000000-0000-4000-8000-000000000302",
    generated_at: "2026-09-05T10:15:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "pricing",
      secondary_query_types: [],
      intent_scope: "regional",
      business_context: [
        "Specialty coffee sourcing benchmark for Gulf roasters",
      ],
      product_category: "Coffee",
      product_name: "Ethiopian Green Arabica Yirgacheffe Grade 1",
      confidence_level_required: "high",
      compliance_sensitive: false,
      pricing_volatile: true,
      product_attributes: {
        variety: "Heirloom Arabica",
        process: "Washed",
        grade: "Grade 1",
      },
      normalized_requirements: [
        { name: "Grade", value: "Grade 1", requirement_level: "mandatory" },
        {
          name: "Packaging",
          value: "GrainPro 60kg",
          requirement_level: "preferred",
        },
      ],
      mandatory_constraints: ["FOB Port of Djibouti reference"],
      preferred_constraints: ["Current crop year 2025/2026"],
      excluded_constraints: ["Commercial grade unwashed Djimmah"],
    },
    executive_summary: {
      headline:
        "Ethiopian Yirgacheffe Washed Grade 1 trading in $4.85 - $5.45 / kg FOB Djibouti",
      direct_answer:
        "Specialty washed Yirgacheffe G1 export pricing is firm at $4.85 to $5.45 per kg FOB Djibouti, driven by high auction differentials.",
      key_findings: [
        "ECX auction differentials for Yirgacheffe G1 average +$1.40/lb over ICE Arabica.",
        "60kg GrainPro bag pricing ranges from $291 to $327 FOB.",
        "Currency reforms in Addis Ababa have narrowed the gap between official and parallel FX.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      primary_limitation:
        "Coffee prices track New York ICE 'C' contract intraday movements.",
    },
    result_modules: {
      pricing: {
        overview:
          "Detailed pricing observations for Ethiopian specialty coffee exports via Djibouti corridor.",
        pricing_observations: [
          {
            observation_id: "PRC-SC02-01",
            price_type: "quoted",
            amount_min: 4.85,
            amount_max: 5.2,
            currency: "USD",
            unit: "KGM",
            quantity_basis: "Full Container Load (320 bags of 60kg)",
            trade_basis: "wholesale_bulk",
            incoterm: "FOB",
            location_basis: "Port of Djibouti",
            retrieved_at: "2026-09-05T08:00:00.000Z",
            confidence: "high",
            evidence_ids: ["EVD-SC02-01"],
            notes:
              "Direct exporter spot quotation for washed Yirgacheffe Grade 1",
          },
          {
            observation_id: "PRC-SC02-02",
            price_type: "historical_index",
            amount_min: 291,
            amount_max: 327,
            currency: "USD",
            unit: "PCE",
            quantity_basis: "60kg GrainPro lined jute bag",
            trade_basis: "wholesale_bulk",
            incoterm: "FOB",
            location_basis: "Port of Djibouti",
            retrieved_at: "2026-09-04T16:00:00.000Z",
            confidence: "high",
            evidence_ids: ["EVD-SC02-01"],
            notes: "Per-bag equivalent wholesale valuation",
          },
        ],
        benchmarks: [
          {
            benchmark_name: "ICE Arabica NY C Front Month",
            benchmark_price: 2.18,
            currency: "USD",
            unit: "LBR",
            source: "Intercontinental Exchange (ICE)",
            as_of_date: "2026-09-04",
          },
          {
            benchmark_name: "Yirgacheffe Grade 1 Out-turn FOB Djibouti",
            benchmark_price: 5.05,
            currency: "USD",
            unit: "KGM",
            source: "Ethiopian Coffee & Tea Authority Market Report",
            as_of_date: "2026-09-01",
          },
        ],
        price_factors: [
          "ICE Arabica futures fluctuations",
          "Local auction liquidity in Addis Ababa",
          "Fuel and road transit surcharges to Djibouti border",
        ],
        volatility_rating: "medium",
        volatility_notes:
          "Subject to harvest pace and global macro coffee futures.",
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC02-01",
        source_url:
          "https://www.ecta.gov.et/market-intelligence/weekly-bulletin",
        source_title:
          "Ethiopian Coffee and Tea Authority Export Minimum Registration Price Bulletin",
        publisher: "Ethiopian Coffee and Tea Authority",
        source_type: "official_registry",
        retrieved_at: "2026-09-05T07:30:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Minimum registration price guidelines for washed specialty Arabica Grade 1 origin Yirgacheffe FOB Djibouti.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC02-01",
        title: "Futures Basis Risk",
        description: "Prices fluctuate with New York terminal market ticks.",
        scope: "commercial_commitment",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Coffee market pricing is advisory and non-binding.",
      recommended_actions: [
        "Lock in physical contract differential before fixing terminal futures price.",
      ],
      questions_to_resolve: [
        "Confirm cup score verification (minimum 86 Q-grade score) before shipment.",
      ],
      validation_priorities: ["Request pre-shipment sample (PSS) approval."],
      human_review_required: false,
    },
  },

  // SC-03: recommendation_date_snacks
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-03-RES-DATE-SNACKS",
    run_id: "00000000-0000-4000-8000-000000000303",
    generated_at: "2026-09-05T10:30:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "product_recommendation",
      secondary_query_types: [],
      intent_scope: "regional",
      business_context: [
        "Healthy date-based snack bar reformulation for school retail",
      ],
      product_category: "Snack Foods",
      product_name: "Clean Label Date Energy Bar",
      confidence_level_required: "high",
      compliance_sensitive: false,
      pricing_volatile: false,
      product_attributes: {
        base: "Date paste",
        added_sugar: "Zero added sugar",
        shelf_life: "9 months",
      },
      normalized_requirements: [
        {
          name: "Zero Added Cane Sugar",
          value: true,
          requirement_level: "mandatory",
        },
        {
          name: "Nut Free School Friendly",
          value: true,
          requirement_level: "preferred",
        },
      ],
      mandatory_constraints: [
        "No artificial preservatives",
        "SFDA food labeling compliant",
      ],
      preferred_constraints: ["High dietary fiber > 10%"],
      excluded_constraints: ["Palm oil", "High fructose corn syrup"],
    },
    executive_summary: {
      headline:
        "Recommended 2 formulation profiles: Organic Sukkari Oat Bar and Medjool Chia Energy Bite",
      direct_answer:
        "Two distinct product formulations achieve clean-label compliance with zero added sugar and natural preservative systems.",
      key_findings: [
        "Formulation A uses Sukkari date paste + toasted oats for optimal fiber and school-compliant nut-free profile.",
        "Formulation B utilizes Medjool paste with chia seeds for higher omega-3 and premium positioning.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      primary_limitation:
        "Formulations require shelf-life stability testing in tropical ambient conditions.",
    },
    result_modules: {
      product_recommendation: {
        overview:
          "Formulation analysis and ingredient drop-in evaluations for clean-label date confectionery bars.",
        recommendations: [
          {
            product_id: "REC-FORM-01",
            product_name: "Sukkari-Oat School Safe Energy Bar",
            brand_or_maker: "MatchBASE Product Engineering Formulation",
            category: "Health Bars",
            description:
              "Cold-pressed bar formulation composed of 62% Sukkari date paste, 28% gluten-free rolled oats, and 10% sunflower seed butter.",
            use_case_fit:
              "Primary school retail snack complying with GCC school nutritional guidelines.",
            attributes: {
              date_variety: "Sukkari",
              sugar_content: "Natural fruit sugars only",
              allergen_free: "Nut-free",
              fiber_percent: 11.5,
            },
            functional_equivalency: "direct_drop_in",
            tradeoffs: [
              "Lower glycemic index than Medjool bars",
              "Slightly firmer texture requires dual-screw extrusion",
            ],
            claim_ids: [],
            evidence_ids: ["EVD-SC03-01"],
          },
          {
            product_id: "REC-FORM-02",
            product_name: "Medjool Chia Active Energy Bite",
            brand_or_maker: "MatchBASE Product Engineering Formulation",
            category: "Functional Snacks",
            description:
              "Spherical bite formulation combining 70% Medjool date paste with 15% black chia seeds and 15% desiccated coconut.",
            use_case_fit:
              "Adult fitness and on-the-go clean nutrition segment.",
            attributes: {
              date_variety: "Medjool",
              added_sugar: "Zero",
              omega_3_rich: true,
              water_activity: 0.58,
            },
            functional_equivalency: "adaptive_substitute",
            tradeoffs: [
              "Higher raw material ingredient cost",
              "Requires nitrogen-flushed flow-wrap to prevent coconut lipid oxidation",
            ],
            claim_ids: [],
            evidence_ids: ["EVD-SC03-01"],
          },
        ],
        selection_criteria: [
          "Water activity (Aw) below 0.62 for ambient microbial stability",
          "Zero added sugar label claim substantiation",
          "Production compatibility with standard horizontal flow-wrappers",
        ],
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC03-01",
        source_url:
          "https://www.sfda.gov.sa/en/regulations/food-technical-regulations",
        source_title:
          "SFDA Technical Regulation SFDA.FD 2233: Requirements for Nutritional Labeling",
        publisher: "Saudi Food and Drug Authority",
        source_type: "regulatory_body",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Regulatory mandates regarding clean label declarations and 'no added sugar' claims on date products.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC03-01",
        title: "Microbial Water Activity Boundary",
        description:
          "Exact Aw depends on date paste moisture batch consistency (must remain < 0.60).",
        scope: "data_freshness",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Formulation advice should be validated through pilot batch trials.",
      recommended_actions: [
        "Conduct 30-day accelerated shelf-life trial at 35°C / 75% RH.",
      ],
      questions_to_resolve: [
        "Confirm pasteurization parameters for date paste supplier.",
      ],
      validation_priorities: [
        "Verify sensory profile and water activity in pilot extruders.",
      ],
      human_review_required: false,
    },
  },

  // SC-04: catalog_hydrocolloids
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-04-RES-HYDROCOLLOIDS",
    run_id: "00000000-0000-4000-8000-000000000304",
    generated_at: "2026-09-05T10:45:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "product_catalog",
      secondary_query_types: [],
      intent_scope: "global",
      business_context: [
        "Stabilizer ingredient procurement for dairy beverage plant",
      ],
      product_category: "Food Additives",
      product_name: "Pectin and Gellan Gum Food Grade",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: {
        application: "Acidified dairy drinks",
        solubility: "Cold and hot water dispersible",
      },
      normalized_requirements: [
        { name: "FCC Food Grade", value: true, requirement_level: "mandatory" },
        { name: "Halal & Kosher", value: true, requirement_level: "mandatory" },
      ],
      mandatory_constraints: ["Meets Food Chemicals Codex (FCC) purity"],
      preferred_constraints: ["Standard 25kg bag packaging"],
      excluded_constraints: ["Technical non-food grades"],
    },
    executive_summary: {
      headline:
        "Catalog line-card of 3 commercial hydrocolloid stabilizers from CP Kelco",
      direct_answer:
        "Verified portfolio of food-grade pectins and gellan gum available for dairy and beverage stabilization.",
      key_findings: [
        "GENU Pectin LM-104 AS provides high protein stabilization under low pH conditions.",
        "KELCOGEL F Gellan Gum creates fluid gel suspension with minimal viscosity increase.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      primary_limitation:
        "Commercial lead times vary by production campaign cycle.",
    },
    result_modules: {
      product_catalog: {
        catalog_id: "CAT-CPK-2026",
        supplier_entity_id: "ENT-CP-KELCO-001",
        supplier_name: "CP Kelco ApS",
        catalog_name: "Specialty Hydrocolloids & Stabilizer Portfolio",
        as_of_date: "2026-08-01",
        product_lines: [
          {
            line_id: "LIN-PECT-01",
            product_family: "Pectin",
            sku_or_model: "GENU Pectin LM-104 AS-FS",
            variant_name: "Low Methoxyl Amidated Citrus Pectin",
            specifications: {
              calcium_reactivity: "Medium-High",
              mesh_size: "60 mesh",
              purity: "FCC / JECFA compliant",
            },
            certifications_held: [
              "Halal (IFANCA)",
              "Kosher (OU)",
              "FSSC 22000",
            ],
            packaging: "25 kg multi-wall paper bag with polyethylene liner",
            moq: "500 kg (20 bags)",
            availability: "in_production",
            pricing_reference: "Indicative $18.50 / kg EXW",
            evidence_ids: ["EVD-SC04-01"],
          },
          {
            line_id: "LIN-GELL-01",
            product_family: "Gellan Gum",
            sku_or_model: "KELCOGEL F",
            variant_name: "Low Acyl Clarified Gellan Gum",
            specifications: {
              gel_strength: "Firm and brittle",
              transparency: "High clarity",
              dosage: "0.025% - 0.05%",
            },
            certifications_held: ["Halal", "Kosher", "ISO 9001"],
            packaging: "25 kg carton with inner bag",
            moq: "250 kg (10 cartons)",
            availability: "in_production",
            pricing_reference: "Indicative $42.00 / kg EXW",
            evidence_ids: ["EVD-SC04-01"],
          },
          {
            line_id: "LIN-PECT-02",
            product_family: "Pectin",
            sku_or_model: "GENU Pectin YM-115 H",
            variant_name: "High Methoxyl Citrus Pectin",
            specifications: {
              esterification_degree: "72%",
              ph_stability: "3.5 - 4.2",
            },
            certifications_held: ["Halal", "Kosher", "ISO 22000"],
            packaging: "25 kg bag",
            moq: "500 kg",
            availability: "made_to_order",
            pricing_reference: "Indicative $16.80 / kg EXW",
            evidence_ids: ["EVD-SC04-01"],
          },
        ],
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC04-01",
        source_url: "https://www.cpkelco.com/products/hydrocolloids-catalog",
        source_title: "CP Kelco Technical Data Sheets & Product Catalog",
        publisher: "CP Kelco",
        source_type: "manufacturer_portal",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Official specification sheets and commercial catalog entries for GENU Pectin and KELCOGEL Gellan Gum series.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC04-01",
        title: "Technical Application Specificity",
        description:
          "Dosage rates require lab dissolution verification in customer beverage base.",
        scope: "search_coverage",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Catalog data provided for technical screening.",
      recommended_actions: [
        "Request 1kg evaluation samples from authorized distributor.",
      ],
      questions_to_resolve: [
        "Confirm batch shear rate requirements during beverage homogenization.",
      ],
      validation_priorities: [
        "Verify kosher/halal certificates current validity year.",
      ],
      human_review_required: false,
    },
  },

  // SC-05: market_poultry_gcc
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-05-RES-MARKET-GCC",
    run_id: "00000000-0000-4000-8000-000000000305",
    generated_at: "2026-09-05T11:00:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "market_overview",
      secondary_query_types: [],
      intent_scope: "regional",
      business_context: [
        "GCC poultry market supply chain vulnerability assessment",
      ],
      product_category: "Poultry",
      product_name: "Broiler Meat and Poultry Cuts",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: { region: "GCC", segment: "Imported vs Domestic" },
      normalized_requirements: [],
      mandatory_constraints: [],
      preferred_constraints: [],
      excluded_constraints: [],
      geographic_scope: "Gulf Cooperation Council",
      destination_market: "GCC",
    },
    executive_summary: {
      headline:
        "GCC poultry market represents $3.2B demand with 62% import reliance led by Brazil",
      direct_answer:
        "The Gulf poultry sector remains heavily reliant on Brazilian imports (approx. 70% of import volume), while domestic capacity expansion targets 80% self-sufficiency in KSA by 2030.",
      key_findings: [
        "Saudi Arabia consumes approx. 1.5M MT annually; domestic production covers 68%.",
        "Brazil remains dominant import origin due to cost leadership and dedicated Halal infrastructure.",
        "GCC unified customs tariff on frozen poultry stands at 5%, with KSA applying standard rate.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      primary_limitation:
        "Import statistics aggregate whole birds and boneless parts.",
    },
    result_modules: {
      market_overview: {
        market_scope: "GCC Poultry Import and Domestic Supply Sector",
        as_of_date: "2026-08-01",
        supply_concentration: "moderately_concentrated",
        supply_structure_summary:
          "Comprehensive macroeconomic and trade-flow overview of poultry supply across Saudi Arabia, UAE, Kuwait, and Qatar.",
        demand_signals: [
          "Rapid domestic producer expansion funded by Saudi Agricultural Development Fund (ADF)",
          "Rising retail preference for fresh domestic poultry over frozen imports in urban centers",
        ],
        regulatory_context: [
          "Strict GSO 993 Halal enforcement and bilateral food authority audit protocols (SFDA, UAE MOIAT)",
        ],
        trade_flows: [
          {
            origin_country: "Brazil",
            destination_country: "Saudi Arabia",
            volume_description: "640,000 MT annually ($1,350M value)",
            trend: "stable",
          },
          {
            origin_country: "Ukraine",
            destination_country: "UAE",
            volume_description: "110,000 MT annually ($240M value)",
            trend: "growing",
          },
        ],
        key_risks: [
          "Feed grain import vulnerability due to reliance on Black Sea and South American corn and soymeal",
        ],
        market_opportunities: [
          "Domestic self-sufficiency targets creating investment in local broiler farming",
        ],
        limitations: [
          "Trade statistics aggregate whole birds and boneless parts",
        ],
        evidence_ids: ["EVD-SC05-01"],
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC05-01",
        source_url:
          "https://www.fas.usda.gov/data/saudi-arabia-poultry-and-products-annual",
        source_title:
          "USDA Foreign Agricultural Service GAIN Report - Saudi Arabia Poultry Annual",
        publisher: "USDA Foreign Agricultural Service",
        source_type: "industry_report",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Official production, supply, and distribution metrics for poultry meat in the Gulf region.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC05-01",
        title: "Macro Aggregation Notice",
        description:
          "Trade figures reflect officially customs-cleared aggregate imports.",
        scope: "search_coverage",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Market research is advisory only.",
      recommended_actions: [
        "Incorporate domestic fresh poultry suppliers into procurement mix.",
      ],
      questions_to_resolve: [
        "Monitor potential bilateral tariff adjustments on poultry imports.",
      ],
      validation_priorities: [
        "Track quarterly SFDA approved facility inspection updates.",
      ],
      human_review_required: false,
    },
  },

  // SC-06: general_halal_poultry
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-06-RES-GENERAL-HALAL",
    run_id: "00000000-0000-4000-8000-000000000306",
    generated_at: "2026-09-05T11:15:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "general_info",
      secondary_query_types: [],
      intent_scope: "regional",
      business_context: [
        "Regulatory research on Halal slaughter requirements for KSA import clearance",
      ],
      product_category: "Regulatory Standards",
      product_name: "SFDA and GSO 993 Halal Poultry Import Procedures",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: { standard: "GSO 993:2015", authority: "SFDA" },
      normalized_requirements: [],
      mandatory_constraints: [],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Step-by-step regulatory guidance for Halal poultry export and SFDA clearance",
      direct_answer:
        "Exporting poultry to Saudi Arabia requires four mandatory compliance gates: slaughterhouse foreign facility listing, approved Islamic center certification, batch certificate issuance, and destination port clearance.",
      key_findings: [
        "Stunning restrictions apply strictly under GSO 993 (electric water-bath parameters tightly controlled).",
        "SFDA only accepts Halal certificates issued by foreign Islamic centers officially accredited on its portal.",
        "Zero vendor cards displayed for general regulatory and process information requests.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      primary_limitation:
        "Procedures are subject to regulatory updates issued by SFDA food circulars.",
    },
    result_modules: {
      general_info: {
        topic_title: "SFDA and GSO 993 Halal Poultry Import Procedures",
        topic_summary:
          "Operational and compliance roadmap for procuring and clearing Halal poultry into Saudi Arabia.",
        key_definitions: [
          {
            term: "GSO 993",
            definition:
              "Gulf Technical Regulation defining mandatory animal ritual slaughtering requirements according to Islamic law.",
          },
          {
            term: "Foreign Establishment Listing",
            definition:
              "Official SFDA register of approved overseas slaughterhouses authorized for export to the Kingdom.",
          },
        ],
        regulatory_standards: [
          {
            standard_code: "GSO 993:2015",
            title:
              "Animal Slaughtering Requirements According to Islamic Rules",
            issuing_body: "GCC Standardization Organization",
            summary:
              "Prescribes ritual cutting, slaughterer qualification, and electric water-bath parameters.",
          },
          {
            standard_code: "SFDA.FD/GSO 2055-1:2015",
            title: "Halal Food - Part 1: General Requirements",
            issuing_body: "Saudi Food and Drug Authority",
            summary:
              "General requirements for Halal food products throughout the supply chain.",
          },
        ],
        procedural_guidance: [
          "Step 1: Verify Foreign Establishment Registration on the SFDA Approved Establishments portal.",
          "Step 2: Engage an SFDA-accredited Islamic certification body (e.g. FAMBRAS or Cibal in Brazil).",
          "Step 3: Secure government sanitary certificate and companion Halal slaughter certificate for each shipment.",
          "Step 4: Clear goods through FASAH system and submit to physical port inspection and Salmonella testing.",
        ],
        frequently_encountered_pitfalls: [
          "Using a Halal certification body that has lost SFDA accreditation",
          "Mismatched plant SIF numbers between veterinary health certificates and shipping cartons",
          "Temperature logs showing cold chain breach above -15°C during transit",
        ],
        sources_consulted: [
          "SFDA Official Guide for the Control of Imported Halal Food Products",
          "GSO 993:2015 Standards Catalog",
        ],
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC06-01",
        source_url: "https://www.sfda.gov.sa/en/regulations/halal-procedures",
        source_title:
          "SFDA Official Guide for the Control of Imported Halal Food Products",
        publisher: "Saudi Food and Drug Authority",
        source_type: "official_registry",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Mandatory conditions for accreditation of foreign Halal certification bodies and slaughter compliance.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC06-01",
        title: "Regulatory Dynamic Notice",
        description:
          "Check SFDA live circular portal prior to commercial shipment departure.",
        scope: "legal_compliance",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Regulatory guidance is informational and does not replace official legal counsel.",
      recommended_actions: [
        "Verify current status of Islamic center on SFDA accreditation list.",
      ],
      questions_to_resolve: [
        "Confirm whether electrical water bath stunning parameters match latest SFDA circular.",
      ],
      validation_priorities: [
        "Audit certificate template against SFDA required specimen.",
      ],
      human_review_required: false,
    },
  },

  // SC-07: compliance_poultry_saudi
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-07-RES-COMPLIANCE-GATE",
    run_id: "00000000-0000-4000-8000-000000000307",
    generated_at: "2026-09-05T11:30:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "trade_lane",
      business_context: [
        "Procurement compliance audit with strict SFDA export clearance gate",
      ],
      product_category: "Poultry",
      product_name: "Halal Frozen Chicken",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: { regulatory_gate: "SFDA Registration Mandatory" },
      normalized_requirements: [
        {
          name: "SFDA Registered Plant",
          value: true,
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: ["SFDA active foreign establishment listing"],
      preferred_constraints: [],
      excluded_constraints: ["Facilities with expired or suspended status"],
    },
    executive_summary: {
      headline:
        "Evaluated 5 candidates: 2 passed strict SFDA gate, 3 excluded due to lack of clearance",
      direct_answer:
        "Two verified Brazilian processors hold active SFDA establishment authorization. Non-registered suppliers were decisively eliminated at the compliance gate.",
      key_findings: [
        "BRF Toledo (SIF 1030) and Aurora Chapeco (SIF 3548) confirmed active.",
        "Three alternative suppliers excluded due to absent or unverified SFDA registry records.",
      ],
      candidate_count: 2,
      confidence_assessment: "high",
      primary_limitation:
        "Facility clearance valid only for specifically registered establishment numbers.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Strict regulatory filter applied; only active SFDA-cleared establishments admitted.",
        evaluated_supplier_count: 5,
        qualified_supplier_count: 2,
        shortlisted_candidate_ids: ["CAND-SC07-01", "CAND-SC07-02"],
        key_bottlenecks: [
          "High exclusion rate (60%) due to unaccredited slaughterhouses",
        ],
        recommendations_summary:
          "Do not execute purchase orders without verifying the SIF number printed on outer master cartons.",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC07-01",
        entity_id: "ENT-BR-BRF-001",
        legal_name: "BRF S.A.",
        brand_names: ["Sadia"],
        country_code: "BR",
        manufacturing_locations: ["BR-PR"],
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary: "SFDA plant registry active under SIF 1030.",
        offerings: [
          {
            sku_or_name: "Sadia Whole Bird",
            description: "Grade A Halal poultry",
            specifications: {},
          },
        ],
        moq: { value: 27, unit: "TNE", description: "1 reefer" },
        capacity: { annual_or_monthly: "annual", volume: 300000, unit: "TNE" },
        certifications: [],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          iso_certifications: [],
        },
        logistics: {
          supported_incoterms: ["CIF"],
          primary_shipping_ports: ["Santos"],
        },
        fit_assessment: {
          compatibility_score: 96,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 100,
            category_product_fit: 95,
          },
          positive_drivers: [
            "Full SFDA compliance verified against official database",
          ],
          limiting_gaps: [],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA active registration",
              outcome: "pass",
              rationale: "Confirmed on live portal.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: ["Inspect health certificate."],
        claim_ids: ["CLM-SC07-01"],
        evidence_ids: ["EVD-SC07-01"],
      },
      {
        candidate_id: "CAND-SC07-02",
        entity_id: "ENT-BR-AURORA-001",
        legal_name: "Cooperativa Central Aurora Alimentos",
        brand_names: ["Aurora"],
        country_code: "BR",
        manufacturing_locations: ["BR-SC"],
        supplier_type: "cooperative",
        verification_status: "externally_verified",
        verification_summary: "SFDA plant registry active under SIF 3548.",
        offerings: [
          {
            sku_or_name: "Aurora Whole Bird",
            description: "Grade A cooperative poultry",
            specifications: {},
          },
        ],
        moq: { value: 54, unit: "TNE", description: "2 reefers" },
        capacity: { annual_or_monthly: "annual", volume: 150000, unit: "TNE" },
        certifications: [],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          iso_certifications: [],
        },
        logistics: {
          supported_incoterms: ["FOB"],
          primary_shipping_ports: ["Paranagua"],
        },
        fit_assessment: {
          compatibility_score: 91,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 98,
            category_product_fit: 90,
          },
          positive_drivers: ["Active SFDA listing verified"],
          limiting_gaps: ["Higher MOQ requirement"],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA active registration",
              outcome: "pass",
              rationale: "Confirmed on live portal.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: ["Verify SIF 3548 stamp on export documents."],
        claim_ids: ["CLM-SC07-01"],
        evidence_ids: ["EVD-SC07-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC07-01",
        claim_text:
          "Target slaughterhouses hold validated SFDA foreign establishment permits.",
        claim_type: "compliance",
        subject_id: "ENT-BR-SFDA-COMPLIANT",
        confidence: "high",
        evidence_ids: ["EVD-SC07-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC07-01",
        source_url: "https://www.sfda.gov.sa/en/food/establishments",
        source_title: "SFDA Approved Foreign Establishments Register",
        publisher: "Saudi Food and Drug Authority",
        source_type: "official_registry",
        retrieved_at: "2026-09-05T09:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-SC07-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Official list of Brazilian facilities approved for meat and poultry import into the Kingdom.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Regulatory gate verified against public registers.",
      recommended_actions: [
        "Issue bilateral purchase inquiries to BRF and Aurora.",
      ],
      questions_to_resolve: ["Confirm allocation capacity for Q4."],
      validation_priorities: [
        "Check certificate validity through port health desk.",
      ],
      human_review_required: false,
    },
  },

  // SC-08: pricing_coffee_volatile
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-08-RES-COFFEE-VOLATILE",
    run_id: "00000000-0000-4000-8000-000000000308",
    generated_at: "2026-09-05T11:45:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "pricing",
      secondary_query_types: [],
      intent_scope: "global",
      business_context: [
        "Spot procurement benchmark under acute market volatility",
      ],
      product_category: "Coffee",
      product_name: "Robusta Green Coffee Beans Screen 18",
      confidence_level_required: "medium",
      compliance_sensitive: false,
      pricing_volatile: true,
      product_attributes: { origin: "Vietnam", grade: "Grade 1 Wet Polished" },
      normalized_requirements: [],
      mandatory_constraints: ["FOB Port of Ho Chi Minh"],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Vietnam Robusta trading at historic high of $4,850 - $5,120 / MT with High Volatility Warning",
      direct_answer:
        "Vietnam Robusta Screen 18 prices are experiencing extreme volatility driven by domestic supply hoarding and global terminal market tightness.",
      key_findings: [
        "London ICE Robusta futures trading above $4,900/MT.",
        "Spot physical differential is +$250/MT over London futures.",
        "Price validity is strictly limited to 24 hours.",
      ],
      candidate_count: 0,
      confidence_assessment: "medium",
      primary_limitation:
        "High market volatility rating: spot quotes expire within 24 to 48 hours.",
    },
    result_modules: {
      pricing: {
        overview:
          "Robusta spot price benchmark under acute supply deficit conditions.",
        pricing_observations: [
          {
            observation_id: "PRC-SC08-01",
            price_type: "quoted",
            amount_min: 4850,
            amount_max: 5120,
            currency: "USD",
            unit: "TNE",
            quantity_basis: "20 MT per 20ft container",
            trade_basis: "wholesale_bulk",
            incoterm: "FOB",
            location_basis: "Ho Chi Minh Port, Vietnam",
            valid_from: "2026-09-05T00:00:00.000Z",
            valid_until: "2026-09-06T23:59:59.000Z",
            retrieved_at: "2026-09-05T09:00:00.000Z",
            confidence: "medium",
            evidence_ids: ["EVD-SC08-01"],
            notes: "Spot quotation subject to 24-hour validity window",
          },
        ],
        benchmarks: [
          {
            benchmark_name: "ICE London Robusta Prompt Month",
            benchmark_price: 4920,
            currency: "USD",
            unit: "TNE",
            source: "Intercontinental Exchange London",
            as_of_date: "2026-09-05",
          },
        ],
        price_factors: [
          "Severe Central Highlands drought reducing crop yield estimates",
          "Farmer withholding stocks anticipating further futures gains",
          "European Union Deforestation Regulation (EUDR) compliance premiums",
        ],
        volatility_rating: "high",
        volatility_notes:
          "Quotes must be reconfirmed intraday before issuing purchase orders.",
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC08-01",
        source_url: "https://www.vicofa.org.vn/market-news",
        source_title: "Vietnam Coffee Cocoa Association Weekly Price Monitor",
        publisher: "VICOFA",
        source_type: "industry_report",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Daily spot coffee pricing bulletin showing historic high Robusta physical quotations FOB Ho Chi Minh.",
      },
    ],
    unknowns: [
      {
        field_or_topic: "eu_eudr_enforcement_date",
        reason:
          "Potential EU regulatory timeline adjustments could trigger sudden price correction.",
        impact: "degrading",
        recommended_validation: "Monitor European Commission trade statements.",
      },
    ],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC08-01",
        title: "Intraday Volatility Boundary",
        description:
          "Prices cannot be fixed without immediate simultaneous terminal hedge execution.",
        scope: "commercial_commitment",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Volatile commodities require strict risk management controls.",
      recommended_actions: [
        "Avoid unhedged open price purchases; request firm 24h validity window.",
      ],
      questions_to_resolve: [
        "Confirm whether exporter has physical inventory in port warehouse.",
      ],
      validation_priorities: ["Verify warehouse receipt authenticity."],
      human_review_required: true,
    },
  },

  // SC-09: high_score_low_confidence
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-09-RES-HIGH-SCORE-LOW-CONF",
    run_id: "00000000-0000-4000-8000-000000000309",
    generated_at: "2026-09-05T12:00:00.000Z",
    research_mode: "hybrid",
    research_status: "partial",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "global",
      business_context: ["Precision titanium alloy forging sourcing"],
      product_category: "Specialty Metals",
      product_name: "Inconel 718 / Titanium Grade 5 Flanges",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: { alloy: "Ti-6Al-4V", standard: "ASTM B381" },
      normalized_requirements: [
        {
          name: "ASTM B381 Certification",
          value: true,
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: ["Aerospace ultrasonic testing clearance"],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Supplier demonstrates high technical fit (Score 92) but Low Evidence Confidence",
      direct_answer:
        "Shaanxi AeroMetals claims exact capability matching ASTM B381 requirements, but evidence is derived solely from self-reported directory listings without independent audit backing.",
      key_findings: [
        "Compatibility score: 92/100 based on self-declared product catalog specifications.",
        "Evidence confidence: LOW — no third-party mill test certificates or accredited registry entries found.",
        "Explicit caution banner: physical factory inspection strictly required before issuing RFQ.",
      ],
      candidate_count: 1,
      confidence_assessment: "low",
      primary_limitation:
        "Self-reported claims require on-site third-party quality audit.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Single candidate located; claims technical suitability but lacks external verification.",
        evaluated_supplier_count: 8,
        qualified_supplier_count: 1,
        shortlisted_candidate_ids: ["CAND-SC09-01"],
        key_bottlenecks: [
          "Lack of publicly verifiable aerospace test data for Chinese private forge mills",
        ],
        recommendations_summary:
          "Commission an independent SGS/TUV technical audit before commercial commitment.",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC09-01",
        entity_id: "ENT-CN-AEROMETAL-001",
        legal_name: "Shaanxi AeroMetals Forging Technology Co., Ltd.",
        brand_names: ["AeroMetals"],
        country_code: "CN",
        manufacturing_locations: ["CN-61"],
        website: "https://www.aerometals-fake-example.invalid",
        supplier_type: "manufacturer",
        verification_status: "supplier_claimed",
        verification_summary:
          "Capabilities self-reported on trade portal; zero third-party audit reports available.",
        offerings: [
          {
            sku_or_name: "Ti-6Al-4V Forged Ring Flange",
            description:
              "High-temperature titanium alloy flange, claimed ASTM B381 compliance.",
            specifications: {
              alloy: "Ti-6Al-4V",
              testing: "Self-certified ultrasonic",
            },
          },
        ],
        moq: { value: 500, unit: "KGM", description: "Batch minimum" },
        capacity: { annual_or_monthly: "annual", volume: 1200, unit: "TNE" },
        certifications: [
          {
            certification_name: "ISO 9001:2015",
            issuer: "Local Registrar",
            verification_state: "claimed",
          },
        ],
        compliance: {
          regulatory_clearance_status: "unknown",
          iso_certifications: ["ISO 9001 (Claimed)"],
        },
        logistics: {
          supported_incoterms: ["FOB"],
          primary_shipping_ports: ["Shanghai"],
        },
        fit_assessment: {
          compatibility_score: 92,
          fit_band: "strong",
          evidence_confidence: "low",
          dimension_scores: {
            category_product_fit: 94,
            compliance_certification_fit: 70,
            volume_capacity_fit: 90,
            price_tier_fit: 95,
            positioning_brand_fit: 88,
            geographic_reach_fit: 85,
          },
          positive_drivers: [
            "Exact dimensional and alloy capability claimed in sales catalog",
          ],
          limiting_gaps: [
            "No independent laboratory mill test reports (MTR) provided",
          ],
          risk_flags: ["UNVERIFIED_AEROSPACE_SPEC", "SELF_CLAIMED_CAPACITY"],
          mandatory_constraint_results: [
            {
              constraint_name: "Aerospace ultrasonic clearance",
              outcome: "unverifiable",
              rationale:
                "Claimed by supplier but not backed by third-party NDT certificate.",
            },
          ],
          human_review_required: true,
        },
        risks: [
          "Material defect or alloy inclusion risk due to uncertified vacuum arc remelting",
        ],
        required_validation: [
          "Commission third-party inspector (SGS/Bureau Veritas) to draw chemical and mechanical samples.",
        ],
        claim_ids: ["CLM-SC09-01"],
        evidence_ids: ["EVD-SC09-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC09-01",
        claim_text:
          "Shaanxi AeroMetals operates a 3,000-ton hydraulic forging press capable of ASTM B381 tolerances.",
        claim_type: "capability",
        subject_id: "ENT-CN-AEROMETAL-001",
        confidence: "low",
        evidence_ids: ["EVD-SC09-01"],
        conflict_status: "single_source",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC09-01",
        source_url:
          "https://www.directory-trade-example.invalid/profile/aerometals",
        source_title: "Commercial B2B Directory Profile - Shaanxi AeroMetals",
        publisher: "B2B Trade Directory",
        source_type: "trade_directory",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "unverified",
        freshness_status: "aging",
        supports_claim_ids: ["CLM-SC09-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Self-submitted supplier profile claiming titanium forging production line with 1,200 MT annual capacity.",
      },
    ],
    unknowns: [
      {
        field_or_topic: "actual_melt_source_traceability",
        reason:
          "Supplier has not disclosed origin of titanium sponge raw material.",
        impact: "blocking",
        recommended_validation:
          "Demand original sponge melt heatsheet certificates.",
      },
    ],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC09-01",
        title: "Uncorroborated Evidence Boundary",
        description:
          "Candidate scored purely on self-reported declarations without independent audit corroboration.",
        scope: "search_coverage",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. CAUTION: High compatibility score decoupled from low evidence confidence.",
      recommended_actions: [
        "Do not commit financial deposit prior to physical factory audit.",
      ],
      questions_to_resolve: [
        "Request EN 10204 3.1 or 3.2 mill test certificates from recent production batch.",
      ],
      validation_priorities: [
        "Conduct witnessed ultrasonic testing on sample coupons.",
      ],
      human_review_required: true,
    },
  },

  // SC-10: no_strong_match_heater
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-10-RES-NO-MATCH-HEATER",
    run_id: "00000000-0000-4000-8000-000000000310",
    generated_at: "2026-09-05T12:15:00.000Z",
    research_mode: "hybrid",
    research_status: "no_strong_match",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "regional",
      business_context: [
        "Hotel renovation with severely restricted architectural utility shaft",
      ],
      product_category: "Water Heating",
      product_name: "Commercial Electric Storage Water Heater 500L",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: {
        capacity: "500 Liters",
        diameter: "Max 40 cm",
        mounting: "Vertical",
      },
      normalized_requirements: [
        {
          name: "Storage Capacity",
          value: 500,
          unit: "L",
          requirement_level: "mandatory",
        },
        {
          name: "Maximum Outer Diameter",
          value: 40,
          unit: "cm",
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: [
        "Capacity >= 500L",
        "Outer diameter <= 40cm including thermal insulation",
      ],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Zero responsible candidates: Physical geometry conflict between 500L volume and 40cm diameter",
      direct_answer:
        "No commercial or industrial manufacturer produces a 500-liter storage cylinder with an outer diameter under 40 cm due to physical aspect ratio and thermal insulation constraints.",
      key_findings: [
        "Evaluated 22 global commercial water heater manufacturers (A.O. Smith, Rheem, Ariston, Stiebel Eltron).",
        "Standard 500L commercial cylinders require outer diameter of 70 cm to 85 cm including insulation.",
        "A 40cm cylinder with 500L capacity would require an impractical height exceeding 4.2 meters before insulation.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      primary_limitation:
        "Mandatory physical constraints are geometrically incompatible.",
      no_match_summary:
        "Physical conflict: A 500L volume cannot be packaged within a 40cm outer diameter cylinder under standard manufacturing and pressure safety codes. Platform refuses to propose speculative or hazardous alternatives.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Full market scan conducted across global commercial water heater manufacturers; zero candidates meet the compound constraint.",
        evaluated_supplier_count: 22,
        qualified_supplier_count: 0,
        shortlisted_candidate_ids: [],
        key_bottlenecks: [
          "Physical diameter constraint (< 40cm) vs thermal tank volume (500L)",
        ],
        recommendations_summary:
          "Relax diameter constraint to 75cm OR deploy two cascading 250L modular slim cylinders.",
      },
    },
    supplier_candidates: [],
    claims: [],
    evidence: [
      {
        evidence_id: "EVD-SC10-01",
        source_url:
          "https://www.ariston.com/en-me/products/commercial-cylinders",
        source_title:
          "Ariston Commercial Water Cylinder Engineering Specifications",
        publisher: "Ariston Group",
        source_type: "manufacturer_portal",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Dimensional charts confirm 500L floor-standing storage tanks require minimum 750mm outer diameter with polyurethane foam insulation.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC10-01",
        title: "Geometric Feasibility Boundary",
        description:
          "Constraints violated physical packaging laws for pressurized domestic hot water vessels.",
        scope: "search_coverage",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Responsible AI fails cleanly when constraints are unachievable.",
      recommended_actions: [
        "Option 1: Expand mechanical shaft aperture to accommodate standard 75cm cylinder.",
        "Option 2: Replace single 500L tank with twin 250L slimline units plumbed in parallel.",
        "Option 3: Switch to commercial continuous-flow instantaneous gas or electric heaters.",
      ],
      questions_to_resolve: [
        "Consult MEP structural engineer regarding utility shaft load and clearance.",
      ],
      validation_priorities: [
        "Recheck architectural shaft dimensions on site.",
      ],
      human_review_required: true,
    },
  },

  // SC-11: sparse_evidence_titanium
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-11-RES-SPARSE-TITANIUM",
    run_id: "00000000-0000-4000-8000-000000000311",
    generated_at: "2026-09-05T12:30:00.000Z",
    research_mode: "hybrid",
    research_status: "insufficient_evidence",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "global",
      business_context: [
        "Ultra-high purity electron beam melted titanium billets",
      ],
      product_category: "Aerospace Titanium",
      product_name: "Titanium Grade 5 Extra Low Interstitial (ELI) Billets",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: {
        purity: "99.995%",
        process: "Electron Beam Cold Hearth Remelting",
      },
      normalized_requirements: [
        {
          name: "AMS 4930 Specification",
          value: true,
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: [
        "AMS 4930 ELI certification with traceable ingot history",
      ],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Research status Insufficient Evidence: Only 1 qualified producer identified globally with sparse data",
      direct_answer:
        "Due to extreme technological barriers, only 1 verifiable producer was identified with public evidence. MatchBASE refuses to generate synthetic filler candidates to meet display caps.",
      key_findings: [
        "TIMET (Titanium Metals Corporation) identified as verified producer of AMS 4930 ELI ingots.",
        "Alternative secondary candidates failed due to sparse or proprietary non-public documentation.",
        "Platform returned truthful single-item finding under 'insufficient_evidence' status.",
      ],
      candidate_count: 1,
      confidence_assessment: "medium",
      primary_limitation:
        "Market characterized by classified aerospace supply agreements with scarce public filings.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Aerospace-grade ELI titanium is concentrated among 3 global defense primes; only 1 has verifiable commercial open-market channels.",
        evaluated_supplier_count: 6,
        qualified_supplier_count: 1,
        shortlisted_candidate_ids: ["CAND-SC11-01"],
        key_bottlenecks: [
          "Proprietary defense qualification requirements restricting public technical disclosure",
        ],
        recommendations_summary:
          "Engage TIMET directly through defense offset procurement protocol.",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC11-01",
        entity_id: "ENT-US-TIMET-001",
        legal_name: "Titanium Metals Corporation (TIMET)",
        brand_names: ["TIMET"],
        country_code: "US",
        manufacturing_locations: ["US-NV", "US-OH"],
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary:
          "Accredited aerospace melt facility holding Nadcap and AMS certifications.",
        offerings: [
          {
            sku_or_name: "TIMETAL 6-4 ELI Billet",
            description:
              "Extra Low Interstitial Ti-6Al-4V premium aircraft quality billet.",
            specifications: {
              standard: "AMS 4930",
              melt_method: "EBCHM + VAR",
            },
          },
        ],
        moq: {
          value: 2000,
          unit: "KGM",
          description: "Standard melt ingot segment",
        },
        capacity: { annual_or_monthly: "annual", volume: 15000, unit: "TNE" },
        certifications: [
          {
            certification_name: "Nadcap Materials Testing",
            issuer: "PRI",
            verification_state: "verified",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          iso_certifications: ["AS9100D"],
        },
        logistics: {
          supported_incoterms: ["FCA"],
          primary_shipping_ports: ["Los Angeles"],
        },
        fit_assessment: {
          compatibility_score: 97,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 100,
            category_product_fit: 98,
          },
          positive_drivers: ["Direct AMS 4930 Nadcap accredited supplier"],
          limiting_gaps: [
            "Strict export control (ITAR/EAR) compliance required",
          ],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "AMS 4930 ELI",
              outcome: "pass",
              rationale: "Certified product line.",
            },
          ],
          human_review_required: true,
        },
        risks: [
          "US Department of State export license approval timeline (60-90 days)",
        ],
        required_validation: [
          "Verify end-user certificate (EUC) requirements.",
        ],
        claim_ids: ["CLM-SC11-01"],
        evidence_ids: ["EVD-SC11-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC11-01",
        claim_text:
          "TIMET holds active AS9100 and Nadcap accreditations for electron beam titanium melting.",
        claim_type: "capability",
        subject_id: "ENT-US-TIMET-001",
        confidence: "high",
        evidence_ids: ["EVD-SC11-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC11-01",
        source_url: "https://www.timet.com/products/aerospace-billets",
        source_title: "TIMET Aerospace Product Specifications & Certifications",
        publisher: "Titanium Metals Corporation",
        source_type: "manufacturer_portal",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-SC11-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Product catalog validating AMS 4930 specification compliance for TIMETAL 6-4 ELI billets.",
      },
    ],
    unknowns: [
      {
        field_or_topic: "secondary_tier_supplier_capacity",
        reason:
          "Alternative specialized mills do not disclose commercial inventory outside government defense contracts.",
        impact: "blocking",
        recommended_validation:
          "File formal aerospace procurement inquiries through authorized distributor channels.",
      },
    ],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC11-01",
        title: "Sparse Market Evidence Limitation",
        description:
          "Only one candidate met strict compliance threshold; synthetic padding strictly prevented.",
        scope: "search_coverage",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Sparse results reflect genuine industrial market concentration.",
      recommended_actions: [
        "Initiate direct contact with TIMET commercial aerospace sales desk.",
      ],
      questions_to_resolve: [
        "Confirm ITAR licensing requirements for destination end-use.",
      ],
      validation_priorities: [
        "Verify current mill lead time (frequently 40-52 weeks).",
      ],
      human_review_required: true,
    },
  },

  // SC-12: conflicting_evidence_meat
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-12-RES-CONFLICT-MEAT",
    run_id: "00000000-0000-4000-8000-000000000312",
    generated_at: "2026-09-05T12:45:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "trade_lane",
      business_context: ["Frozen beef procurement due diligence"],
      product_category: "Beef",
      product_name: "Frozen Boneless Beef Cuts",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: { cut: "Quarter cuts / trimmings" },
      normalized_requirements: [
        {
          name: "Active Export License",
          value: true,
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: ["Zero active regulatory suspensions"],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Conflicting Evidence Detected: Supplier claims active export status contradicted by regulatory alert",
      direct_answer:
        "Frigorifico Sul states on its commercial website that it holds valid GCC clearance, but official ministry gazette reports a temporary sanitary suspension issued August 2026.",
      key_findings: [
        "Commercial claim: Supplier states active beef export clearance for GCC trade lanes.",
        "Official contradiction: MAPA/SFDA reciprocal alert lists plant SIF 4120 under temporary export suspension.",
        "System explicitly flagged conflict status: CONFLICTING, preventing false PASS.",
      ],
      candidate_count: 1,
      confidence_assessment: "low",
      primary_limitation:
        "Direct conflict between commercial supplier claim and official regulatory gazette.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Single candidate evaluated under high-risk conflict flag.",
        evaluated_supplier_count: 4,
        qualified_supplier_count: 1,
        shortlisted_candidate_ids: ["CAND-SC12-01"],
        key_bottlenecks: ["Recent sanitary suspension of export license"],
        recommendations_summary:
          "Halt procurement negotiations until official suspension lift notice is gazetted.",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC12-01",
        entity_id: "ENT-BR-FRIGOSUL-001",
        legal_name: "Frigorifico Sul Americano de Carnes S.A.",
        brand_names: ["FrigoSul"],
        country_code: "BR",
        manufacturing_locations: ["BR-RS"],
        supplier_type: "manufacturer",
        verification_status: "supplier_claimed",
        verification_summary:
          "Active license claimed on website; contradicted by official government suspension notice.",
        offerings: [
          {
            sku_or_name: "Frozen Beef Forequarter",
            description: "Boneless beef blocks",
            specifications: {},
          },
        ],
        moq: { value: 25, unit: "TNE", description: "1 reefer" },
        capacity: { annual_or_monthly: "annual", volume: 60000, unit: "TNE" },
        certifications: [],
        compliance: {
          regulatory_clearance_status: "restricted",
          iso_certifications: [],
          notes: "Suspension circular under review",
        },
        logistics: {
          supported_incoterms: ["FOB"],
          primary_shipping_ports: ["Rio Grande"],
        },
        fit_assessment: {
          compatibility_score: 58,
          fit_band: "low",
          evidence_confidence: "low",
          dimension_scores: {
            compliance_certification_fit: 30,
            category_product_fit: 85,
          },
          positive_drivers: ["Competitive pricing quoted on portal"],
          limiting_gaps: [
            "Active temporary veterinary suspension by importing authority",
          ],
          risk_flags: [
            "REGULATORY_SUSPENSION_ACTIVE",
            "DISPUTED_EXPORT_PERMIT",
          ],
          mandatory_constraint_results: [
            {
              constraint_name: "Zero regulatory suspensions",
              outcome: "fail",
              rationale:
                "Plant SIF 4120 listed in Ministry circular 2026/088 under temporary export ban.",
            },
          ],
          human_review_required: true,
        },
        risks: [
          "Consignment rejection at destination port resulting in total commercial loss",
        ],
        required_validation: [
          "Demand official ministerial clearance lifting suspension before issuing LC.",
        ],
        claim_ids: ["CLM-SC12-01"],
        evidence_ids: ["EVD-SC12-01", "EVD-SC12-02"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC12-01",
        claim_text:
          "Frigorifico Sul holds active export clearance for beef shipments to Saudi Arabia.",
        claim_type: "compliance",
        subject_id: "ENT-BR-FRIGOSUL-001",
        confidence: "low",
        evidence_ids: ["EVD-SC12-01", "EVD-SC12-02"],
        conflict_status: "conflicting",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC12-01",
        source_url: "https://www.frigosul-example.invalid/export-markets",
        source_title: "Frigorifico Sul Americano Export Accreditation Notice",
        publisher: "Frigorifico Sul S.A.",
        source_type: "manufacturer_portal",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "unverified",
        freshness_status: "aging",
        supports_claim_ids: ["CLM-SC12-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Website marketing claims that facility SIF 4120 is fully approved for Middle East export.",
      },
      {
        evidence_id: "EVD-SC12-02",
        source_url:
          "https://www.gov.br/agricultura/pt-br/assuntos/sanidade-animal/circular-2026-088",
        source_title:
          "MAPA Official Gazette - Temporary Precautionary Export Suspension Order 2026/088",
        publisher: "Ministry of Agriculture, Livestock and Supply (Brazil)",
        source_type: "official_registry",
        published_at: "2026-08-22",
        retrieved_at: "2026-09-05T08:30:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: [],
        contradicts_claim_ids: ["CLM-SC12-01"],
        excerpt_summary:
          "Official government notice placing plant SIF 4120 under temporary export suspension pending sanitation verification.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC12-01",
        title: "Conflicting Regulatory Evidence Boundary",
        description:
          "Official government suspension overrides commercial marketing statements.",
        scope: "legal_compliance",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. DO NOT PROCEED: Active sanitary suspension detected in official register.",
      recommended_actions: [
        "Immediately suspend transaction with Frigorifico Sul.",
      ],
      questions_to_resolve: [
        "Check next monthly MAPA gazette for status reinstatement.",
      ],
      validation_priorities: [
        "Demand formal letter of status from Brazilian Ministry of Agriculture.",
      ],
      human_review_required: true,
    },
  },

  // SC-13: alias_deduplication_jbs
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-13-RES-ALIAS-DEDUP",
    run_id: "00000000-0000-4000-8000-000000000313",
    generated_at: "2026-09-05T13:00:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "global",
      business_context: ["Global protein supplier landscape evaluation"],
      product_category: "Animal Protein",
      product_name: "Industrial Protein and Poultry Products",
      confidence_level_required: "high",
      compliance_sensitive: false,
      pricing_volatile: false,
      product_attributes: {},
      normalized_requirements: [],
      mandatory_constraints: [],
      preferred_constraints: [],
      excluded_constraints: [],
    },
    executive_summary: {
      headline:
        "Resolved 3 commercial aliases (JBS S.A., Seara Alimentos, JBS Toledo) into 1 unified entity",
      direct_answer:
        "Entity resolution pipeline detected corporate parent-subsidiary relationships and consolidated multiple trading aliases under unified corporate entity ENT-BR-JBS-001.",
      key_findings: [
        "Multiple search hits across Seara Alimentos, JBS Global, and JBS Aves resolved into single candidate.",
        "Eliminated duplicate candidate cards from clogging procurement shortlist.",
        "Brand portfolio (Seara, Friboi, Swift) represented within candidate card.",
      ],
      candidate_count: 1,
      confidence_assessment: "high",
      primary_limitation:
        "Plant-level dispatch remains governed by individual SIF registrations.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Entity deduplication applied: 3 raw trade listings mapped to 1 distinct parent corporation.",
        evaluated_supplier_count: 6,
        qualified_supplier_count: 1,
        shortlisted_candidate_ids: ["CAND-SC13-01"],
        key_bottlenecks: [],
        recommendations_summary:
          "Consolidated entity structure allows enterprise-level multi-plant contracting.",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC13-01",
        entity_id: "ENT-BR-JBS-001",
        legal_name: "JBS S.A.",
        trading_name: "JBS Global Meats",
        brand_names: ["Seara", "Friboi", "Swift", "Pilgrim's"],
        country_code: "BR",
        manufacturing_locations: ["BR-SP", "BR-SC", "BR-MS", "BR-GO"],
        website: "https://www.jbs.com.br",
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary:
          "Unified parent entity resolved from Seara Alimentos and regional JBS subsidiaries.",
        offerings: [
          {
            sku_or_name: "Poultry and Beef Enterprise Line",
            description:
              "Multi-species chilled and frozen meat exports from integrated Brazilian slaughterhouses.",
            specifications: {
              multi_species: true,
              halal_lines_available: true,
            },
          },
        ],
        moq: {
          value: 100,
          unit: "TNE",
          description: "Enterprise contract baseline",
        },
        capacity: { annual_or_monthly: "annual", volume: 4500000, unit: "TNE" },
        certifications: [],
        compliance: {
          regulatory_clearance_status: "cleared",
          iso_certifications: ["ISO 22000", "BRCGS"],
        },
        logistics: {
          supported_incoterms: ["FOB", "CIF"],
          primary_shipping_ports: ["Santos", "Paranagua", "Itajai"],
        },
        fit_assessment: {
          compatibility_score: 95,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            volume_capacity_fit: 100,
            category_product_fit: 94,
            positioning_brand_fit: 96,
          },
          positive_drivers: [
            "Global scale with multi-port redundant logistics",
            "Resolved parent entity",
          ],
          limiting_gaps: [],
          risk_flags: [],
          mandatory_constraint_results: [],
          human_review_required: false,
        },
        risks: [],
        required_validation: [
          "Specify individual SIF slaughterhouse on each commercial release order.",
        ],
        claim_ids: ["CLM-SC13-01"],
        evidence_ids: ["EVD-SC13-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC13-01",
        claim_text:
          "Seara Alimentos operates as a wholly owned operating subsidiary of JBS S.A.",
        claim_type: "identity",
        subject_id: "ENT-BR-JBS-001",
        confidence: "high",
        evidence_ids: ["EVD-SC13-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC13-01",
        source_url:
          "https://ri.jbs.com.br/en/corporate-governance/corporate-structure",
        source_title:
          "JBS S.A. Investor Relations - Official Corporate Structure & Subsidiary Filings",
        publisher: "JBS S.A.",
        source_type: "official_registry",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-SC13-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Corporate regulatory filing confirming 100% equity ownership of Seara Alimentos Ltda under JBS S.A.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Entity deduplication verified via corporate registry.",
      recommended_actions: [
        "Engage JBS Global key account team for enterprise-wide volume rebates.",
      ],
      questions_to_resolve: [
        "Determine whether contract will be executed through Brazilian parent or overseas trading arm.",
      ],
      validation_priorities: [
        "Verify tax registration (CNPJ) on proforma invoice.",
      ],
      human_review_required: false,
    },
  },

  // SC-14: fewer_than_cap_dates
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-14-RES-FEWER-THAN-CAP",
    run_id: "00000000-0000-4000-8000-000000000314",
    generated_at: "2026-09-05T13:15:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: [],
      intent_scope: "regional",
      business_context: [
        "Organic Medjool dates procurement for premium European retail export",
      ],
      product_category: "Dried Fruits",
      product_name: "Certified Organic Medjool Dates Jumbo Grade",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: false,
      product_attributes: {
        certification: "EU Organic",
        variety: "Medjool Jumbo",
      },
      normalized_requirements: [
        {
          name: "EU Organic 2018/848",
          value: true,
          requirement_level: "mandatory",
        },
        { name: "GlobalG.A.P.", value: true, requirement_level: "mandatory" },
      ],
      mandatory_constraints: [
        "Active EU Organic certification with accredited CB",
      ],
      preferred_constraints: [],
      excluded_constraints: ["Conventional non-organic date farms"],
    },
    executive_summary: {
      headline:
        "Identified exactly 2 verified organic growers: Result delivered without artificial filler padding",
      direct_answer:
        "Exactly two commercial date farming enterprises in the Jordan Valley satisfy both EU Organic and GlobalG.A.P. accreditation requirements.",
      key_findings: [
        "Jordan River Dates and Hadiklaim Organic satisfy all dual-certification requirements.",
        "Candidate cap permitted up to 20 results; system truthfully presented only the 2 authentic matches.",
        "Anti-hallucination invariant verified: zero fabricated candidates introduced to satisfy soft caps.",
      ],
      candidate_count: 2,
      confidence_assessment: "high",
      primary_limitation:
        "Organic Medjool yields subject to seasonal harvest rain damage risk.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Thorough scan of 12 commercial date operations; exactly 2 possess verified active EU Organic certifications.",
        evaluated_supplier_count: 12,
        qualified_supplier_count: 2,
        shortlisted_candidate_ids: ["CAND-SC14-01", "CAND-SC14-02"],
        key_bottlenecks: [
          "Severe scarcity of certified organic date plantations",
        ],
        recommendations_summary:
          "Commit forward crop contracts early ahead of harvest season (September).",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC14-01",
        entity_id: "ENT-JO-JORDANDATES-001",
        legal_name: "Jordan River Date Palm Co.",
        brand_names: ["Jordan River Organic"],
        country_code: "JO",
        manufacturing_locations: ["JO-JA"],
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary:
          "EU Organic certificate verified via CCPB accreditation body.",
        offerings: [
          {
            sku_or_name: "Organic Medjool Jumbo 5kg",
            description:
              "Loose pack jumbo organic dates, skin separation < 5%.",
            specifications: { size: "Jumbo (>23g)", organic: true },
          },
        ],
        moq: { value: 5000, unit: "KGM", description: "1,000x 5kg boxes" },
        capacity: { annual_or_monthly: "annual", volume: 400, unit: "TNE" },
        certifications: [
          {
            certification_name: "EU Organic",
            issuer: "CCPB",
            verification_state: "verified",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          iso_certifications: ["GlobalG.A.P.", "BRCGS"],
        },
        logistics: {
          supported_incoterms: ["FOB", "CIF"],
          primary_shipping_ports: ["Aqaba"],
        },
        fit_assessment: {
          compatibility_score: 96,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 100,
            category_product_fit: 95,
          },
          positive_drivers: [
            "Direct certified organic grove",
            "Export packaging meets EU supermarket standards",
          ],
          limiting_gaps: [],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "EU Organic",
              outcome: "pass",
              rationale: "Certificate active in TRACES system.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: [
          "Verify TRACES Certificate of Inspection (COI) prior to customs clearance.",
        ],
        claim_ids: ["CLM-SC14-01"],
        evidence_ids: ["EVD-SC14-01"],
      },
      {
        candidate_id: "CAND-SC14-02",
        entity_id: "ENT-IL-HADIKLAIM-001",
        legal_name: "Hadiklaim Date Growers Cooperative",
        brand_names: ["King Solomon Organic"],
        country_code: "IL",
        manufacturing_locations: ["IL-D"],
        supplier_type: "cooperative",
        verification_status: "externally_verified",
        verification_summary:
          "Agrior organic certification verified for dedicated bio plantations.",
        offerings: [
          {
            sku_or_name: "King Solomon Organic Medjool",
            description:
              "Super Jumbo organic dates for European organic supermarket chains.",
            specifications: { size: "Super Jumbo", organic: true },
          },
        ],
        moq: { value: 10000, unit: "KGM", description: "2,000x 5kg cartons" },
        capacity: { annual_or_monthly: "annual", volume: 1200, unit: "TNE" },
        certifications: [
          {
            certification_name: "EU Organic",
            issuer: "Agrior",
            verification_state: "verified",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          iso_certifications: ["GlobalG.A.P."],
        },
        logistics: {
          supported_incoterms: ["FOB"],
          primary_shipping_ports: ["Ashdod"],
        },
        fit_assessment: {
          compatibility_score: 93,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 98,
            volume_capacity_fit: 92,
          },
          positive_drivers: [
            "High volume cooperative supply",
            "Established retail packaging in EU",
          ],
          limiting_gaps: ["Higher minimum order quantity (10 MT)"],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "EU Organic",
              outcome: "pass",
              rationale: "Agrior verified in TRACES.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: [
          "Inspect lot-specific organic residue pesticide screen.",
        ],
        claim_ids: ["CLM-SC14-01"],
        evidence_ids: ["EVD-SC14-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC14-01",
        claim_text:
          "Shortlisted suppliers maintain valid organic certification under Regulation (EU) 2018/848.",
        claim_type: "compliance",
        subject_id: "ENT-ORGANIC-MEDJOOL",
        confidence: "high",
        evidence_ids: ["EVD-SC14-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC14-01",
        source_url: "https://ec.europa.eu/tracesnt/organic-certificates",
        source_title:
          "European Commission TRACES NT - Organic Electronic Certificate of Inspection System",
        publisher: "European Commission",
        source_type: "official_registry",
        retrieved_at: "2026-09-05T08:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-SC14-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Official European trade control system verifying validity of organic producer certificates and scope.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Truthful presentation reflects genuine scarcity.",
      recommended_actions: [
        "Contact Jordan River Dates for Q4 sample dispatch.",
      ],
      questions_to_resolve: [
        "Confirm allocation availability for Jumbo vs Large sizing.",
      ],
      validation_priorities: [
        "Request live TRACES certificate verification code.",
      ],
      human_review_required: false,
    },
  },

  // SC-15: compound_sourcing_pricing
  {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "SC-15-RES-COMPOUND-POULTRY",
    run_id: "00000000-0000-4000-8000-000000000315",
    generated_at: "2026-09-05T13:30:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: ["pricing"],
      intent_scope: "trade_lane",
      business_context: [
        "Integrated sourcing and price benchmark analysis for Brazilian poultry export",
      ],
      product_category: "Poultry",
      product_name: "Frozen Whole Chicken Grade A Halal",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: true,
      product_attributes: {
        calibration: "1000g-1200g",
        packing: "10 birds per carton",
      },
      normalized_requirements: [
        {
          name: "SFDA Approved Facility",
          value: true,
          requirement_level: "mandatory",
        },
        {
          name: "Target CIF Jeddah Price",
          value: 2.25,
          unit: "USD/kg",
          requirement_level: "preferred",
        },
      ],
      mandatory_constraints: [
        "SFDA clearance active",
        "FOB/CIF price benchmarks included",
      ],
      preferred_constraints: [],
      excluded_constraints: [],
      geographic_scope: "Brazil -> KSA",
      destination_market: "Saudi Arabia",
    },
    executive_summary: {
      headline:
        "Compound Intelligence: 2 verified suppliers mapped alongside current CIF Jeddah price benchmarks",
      direct_answer:
        "Both sourcing landscape (BRF and Seara) and trade lane pricing intelligence ($2.12 - $2.28/kg CIF) successfully delivered in integrated compound payload.",
      key_findings: [
        "Sourcing module: BRF (SIF 1030) and Seara (SIF 2014) verified and shortlisted.",
        "Pricing module: Spot CIF Jeddah trading in $2.12 - $2.28 / kg range.",
        "Both modules active simultaneously in full accordance with modular query specification.",
      ],
      candidate_count: 2,
      confidence_assessment: "high",
      primary_limitation:
        "Freight spot surcharges adjust weekly; CIF indications valid for prompt sailing.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Evaluated 15 Brazilian poultry plants; 2 top-tier integrated producers shortlisted.",
        evaluated_supplier_count: 15,
        qualified_supplier_count: 2,
        shortlisted_candidate_ids: ["CAND-SC15-01", "CAND-SC15-02"],
        trade_lane_evaluated: "Santos/Paranagua -> Jeddah Islamic Port",
        key_bottlenecks: [
          "Reefer slot availability for prompt September voyages",
        ],
        recommendations_summary:
          "Award 60% volume to BRF and 40% to Seara to maintain dual-origin supply resilience.",
      },
      pricing: {
        overview:
          "Current benchmark pricing for Brazilian frozen poultry into Saudi Arabia.",
        pricing_observations: [
          {
            observation_id: "PRC-SC15-01",
            price_type: "quoted",
            amount_min: 2.12,
            amount_max: 2.22,
            currency: "USD",
            unit: "KGM",
            quantity_basis: "27 MT per 40ft reefer",
            trade_basis: "wholesale_bulk",
            incoterm: "CIF",
            location_basis: "Jeddah Islamic Port",
            retrieved_at: "2026-09-05T09:00:00.000Z",
            confidence: "high",
            evidence_ids: ["EVD-SC15-01"],
            notes: "Direct trading quotation CIF Jeddah",
          },
          {
            observation_id: "PRC-SC15-02",
            price_type: "indicative",
            amount_min: 1.88,
            amount_max: 1.96,
            currency: "USD",
            unit: "KGM",
            quantity_basis: "27 MT",
            trade_basis: "wholesale_bulk",
            incoterm: "FOB",
            location_basis: "Port of Paranagua, Brazil",
            retrieved_at: "2026-09-05T08:30:00.000Z",
            confidence: "high",
            evidence_ids: ["EVD-SC15-01"],
            notes: "Ex-load port baseline without ocean freight",
          },
        ],
        benchmarks: [
          {
            benchmark_name:
              "Platts / S&P Global Brazilian Chicken FOB Paranagua",
            benchmark_price: 1.92,
            currency: "USD",
            unit: "KGM",
            source: "S&P Global Commodity Insights",
            as_of_date: "2026-09-01",
          },
        ],
        price_factors: [
          "Ocean reefer freight rates ($3,800 - $4,200 / FEU)",
          "BRL/USD exchange rate",
          "Domestic feed costs",
        ],
        volatility_rating: "medium",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-SC15-01",
        entity_id: "ENT-BR-BRF-001",
        legal_name: "BRF S.A.",
        brand_names: ["Sadia"],
        country_code: "BR",
        manufacturing_locations: ["BR-PR"],
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary: "SFDA plant registry SIF 1030 verified active.",
        offerings: [
          {
            sku_or_name: "Sadia Whole Griller",
            description: "1000-1200g calibrated",
            specifications: {},
          },
        ],
        moq: { value: 27, unit: "TNE", description: "1x 40ft reefer" },
        capacity: { annual_or_monthly: "annual", volume: 300000, unit: "TNE" },
        certifications: [],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          iso_certifications: ["ISO 22000"],
        },
        logistics: {
          supported_incoterms: ["CIF", "FOB"],
          primary_shipping_ports: ["Paranagua"],
        },
        fit_assessment: {
          compatibility_score: 95,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 98,
            price_tier_fit: 92,
          },
          positive_drivers: [
            "Full compliance and direct CIF delivery service to Jeddah",
          ],
          limiting_gaps: [],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA clearance",
              outcome: "pass",
              rationale: "Active on register.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: ["Verify booking confirmation."],
        claim_ids: ["CLM-SC15-01"],
        evidence_ids: ["EVD-SC15-01"],
      },
      {
        candidate_id: "CAND-SC15-02",
        entity_id: "ENT-BR-SEARA-001",
        legal_name: "Seara Alimentos Ltda",
        brand_names: ["Seara"],
        country_code: "BR",
        manufacturing_locations: ["BR-SC"],
        supplier_type: "manufacturer",
        verification_status: "externally_verified",
        verification_summary: "SFDA plant registry SIF 2014 verified active.",
        offerings: [
          {
            sku_or_name: "Seara Griller Chicken",
            description: "1100g Halal whole poultry",
            specifications: {},
          },
        ],
        moq: { value: 27, unit: "TNE", description: "1x 40ft reefer" },
        capacity: { annual_or_monthly: "annual", volume: 220000, unit: "TNE" },
        certifications: [],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          iso_certifications: ["BRCGS"],
        },
        logistics: {
          supported_incoterms: ["CIF", "FOB"],
          primary_shipping_ports: ["Santos"],
        },
        fit_assessment: {
          compatibility_score: 93,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            compliance_certification_fit: 96,
            price_tier_fit: 94,
          },
          positive_drivers: ["Competitive CIF quotations and regular sailings"],
          limiting_gaps: [],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA clearance",
              outcome: "pass",
              rationale: "Active on register.",
            },
          ],
          human_review_required: false,
        },
        risks: [],
        required_validation: ["Check container temperature logs."],
        claim_ids: ["CLM-SC15-01"],
        evidence_ids: ["EVD-SC15-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-SC15-01",
        claim_text:
          "Brazilian poultry suppliers hold active SFDA clearance and maintain regular refrigerated liner service to Jeddah.",
        claim_type: "compliance",
        subject_id: "ENT-BR-POULTRY-EXPORT",
        confidence: "high",
        evidence_ids: ["EVD-SC15-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SC15-01",
        source_url: "https://www.sfda.gov.sa/en/food/establishments",
        source_title:
          "SFDA Approved Establishments and Trade Lane Freight Index",
        publisher: "Saudi Food and Drug Authority & Trade Monitor",
        source_type: "official_registry",
        retrieved_at: "2026-09-05T09:00:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-SC15-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Official documentation supporting active establishment clearance and benchmark market rate observations.",
      },
    ],
    unknowns: [],
    assumptions: [],
    limitations: [
      {
        limitation_id: "LIM-SC15-01",
        title: "Compound Module Freight Surcharge Warning",
        description:
          "Bunker adjustment factors (BAF) adjust on the first of each month.",
        scope: "commercial_commitment",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. Compound sourcing and pricing intelligence provided for commercial guidance.",
      recommended_actions: ["Split volume commitment between BRF and Seara."],
      questions_to_resolve: [
        "Confirm arrival port container free time (demurrage threshold).",
      ],
      validation_priorities: [
        "Verify bill of lading mentions SFDA registered slaughterhouse number.",
      ],
      human_review_required: false,
    },
  },
];
