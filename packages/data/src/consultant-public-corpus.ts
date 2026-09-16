import { randomUUID } from "node:crypto";
import type { Queryable } from "./database.js";

/** A nomination discloses only a public HTTPS origin. It grants no fetch, budget, or release. */
export function nominatePublicSource(rawUrl: string): {
  origin: string;
  acquisition_authorized: false;
  release_authorized: false;
} | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      rawUrl.match(/^https:\/\/([^/?#]+)/iu)?.[1]?.includes(":") ||
      url.hostname.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
        url.hostname,
      ) ||
      /(?:^|\.)(?:localhost|local|localdomain|internal|test|invalid|example|onion|alt|home|lan|corp|intranet|arpa)$/u.test(
        url.hostname,
      )
    )
      return null;
    return {
      origin: url.origin,
      acquisition_authorized: false,
      release_authorized: false,
    };
  } catch {
    return null;
  }
}

export interface PublicEvidenceReference {
  observation_id: string;
  rights_epoch: number;
}
export interface PublicCatalogueEvidence {
  source_url: string;
  source_assertion_sha256: string;
  published_at: string | null;
  retrieved_at: string;
  valid_until: string;
  claim_kind:
    "public_identity" | "product_capability" | "public_price" | "certification";
  claim_text: string;
  classification_scheme: "HS" | "CPC" | "ISIC";
  classification_code: string;
  classification_version: string;
  rights_basis: "public_domain" | "explicit_redistribution_license";
  rights_reference: string;
}

/** Operator backend only: consumes supplied independent evidence, never invokes a fetch or LLM. */
export async function authorizePublicCatalogueAcquisition(
  db: Queryable,
  input: {
    catalogue_job_id: string;
    source_url: string;
    expires_at: string;
    max_observations: number;
    explicit_manual_unpaid_approval: true;
  },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    "SELECT matchbase_public.authorize_acquisition($1,$2,$3,$4,$5,$6)",
    [
      id,
      input.catalogue_job_id,
      input.source_url,
      input.expires_at,
      input.max_observations,
      input.explicit_manual_unpaid_approval,
    ],
  );
  return id;
}

export async function acquirePublicCatalogueEvidence(
  db: Queryable,
  authorityId: string,
  evidence: PublicCatalogueEvidence,
): Promise<string> {
  const id = randomUUID();
  await db.query("SELECT matchbase_public.acquire($1,$2,$3::jsonb)", [
    id,
    authorityId,
    JSON.stringify(evidence),
  ]);
  return id;
}

export async function releasePublicCatalogueEvidence(
  db: Queryable,
  ref: PublicEvidenceReference,
  independentReviewReference: string,
): Promise<void> {
  await db.query("SELECT matchbase_public.release($1,$2,$3)", [
    ref.observation_id,
    ref.rights_epoch,
    independentReviewReference,
  ]);
}

/** Public facts never contain the originating private profile, request, price, ranking or query. */
export async function lookupReleasedPublicEvidence(
  db: Queryable,
  classification: { scheme: string; code: string; version: string },
  query: string,
) {
  const result = await db.query(
    "SELECT * FROM matchbase_public.lookup($1,$2,$3,$4)",
    [classification.scheme, classification.code, classification.version, query],
  );
  return result.rows;
}

/** Call inside the consuming publication transaction so dependency locks last through publication. */
export async function registerPublicEvidenceDerivative(
  db: Queryable,
  input: {
    kind: "use_manifest" | "report" | "cache" | "index" | "summary";
    artifact_reference: string;
    dependencies: PublicEvidenceReference[];
  },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    "SELECT matchbase_public.register_derivative($1,$2,$3,$4::jsonb)",
    [
      id,
      input.kind,
      input.artifact_reference,
      JSON.stringify(input.dependencies),
    ],
  );
  return id;
}

/** Exports/cache retrieval must recheck current rights and the authenticated profile. */
export async function isPublicEvidenceDerivativeEligible(
  db: Queryable,
  id: string,
): Promise<boolean> {
  const result = await db.query<{ eligible: boolean }>(
    "SELECT matchbase_public.assert_derivative($1) AS eligible",
    [id],
  );
  return result.rows[0]?.eligible === true;
}

export async function withdrawPublicEvidence(
  db: Queryable,
  id: string,
  reason: "rights_withdrawn" | "source_correction" | "expiry_override",
): Promise<number> {
  const result = await db.query<{ sequence: string }>(
    "SELECT matchbase_public.withdraw($1,$2) AS sequence",
    [id, reason],
  );
  return Number(result.rows[0]?.sequence);
}

/** Always close serving BEFORE a restore; supply the independently retained complete watermark. */
export async function beginPublicCorpusRestore(db: Queryable): Promise<void> {
  await db.query("SELECT matchbase_public.begin_restore()");
}
export async function reconcilePublicCorpusTombstones(
  db: Queryable,
  expectedWatermark: number,
  records: Array<{
    sequence: number;
    observation_id: string;
    source_url: string;
    rights_epoch: number;
    reason_code: "rights_withdrawn" | "source_correction" | "expiry_override";
  }>,
): Promise<void> {
  await db.query("SELECT matchbase_public.reconcile_tombstones($1,$2::jsonb)", [
    expectedWatermark,
    JSON.stringify(records),
  ]);
}

/** No environment setting can turn the local Consultant simulator into production identity. */
export async function publicCorpusReadiness(db: Queryable): Promise<{
  shared_access_enabled: false;
  database_principal_non_bypass: boolean;
  reason: "verified_identity_adapter_not_qualified";
}> {
  const result = await db.query<{ safe: boolean }>(
    `SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole
      OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='matchbase_public' AND pg_has_role(session_user,n.nspowner,'MEMBER'))
      OR has_table_privilege(session_user,'public.consultant_private_observation','SELECT')) AS safe
     FROM pg_roles WHERE rolname=session_user`,
  );
  return {
    shared_access_enabled: false,
    database_principal_non_bypass: result.rows[0]?.safe === true,
    reason: "verified_identity_adapter_not_qualified",
  };
}
