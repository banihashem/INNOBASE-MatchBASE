import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
  parseConsultantResearchOutputV2,
  isConsultantResearchOutputV2,
  adaptV1ToV2ConsultantOutput,
  CANONICAL_MATCH_DIMENSIONS_V2,
  CANONICAL_DIMENSION_IDS_V2,
  type ConsultantResearchOutputV2,
} from "../src/v2/consultant-research-output.js";
import { GOLDEN_SCENARIOS } from "../src/v2/golden-scenarios.js";
import type { ConsultantResultProjectionV1 } from "../src/v1/consultant-projection.js";

function createValidResearchOutput(): ConsultantResearchOutputV2 {
  return {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    result_id: "RES-TEST-001",
    run_id: "00000000-0000-4000-8000-000000000101",
    generated_at: "2026-09-05T12:00:00.000Z",
    research_mode: "hybrid",
    research_status: "complete",
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: ["pricing"],
      intent_scope: "trade_lane",
      business_context: ["Poultry procurement for KSA food service"],
      product_category: "Poultry",
      product_name: "Frozen Whole Chicken Grade A",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: true,
      product_attributes: {
        form: "frozen_whole",
        weight_range: "1000g-1200g",
        slaughter_method: "hand_slaughtered_halal",
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
        {
          name: "Target FOB Price",
          value: 2.15,
          unit: "USD/kg",
          requirement_level: "preferred",
        },
      ],
      mandatory_constraints: [
        "SFDA export clearance mandatory",
        "GSO 993 Halal slaughter compliance",
      ],
      preferred_constraints: ["Jeddah Islamic Port delivery preference"],
      excluded_constraints: ["Mechanically separated meat"],
      geographic_scope: "Brazil to KSA",
      destination_market: "Saudi Arabia",
      commercial_context: "Annual volume 1,200 MT contract",
    },
    executive_summary: {
      headline:
        "Identified 2 qualified poultry producers with SFDA approval and GSO 993 compliance",
      direct_answer:
        "Two Brazilian producers meet all mandatory export, SFDA clearance, and Halal criteria.",
      key_findings: [
        "BRF S.A. operates 4 SFDA-listed slaughterhouses with dedicated GCC Halal lines.",
        "JBS / Seara Alimentos maintains active SFDA listing with CIF Jeddah capability.",
      ],
      candidate_count: 2,
      confidence_assessment: "high",
      primary_limitation:
        "Freight spot rates fluctuate weekly; pricing indicative FOB Santos.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Evaluated 14 Brazilian poultry exporters; 2 meet full SFDA and halal verification.",
        evaluated_supplier_count: 14,
        qualified_supplier_count: 2,
        shortlisted_candidate_ids: ["CAND-BR-01", "CAND-BR-02"],
        trade_lane_evaluated:
          "Santos, Brazil -> Jeddah Islamic Port, Saudi Arabia",
        key_bottlenecks: [
          "Reefer container allocation during peak seasonal demand",
        ],
        recommendations_summary:
          "Initiate dual-vendor allocation to mitigate freight disruption risk.",
      },
      pricing: {
        overview:
          "Frozen whole chicken CIF Jeddah trading in $2.10 - $2.30 / kg range.",
        pricing_observations: [
          {
            observation_id: "PRC-OBS-01",
            price_type: "indicative",
            amount_min: 2.1,
            amount_max: 2.25,
            currency: "USD",
            unit: "KGM",
            quantity_basis: "27 MT per 40ft reefer",
            trade_basis: "wholesale_bulk",
            incoterm: "FOB",
            location_basis: "Port of Santos, Brazil",
            retrieved_at: "2026-09-05T09:00:00.000Z",
            confidence: "high",
            evidence_ids: ["EVD-SFDA-01"],
            notes: "Spot FOB Santos benchmark",
          },
        ],
        benchmarks: [
          {
            benchmark_name: "FOB Santos Spot Benchmark",
            benchmark_price: 2.15,
            currency: "USD",
            unit: "KGM",
            source: "Trade index observation",
            as_of_date: "2026-09-01",
          },
        ],
        price_factors: ["Soybean meal feed costs", "BRL/USD FX movements"],
        volatility_rating: "medium",
      },
    },
    supplier_candidates: [
      {
        candidate_id: "CAND-BR-01",
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
            sku_or_name: "Frozen Whole Chicken Sadia Grade A",
            description:
              "Individually wrapped frozen whole chicken, 1000g - 1200g calibration.",
            specifications: {
              calibration: "1000-1200g",
              shelf_life_months: 12,
              halal: true,
            },
          },
        ],
        moq: {
          value: 27,
          unit: "TNE",
          description: "One 40-foot refrigerated container",
        },
        capacity: {
          annual_or_monthly: "annual",
          volume: 240000,
          unit: "TNE",
        },
        certifications: [
          {
            certification_name: "GSO 993:2015 Halal Slaughtering",
            issuer: "FAMBRAS Halal Brazil",
            valid_until: "2027-06-30",
            verification_state: "verified",
            evidence_id: "EVD-SFDA-01",
          },
        ],
        compliance: {
          regulatory_clearance_status: "cleared",
          sfda_approved: true,
          halal_certified: true,
          iso_certifications: ["ISO 22000", "FSSC 22000"],
        },
        shelf_life: {
          duration_months: 12,
          storage_temperature_celsius: -18,
          storage_condition: "-18C deep frozen",
        },
        logistics: {
          supported_incoterms: ["FOB", "CIF"],
          primary_shipping_ports: ["Port of Paranagua", "Port of Santos"],
          cold_chain_guaranteed: true,
          typical_lead_time_days: 35,
        },
        fit_assessment: {
          compatibility_score: 94,
          fit_band: "strong",
          evidence_confidence: "high",
          dimension_scores: {
            category_product_fit: 96,
            compliance_certification_fit: 98,
            volume_capacity_fit: 95,
            price_tier_fit: 90,
            positioning_brand_fit: 92,
            geographic_reach_fit: 94,
          },
          positive_drivers: [
            "Active SFDA plant listing with zero current suspensions.",
            "Dedicated GSO 993 ritual slaughter line.",
          ],
          limiting_gaps: ["Requires 35-day ocean transit lead time."],
          risk_flags: [],
          mandatory_constraint_results: [
            {
              constraint_name: "SFDA export clearance",
              outcome: "pass",
              rationale:
                "Plant SIF 1030 active on SFDA authorized establishment register.",
            },
          ],
          human_review_required: true,
        },
        risks: ["Port congestion during grain harvest season"],
        required_validation: [
          "Confirm specific SIF number allocation on proforma invoice.",
        ],
        claim_ids: ["CLM-01"],
        evidence_ids: ["EVD-SFDA-01"],
      },
    ],
    claims: [
      {
        claim_id: "CLM-01",
        claim_text:
          "BRF Plant SIF 1030 holds active SFDA export approval for poultry meat to Saudi Arabia.",
        claim_type: "compliance",
        subject_id: "ENT-BR-BRF-001",
        confidence: "high",
        evidence_ids: ["EVD-SFDA-01"],
        conflict_status: "corroborated",
      },
    ],
    evidence: [
      {
        evidence_id: "EVD-SFDA-01",
        source_url:
          "https://www.sfda.gov.sa/en/food/establishments/meat-poultry",
        source_title:
          "Saudi Food and Drug Authority Approved Foreign Food Facilities - Brazil Meat",
        publisher: "Saudi Food and Drug Authority",
        source_type: "official_registry",
        published_at: "2026-08-01",
        retrieved_at: "2026-09-05T08:30:00.000Z",
        verification_status: "verified",
        freshness_status: "current",
        supports_claim_ids: ["CLM-01"],
        contradicts_claim_ids: [],
        excerpt_summary:
          "Plant SIF 1030 (BRF S.A., Toledo PR) listed as approved for poultry export to KSA.",
        content_sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ],
    unknowns: [
      {
        field_or_topic: "q4_freight_rate_contracts",
        reason: "Shipping lines have not published Q4 bunker surcharges.",
        impact: "degrading",
        recommended_validation:
          "Request shipping line quotation 2 weeks prior to vessel departure.",
      },
    ],
    assumptions: [
      {
        assumption_id: "ASM-01",
        description:
          "Bilateral trade protocol between Brazil MAPA and KSA SFDA remains stable.",
        rationale:
          "No active veterinary health bans reported between MAPA and SFDA.",
        sensitivity: "high",
      },
    ],
    limitations: [
      {
        limitation_id: "LIM-01",
        title: "Freight Volatility Boundary",
        description:
          "Reefer container freight rates fluctuate and are subject to GRI surcharges.",
        scope: "commercial_commitment",
      },
      {
        limitation_id: "LIM-02",
        title: "Regulatory Screening Notice",
        description:
          "Import clearance subject to port health inspection and salmonella testing upon arrival.",
        scope: "legal_compliance",
      },
    ],
    decision_support: {
      advisory_notice:
        "AI proposes; humans choose. This output is an advisory research document and does not constitute a procurement contract.",
      recommended_actions: [
        "Verify proforma invoice explicitly lists SFDA-approved SIF 1030.",
        "Execute formal Halal certification validation through FAMBRAS portal.",
      ],
      questions_to_resolve: [
        "Confirm container stuffing temperature logs will be provided with shipping documents.",
      ],
      validation_priorities: [
        "SFDA import permit valid validity date matching shipment arrival date.",
      ],
      shortlist_guidance:
        "Prioritize BRF for volume scale or Seara for delivery flexibility.",
      human_review_required: true,
    },
  };
}

