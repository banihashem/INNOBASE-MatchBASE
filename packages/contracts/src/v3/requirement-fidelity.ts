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
  let diamMatch = `${box1} ${box2}`.match(
    /(?:max(?:imum)?|حداکثر)?\s*([0-9۰-۹]+)\s*(?:cm|سانتی[‌\s]*متر|mm|میلی[‌\s]*متر)?\s*(?:diameter|external diameter|outer diameter|قطر)/i,
  );
  if (!diamMatch) {
    diamMatch = `${box1} ${box2}`.match(
      /(?:diameter|external diameter|outer diameter|قطر)\s*(?:of|is|:)?\s*(?:max(?:imum)?|حداکثر|<=)?\s*([0-9۰-۹]+)\s*(?:cm|سانتی[‌\s]*متر|mm|میلی[‌\s]*متر)/i,
    );
  }
  if (diamMatch) {
    const rawNum = diamMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const unit = diamMatch[0].includes("mm") ? "mm" : "cm";
    addReq({
      source_box:
        box1.includes(rawNum) || box1.includes("قطر")
          ? "product_requirement"
          : "technical_compliance",
      source_text: box1.includes(rawNum) ? box1 : box2,
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
  const warMonthMatch = box2.match(
    /([0-9۰-۹]{2})\s*(?:[- ]month|months?|ماهه?|ماه)\s*(?:uae\s*)?(?:warranty|گارانتی|ضمانت)?/i,
  );
  const warYearMatch = box2.match(
    /([0-9۰-۹]+|two|three|one|2|3|1)\s*(?:[- ]year|year|ساله?|سال)\s*(?:uae\s*)?(?:warranty|گارانتی|ضمانت)/i,
  );
  if (warMonthMatch) {
    const rawMonths = warMonthMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const mNum = parseInt(rawMonths, 10);
    const years = String(Math.round(mNum / 12));
    const isUae =
      /uae|امارات/i.test(warMonthMatch[0]) || /uae|امارات/i.test(box2);
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: warMonthMatch[0],
      label: "Warranty Period",
      normalized_value: `${years}-year${isUae ? " UAE" : ""} warranty (${mNum} months)`,
      concept: "warranty_duration",
      value: years,
      duration: `${mNum} months`,
      jurisdiction: isUae ? "UAE" : undefined,
      comparison_operator: "gte",
    });
  } else if (warYearMatch) {
    let years = warYearMatch[1]!;
    if (years === "two" || years === "۲" || years === "2") years = "2";
    else if (years === "three" || years === "۳" || years === "3") years = "3";
    else if (years === "one" || years === "۱" || years === "1") years = "1";
    const isUae =
      /uae|امارات/i.test(warYearMatch[0]) || /uae|امارات/i.test(box2);
    addReq({
      source_box: "technical_compliance",
      source_text: box2,
      source_span: warYearMatch[0],
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
    /(ddp|cif|cfr|fob)\s*(?:dubai|abu dhabi|jeddah|jebel ali|دبی|ابوظبی|جده)?/i,
  );
  if (incoMatch) {
    const isAbuDhabi = /abu dhabi|ابوظبی/i.test(box3);
    const isDubai = /dubai|دبی/i.test(box3);
    const isJeddah = /jeddah|جده/i.test(box3);
    const jurisdiction = isAbuDhabi
      ? "Abu Dhabi"
      : isDubai
        ? "Dubai"
        : isJeddah
          ? "Jeddah"
          : undefined;
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: incoMatch[0],
      label: "Delivery Terms & Destination",
      normalized_value: incoMatch[0].toUpperCase(),
      concept: "delivery_terms",
      comparison_operator: "eq",
      jurisdiction,
    });
  } else if (/abu dhabi|ابوظبی/i.test(box3)) {
    addReq({
      source_box: "order_profile",
      source_text: box3,
      source_span: "Abu Dhabi",
      label: "Delivery Destination",
      normalized_value: "Abu Dhabi, United Arab Emirates",
      concept: "delivery_destination",
      comparison_operator: "eq",
      jurisdiction: "Abu Dhabi",
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
  const supplierBoxText = `${box2} ${box3}`;
  if (
    /authorized\s+(?:uae\s+)?distributor|توزیع‌کننده\s*مجاز\s*امارات|نماینده\s*مجاز|authorized\s+distributor/i.test(
      supplierBoxText,
    ) ||
    (/manufacturer|سازنده|تولیدکننده/i.test(supplierBoxText) &&
      /distributor|توزیع‌کننده/i.test(supplierBoxText))
  ) {
    const isUae = /uae|امارات/i.test(supplierBoxText);
    const isAuthorized = /authorized|مجاز/i.test(supplierBoxText);
    const inBox2 = /distributor|manufacturer/i.test(box2);
    addReq({
      source_box: inBox2 ? "technical_compliance" : "order_profile",
      source_text: inBox2 ? box2 : box3,
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
    mandatory_requirements?: readonly string[] | undefined;
    explicit_requirements?: readonly any[] | undefined;
    model_suggestions?: readonly ModelSuggestionItem[] | undefined;
  },
): Step1FidelityValidationResult {
  const ledger = extractExplicitRequirementLedger(intake);
  const omittedItems: ExplicitRequirementItem[] = [];
  const mutatedItems: MutatedRequirementReport[] = [];

  const combinedNarrative = (step1.english_translation || "")
    .toLowerCase()
    .trim();
  const mandatoryJoined = (step1.mandatory_requirements || [])
    .join(" ")
    .toLowerCase();
  const explicitJoined = (step1.explicit_requirements || [])
    .map((e) =>
      typeof e === "string" ? e : e.normalized_value || e.description || "",
    )
    .join(" ")
    .toLowerCase();

  // Authoritative fidelity: The interpretation narrative represents the human-approved text.
  // When an interpretation narrative is provided, validate strictly against that narrative.
  // Never allow stale arrays or previous ledger items to mask omissions from the edited interpretation!
  const allStep1Text =
    combinedNarrative.length > 0
      ? combinedNarrative
      : `${mandatoryJoined} ${explicitJoined}`.trim();

  let preservedCount = 0;
  let normalizedCount = 0;

  for (const req of ledger.requirements) {
    const concept = req.concept;

    // 1. Working Pressure: Directional Operator Check (gte vs lte)
    if (concept === "working_pressure") {
      const pVal = req.value || "10";
      // Check for operator inversion (minimum inverted to maximum)
      const hasMaxPressure = new RegExp(
        `(maximum\\s*(?:of\\s*)?${pVal}\\s*bar|${pVal}\\s*bar\\s*maximum|not\\s*more\\s*than\\s*${pVal}\\s*bar|up\\s*to\\s*${pVal}\\s*bar)`,
        "i",
      ).test(allStep1Text);
      if (req.comparison_operator === "gte" && hasMaxPressure) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: `maximum ${pVal} bar`,
          expected_operator: "gte",
          observed_operator: "lte",
          explanation: `Operator inversion: Explicit technical constraint 'minimum ${pVal} bar' (gte) was inverted to 'maximum ${pVal} bar' (lte).`,
        });
        continue;
      }

      const hasMinPressure = new RegExp(
        `(minimum\\s*(?:of\\s*)?${pVal}\\s*bar|at\\s*least\\s*${pVal}\\s*bar|not\\s*less\\s*than\\s*${pVal}\\s*bar|>=?\\s*${pVal}\\s*bar|${pVal}\\s*bar\\s*working\\s*pressure|operating\\s*at\\s*${pVal}\\s*bar)`,
        "i",
      ).test(allStep1Text);
      if (!hasMinPressure && !allStep1Text.includes(`${pVal} bar`)) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 2. Maximum External Diameter: Directional Operator Check (lte vs gte)
    if (concept === "external_diameter") {
      const dVal = req.value || "85";
      const dValMm = String(Number(dVal) * 10);
      const hasMinDiameter = new RegExp(
        `(minimum\\s*(?:of\\s*)?${dVal}\\s*cm|at\\s*least\\s*${dVal}\\s*cm|not\\s*less\\s*than\\s*${dVal})`,
        "i",
      ).test(allStep1Text);
      if (req.comparison_operator === "lte" && hasMinDiameter) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: `minimum ${dVal} cm`,
          expected_operator: "lte",
          observed_operator: "gte",
          explanation: `Operator inversion: Physical constraint 'maximum ${dVal} cm' (lte) was inverted to 'minimum ${dVal} cm' (gte).`,
        });
        continue;
      }

      const hasDiameterNum = new RegExp(
        `(${dVal}\\s*cm|${dValMm}\\s*mm)`,
        "i",
      ).test(allStep1Text);
      const hasDiameterKeyword =
        /diameter|max(?:imum)?|capped|limited|outer|external/i.test(
          allStep1Text,
        );
      if (!hasDiameterNum || !hasDiameterKeyword) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 3. Warranty Period: Requested Warranty Duration vs Substituted Term
    if (concept === "warranty_duration") {
      const reqVal = req.value || "2";
      const reqMonths =
        req.duration?.match(/\d+/)?.[0] || String(Number(reqVal) * 12);

      // Check for prohibited substitutions (e.g. 5-year tank warranty when 2 or 3 years was requested)
      const has5YearInApproved = /5[- ]year\s*(?:tank\s*)?warranty/i.test(
        allStep1Text,
      );
      if (reqVal !== "5" && has5YearInApproved) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: "5-year tank warranty",
          explanation: `Silent requirement mutation: Requested '${reqVal}-year UAE warranty' was replaced by '5-year tank warranty' in approved facts.`,
        });
        continue;
      }

      const hasWarrantyPattern = new RegExp(
        `(${reqVal}[- ]year|${reqMonths}[- ]months?|${reqVal === "2" ? "two" : reqVal === "3" ? "three" : "one"}[- ]year)`,
        "i",
      ).test(allStep1Text);
      if (!hasWarrantyPattern) {
        omittedItems.push(req);
        continue;
      }

      const hasUae = /uae|united arab emirates|dubai|abu dhabi/i.test(
        allStep1Text,
      );
      if (req.jurisdiction === "UAE" && !hasUae) {
        mutatedItems.push({
          requirement: req,
          explanation: `Jurisdiction omission: Requested '${reqVal}-year UAE warranty' lost the 'UAE' local warranty scope.`,
        });
        continue;
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
      const reqNum = req.value || req.normalized_value.match(/[0-9]+/)?.[0];
      const hasRange = /[0-9]+\s*to\s*[0-9]+|[0-9]+\s*-\s*[0-9]+/i.test(
        allStep1Text,
      );
      if (req.comparison_operator === "eq" && hasRange) {
        mutatedItems.push({
          requirement: req,
          prohibited_value: "quantity range",
          explanation: `Quantity mutation: 'exactly ${reqNum || 10} units' (eq) was mutated into a range.`,
        });
        continue;
      }
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
      const vVal = req.value || "400";
      const hasPhase = /three[- ]phase|3[- ]phase/i.test(allStep1Text);
      const hasVoltage =
        new RegExp(`${vVal}\\s*v`, "i").test(allStep1Text) ||
        (vVal === "400" && /380|400|415/i.test(allStep1Text));
      if (!hasPhase || !hasVoltage) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 12. Storage Capacity
    if (concept === "storage_capacity") {
      const cVal = req.value || "500";
      const hasCap = new RegExp(`${cVal}\\s*(?:l|litres?|liters?)`, "i").test(
        allStep1Text,
      );
      if (!hasCap) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 13. Delivery Terms & Destination
    if (concept === "delivery_terms" || concept === "delivery_destination") {
      const targetDest = (
        req.jurisdiction || req.normalized_value
      ).toLowerCase();
      const targetCity = targetDest.includes("abu dhabi")
        ? "abu dhabi"
        : targetDest.includes("jeddah")
          ? "jeddah"
          : "dubai";
      if (!allStep1Text.includes(targetCity)) {
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
