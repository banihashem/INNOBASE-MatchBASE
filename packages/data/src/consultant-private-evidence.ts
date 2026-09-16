import { randomUUID } from "node:crypto";
import type {
  ConsultantResearchOutputV3,
  EvidenceSourceV3,
  SupplierEntityV3,
} from "@matchbase/contracts";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "./database.js";
import {
  ExecutionIntegrityFault,
  hashResearchAuthority,
} from "./consultant-execution-integrity.js";
import type { ConsultantWorkflowIdentity } from "./consultant-workflow-jobs.js";
import type { PrivateResearchScope } from "./consultant-research-renewal.js";
import { privateEvidenceCategoryScopeKeys } from "./consultant-category-scopes.js";

export type PrivateEvidencePurpose =
  "discovery" | "identity" | "pricing" | "compliance";
export interface PrivateEvidenceReference {
  observation_id: string;
  observation_version: string;
  rights_epoch: number;
  source_version_id: string;
  entity_version_id: string | null;
}
export interface PrivateEvidenceObservation extends PrivateEvidenceReference {
  source_id: string;
  claim_kind: string;
  claim_text: string;
  payload: Record<string, unknown>;
  price_date: string | null;
  source: {
    source_url: string;
    source_type: string;
    publisher: string;
    published_at: string | null;
    retrieved_at: string;
    excerpt_summary: string;
  };
  entity: {
    entity_id: string;
    resolution: string;
    jurisdiction: string | null;
    registry_scheme: string | null;
    registry_number: string | null;
  } | null;
  eligible_until: string;
  recency: "under_7_days" | "under_30_days" | "current";
  category_match?: "exact" | "related";
  classification?: Record<string, unknown> | null;
}
function refuse(message: string): never {
  throw new ExecutionIntegrityFault("MB-409-PRIVATE-EVIDENCE", message);
}
const validPurposes = new Set([
  "discovery",
  "identity",
  "pricing",
  "compliance",
]);
export function privateEvidenceCategoryKey(classification: {
  scheme: string;
  code: string;
  version: string;
  jurisdiction?: string;
}): string {
  return privateEvidenceCategoryScopeKeys(classification)[0]!;
}
function date(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  return new Date(value).toISOString();
}
function url(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return null;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}
function known(value: string | null | undefined): value is string {
  return (
    !!value?.trim() &&
    !/^(unknown|unverified|not verified|not specified|n\/a)$/iu.test(
      value.trim(),
    )
  );
}
function boundedLiteral(text: string, value: string): boolean {
  const escaped = value
    .trim()
    .normalize("NFKC")
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text.normalize("NFKC"));
}

/** Country and registry identifier require a supporting competent registry source, never a name guess. */
export function privateEntityResolution(
  identity: ConsultantWorkflowIdentity,
  supplier: SupplierEntityV3,
  sources: readonly EvidenceSourceV3[],
) {
  const jurisdiction = supplier.country_of_registration;
  for (const [scheme, number] of Object.entries(
    supplier.registry_identifiers ?? {},
  ).sort()) {
    const proof = sources.find(
      (s) =>
        supplier.identity_evidence_ids.includes(s.evidence_id) &&
        ["official_registry", "government_trade_portal"].includes(
          s.source_type,
        ) &&
        s.verification_status === "externally_verified" &&
        boundedLiteral(s.excerpt_summary, number) &&
        known(jurisdiction) &&
        boundedLiteral(s.excerpt_summary, jurisdiction),
    );
    if (known(jurisdiction) && known(number) && known(scheme) && proof)
      return {
        key: hashResearchAuthority({
          jurisdiction: jurisdiction.normalize("NFKC").toLowerCase(),
          scheme: scheme.toLowerCase(),
          number: number.normalize("NFKC").toLowerCase(),
        }),
        resolution: "registry_scoped",
        jurisdiction,
        registry_scheme: scheme,
        registry_number: number,
        evidence_id: proof.evidence_id,
      };
  }
  return {
    key: hashResearchAuthority({
      run: identity.run_id,
      execution: identity.execution_id,
      supplier: supplier.supplier_entity_id,
    }),
    resolution: "unresolved",
    jurisdiction: known(jurisdiction) ? jurisdiction : null,
    registry_scheme: null,
    registry_number: null,
    evidence_id: supplier.identity_evidence_ids[0] ?? null,
  };
}