test("ConsultantResearchOutputV2 parses a fully formed output successfully", () => {
  const valid = createValidResearchOutput();
  const parsed = parseConsultantResearchOutputV2(valid);
  assert.equal(
    parsed.schema_version,
    CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
  );
  assert.equal(parsed.result_id, "RES-TEST-001");
  assert.equal(parsed.supplier_candidates.length, 1);
  assert.equal(parsed.supplier_candidates[0]?.candidate_id, "CAND-BR-01");
  assert.equal(
    parsed.supplier_candidates[0]?.fit_assessment.compatibility_score,
    94,
  );
  assert.equal(
    parsed.supplier_candidates[0]?.fit_assessment.evidence_confidence,
    "high",
  );
  assert.equal(parsed.result_modules.sourcing?.qualified_supplier_count, 2);
  assert.equal(
    parsed.result_modules.pricing?.benchmarks[0]?.benchmark_price,
    2.15,
  );
  assert.equal(isConsultantResearchOutputV2(parsed), true);
});

test("ConsultantResearchOutputV2 validates decoupled score and confidence", () => {
  const output = createValidResearchOutput();
  const baseCandidate = output.supplier_candidates[0]!;
  const cand = {
    ...baseCandidate,
    fit_assessment: {
      ...baseCandidate.fit_assessment,
      compatibility_score: 95,
      evidence_confidence: "low" as const,
    },
  };
  const withDecoupled = {
    ...output,
    supplier_candidates: [cand],
  };
  const parsed = parseConsultantResearchOutputV2(withDecoupled);
  assert.equal(
    parsed.supplier_candidates[0]?.fit_assessment.compatibility_score,
    95,
  );
  assert.equal(
    parsed.supplier_candidates[0]?.fit_assessment.evidence_confidence,
    "low",
  );
});

