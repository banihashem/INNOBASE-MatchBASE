import type { ConsultantResearchOutputV3 } from "./consultant-research-output.js";

export interface SemanticCoherenceResult {
  readonly isCoherent: boolean;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly violations: readonly string[];
  readonly detectedDomain: string;
  readonly classificationDomain: string;
  readonly candidateDomain: string;
}

const DOMAIN_KEYWORDS: Record<
  string,
  { hsPrefix: string; keywords: readonly string[] }
> = {
  poultry: {
    hsPrefix: "0207",
    keywords: [
      "poultry",
      "chicken",
      "broiler",
      "poultry meat",
      "slaughterhouse",
      "halal",
      "sif",
      "sfda",
      "مرغ",
      "طیور",
      "کشتارگاه",
      "جوجه",
      "فراورده‌های طیور",
      "گوشت مرغ",
      "دواجن",
      "دجاج",
      "مسلخ",
    ],
  },
  water_heater: {
    hsPrefix: "8516.10",
    keywords: [
      "water heater",
      "waterheater",
      "calorifier",
      "electric water heater",
      "storage water heater",
      "commercial water heater",
      "industrial water heater",
      "electric water",
      "immersion heater",
      "vitreous enamel",
      "ped 2014/68/eu",
      "10 bar",
      "three-phase heater",
      "3-phase heater",
      "آبگرمکن",
      "ابگرمکن",
      "آب‌گرم‌کن",
      "کالریفر",
      "مخزن آبگرم",
      "منبع دوجداره",
      "المنت برقی",
      "سخان",
      "سخانات",
      "سخان مياه",
    ],
  },
  reverse_osmosis: {
    hsPrefix: "8421.21",
    keywords: [
      "reverse osmosis",
      "ro membrane",
      "filtration system",
      "water treatment",
      "desalination",
      "permeate",
      "brackish water",
      "اسمز معکوس",
      "تصفیه آب",
      "ممبران",
      "غشا",
      "آب شیرین کن",
      "تناضح عکسی",
      "تحلية المياه",
    ],
  },
  pump: {
    hsPrefix: "8413",
    keywords: [
      "pump",
      "impeller",
      "centrifugal pump",
      "hydraulic pump",
      "submersible pump",
      "پمپ",
      "الکتروپمپ",
      "مضخة",
      "مضخات",
    ],
  },
  coffee: {
    hsPrefix: "0901",
    keywords: [
      "coffee",
      "arabica",
      "robusta",
      "green coffee",
      "coffee beans",
      "قهوه",
      "دانه قهوه",
      "قهوة",
      "بن",
    ],
  },
};

const PROHIBITED_DEMONSTRATION_BRANDS = [
  "atlantic",
  "ariston",
  "stiebel eltron",
  "stiebel",
  "brf",
  "jbs",
  "seara",
  "sadia",
  "rheem",
  "a.o. smith",
  "ao smith",
  "bradford white",
];

export function detectAllDomains(text?: string | null): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  for (const [domain, config] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of config.keywords) {
      if (lower.includes(kw)) {
        matched.add(domain);
        break;
      }
    }
  }
  return Array.from(matched);
}

export function detectDomain(text?: string | null): string {
  const domains = detectAllDomains(text);
  return domains.length > 0 ? domains[0]! : "generic";
}

/**
 * Validates the semantic coherence and demonstration truthfulness of a ConsultantResearchOutputV3 document.
 * Enforces:
 * - Domain alignment across request, classification, business context, claims, and candidates
 * - Zero real-company brand names in demonstration/fixture mode
 * - Zero external verification claims on illustrative fixture profiles
 * - Strict alignment between candidate count, subtitle, and research_status
 */
