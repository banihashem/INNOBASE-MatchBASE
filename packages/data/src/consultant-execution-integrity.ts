import { createHash, randomUUID } from "node:crypto";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "./database.js";
import type { ConsultantWorkflowIdentity } from "./consultant-workflow-jobs.js";
import { assertLogicalRequestFence } from "./consultant-research-renewal.js";
import { assertQuotedPrivateMemoryAuthority } from "./consultant-private-memory-authority.js";
import { assertRetainedParentAuthority } from "./consultant-output-rights.js";

/** MB-ARCH-IMPLEMENT-001 L01. A lease token is a fence, not provider idempotency. */
export interface ExecutionFence {
  job_id: string;
  lease_token: string;
}

export class ExecutionIntegrityFault extends Error {
  readonly status = 409;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(code: string, message: string): never {
  throw new ExecutionIntegrityFault(code, message);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

/** Stable across PostgreSQL JSONB key ordering. Never include credentials. */
export function hashResearchAuthority(value: unknown): string {
  const serialized = JSON.stringify(canonical(value));
  if (serialized === undefined)
    throw new Error("Research authority must be JSON serializable.");
  return createHash("sha256").update(serialized).digest("hex");
}

/** Call inside the SAME transaction as publication. Lock order: root, session, job, round, sources. */
export async function assertExecutionFence(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
): Promise<void> {
  // Preserve the non-oracular ownership denial before entering the logical-root fence.
  const visible = await client.query(
    `SELECT run_id FROM consultant_workflow_session WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3
      AND execution_id=$4 AND COALESCE(classification->>'classification_id',workflow_metadata->>'classification_id')=$5::text
      AND NOT is_invalidated`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
    ],
  );
  if (!visible.rows.length)
    fail(
      "execution-lease-lost",
      "Execution ownership changed; no result may be published.",
    );
  await assertLogicalRequestFence(client, identity, identity.run_id);
  const session = await client.query(
    `SELECT execution_id,user_profile_id,is_invalidated,last_checkpoint,
      COALESCE(classification->>'classification_id',workflow_metadata->>'classification_id') AS classification_id
     FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
    [identity.account_id, identity.run_id],
  );
  const s = session.rows[0];
  if (
    !s ||
    s.is_invalidated ||
    s.last_checkpoint === "user_cancelled" ||
    s.execution_id !== identity.execution_id ||
    s.user_profile_id !== identity.user_profile_id ||
    s.classification_id !== identity.classification_id
  )
    fail(
      "execution-lease-lost",
      "Execution ownership changed; no result may be published.",
    );
  const job = await client.query(
    `SELECT job_id FROM consultant_workflow_job WHERE job_id=$1 AND lease_token=$2
      AND account_id=$3 AND run_id=$4 AND execution_id=$5 AND user_profile_id=$6
      AND classification_id=$7 AND status='running' AND lease_until>clock_timestamp() FOR UPDATE`,
    [
      fence.job_id,
      fence.lease_token,
      identity.account_id,
      identity.run_id,
      identity.execution_id,
      identity.user_profile_id,
      identity.classification_id,
    ],
  );
  if (job.rows.length !== 1)
    fail(
      "execution-lease-lost",
      "Execution lease expired or was replaced; no result may be published.",
    );
  // A lock wait itself may outlive the lease even when the locked row was not changed.
  const current = await client.query(
    `SELECT job_id FROM consultant_workflow_job WHERE job_id=$1 AND lease_token=$2 AND status='running'
      AND lease_until>clock_timestamp()`,
    [fence.job_id, fence.lease_token],
  );
  if (current.rows.length !== 1)
    fail(
      "execution-lease-lost",
      "Execution lease expired while waiting for publication ownership.",
    );
}

interface AuthorityRow {
  round_id: string;
  plan: Record<string, unknown>;
  execution_deadline: Date;
}

async function lockResearchAuthority(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  approvalHash: string,
  requiredStatus: "approved" | "completed" = "approved",
): Promise<AuthorityRow> {
  await assertExecutionFence(client, identity, fence);
  const result = await client.query<AuthorityRow>(
    `SELECT round_id,plan,approved_at+LEAST(86400000,COALESCE((plan->'execution_recovery'->>'valid_for_ms')::bigint,86400000))*interval '1 millisecond' AS execution_deadline
     FROM consultant_research_round WHERE account_id=$1 AND run_id=$2 AND execution_id=$3
       AND user_profile_id=$4 AND classification_id=$5 AND status=$6
       AND approved_at IS NOT NULL AND approved_at+LEAST(86400000,COALESCE((plan->'execution_recovery'->>'valid_for_ms')::bigint,86400000))*interval '1 millisecond'>clock_timestamp() FOR UPDATE`,
    [
      identity.account_id,
      identity.run_id,
      identity.execution_id,
      identity.user_profile_id,
      identity.classification_id,
      requiredStatus,
    ],
  );
  const row = result.rows[0];
  if (!row || hashResearchAuthority(row.plan) !== approvalHash)
    fail(
      "MB-409-EXECUTION-AUTHORITY",
      "Research approval changed or its execution window ended. Review a fresh estimate.",
    );
  await assertLogicalRequestFence(
    client,
    identity,
    identity.run_id,
    typeof row.plan.logical_request_generation === "number"
      ? row.plan.logical_request_generation
      : undefined,
  );
  await assertRetainedParentAuthority(client, identity, row.plan);
  await assertQuotedPrivateMemoryAuthority(client, identity, row.plan);
  const deadline = await client.query<{ valid: boolean }>(
    `SELECT $1::timestamptz > clock_timestamp() AS valid`,
    [row.execution_deadline],
  );
  if (!deadline.rows[0]?.valid)
    fail(
      "MB-409-EXECUTION-AUTHORITY",
      "The research execution window ended while waiting for ownership.",
    );
  const lease = await client.query(
    `SELECT job_id FROM consultant_workflow_job WHERE job_id=$1 AND lease_token=$2
      AND status='running' AND lease_until>clock_timestamp()`,
    [fence.job_id, fence.lease_token],
  );
  if (lease.rows.length !== 1)
    fail(
      "execution-lease-lost",
      "Execution ownership expired while validating its evidence.",
    );
  return row;
}

/** Same-transaction final publication gate, including authority after all lock waits. */
export async function assertResearchPublicationAuthority(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  approvalHash: string,
): Promise<void> {
  await lockResearchAuthority(client, identity, fence, approvalHash);
}

/** Last gate in the same output transaction; stage/attempt APIs still require an approved round. */
export async function assertCompletedResearchPublicationAuthority(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  approvalHash: string,
): Promise<void> {
  await lockResearchAuthority(
    client,
    identity,
    fence,
    approvalHash,
    "completed",
  );
}

export interface ResearchAttemptReservation {
  request_id: string;
  operation_key: string;
  stage_key: string;
  phase: string;
  model: string;
  input_sha256: string;
  approval_sha256: string;
  reserve_synthesis: boolean;
  estimated_exposure_usd: number | null;
}

function assertHash(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value))
    fail("MB-409-EXECUTION-MANIFEST", "An execution manifest hash is invalid.");
}

/** Reserve once before dispatch. reserved=false NEVER authorizes another dispatch. */
export async function reserveResearchAttempt(
  pool: ConnectionPool,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  reservation: ResearchAttemptReservation,
): Promise<{ reserved: boolean; request_id: string; consumed_calls: number }> {
  assertHash(reservation.input_sha256);
  assertHash(reservation.stage_key);
  assertHash(reservation.approval_sha256);
  if (
    !reservation.operation_key ||
    !reservation.phase ||
    !reservation.model ||
    (reservation.estimated_exposure_usd !== null &&
      (!Number.isFinite(reservation.estimated_exposure_usd) ||
        reservation.estimated_exposure_usd < 0))
  )
    fail("MB-409-EXECUTION-MANIFEST", "Attempt admission metadata is invalid.");
  return inTransaction(pool, async (client) => {
    const authority = await lockResearchAuthority(
      client,
      identity,
      fence,
      reservation.approval_sha256,
    );
    const existing = await client.query(
      `SELECT * FROM consultant_research_attempt WHERE request_id=$1`,
      [reservation.request_id],
    );
    const prior = existing.rows[0];
    if (
      prior &&
      (prior.account_id !== identity.account_id ||
        prior.run_id !== identity.run_id ||
        prior.execution_id !== identity.execution_id ||
        prior.user_profile_id !== identity.user_profile_id ||
        prior.classification_id !== identity.classification_id ||
        prior.operation_key !== reservation.operation_key ||
        prior.input_sha256 !== reservation.input_sha256 ||
        prior.approval_sha256 !== reservation.approval_sha256 ||
        prior.model !== reservation.model ||
        prior.stage_key !== reservation.stage_key)
    )
      fail(
        "MB-409-EXECUTION-ATTEMPT",
        "A provider attempt identifier cannot be reassigned.",
      );
    // Count legacy dispatches too, without double-counting attempts having provider receipts.
    const usage = await client.query<{ consumed: number }>(
      `SELECT (
        (SELECT count(*) FROM consultant_research_attempt WHERE account_id=$1 AND execution_id=$2 AND outcome<>'not_dispatched') +
        (SELECT count(*) FROM consultant_provider_call c WHERE c.account_id=$1 AND c.execution_id=$2
          AND c.detail->>'dispatched' IS DISTINCT FROM 'false'
          AND NOT EXISTS(SELECT 1 FROM consultant_research_attempt a WHERE a.request_id=c.request_id))
      )::integer AS consumed`,
      [identity.account_id, identity.execution_id],
    );
    const consumed = usage.rows[0]?.consumed ?? 0;
    if (prior)
      return {
        reserved: false,
        request_id: reservation.request_id,
        consumed_calls: consumed,
      };
    const ambiguous = await client.query(
      `SELECT request_id FROM consultant_research_attempt WHERE account_id=$1 AND execution_id=$2
        AND stage_key=$3 AND provider_outcome='unknown' AND outcome<>'not_dispatched' LIMIT 1`,
      [identity.account_id, identity.execution_id, reservation.stage_key],
    );
    const stageUsage = await client.query<{ consumed: number }>(
      `SELECT count(*)::integer AS consumed FROM consultant_research_attempt WHERE account_id=$1 AND execution_id=$2
        AND stage_key=$3 AND outcome<>'not_dispatched'`,
      [identity.account_id, identity.execution_id, reservation.stage_key],
    );
    const stageLimit = authority.plan.automatic_recovery_attempts ?? 1;
    if (
      typeof stageLimit !== "number" ||
      !Number.isInteger(stageLimit) ||
      stageLimit < 1 ||
      stageUsage.rows[0]!.consumed >= stageLimit
    )
      fail(
        "MB-409-STAGE-ALLOWANCE",
        "This stage's approved recovery allowance is exhausted. No request was dispatched.",
      );
    const maxCalls = authority.plan.max_calls;
    if (
      typeof maxCalls !== "number" ||
      !Number.isInteger(maxCalls) ||
      maxCalls < 1 ||
      consumed >= maxCalls - Number(reservation.reserve_synthesis)
    )
      fail(
        "MB-409-ROUND-ALLOWANCE",
        "The approved provider-call allowance is exhausted. No request was dispatched.",
      );
    if (ambiguous.rows.length)
      fail(
        "MB-409-EXECUTION-AMBIGUOUS",
        "A prior attempt has no confirmed provider outcome. Its possible charge is retained; review is required before repeating this stage.",
      );
    await client.query(
      `INSERT INTO consultant_research_attempt(request_id,account_id,user_profile_id,run_id,execution_id,classification_id,
        job_id,lease_token,round_id,operation_key,phase,model,input_sha256,approval_sha256,estimated_exposure_usd,stage_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        reservation.request_id,
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
        fence.job_id,
        fence.lease_token,
        authority.round_id,
        reservation.operation_key,
        reservation.phase,
        reservation.model,
        reservation.input_sha256,
        reservation.approval_sha256,
        reservation.estimated_exposure_usd,
        reservation.stage_key,
      ],
    );
    return {
      reserved: true,
      request_id: reservation.request_id,
      consumed_calls: consumed + 1,
    };
  });
}