/** Same final publication transaction; never backfill historical outputs implicitly. */
export async function capturePrivateResearchEvidence(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  output: ConsultantResearchOutputV3,
): Promise<{ observations: number; sources: number }> {
  if (output.research_mode === "fixture")
    return { observations: 0, sources: 0 };
  if (
    output.user_profile_id !== identity.user_profile_id ||
    output.research_run_id !== identity.run_id ||
    output.execution_id !== identity.execution_id ||
    output.classification_id !== identity.classification_id
  )
    refuse("Private evidence ownership does not match the completed output.");
  const completed = await client.query(
    `SELECT output FROM consultant_research_round WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3
    AND execution_id=$4 AND classification_id=$5 AND status='completed' FOR SHARE`,
    Object.values({
      account: identity.account_id,
      profile: identity.user_profile_id,
      run: identity.run_id,
      execution: identity.execution_id,
      classification: identity.classification_id,
    }),
  );
  if (
    !completed.rows[0]?.output ||
    hashResearchAuthority(completed.rows[0].output) !==
      hashResearchAuthority(output)
  )
    refuse(
      "Only the newly committed full round output may enter private memory.",
    );
  const allSources: EvidenceSourceV3[] = output.evidence_sources.filter(
    (s) => s.source_type !== "synthetic_fixture",
  );
  for (const price of output.price_research?.observations ?? [])
    allSources.push({
      evidence_id: `price:${price.observation_id}`,
      source_id: `price:${price.observation_id}`,
      source_url: price.source_url,
      source_title: price.source_title,
      publisher: "Price source",
      source_type: "secondary_market",
      retrieved_at: output.price_research!.searched_at,
      published_at: price.source_published_at,
      verification_status: "supplier_claimed",
      freshness_status: "current",
      excerpt_summary: `${price.quote}\n${price.date_quote}`,
      supports_claim_ids: [],
      contradicts_claim_ids: [],
    });
  const versions = new Map<string, { source_id: string; version: string }>();
  for (const source of allSources.sort((a, b) =>
    a.source_url.localeCompare(b.source_url),
  )) {
    const normalizedUrl = url(source.source_url);
    const retrieved = date(source.retrieved_at);
    if (
      !normalizedUrl ||
      !retrieved ||
      Date.parse(retrieved) > Date.now() + 60000
    )
      continue;
    const key = hashResearchAuthority(normalizedUrl);
    await client.query(
      `INSERT INTO consultant_private_source(source_id,account_id,user_profile_id,source_url,source_key)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,user_profile_id,source_key) DO NOTHING`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        normalizedUrl,
        key,
      ],
    );
    const rows = await client.query(
      "SELECT source_id,rights_state,rights_epoch FROM consultant_private_source WHERE account_id=$1 AND user_profile_id=$2 AND source_key=$3 FOR SHARE",
      [identity.account_id, identity.user_profile_id, key],
    );
    const owner = rows.rows[0];
    if (!owner || owner.rights_state !== "active")
      refuse(
        "This completed output contains a source withdrawn from private research use.",
      );
    const content = hashResearchAuthority(source);
    await client.query(
      `INSERT INTO consultant_private_source_version(source_version_id,source_id,content_sha256,retrieved_at,published_at,source_type,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_id,content_sha256,retrieved_at) DO NOTHING`,
      [
        randomUUID(),
        owner.source_id,
        content,
        retrieved,
        date(source.published_at),
        source.source_type,
        JSON.stringify(source),
      ],
    );
    const version = await client.query(
      "SELECT source_version_id FROM consultant_private_source_version WHERE source_id=$1 AND content_sha256=$2 AND retrieved_at=$3",
      [owner.source_id, content, retrieved],
    );
    versions.set(source.evidence_id, {
      source_id: owner.source_id,
      version: version.rows[0]!.source_version_id,
    });
    await client.query(
      `INSERT INTO consultant_private_output_provenance(provenance_id,account_id,user_profile_id,run_id,execution_id,classification_id,source_id,source_version_id,rights_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(account_id,user_profile_id,execution_id,source_version_id) DO NOTHING`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
        owner.source_id,
        version.rows[0]!.source_version_id,
        owner.rights_epoch,
      ],
    );
  }
  const entities = new Map<
    string,
    { entity_id: string; entity_version_id: string }
  >();
  const resolved = output.supplier_candidates
    .map((s) => ({
      supplier: s,
      resolved: privateEntityResolution(identity, s, allSources),
    }))
    .sort((a, b) => a.resolved.key.localeCompare(b.resolved.key));
  for (const { supplier, resolved: entity } of resolved) {
    await client.query(
      `INSERT INTO consultant_private_entity(entity_id,account_id,user_profile_id,entity_key,resolution,jurisdiction,registry_scheme,registry_number)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,user_profile_id,entity_key) DO NOTHING`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        entity.key,
        entity.resolution,
        entity.jurisdiction,
        entity.registry_scheme,
        entity.registry_number,
      ],
    );
    const id = (
      await client.query(
        "SELECT entity_id FROM consultant_private_entity WHERE account_id=$1 AND user_profile_id=$2 AND entity_key=$3",
        [identity.account_id, identity.user_profile_id, entity.key],
      )
    ).rows[0]!.entity_id;
    const payload = {
      legal_name: supplier.legal_name,
      trading_name: supplier.trading_name,
      aliases: supplier.aliases,
      website: supplier.website,
      resolution: entity.resolution,
      origin: identity,
      source_version_id: entity.evidence_id
        ? (versions.get(entity.evidence_id)?.version ?? null)
        : null,
    };
    const hash = hashResearchAuthority(payload);
    await client.query(
      `INSERT INTO consultant_private_entity_version(entity_version_id,entity_id,source_version_id,payload_sha256,payload)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(entity_id,payload_sha256) DO NOTHING`,
      [
        randomUUID(),
        id,
        payload.source_version_id,
        hash,
        JSON.stringify(payload),
      ],
    );
    const version = await client.query(
      "SELECT entity_version_id FROM consultant_private_entity_version WHERE entity_id=$1 AND payload_sha256=$2",
      [id, hash],
    );
    entities.set(supplier.supplier_entity_id, {
      entity_id: id,
      entity_version_id: version.rows[0]!.entity_version_id,
    });
  }
  let count = 0;
  const categoryKey = privateEvidenceCategoryKey(output.primary_classification);
  const categoryScopeKeys = privateEvidenceCategoryScopeKeys(
    output.primary_classification,
  );
  const save = async (
    origin: string,
    kind: string,
    text: string,
    payload: Record<string, unknown>,
    evidenceId: string,
    supplierId?: string,
    priceDate?: string | null,
    validUntil?: string | null,
  ) => {
    const source = versions.get(evidenceId);
    if (!source) return;
    const entity = supplierId ? entities.get(supplierId) : undefined;
    const result = await client.query(
      `INSERT INTO consultant_private_observation(observation_id,account_id,user_profile_id,run_id,execution_id,classification_id,category_key,category_scope_keys,
      origin_key,entity_id,entity_version_id,observation_version,source_version_id,claim_kind,claim_text,payload,price_date,valid_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(account_id,user_profile_id,execution_id,origin_key,source_version_id) DO NOTHING RETURNING observation_id`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
        categoryKey,
        categoryScopeKeys,
        origin,
        entity?.entity_id ?? null,
        entity?.entity_version_id ?? null,
        hashResearchAuthority(payload),
        source.version,
        kind,
        text,
        JSON.stringify(payload),
        priceDate ?? null,
        validUntil ?? null,
      ],
    );
    count += result.rows.length;
  };
  for (const claim of output.claims) {
    const supplier = output.supplier_candidates.find(
      (s) => s.supplier_entity_id === claim.supplier_entity_id,
    );
    if (
      claim.claim_type === "pricing" &&
      (!known(supplier?.commercial.currency) ||
        !known(supplier?.commercial.unit) ||
        (!Number.isFinite(supplier?.commercial.price_min) &&
          !Number.isFinite(supplier?.commercial.price_max)))
    )
      continue;
    for (const evidence of claim.evidence_ids)
      await save(
        claim.claim_id,
        claim.claim_type,
        claim.claim_text,
        claim as unknown as Record<string, unknown>,
        evidence,
        claim.supplier_entity_id,
        claim.claim_type === "pricing"
          ? date(supplier?.commercial.price_date)
          : null,
        claim.claim_type === "pricing"
          ? date(supplier?.commercial.price_validity)
          : null,
      );
  }
  for (const price of output.price_research?.observations ?? []) {
    if (
      !price.unit ||
      !price.currency ||
      !Number.isFinite(price.price_min) ||
      !Number.isFinite(price.price_max)
    )
      continue;
    await save(
      `price:${price.observation_id}`,
      "pricing",
      `${price.product_or_service}: ${price.quote}`,
      price as unknown as Record<string, unknown>,
      `price:${price.observation_id}`,
      undefined,
      date(price.source_published_at),
      date(price.valid_until),
    );
  }
  if (count)
    await client.query(
      "UPDATE consultant_private_negative_check SET expires_at=LEAST(expires_at,clock_timestamp()) WHERE account_id=$1 AND user_profile_id=$2",
      [identity.account_id, identity.user_profile_id],
    );
  return { observations: count, sources: versions.size };
}