export function validateConsultantOutputV3SemanticCoherence(
  output: ConsultantResearchOutputV3,
): SemanticCoherenceResult {
  const errors: string[] = [];

  const requestText = [
    output.title,
    output.request_snapshot.product_name,
    output.request_snapshot.product_category,
    ...(output.request_snapshot.business_context ?? []),
  ].join(" ");

  const detectedDomain = detectDomain(requestText);

  // 1. Classification Domain Check
  const classCode = output.primary_classification.code;
  let classificationDomain = "generic";
  for (const [domain, config] of Object.entries(DOMAIN_KEYWORDS)) {
    if (classCode.startsWith(config.hsPrefix)) {
      classificationDomain = domain;
      break;
    }
  }

  if (
    detectedDomain !== "generic" &&
    classificationDomain !== "generic" &&
    detectedDomain !== classificationDomain
  ) {
    errors.push(
      `Domain mismatch: Request appears to be '${detectedDomain}' but primary classification is '${classificationDomain}' (HS ${classCode}).`,
    );
  }

  // 2. Candidate Offering Coherence
  let candidateDomain = "generic";
  for (const cand of output.supplier_candidates) {
    const candText = `${cand.offering.product_name} ${cand.offering.product_family}`;
    const candDom = detectDomain(candText);
    if (candDom !== "generic") {
      candidateDomain = candDom;
      if (detectedDomain !== "generic" && candDom !== detectedDomain) {
        errors.push(
          `Candidate '${cand.candidate_id}' offering '${cand.offering.product_name}' belongs to domain '${candDom}', conflicting with request domain '${detectedDomain}'.`,
        );
      }
    }
  }

  // 3. Claims Domain Coherence
  for (const claim of output.claims) {
    const rawStatement =
      claim.claim_text ?? (claim as any).claim_statement ?? "";
    const claimLower = rawStatement.toLowerCase();
    const claimDomain = detectDomain(rawStatement);
    if (
      detectedDomain === "water_heater" &&
      (claimDomain === "poultry" ||
        claimLower.includes("chicken") ||
        (claimLower.includes("sfda") && !claimLower.includes("water")))
    ) {
      errors.push(
        `Poultry/Food claim found in water-heater output: "${rawStatement.slice(0, 60)}..."`,
      );
    }
    if (
      detectedDomain === "poultry" &&
      (claimDomain === "water_heater" ||
        claimLower.includes("calorifier") ||
        claimLower.includes("electric water heater"))
    ) {
      errors.push(
        `Water heater claim found in poultry output: "${rawStatement.slice(0, 60)}..."`,
      );
    }
  }

  // 4. Candidate Count Coherence
  const actualCount = output.supplier_candidates.length;
  if (output.total_candidates_found !== actualCount) {
    errors.push(
      `total_candidates_found (${output.total_candidates_found}) does not match actual supplier_candidates.length (${actualCount}).`,
    );
  }

  if (output.research_status === "no_strong_match" && actualCount !== 0) {
    errors.push(
      `research_status is 'no_strong_match' but candidate count is ${actualCount} (expected 0).`,
    );
  }

  if (output.research_status === "complete" && actualCount === 0) {
    errors.push(`research_status is 'complete' but candidate count is 0.`);
  }

  // Subtitle count check (if subtitle specifies a count e.g. "20 Candidates" or "3 Candidates")
  const subtitleMatch =
    /(\d+)\s+(?:Truthful\s+)?(?:Illustrative\s+)?Candidates/i.exec(
      output.subtitle ?? "",
    );
  if (subtitleMatch && parseInt(subtitleMatch[1]!, 10) !== actualCount) {
    errors.push(
      `Subtitle indicates ${subtitleMatch[1]} candidates but actual count is ${actualCount}.`,
    );
  }

  // 5. Demonstration Mode Truth Invariants
  if (output.research_mode === "fixture") {
    // Zero real-company brand names
    for (const cand of output.supplier_candidates) {
      const nameLower = cand.legal_name.toLowerCase();
      for (const prohibited of PROHIBITED_DEMONSTRATION_BRANDS) {
        if (nameLower.includes(prohibited)) {
          errors.push(
            `Demonstration candidate '${cand.candidate_id}' uses prohibited real-company brand name '${prohibited}' in legal_name: '${cand.legal_name}'.`,
          );
        }
      }

      // No external verification claim
      const assessment = cand.assessment as unknown as Record<string, unknown>;
      if (
        assessment?.verification_status === "externally_verified" ||
        assessment?.verification_status === "verified"
      ) {
        errors.push(
          `Demonstration candidate '${cand.candidate_id}' cannot be marked '${assessment.verification_status}'. Must be 'illustrative'.`,
        );
      }

      // No clickable public website or email
      if (
        cand.website &&
        cand.website.startsWith("http") &&
        !cand.website.includes("matchbase.internal") &&
        !cand.website.includes("illustrative") &&
        !cand.website.includes("fixture")
      ) {
        errors.push(
          `Demonstration candidate '${cand.candidate_id}' cannot have a public routable website: '${cand.website}'.`,
        );
      }
    }

    // Telemetry check in demonstration mode
    if (output.telemetry.total_cost_usd > 0) {
      errors.push(
        `Demonstration telemetry has total_cost_usd = ${output.telemetry.total_cost_usd} (expected 0.0).`,
      );
    }

    if (
      output.telemetry.lanes_executed &&
      output.telemetry.lanes_executed.length > 0
    ) {
      errors.push(
        `Demonstration telemetry cannot claim provider lanes_executed (${output.telemetry.lanes_executed.join(", ")}). Must be empty for simulated research.`,
      );
    }
  }

  const isCoherent = errors.length === 0;
  return {
    isCoherent,
    valid: isCoherent,
    errors,
    violations: errors,
    detectedDomain,
    classificationDomain,
    candidateDomain,
  };
}

export interface IntakeCoherenceConflict {
  readonly fields: readonly string[];
  readonly product_families: readonly string[];
  readonly primary_product_family?: string;
  readonly conflicting_product_family?: string;
  readonly explanation: string;
}

/**
 * Validates the 3-box intake snapshot for cross-request / cross-domain contamination.
 * Rejects submissions where boxes derive from conflicting product domains (e.g. poultry + water heaters)
 * or explicit multi-product requests within a single box.
 */
