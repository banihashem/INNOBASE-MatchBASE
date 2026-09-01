import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  DomainPackFieldV1,
  DomainPackV1,
  GovernedDomainPackResolution,
  DomainPackV2,
} from "@matchbase/contracts";
import { domainPackV2ContentSha256 } from "@matchbase/contracts";

const CORE_FIELD_ROWS = [
  [
    "FLD-CORE-PS-01",
    "product_category",
    "product_specification",
    "single_select",
    "required",
  ],
  [
    "FLD-CORE-PS-02",
    "product_subcategory",
    "product_specification",
    "single_select",
    "conditional",
  ],
  [
    "FLD-CORE-PS-03",
    "product_name_raw",
    "product_specification",
    "text",
    "required",
  ],
  [
    "FLD-CORE-PS-04",
    "manufacturer",
    "product_specification",
    "text",
    "optional",
  ],
  ["FLD-CORE-PS-05", "brand", "product_specification", "text", "optional"],
  [
    "FLD-CORE-PS-06",
    "model_names",
    "product_specification",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-PS-07",
    "variants",
    "product_specification",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-PS-08",
    "technical_requirements",
    "product_specification",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-PS-09",
    "conditional_requirements",
    "product_specification",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-PS-10",
    "packaging_requirements",
    "product_specification",
    "multi_select",
    "conditional",
  ],
  [
    "FLD-CORE-PS-11",
    "certification_requirements",
    "product_specification",
    "multi_select",
    "conditional",
  ],
  [
    "FLD-CORE-PS-12",
    "intended_market_use",
    "product_specification",
    "text",
    "optional",
  ],
  [
    "FLD-CORE-PS-13",
    "hs_code_and_edition",
    "product_specification",
    "text",
    "optional",
  ],
  [
    "FLD-CORE-SP-01",
    "required_origin",
    "supplier_producer_profile",
    "multi_select",
    "conditional",
  ],
  [
    "FLD-CORE-SP-02",
    "excluded_origin",
    "supplier_producer_profile",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-SP-03",
    "producer_vs_intermediary",
    "supplier_producer_profile",
    "single_select",
    "required",
  ],
  [
    "FLD-CORE-SP-04",
    "required_capacity",
    "supplier_producer_profile",
    "quantity",
    "conditional",
  ],
  [
    "FLD-CORE-SP-05",
    "market_access_requirements",
    "supplier_producer_profile",
    "multi_select",
    "conditional",
  ],
  [
    "FLD-CORE-SP-06",
    "commercial_reliability_requirements",
    "supplier_producer_profile",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-SP-07",
    "positioning_requirements",
    "supplier_producer_profile",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-SP-08",
    "named_exclusions",
    "supplier_producer_profile",
    "multi_select",
    "optional",
  ],
  [
    "FLD-CORE-TR-01",
    "demand_volume",
    "trade_structure_commercial_execution",
    "quantity",
    "required",
  ],
  [
    "FLD-CORE-TR-02",
    "destination_market",
    "trade_structure_commercial_execution",
    "text",
    "required",
  ],
  [
    "FLD-CORE-TR-03",
    "target_price_and_basis",
    "trade_structure_commercial_execution",
    "quantity",
    "optional",
  ],
  [
    "FLD-CORE-TR-04",
    "incoterm",
    "trade_structure_commercial_execution",
    "single_select",
    "conditional",
  ],
  [
    "FLD-CORE-TR-05",
    "payment_terms",
    "trade_structure_commercial_execution",
    "text",
    "conditional",
  ],
  [
    "FLD-CORE-TR-06",
    "port_of_discharge",
    "trade_structure_commercial_execution",
    "text",
    "conditional",
  ],
  [
    "FLD-CORE-TR-07",
    "timing",
    "trade_structure_commercial_execution",
    "text",
    "conditional",
  ],
  [
    "FLD-CORE-TR-08",
    "relationship_design",
    "trade_structure_commercial_execution",
    "text",
    "optional",
  ],
  [
    "FLD-CORE-TR-09",
    "relaxable_constraints",
    "trade_structure_commercial_execution",
    "multi_select",
    "required",
  ],
  [
    "FLD-CORE-TR-10",
    "non_relaxable_constraints",
    "trade_structure_commercial_execution",
    "multi_select",
    "required",
  ],
  [
    "FLD-CORE-TR-11",
    "risk_constraints",
    "trade_structure_commercial_execution",
    "multi_select",
    "optional",
  ],
] as const satisfies ReadonlyArray<
  readonly [
    string,
    string,
    DomainPackFieldV1["macro_parameter"],
    DomainPackFieldV1["kind"],
    DomainPackFieldV1["requirement"],
  ]
