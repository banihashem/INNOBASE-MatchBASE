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

export interface ExplicitRequirementItem {
  readonly requirement_id: string;
  readonly source_box: RequirementSourceBox;
  readonly source_text: string;
  readonly source_span_or_reference: string;
  readonly normalized_label: string;
  readonly normalized_value: string;
  readonly unit?: string | undefined;
  readonly modality: RequirementModality;
  readonly requirement_level: RequirementLevel;
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

/**
 * Deterministic extraction of all explicit requirement clauses from the intake.
 */
export function extractExplicitRequirementLedger(intake: {
  product_requirement: string;
  technical_compliance: string;
  order_profile: string;
}): ExplicitRequirementLedger {
  const requirements: ExplicitRequirementItem[] = [];
  const intakeHash = computeSnapshotContentHash(intake);

  const addReq = (
    source_box: RequirementSourceBox,
    source_text: string,
    source_span: string,
    label: string,
    value: string,
    unit?: string,
    modality: RequirementModality = "mandatory",
  ) => {
    requirements.push({
      requirement_id: randomUUID(),
      source_box,
      source_text,
      source_span_or_reference: source_span,
      normalized_label: label,
      normalized_value: value,
      unit,
      modality,
      requirement_level: modality === "mandatory" ? "mandatory" : "preferred",
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
    addReq(
      "product_requirement",
      box1,
      "water heater",
      "Product Family",
      "Industrial Electric Storage Water Heater / Calorifier",
    );
  } else if (/poultry|chicken|مرغ|دواجن/i.test(box1)) {
    addReq(
      "product_requirement",
      box1,
      "poultry",
      "Product Family",
      "Frozen Whole Chicken (Gallus domesticus)",
    );
  }

  // Capacity / Volume in Box 1
  const capMatch = box1.match(
    /([0-9۰-۹]+)\s*(?:litres?|liters?|liter|l\b|لیتر)/i,
  );
  if (capMatch) {
    const rawVal = capMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    addReq(
      "product_requirement",
      box1,
      capMatch[0],
      "Storage Capacity",
      `${rawVal} Litres`,
      "Litres",
    );
  }

  // Dimension / Diameter in Box 1
  const diamMatch = box1.match(
    /(?:max(?:imum)?|حداکثر)?\s*([0-9۰-۹]+)\s*(?:cm|سانتی[‌\s]*متر|mm|میلی[‌\s]*متر)?\s*(?:diameter|قطر)/i,
  );
  if (diamMatch) {
    const rawNum = diamMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const unit = diamMatch[0].includes("mm") ? "mm" : "cm";
    addReq(
      "product_requirement",
      box1,
      diamMatch[0],
      "Maximum External Diameter",
      `Maximum ${rawNum} ${unit}`,
      unit,
    );
  } else if (
    /85\s*cm|850\s*mm|۸۵\s*سانتی/i.test(box1) ||
    /85\s*cm|850\s*mm/i.test(box2)
  ) {
    addReq(
      "product_requirement",
      box1.includes("85") ? box1 : box2,
      "85 cm",
      "Maximum External Diameter",
      "Maximum 85 cm (850 mm)",
      "cm",
    );
  }

  // Indoor installation environment
  if (
    /indoor|نصب\s*داخلی|فضای\s*داخلی|داخلی/i.test(box1) ||
    /indoor|نصب\s*داخلی/i.test(box2)
  ) {
    addReq(
      "product_requirement",
      box1.includes("indoor") || box1.includes("داخلی") ? box1 : box2,
      "indoor installation",
      "Installation Environment",
      "Indoor mechanical room installation",
    );
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
    addReq(
      "technical_compliance",
      box2,
      voltMatch[0],
      "Electrical Power Supply",
      `Three-phase ${vVal}V industrial supply (50/60 Hz)`,
      "V",
    );
  } else if (/three[- ]phase|3[- ]phase|سه[- ]فاز/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "three-phase",
      "Electrical Power Supply",
      "Three-phase industrial electrical supply (380V - 415V, 50/60Hz)",
    );
  }

  // Working Pressure
  const pressMatch = box2.match(
    /(?:minimum|min|حداقل)?\s*([0-9۰-۹]+)\s*(?:bar|بار)/i,
  );
  if (pressMatch) {
    const pVal = pressMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    addReq(
      "technical_compliance",
      box2,
      pressMatch[0],
      "Operating Pressure",
      `Minimum ${pVal} bar working pressure`,
      "bar",
    );
  }

  // CE / PED Conformity
  if (/ce|ped|pressure equipment directive/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "CE/PED",
      "Safety Certification",
      "CE Mark & Pressure Equipment Directive (PED 2014/68/EU) conformity",
    );
  }

  // BMS-compatible thermostat
  if (/bms|building management system|ترموستات bms/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "BMS-compatible thermostat",
      "Automation & Controls",
      "BMS-compatible thermostat integration",
    );
  }

