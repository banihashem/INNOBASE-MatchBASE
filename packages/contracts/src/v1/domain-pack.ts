export const DOMAIN_PACK_SCHEMA_VERSION = "domain-pack.v1" as const;
export const DOMAIN_PACK_RESOLUTION_SCHEMA_VERSION =
  "domain-pack-resolution.v1" as const;

export const STANDARD_MACRO_PARAMETER_IDS = [
  "product_specification",
  "supplier_producer_profile",
  "trade_structure_commercial_execution",
] as const;

export type StandardMacroParameterId =
  (typeof STANDARD_MACRO_PARAMETER_IDS)[number];

export type DomainFieldKind =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "quantity";

export interface DomainPackFieldV1 {
  field_id: string;
  macro_parameter: StandardMacroParameterId;
  label: string;
  description: string;
  kind: DomainFieldKind;
  requirement: "required" | "conditional" | "optional";
  allowed_units: string[];
  allowed_values: string[];
}

export interface DomainPackV1 {
  schema_version: typeof DOMAIN_PACK_SCHEMA_VERSION;
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
  synthetic: true;
}

interface DomainPackResolutionBaseV1 {
  schema_version: typeof DOMAIN_PACK_RESOLUTION_SCHEMA_VERSION;
  resolver_version: string;
  confidence: number;
  synthetic: true;
}

export type DomainPackResolutionV1 = DomainPackResolutionBaseV1 &
  (
    | {
        activation_state: "confirmed";
        category_id: string;
        pack_version: string;
        activation_token: string;
      }
    | {
        activation_state: "confirmation_required";
        category_id: string;
        pack_version: string;
      }
    | {
        activation_state: "unresolved";
      }
  );