>;

export const STANDARD_DOMAIN_INVARIANT_CORE: DomainPackFieldV1[] =
  CORE_FIELD_ROWS.map(
    ([field_id, label, macro_parameter, kind, requirement]) => ({
      field_id,
      macro_parameter,
      label,
      description: `Domain-invariant canonical field ${label}.`,
      kind,
      requirement,
      allowed_units: [],
      allowed_values: [],
    }),
  );

export const SYNTHETIC_DOMAIN_PACK: DomainPackV1 = {
  schema_version: "domain-pack.v1",
  registry_version: "2026-08-15.1",
  pack_version: "2026-08-15.1",
  category_id: "synthetic_industrial_components",
  category_label: "Synthetic Industrial Components",
  macro_parameters: [
    "product_specification",
    "supplier_producer_profile",
    "trade_structure_commercial_execution",
  ],
  core_fields: STANDARD_DOMAIN_INVARIANT_CORE,
  domain_fields: [
    {
      field_id: "component_material",
      macro_parameter: "product_specification",
      label: "Component material",
      description: "Required synthetic material family.",
      kind: "single_select",
      requirement: "required",
      allowed_units: [],
      allowed_values: ["alloy", "polymer", "composite"],
    },
    {
      field_id: "dimensional_tolerance",
      macro_parameter: "product_specification",
      label: "Dimensional tolerance",
      description: "Required tolerance for the synthetic component.",
      kind: "quantity",
      requirement: "optional",
      allowed_units: ["mm", "micrometre"],
      allowed_values: [],
    },
    {
      field_id: "quality_certification",
      macro_parameter: "supplier_producer_profile",
      label: "Quality certification",
      description: "Requested synthetic quality-system certification.",
      kind: "multi_select",
      requirement: "optional",
      allowed_units: [],
      allowed_values: ["ISO_9001", "IATF_16949", "AS9100"],
    },
    {
      field_id: "incoterm",
      macro_parameter: "trade_structure_commercial_execution",
      label: "Incoterm",
      description: "Preferred synthetic trade term.",
      kind: "single_select",
      requirement: "optional",
      allowed_units: [],
      allowed_values: ["EXW", "FCA", "FOB", "CIF", "DAP"],
    },
  ],
  synthetic: true,
};

const FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK_DEFINITION: Omit<
  DomainPackV2,
  "content_sha256"
> = {
  schema_version: "domain-pack.v2",
  discriminator: "food_agricultural_commodity",
  registry_version: "2026-09-01.1",
  pack_version: "2026-09-01.1",
  category_id: "food_agricultural_commodities",
  category_label: "Food and Agricultural Commodities",
  macro_parameters: [
    "product_specification",
    "supplier_producer_profile",
    "trade_structure_commercial_execution",
  ],
  core_fields: STANDARD_DOMAIN_INVARIANT_CORE,
  domain_fields: [
    {
      field_id: "commodity_variety",
      macro_parameter: "product_specification",
      label: "Variety",
      description: "Named agricultural commodity variety or cultivar.",
      kind: "text",
      requirement: "required",
      allowed_units: [],
      allowed_values: [],
    },
    {
      field_id: "commodity_grade",
      macro_parameter: "product_specification",
      label: "Grade and quality",
      description:
        "Required commercial grade, size, quality, and defect limits.",
      kind: "text",
      requirement: "conditional",
      allowed_units: [],
      allowed_values: [],
    },
    {
      field_id: "commodity_origin",
      macro_parameter: "supplier_producer_profile",
      label: "Origin",
      description: "Required country or production origin.",
      kind: "multi_select",
      requirement: "conditional",
      allowed_units: [],
      allowed_values: [],
    },
    {
      field_id: "container_quantity",
      macro_parameter: "trade_structure_commercial_execution",
      label: "Container quantity",
      description: "Number and type of shipping containers required.",
      kind: "quantity",
      requirement: "required",
      allowed_units: ["container", "20_ft_container", "40_ft_container"],
      allowed_values: [],
    },
    {
      field_id: "routing_via",
      macro_parameter: "trade_structure_commercial_execution",
      label: "Required route",
      description: "Required transit hub or route, including Dubai routing.",
      kind: "text",
      requirement: "conditional",
      allowed_units: [],
      allowed_values: [],
    },
    {
      field_id: "distribution_destination",
      macro_parameter: "trade_structure_commercial_execution",
      label: "Destination market",
      description: "Final country, region, or distribution market.",
      kind: "text",
      requirement: "required",
      allowed_units: [],
      allowed_values: [],
    },
    {
      field_id: "current_stock",
      macro_parameter: "supplier_producer_profile",
      label: "Current stock",
      description: "Minimum stock currently required to be available.",
      kind: "quantity",
      requirement: "conditional",
      allowed_units: ["kg", "metric_tonne", "container"],
      allowed_values: [],
    },
    {
      field_id: "food_certifications",
      macro_parameter: "supplier_producer_profile",
      label: "Food certifications",
      description:
        "Food safety, phytosanitary, quality, or market-access certifications.",
      kind: "multi_select",
      requirement: "conditional",
      allowed_units: [],
      allowed_values: [
        "HACCP",
        "ISO_22000",
        "BRCGS",
        "IFS",
        "phytosanitary_certificate",
        "certificate_of_origin",
      ],
    },
    {
      field_id: "export_readiness",
      macro_parameter: "supplier_producer_profile",
      label: "Export readiness",
      description:
        "Required export licence, customs documents, and destination compliance.",
      kind: "multi_select",
      requirement: "conditional",
      allowed_units: [],
      allowed_values: [],
    },
    {
      field_id: "logistics_requirements",
      macro_parameter: "trade_structure_commercial_execution",
      label: "Logistics requirements",
      description:
        "Packaging, storage, handling, freight, transshipment, and delivery requirements.",
      kind: "multi_select",
      requirement: "conditional",
      allowed_units: [],
      allowed_values: [],
    },
  ],
  synthetic: false,
};

