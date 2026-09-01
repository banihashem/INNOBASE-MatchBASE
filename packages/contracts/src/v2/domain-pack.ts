import { createHash } from "node:crypto";
import type {
  DomainPackFieldV1,
  DomainPackResolutionV1,
  DomainPackV1,
} from "../v1/domain-pack.js";

export const DOMAIN_PACK_V2_SCHEMA_VERSION = "domain-pack.v2" as const;
export const DOMAIN_PACK_RESOLUTION_V2_SCHEMA_VERSION =
  "domain-pack-resolution.v2" as const;
export const AGRICULTURAL_DOMAIN_PACK_DISCRIMINATOR =
  "food_agricultural_commodity" as const;

export interface DomainPackV2 {
  schema_version: typeof DOMAIN_PACK_V2_SCHEMA_VERSION;
  discriminator: typeof AGRICULTURAL_DOMAIN_PACK_DISCRIMINATOR;
  registry_version: string;
  pack_version: string;
  category_id: string;
  category_label: string;
  macro_parameters: [
    "product_specification",
    "supplier_producer_profile",
    "trade_structure_commercial_execution",
  ];
  core_fields: DomainPackFieldV1[];
  domain_fields: DomainPackFieldV1[];
  synthetic: false;
  content_sha256: string;
}

interface DomainPackResolutionBaseV2 {
  schema_version: typeof DOMAIN_PACK_RESOLUTION_V2_SCHEMA_VERSION;
  discriminator: typeof AGRICULTURAL_DOMAIN_PACK_DISCRIMINATOR;
  resolver_version: string;
  confidence: number;
  synthetic: false;
}

export type DomainPackResolutionV2 = DomainPackResolutionBaseV2 &
  (
    | {
        activation_state: "confirmed";
        category_id: string;
        pack_version: string;
        content_sha256: string;
        activation_token: string;
      }
    | {
        activation_state: "confirmation_required";
        category_id: string;
        pack_version: string;
        content_sha256: string;
      }
    | { activation_state: "unresolved" }
  );

export type GovernedDomainPack = DomainPackV1 | DomainPackV2;
export type GovernedDomainPackResolution =
  DomainPackResolutionV1 | DomainPackResolutionV2;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function domainPackV2ContentSha256(
  value: Omit<DomainPackV2, "content_sha256">,
): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const observed = Object.keys(value);
  if (
    observed.length !== keys.length ||
    observed.some((key) => !keys.includes(key)) ||
    keys.some((key) => !observed.includes(key))
  )
    throw new Error(`${label} is not closed.`);
}

function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
}

function assertField(value: unknown): void {
  const field = object(value, "Domain-pack v2 field");
  exact(
    field,
    [
      "field_id",
      "macro_parameter",
      "label",
      "description",
      "kind",
      "requirement",
      "allowed_units",
      "allowed_values",
    ],
    "Domain-pack v2 field",
  );
  for (const key of ["field_id", "label", "description"])
    string(field[key], `Domain-pack v2 field ${key}`);
  if (
    ![
      "product_specification",
      "supplier_producer_profile",
      "trade_structure_commercial_execution",
    ].includes(String(field.macro_parameter))
  )
    throw new Error("Domain-pack v2 field macro parameter is invalid.");
  if (
    ![
      "text",
      "integer",
      "decimal",
      "boolean",
      "single_select",
      "multi_select",
      "quantity",
    ].includes(String(field.kind))
  )
    throw new Error("Domain-pack v2 field kind is invalid.");
  if (
    !["required", "conditional", "optional"].includes(String(field.requirement))
  )
    throw new Error("Domain-pack v2 field requirement is invalid.");
  for (const key of ["allowed_units", "allowed_values"])
    if (
      !Array.isArray(field[key]) ||
      field[key].some((item) => typeof item !== "string")
    )
      throw new Error(`Domain-pack v2 field ${key} is invalid.`);
}

