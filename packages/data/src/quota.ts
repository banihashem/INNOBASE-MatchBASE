import { randomUUID } from "node:crypto";
import { appendAuditEvent } from "./audit.js";
import type { ConnectionPool, TransactionClient } from "./database.js";
import { inTransaction } from "./database.js";

export type ChargeableTier = "demo" | "standard" | "consultant";

export const ROLLING_QUOTA_LIMITS: Readonly<Record<ChargeableTier, number>> = {
  demo: 3,
  standard: 5,
  consultant: 20,
};

export interface QuotaAdmissionInput {
  readonly accountId: string;
  readonly userId: string;
  readonly canonicalRequestVersionId: string;
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly modelPolicyVersionId: string;
  readonly scoringConfigVersionId: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly runId?: string;
}

export type QuotaAdmissionResult =
  | {
      readonly disposition: "accepted" | "replayed";
      readonly runId: string;
      readonly tier: ChargeableTier;
      readonly limit: number;
      readonly used: number;
      readonly remaining: number;
      readonly nextCapacityAt: string | null;
    }
  | {
      readonly disposition: "quota_exceeded";
      readonly tier: ChargeableTier;
      readonly limit: number;
      readonly used: number;
      readonly remaining: 0;
      readonly nextCapacityAt: string;
    };

interface IdempotencyRow {
  request_hash: Buffer;
  response_body: QuotaAdmissionResult;
}

interface TierRow {
  tier: ChargeableTier;
}

interface QuotaRow {
  used: string;
  next_capacity_at: Date | null;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function resolveTier(
  client: TransactionClient,
  accountId: string,
  userId: string,
  decisionAt: Date,
): Promise<ChargeableTier> {
  const result = await client.query<TierRow>(
    `SELECT tier
       FROM entitlement_grant
      WHERE account_id = $1
        AND user_id = $2
        AND effective_from <= $3
        AND (effective_to IS NULL OR effective_to > $3)
        AND revoked_at IS NULL
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1`,
    [accountId, userId, decisionAt],
  );
  const tier = result.rows[0]?.tier;
  if (!tier || !(tier in ROLLING_QUOTA_LIMITS)) {
    throw new Error("No chargeable persisted entitlement for subject");
  }
  return tier;
}

async function quotaState(
  client: TransactionClient,
  accountId: string,
  decisionAt: Date,
): Promise<{ used: number; nextCapacityAt: string | null }> {
  const result = await client.query<QuotaRow>(
    `SELECT count(*)::text AS used,
            min(q.charged_at + interval '168 hours') AS next_capacity_at
       FROM quota_ledger q
      WHERE q.account_id = $1
        AND q.entry_kind = 'charge'
        AND q.charged_at > $2::timestamptz - interval '168 hours'
        AND q.charged_at <= $2::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM quota_ledger c
           WHERE c.compensates_entry_id = q.quota_entry_id
        )`,
    [accountId, decisionAt],
  );
  const row = result.rows[0];
  return {
    used: Number(row?.used ?? "0"),
    nextCapacityAt: row?.next_capacity_at?.toISOString() ?? null,
  };
}

export async function admitRunWithinQuota(
  pool: ConnectionPool,
  input: QuotaAdmissionInput,
): Promise<QuotaAdmissionResult> {
  return inTransaction(pool, async (client) => {
    const account = await client.query(
      `SELECT 1
         FROM account
        WHERE account_id = $1 AND status = 'active'
        FOR UPDATE`,
      [input.accountId],
    );
    if (account.rowCount !== 1) throw new Error("Active account not found");
    const clock = await client.query<{ decision_at: Date }>(
      "SELECT clock_timestamp() AS decision_at",
    );
    const decisionAt = clock.rows[0]?.decision_at;
    if (!decisionAt) throw new Error("Quota decision clock is unavailable");

    const identity = await client.query(
      `SELECT 1 FROM app_user
        WHERE user_id = $1 AND account_id = $2 AND status = 'active'`,
      [input.userId, input.accountId],
    );
    if (identity.rowCount !== 1)
      throw new Error("Active subject not found in account");

    const replay = await client.query<IdempotencyRow>(
      `SELECT request_hash, response_body
         FROM idempotency_record
        WHERE account_id = $1
          AND subject_user_id = $2
          AND route = '/api/v1/runs'
          AND key_hash = $3
          AND expires_at > $4`,
      [input.accountId, input.userId, input.idempotencyKeyHash, decisionAt],
    );
    const prior = replay.rows[0];
    if (prior) {
      if (!equalBytes(prior.request_hash, input.requestHash)) {
        throw new Error("Idempotency key reused with a different request hash");
      }
      return {
        ...prior.response_body,
        disposition: "replayed",
      } as QuotaAdmissionResult;
    }

    const canonical = await client.query(
      `SELECT 1
         FROM canonical_request_version v
         JOIN sourcing_request r
           ON r.request_id = v.request_id AND r.account_id = v.account_id
        WHERE v.canonical_request_version_id = $1
          AND v.account_id = $2
          AND r.created_by_user_id = $3
          AND v.match_readiness IN ('ready', 'partially_ready')
          AND EXISTS (
            SELECT 1 FROM canonical_confirmation c
             WHERE c.canonical_request_version_id = v.canonical_request_version_id
               AND c.accepted = true
          )
          AND NOT EXISTS (
            SELECT 1 FROM canonical_contradiction x
             WHERE x.canonical_request_version_id = v.canonical_request_version_id
               AND x.blocking = true AND x.resolved_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM canonical_contradiction_resolution xr
                  WHERE xr.account_id = x.account_id
                    AND xr.contradiction_id = x.contradiction_id
                    AND xr.resolving_canonical_request_version_id = v.canonical_request_version_id
               )
          )`,
      [input.canonicalRequestVersionId, input.accountId, input.userId],
    );
    if (canonical.rowCount !== 1) {
      throw new Error("Canonical request is not confirmed and runnable");
    }

    const tier = await resolveTier(
      client,
      input.accountId,
      input.userId,
      decisionAt,
    );
    const limit = ROLLING_QUOTA_LIMITS[tier];
    const current = await quotaState(client, input.accountId, decisionAt);
    if (current.used >= limit) {
      if (!current.nextCapacityAt)
        throw new Error("Quota state has no next-capacity timestamp");
      return {
        disposition: "quota_exceeded",
        tier,
        limit,
        used: current.used,
        remaining: 0,
        nextCapacityAt: current.nextCapacityAt,
      };
    }

    const runId = input.runId ?? randomUUID();
    const response: QuotaAdmissionResult = {
      disposition: "accepted",
      runId,
      tier,
      limit,
      used: current.used + 1,
      remaining: limit - current.used - 1,
      nextCapacityAt: current.nextCapacityAt,
    };

    await client.query(
      `INSERT INTO research_run (
         run_id, account_id, canonical_request_version_id, requested_by_user_id,
         tier_at_submission, state, model_policy_version_id,
         scoring_config_version_id, idempotency_key_hash, queued_at
       ) VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9)`,
      [
        runId,
        input.accountId,
        input.canonicalRequestVersionId,
        input.userId,
        tier,
        input.modelPolicyVersionId,
        input.scoringConfigVersionId,
        input.idempotencyKeyHash,
        decisionAt,
      ],
    );
    await client.query(
      `INSERT INTO quota_ledger (
         quota_entry_id, account_id, user_id, run_id, entry_kind, units,
         charged_at, reason_code
       ) VALUES ($1,$2,$3,$4,'charge',1,$5,'run.accepted')`,
      [randomUUID(), input.accountId, input.userId, runId, decisionAt],
    );
    await client.query(
      `INSERT INTO idempotency_record (
         idempotency_record_id, account_id, subject_user_id, route, key_hash,
         request_hash, response_status, response_body, result_resource_id,
         created_at, expires_at
       ) VALUES ($1,$2,$3,'/api/v1/runs',$4,$5,202,$6::jsonb,$7,$8::timestamptz,$8::timestamptz + interval '24 hours')`,
      [
        randomUUID(),
        input.accountId,
        input.userId,
        input.idempotencyKeyHash,
        input.requestHash,
        JSON.stringify(response),
        runId,
        decisionAt,
      ],
    );
    await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.userId,
      actorTier: tier,
      eventType: "run.queued",
      resourceKind: "research_run",
      resourceId: runId,
      outcome: "allow",
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { quotaLimit: limit, quotaUsed: current.used + 1 },
    });
    return response;
  });
}

