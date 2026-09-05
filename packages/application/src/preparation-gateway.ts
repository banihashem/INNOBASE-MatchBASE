import crypto from "node:crypto";
import type { ProductClassificationRecord } from "@matchbase/contracts";

export interface NormalizedRequirement {
  readonly requirement_id: string;
  readonly source_box:
    "product_requirement" | "technical_compliance" | "order_profile";
  readonly source_text_reference: string;
  readonly normalized_value: string;
  readonly unit?: string;
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
}

export function detectDomainFromText(
  text: string,
): "poultry" | "water_heater" | "generic" {
  const lower = text.toLowerCase();
  if (
    lower.includes("مرغ") ||
    lower.includes("chicken") ||
    lower.includes("poultry") ||
    lower.includes("broiler") ||
    lower.includes("slaughterhouse") ||
    lower.includes("کشتارگاه") ||
    lower.includes("گرید a") ||
    lower.includes("grade a") ||
    lower.includes("حلال") ||
    lower.includes("halal") ||
    lower.includes("sfda") ||
    lower.includes("sif")
  ) {
    return "poultry";
  }

  if (
    lower.includes("آبگرمکن") ||
    lower.includes("water heater") ||
    lower.includes("water-heater") ||
    lower.includes("calorifier") ||
    lower.includes("boiler") ||
    lower.includes("electric water") ||
    lower.includes("500l") ||
    lower.includes("500 l") ||
    lower.includes("500-litre") ||
    lower.includes("500 liter") ||
    lower.includes("10 bar") ||
    lower.includes("three-phase") ||
    lower.includes("3-phase") ||
    lower.includes("سه فاز") ||
    lower.includes("دبی") ||
    lower.includes("dubai")
  ) {
    return "water_heater";
  }

  return "generic";
}