test("ConsultantResearchOutputV2 parses first-class no-match output", () => {
  const output: ConsultantResearchOutputV2 = {
    ...createValidResearchOutput(),
    result_id: "RES-NO-MATCH-01",
    research_status: "no_strong_match",
    supplier_candidates: [],
    claims: [],
    executive_summary: {
      headline:
        "No supplier meets the mandatory SFDA and organic certification requirements",
      direct_answer:
        "Zero responsible candidates identified within the requested constraints.",
      key_findings: [
        "14 suppliers evaluated; 0 meet both organic and SFDA export criteria simultaneously.",
      ],
      candidate_count: 0,
      confidence_assessment: "high",
      no_match_summary:
        "No supplier currently holds both organic poultry certification and active SFDA foreign establishment listing.",
    },
    result_modules: {
      sourcing: {
        market_landscape_summary:
          "Market scan identified zero suppliers meeting compound constraint.",
        evaluated_supplier_count: 14,
        qualified_supplier_count: 0,
        shortlisted_candidate_ids: [],
        key_bottlenecks: ["Lack of SFDA certified organic poultry facilities"],
        recommendations_summary:
          "Consider relaxing the organic requirement to standard Halal SFDA-approved poultry.",
      },
    },
  };

  const parsed = parseConsultantResearchOutputV2(output);
  assert.equal(parsed.research_status, "no_strong_match");
  assert.equal(parsed.supplier_candidates.length, 0);
  assert.equal(parsed.executive_summary.no_match_summary !== undefined, true);
  assert.equal(isConsultantResearchOutputV2(parsed), true);
});