const eligibility = `LEAST(COALESCE(o.valid_until,'infinity'::timestamptz),
  CASE WHEN o.claim_kind='pricing' THEN o.price_date+interval '30 days'
    WHEN o.claim_kind='compliance' THEN v.retrieved_at+interval '7 days' ELSE v.retrieved_at+interval '30 days' END)`;
const eligibleFilter = `s.rights_state='active' AND o.event_invalidated_at IS NULL AND v.retrieved_at<=clock_timestamp()
  AND (o.claim_kind<>'pricing' OR (o.price_date IS NOT NULL AND o.price_date<=clock_timestamp())) AND ${eligibility}>clock_timestamp()`;
const projection = `o.*,s.source_id,s.source_url,s.rights_epoch,v.source_type,v.retrieved_at,v.published_at,v.payload AS source_payload,
  e.resolution,e.jurisdiction,e.registry_scheme,e.registry_number,${eligibility} AS eligible_until,
  CASE WHEN o.claim_kind='pricing' AND o.price_date>clock_timestamp()-interval '7 days' THEN 'under_7_days'
    WHEN o.claim_kind='pricing' THEN 'under_30_days' ELSE 'current' END AS recency`;
const joins = `FROM consultant_private_observation o JOIN consultant_private_source_version v ON v.source_version_id=o.source_version_id
  JOIN consultant_private_source s ON s.source_id=v.source_id LEFT JOIN consultant_private_entity e ON e.entity_id=o.entity_id`;
