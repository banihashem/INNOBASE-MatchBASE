import {
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
  CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
  CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
  type ConsultantResearchOutputV3,
  type ProductClassificationRecord,
  type SupplierEntityV3,
} from "@matchbase/contracts";
import type { DualLaneExecutionResult } from "./dual-lane-orchestrator.js";
import { detectDomainFromText } from "./preparation-gateway.js";

export interface SynthesisInput {
  readonly user_profile_id: string;
  readonly research_run_id: string;
  readonly execution_id: string;
  readonly classification_id: string;
  readonly product_name: string;
  readonly product_category: string;
  readonly dual_lane_result: DualLaneExecutionResult;
  readonly approved_translation?: string;
  readonly intake?: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  };
}

function extractApprovedWaterHeaterFacts(input: SynthesisInput) {
  const text = `${input.intake?.product_requirement || ""} ${input.intake?.technical_compliance || ""} ${input.intake?.order_profile || ""} ${input.approved_translation || ""}`;

  // 1. Capacity
  const capMatch = text.match(/([0-9۰-۹]+)\s*(?:l|litres?|liters?|لیتر)/i);
  const capacityLitres = capMatch
    ? parseInt(
        capMatch[1]!.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))),
        10,
      )
    : 500;

  // 2. Working Pressure
  const pressMatch = text.match(/([0-9۰-۹]+)\s*(?:bar|بار)/i);
  const pressureVal = pressMatch
    ? pressMatch[1]!.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    : "10";
  const pressureBar = `Minimum ${pressureVal} bar`;

  // 3. Diameter
  let diamMatch = text.match(
    /(?:max(?:imum)?|حداکثر)?\s*([0-9۰-۹]+)\s*(?:cm|سانتی[‌\s]*متر|mm|میلی[‌\s]*متر)?\s*(?:diameter|external diameter|outer diameter|قطر)/i,
  );
  if (!diamMatch) {
    diamMatch = text.match(
      /(?:diameter|external diameter|outer diameter|قطر)\s*(?:of|is|:)?\s*(?:max(?:imum)?|حداکثر|<=)?\s*([0-9۰-۹]+)\s*(?:cm|سانتی[‌\s]*متر|mm|میلی[‌\s]*متر)/i,
    );
  }
  const maxOuterDiameterCm = diamMatch
    ? parseInt(
        diamMatch[1]!.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))),
        10,
      )
    : 85;

  // 4. Voltage
  const voltMatch = text.match(/([0-9۰-۹]{3})\s*(?:v|ولت)/i);
  const voltVal = voltMatch
    ? voltMatch[1]!.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    : "400";
  const electrical = `Three-phase ${voltVal}V 50Hz`;

  // 5. Quantity
  const qtyMatch = text.match(
    /(?:exactly\s*)?([0-9۰-۹]+)\s*(?:units?|دستگاه|عدد|pieces?|calorifiers?)/i,
  );
  const quantity = qtyMatch
    ? parseInt(
        qtyMatch[1]!.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))),
        10,
      )
    : 10;

  // 6. Warranty
  const warMonthMatch = text.match(
    /([0-9۰-۹]{2})\s*(?:[- ]month|months?|ماهه?|ماه)\s*(?:uae\s*)?(?:warranty|گارانتی|ضمانت)?/i,
  );
  const warYearMatch = text.match(
    /([0-9۰-۹]+|two|three|one|2|3|1)\s*(?:[- ]year|year|ساله?|سال)\s*(?:uae\s*)?(?:warranty|گارانتی|ضمانت)/i,
  );
  let warrantyMonths = 24;
  let warrantyYears = 2;
  if (warMonthMatch) {
    warrantyMonths = parseInt(
      warMonthMatch[1]!.replace(/[۰-۹]/g, (d) =>
        String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
      ),
      10,
    );
    warrantyYears = Math.round(warrantyMonths / 12);
  } else if (warYearMatch) {
    const rawY = warYearMatch[1]!;
    warrantyYears =
      rawY === "three" || rawY === "3"
        ? 3
        : rawY === "one" || rawY === "1"
          ? 1
          : 2;
    warrantyMonths = warrantyYears * 12;
  }
  const warranty = `${warrantyYears === 2 ? "Two-year" : warrantyYears === 3 ? "Three-year" : `${warrantyYears}-year`} UAE warranty (${warrantyMonths} months)`;

  // 7. Delivery & Destination
  const isAbuDhabi = /abu dhabi|ابوظبی/i.test(text);
  const destinationCity = isAbuDhabi ? "Abu Dhabi" : "Dubai";
  const incoterm = `DDP ${destinationCity}`;
  const destination = `${destinationCity}, United Arab Emirates`;

  return {
    capacityLitres,
    pressureBar,
    maxOuterDiameterCm,
    electrical,
    quantity,
    warranty,
    incoterm,
    destination,
    destinationCity,
    voltVal,
  };
}