test("ConsultantResearchOutputV2 rejects invalid schema version", () => {
  const invalid = {
    ...createValidResearchOutput(),
    schema_version: "consultant-research-output.v1",
  };
  assert.throws(
    () => parseConsultantResearchOutputV2(invalid),
    /schema version must be "consultant-research-output\.v2"/,
  );
  assert.equal(isConsultantResearchOutputV2(invalid), false);
});

test("ConsultantResearchOutputV2 rejects negative or out-of-bounds compatibility scores", () => {
  const output = createValidResearchOutput();
  const baseCandidate = output.supplier_candidates[0]!;
  const invalidScore = {
    ...output,
    supplier_candidates: [
      {
        ...baseCandidate,
        fit_assessment: {
          ...baseCandidate.fit_assessment,
          compatibility_score: 105,
        },
      },
    ],
  };
  assert.throws(
    () => parseConsultantResearchOutputV2(invalidScore),
    /Compatibility score must be between 0 and 100/,
  );
});

test("ConsultantResearchOutputV2 rejects empty result_id or run_id", () => {
  const invalidResultId = {
    ...createValidResearchOutput(),
    result_id: "   ",
  };
  assert.throws(
    () => parseConsultantResearchOutputV2(invalidResultId),
    /Result ID must be a non-empty string/,
  );
});

test("ConsultantResearchOutputV2 rejects unknown query types", () => {
  const invalidQueryType = {
    ...createValidResearchOutput(),
    request_snapshot: {
      ...createValidResearchOutput().request_snapshot,
      primary_query_type: "unknown_query_type",
    },
  };
  assert.throws(
    () => parseConsultantResearchOutputV2(invalidQueryType),
    /Primary query type must be one of/,
  );
});