/** Late receipts update accounting only. They confer no publication or replay authority. */
export async function recordResearchAttemptReceipt(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  event: Record<string, unknown>,
): Promise<void> {
  if (typeof event.request_id !== "string") return;
  const keys = [
    "state",
    "model",
    "requested_model",
    "provider_generation_id",
    "phase",
    "loop",
    "started_at",
    "completed_at",
    "cost_usd",
    "cost_reported",
    "usage_reported",
    "is_byok",
    "upstream_inference_cost",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "error",
    "requested_provider",
    "actual_provider",
    "dispatched",
    "provider_receipt_received",
    "provider_dispatch_rejected",
  ];
  const detail = Object.fromEntries(
    keys
      .filter((key) => event[key] !== undefined)
      .map((key) => [key, event[key]]),
  );
  const terminal = event.state === "completed" || event.state === "failed";
  const outcome =
    terminal && event.dispatched === false
      ? "not_dispatched"
      : terminal
        ? event.state
        : "dispatch_intent";
  const providerOutcome =
    outcome === "not_dispatched"
      ? "not_dispatched"
      : event.provider_receipt_received === true || event.state === "completed"
        ? "received"
        : event.provider_dispatch_rejected === true
          ? "rejected"
          : "unknown";
  const cost =
    event.cost_reported === true &&
    typeof event.cost_usd === "number" &&
    Number.isFinite(event.cost_usd) &&
    event.cost_usd >= 0
      ? event.cost_usd
      : null;
  await db.query(
    `UPDATE consultant_research_attempt SET
      receipt=CASE WHEN (outcome<>'dispatch_intent' AND $7='dispatch_intent') OR (outcome='completed' AND $7<>'completed') THEN receipt
        ELSE COALESCE(receipt,'{}'::jsonb) || $8::jsonb END,
      outcome=CASE WHEN (outcome<>'dispatch_intent' AND $7='dispatch_intent') OR (outcome='completed' AND $7<>'completed') THEN outcome ELSE $7 END,
      provider_outcome=CASE WHEN $10='unknown' OR (outcome='completed' AND $7<>'completed') THEN provider_outcome ELSE $10 END,
      confirmed_cost_usd=COALESCE($9,confirmed_cost_usd),updated_at=clock_timestamp()
     WHERE request_id=$1 AND account_id=$2 AND user_profile_id=$3 AND run_id=$4 AND execution_id=$5 AND classification_id=$6`,
    [
      event.request_id,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      outcome,
      JSON.stringify(detail),
      cost,
      providerOutcome,
    ],
  );
}

