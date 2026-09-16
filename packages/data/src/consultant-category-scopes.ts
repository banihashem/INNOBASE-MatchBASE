import { hashResearchAuthority } from "./consultant-execution-integrity.js";
import { inTransaction, type ConnectionPool } from "./database.js";

export interface EvidenceClassification {
  scheme: string;
  code: string;
  version: string;
  jurisdiction?: string;
  label?: string;
  description?: string;
}

function scopeKey(kind: string, value: Record<string, string>): string {
  return hashResearchAuthority({ evidence_scope: kind, ...value });
}

function digits(value: string): string {
  return value.replace(/\D/gu, "");
}

/**
 * Additive retrieval scopes. The exact authority hash remains the first key.
 * Parent and industry scopes are discovery aids; they never alter the stored
 * classification or promote an observation's evidence status.
 */
export function privateEvidenceCategoryScopeKeys(
  classification: EvidenceClassification,
): readonly string[] {
  const scheme = classification.scheme.trim().toUpperCase();
  const code = classification.code.trim().toUpperCase();
  const version = classification.version.trim();
  const jurisdiction = classification.jurisdiction?.trim().toUpperCase() ?? "";
  const values = new Set<string>([
    hashResearchAuthority({
      scheme: classification.scheme,
      code: classification.code,
      version: classification.version,
      jurisdiction: classification.jurisdiction,
    }),
  ]);
  const addTaxonomy = (parent: string) =>
    values.add(scopeKey("taxonomy", { scheme, parent, version, jurisdiction }));
  const numeric = digits(code);

  if (scheme === "HS")
    [2, 4, 6]
      .filter((n) => numeric.length >= n)
      .forEach((n) => addTaxonomy(numeric.slice(0, n)));
  if (scheme === "UNSPSC")
    [2, 4, 6, 8]
      .filter((n) => numeric.length >= n)
      .forEach((n) => addTaxonomy(numeric.slice(0, n)));
  if (scheme === "CPC")
    [1, 2, 3, 4, 5]
      .filter((n) => numeric.length >= n)
      .forEach((n) => addTaxonomy(numeric.slice(0, n)));
  if (scheme === "ISIC")
    [2, 3, 4]
      .filter((n) => numeric.length >= n)
      .forEach((n) => addTaxonomy(numeric.slice(0, n)));

  const words =
    `${code} ${classification.label ?? ""} ${classification.description ?? ""}`.toLowerCase();
  const logistics =
    (scheme === "UNSPSC" && numeric.startsWith("78")) ||
    (scheme === "CPC" && /^(652|653|679)/u.test(numeric)) ||
    (scheme === "ISIC" && /^(49|50|51|52)/u.test(numeric)) ||
    /freight|logistic|transport|shipping|cargo|forwarder|ocean|air[._ -]?freight/u.test(
      words,
    );
  if (logistics) {
    values.add(
      scopeKey("industry", {
        scheme: "MATCHBASE_INDUSTRY",
        parent: "SERVICES.LOGISTICS",
        version: "1",
      }),
    );
    values.add(
      scopeKey("industry", { scheme: "ISIC", parent: "H", version: "REV.4" }),
    );
  }
  if (
    logistics &&
    (/ocean|sea|maritime|container|shipping/u.test(words) ||
      (scheme === "CPC" && numeric.startsWith("652")) ||
      (scheme === "ISIC" && numeric.startsWith("5012")))
  )
    values.add(
      scopeKey("industry", {
        scheme: "MATCHBASE_INDUSTRY",
        parent: "SERVICES.LOGISTICS.OCEAN_FREIGHT",
        version: "1",
      }),
    );
  if (
    logistics &&
    (/air/u.test(words) ||
      (scheme === "CPC" && numeric.startsWith("653")) ||
      (scheme === "ISIC" && numeric.startsWith("5120")))
  )
    values.add(
      scopeKey("industry", {
        scheme: "MATCHBASE_INDUSTRY",
        parent: "SERVICES.LOGISTICS.AIR_FREIGHT",
        version: "1",
      }),
    );
  if (
    logistics &&
    (/forward|broker|agency|customs|consolidat/u.test(words) ||
      (scheme === "CPC" && numeric.startsWith("6791")) ||
      (scheme === "ISIC" && numeric.startsWith("5229")))
  )
    values.add(
      scopeKey("industry", {
        scheme: "MATCHBASE_INDUSTRY",
        parent: "SERVICES.LOGISTICS.FREIGHT_FORWARDING",
        version: "1",
      }),
    );

  return [...values];
}

/** Additive, idempotent upgrade for retained observations; no evidence content changes. */
export async function backfillPrivateEvidenceCategoryScopes(
  pool: ConnectionPool,
): Promise<number> {
  return inTransaction(pool, async (db) => {
    const present = await db.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='consultant_private_observation' AND column_name='category_scope_keys') AS present",
    );
    if (!present.rows[0]?.present) return 0;
    const rows = await db.query<{
      observation_id: string;
      category_key: string;
      category_scope_keys: string[];
      classification: EvidenceClassification | null;
    }>(
      `SELECT o.observation_id,o.category_key,o.category_scope_keys,
        (SELECT ws.classification FROM consultant_workflow_session ws
          WHERE ws.account_id=o.account_id AND ws.user_profile_id=o.user_profile_id
            AND ws.classification->>'classification_id'=o.classification_id::text
          ORDER BY ws.updated_at DESC LIMIT 1) AS classification
       FROM consultant_private_observation o ORDER BY o.observation_id FOR UPDATE`,
    );
    let changed = 0;
    for (const row of rows.rows) {
      const classification = row.classification;
      if (
        !classification?.scheme ||
        !classification.code ||
        !classification.version
      )
        continue;
      const scopes = [
        ...new Set([
          ...row.category_scope_keys,
          ...privateEvidenceCategoryScopeKeys(classification),
        ]),
      ];
      if (scopes.length === row.category_scope_keys.length) continue;
      await db.query(
        "UPDATE consultant_private_observation SET category_scope_keys=$2 WHERE observation_id=$1",
        [row.observation_id, scopes],
      );
      changed += 1;
    }
    return changed;
  });
}