function observation(row: Record<string, any>): PrivateEvidenceObservation {
  return {
    observation_id: row.observation_id,
    observation_version: row.observation_version,
    rights_epoch: row.rights_epoch,
    source_version_id: row.source_version_id,
    entity_version_id: row.entity_version_id,
    source_id: row.source_id,
    claim_kind: row.claim_kind,
    claim_text: row.claim_text,
    payload: row.payload,
    price_date: row.price_date?.toISOString() ?? null,
    source: {
      source_url: row.source_url,
      source_type: row.source_type,
      publisher: row.source_payload.publisher ?? "",
      published_at: row.published_at?.toISOString() ?? null,
      retrieved_at: row.retrieved_at.toISOString(),
      excerpt_summary: row.source_payload.excerpt_summary ?? "",
    },
    entity: row.entity_id
      ? {
          entity_id: row.entity_id,
          resolution: row.resolution,
          jurisdiction: row.jurisdiction,
          registry_scheme: row.registry_scheme,
          registry_number: row.registry_number,
        }
      : null,
    eligible_until: row.eligible_until.toISOString(),
    recency: row.recency,
    ...(row.category_match === "exact" || row.category_match === "related"
      ? { category_match: row.category_match }
      : {}),
    classification: row.classification ?? null,
  };
}

export async function retrievePrivateEvidence(
  db: Queryable,
  request: PrivateResearchScope & {
    classification: {
      scheme: string;
      code: string;
      version: string;
      jurisdiction?: string;
    };
    query: string;
    purpose: PrivateEvidencePurpose;
    limit?: number;
  },
) {
  if (!validPurposes.has(request.purpose))
    refuse("Private evidence purpose is invalid.");
  const limit = Math.max(1, Math.min(50, Math.floor(request.limit ?? 20)));
  const query = request.query.trim().slice(0, 4000);
  const params = [
    request.account_id,
    request.user_profile_id,
    privateEvidenceCategoryScopeKeys(request.classification),
    privateEvidenceCategoryKey(request.classification),
    query,
    request.purpose,
    limit,
  ];
  const scope = `o.account_id=$1 AND o.user_profile_id=$2 AND s.account_id=$1 AND s.user_profile_id=$2 AND $4::text IS NOT NULL AND o.category_scope_keys && $3::text[]
    AND ($6='discovery' OR o.claim_kind=$6) AND ($5='' OR to_tsvector('simple',o.claim_text) @@ plainto_tsquery('simple',$5)
      OR lower(e.registry_number)=lower($5))`;
  const rows = await db.query(
    `SELECT ${projection},CASE WHEN o.category_key=$4 THEN 'exact' ELSE 'related' END AS category_match ${joins} WHERE ${scope} AND ${eligibleFilter}
    ORDER BY CASE WHEN o.category_key=$4 THEN 0 ELSE 1 END,CASE WHEN lower(e.registry_number)=lower($5) THEN 0 ELSE 1 END,
      CASE WHEN o.claim_kind='pricing' AND o.price_date>clock_timestamp()-interval '7 days' THEN 0 ELSE 1 END,
      ts_rank_cd(to_tsvector('simple',o.claim_text),plainto_tsquery('simple',$5)) DESC,o.created_at DESC,o.observation_id LIMIT $7`,
    params,
  );
  const stale = await db.query<{ count: number }>(
    `SELECT count(*)::integer AS count ${joins} WHERE ${scope} AND NOT (${eligibleFilter})`,
    params.slice(0, 6),
  );
  return {
    observations: rows.rows.map(observation),
    needs_refresh_count: stale.rows[0]?.count ?? 0,
    fresh_discovery_required: true as const,
  };
}

