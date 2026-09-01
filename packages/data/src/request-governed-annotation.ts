import { randomUUID } from "node:crypto";
import type { TransactionClient } from "./database.js";

export const LEGACY_MISCLASSIFIED_DOMAIN_PACK_ANNOTATION =
  "legacy_misclassified_domain_pack" as const;

export interface LegacyMisclassifiedDomainPackAnnotation {
  readonly schema_version: "legacy-misclassified-domain-pack.v1";
  readonly observed_category: string;
  readonly corrected_category: string;
  readonly reason_code: "historical_domain_pack_resolver_misclassification";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function ensureLegacyMisclassifiedDomainPackAnnotation(
  client: TransactionClient,
  input: {
    readonly accountId: string;
    readonly requestId: string;
    readonly observedCategory: string;
    readonly correctedCategory: string;
  },
): Promise<void> {
  if (
    !input.observedCategory.trim() ||
    !input.correctedCategory.trim() ||
    input.observedCategory === input.correctedCategory
  )
    throw new Error("Legacy domain-pack annotation categories are invalid.");
  const annotation: LegacyMisclassifiedDomainPackAnnotation = {
    schema_version: "legacy-misclassified-domain-pack.v1",
    observed_category: input.observedCategory,
    corrected_category: input.correctedCategory,
    reason_code: "historical_domain_pack_resolver_misclassification",
  };
  await client.query(
    `INSERT INTO request_governed_annotation
       (annotation_id,account_id,request_id,annotation_type,annotation_version,annotation,created_by)
     VALUES($1,$2,$3,'legacy_misclassified_domain_pack',1,$4::jsonb,'server')
     ON CONFLICT(account_id,request_id,annotation_type,annotation_version) DO NOTHING`,
    [
      randomUUID(),
      input.accountId,
      input.requestId,
      JSON.stringify(annotation),
    ],
  );
  const stored = await client.query<{ annotation: unknown }>(
    `SELECT annotation FROM request_governed_annotation
      WHERE account_id=$1 AND request_id=$2
        AND annotation_type='legacy_misclassified_domain_pack'
        AND annotation_version=1`,
    [input.accountId, input.requestId],
  );
  if (stableJson(stored.rows[0]?.annotation) !== stableJson(annotation))
    throw new Error("Legacy domain-pack annotation drifted.");
}

export async function readLegacyMisclassifiedDomainPackAnnotation(
  client: TransactionClient,
  input: { readonly accountId: string; readonly requestId: string },
): Promise<LegacyMisclassifiedDomainPackAnnotation | null> {
  const result = await client.query<{ annotation: unknown }>(
    `SELECT annotation FROM request_governed_annotation
      WHERE account_id=$1 AND request_id=$2
        AND annotation_type='legacy_misclassified_domain_pack'
        AND annotation_version=1`,
    [input.accountId, input.requestId],
  );
  const value = result.rows[0]?.annotation;
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Legacy domain-pack annotation is invalid.");
  const item = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(item).sort()) !==
      JSON.stringify(
        [
          "schema_version",
          "observed_category",
          "corrected_category",
          "reason_code",
        ].sort(),
      ) ||
    item.schema_version !== "legacy-misclassified-domain-pack.v1" ||
    item.reason_code !== "historical_domain_pack_resolver_misclassification" ||
    typeof item.observed_category !== "string" ||
    typeof item.corrected_category !== "string" ||
    !item.observed_category.trim() ||
    !item.corrected_category.trim() ||
    item.observed_category === item.corrected_category
  )
    throw new Error("Legacy domain-pack annotation is invalid.");
  return Object.freeze(value as LegacyMisclassifiedDomainPackAnnotation);
}