export const FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK_CONTENT_SHA256 =
  domainPackV2ContentSha256(FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK_DEFINITION);

export const FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK: DomainPackV2 = {
  ...structuredClone(FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK_DEFINITION),
  content_sha256: FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK_CONTENT_SHA256,
};

const DOMAIN_PACKS = new Map(
  [SYNTHETIC_DOMAIN_PACK, FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK].map(
    (pack) => [pack.category_id, pack] as const,
  ),
);

export const SYNTHETIC_DOMAIN_PACK_RESOLVER_VERSION =
  "synthetic-category-resolver.v1" as const;
export const AGRICULTURAL_DOMAIN_PACK_RESOLVER_VERSION =
  "governed-agricultural-category-resolver.v2" as const;
const CONFIDENCE_THRESHOLD = 0.8;
const INDUSTRIAL_IDENTITY_CONCEPTS = [
  ["component", "components", "قطعه", "مكون"],
  ["alloy", "polymer", "composite"],
  ["industrial", "صنعتی", "صناعي"],
] as const;
const AGRICULTURAL_IDENTITY_CONCEPTS = [
  ["pistachio", "pistachios", "پسته", "فستق"],
  ["ahmad aghaei", "ahmad-aghaei", "احمد آقایی", "احمدآقایی"],
  ["agricultural commodity", "food commodity", "محصول کشاورزی", "سلعة زراعية"],
  ["iranian pistachio", "iran pistachio", "پسته ایرانی", "فستق إيراني"],
] as const;

function matchedConceptCount(
  normalized: string,
  concepts: ReadonlyArray<readonly string[]>,
): number {
  return concepts.filter((aliases) =>
    aliases.some((alias) => normalized.includes(alias)),
  ).length;
}

interface ActivationPayload {
  account_id: string;
  user_id: string;
  category_id: string;
  registry_version: string;
  pack_version: string;
  content_sha256?: string;
  expires_at: string;
}

export interface DomainPackResolutionContext {
  accountId: string;
  userId: string;
  now: Date;
  activationTtlSeconds: number;
  hmacSecret: string;
}

export interface DomainPackResolutionInput {
  sourceText: string;
  explicitCategoryId?: string;
}