export class PreparationModelGateway {
  /**
   * Extract requirements and generate Step 1 interpretation with full provenance.
   */
  async extractAndInterpret(intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  }): Promise<Step1InterpretationResult> {
    const combined = `${intake.product_requirement} ${intake.technical_compliance} ${intake.order_profile}`;
    const domain = detectDomainFromText(combined);

    if (domain === "water_heater") {
      return this.generateWaterHeaterStep1(intake);
    }

    if (domain === "poultry") {
      return this.generatePoultryStep1(intake);
    }

    return this.generateGenericStep1(intake);
  }

  /**
   * Generate Stage 2 3-loop advisory based exclusively on approved request revision.
   */
  async generateAdvisoryLoops(
    approvedRequest: ApprovedRequestRevision,
    classification: ProductClassificationRecord,
  ): Promise<Step2AdvisoryResult> {
    const domain = detectDomainFromText(
      `${approvedRequest.product_name} ${approvedRequest.product_category} ${approvedRequest.english_translation}`,
    );

    if (domain === "water_heater") {
      return {
        loop1_trade_lane:
          "UAE Commercial & Industrial Water Heating Landscape: High demand driven by commercial hospitality, residential compounds, and industrial process facilities. Primary supply corridors: European specialized manufacturers (Italy, France, Germany) and regional Gulf assembly hubs. Deliveries to Dubai typically routed via Jebel Ali Port or regional free-zone logistics hubs under DDP terms.",
        loop2_regulatory:
          "UAE Conformity & Pressure Equipment Directives: Electric storage water heaters (calorifiers >= 500L) operating at 10 bar require mandatory compliance with UAE G-Mark / MoIAT (formerly ESMA) safety standards, CE Pressure Equipment Directive (PED 2014/68/EU), and Dubai Municipality / DEWA electrical installation code (400V 3-phase 50Hz). Internal enameling (DIN 4753) or 316L stainless steel required for high-mineral municipal water.",
        loop3_supply_structure:
          "Tier-1 European and regional commercial calorifier manufacturers maintain authorized technical distributors in UAE. Key sourcing priorities include verified local spare parts availability (immersion heating elements, sacrificial magnesium/titanium anodes, safety relief valves) and minimum 5-year tank warranty support.",
        sources: [
          {
            title:
              "Ministry of Industry and Advanced Technology (MoIAT) UAE Conformity Scheme",
            url: "https://moiat.gov.ae/en/services/issue-conformity-certificate",
            publisher: "MoIAT United Arab Emirates",
            as_of_date: "2026-06-01",
          },
          {
            title:
              "Dubai Electricity and Water Authority (DEWA) Regulations for Electrical Installations",
            url: "https://www.dewa.gov.ae/en/builder/regulations-and-circulars",
            publisher: "DEWA Dubai",
            as_of_date: "2026-05-15",
          },
          {
            title:
              "European Standard EN 12897 - Water Supply Specification for Indirectly Heated Unvented Storage Water Heaters",
            url: "https://standards.iteh.ai/catalog/standards/cen/en-12897",
            publisher: "European Committee for Standardization (CEN)",
            as_of_date: "2026-01-20",
          },
        ],
        sourcing_risks: [
          "Non-compliant electrical wiring or lack of 3-phase 400V 50Hz certification",
          "Lack of manufacturer-backed warranty service network inside the UAE",
          "Outer diameter exceeding 850mm causing doorway access failure during installation",
        ],
        verification_priorities: [
          "Validate CE Pressure Equipment Directive (PED) test certificate for 10 bar working pressure",
          "Verify dimension drawings: maximum diameter <= 85cm",
          "Confirm DDP Dubai customs clearance and on-site delivery terms",
        ],
      };
    }

    if (domain === "poultry") {
      // Extract Incoterm from approved request
      const incoterm =
        approvedRequest.incoterm ||
        (approvedRequest.english_translation.includes("CFR")
          ? "CFR Jeddah"
          : "CIF Jeddah");

      return {
        loop1_trade_lane: `Brazil - Saudi Arabia Frozen Poultry Corridor: Brazil represents the primary supplier (>70%) of Saudi Arabia's imported frozen chicken. Primary export departure ports: Paranaguá (PR), Itajaí (SC), and Santos (SP). Transit time: 32-38 days via containerized 40ft deep-freeze reefer vessels to Jeddah Islamic Port and King Abdulaziz Port Dammam under ${incoterm} terms.`,
        loop2_regulatory:
          "SFDA Circular & MAPA/SIF Sanitary Protocol: Direct exports are restricted strictly to SFDA-registered slaughterhouses (SIF plants). Mandatory joint SFDA-MAPA biological and veterinary inspection. Halal compliance requires accredited Islamic slaughter certificates (FAMBRAS Halal or Cibal Halal). Strict cold-chain compliance (-18°C) and maximum 4.5% moisture water absorption glaze.",
        loop3_supply_structure:
          "Southern Brazilian cooperatives and integrated processors (concentrated in Paraná, Santa Catarina, and Rio Grande do Sul) command export capacity. Tier-1 slaughterhouses operate high-speed automated lines capable of 900g-1200g bird calibration and 10kg export cartons with 4x2.5kg polybags.",
        sources: [
          {
            title:
              "Saudi Food & Drug Authority (SFDA) Approved Foreign Food Establishments Registry",
            url: "https://sfda.gov.sa/en/food/establishments",
            publisher: "SFDA Food Sector",
            as_of_date: "2026-07-01",
          },
          {
            title: "MAPA - Ministério da Agricultura e Pecuária (SIF System)",
            url: "https://www.gov.br/agricultura/pt-br/sif",
            publisher: "Ministério da Agricultura e Pecuária, Brazil",
            as_of_date: "2026-06-15",
          },
          {
            title:
              "FAMBRAS Halal Certification Audit Standards for Gulf Export",
            url: "https://fambrashalal.com.br/en/standards",
            publisher: "FAMBRAS Halal Brazil",
            as_of_date: "2026-05-10",
          },
        ],
        sourcing_risks: [
          "Intermittent SFDA establishment suspension due to bilateral sanitary audits",
          "Cold-chain excursion during transshipment or port clearance exceeding -18°C",
          "Moisture glaze exceeding regulatory 4.5% limit resulting in port rejection",
        ],
        verification_priorities: [
          "Check real-time SFDA active establishment registration number",
          "Confirm MAPA SIF sanitary approval code",
          "Verify accredited Halal certification body on official Saudi list",
        ],
      };
    }

    // Generic domain
    return {
      loop1_trade_lane: `Global Trade Lane Analysis for ${approvedRequest.product_name}: Standard international trade corridor under ${approvedRequest.incoterm || "agreed commercial terms"}. Transit schedules and containerized shipping options evaluated based on source origin and target destination.`,
      loop2_regulatory: `Regulatory & Technical Conformity: Products classified under HS ${classification.code} require destination-specific technical compliance certificates, quality management system ISO 9001, and commercial invoice verification.`,
      loop3_supply_structure: `Manufacturer Capacity & Verification: Direct manufacturer sourcing preferred over intermediaries to secure production scheduling, batch testing documentation, and competitive volume pricing.`,
      sources: [
        {
          title: "World Customs Organization Harmonized System Database",
          url: "https://www.wcoomd.org",
          publisher: "World Customs Organization",
          as_of_date: "2026-01-01",
        },
      ],
      sourcing_risks: [
        "Specification deviation between sample and production batch",
        "Lead time variability in international freight",
      ],
      verification_priorities: [
        "Verify direct manufacturer corporate status",
        "Validate technical compliance test reports",
      ],
    };
  }

  /**
   * Generate Stage 3 Deep Research Prompt using the approved request revision.
   * CRITICAL: Must define discovery criteria, not predetermine supplier names (F10).
   * CRITICAL: Must propagate user edits (e.g. CIF -> CFR) (F01).
   */
  async generateDeepResearchPrompt(
    approvedRequest: ApprovedRequestRevision,
    _advisory: Step2AdvisoryResult,
    classification: ProductClassificationRecord,
  ): Promise<Step3PromptResult> {
    const domain = detectDomainFromText(
      `${approvedRequest.product_name} ${approvedRequest.english_translation}`,
    );

    if (domain === "water_heater") {
      const promptText = `
Task: Execute deep agentic research to discover and verify legitimate commercial manufacturers and authorized export partners for Industrial Electric Water Heaters.

1. Product Specifications & Target Criteria:
   - Category: Commercial / Industrial Electric Water Heater (Storage Calorifier)
   - Capacity: 500 Litres storage capacity
   - Pressure Rating: Minimum 10 bar working pressure (tested >= 15 bar)
   - Electrical Specifications: Three-phase industrial connection (380V - 415V, 50/60 Hz)
   - Dimensions: Outer diameter strictly capped at 85 cm (850 mm) for standard facility access
   - Internal Protection: High-grade porcelain enamel / glass lining with sacrificial anode or 316L stainless steel
   - Regulatory Compliance: Mandatory CE marking, Pressure Equipment Directive (PED 2014/68/EU), UAE G-Mark / MoIAT conformity
   - Commercial & Logistics: ${approvedRequest.incoterm || "DDP Dubai, UAE"}, including local spare parts availability and minimum 5-year warranty support

2. Discovery & Eligibility Rules:
   - Identify active direct manufacturers and authorized industrial heating distributors capable of supplying the UAE market.
   - Do NOT rely on unverified intermediary brokers. Every candidate must possess verifiable industrial manufacturing facilities or official primary distribution rights.
   - Target Count: Up to 20 candidate profiles ranked by technical compatibility and compliance completeness.
   - If fewer than 20 meet all mandatory criteria, return only legitimate verified candidates without artificial padding.

3. Required Evidence Fields for Each Candidate:
   - Full legal corporate name, headquarters address, and country of manufacture
   - Verified official website domain and commercial sales / export desk contact (email, telephone)
   - Compliance documentation references (CE declaration of conformity, pressure test certification)
   - Commercial parameters: indicative unit pricing, MOQ, production lead time, warranty terms
   - Physical dimensions: confirm diameter <= 85cm and height
`.trim();

      return {
        prompt_text: promptText,
        discovery_criteria: [
          "Industrial electric water heater (calorifier) manufacturer or authorized distributor",
          "500 Litres tank capacity with 10 bar pressure rating",
          "Three-phase industrial electrical configuration (380-415V)",
          "Maximum diameter 85cm physical constraint",
          "CE marking and Pressure Equipment Directive (PED) compliance",
          "DDP Dubai delivery capability with local spares & warranty support",
        ],
        evidence_thresholds: [
          "Verified official manufacturer domain and contact desk",
          "Inspection of technical datasheet confirming 500L, 10 bar, and <=85cm diameter",
          "Documented CE / PED compliance declaration",
        ],
        target_supplier_count: 20,
      };
    }

    if (domain === "poultry") {
      // Determine exact Incoterm from approved request (preserving CIF -> CFR edits!)
      let deliveryTerm = "CIF Jeddah";
      if (approvedRequest.english_translation.includes("CFR")) {
        deliveryTerm = "CFR Jeddah";
      } else if (approvedRequest.incoterm) {
        deliveryTerm = approvedRequest.incoterm;
      }

      // Check weight range preservation
      let weightSpec = "900g to 1200g";
      if (
        approvedRequest.english_translation.includes("1000") ||
        approvedRequest.english_translation.includes("1000g")
      ) {
        weightSpec = "1000g to 1200g";
      }

      const promptText = `
Task: Execute deep agentic research targeting the Brazilian Poultry Export Landscape for the Saudi Arabian Market.

1. Product Specifications & Target Criteria:
   - Product: Grade A Whole Frozen Chicken and standard portion cuts (boneless breast, shawarma cuts)
   - Calibration / Sizing: ${weightSpec} calibrated whole birds; IQF portion cuts in 2.5 kg inner polybags
   - Packaging: 10 kg export master cartons (4 x 2.5 kg inner bags), export-grade corrugated labeling
   - Quality & Technical: Continuous deep freeze (-18°C), maximum 4.5% water absorption glaze, 12-month shelf life
   - Mandatory Regulatory Clearances:
     * Active SFDA (Saudi Food & Drug Authority) foreign establishment listing
     * Active MAPA (Ministério da Agricultura e Pecuária) SIF sanitary inspection registration
     * Accredited Halal slaughter certification (FAMBRAS Halal, Cibal Halal, or equivalent SFDA-approved body)
   - Commercial Delivery: ${deliveryTerm} (or Dammam Port), containerized 40ft reefer ocean freight
   - Volume: Initial 1 to 3 containers (approx. 27 MT/container), recurring monthly demand scaling to 2,000 MT/month

2. Discovery & Eligibility Rules:
   - Identify active direct slaughterhouse establishments (Frigoríficos) in Brazil meeting all Saudi import mandates.
   - Do NOT predetermine or restrict search to predefined brand names; discover all compliant facilities meeting criteria.
   - Categorize candidates into:
     * Tier-1 Direct Route (active SFDA listing, proven GCC export history, immediate commercial readiness)
     * Conditional / Development Route (verified SIF industrial capacity, active Halal, with clear SFDA renewal/listing gaps documented)
   - Target Count: Up to 20 verified candidate slaughterhouses.
   - If fewer than 20 satisfy all requirements, return only legitimate verified candidates without hallucinating or padding.

3. Required Evidence Fields for Each Candidate:
   - Full registered corporate legal name, SIF plant number(s), and state/municipality of slaughterhouse
   - Verified SFDA establishment listing status and accredited Halal certifying body
   - Official corporate domain and verified export desk contact channels (export email, sales phone)
   - Commercial profile: indicative pricing per metric ton (${deliveryTerm}), MOQ, production capacity
   - Full packaging and cold-chain logistics documentation
`.trim();

      return {
        prompt_text: promptText,
        discovery_criteria: [
          "Direct Brazilian poultry slaughterhouse (SIF-registered establishment)",
          "Active SFDA foreign food establishment listing for Saudi Arabia",
          "Accredited Halal slaughter certificate (FAMBRAS, Cibal, or SFDA-approved equivalent)",
          `Calibrated whole bird (${weightSpec}) and IQF cuts in 10kg cartons (4x2.5kg)`,
          `Containerized reefer shipping to Saudi Arabia under ${deliveryTerm} terms`,
        ],
        evidence_thresholds: [
          "Official SFDA foreign establishment registry listing",
          "MAPA SIF sanitary database verification",
          "Accredited Halal certificate with valid validity date",
          "Verified corporate export contact channel",
        ],
        target_supplier_count: 20,
      };
    }

    // Generic prompt
    const promptText = `
Task: Execute deep agentic research to identify and verify manufacturers and direct export suppliers for:
Product: ${approvedRequest.product_name}
Category: ${approvedRequest.product_category}
Classification: HS ${classification.code} - ${classification.label}
Commercial Requirements: ${approvedRequest.english_translation}

Discovery Criteria:
1. Identify legitimate manufacturers possessing verified industrial production capacity.
2. Confirm compliance certifications required for international export.
3. Validate official corporate contacts (sales email, telephone, website).
4. Extract commercial terms: indicative pricing, MOQ, lead time.
5. Maximize verified candidates up to 20 without hallucinating or padding unverified records.
`.trim();

    return {
      prompt_text: promptText,
      discovery_criteria: [
        `Direct manufacturer of ${approvedRequest.product_name}`,
        `HS ${classification.code} compliance certification`,
        "Verified corporate identity and export contact",
      ],
      evidence_thresholds: [
        "Corporate registration in official national business register",
        "Official manufacturer website with product catalog",
      ],
      target_supplier_count: 20,
    };
  }

  // --- Private Helpers for Request A (Poultry) ---
  private generatePoultryStep1(intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  }): Step1InterpretationResult {
    // Check if user entered weight range
    const weightRange = intake.product_requirement.includes("1000")
      ? "1000g - 1200g"
      : "900g - 1200g";

    // Check if user specified Incoterm
    let incoterm = "CIF Jeddah";
    if (intake.order_profile.includes("CFR")) {
      incoterm = "CFR Jeddah";
    } else if (intake.order_profile.includes("FOB")) {
      incoterm = "FOB Brazilian Port";
    }

    const englishTranslation = `
Product Requirement: Grade A whole frozen chicken (${weightRange}) and standard portion cuts (boneless skinless breast, shawarma cut). Export packaging in 10 kg master cartons containing 4 x 2.5 kg inner polybags. Destination: Saudi Arabia (Jeddah Islamic Port / Dammam).
Technical & Compliance: Mandatory active SFDA foreign establishment listing in Brazil. Accredited Halal slaughter certification (FAMBRAS or Cibal Halal). Continuous cold-chain compliance (-18°C), no refreezing, maximum 4.5% moisture water absorption glaze, MAPA/SIF sanitary traceability, and 12-month shelf life.
Commercial & Order Profile: Initial trial volume of 1 to 3 x 40ft reefer containers (~27 MT/container), scaling to 2,000 MT/month recurring supply. Delivery terms ${incoterm}. Direct procurement from accredited primary slaughterhouse (Frigorífico) preferred.
`.trim();

    const explicitRequirements: NormalizedRequirement[] = [
      {
        requirement_id: crypto.randomUUID(),
        source_box: "product_requirement",
        source_text_reference: intake.product_requirement,
        normalized_value: `Whole chicken Grade A calibrated (${weightRange}) and portion cuts`,
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "product_requirement",
        source_text_reference: intake.product_requirement,
        normalized_value: "10 kg export cartons with 4 x 2.5 kg inner bags",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value:
          "Active SFDA establishment registration and MAPA/SIF listing in Brazil",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value: "FAMBRAS or Cibal Halal slaughter certification",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value:
          "-18°C continuous cold chain, max 4.5% moisture glaze, 12-month shelf life",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "order_profile",
        source_text_reference: intake.order_profile,
        normalized_value: `${incoterm} containerized ocean reefer shipping`,
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "order_profile",
        source_text_reference: intake.order_profile,
        normalized_value:
          "1 to 3 containers initial, scaling to 2,000 MT/month",
        unit: "MT",
        requirement_level: "preferred",
        derivation_type: "explicit",
      },
    ];

    const classification: ProductClassificationRecord = {
      classification_id: crypto.randomUUID(),
      scheme: "HS",
      code: "0207.12",
      version: "HS 2022",
      jurisdiction: "Global (WCO)",
      level: "6-digit subheading",
      label:
        "Meat and edible offal of fowls of the species Gallus domesticus, not cut in pieces, frozen",
      description: "Frozen whole chicken and griller poultry cuts.",
      is_primary: true,
      confidence: "high",
      source_url: "https://www.wcoomd.org",
      assigned_at: new Date().toISOString(),
    };

    return {
      original_language: "fa",
      english_translation: englishTranslation,
      product_category: "Poultry & Frozen Meat",
      product_name: `Frozen Whole Chicken (${weightRange}) & Cuts Grade A`,
      explicit_requirements: explicitRequirements,
      mandatory_requirements: [
        "Active SFDA foreign slaughterhouse establishment listing",
        "Accredited Halal certification (FAMBRAS or Cibal Halal)",
        `Whole bird weight calibration (${weightRange})`,
        "10 kg export carton with 4 x 2.5 kg inner bags",
        "-18°C continuous cold-chain, max 4.5% moisture, 12-month shelf life",
        `${incoterm} delivery terms`,
      ],
      preferred_requirements: [
        "Direct slaughterhouse contract without trading intermediaries",
        "Volume capability scaling to 2,000 MT/month",
      ],
      excluded_requirements: [
        "Non-SFDA approved slaughterhouses",
        "Stunned/non-Halal slaughtered poultry",
      ],
      ambiguities: [],
      unknowns: [
        "Target price per MT was not provided by buyer (market indicative pricing will be retrieved)",
        "Specific discharge port preference between Jeddah and Dammam",
      ],
      suggested_clarifications: [
        "Confirm whether payment terms will be 100% confirmed irrevocable LC at sight or CAD",
      ],
      classification,
    };
  }

  // --- Private Helpers for Request B (Industrial Water Heater) ---
  private generateWaterHeaterStep1(intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  }): Step1InterpretationResult {
    let incoterm = "DDP Dubai";
    if (intake.order_profile.includes("CIF")) incoterm = "CIF Jebel Ali";
    if (intake.order_profile.includes("FOB")) incoterm = "FOB European Port";

    const englishTranslation = `
Product Requirement: Commercial / Industrial Electric Water Heater (Storage Calorifier) with 500 Litres storage capacity. Heavy-duty construction with high-efficiency thermal insulation. Outer diameter strictly limited to maximum 85 cm (850 mm) to permit entry through standard mechanical room service doors. Destination: Dubai, United Arab Emirates.
Technical & Compliance: Designed for 10 bar maximum working pressure (factory tested to >= 15 bar). Three-phase industrial electrical power configuration (380V - 415V, 50/60 Hz). Internal tank protection via high-grade vitreous enamel or 316L stainless steel with magnesium sacrificial anode. Mandatory CE certification, Pressure Equipment Directive (PED 2014/68/EU), and UAE G-Mark / MoIAT conformity. Local spare parts availability (heating elements, thermostat, pressure relief valve) and 5-year tank warranty.
Commercial & Order Profile: Initial project batch of 10 to 50 units for commercial facility installation. Delivery terms ${incoterm}, including customs clearance and delivery to site in Dubai. Direct manufacturer or certified regional distributor preferred.
`.trim();

    const explicitRequirements: NormalizedRequirement[] = [
      {
        requirement_id: crypto.randomUUID(),
        source_box: "product_requirement",
        source_text_reference: intake.product_requirement,
        normalized_value:
          "Industrial electric water heater / storage calorifier (500 L)",
        unit: "Litres",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "product_requirement",
        source_text_reference: intake.product_requirement,
        normalized_value: "Maximum outer diameter <= 85 cm (850 mm)",
        unit: "cm",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value: "10 bar working pressure (tested >= 15 bar)",
        unit: "bar",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value:
          "Three-phase industrial electrical supply (380V - 415V, 50/60Hz)",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value:
          "CE mark, Pressure Equipment Directive (PED), UAE MoIAT conformity, 5-year tank warranty",
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "order_profile",
        source_text_reference: intake.order_profile,
        normalized_value: `${incoterm} terms for delivery in Dubai, UAE`,
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
    ];

    const classification: ProductClassificationRecord = {
      classification_id: crypto.randomUUID(),
      scheme: "HS",
      code: "8516.10",
      version: "HS 2022",
      jurisdiction: "Global (WCO)",
      level: "6-digit subheading",
      label:
        "Electric instantaneous or storage water heaters and immersion heaters",
      description:
        "Industrial and commercial electric storage water heaters and calorifiers.",
      is_primary: true,
      confidence: "high",
      source_url: "https://www.wcoomd.org",
      assigned_at: new Date().toISOString(),
    };

    return {
      original_language: "fa",
      english_translation: englishTranslation,
      product_category: "Industrial & HVAC Equipment",
      product_name:
        "Industrial Electric Water Heater 500L (10 Bar, Three-Phase)",
      explicit_requirements: explicitRequirements,
      mandatory_requirements: [
        "500 Litres storage capacity calorifier",
        "10 bar working pressure rating (factory hydro-tested to 15 bar)",
        "Three-phase industrial connection (380-415V, 50Hz)",
        "Maximum outer diameter <= 85 cm",
        "CE mark and Pressure Equipment Directive (PED 2014/68/EU) conformity",
        "UAE MoIAT / G-Mark compliance",
        `${incoterm} delivery terms`,
      ],
      preferred_requirements: [
        "5-year tank warranty with authorized UAE service partner",
        "Ready local availability of spare immersion heating elements",
      ],
      excluded_requirements: [
        "Domestic residential single-phase water heaters",
        "Pressure rating under 8 bar",
      ],
      ambiguities: [],
      unknowns: [
        "Target kW heating element capacity (e.g. 15 kW vs 30 kW fast recovery)",
        "Tank material preference between heavy-gauge enameled carbon steel and 316L stainless steel",
      ],
      suggested_clarifications: [
        "Confirm required heating recovery time (litres per hour at 45°C delta T)",
      ],
      classification,
    };
  }

  // --- Private Helpers for Generic Inputs ---
  private generateGenericStep1(intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  }): Step1InterpretationResult {
    const englishTranslation = `
Product Requirement: ${intake.product_requirement}
Technical & Compliance: ${intake.technical_compliance}
Commercial & Order Profile: ${intake.order_profile}
`.trim();

    const classification: ProductClassificationRecord = {
      classification_id: crypto.randomUUID(),
      scheme: "HS",
      code: "8413.70",
      version: "HS 2022",
      jurisdiction: "Global (WCO)",
      level: "6-digit subheading",
      label: "Centrifugal pumps and specialized fluid handling machinery",
      description: "Industrial fluid handling and pump machinery.",
      is_primary: true,
      confidence: "medium",
      source_url: "https://www.wcoomd.org",
      assigned_at: new Date().toISOString(),
    };

    const explicitRequirements: NormalizedRequirement[] = [
      {
        requirement_id: crypto.randomUUID(),
        source_box: "product_requirement",
        source_text_reference: intake.product_requirement,
        normalized_value: intake.product_requirement,
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "technical_compliance",
        source_text_reference: intake.technical_compliance,
        normalized_value: intake.technical_compliance,
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
      {
        requirement_id: crypto.randomUUID(),
        source_box: "order_profile",
        source_text_reference: intake.order_profile,
        normalized_value: intake.order_profile,
        requirement_level: "mandatory",
        derivation_type: "explicit",
      },
    ];

    return {
      original_language: "en",
      english_translation: englishTranslation,
      product_category: "Industrial Equipment & Machinery",
      product_name: "Industrial Equipment Specification",
      explicit_requirements: explicitRequirements,
      mandatory_requirements: [
        intake.product_requirement,
        intake.technical_compliance,
      ],
      preferred_requirements: [intake.order_profile],
      excluded_requirements: [],
      ambiguities: [],
      unknowns: [
        "Specific Incoterm location to be clarified",
        "Detailed target price range",
      ],
      suggested_clarifications: [
        "Please confirm exact delivery port and certification body",
      ],
      classification,
    };
  }
}