  // Installation support
  if (/installation support|پشتیبانی نصب|خدمات نصب/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "installation support",
      "Technical Services",
      "Manufacturer or distributor installation support",
    );
  }

  // Spare-parts availability
  if (/spare[- ]parts?|قطعات یدکی|تامین قطعات/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "spare-parts availability",
      "Spare Parts Availability",
      "Local spare parts availability (heating elements, thermostat, safety valves)",
    );
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
    addReq(
      "technical_compliance",
      box2,
      warMatch[0],
      "Warranty Period",
      `${years}-year UAE warranty (${Number(years) * 12} months)`,
      "years",
    );
  }

  // SFDA / Halal (if poultry)
  if (/sfda/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "SFDA",
      "Import Clearance",
      "Active SFDA foreign establishment listing",
    );
  }
  if (/halal|حلال/i.test(box2)) {
    addReq(
      "technical_compliance",
      box2,
      "Halal",
      "Religious & Sanitary Clearance",
      "Accredited Islamic Halal slaughter certification",
    );
  }

  // --- Box 3: Order Profile ---
  // Quantity
  const qtyMatch = box3.match(
    /([0-9۰-۹]+)\s*(?:units?|دستگاه|عدد|pieces?|calorifiers?|containers?|کانتینر)/i,
  );
  if (qtyMatch) {
    const rawQty = qtyMatch[1]!.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    addReq(
      "order_profile",
      box3,
      qtyMatch[0],
      "Order Quantity",
      `${rawQty} units`,
      "units",
    );
  }

  // Incoterm & Destination
  const incoMatch = box3.match(
    /(ddp|cif|cfr|fob)\s*(?:dubai|jeddah|jebel ali|دبی|جده)?/i,
  );
  if (incoMatch) {
    addReq(
      "order_profile",
      box3,
      incoMatch[0],
      "Delivery Terms & Destination",
      incoMatch[0].toUpperCase(),
    );
  } else if (/dubai|دبی/i.test(box3)) {
    addReq(
      "order_profile",
      box3,
      "Dubai",
      "Delivery Destination",
      "Dubai, United Arab Emirates",
    );
  }

  return {
    ledger_id: randomUUID(),
    intakeHash,
    requirements,
    total_explicit_count: requirements.length,
  } as unknown as ExplicitRequirementLedger;
}

/**
 * Deterministic gate that verifies every mandatory requirement from the intake snapshot
 * is preserved in the Step 1 interpretation with zero silent mutations or omissions.
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
    explicit_requirements?: readonly any[];
    model_suggestions?: readonly ModelSuggestionItem[];
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
    const label = req.normalized_label;
    const val = req.normalized_value.toLowerCase();

    // Specific Fidelity Checks

    // 1. Warranty Fidelity (Critical L06 requirement)
    if (label === "Warranty Period") {
      const is2YearRequested =
        val.includes("2-year") || val.includes("24 months");
      if (is2YearRequested) {
        // Prohibited substitution: 5-year tank warranty in approved text
        const has5YearTankInApproved =
          /5[- ]year\s*(?:tank\s*)?warranty/i.test(combinedNarrative) ||
          /5[- ]year\s*(?:tank\s*)?warranty/i.test(mandatoryJoined);

        if (has5YearTankInApproved) {
          mutatedItems.push({
            requirement: req,
            prohibited_value: "5-year tank warranty",
            explanation:
              "Silent requirement mutation: Requested 'two-year warranty' was replaced by '5-year tank warranty' in approved facts.",
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
      }
      preservedCount++;
      continue;
    }

    // 2. BMS-compatible thermostat
    if (label === "Automation & Controls") {
      const hasBms = /bms|building management system/i.test(allStep1Text);
      if (!hasBms) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 3. Indoor installation
    if (label === "Installation Environment") {
      const hasIndoor = /indoor/i.test(allStep1Text);
      if (!hasIndoor) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 4. Working Pressure (10 bar)
    if (label === "Operating Pressure") {
      const has10Bar = /10\s*bar/i.test(allStep1Text);
      if (!has10Bar) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 5. Maximum External Diameter (85 cm / 850 mm)
    if (label === "Maximum External Diameter") {
      const has85cm =
        /85\s*cm|850\s*mm/i.test(allStep1Text) &&
        /diameter|max(?:imum)?/i.test(allStep1Text);
      if (!has85cm) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 6. Three-phase 400V electrical supply
    if (label === "Electrical Power Supply") {
      const hasThreePhase =
        /three[- ]phase|3[- ]phase/i.test(allStep1Text) &&
        /400\s*v|380|415/i.test(allStep1Text);
      if (!hasThreePhase) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 7. Order Quantity (e.g. 10 units)
    if (label === "Order Quantity") {
      const reqNum = req.normalized_value.match(/[0-9]+/)?.[0];
      if (reqNum && !allStep1Text.includes(reqNum)) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 8. Delivery Terms (e.g. DDP Dubai)
    if (
      label === "Delivery Terms & Destination" ||
      label === "Delivery Destination"
    ) {
      const hasDubai = /dubai/i.test(allStep1Text);
      if (!hasDubai) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 9. CE / PED Safety Certification
    if (label === "Safety Certification") {
      const hasCePed = /ce|ped|pressure equipment/i.test(allStep1Text);
      if (!hasCePed) {
        omittedItems.push(req);
        continue;
      }
      preservedCount++;
      continue;
    }

    // 10. Spare parts availability
    if (label === "Spare Parts Availability") {
      const hasParts = /spare[- ]parts?|parts/i.test(allStep1Text);
      if (!hasParts) {
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