/** Read-only profile library search. It never dispatches research or records evidence use. */
export async function searchPrivateEvidenceProfile(
  db: Queryable,
  scope: PrivateResearchScope,
  request: {
    query?: string;
    classification?: {
      scheme: string;
      code: string;
      version: string;
      jurisdiction?: string;
      label?: string;
      description?: string;
    };
    status?: "current" | "expired" | "all";
    limit?: number;
  } = {},
) {
  const query = (request.query ?? "").trim().slice(0, 4000);
  const status = request.status ?? "current";
  if (!["current", "expired", "all"].includes(status))
    refuse("Private evidence status filter is invalid.");
  const limit = Math.max(1, Math.min(100, Math.floor(request.limit ?? 30)));
  const scopes = request.classification
    ? privateEvidenceCategoryScopeKeys(request.classification)
    : null;
  const exact = request.classification
    ? privateEvidenceCategoryKey(request.classification)
    : null;
  const base = `o.account_id=$1 AND o.user_profile_id=$2 AND s.account_id=$1 AND s.user_profile_id=$2
    AND ($3::text[] IS NULL OR o.category_scope_keys && $3::text[])
    AND ($5='' OR to_tsvector('simple',o.claim_text) @@ plainto_tsquery('simple',$5)
      OR lower(COALESCE(e.registry_number,''))=lower($5)
      OR lower(v.payload->>'publisher') LIKE '%'||lower($5)||'%')`;
  const statusSql =
    status === "current"
      ? `AND ${eligibleFilter}`
      : status === "expired"
        ? `AND NOT (${eligibleFilter})`
        : "";
  const params = [
    scope.account_id,
    scope.user_profile_id,
    scopes,
    exact,
    query,
    limit,
  ];
  const rows = await db.query(
    `SELECT ${projection},CASE WHEN $4::text IS NULL THEN NULL WHEN o.category_key=$4::text THEN 'exact' ELSE 'related' END AS category_match,
      (SELECT ws.classification FROM consultant_workflow_session ws WHERE ws.account_id=o.account_id
        AND ws.user_profile_id=o.user_profile_id AND ws.classification->>'classification_id'=o.classification_id::text
        ORDER BY ws.updated_at DESC LIMIT 1) AS classification
    ${joins} WHERE ${base} ${statusSql}
    ORDER BY CASE WHEN $4::text IS NOT NULL AND o.category_key=$4::text THEN 0 ELSE 1 END,
      CASE WHEN (${eligibility})>clock_timestamp() THEN 0 ELSE 1 END,o.created_at DESC,o.observation_id LIMIT $6`,
    params,
  );
  const counts = await db.query<{
    current_count: number;
    expired_count: number;
  }>(
    `SELECT count(*) FILTER(WHERE ${eligibleFilter})::integer AS current_count,
      count(*) FILTER(WHERE NOT (${eligibleFilter}))::integer AS expired_count
    ${joins} WHERE ${base.replaceAll("$5", "$4")}`,
    [scope.account_id, scope.user_profile_id, scopes, query],
  );
  return {
    observations: rows.rows.map(observation),
    current_count: counts.rows[0]?.current_count ?? 0,
    expired_count: counts.rows[0]?.expired_count ?? 0,
    fresh_discovery_required: true as const,
  };
}

