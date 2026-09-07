import { createHash } from "node:crypto";
import { parseSupplierServiceRequirements } from "./supplier-requirements.js";

export type ApprovedFactOperator =
  "eq" | "gte" | "lte" | "range" | "requires" | "prohibits";

export interface ApprovedRequestFactV3 {
  readonly fact_id: string;
  readonly concept: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
  readonly operator: ApprovedFactOperator;
  readonly modality: "mandatory" | "preferred" | "optional";
  readonly upper_bound?: number;
  readonly qualifiers: Readonly<Record<string, string>>;
  readonly source_clause: string;
  readonly source_box:
    | "product_requirement"
    | "technical_compliance"
    | "order_profile"
    | "approved_translation";
  readonly provenance: "explicit_approved_text";
}

export interface ApprovedRequestSnapshotV3 {
  readonly schema_version: "approved-request.v3.1";
  readonly revision_id: string;
  readonly content_hash: string;
  readonly source_intake_hash?: string;
  readonly approved_at: string;
  readonly approved_translation: string;
  readonly product_name: string;
  readonly product_category: string;
  readonly facts: readonly ApprovedRequestFactV3[];
  readonly unknown_fields: readonly string[];
  readonly unparsed_clauses: readonly string[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function verifyApprovedRequestSnapshotV3(
  value: unknown,
): value is ApprovedRequestSnapshotV3 {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as ApprovedRequestSnapshotV3;
  if (
    snapshot.schema_version !== "approved-request.v3.1" ||
    !snapshot.approved_translation?.trim() ||
    !snapshot.revision_id ||
    !Array.isArray(snapshot.facts) ||
    !Array.isArray(snapshot.unknown_fields) ||
    !Array.isArray(snapshot.unparsed_clauses)
  )
    return false;
  const { content_hash, ...payload } = snapshot;
  return (
    typeof content_hash === "string" &&
    createHash("sha256").update(canonicalJson(payload)).digest("hex") ===
      content_hash
  );
}

export function normalizeRequirementText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[–—−]/g, "-")
    .replace(/\u200c/g, " ")
    .replace(
      /(یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)(?=\s*(?:سال|ماه|دستگاه|واحد|عدد))/g,
      (word) =>
        String(
          (
            {
              یک: 1,
              دو: 2,
              سه: 3,
              چهار: 4,
              پنج: 5,
              شش: 6,
              هفت: 7,
              هشت: 8,
              نه: 9,
              ده: 10,
            } as Record<string, number>
          )[word],
        ),
    )
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/gi,
      (word) =>
        String(
          (
            {
              one: 1,
              two: 2,
              three: 3,
              four: 4,
              five: 5,
              six: 6,
              seven: 7,
              eight: 8,
              nine: 9,
              ten: 10,
              twelve: 12,
            } as Record<string, number>
          )[word.toLowerCase()],
        ),
    )
    .replace(/حداقل/g, "minimum")
    .replace(/حداکثر/g, "maximum")
    .replace(/فشار\s*(?:کاری|کارکرد|عملکرد)?/g, "working pressure ")
    .replace(/قطر\s*(?:خارجی|بیرونی|بدنه)?/g, "outer diameter ")
    .replace(/سه\s*فاز/g, "3-phase")
    .replace(/تک\s*فاز/g, "single-phase")
    .replace(/گارانتی|ضمانت/g, "warranty")
    .replace(/ماهه?/g, "months")
    .replace(/ساله?/g, "years")
    .replace(/امارات/g, "UAE")
    .replace(/ابوظبی/g, "Abu Dhabi")
    .replace(/دبی/g, "Dubai")
    .replace(/شارجه/g, "Sharjah")
    .replace(/جده/g, "Jeddah")
    .replace(/دمام/g, "Dammam")
    .replace(/\s+/g, " ")
    .trim();
}

function operator(text: string): ApprovedFactOperator {
  if (
    /\b(?:maximum|max|at most|up to|not more than|no more than|capped|limited)\b|<=|≤/i.test(
      text,
    )
  )
    return "lte";
  if (
    /\b(?:minimum|min|at least|not less than|no less than)\b|>=|≥/i.test(text)
  )
    return "gte";
  return "eq";
}