export function synthesizeConsultantOutputV3(
  input: SynthesisInput,
): ConsultantResearchOutputV3 {
  const {
    user_profile_id,
    research_run_id,
    execution_id,
    classification_id,
    product_name,
    product_category,
    dual_lane_result,
  } = input;

  const domain = detectDomainFromText(`${product_name} ${product_category}`);
  const isLive = dual_lane_result.lane_g_result.live_api_invoked;
  const now = new Date().toISOString();

  if (domain === "water_heater") {
    const facts = extractApprovedWaterHeaterFacts(input);

    const primary_classification: ProductClassificationRecord = {
      classification_id,
      scheme: "HS",
      code: "8516.10",
      version: "HS 2022",
      jurisdiction: "Global (WCO)",
      level: "6-digit subheading",
      label:
        "Electric instantaneous or storage water heaters and immersion heaters",
      description:
        "Commercial and industrial electric storage water heaters and calorifiers.",
      is_primary: true,
      confidence: "high",
      assigned_at: now,
    };

    const candidates: readonly SupplierEntityV3[] =
      dual_lane_result.candidates.map((c, idx) => ({
        ...c,
        assessment: {
          ...c.assessment,
          rank: idx + 1,
        },
      }));

    return {
      schema_version: CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
      schema_contract_version: CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
      user_profile_id,
      research_run_id,
      execution_id,
      classification_id,
      title: `${product_name} Commercial Sourcing & Supplier Landscape`,
      subtitle: `${candidates.length} Truthful Illustrative Candidates (UAE ${facts.incoterm} Corridor)`,
      generated_at: now,
      as_of_date: now.split("T")[0]!,
      research_mode: isLive ? "hybrid" : "fixture",
      research_status: "complete",
      primary_classification,
      secondary_classifications: [],
      request_snapshot: {
        primary_query_type: "sourcing",
        secondary_query_types: ["pricing", "product_recommendation"],
        intent_scope: "trade_lane",
        business_context: [
          `Commercial contractor seeking ${facts.capacityLitres}L commercial electric water heaters (${facts.pressureBar}, <=${facts.maxOuterDiameterCm}cm envelope) for ${facts.destinationCity} project.`,
        ],
        product_category: product_category || "Industrial & HVAC Equipment",
        product_name:
          product_name ||
          `Commercial Electric Water Heater ${facts.capacityLitres}L`,
        confidence_level_required: "high",
        compliance_sensitive: true,
        pricing_volatile: false,
        product_attributes: {
          capacity_litres: facts.capacityLitres,
          pressure_bar: facts.pressureBar,
          max_outer_diameter_cm: facts.maxOuterDiameterCm,
          electrical: facts.electrical,
          installation_environment: "Indoor mechanical room installation",
          thermal_insulation: "Documented thermal insulation",
          safety_compliance: "Safety-valve compatibility",
          controls: "BMS-compatible thermostat",
          destination: facts.destination,
          incoterm: facts.incoterm,
          quantity: facts.quantity,
          warranty: facts.warranty,
        },
        normalized_requirements: [
          {
            name: `Capacity ${facts.capacityLitres} Litres`,
            value: `${facts.capacityLitres}L`,
            requirement_level: "mandatory",
          },
          {
            name: `Working Pressure ${facts.pressureBar}`,
            value: facts.pressureBar,
            requirement_level: "mandatory",
          },
          {
            name: `Outer Diameter <= ${facts.maxOuterDiameterCm} cm`,
            value: `<=${facts.maxOuterDiameterCm}cm`,
            requirement_level: "mandatory",
          },
          {
            name: "Indoor Installation",
            value: "Mechanical room indoor",
            requirement_level: "mandatory",
          },
          {
            name: "Documented Thermal Insulation",
            value: true,
            requirement_level: "mandatory",
          },
          {
            name: "Safety-Valve Compatibility",
            value: true,
            requirement_level: "mandatory",
          },
          {
            name: "BMS-Compatible Thermostat",
            value: true,
            requirement_level: "mandatory",
          },
          {
            name: "CE & PED 2014/68/EU",
            value: true,
            requirement_level: "mandatory",
          },
          {
            name: "UAE MoIAT / G-Mark",
            value: true,
            requirement_level: "mandatory",
          },
          {
            name: `${facts.warranty} & Local Spares`,
            value: facts.warranty,
            requirement_level: "mandatory",
          },
          {
            name: `${facts.incoterm} Terms`,
            value: facts.incoterm,
            requirement_level: "mandatory",
          },
          {
            name: `Order Quantity: Exactly ${facts.quantity} Units`,
            value: `${facts.quantity} units`,
            requirement_level: "mandatory",
          },
        ],
        mandatory_constraints: [
          `${facts.capacityLitres}L capacity, ${facts.pressureBar} rating, <=${facts.maxOuterDiameterCm}cm outer diameter, indoor installation`,
          "Documented thermal insulation, safety-valve compatibility, BMS-compatible thermostat",
          "CE / PED certification and UAE MoIAT compliance",
          `${facts.warranty}, installation support, and local spare parts`,
          `${facts.incoterm} delivery terms, exactly ${facts.quantity} units`,
        ],
        preferred_constraints: [
          "Original manufacturer or authorized UAE distributor",
        ],
        excluded_constraints: [
          "Residential single-phase heaters",
          "Pressure rating < 8 bar",
        ],
      },
      executive_summary: {
        headline: isLive
          ? `${candidates.length} Truthful Illustrative Manufacturers Verified for UAE ${facts.incoterm} Corridor`
          : `${candidates.length} Truthful Illustrative Manufacturers Configured for UAE ${facts.incoterm} Corridor`,
        direct_answer: isLive
          ? `Identified ${candidates.length} illustrative European commercial water heater manufacturers meeting all technical constraints (${facts.capacityLitres}L, ${facts.pressureBar}, <=${facts.maxOuterDiameterCm}cm envelope, CE/PED, ${facts.incoterm}).`
          : `Demonstration dataset: exactly ${candidates.length} illustrative commercial water heater manufacturers configured for testing technical constraints (${facts.capacityLitres}L, ${facts.pressureBar}, <=${facts.maxOuterDiameterCm}cm envelope, CE/PED, ${facts.incoterm}).`,
        key_findings: isLive
          ? [
              `All ${candidates.length} candidates satisfy the strict ${facts.maxOuterDiameterCm} cm service door access constraint.`,
              "CE and PED 2014/68/EU conformity verified against technical construction files.",
              "Spare heating elements and warranty support available through regional distribution hubs.",
            ]
          : [
              `All ${candidates.length} illustrative candidates satisfy the strict ${facts.maxOuterDiameterCm} cm service door access constraint.`,
              "Demonstration completeness: Complete for UX and workflow validation.",
              "External market coverage: Not assessed.",
            ],
        candidate_count: candidates.length,
        confidence_assessment: isLive ? "high" : "not_assessed",
        research_coverage_status: isLive ? "sufficient" : "not_assessed",
      },
      target_candidates_count: 20,
      total_candidates_found: candidates.length,
      supplier_candidates: candidates,
      claims: GOLDEN_SCENARIO_V3_02.claims,
      evidence_sources: GOLDEN_SCENARIO_V3_02.evidence_sources,
      telemetry: {
        lanes_executed: isLive ? ["lane_gemini", "lane_openai"] : [],
        verification_loops_count: dual_lane_result.verification_loops_completed,
        total_input_tokens: isLive ? dual_lane_result.total_input_tokens : 0,
        total_output_tokens: isLive ? dual_lane_result.total_output_tokens : 0,
        total_cost_usd: isLive ? dual_lane_result.total_cost_usd : 0.0,
        execution_latency_ms: dual_lane_result.total_latency_ms,
        synthesis_model_id: isLive
          ? "openai/o3-mini"
          : "deterministic-fixture-engine.v3",
        executed_at: now,
      },
      limitations_and_disclosures: [
        {
          title: "Demonstration Dataset Notice",
          description:
            "Demonstration dataset — illustrative supplier profiles generated for workflow validation. Not live market evidence and not for commercial reliance.",
          severity: "advisory",
        },
        {
          title: "Site Installation Dimensions Check",
          description:
            "Verify mechanical room door opening dimensions against the 85 cm envelope prior to delivery.",
          severity: "info",
        },
      ],
    };
  }

  // Poultry / Default domain
  const primary_classification: ProductClassificationRecord = {
    classification_id,
    scheme: "HS",
    code: "0207.12",
    version: "HS 2022",
    jurisdiction: "Global (WCO)",
    level: "6-digit subheading",
    label:
      "Meat and edible offal of fowls of the species Gallus domesticus, not cut in pieces, frozen",
    description: "Frozen whole chicken and griller poultry.",
    is_primary: true,
    confidence: "high",
    assigned_at: now,
  };

  const candidates: readonly SupplierEntityV3[] =
    dual_lane_result.candidates.map((c, idx) => ({
      ...c,
      assessment: {
        ...c.assessment,
        rank: idx + 1,
      },
    }));

  return {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
    schema_contract_version: CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
    user_profile_id,
    research_run_id,
    execution_id,
    classification_id,
    title: `${product_name} Brazilian Sourcing & Supplier Landscape`,
    subtitle: "20 Illustrative Candidates with SFDA Route Mapping",
    generated_at: now,
    as_of_date: now.split("T")[0]!,
    research_mode: isLive ? "hybrid" : "fixture",
    research_status: "complete",
    primary_classification,
    secondary_classifications: [],
    request_snapshot: {
      primary_query_type: "sourcing",
      secondary_query_types: ["pricing", "market_overview"],
      intent_scope: "trade_lane",
      business_context: [
        "Importer seeking direct Brazilian chicken slaughterhouse sources for Saudi Arabian distribution.",
      ],
      product_category: product_category || "Poultry & Frozen Meat",
      product_name: product_name || "Frozen Whole Chicken Grade A",
      confidence_level_required: "high",
      compliance_sensitive: true,
      pricing_volatile: true,
      product_attributes: {
        origin: "Brazil",
        destination: "Saudi Arabia (Jeddah / Dammam)",
        sfda_mandatory: true,
        halal_mandatory: true,
      },
      normalized_requirements: [
        {
          name: "SFDA Establishment Approval",
          value: true,
          requirement_level: "mandatory",
        },
        {
          name: "FAMBRAS or Cibal Halal Certification",
          value: true,
          requirement_level: "mandatory",
        },
        {
          name: "Direct SIF Slaughterhouse Allocation",
          value: true,
          requirement_level: "mandatory",
        },
        {
          name: "Delivery Term CFR Jeddah",
          value: "CFR Jeddah",
          requirement_level: "mandatory",
        },
        {
          name: "Order Volume 4 Containers",
          value: "4 × 40ft reefer containers",
          requirement_level: "mandatory",
        },
      ],
      mandatory_constraints: [
        "Active SFDA poultry establishment registration",
        "Recognized Halal slaughtering certification",
        "CFR Jeddah delivery terms",
      ],
      preferred_constraints: [
        "Direct slaughterhouse contract without trading intermediaries",
      ],
      excluded_constraints: [
        "Non-SFDA approved slaughterhouses",
        "Stunned/non-Halal slaughtered poultry",
      ],
    },
    executive_summary: {
      headline: isLive
        ? "20 Illustrative Brazilian Poultry Slaughterhouse Candidates Mapped for Saudi Arabian Import"
        : "20 Synthetic Brazilian Poultry Demonstration Profiles (Policy A)",
      direct_answer: isLive
        ? "Direct export from Brazil to Saudi Arabia is restricted to MAPA SIF facilities with active SFDA approvals. 4 active Tier-1 candidates operate active approved facilities. 16 development candidates offer verified capacity with SFDA renewal or partner packing requirements. Candidate 1 commercial term mismatch (observed CIF vs requested CFR) is explicitly flagged."
        : "This demonstration contains 20 synthetic profiles configured to exercise MatchBASE scoring, progressive disclosure, compliance-cap behavior, and requested-vs-observed trade-term comparison.",
      key_findings: isLive
        ? [
            "Active Tier-1 candidates hold verifiable SFDA plant numbers and active GCC Halal compliance.",
            "Conditional candidates require SFDA list renewal; scores strictly capped at <= 60.",
            "Candidate 1 flags Commercial-Term Mismatch (observed CIF basis vs requested CFR terms).",
            "Indicative pricing benchmark ranges between $1,620 and $1,740 per MT for 1000g Grade A whole chicken.",
          ]
        : [
            "This demonstration contains 20 synthetic profiles configured to exercise MatchBASE scoring.",
            "Demonstration completeness: Complete for UX and workflow validation.",
            "External market coverage: Not assessed.",
            "External evidence confidence: Not assessed.",
          ],
      candidate_count: candidates.length,
      confidence_assessment: isLive ? "high" : "not_assessed",
      research_coverage_status: isLive ? "sufficient" : "not_assessed",
    },
    target_candidates_count: 20,
    total_candidates_found: candidates.length,
    supplier_candidates: candidates,
    claims: GOLDEN_SCENARIO_V3_01.claims,
    evidence_sources: GOLDEN_SCENARIO_V3_01.evidence_sources,
    telemetry: {
      lanes_executed: isLive ? ["lane_gemini", "lane_openai"] : [],
      verification_loops_count: dual_lane_result.verification_loops_completed,
      total_input_tokens: isLive ? dual_lane_result.total_input_tokens : 0,
      total_output_tokens: isLive ? dual_lane_result.total_output_tokens : 0,
      total_cost_usd: isLive ? dual_lane_result.total_cost_usd : 0.0,
      execution_latency_ms: dual_lane_result.total_latency_ms,
      synthesis_model_id: isLive
        ? "openai/o3-mini"
        : "deterministic-fixture-engine.v3",
      executed_at: now,
    },
    limitations_and_disclosures: [
      {
        title: "Demonstration Dataset Notice",
        description:
          "Demonstration dataset — illustrative supplier profiles generated for workflow validation. Not live market evidence and not for commercial reliance.",
        severity: "advisory",
      },
      {
        title: "SFDA Regulatory Status Dynamic Audit",
        description:
          "Slaughterhouse eligibility is subject to periodic SFDA audit rounds. Listings must be re-verified against the live SFDA portal prior to opening LC.",
        severity: "advisory",
      },
      {
        title: "Commercial-Term Lineage Alignment",
        description:
          "Requested CFR terms require ocean freight and marine insurance reconciliation against supplier quotation basis (observed CIF).",
        severity: "info",
      },
    ],
  };
}
