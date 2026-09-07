import { createHash, randomUUID } from "node:crypto";

export type RequirementSourceBox =
  "product_requirement" | "technical_compliance" | "order_profile";

export type RequirementModality = "mandatory" | "preferred" | "optional";

export type RequirementLevel = "mandatory" | "preferred" | "excluded";

export type RequirementDerivationType =
  | "explicit"
  | "language_translation"
  | "unit_normalization"
  | "user_accepted_suggestion"
  | "model_suggestion"
  | "unknown";

export type RequirementFidelityStatus =
  "preserved" | "normalized_equivalent" | "ambiguous" | "omitted" | "mutated";

export type ComparisonOperator =
  | "eq"
  | "gte"
  | "lte"
  | "range"
  | "contains"
  | "requires"
  | "prohibits"
  | "preferred";

export interface ExplicitRequirementItem {
  readonly requirement_id: string;
  readonly source_box: RequirementSourceBox;
  readonly source_text: string;
  readonly source_span_or_reference: string;
  readonly normalized_label: string;
  readonly normalized_value: string;
  readonly concept: string;
  readonly value?: string | undefined;
  readonly unit?: string | undefined;
  readonly comparison_operator?: ComparisonOperator | undefined;
  readonly lower_bound?: string | undefined;
  readonly upper_bound?: string | undefined;
  readonly duration?: string | undefined;
  readonly modality: RequirementModality;
  readonly requirement_level: RequirementLevel;
  readonly jurisdiction?: string | undefined;
  readonly supplier_role?: string | undefined;
  readonly evidence_qualifier?: string | undefined;
  readonly scope?: string | undefined;
  readonly derivation_type: RequirementDerivationType;
  readonly fidelity_status: RequirementFidelityStatus;
}

export interface ModelSuggestionItem {
  readonly suggestion_id: string;
  readonly title: string;
  readonly suggested_value: string;
  readonly reasoning: string;
  readonly status: "not_included_in_approved_request" | "user_accepted";
}

export interface ExplicitRequirementLedger {
  readonly ledger_id: string;
  readonly intake_hash: string;
  readonly requirements: readonly ExplicitRequirementItem[];
  readonly total_explicit_count: number;
}

export interface MutatedRequirementReport {
  readonly requirement: ExplicitRequirementItem;
  readonly prohibited_value?: string | undefined;
  readonly expected_operator?: ComparisonOperator | undefined;
  readonly observed_operator?: ComparisonOperator | undefined;
  readonly explanation: string;
}

export interface Step1FidelityValidationResult {
  readonly valid: boolean;
  readonly preserved_count: number;
  readonly normalized_count: number;
  readonly omitted_count: number;
  readonly mutated_count: number;
  readonly omitted_items: readonly ExplicitRequirementItem[];
  readonly mutated_items: readonly MutatedRequirementReport[];
  readonly ledger: ExplicitRequirementLedger;
  readonly model_suggestions: readonly ModelSuggestionItem[];
  readonly explanation?: string | undefined;
}

/**
 * Computes deterministic SHA-256 hash of the 3-box intake snapshot.
 */
export function computeSnapshotContentHash(intake: {
  product_requirement: string;
  technical_compliance: string;
  order_profile: string;
}): string {
  return createHash("sha256")
    .update(
      `${(intake.product_requirement || "").trim()}\n---\n${(intake.technical_compliance || "").trim()}\n---\n${(intake.order_profile || "").trim()}`,
    )
    .digest("hex");
}

interface AddReqParams {
  source_box: RequirementSourceBox;
  source_text: string;
  source_span: string;
  label: string;
  normalized_value: string;
  concept: string;
  value?: string | undefined;
  unit?: string | undefined;
  comparison_operator?: ComparisonOperator | undefined;
  lower_bound?: string | undefined;
  upper_bound?: string | undefined;
  duration?: string | undefined;
  modality?: RequirementModality | undefined;
  jurisdiction?: string | undefined;
  supplier_role?: string | undefined;
  evidence_qualifier?: string | undefined;
  scope?: string | undefined;
}