test("adaptV1ToV2ConsultantOutput transforms a V1 projection into a valid V2 output", () => {
  const v1Fixture: ConsultantResultProjectionV1 = {
    schema_version: "consultant-result-projection.v1",
    run_id: "00000000-0000-4000-8000-000000000201",
    projection_version: 5,
    outcome: "matched",
    scarcity: "none",
    consultant_source_readiness: {
      state: "limited",
      notice: "Historical synthetic projection test",
    },
    landscape: {
      eligible_count: 10,
      displayed_count: 1,
      soft_cap: 1,
      truncated: false,
      scarcity_override_applied: false,
    },
    synthetic_warning: "Synthetic test projection.",
    limitations: {
      unknown_count: 0,
      not_asked_count: 0,
      affected_low_confidence_dimensions: [],
      evidence_states: [],
      restricted_party_screening_notice:
        "Screening completed against sanctioned lists.",
      advisory_boundary: "Commercial terms require bilateral negotiation.",
      cap_notice: "Display limited to top 1 candidate.",
    },
    gate_eliminations: [],
    scarcity_analysis: {
      reducing_constraints: [],
      unmet_mandatory_constraints: [],
      permitted_relaxations: [],
    },
    candidates: [
      {
        display_name: "Al-Watania Poultry",
        country_code: "SA",
        rationale_extended:
          "Domestic Saudi poultry producer with extensive cold chain logistics.",
        compatibility_score: 91,
        fit_band: "strong_fit",
        band_ceiling: "strong_fit",
        displayed_band: "strong_fit",
        dimension_scores: [
          {
            dimension_id: "category_product_fit",
            weight: 25,
            score: 92,
            confidence: "high",
          },
          {
            dimension_id: "compliance_certification_fit",
            weight: 20,
            score: 95,
            confidence: "high",
          },
          {
            dimension_id: "volume_capacity_fit",
            weight: 15,
            score: 90,
            confidence: "high",
          },
          {
            dimension_id: "price_tier_fit",
            weight: 15,
            score: 88,
            confidence: "medium",
          },
          {
            dimension_id: "positioning_brand_fit",
            weight: 15,
            score: 90,
            confidence: "high",
          },
          {
            dimension_id: "geographic_reach_fit",
            weight: 10,
            score: 92,
            confidence: "high",
          },
        ],
        positive_drivers: [
          {
            dimension_id: "category_product_fit",
            explanation:
              "Fresh and frozen poultry lines fully compliant with SFDA regulations.",
            claim_id: "CLM-V1-01",
            evidence_ids: ["EVD-V1-01"],
          },
        ],
        limiting_gaps: [
          {
            dimension_id: "price_tier_fit",
            explanation: "Premium pricing tier compared to Brazilian imports.",
            claim_id: "CLM-V1-02",
            evidence_ids: ["EVD-V1-01"],
          },
        ],
        citations: [
          {
            evidence_id: "EVD-V1-01",
            title: "Al-Watania Poultry Corporate Profile",
            publisher: "Al-Watania",
            published_or_updated: "2026-01-01",
            accessed_at: "2026-08-01T00:00:00.000Z",
            source_tier: "primary",
            status: "externally_verified",
            access_state: "available",
            extract:
              "Al-Watania is the largest poultry producer in the Middle East with daily production capacity exceeding 1 million birds.",
            content_sha256:
              "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abc",
            provenance: "synthetic_fixture",
            exact_url: "https://alwatania.com.sa",
          },
        ],
        freshness: "current",
        verification_status: "externally_verified",
        evidence_confidence: "high",
      },
    ],
  };

  const adapted = adaptV1ToV2ConsultantOutput(v1Fixture);
  assert.equal(
    adapted.schema_version,
    CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
  );
  assert.equal(adapted.run_id, "00000000-0000-4000-8000-000000000201");
  assert.equal(adapted.supplier_candidates.length, 1);
  assert.equal(
    adapted.supplier_candidates[0]?.legal_name,
    "Al-Watania Poultry",
  );
  assert.equal(
    adapted.supplier_candidates[0]?.fit_assessment.fit_band,
    "strong",
  );
  assert.equal(
    adapted.supplier_candidates[0]?.fit_assessment.positive_drivers[0],
    "Fresh and frozen poultry lines fully compliant with SFDA regulations.",
  );
  assert.equal(adapted.evidence.length, 1);
  assert.equal(adapted.evidence[0]?.evidence_id, "EVD-V1-01");
  assert.equal(adapted.claims.length, 2);
  assert.equal(adapted.limitations.length, 3);

  // Validate that the adapted object passes full V2 schema validation
  const parsed = parseConsultantResearchOutputV2(adapted);
  assert.equal(parsed.result_id, "ADAPT-00000000-0000-4000-8000-000000000201");
  assert.equal(isConsultantResearchOutputV2(adapted), true);
});