function polarity(text: string): ApprovedFactOperator {
  return /\b(?:not required|not permitted|not allowed|without|exclude|prohibited|no)\b/i.test(
    text,
  )
    ? "prohibits"
    : "requires";
}

function unitContext(clause: string, index: number, length: number): string {
  // Operators belong to the quantity's local phrase, never to another requirement.
  const before =
    clause
      .slice(0, index)
      .split(/\band\b|\bwith\b|\bfor\b/i)
      .at(-1) ?? "";
  const after =
    clause.slice(index + length).split(/\band\b|\bwith\b|\bfor\b/i)[0] ?? "";
  const prefix =
    before.match(
      /(?:minimum|maximum|min|max|at least|at most|up to|not less than|not more than|no less than|no more than|capped|limited|>=|<=|≥|≤)\s*(?:(?:working|operating|outer|external|storage|pressure|diameter|capacity|rating|of|is|at|:|strictly)\s*){0,5}$/i,
    )?.[0] ?? "";
  const suffix =
    after.match(
      /^\s*(?:(?:working|operating|outer|external|storage|pressure|diameter|capacity|rating)\s*){0,3}(?:minimum|maximum|min|max|at least|at most|up to|not less than|not more than)\b/i,
    )?.[0] ?? "";
  return `${prefix} ${suffix}`;
}