/** Locks every source in deterministic order until the dispatch/publication transaction commits. */
export async function validatePrivateEvidenceSelection(
  client: Queryable,
  scope: PrivateResearchScope & { classification_id?: string },
  refs: readonly PrivateEvidenceReference[],
  purpose: PrivateEvidencePurpose,
): Promise<PrivateEvidenceObservation[]> {
  if (
    !validPurposes.has(purpose) ||
    refs.length > 50 ||
    new Set(refs.map((r) => r.observation_id)).size !== refs.length
  )
    refuse("Private evidence selection is invalid.");
  if (!refs.length) return [];
  if (!scope.classification_id)
    refuse(
      "The private evidence selection requires a current classification assignment.",
    );
  const assignment = await client.query(
    `SELECT classification FROM consultant_workflow_session WHERE account_id=$1 AND user_profile_id=$2
    AND NOT is_invalidated AND classification->>'classification_id'=$3`,
    [scope.account_id, scope.user_profile_id, scope.classification_id],
  );
  const classification = assignment.rows[0]?.classification;
  if (
    !classification?.scheme ||
    !classification.code ||
    !classification.version
  )
    refuse("The current classification assignment could not be verified.");
  const categoryScopes = privateEvidenceCategoryScopeKeys(classification);
  const ids = refs.map((r) => r.observation_id);
  await client.query(
    `SELECT s.source_id ${joins} WHERE o.account_id=$1 AND o.user_profile_id=$2 AND s.account_id=$1 AND s.user_profile_id=$2
    AND o.observation_id=ANY($3::uuid[]) ORDER BY s.source_id FOR SHARE OF s`,
    [scope.account_id, scope.user_profile_id, ids],
  );
  const rows = await client.query(
    `SELECT ${projection} ${joins} WHERE o.account_id=$1 AND o.user_profile_id=$2 AND s.account_id=$1 AND s.user_profile_id=$2
    AND o.observation_id=ANY($3::uuid[]) AND ($4='discovery' OR o.claim_kind=$4) AND ${eligibleFilter}`,
    [scope.account_id, scope.user_profile_id, ids, purpose],
  );
  const found = rows.rows.map(observation);
  if (
    rows.rows.some(
      (row) =>
        !Array.isArray(row.category_scope_keys) ||
        !row.category_scope_keys.some((key: string) =>
          categoryScopes.includes(key),
        ),
    )
  )
    refuse(
      "The saved observations belong to another product or service classification.",
    );
  for (const ref of refs) {
    const row = found.find((r) => r.observation_id === ref.observation_id);
    if (
      !row ||
      row.observation_version !== ref.observation_version ||
      row.source_version_id !== ref.source_version_id ||
      row.entity_version_id !== ref.entity_version_id ||
      row.rights_epoch !== ref.rights_epoch
    )
      refuse(
        "Saved evidence changed, expired or lost its use rights. Refresh the estimate.",
      );
  }
  return refs.map((ref) =>
    found.find((row) => row.observation_id === ref.observation_id)!,
  );
}

export async function createEvidenceUseManifest(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  refs: readonly PrivateEvidenceReference[],
  purpose: PrivateEvidencePurpose,
) {
  const owned = await client.query(
    `SELECT run_id FROM consultant_workflow_session WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3
    AND execution_id=$4 AND COALESCE(classification->>'classification_id',workflow_metadata->>'classification_id')=$5::text AND NOT is_invalidated`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
    ],
  );
  if (!owned.rows[0])
    refuse(
      "The evidence use does not belong to the active research profile and execution.",
    );
  const selected = await validatePrivateEvidenceSelection(
    client,
    identity,
    refs,
    purpose,
  );
  const expires = selected.length
    ? Math.min(...selected.map((row) => Date.parse(row.eligible_until)))
    : Date.now() + 86400000;
  const id = randomUUID();
  const expiresAt = new Date(expires).toISOString();
  await client.query(
    `INSERT INTO consultant_private_evidence_use(manifest_id,account_id,user_profile_id,run_id,execution_id,classification_id,purpose,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      purpose,
      expiresAt,
    ],
  );
  for (const row of selected)
    await client.query(
      `INSERT INTO consultant_private_evidence_use_item(item_id,manifest_id,observation_id,source_id,source_version_id,rights_epoch)
    VALUES($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        id,
        row.observation_id,
        row.source_id,
        row.source_version_id,
        row.rights_epoch,
      ],
    );
  return { manifest_id: id, expires_at: expiresAt };
}

export async function assertEvidenceUseManifest(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  manifestId: string,
): Promise<void> {
  const manifest = await client.query(
    `SELECT * FROM consultant_private_evidence_use WHERE manifest_id=$1 AND account_id=$2 AND user_profile_id=$3
    AND run_id=$4 AND execution_id=$5 AND classification_id=$6 AND invalidated_at IS NULL AND expires_at>clock_timestamp()`,
    [
      manifestId,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
    ],
  );
  if (!manifest.rows[0])
    refuse("The private evidence use manifest is unavailable or expired.");
  const items = await client.query(
    `SELECT i.*,o.observation_version,o.entity_version_id FROM consultant_private_evidence_use_item i
    LEFT JOIN consultant_private_observation o ON o.observation_id=i.observation_id WHERE i.manifest_id=$1`,
    [manifestId],
  );
  if (items.rows.some((row) => !row.observation_id || !row.observation_version))
    refuse("A source required by the evidence use manifest was removed.");
  await validatePrivateEvidenceSelection(
    client,
    identity,
    items.rows.map((row) => ({
      observation_id: row.observation_id,
      observation_version: row.observation_version,
      source_version_id: row.source_version_id,
      entity_version_id: row.entity_version_id,
      rights_epoch: row.rights_epoch,
    })),
    manifest.rows[0].purpose,
  );
}

