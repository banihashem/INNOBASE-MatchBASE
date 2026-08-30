import { createHash, randomUUID } from "node:crypto";
import type { ConnectionPool, Queryable } from "./database.js";
import { inTransaction } from "./database.js";

interface AuditDigestRow {
  readonly audit_id: string;
  readonly occurred_at: Date;
  readonly account_id: string | null;
  readonly actor_user_id: string | null;
  readonly actor_tier: string | null;
  readonly actor_admin_sub_role: string | null;
  readonly on_behalf_of_user_id: string | null;
  readonly event_type: string;
  readonly resource_kind: string | null;
  readonly resource_id: string | null;
  readonly outcome: string;
  readonly projection_version_id: string | null;
  readonly fields_released: string[] | null;
  readonly justification: string | null;
  readonly request_correlation_id: string;
  readonly deployment_id: string;
  readonly detail: unknown;
  readonly event_schema_version: number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Audit canonical value is non-finite.");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object")
    throw new Error("Audit canonical value is not JSON.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function normalizedRow(row: AuditDigestRow): Record<string, unknown> {
  return {
    account_id: row.account_id,
    actor_admin_sub_role: row.actor_admin_sub_role,
    actor_tier: row.actor_tier,
    actor_user_id: row.actor_user_id,
    audit_id: row.audit_id,
    deployment_id: row.deployment_id,
    detail: row.detail,
    event_schema_version: row.event_schema_version,
    event_type: row.event_type,
    fields_released: row.fields_released,
    justification: row.justification,
    occurred_at: row.occurred_at.toISOString(),
    on_behalf_of_user_id: row.on_behalf_of_user_id,
    outcome: row.outcome,
    projection_version_id: row.projection_version_id,
    request_correlation_id: row.request_correlation_id,
    resource_id: row.resource_id,
    resource_kind: row.resource_kind,
  };
}

export function auditRowsSha256(rows: readonly AuditDigestRow[]): Buffer {
  return createHash("sha256")
    .update(canonical(rows.map(normalizedRow)), "utf8")
    .digest();
}

const auditColumns = `audit_id,occurred_at,account_id,actor_user_id,actor_tier,
  actor_admin_sub_role,on_behalf_of_user_id,event_type,resource_kind,resource_id,
  outcome,projection_version_id,fields_released,justification,
  request_correlation_id,deployment_id,detail,event_schema_version`;

async function readRange(
  client: Queryable,
  accountId: string,
  startAt?: Date,
  startId?: string,
  endAt?: Date,
  endId?: string,
): Promise<AuditDigestRow[]> {
  const result = await client.query<AuditDigestRow>(
    `SELECT ${auditColumns} FROM audit_event
      WHERE account_id=$1
      ORDER BY occurred_at,audit_id`,
    [accountId],
  );
  if (!startAt || !startId || !endAt || !endId) return result.rows;
  const startIndex = result.rows.findIndex(
    ({ audit_id }) => audit_id === startId,
  );
  const endIndex = result.rows.findIndex(({ audit_id }) => audit_id === endId);
  if (startIndex < 0 || endIndex < startIndex) return [];
  return result.rows.slice(startIndex, endIndex + 1);
}

export interface AuditCheckpointResult {
  readonly checkpointId: string;
  readonly rowCount: number;
  readonly canonicalSha256: string;
  readonly checkpointSha256: string;
}