function encodeActivationToken(
  payload: ActivationPayload,
  secret: string,
): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(encoded, "utf8")
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function resolveSyntheticDomainPack(
  input: DomainPackResolutionInput,
  context: DomainPackResolutionContext,
): GovernedDomainPackResolution {
  if (!context.hmacSecret)
    throw new Error("Domain-pack HMAC secret is required.");
  if (input.explicitCategoryId !== undefined) {
    const explicitPack = DOMAIN_PACKS.get(input.explicitCategoryId);
    if (!explicitPack) {
      throw new Error("Unknown domain-pack category.");
    }
    const expiresAt = new Date(
      context.now.getTime() + context.activationTtlSeconds * 1000,
    ).toISOString();
    return {
      schema_version: explicitPack.synthetic
        ? "domain-pack-resolution.v1"
        : "domain-pack-resolution.v2",
      resolver_version: explicitPack.synthetic
        ? SYNTHETIC_DOMAIN_PACK_RESOLVER_VERSION
        : AGRICULTURAL_DOMAIN_PACK_RESOLVER_VERSION,
      category_id: explicitPack.category_id,
      confidence: 1,
      activation_state: "confirmed",
      activation_token: encodeActivationToken(
        {
          account_id: context.accountId,
          user_id: context.userId,
          category_id: explicitPack.category_id,
          registry_version: explicitPack.registry_version,
          pack_version: explicitPack.pack_version,
          ...(explicitPack.synthetic
            ? {}
            : { content_sha256: explicitPack.content_sha256 }),
          expires_at: expiresAt,
        },
        context.hmacSecret,
      ),
      pack_version: explicitPack.pack_version,
      synthetic: explicitPack.synthetic,
      ...(explicitPack.synthetic
        ? {}
        : {
            discriminator: "food_agricultural_commodity" as const,
            content_sha256: explicitPack.content_sha256,
          }),
    } as GovernedDomainPackResolution;
  }

  const normalized = input.sourceText.normalize("NFKC").toLocaleLowerCase("en");
  if (!normalized.trim()) {
    return {
      schema_version: "domain-pack-resolution.v1",
      resolver_version: SYNTHETIC_DOMAIN_PACK_RESOLVER_VERSION,
      confidence: 0,
      activation_state: "unresolved",
      synthetic: true,
    } as GovernedDomainPackResolution;
  }
  const industrialConcepts = matchedConceptCount(
    normalized,
    INDUSTRIAL_IDENTITY_CONCEPTS,
  );
  const agriculturalConcepts = matchedConceptCount(
    normalized,
    AGRICULTURAL_IDENTITY_CONCEPTS,
  );
  if (
    (industrialConcepts > 0 && agriculturalConcepts > 0) ||
    (industrialConcepts === 0 && agriculturalConcepts === 0)
  ) {
    return {
      schema_version: "domain-pack-resolution.v1",
      resolver_version: SYNTHETIC_DOMAIN_PACK_RESOLVER_VERSION,
      confidence: 0,
      activation_state: "unresolved",
      synthetic: true,
    };
  }
  const selected =
    agriculturalConcepts > 0
      ? FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK
      : SYNTHETIC_DOMAIN_PACK;
  const selectedConcepts = Math.max(industrialConcepts, agriculturalConcepts);
  const requiredConcepts =
    selected === FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK ? 2 : 2;
  const confidence = selectedConcepts >= requiredConcepts ? 0.92 : 0.45;
  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      schema_version: selected.synthetic
        ? "domain-pack-resolution.v1"
        : "domain-pack-resolution.v2",
      resolver_version: selected.synthetic
        ? SYNTHETIC_DOMAIN_PACK_RESOLVER_VERSION
        : AGRICULTURAL_DOMAIN_PACK_RESOLVER_VERSION,
      category_id: selected.category_id,
      confidence,
      activation_state: "confirmation_required",
      pack_version: selected.pack_version,
      synthetic: selected.synthetic,
      ...(selected.synthetic
        ? {}
        : {
            discriminator: "food_agricultural_commodity" as const,
            content_sha256: selected.content_sha256,
          }),
    } as GovernedDomainPackResolution;
  }
  return resolveSyntheticDomainPack(
    { ...input, explicitCategoryId: selected.category_id },
    context,
  );
}

export function requireSyntheticDomainPackActivation(
  token: string,
  expected: Pick<
    DomainPackResolutionContext,
    "accountId" | "userId" | "now" | "hmacSecret"
  >,
): DomainPackV1 | DomainPackV2 {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) {
    throw new Error("Domain-pack activation token is invalid.");
  }
  const expectedSignature = createHmac("sha256", expected.hmacSecret)
    .update(encoded, "utf8")
    .digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (
    expectedSignature.length !== supplied.length ||
    !timingSafeEqual(expectedSignature, supplied)
  ) {
    throw new Error("Domain-pack activation token is invalid.");
  }
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as Partial<ActivationPayload>;
  const pack =
    typeof payload.category_id === "string"
      ? DOMAIN_PACKS.get(payload.category_id)
      : undefined;
  if (
    payload.account_id !== expected.accountId ||
    payload.user_id !== expected.userId ||
    !pack ||
    payload.registry_version !== pack.registry_version ||
    payload.pack_version !== pack.pack_version ||
    (!pack.synthetic && payload.content_sha256 !== pack.content_sha256) ||
    typeof payload.expires_at !== "string" ||
    Date.parse(payload.expires_at) <= expected.now.getTime()
  ) {
    throw new Error("Domain-pack activation token is invalid or expired.");
  }
  return structuredClone(pack);
}