export function parseDomainPackV2(value: unknown): DomainPackV2 {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const pack = object(normalized, "Domain pack v2");
  exact(
    pack,
    [
      "schema_version",
      "discriminator",
      "registry_version",
      "pack_version",
      "category_id",
      "category_label",
      "macro_parameters",
      "core_fields",
      "domain_fields",
      "synthetic",
      "content_sha256",
    ],
    "Domain pack v2",
  );
  if (pack.schema_version !== DOMAIN_PACK_V2_SCHEMA_VERSION)
    throw new Error("Domain pack v2 schema version is invalid.");
  if (pack.discriminator !== AGRICULTURAL_DOMAIN_PACK_DISCRIMINATOR)
    throw new Error("Domain pack v2 discriminator is invalid.");
  if (pack.synthetic !== false)
    throw new Error("Domain pack v2 synthetic boundary is invalid.");
  for (const key of [
    "registry_version",
    "pack_version",
    "category_id",
    "category_label",
  ])
    string(pack[key], `Domain pack v2 ${key}`);
  if (!/^[a-f0-9]{64}$/u.test(String(pack.content_sha256)))
    throw new Error("Domain pack v2 content digest is invalid.");
  const digestInput = structuredClone(pack);
  delete digestInput.content_sha256;
  if (
    pack.content_sha256 !==
    domainPackV2ContentSha256(
      digestInput as unknown as Omit<DomainPackV2, "content_sha256">,
    )
  )
    throw new Error("Domain pack v2 content digest is inconsistent.");
  if (
    JSON.stringify(pack.macro_parameters) !==
    JSON.stringify([
      "product_specification",
      "supplier_producer_profile",
      "trade_structure_commercial_execution",
    ])
  )
    throw new Error("Domain pack v2 macro parameters are invalid.");
  if (!Array.isArray(pack.core_fields) || !Array.isArray(pack.domain_fields))
    throw new Error("Domain pack v2 fields are invalid.");
  [...pack.core_fields, ...pack.domain_fields].forEach(assertField);
  const ids = [...pack.core_fields, ...pack.domain_fields].map((entry) =>
    String(object(entry, "Domain-pack v2 field").field_id),
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Domain pack v2 field ids are duplicated.");
  return Object.freeze(normalized as DomainPackV2);
}

export function parseDomainPackResolutionV2(
  value: unknown,
): DomainPackResolutionV2 {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const item = object(normalized, "Domain-pack resolution v2");
  const state = String(item.activation_state);
  const base = [
    "schema_version",
    "discriminator",
    "resolver_version",
    "confidence",
    "activation_state",
    "synthetic",
  ];
  const keys =
    state === "confirmed"
      ? [
          ...base,
          "category_id",
          "pack_version",
          "content_sha256",
          "activation_token",
        ]
      : state === "confirmation_required"
        ? [...base, "category_id", "pack_version", "content_sha256"]
        : base;
  exact(item, keys, "Domain-pack resolution v2");
  if (item.schema_version !== DOMAIN_PACK_RESOLUTION_V2_SCHEMA_VERSION)
    throw new Error("Domain-pack resolution v2 schema version is invalid.");
  if (
    item.discriminator !== AGRICULTURAL_DOMAIN_PACK_DISCRIMINATOR ||
    item.synthetic !== false
  )
    throw new Error("Domain-pack resolution v2 discriminator is invalid.");
  string(item.resolver_version, "Domain-pack resolution v2 resolver version");
  if (
    typeof item.confidence !== "number" ||
    item.confidence < 0 ||
    item.confidence > 1
  )
    throw new Error("Domain-pack resolution v2 confidence is invalid.");
  if (!["confirmed", "confirmation_required", "unresolved"].includes(state))
    throw new Error("Domain-pack resolution v2 activation state is invalid.");
  if (state !== "unresolved") {
    string(item.category_id, "Domain-pack resolution v2 category id");
    string(item.pack_version, "Domain-pack resolution v2 pack version");
    if (!/^[a-f0-9]{64}$/u.test(String(item.content_sha256)))
      throw new Error("Domain-pack resolution v2 content digest is invalid.");
  }
  if (state === "confirmed")
    string(item.activation_token, "Domain-pack resolution v2 token");
  return Object.freeze(normalized as DomainPackResolutionV2);
}