export interface ResearchStageManifest {
  version: "research-stage.v1";
  stage_kind: string;
  qualification:
    | "received_unvalidated"
    | "validated_extraction"
    | "validated_focus"
    | "validated_synthesis_input"
    | "validated_synthesis";
  operation_key: string;
  input_sha256: string;
  policy_sha256: string;
  approval_sha256: string;
  schema_version: string;
  validator_version: string;
  model_policy_sha256: string;
  expires_at: string;
}

function assertManifest(manifest: ResearchStageManifest): void {
  for (const hash of [
    manifest.input_sha256,
    manifest.policy_sha256,
    manifest.approval_sha256,
    manifest.model_policy_sha256,
  ])
    assertHash(hash);
  if (
    manifest.version !== "research-stage.v1" ||
    !manifest.stage_kind ||
    !manifest.operation_key ||
    !manifest.schema_version ||
    !manifest.validator_version ||
    ![
      "received_unvalidated",
      "validated_extraction",
      "validated_focus",
      "validated_synthesis_input",
      "validated_synthesis",
    ].includes(manifest.qualification) ||
    !Number.isFinite(new Date(manifest.expires_at).getTime())
  )
    fail("MB-409-EXECUTION-MANIFEST", "The stage manifest is incomplete.");
}

export async function loadResearchStage(
  pool: ConnectionPool,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  manifest: ResearchStageManifest,
): Promise<{ manifest: ResearchStageManifest; result: unknown } | null> {
  assertManifest(manifest);
  return inTransaction(pool, async (client) => {
    await lockResearchAuthority(
      client,
      identity,
      fence,
      manifest.approval_sha256,
    );
    const result = await client.query<{
      manifest: ResearchStageManifest;
      result: unknown;
      result_sha256: string;
    }>(
      `SELECT manifest,result,result_sha256 FROM consultant_research_stage WHERE account_id=$1 AND run_id=$2
       AND execution_id=$3 AND user_profile_id=$4 AND classification_id=$5 AND manifest_sha256=$6
       AND expires_at>clock_timestamp()`,
      [
        identity.account_id,
        identity.run_id,
        identity.execution_id,
        identity.user_profile_id,
        identity.classification_id,
        hashResearchAuthority(manifest),
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      hashResearchAuthority(row.result) !== row.result_sha256 ||
      hashResearchAuthority(row.manifest) !== hashResearchAuthority(manifest)
    )
      fail(
        "MB-409-EXECUTION-MANIFEST",
        "Saved stage integrity could not be verified.",
      );
    return { manifest: row.manifest, result: row.result };
  });
}

export async function commitResearchStage(
  pool: ConnectionPool,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  manifest: ResearchStageManifest,
  result: unknown,
): Promise<void> {
  assertManifest(manifest);
  const serialized = JSON.stringify(result);
  if (serialized === undefined)
    fail(
      "MB-409-EXECUTION-MANIFEST",
      "A complete JSON stage result is required.",
    );
  await inTransaction(pool, async (client) => {
    const authority = await lockResearchAuthority(
      client,
      identity,
      fence,
      manifest.approval_sha256,
    );
    if (
      new Date(manifest.expires_at).getTime() >
      authority.execution_deadline.getTime()
    )
      fail(
        "MB-409-EXECUTION-MANIFEST",
        "Stage expiry cannot extend the approved execution window.",
      );
    const manifestHash = hashResearchAuthority(manifest);
    const resultHash = hashResearchAuthority(JSON.parse(serialized));
    const saved = await client.query(
      `INSERT INTO consultant_research_stage(stage_id,account_id,user_profile_id,run_id,execution_id,classification_id,
        job_id,round_id,manifest_sha256,manifest,result,result_sha256,expires_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 WHERE $13::timestamptz>clock_timestamp()
       ON CONFLICT(account_id,run_id,execution_id,manifest_sha256) DO NOTHING RETURNING stage_id`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
        fence.job_id,
        authority.round_id,
        manifestHash,
        JSON.stringify(manifest),
        serialized,
        resultHash,
        manifest.expires_at,
      ],
    );
    if (saved.rows.length) return;
    const prior = await client.query(
      `SELECT result_sha256 FROM consultant_research_stage WHERE account_id=$1 AND run_id=$2 AND execution_id=$3
       AND manifest_sha256=$4 AND expires_at>clock_timestamp()`,
      [
        identity.account_id,
        identity.run_id,
        identity.execution_id,
        manifestHash,
      ],
    );
    if (prior.rows[0]?.result_sha256 !== resultHash)
      fail(
        "MB-409-EXECUTION-MANIFEST",
        "A saved stage cannot be overwritten or committed after expiry.",
      );
  });
}