test("all 15 GOLDEN_SCENARIOS parse successfully and satisfy contract invariants", () => {
  assert.equal(
    GOLDEN_SCENARIOS.length,
    15,
    "Must define exactly 15 golden scenarios",
  );

  const resultIds = new Set<string>();
  const runIds = new Set<string>();
  const primaryQueryTypes = new Set<string>();

  for (const scenario of GOLDEN_SCENARIOS) {
    // 1. Must parse through runtime validator without error
    const parsed = parseConsultantResearchOutputV2(scenario);
    assert.equal(
      parsed.schema_version,
      CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
    );
    assert.equal(isConsultantResearchOutputV2(scenario), true);

    // 2. Must have unique result_id and run_id
    assert.equal(
      resultIds.has(parsed.result_id),
      false,
      `Duplicate result_id: ${parsed.result_id}`,
    );
    assert.equal(
      runIds.has(parsed.run_id),
      false,
      `Duplicate run_id: ${parsed.run_id}`,
    );
    resultIds.add(parsed.result_id);
    runIds.add(parsed.run_id);

    // 3. Track query type coverage
    primaryQueryTypes.add(parsed.request_snapshot.primary_query_type);

    // 4. Decision support notice must always be present
    assert.equal(typeof parsed.decision_support.advisory_notice, "string");
    assert.equal(parsed.decision_support.advisory_notice.length > 0, true);

    // 5. If no_strong_match, must have 0 candidates and populated no_match_summary
    if (parsed.research_status === "no_strong_match") {
      assert.equal(parsed.supplier_candidates.length, 0);
      assert.equal(typeof parsed.executive_summary.no_match_summary, "string");
    }

    // 6. If candidates present, all must have valid fit assessment
    for (const cand of parsed.supplier_candidates) {
      assert.equal(
        cand.fit_assessment.compatibility_score >= 0 &&
          cand.fit_assessment.compatibility_score <= 100,
        true,
      );
      assert.equal(
        ["strong", "potential", "low"].includes(cand.fit_assessment.fit_band),
        true,
      );
      assert.equal(
        ["high", "medium", "low"].includes(
          cand.fit_assessment.evidence_confidence,
        ),
        true,
      );
    }
  }

  // Verify all 6 primary query types are covered across the 15 scenarios
  assert.equal(primaryQueryTypes.has("sourcing"), true);
  assert.equal(primaryQueryTypes.has("pricing"), true);
  assert.equal(primaryQueryTypes.has("product_recommendation"), true);
  assert.equal(primaryQueryTypes.has("product_catalog"), true);
  assert.equal(primaryQueryTypes.has("market_overview"), true);
  assert.equal(primaryQueryTypes.has("general_info"), true);
});

test("canonical 6-dimension scoring weights sum to 100% and candidates validate dimensions", () => {
  assert.equal(CANONICAL_MATCH_DIMENSIONS_V2.length, 6);
  const totalWeight = CANONICAL_MATCH_DIMENSIONS_V2.reduce(
    (sum, d) => sum + d.weight,
    0,
  );
  assert.equal(
    totalWeight,
    100,
    "Canonical dimension weights must sum to exactly 100%",
  );

  const expectedDimensions = [
    { dimension_id: "category_product_fit", weight: 25 },
    { dimension_id: "compliance_certification_fit", weight: 20 },
    { dimension_id: "volume_capacity_fit", weight: 15 },
    { dimension_id: "price_tier_fit", weight: 15 },
    { dimension_id: "positioning_brand_fit", weight: 15 },
    { dimension_id: "geographic_reach_fit", weight: 10 },
  ];
  for (const expected of expectedDimensions) {
    const dim = CANONICAL_MATCH_DIMENSIONS_V2.find(
      (d) => d.dimension_id === expected.dimension_id,
    );
    assert.ok(dim, `Missing canonical dimension ${expected.dimension_id}`);
    assert.equal(dim.weight, expected.weight);
  }

  // All candidates across golden scenarios with dimension_scores must include canonical dimensions
  for (const scenario of GOLDEN_SCENARIOS) {
    for (const cand of scenario.supplier_candidates) {
      for (const id of CANONICAL_DIMENSION_IDS_V2) {
        const score = cand.fit_assessment.dimension_scores[id];
        assert.equal(
          typeof score,
          "number",
          `Candidate ${cand.candidate_id} missing dimension ${id}`,
        );
        assert.ok(score !== undefined && score >= 0 && score <= 100);
      }
    }
  }
});