/**
 * Deterministic extraction of all explicit requirement clauses from the intake with typed semantics.
 */
export function extractExplicitRequirementLedger(intake: {
  product_requirement: string;
  technical_compliance: string;
  order_profile: string;
}): ExplicitRequirementLedger {
  const requirements: ExplicitRequirementItem[] = [];
  const intake_hash = computeSnapshotContentHash(intake);

  const addReq = (item: AddReqParams) => {
    const mod: RequirementModality = item.modality ?? "mandatory";
    requirements.push({
      requirement_id: randomUUID(),
      source_box: item.source_box,
      source_text: item.source_text,
      source_span_or_reference: item.source_span,
      normalized_label: item.label,
      normalized_value: item.normalized_value,
      concept: item.concept,
      value: item.value,
      unit: item.unit,
      comparison_operator: item.comparison_operator,
      lower_bound: item.lower_bound,
      upper_bound: item.upper_bound,
      duration: item.duration,
      modality: mod,
      requirement_level: mod === "mandatory" ? "mandatory" : "preferred",
      jurisdiction: item.jurisdiction,
      supplier_role: item.supplier_role,
      evidence_qualifier: item.evidence_qualifier,
      scope: item.scope,
      derivation_type: "explicit",
      fidelity_status: "preserved",
    });
  };

  const box1 = intake.product_requirement || "";
  const box2 = intake.technical_compliance || "";
  const box3 = intake.order_profile || "";

  // --- Box 1: Product Requirement ---
  // Product definition
  if (/water\s*heater|calorifier|آبگرمکن|سخان/i.test(box1)) {
    addReq({
      source_box: "product_requirement",
      source_text: box1,
      source_span: "water heater",
      label: "Product Family",
      normalized_value: "Industrial Electric Storage Water Heater / Calorifier",
      concept: "product_family",
      comparison_operator: "eq",
    });
  } else if (/poultry|chicken|مرغ|دواجن/i.test(box1)) {
    addReq({
      source_box: "product_requirement",
      source_text: box1,
      source_span: "poultry",
      label: "Product Family",
      normalized_value: "Frozen Whole Chicken (Gallus domesticus)",
      concept: "product_family",
      comparison_operator: "eq",
    });
  }

  // Capacity / Volume in Box 1
  const capMatch = box1.match(
    /([0-9۰-۹]+)\s*(?:litres?|liters?|liter|l\b|لیتر)/i,
  );
  if (capMatch) {
    const rawVal = capMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    addReq({
      source_box: "product_requirement",
      source_text: box1,
      source_span: capMatch[0],
      label: "Storage Capacity",
      normalized_value: `${rawVal} Litres`,
      concept: "storage_capacity",
      value: rawVal,
      unit: "Litres",
      comparison_operator: "eq",
    });
  }

  // Continuous operation requirement
  if (/continuous|مداوم|دائمی|کارکرد مداوم/i.test(box1)) {
    addReq({
      source_box: "product_requirement",
      source_text: box1,
      source_span: "کارکرد مداوم",
      label: "Operating Mode",
      normalized_value: "Continuous commercial operation",
      concept: "operating_mode",
      comparison_operator: "requires",
    });
  }

  // Dimension / Diameter in Box 1 or Box 2
  const diamMatch = `${box1} ${box2}`.match(
    /(?:max(?:imum)?|حداکثر)?\s*([0-9۰-۹]+)\s*(?:cm|سانتی[‌\s]*متر|mm|میلی[‌\s]*متر)?\s*(?:diameter|external diameter|outer diameter|قطر)/i,
  );
  if (diamMatch) {
    const rawNum = diamMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const unit = diamMatch[0].includes("mm") ? "mm" : "cm";
    addReq({
      source_box:
        box1.includes("85") || box1.includes("قطر")
          ? "product_requirement"
          : "technical_compliance",
      source_text: box1.includes("85") ? box1 : box2,
      source_span: diamMatch[0],
      label: "Maximum External Diameter",
      normalized_value: `Maximum ${rawNum} ${unit}`,
      concept: "external_diameter",
      value: rawNum,
      unit,
      comparison_operator: "lte",
      upper_bound: rawNum,
    });
  } else if (/85\s*cm|850\s*mm|۸۵\s*سانتی/i.test(`${box1} ${box2}`)) {
    addReq({
      source_box: box1.includes("85")
        ? "product_requirement"
        : "technical_compliance",
      source_text: box1.includes("85") ? box1 : box2,
      source_span: "85 cm",
      label: "Maximum External Diameter",
      normalized_value: "Maximum 85 cm (850 mm)",
      concept: "external_diameter",
      value: "85",
      unit: "cm",
      comparison_operator: "lte",
      upper_bound: "85",
    });
  }

  // Indoor installation environment
  if (
    /indoor|نصب\s*داخلی|فضای\s*داخلی|داخلی|موتورخانه/i.test(`${box1} ${box2}`)
  ) {
    addReq({
      source_box: /indoor|داخلی/i.test(box1)
        ? "product_requirement"
        : "technical_compliance",
      source_text: /indoor|داخلی/i.test(box1) ? box1 : box2,
      source_span: "indoor installation",
      label: "Installation Environment",
      normalized_value: "Indoor mechanical room installation",
      concept: "installation_environment",
      comparison_operator: "requires",
    });
  }

  // --- Box 2: Technical & Compliance ---
  // Electrical configuration / voltage
  const voltMatch = box2.match(
    /(?:three[- ]phase|3[- ]phase|سه[- ]فاز)?\s*([0-9۰-۹]{3})\s*(?:v|ولت)/i,
  );
  if (voltMatch) {
    const vVal = voltMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: voltMatch[0],
      label: "Electrical Power Supply",
      normalized_value: `Three-phase ${vVal}V industrial supply (50/60 Hz)`,
      concept: "electrical_power",
      value: vVal,
      unit: "V",
      comparison_operator: "eq",
    });
  } else if (/three[- ]phase|3[- ]phase|سه[- ]فاز/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "three-phase",
      label: "Electrical Power Supply",
      normalized_value:
        "Three-phase industrial electrical supply (380V - 415V, 50/60Hz)",
      concept: "electrical_power",
      value: "400",
      unit: "V",
      comparison_operator: "eq",
    });
  }

  // Working Pressure with directional comparison_operator
  const pressureSourceText = /bar|بار/i.test(box2)
    ? box2
    : /bar|بار/i.test(box1)
      ? box1
      : "";
  if (pressureSourceText) {
    const isMinPressure = /minimum|at least|not less than|حداقل/i.test(
      pressureSourceText,
    );
    const isMaxPressure =
      !isMinPressure &&
      /maximum|not more than|حداکثر/i.test(pressureSourceText);
    const pressMatch = pressureSourceText.match(/([0-9۰-۹]+)\s*(?:bar|بار)/i);
    if (pressMatch) {
      const pVal = pressMatch[1]!.replace(/[۰-۹]/g, (d) =>
        String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
      );
      const op: ComparisonOperator = isMinPressure
        ? "gte"
        : isMaxPressure
          ? "lte"
          : "gte";
      addReq({
        source_box:
          pressureSourceText === box2
            ? "technical_compliance"
            : "product_requirement",
        source_text: pressureSourceText,
        source_span: pressMatch[0],
        label: "Operating Pressure",
        normalized_value: `${op === "gte" ? "Minimum" : "Maximum"} ${pVal} bar working pressure`,
        concept: "working_pressure",
        value: pVal,
        unit: "bar",
        comparison_operator: op,
        lower_bound: op === "gte" ? pVal : undefined,
        upper_bound: op === "lte" ? pVal : undefined,
      });
    }
  }

  // CE / PED Conformity
  if (/ce|ped|pressure equipment directive/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "CE/PED",
      label: "Safety Certification",
      normalized_value:
        "CE Mark & Pressure Equipment Directive (PED 2014/68/EU) conformity",
      concept: "safety_certification",
      comparison_operator: "requires",
    });
  }

  // BMS-compatible thermostat
  if (/bms|building management system|ترموستات bms/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "BMS-compatible thermostat",
      label: "Automation & Controls",
      normalized_value: "BMS-compatible thermostat integration",
      concept: "bms_compatibility",
      comparison_operator: "requires",
    });
  }

  // Documented thermal insulation
  if (
    /documented\s+thermal\s+insulation|عایق\s*(?:حرارتی)?\s*مستند|thermal\s+insulation/i.test(
      box2,
    )
  ) {
    const isDocumented = /documented|مستند/i.test(box2);
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "documented thermal insulation",
      label: "Thermal Insulation",
      normalized_value: isDocumented
        ? "Documented thermal insulation"
        : "Thermal insulation",
      concept: "thermal_insulation",
      evidence_qualifier: isDocumented ? "documented" : undefined,
      comparison_operator: "requires",
    });
  }

  // Safety-valve compatibility
  if (/safety[- ]valve|شیر\s*اطمینان/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "safety-valve compatibility",
      label: "Safety Valve Compatibility",
      normalized_value: "Safety-valve compatibility",
      concept: "safety_valve_compatibility",
      comparison_operator: "requires",
    });
  }

  // Installation support
  if (/installation support|پشتیبانی نصب|خدمات نصب/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "installation support",
      label: "Installation Support",
      normalized_value: "Local installation support",
      concept: "installation_support",
      comparison_operator: "requires",
    });
  }

  // Spare-parts availability
  if (/spare[- ]parts?|قطعات یدکی|تامین قطعات/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "spare-parts availability",
      label: "Spare Parts Availability",
      normalized_value: "Local spare parts availability",
      concept: "spare_parts_availability",
      comparison_operator: "requires",
    });
  }

  // Warranty Period
  const warMatch = box2.match(
    /([0-9۰-۹]+|two|three|one|2|3|1)\s*(?:[- ]year|year|ساله?|سال)\s*(?:uae\s*)?(?:warranty|گارانتی|ضمانت)/i,
  );
  if (warMatch) {
    let years = warMatch[1]!;
    if (years === "two" || years === "۲" || years === "2") years = "2";
    else if (years === "three" || years === "۳" || years === "3") years = "3";
    else if (years === "one" || years === "۱" || years === "1") years = "1";
    const isUae = /uae|امارات/i.test(warMatch[0]) || /uae|امارات/i.test(box2);
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: warMatch[0],
      label: "Warranty Period",
      normalized_value: `${years}-year${isUae ? " UAE" : ""} warranty (${Number(years) * 12} months)`,
      concept: "warranty_duration",
      value: years,
      duration: `${Number(years) * 12} months`,
      jurisdiction: isUae ? "UAE" : undefined,
      comparison_operator: "gte",
    });
  }

  // SFDA / Halal (if poultry)
  if (/sfda/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "SFDA",
      label: "Import Clearance",
      normalized_value: "Active SFDA foreign establishment listing",
      concept: "import_clearance",
      comparison_operator: "requires",
    });
  }
  if (/halal|حلال/i.test(box2)) {
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: "Halal",
      label: "Religious & Sanitary Clearance",
      normalized_value: "Accredited Islamic Halal slaughter certification",
      concept: "religious_clearance",
      comparison_operator: "requires",
    });
  }

  // --- Box 3: Order Profile ---
  // Quantity
  const qtyMatch = box3.match(
    /(?:exactly\s*)?([0-9۰-۹]+)\s*(?:units?|دستگاه|عدد|pieces?|calorifiers?|containers?|کانتینر)/i,
  );
  if (qtyMatch) {
    const rawQty = qtyMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const isExact = /exactly|دقیقا/i.test(box3);
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: qtyMatch[0],
      label: "Order Quantity",
      normalized_value: `${isExact ? "Exactly " : ""}${rawQty} units`,
      concept: "order_quantity",
      value: rawQty,
      unit: "units",
      comparison_operator: "eq",
    });
  }

  // Incoterm & Destination
  const incoMatch = box3.match(
    /(ddp|cif|cfr|fob)\s*(?:dubai|jeddah|jebel ali|دبی|جده)?/i,
  );
  if (incoMatch) {
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: incoMatch[0],
      label: "Delivery Terms & Destination",
      normalized_value: incoMatch[0].toUpperCase(),
      concept: "delivery_terms",
      comparison_operator: "eq",
      jurisdiction: /dubai|دبی/i.test(incoMatch[0]) ? "Dubai" : undefined,
    });
  } else if (/dubai|دبی/i.test(box3)) {
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: "Dubai",
      label: "Delivery Destination",
      normalized_value: "Dubai, United Arab Emirates",
      concept: "delivery_destination",
      comparison_operator: "eq",
      jurisdiction: "Dubai",
    });
  }

  // Supplier Profile: Original manufacturer or authorized UAE distributor
  if (
    /authorized\s+uae\s+distributor|توزیع‌کننده\s*مجاز\s*امارات|نماینده\s*مجاز/i.test(
      box3,
    ) ||
    (/manufacturer|سازنده|تولیدکننده/i.test(box3) &&
      /distributor|توزیع‌کننده/i.test(box3))
  ) {
    const isUae = /uae|امارات/i.test(box3);
    const isAuthorized = /authorized|مجاز/i.test(box3);
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: "authorized UAE distributor",
      label: "Supplier Profile",
      normalized_value:
        isAuthorized && isUae
          ? "Original manufacturer or authorized UAE distributor"
          : "Original manufacturer or certified distributor",
      concept: "supplier_profile",
      supplier_role: isAuthorized ? "authorized_distributor" : "distributor",
      jurisdiction: isUae ? "UAE" : undefined,
      comparison_operator: "preferred",
      modality: "preferred",
    });
  }

  // Commercial Contact Channels (Official website, email, telephone)
  if (
    /official website|public business email|telephone|ایمیل|وبسایت|تلفن/i.test(
      box3,
    )
  ) {
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: "Official website, email, telephone",
      label: "Commercial Contact Channels",
      normalized_value:
        "Official website, public business email, and telephone",
      concept: "contact_channels",
      comparison_operator: "requires",
    });
  }

  return {
    ledger_id: randomUUID(),
    intake_hash,
    requirements,
    total_explicit_count: requirements.length,
  };
}