export interface QuotaCompensationInput {
  readonly accountId: string;
  readonly userId: string;
  readonly runId: string;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export async function compensateQuotaCharge(
  pool: ConnectionPool,
  input: QuotaCompensationInput,
): Promise<string> {
  return inTransaction(pool, async (client) => {
    await client.query(
      "SELECT 1 FROM account WHERE account_id = $1 FOR UPDATE",
      [input.accountId],
    );
    const charge = await client.query<{ quota_entry_id: string }>(
      `SELECT quota_entry_id FROM quota_ledger
        WHERE account_id = $1 AND user_id = $2 AND run_id = $3
          AND entry_kind = 'charge'
        FOR UPDATE`,
      [input.accountId, input.userId, input.runId],
    );
    const chargeId = charge.rows[0]?.quota_entry_id;
    if (!chargeId) throw new Error("Charge not found");
    const compensationId = randomUUID();
    await client.query(
      `INSERT INTO quota_ledger (
         quota_entry_id, account_id, user_id, run_id, entry_kind, units,
         charged_at, reason_code, compensates_entry_id
       ) VALUES ($1,$2,$3,$4,'compensation',-1,clock_timestamp(),$5,$6)`,
      [
        compensationId,
        input.accountId,
        input.userId,
        input.runId,
        input.reasonCode,
        chargeId,
      ],
    );
    await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.userId,
      eventType: "quota.compensated",
      resourceKind: "research_run",
      resourceId: input.runId,
      outcome: "allow",
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { chargeId, compensationId, reasonCode: input.reasonCode },
    });
    return compensationId;
  });
}
