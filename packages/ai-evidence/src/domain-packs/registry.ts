import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  DomainPackFieldV1,
  DomainPackResolutionV1,
  DomainPackV1,
} from "@matchbase/contracts";

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

const RESOLVER_VERSION = "synthetic-category-resolver.v1";
const CONFIDENCE_THRESHOLD = 0.8;
const CATEGORY_TERMS = [
  "component",
  "alloy",
  "polymer",
  "industrial",
  "قطعه",
  "صنعتی",
  "مكون",
  "صناعي",
] as const;

interface ActivationPayload {
  account_id: string;
  user_id: string;
  category_id: string;
  registry_version: string;
  pack_version: string;
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
): DomainPackResolutionV1 {
  if (!context.hmacSecret)
    throw new Error("Domain-pack HMAC secret is required.");
  if (input.explicitCategoryId !== undefined) {
    if (input.explicitCategoryId !== SYNTHETIC_DOMAIN_PACK.category_id) {
      throw new Error("Unknown domain-pack category.");
    }
    const expiresAt = new Date(
      context.now.getTime() + context.activationTtlSeconds * 1000,
    ).toISOString();
    return {
      schema_version: "domain-pack-resolution.v1",
      resolver_version: RESOLVER_VERSION,
      category_id: SYNTHETIC_DOMAIN_PACK.category_id,
      confidence: 1,
      activation_state: "confirmed",
      activation_token: encodeActivationToken(
        {
          account_id: context.accountId,
          user_id: context.userId,
          category_id: SYNTHETIC_DOMAIN_PACK.category_id,
          registry_version: SYNTHETIC_DOMAIN_PACK.registry_version,
          pack_version: SYNTHETIC_DOMAIN_PACK.pack_version,
          expires_at: expiresAt,
        },
        context.hmacSecret,
      ),
      pack_version: SYNTHETIC_DOMAIN_PACK.pack_version,
      synthetic: true,
    };
  }

  const normalized = input.sourceText.normalize("NFKC").toLocaleLowerCase("en");
  if (!normalized.trim()) {
    return {
      schema_version: "domain-pack-resolution.v1",
      resolver_version: RESOLVER_VERSION,
      confidence: 0,
      activation_state: "unresolved",
      synthetic: true,
    };
  }
  const matches = CATEGORY_TERMS.filter((term) => normalized.includes(term));
  const confidence = matches.length >= 2 ? 0.92 : 0.45;
  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      schema_version: "domain-pack-resolution.v1",
      resolver_version: RESOLVER_VERSION,
      category_id: SYNTHETIC_DOMAIN_PACK.category_id,
      confidence,
      activation_state: "confirmation_required",
      pack_version: SYNTHETIC_DOMAIN_PACK.pack_version,
      synthetic: true,
    };
  }
  return resolveSyntheticDomainPack(
    { ...input, explicitCategoryId: SYNTHETIC_DOMAIN_PACK.category_id },
    context,
  );
}

export function requireSyntheticDomainPackActivation(
  token: string,
  expected: Pick<
    DomainPackResolutionContext,
    "accountId" | "userId" | "now" | "hmacSecret"
  >,
): DomainPackV1 {
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
  if (
    payload.account_id !== expected.accountId ||
    payload.user_id !== expected.userId ||
    payload.category_id !== SYNTHETIC_DOMAIN_PACK.category_id ||
    payload.registry_version !== SYNTHETIC_DOMAIN_PACK.registry_version ||
    payload.pack_version !== SYNTHETIC_DOMAIN_PACK.pack_version ||
    typeof payload.expires_at !== "string" ||
    Date.parse(payload.expires_at) <= expected.now.getTime()
  ) {
    throw new Error("Domain-pack activation token is invalid or expired.");
  }
  return structuredClone(SYNTHETIC_DOMAIN_PACK);
}
