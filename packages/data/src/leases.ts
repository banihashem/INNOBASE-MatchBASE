import { appendAuditEvent } from "./audit.js";
import type { ConnectionPool } from "./database.js";
import { inTransaction } from "./database.js";

export interface LeaseContext {
  readonly accountId: string;
  readonly actorUserId?: string;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export interface AcquiredLease {
  readonly slot: 1 | 2 | 3;
  readonly runId: string;
  readonly generation: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

interface LeaseRow {
  slot_no: 1 | 2 | 3;
  run_id: string;
  generation: number;
  acquired_at: Date;
  expires_at: Date;
  owner_token_hash?: Buffer;
}

function assertTtl(ttlMilliseconds: number): void {
  if (
    !Number.isInteger(ttlMilliseconds) ||
    ttlMilliseconds < 1_000 ||
    ttlMilliseconds > 900_000
  ) {
    throw new Error(
      "Lease TTL must be an integer between 1000 and 900000 milliseconds",
    );
  }
}

export async function acquireExecutionLease(
  pool: ConnectionPool,
  runId: string,
  ownerTokenHash: Uint8Array,
  ttlMilliseconds: number,
  context: LeaseContext,
): Promise<AcquiredLease | null> {
  assertTtl(ttlMilliseconds);
  return inTransaction(pool, async (client) => {
    const run = await client.query<{ state: string }>(
      `SELECT state FROM research_run
        WHERE run_id = $1 AND account_id = $2
        FOR UPDATE`,
      [runId, context.accountId],
    );
    const state = run.rows[0]?.state;

    const existing = await client.query<LeaseRow>(
      `SELECT slot_no, run_id, generation, acquired_at, expires_at, owner_token_hash
         FROM execution_lease
        WHERE run_id = $1 AND released_at IS NULL AND expires_at > clock_timestamp()
        FOR UPDATE`,
      [runId],
    );
    if (existing.rows[0]) {
      const existingOwner = existing.rows[0].owner_token_hash;
      if (!existingOwner || !existingOwner.equals(Buffer.from(ownerTokenHash)))
        return null;
      return mapLease(existing.rows[0]);
    }
    if (!state || !["queued", "failed_retryable"].includes(state)) {
      throw new Error("Run is not claimable");
    }

    const available = await client.query<{ slot_no: 1 | 2 | 3 }>(
      `SELECT slot_no
         FROM execution_lease
        WHERE run_id IS NULL OR released_at IS NOT NULL
        ORDER BY slot_no
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
    );
    const slot = available.rows[0]?.slot_no;
    if (!slot) return null;

    const acquired = await client.query<LeaseRow>(
      `UPDATE execution_lease
          SET run_id = $1,
              account_id = $2,
              owner_token_hash = $3,
              generation = generation + 1,
              acquired_at = clock_timestamp(),
              renewed_at = clock_timestamp(),
              expires_at = clock_timestamp() + ($4::integer * interval '1 millisecond'),
              released_at = NULL,
              release_reason = NULL
        WHERE slot_no = $5
      RETURNING slot_no, run_id, generation, acquired_at, expires_at`,
      [runId, context.accountId, ownerTokenHash, ttlMilliseconds, slot],
    );
    await client.query(
      `UPDATE research_run SET state = 'researching', started_at = COALESCE(started_at, clock_timestamp())
        WHERE run_id = $1`,
      [runId],
    );
    await appendAuditEvent(client, {
      accountId: context.accountId,
      ...(context.actorUserId ? { actorUserId: context.actorUserId } : {}),
      eventType: "run.lease.acquired",
      resourceKind: "research_run",
      resourceId: runId,
      outcome: "allow",
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      detail: { slot, generation: acquired.rows[0]?.generation },
    });
    const row = acquired.rows[0];
    if (!row) throw new Error("Lease acquisition returned no row");
    return mapLease(row);
  });
}

export async function renewExecutionLease(
  pool: ConnectionPool,
  runId: string,
  ownerTokenHash: Uint8Array,
  ttlMilliseconds: number,
): Promise<AcquiredLease | null> {
  assertTtl(ttlMilliseconds);
  return inTransaction(pool, async (client) => {
    const renewed = await client.query<LeaseRow>(
      `UPDATE execution_lease
          SET renewed_at = clock_timestamp(),
              expires_at = clock_timestamp() + ($3::integer * interval '1 millisecond')
        WHERE run_id = $1
          AND owner_token_hash = $2
          AND released_at IS NULL
          AND expires_at > clock_timestamp()
      RETURNING slot_no, run_id, generation, acquired_at, expires_at`,
      [runId, ownerTokenHash, ttlMilliseconds],
    );
    return renewed.rows[0] ? mapLease(renewed.rows[0]) : null;
  });
}

export async function releaseExecutionLease(
  pool: ConnectionPool,
  runId: string,
  ownerTokenHash: Uint8Array,
  reason: string,
  context: LeaseContext,
): Promise<boolean> {
  if (!reason.trim()) throw new Error("Lease release reason is required");
  return inTransaction(pool, async (client) => {
    const released = await client.query(
      `UPDATE execution_lease
          SET released_at = clock_timestamp(), release_reason = $3
        WHERE run_id = $1 AND owner_token_hash = $2 AND released_at IS NULL`,
      [runId, ownerTokenHash, reason],
    );
    if (released.rowCount !== 1) return false;
    await appendAuditEvent(client, {
      accountId: context.accountId,
      ...(context.actorUserId ? { actorUserId: context.actorUserId } : {}),
      eventType: "run.lease.released",
      resourceKind: "research_run",
      resourceId: runId,
      outcome: "allow",
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      detail: { reason },
    });
    return true;
  });
}

export async function recoverExpiredExecutionLeases(
  pool: ConnectionPool,
  correlationId: string,
  deploymentId: string,
): Promise<readonly string[]> {
  return inTransaction(pool, async (client) => {
    const expired = await client.query<{
      slot_no: number;
      run_id: string;
      account_id: string;
    }>(
      `SELECT slot_no, run_id, account_id
         FROM execution_lease
        WHERE run_id IS NOT NULL AND released_at IS NULL AND expires_at <= clock_timestamp()
        ORDER BY slot_no
        FOR UPDATE SKIP LOCKED`,
    );
    const recovered: string[] = [];
    for (const lease of expired.rows) {
      await client.query(
        `UPDATE research_run
            SET state = 'failed_retryable', state_reason = 'lease_expired'
          WHERE run_id = $1
            AND state IN ('researching','scoring','cancelling')`,
        [lease.run_id],
      );
      await client.query(
        `UPDATE execution_lease
            SET released_at = clock_timestamp(), release_reason = 'expired_recovery'
          WHERE slot_no = $1`,
        [lease.slot_no],
      );
      await appendAuditEvent(client, {
        accountId: lease.account_id,
        eventType: "run.lease.expired",
        resourceKind: "research_run",
        resourceId: lease.run_id,
        outcome: "error",
        correlationId,
        deploymentId,
        detail: { slot: lease.slot_no, reasonCode: "lease_expired" },
      });
      recovered.push(lease.run_id);
    }
    return recovered;
  });
}

function mapLease(row: LeaseRow): AcquiredLease {
  return {
    slot: row.slot_no,
    runId: row.run_id,
    generation: row.generation,
    acquiredAt: row.acquired_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}