export function parseApprovedRequestFactsV3(
  text: string,
  sourceBox: ApprovedRequestFactV3["source_box"] = "approved_translation",
): { facts: ApprovedRequestFactV3[]; unparsed_clauses: string[] } {
  const facts: ApprovedRequestFactV3[] = [];
  const unparsed: string[] = [];
  const clauses = text
    .split(/[,،;؛\n\r]+|\.(?=\s|$)/)
    .map((x) => x.trim())
    .filter(Boolean);
  const add = (
    concept: string,
    label: string,
    value: string | number | boolean,
    source: string,
    options: {
      unit?: string;
      operator?: ApprovedFactOperator;
      upper_bound?: number;
      qualifiers?: Record<string, string>;
    } = {},
  ) => {
    const key = JSON.stringify([
      concept,
      value,
      options.unit,
      options.operator,
      options.qualifiers,
      source,
    ]);
    facts.push({
      fact_id: createHash("sha256").update(key).digest("hex").slice(0, 24),
      concept,
      label,
      value,
      operator: options.operator ?? "requires",
      modality: /\bprefer(?:red|ably)?\b|ترجیح/i.test(source)
        ? "preferred"
        : /\boptional(?:ly)?\b|اختیاری/i.test(source)
          ? "optional"
          : "mandatory",
      qualifiers: options.qualifiers ?? {},
      source_clause: source,
      source_box: sourceBox,
      provenance: "explicit_approved_text",
      ...(options.unit ? { unit: options.unit } : {}),
      ...(options.upper_bound !== undefined
        ? { upper_bound: options.upper_bound }
        : {}),
    });
  };
  for (const source of clauses) {
    const clause = normalizeRequirementText(source);
    const startCount = facts.length;
    for (const [pattern, family] of [
      [/water\s*heater|calorifier|آب[‌ ]?گرمکن|ابگرمکن|سخان/i, "water heater"],
      [/\bpoultry\b|\bchicken\b|مرغ|طیور|دواجن|دجاج/i, "poultry"],
      [/\bpump\b|پمپ|مضخة/i, "pump"],
      [/reverse osmosis|اسمز\s*معکوس/i, "reverse osmosis"],
      [/\bcoffee\b|قهوه|قهوة/i, "coffee"],
    ] as const) {
      if (pattern.test(clause))
        add("product_family", "Product Family", family, source, {
          operator: "eq",
        });
    }
    const number = String.raw`(\d+(?:\.\d+)?)`;
    const capacity = new RegExp(
      `${number}\\s*(litres?|liters?|l\\b|لیتر)`,
      "ig",
    );
    for (const match of clause.matchAll(capacity))
      add("storage_capacity", "Storage Capacity", Number(match[1]), source, {
        unit: "L",
        operator: operator(unitContext(clause, match.index!, match[0].length)),
      });
    for (const match of clause.matchAll(
      new RegExp(`${number}\\s*(bar\\b|بار|kpa\\b|mpa\\b|psi\\b)`, "ig"),
    )) {
      const unit = match[2]!.toLowerCase();
      const multiplier =
        unit === "mpa"
          ? 10
          : unit === "kpa"
            ? 0.01
            : unit === "psi"
              ? 0.0689475729
              : 1;
      add(
        "working_pressure",
        "Working Pressure",
        Number((Number(match[1]) * multiplier).toFixed(6)),
        source,
        {
          unit: "bar",
          operator: operator(
            unitContext(clause, match.index!, match[0].length),
          ),
        },
      );
    }
    if (/diameter|قطر/i.test(clause)) {
      for (const match of clause.matchAll(
        new RegExp(
          `${number}\\s*(cm\\b|mm\\b|m\\b|سانتی\\s*متر|میلی\\s*متر)`,
          "ig",
        ),
      )) {
        const u = match[2]!.toLowerCase();
        const multiplier =
          u === "mm" || /میلی/.test(u) ? 0.1 : u === "m" ? 100 : 1;
        add(
          "external_diameter",
          "External Diameter",
          Number((Number(match[1]) * multiplier).toFixed(6)),
          source,
          {
            unit: "cm",
            operator: operator(
              unitContext(clause, match.index!, match[0].length),
            ),
          },
        );
      }
    }
    for (const match of clause.matchAll(
      new RegExp(`${number}\\s*(?:v\\b|volts?\\b|ولت)`, "ig"),
    )) {
      const phase = /(?:3|three)[- ]phase/i.test(clause)
        ? "three-phase"
        : /(?:1|single|one)[- ]phase/i.test(clause)
          ? "single-phase"
          : undefined;
      const hz = clause.match(/(\d+(?:\.\d+)?)\s*(?:hz|هرتز)/i)?.[1];
      add(
        "electrical_power",
        "Electrical Power Supply",
        Number(match[1]),
        source,
        {
          unit: "V",
          operator: "eq",
          qualifiers: {
            ...(phase ? { phase } : {}),
            ...(hz ? { frequency_hz: hz } : {}),
          },
        },
      );
    }
    if (/\bwarranty\b/i.test(clause)) {
      const duration =
        clause.match(
          /(\d+(?:\.\d+)?)\s*[- ]?\s*(years?|months?)\b(?=\s*(?:(?:UAE|local|manufacturer'?s?|comprehensive|tank|parts)\s+){0,3}warranty\b)/i,
        ) ??
        clause.match(
          /(?<=warranty\s)(?:period\s+|duration\s+|of\s+|for\s+|is\s+|minimum\s*|maximum\s*|at least\s+|at most\s+)*(\d+(?:\.\d+)?)\s*[- ]?\s*(years?|months?)\b/i,
        );
      if (duration) {
        const months =
          Number(duration[1]) * (/year/i.test(duration[2]!) ? 12 : 1);
        add("warranty_duration", "Warranty Period", months, source, {
          unit: "months",
          operator: operator(clause),
          qualifiers: /\bUAE\b|United Arab Emirates/i.test(clause)
            ? { jurisdiction: "UAE" }
            : {},
        });
      } else
        add("warranty_service", "Warranty Service", true, source, {
          operator: polarity(clause),
        });
    }
    const quantity = clause.match(
      /(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*(units?\b|pieces?\b|دستگاه|عدد|calorifiers?\b)/i,
    );
    if (quantity)
      add("order_quantity", "Order Quantity", Number(quantity[1]), source, {
        unit: "units",
        operator: quantity[2]
          ? "range"
          : operator(unitContext(clause, quantity.index!, quantity[0].length)),
        ...(quantity[2] ? { upper_bound: Number(quantity[2]) } : {}),
      });
    const delivery = clause.match(
      /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b(?:\s+([^.;,]+))?/i,
    );
    if (delivery) {
      const destination = (delivery[2] ?? "")
        .split(
          /\b(?:delivery|terms|including|with|for|incoterms?|payment|exactly|quantity)\b/i,
        )[0]!
        .trim()
        .replace(/[.]+$/, "");
      add(
        "delivery_terms",
        "Delivery Terms",
        delivery[1]!.toUpperCase(),
        source,
        { operator: "eq", qualifiers: destination ? { destination } : {} },
      );
    }
    const supplierRequirements = parseSupplierServiceRequirements(clause);
    for (const requirement of supplierRequirements)
      add(requirement.concept, requirement.label, requirement.value, source, {
        operator: requirement.operator,
        qualifiers: requirement.qualifiers,
      });
    const hasOperatingPresence = supplierRequirements.some(
      (requirement) => requirement.concept === "supplier_operational_presence",
    );
    if (
      /distributor|توزیع\s*کننده/i.test(clause) ||
      (!hasOperatingPresence && /نماینده/i.test(clause))
    ) {
      const authorized = /\bauthori[sz]ed\b|مجاز/i.test(clause);
      const jurisdiction =
        /(?:authori[sz]ed\s+UAE\s+distributor|distributor\s+(?:in|for)\s+(?:the\s+)?UAE|مجاز.*UAE)/i.test(
          clause,
        )
          ? "UAE"
          : undefined;
      add("supplier_profile", "Supplier Profile", "distributor", source, {
        operator: polarity(clause),
        qualifiers: {
          authorization: authorized ? "authorized" : "unspecified",
          ...(jurisdiction ? { jurisdiction } : {}),
          ...(/manufacturer\s+or|سازنده.*یا/i.test(clause)
            ? { alternative: "manufacturer" }
            : {}),
        },
      });
    } else if (
      /\b(?:original|direct|OEM)\s+manufacturer\b|سازنده\s*اصلی/i.test(clause)
    ) {
      add("supplier_profile", "Supplier Profile", "manufacturer", source, {
        operator: polarity(clause),
      });
    }
    if (/\binsulation\b|عایق/i.test(clause))
      add("thermal_insulation", "Thermal Insulation", true, source, {
        operator: polarity(clause),
        qualifiers: /documented|مستند/i.test(clause)
          ? { evidence: "documented" }
          : {},
      });
    if (
      /safety[- ]valve|pressure relief valve|شیر\s*(?:اطمینان|ایمنی)/i.test(
        clause,
      )
    )
      add(
        "safety_valve_compatibility",
        "Safety-Valve Compatibility",
        true,
        source,
        { operator: polarity(clause) },
      );
    if (/\bBMS\b|building management system/i.test(clause))
      add("bms_compatibility", "BMS-Compatible Controls", true, source, {
        operator: polarity(clause),
      });
    for (const [pattern, concept, label] of [
      [
        /\bindoor\b|موتورخانه|نصب\s*داخلی/i,
        "installation_environment",
        "Indoor Installation",
      ],
      [/\bcontinuous\b|مداوم|دائمی/i, "operating_mode", "Continuous Operation"],
      [
        /local\s+installation\s+support|installation\s+support|پشتیبانی\s*نصب/i,
        "installation_support",
        "Installation Support",
      ],
      [
        /spare[- ]parts?|local\s+spares|قطعات\s*یدکی/i,
        "spare_parts",
        "Spare Parts Support",
      ],
      [
        /official\s+website|وب\s*سایت\s*رسمی/i,
        "official_website",
        "Official Website",
      ],
      [
        /\b(?:business\s+|official\s+)?email\b|ایمیل/i,
        "email_contact",
        "Business Email",
      ],
      [/\btelephone\b|\bphone\b|تلفن/i, "telephone_contact", "Telephone"],
    ] as const)
      if (pattern.test(clause))
        add(concept, label, true, source, { operator: polarity(clause) });
    for (const certification of [
      "CE",
      "PED",
      "SFDA",
      "HACCP",
      "ISO 9001",
      "ISO 22000",
      "Halal",
      "MoIAT",
      "G-Mark",
      "ATEX",
    ]) {
      if (new RegExp(`\\b${certification}\\b`, "i").test(clause))
        add("certification", "Required Certification", certification, source, {
          operator: polarity(clause),
        });
    }
    if (facts.length === startCount) unparsed.push(source);
  }
  return { facts, unparsed_clauses: unparsed };
}

function formatSupplierAlternatives(
  fact: ApprovedRequestFactV3,
  kind: "role" | "presence",
): string {
  const names: Record<string, string> = {
    freight_forwarder: "Freight Forwarder",
    nvocc: "NVOCC",
  };
  const memberLocations = new Map(
    (fact.qualifiers[`${kind}_jurisdictions`] ?? "")
      .split("|")
      .filter(Boolean)
      .map((item) => [
        item.slice(0, item.indexOf(":")),
        item.slice(item.indexOf(":") + 1),
      ]),
  );
  return String(fact.value)
    .split("|")
    .map((member) => {
      const location = memberLocations.get(member);
      return `${names[member] ?? member}${location ? ` in ${location}` : ""}`;
    })
    .join(fact.qualifiers[`${kind}_combination`] === "any" ? " or " : " and ");
}

export function formatApprovedFactV3(fact: ApprovedRequestFactV3): string {
  const prefix =
    fact.operator === "gte"
      ? "Minimum "
      : fact.operator === "lte"
        ? "Maximum "
        : fact.operator === "prohibits"
          ? "Excluded: "
          : "";
  if (fact.concept === "supplier_operational_presence") {
    const modes = formatSupplierAlternatives(fact, "presence");
    return `${prefix}${fact.qualifiers.scope === "operational" ? "Operational " : ""}${modes}${fact.qualifiers.jurisdiction ? ` in ${fact.qualifiers.jurisdiction}` : ""}`;
  }
  if (fact.concept === "supplier_profile" && fact.qualifiers.role_combination) {
    const roles = formatSupplierAlternatives(fact, "role");
    return `${prefix}${roles}${fact.qualifiers.activity ? ` ${fact.qualifiers.activity}` : ""}${fact.qualifiers.jurisdiction ? ` in ${fact.qualifiers.jurisdiction}` : ""}${fact.qualifiers.experience_jurisdiction ? `; experience in ${fact.qualifiers.experience_jurisdiction}` : ""}`;
  }
  const value =
    typeof fact.value === "boolean"
      ? fact.label
      : `${fact.value}${fact.upper_bound !== undefined ? `-${fact.upper_bound}` : ""}${fact.unit ? ` ${fact.unit}` : ""}`;
  const qualifiers = Object.entries(fact.qualifiers)
    .map(([key, val]) => (key === "frequency_hz" ? `${val} Hz` : val))
    .join("; ");
  return `${prefix}${value}${qualifiers ? ` (${qualifiers})` : ""}`;
}

export function createApprovedRequestSnapshotV3(input: {
  revision_id: string;
  approved_translation: string;
  product_name: string;
  product_category: string;
  approved_at: string;
  intake?: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  };
}): ApprovedRequestSnapshotV3 {
  if (!input.approved_translation.trim())
    throw new Error("An approved request requires non-empty approved text.");
  const parsed = parseApprovedRequestFactsV3(input.approved_translation);
  const payload = {
    schema_version: "approved-request.v3.1" as const,
    revision_id: input.revision_id,
    approved_at: input.approved_at,
    approved_translation: input.approved_translation.trim(),
    product_name: input.product_name,
    product_category: input.product_category,
    facts: parsed.facts,
    unknown_fields: [
      "storage_capacity",
      "working_pressure",
      "external_diameter",
      "electrical_power",
      "order_quantity",
      "warranty_duration",
      "delivery_terms",
    ].filter((concept) => !parsed.facts.some((f) => f.concept === concept)),
    unparsed_clauses: parsed.unparsed_clauses,
    ...(input.intake
      ? {
          source_intake_hash: createHash("sha256")
            .update(
              [
                input.intake.product_requirement.trim(),
                input.intake.technical_compliance.trim(),
                input.intake.order_profile.trim(),
              ].join("\n---\n"),
            )
            .digest("hex"),
        }
      : {}),
  };
  return {
    ...payload,
    content_hash: createHash("sha256")
      .update(canonicalJson(payload))
      .digest("hex"),
  };
}