test("preserves and validates all original Step-1 fields and downstream behaviors", () => {
  const step1RequiredFields = [
    "primary_query_type",
    "secondary_query_types",
    "intent_scope",
    "business_context",
    "product_category",
    "product_name",
    "confidence_level_required",
    "compliance_sensitive",
    "pricing_volatile",
    "product_attributes",
  ] as const;

  for (const scenario of GOLDEN_SCENARIOS) {
    const snapshot = scenario.request_snapshot;
    for (const field of step1RequiredFields) {
      assert.notEqual(
        snapshot[field],
        undefined,
        `Scenario ${scenario.result_id} must preserve Step-1 field: ${field}`,
      );
    }

    // 1. primary_query_type activates corresponding module
    const primary = snapshot.primary_query_type;
    assert.ok(
      scenario.result_modules[primary] !== undefined,
      `Primary query type ${primary} must activate module in ${scenario.result_id}`,
    );

    // 2. secondary_query_types activate supplemental modules
    for (const sec of snapshot.secondary_query_types) {
      assert.ok(
        scenario.result_modules[sec] !== undefined,
        `Secondary query type ${sec} must activate module in ${scenario.result_id}`,
      );
    }

    // 3. compliance_sensitive activates mandatory compliance treatment
    if (snapshot.compliance_sensitive) {
      assert.ok(
        scenario.supplier_candidates.some(
          (c) =>
            c.compliance.sfda_approved !== undefined ||
            c.compliance.halal_certified !== undefined ||
            c.compliance.regulatory_clearance_status !== "unknown" ||
            c.fit_assessment.mandatory_constraint_results.length > 0,
        ) ||
          scenario.request_snapshot.mandatory_constraints.length > 0 ||
          Boolean(
            scenario.result_modules.market_overview &&
            scenario.result_modules.market_overview.regulatory_context.length >
              0,
          ) ||
          Boolean(
            scenario.result_modules.general_info &&
            scenario.result_modules.general_info.regulatory_standards.length >
              0,
          ) ||
          scenario.unknowns.some(
            (u) =>
              u.impact === "blocking" ||
              u.field_or_topic.toLowerCase().includes("compliance"),
          ),
        `Compliance sensitive scenario ${scenario.result_id} must demonstrate compliance treatment`,
      );
    }

    // 4. pricing_volatile requires dated observations or volatility warnings
    if (snapshot.pricing_volatile && scenario.result_modules.pricing) {
      assert.ok(
        scenario.result_modules.pricing.volatility_rating === "high" ||
          scenario.result_modules.pricing.volatility_rating === "medium",
        `Pricing volatile scenario must indicate medium or high volatility`,
      );
      assert.ok(
        scenario.result_modules.pricing.pricing_observations.every(
          (obs) => obs.retrieved_at.length > 0,
        ),
        `Pricing observations must be dated`,
      );
    }
  }
});

test("demonstrates decoupling of compatibility_score from evidence_confidence", () => {
  // SC-09: high compatibility + low confidence
  const sc09 = GOLDEN_SCENARIOS.find(
    (s) => s.result_id === "SC-09-RES-HIGH-SCORE-LOW-CONF",
  );
  assert.ok(sc09, "Must include SC-09 high-fit low-confidence scenario");
  const cand09 = sc09.supplier_candidates[0];
  assert.ok(cand09);
  assert.ok(
    cand09.fit_assessment.compatibility_score >= 80,
    "SC-09 compatibility score must be high (>=80)",
  );
  assert.equal(
    cand09.fit_assessment.evidence_confidence,
    "low",
    "SC-09 evidence confidence must be low",
  );
  assert.equal(
    cand09.fit_assessment.human_review_required,
    true,
    "SC-09 must require human review",
  );

  // SC-01: high compatibility + high confidence
  const sc01 = GOLDEN_SCENARIOS.find(
    (s) => s.result_id === "SC-01-RES-POULTRY-BR",
  );
  assert.ok(sc01);
  const cand01 = sc01.supplier_candidates[0];
  assert.ok(cand01);
  assert.ok(cand01.fit_assessment.compatibility_score >= 80);
  assert.equal(cand01.fit_assessment.evidence_confidence, "high");

  // SC-10: no match (0 candidates)
  const sc10 = GOLDEN_SCENARIOS.find(
    (s) => s.result_id === "SC-10-RES-NO-MATCH-HEATER",
  );
  assert.ok(sc10);
  assert.equal(sc10.research_status, "no_strong_match");
  assert.equal(sc10.supplier_candidates.length, 0);

  // SC-11: insufficient evidence
  const sc11 = GOLDEN_SCENARIOS.find(
    (s) => s.result_id === "SC-11-RES-SPARSE-TITANIUM",
  );
  assert.ok(sc11);
  assert.equal(sc11.research_status, "insufficient_evidence");

  // SC-12: conflicting evidence
  const sc12 = GOLDEN_SCENARIOS.find(
    (s) => s.result_id === "SC-12-RES-CONFLICT-MEAT",
  );
  assert.ok(sc12);
  assert.ok(sc12.claims.some((c) => c.conflict_status === "conflicting"));
});