export async function registerEvidenceDerivative(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  manifestId: string,
  derivative: { kind: string; reference: string },
) {
  await assertEvidenceUseManifest(client, identity, manifestId);
  await client.query(
    `INSERT INTO consultant_private_evidence_derivative(derivative_id,manifest_id,kind,reference) VALUES($1,$2,$3,$4)
    ON CONFLICT(manifest_id,kind,reference) DO NOTHING`,
    [randomUUID(), manifestId, derivative.kind, derivative.reference],
  );
}

async function invalidateSourceUses(client: Queryable, sourceId: string) {
  await client.query(
    `UPDATE consultant_private_negative_check n SET expires_at=LEAST(n.expires_at,clock_timestamp())
    FROM consultant_private_source s WHERE s.source_id=$1 AND n.account_id=s.account_id AND n.user_profile_id=s.user_profile_id`,
    [sourceId],
  );
  await client.query(
    `UPDATE consultant_private_evidence_use m SET invalidated_at=COALESCE(m.invalidated_at,clock_timestamp())
    WHERE EXISTS(SELECT 1 FROM consultant_private_evidence_use_item i WHERE i.manifest_id=m.manifest_id AND i.source_id=$1)`,
    [sourceId],
  );
  await client.query(
    `UPDATE consultant_private_evidence_derivative d SET invalidated_at=COALESCE(d.invalidated_at,clock_timestamp())
    WHERE EXISTS(SELECT 1 FROM consultant_private_evidence_use m JOIN consultant_private_evidence_use_item i ON i.manifest_id=m.manifest_id
      WHERE m.manifest_id=d.manifest_id AND i.source_id=$1)`,
    [sourceId],
  );
}
export async function withdrawPrivateEvidenceSource(
  pool: ConnectionPool,
  scope: PrivateResearchScope,
  sourceId: string,
  reason: string,
) {
  return inTransaction(pool, async (client) => {
    const rows = await client.query(
      `UPDATE consultant_private_source SET rights_epoch=rights_epoch+1,rights_state='withdrawn'
      WHERE source_id=$1 AND account_id=$2 AND user_profile_id=$3 RETURNING rights_epoch`,
      [sourceId, scope.account_id, scope.user_profile_id],
    );
    if (!rows.rows[0])
      refuse("The private source is not available in this profile.");
    await client.query(
      `INSERT INTO consultant_private_evidence_tombstone(source_id,account_id,user_profile_id,rights_epoch,reason)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id) DO UPDATE SET rights_epoch=EXCLUDED.rights_epoch,reason=EXCLUDED.reason,withdrawn_at=clock_timestamp()`,
      [
        sourceId,
        scope.account_id,
        scope.user_profile_id,
        rows.rows[0].rights_epoch,
        reason.slice(0, 1000),
      ],
    );
    await invalidateSourceUses(client, sourceId);
    return { rights_epoch: rows.rows[0].rights_epoch as number };
  });
}
export async function applyPrivateEvidenceTombstones(
  client: Queryable,
  scope: PrivateResearchScope,
) {
  const rows = await client.query(
    `UPDATE consultant_private_source s SET rights_epoch=GREATEST(s.rights_epoch,t.rights_epoch),rights_state='withdrawn'
    FROM consultant_private_evidence_tombstone t WHERE t.source_id=s.source_id AND t.account_id=$1 AND t.user_profile_id=$2
      AND s.account_id=t.account_id AND s.user_profile_id=t.user_profile_id RETURNING s.source_id`,
    [scope.account_id, scope.user_profile_id],
  );
  for (const row of rows.rows)
    await invalidateSourceUses(client, row.source_id);
  return rows.rows.length;
}
export async function invalidatePrivateEvidenceObservation(
  pool: ConnectionPool,
  scope: PrivateResearchScope,
  observationId: string,
  reason: string,
) {
  return inTransaction(pool, async (client) => {
    const source = await client.query(
      `SELECT s.source_id ${joins} WHERE o.observation_id=$1 AND o.account_id=$2 AND o.user_profile_id=$3 FOR UPDATE OF s`,
      [observationId, scope.account_id, scope.user_profile_id],
    );
    if (!source.rows[0])
      refuse("The observation is not available in this profile.");
    await client.query(
      "UPDATE consultant_private_observation SET event_invalidated_at=clock_timestamp(),event_reason=$2 WHERE observation_id=$1",
      [observationId, reason.slice(0, 1000)],
    );
    await client.query(
      `UPDATE consultant_private_output_provenance p SET event_invalidated_at=clock_timestamp(),event_reason=$2
      FROM consultant_private_observation o WHERE o.observation_id=$1 AND p.account_id=o.account_id AND p.user_profile_id=o.user_profile_id
        AND p.run_id=o.run_id AND p.execution_id=o.execution_id AND p.classification_id=o.classification_id AND p.source_id=$3`,
      [observationId, reason.slice(0, 1000), source.rows[0].source_id],
    );
    await invalidateSourceUses(client, source.rows[0].source_id);
  });
}
export async function listInvalidEvidenceDerivatives(
  db: Queryable,
  scope: PrivateResearchScope,
) {
  return (
    await db.query(
      `SELECT d.kind,d.reference,d.invalidated_at FROM consultant_private_evidence_derivative d JOIN consultant_private_evidence_use m ON m.manifest_id=d.manifest_id
    WHERE m.account_id=$1 AND m.user_profile_id=$2 AND d.invalidated_at IS NOT NULL`,
      [scope.account_id, scope.user_profile_id],
    )
  ).rows;
}