export async function getExecutionRecoveryState(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
) {
  const result = await db.query<{
    attempt_count: number;
    unreceipted_attempts: number;
    blocked_replay_attempts: number;
    unknown_cost_attempts: number;
    retained_stages: number;
    confirmed_cost_usd: string | null;
    estimated_exposure_usd: string | null;
  }>(
    `SELECT count(*)::integer AS attempt_count,
      count(*) FILTER(WHERE provider_outcome='unknown' AND outcome<>'not_dispatched')::integer AS unreceipted_attempts,
      count(*) FILTER(WHERE provider_outcome='unknown' AND outcome<>'not_dispatched')::integer AS blocked_replay_attempts,
      count(*) FILTER(WHERE outcome<>'not_dispatched' AND confirmed_cost_usd IS NULL)::integer AS unknown_cost_attempts,
      sum(confirmed_cost_usd)::text AS confirmed_cost_usd,
      sum(estimated_exposure_usd) FILTER(WHERE outcome<>'not_dispatched' AND confirmed_cost_usd IS NULL)::text AS estimated_exposure_usd,
      (SELECT count(*)::integer FROM consultant_research_stage s WHERE s.account_id=$1 AND s.user_profile_id=$2
        AND s.run_id=$3 AND s.execution_id=$4 AND s.classification_id=$5 AND s.expires_at>clock_timestamp()) AS retained_stages
     FROM consultant_research_attempt WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND execution_id=$4 AND classification_id=$5`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
    ],
  );
  return result.rows[0]!;
}