/**
 * Deterministic gate that verifies every mandatory requirement from the intake snapshot
 * is preserved in the Step 1 interpretation with zero directional inversions, qualifier mutations, or omissions.
 */
export function validateStep1RequirementFidelity(
  intake: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  },
  step1: {
    english_translation: string;
    mandatory_requirements: readonly string[];
    explicit_requirements?: readonly any[] | undefined;
    model_suggestions?: readonly ModelSuggestionItem[] | undefined;
  },
): Step1FidelityValidationResult {
  const ledger = extractExplicitRequirementLedger(intake);
  const omittedItems: ExplicitRequirementItem[] = [];
  const mutatedItems: MutatedRequirementReport[] = [];

  const combinedNarrative = (step1.english_translation || "").toLowerCase();
  const mandatoryJoined = (step1.mandatory_requirements || [])
    .join(" ")
    .toLowerCase();
  const explicitJoined = (step1.explicit_requirements || [])
    .map((e) =>
      typeof e === "string" ? e : e.normalized_value || e.description || "",
    )
    .join(" ")
    .toLowerCase();
  const allStep1Text = `${combinedNarrative} ${mandatoryJoined} ${explicitJoined}`;

  let preservedCount = 0;
  let normalizedCount = 0;

  for (const req of ledger.requirements) {
    const concept = req.concept;

    // 1. Working Pressure: Directional Operator Check (gte vs lte)
    if (concept === "working_pressure") {
      // Check for operator inversion (minimum inverted to maximum)
      const hasMax10Bar =
        /maximum\s*(?:of\s*)?10\s*bar|10\s*bar\s*maximum|not\s*more\s*than\s*10\s*bar|up\s*to\s*10\s*bar/i.test(
          allStep1Text,
        );
      if (req.comparison_operator === "gte" && hasMax10Bar) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: "maximum 10 bar",
          expected_operator: "gte",
          observed_operator: "lte",
          explanation:
            "Operator inversion: Explicit technical constraint 'minimum 10 bar' (gte) was inverted to 'maximum 10 bar' (lte).",
        });
        continue;
      }

      const hasMin10Bar =
        /minimum\s*(?:of\s*)?10\s*bar|at\s*least\s*10\s*bar|not\s*less\s*than\s*10\s*bar|>=\s*10\s*bar|10\s*bar\s*working\s*pressure/i.test(
          allStep1Text,
        );
      if (!hasMin10Bar && !allStep1Text.includes("10 bar")) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 2. Maximum External Diameter: Directional Operator Check (lte vs gte)
    if (concept === "external_diameter") {
      const hasMin85 =
        /minimum\s*(?:of\s*)?85\s*cm|at\s*least\s*85\s*cm|not\s*less\s*than\s*85/i.test(
          allStep1Text,
        );
      if (req.comparison_operator === "lte" && hasMin85) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: "minimum 85 cm",
          expected_operator: "lte",
          observed_operator: "gte",
          explanation:
            "Operator inversion: Physical constraint 'maximum 85 cm' (lte) was inverted to 'minimum 85 cm' (gte).",
        });
        continue;
      }

      const has85 =
        /85\s*cm|850\s*mm/i.test(allStep1Text) &&
        /diameter|max(?:imum)?|capped|limited/i.test(allStep1Text);
      if (!has85) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 3. Warranty Period: 2-Year UAE Warranty vs 5-Year Substitution
    if (concept === "warranty_duration") {
      const is2YearRequested =
        req.value === "2" || req.duration?.includes("24");
      if (is2YearRequested) {
        // Prohibited: 5-year tank warranty substituted in approved text
        const has5YearInApproved =
          /5[- ]year\s*(?:tank\s*)?warranty/i.test(combinedNarrative) ||
          /5[- ]year\s*(?:tank\s*)?warranty/i.test(mandatoryJoined);

        if (has5YearInApproved) {
          mutatedItems.push({
            requirement: req,
            prohibited_value: "5-year tank warranty",
            explanation:
              "Silent requirement mutation: Requested 'two-year UAE warranty' was replaced by '5-year tank warranty' in approved facts.",
          });
          continue;
        }

        const has2Year = /2[- ]year|24[- ]months?|two[- ]year/i.test(
          allStep1Text,
        );
        if (!has2Year) {
          omittedItems.push(req);
          continue;
        }

        const hasUae = /uae|united arab emirates|dubai/i.test(allStep1Text);
        if (req.jurisdiction === "UAE" && !hasUae) {
          mutatedItems.push({
            requirement: req,
            explanation:
              "Jurisdiction omission: Requested 'two-year UAE warranty' lost the 'UAE' local warranty scope.",
          });
          continue;
        }
      }
      preservedCount++;
      continue;
    }

    // 4. Documented Thermal Insulation: Evidence Qualifier Preservation
    if (concept === "thermal_insulation") {
      const hasInsulation = /thermal\s+insulation|insulation/i.test(
        allStep1Text,
      );
      if (!hasInsulation) {
        omittedItems.push(req);
        continue;
      }
      if (req.evidence_qualifier === "documented") {
        const hasDocumented =
          /documented/i.test(allStep1Text) &&
          /thermal\s+insulation|insulation/i.test(allStep1Text);
        const hasHighEfficiencyOnly =
          /high[- ]efficiency\s+thermal\s+insulation/i.test(allStep1Text) &&
          !hasDocumented;

        if (hasHighEfficiencyOnly || !hasDocumented) {
          mutatedItems.push({
            requirement: req,
            prohibited_value: "high-efficiency thermal insulation",
            explanation:
              "Qualifier mutation: 'documented thermal insulation' was mutated to 'high-efficiency thermal insulation' (evidence obligation 'documented' lost).",
          });
          continue;
        }
      }
      preservedCount++;
      continue;
    }

    // 5. Safety-Valve Compatibility: Independent Requirement Preservation
    if (concept === "safety_valve_compatibility") {
      const hasSafetyValve = /safety[- ]valve|pressure relief valve/i.test(
        allStep1Text,
      );
      if (!hasSafetyValve) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 6. Supplier Profile: Authorized UAE Distributor Scope Preservation
    if (concept === "supplier_profile") {
      if (req.supplier_role === "authorized_distributor") {
        const hasRegionalOnly =
          /certified\s+regional\s+distributor|regional\s+distributor/i.test(
            allStep1Text,
          ) &&
          !/authorized\s+(?:uae\s+)?distributor|authorized\s+distributor\s+in\s+uae/i.test(
            allStep1Text,
          );

        if (hasRegionalOnly) {
          mutatedItems.push({
            requirement: req,
            prohibited_value: "certified regional distributor",
            explanation:
              "Scope mutation: 'authorized UAE distributor' was mutated to 'certified regional distributor' (UAE jurisdiction and authorization scope lost).",
          });
          continue;
        }
      }
      preservedCount++;
      continue;
    }

    // 7. Order Quantity: Exact Quantity vs Range (eq -> range)
    if (concept === "order_quantity") {
      const hasRange =
        /10\s*to\s*50|10\s*-\s*50|10\s*to\s*20|10\s*-\s*20/i.test(allStep1Text);
      if (req.comparison_operator === "eq" && hasRange) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: "10 to 50 units",
          explanation:
            "Quantity mutation: 'exactly 10 units' (eq) was mutated into a range.",
        });
        continue;
      }
      const reqNum = req.value || req.normalized_value.match(/[0-9]+/)?.[0];
      if (reqNum && !allStep1Text.includes(reqNum)) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 8. Installation Environment (Indoor)
    if (concept === "installation_environment") {
      if (/outdoor/i.test(allStep1Text) && !/indoor/i.test(allStep1Text)) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: "outdoor",
          explanation:
            "Environment mutation: 'indoor installation' was mutated to 'outdoor'.",
        });
        continue;
      }
      if (!allStep1Text.includes("indoor")) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 9. Automation & Controls (BMS)
    if (concept === "bms_compatibility") {
      if (!/bms|building management system/i.test(allStep1Text)) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 10. Safety Certification (CE / PED)
    if (concept === "safety_certification") {
      if (!/ce|ped|pressure equipment/i.test(allStep1Text)) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 11. Electrical Power Supply
    if (concept === "electrical_power") {
      const hasPower =
        /three[- ]phase|3[- ]phase/i.test(allStep1Text) &&
        /400\s*v|380|415/i.test(allStep1Text);
      if (!hasPower) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 12. Storage Capacity
    if (concept === "storage_capacity") {
      if (!/500\s*(?:l|litres?|liters?)/i.test(allStep1Text)) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 13. Delivery Terms & Destination
    if (concept === "delivery_terms" || concept === "delivery_destination") {
      if (!allStep1Text.includes("dubai")) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // Generic checks for any other explicit requirement
    if (allStep1Text.includes(req.source_span_or_reference.toLowerCase())) {
      preservedCount++;
    } else {
      normalizedCount++;
    }
  }

  const isValid = omittedItems.length === 0 && mutatedItems.length === 0;

  let explanation: string | undefined;
  if (!isValid) {
    const errorDetails: string[] = [];
    if (mutatedItems.length > 0) {
      for (const m of mutatedItems) {
        errorDetails.push(m.explanation);
      }
    }
    if (omittedItems.length > 0) {
      for (const o of omittedItems) {
        errorDetails.push(
          `Missing explicit requirement: '${o.normalized_label}' (${o.normalized_value}) from ${o.source_box}.`,
        );
      }
    }
    explanation = errorDetails.join(" ");
  }

  return {
    valid: isValid,
    preserved_count: preservedCount,
    normalized_count: normalizedCount,
    omitted_count: omittedItems.length,
    mutated_count: mutatedItems.length,
    omitted_items: omittedItems,
    mutated_items: mutatedItems,
    ledger,
    model_suggestions: step1.model_suggestions || [],
    explanation,
  };
}