/** Purge source-derived text after immediate withdrawal; keep the withdrawal marker. */
export async function purgeWithdrawnPrivateEvidenceSource(
  pool: ConnectionPool,
  scope: PrivateResearchScope,
  sourceId: string,
) {
  return inTransaction(pool, async (client) => {
    const row = await client.query(
      `SELECT source_id FROM consultant_private_source WHERE source_id=$1 AND account_id=$2 AND user_profile_id=$3
      AND rights_state='withdrawn' FOR UPDATE`,
      [sourceId, scope.account_id, scope.user_profile_id],
    );
    if (!row.rows[0])
      refuse(
        "Withdraw this profile's source before purging its derived content.",
      );
    await invalidateSourceUses(client, sourceId);
    await client.query(
      "DELETE FROM consultant_private_source_version WHERE source_id=$1",
      [sourceId],
    );
    await client.query(
      "UPDATE consultant_private_source SET source_url='withdrawn:' WHERE source_id=$1",
      [sourceId],
    );
    await client.query(
      `DELETE FROM consultant_private_entity e WHERE account_id=$1 AND user_profile_id=$2
      AND NOT EXISTS(SELECT 1 FROM consultant_private_observation o WHERE o.entity_id=e.entity_id)`,
      [scope.account_id, scope.user_profile_id],
    );
  });
}

export interface PrivateNegativeCheckScope {
  query: string;
  entity_key: string | null;
  jurisdiction: string | null;
  language: string;
  aliases_sha256: string;
  source_scope: string;
  renewal_generation: number;
}
export async function savePrivateNegativeCheck(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  scope: PrivateNegativeCheckScope,
  outcome: "no_match" | "unavailable" | "denied" | "paywalled" | "not_executed",
  checkedAt: string,
  expiresAt: string,
) {
  if (
    !date(checkedAt) ||
    !date(expiresAt) ||
    Date.parse(expiresAt) <= Date.parse(checkedAt) ||
    Date.parse(expiresAt) - Date.parse(checkedAt) > 86400000
  )
    refuse("Negative check expiry must be bounded to one day.");
  await client.query(
    `INSERT INTO consultant_private_negative_check(check_id,account_id,user_profile_id,run_id,execution_id,classification_id,scope_sha256,scope,outcome,checked_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      hashResearchAuthority(scope),
      JSON.stringify(scope),
      outcome,
      checkedAt,
      expiresAt,
    ],
  );
}
export async function readPrivateNegativeChecks(
  db: Queryable,
  owner: PrivateResearchScope,
  scope: PrivateNegativeCheckScope,
) {
  const rows = await db.query(
    `SELECT scope,outcome,checked_at,expires_at FROM consultant_private_negative_check WHERE account_id=$1 AND user_profile_id=$2 AND scope_sha256=$3
    AND expires_at>clock_timestamp() ORDER BY checked_at DESC`,
    [owner.account_id, owner.user_profile_id, hashResearchAuthority(scope)],
  );
  return { checks: rows.rows, may_suppress_fresh_discovery: false as const };
}