export async function createAuditIntegrityCheckpoint(
  pool: ConnectionPool,
  accountId: string,
): Promise<AuditCheckpointResult> {
  return inTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      accountId,
    ]);
    const rows = await readRange(client, accountId);
    if (rows.length === 0) throw new Error("Audit checkpoint range is empty.");
    const first = rows[0]!;
    const last = rows.at(-1)!;
    const canonicalSha256 = auditRowsSha256(rows);
    const previous = await client.query<{ checkpoint_sha256: Buffer }>(
      `SELECT checkpoint_sha256 FROM audit_integrity_checkpoint
        WHERE account_id=$1 ORDER BY created_at DESC,checkpoint_id DESC LIMIT 1`,
      [accountId],
    );
    const previousSha = previous.rows[0]?.checkpoint_sha256 ?? null;
    const checkpointSha256 = createHash("sha256")
      .update(
        canonical({
          account_id: accountId,
          canonical_sha256: canonicalSha256.toString("hex"),
          previous_checkpoint_sha256: previousSha?.toString("hex") ?? null,
          range_end_at: last.occurred_at.toISOString(),
          range_end_audit_id: last.audit_id,
          range_start_at: first.occurred_at.toISOString(),
          range_start_audit_id: first.audit_id,
          row_count: rows.length,
        }),
        "utf8",
      )
      .digest();
    const checkpointId = randomUUID();
    await client.query(
      `INSERT INTO audit_integrity_checkpoint
        (checkpoint_id,account_id,range_start_at,range_start_audit_id,
         range_end_at,range_end_audit_id,row_count,canonical_sha256,
         previous_checkpoint_sha256,checkpoint_sha256)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        checkpointId,
        accountId,
        first.occurred_at,
        first.audit_id,
        last.occurred_at,
        last.audit_id,
        rows.length,
        canonicalSha256,
        previousSha,
        checkpointSha256,
      ],
    );
    return {
      checkpointId,
      rowCount: rows.length,
      canonicalSha256: canonicalSha256.toString("hex"),
      checkpointSha256: checkpointSha256.toString("hex"),
    };
  });
}

export interface AuditVerificationResult {
  readonly verificationId: string;
  readonly checkpointId: string;
  readonly consistent: boolean;
  readonly affectedRange: null | {
    readonly fromAt: string;
    readonly fromAuditId: string;
    readonly toAt: string;
    readonly toAuditId: string;
  };
}

export async function verifyLatestAuditIntegrityCheckpoint(
  pool: ConnectionPool,
  accountId: string,
): Promise<AuditVerificationResult> {
  return inTransaction(pool, async (client) => {
    const found = await client.query<{
      checkpoint_id: string;
      canonical_sha256: Buffer;
      range_start_at: Date;
      range_start_audit_id: string;
      range_end_at: Date;
      range_end_audit_id: string;
    }>(
      `SELECT checkpoint_id,canonical_sha256,range_start_at,range_start_audit_id,
              range_end_at,range_end_audit_id
         FROM audit_integrity_checkpoint WHERE account_id=$1
        ORDER BY created_at DESC,checkpoint_id DESC LIMIT 1`,
      [accountId],
    );
    const checkpoint = found.rows[0];
    if (!checkpoint) throw new Error("Audit checkpoint does not exist.");
    const rows = await readRange(
      client,
      accountId,
      checkpoint.range_start_at,
      checkpoint.range_start_audit_id,
      checkpoint.range_end_at,
      checkpoint.range_end_audit_id,
    );
    const observed = auditRowsSha256(rows);
    const consistent = observed.equals(checkpoint.canonical_sha256);
    const verificationId = randomUUID();
    await client.query(
      `INSERT INTO audit_integrity_verification
        (verification_id,checkpoint_id,observed_sha256,consistent,
         affected_from_at,affected_from_audit_id,affected_to_at,affected_to_audit_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        verificationId,
        checkpoint.checkpoint_id,
        observed,
        consistent,
        consistent ? null : checkpoint.range_start_at,
        consistent ? null : checkpoint.range_start_audit_id,
        consistent ? null : checkpoint.range_end_at,
        consistent ? null : checkpoint.range_end_audit_id,
      ],
    );
    return {
      verificationId,
      checkpointId: checkpoint.checkpoint_id,
      consistent,
      affectedRange: consistent
        ? null
        : {
            fromAt: checkpoint.range_start_at.toISOString(),
            fromAuditId: checkpoint.range_start_audit_id,
            toAt: checkpoint.range_end_at.toISOString(),
            toAuditId: checkpoint.range_end_audit_id,
          },
    };
  });
}