export function validateIntakeSemanticCoherence(intake: {
  product_requirement?: string | null;
  technical_compliance?: string | null;
  order_profile?: string | null;
  productRequirement?: string | null;
  technicalCompliance?: string | null;
  orderProfile?: string | null;
}): {
  isCoherent: boolean;
  valid: boolean;
  errors: readonly string[];
  violations: readonly string[];
  conflicts: readonly IntakeCoherenceConflict[];
} {
  const errors: string[] = [];
  const reqText = intake.product_requirement ?? intake.productRequirement ?? "";
  const compText =
    intake.technical_compliance ?? intake.technicalCompliance ?? "";
  const ordText = intake.order_profile ?? intake.orderProfile ?? "";

  const reqDomains = detectAllDomains(reqText);
  const compDomains = detectAllDomains(compText);
  const ordDomains = detectAllDomains(ordText);

  const dom1 = reqDomains[0] ?? "generic";
  const dom2 = compDomains[0] ?? "generic";
  const dom3 = ordDomains[0] ?? "generic";

  const domainLabels: Record<string, string> = {
    water_heater: "industrial_water_heater",
    poultry: "poultry_food_product",
    reverse_osmosis: "reverse_osmosis_systems",
    pump: "industrial_pumps",
    coffee: "agricultural_coffee",
  };

  const conflicts: IntakeCoherenceConflict[] = [];

  // 1. Explicit multi-product conflict within Box 1
  if (reqDomains.length > 1) {
    errors.push(
      `Explicit multi-product request detected in Box 1 (${reqDomains.join(", ")}). Unrelated product requests must be submitted separately.`,
    );
    conflicts.push({
      fields: ["product_requirement"],
      product_families: reqDomains.map((d) => domainLabels[d] ?? d),
      primary_product_family: domainLabels[reqDomains[0]!] ?? reqDomains[0]!,
      conflicting_product_family:
        domainLabels[reqDomains[1]!] ?? reqDomains[1]!,
      explanation:
        "The request specifies multiple unrelated product families in the product requirement. Please submit separate research requests for each product family.",
    });
  }

  // 2. Cross-box contamination checks
  const allActiveDomains = Array.from(
    new Set([...reqDomains, ...compDomains, ...ordDomains]),
  );
  if (allActiveDomains.length > 1) {
    for (const compDom of compDomains) {
      if (dom1 !== "generic" && compDom !== dom1) {
        errors.push(
          `Cross-domain intake contamination: Box 1 defines '${dom1}' but Box 2 contains '${compDom}' requirements.`,
        );
        let explanation = `Technical requirements for ${domainLabels[compDom] ?? compDom} do not apply to ${domainLabels[dom1] ?? dom1}.`;
        if (dom1 === "water_heater" && compDom === "poultry") {
          explanation =
            "Poultry slaughter and poultry-establishment requirements do not apply to an industrial electric water heater.";
        } else if (dom1 === "poultry" && compDom === "water_heater") {
          explanation =
            "Water heater electrical and pressure vessel standards do not apply to a poultry food procurement request.";
        }
        conflicts.push({
          fields: [
            "product_requirement",
            "technical_quality_trade_requirements",
          ],
          product_families: [
            domainLabels[dom1] ?? dom1,
            domainLabels[compDom] ?? compDom,
          ],
          primary_product_family: domainLabels[dom1] ?? dom1,
          conflicting_product_family: domainLabels[compDom] ?? compDom,
          explanation,
        });
      }
    }

    for (const ordDom of ordDomains) {
      if (
        dom1 !== "generic" &&
        ordDom !== dom1 &&
        !compDomains.includes(ordDom)
      ) {
        errors.push(
          `Cross-domain intake contamination: Box 1 defines '${dom1}' but Box 3 contains '${ordDom}' profile.`,
        );
        conflicts.push({
          fields: ["product_requirement", "order_supplier_profile"],
          product_families: [
            domainLabels[dom1] ?? dom1,
            domainLabels[ordDom] ?? ordDom,
          ],
          primary_product_family: domainLabels[dom1] ?? dom1,
          conflicting_product_family: domainLabels[ordDom] ?? ordDom,
          explanation: `Order profile for ${domainLabels[ordDom] ?? ordDom} does not apply to a ${domainLabels[dom1] ?? dom1} request.`,
        });
      }
    }

    if (
      dom1 === "generic" &&
      dom2 !== "generic" &&
      dom3 !== "generic" &&
      dom2 !== dom3
    ) {
      errors.push(
        `Cross-domain intake contamination between Box 2 ('${dom2}') and Box 3 ('${dom3}').`,
      );
      conflicts.push({
        fields: [
          "technical_quality_trade_requirements",
          "order_supplier_profile",
        ],
        product_families: [
          domainLabels[dom2] ?? dom2,
          domainLabels[dom3] ?? dom3,
        ],
        primary_product_family: domainLabels[dom2] ?? dom2,
        conflicting_product_family: domainLabels[dom3] ?? dom3,
        explanation: `Conflicting requirements between ${domainLabels[dom2] ?? dom2} and ${domainLabels[dom3] ?? dom3}.`,
      });
    }
  }

  const isCoherent = errors.length === 0;
  return {
    isCoherent,
    valid: isCoherent,
    errors,
    violations: errors,
    conflicts,
  };
}
