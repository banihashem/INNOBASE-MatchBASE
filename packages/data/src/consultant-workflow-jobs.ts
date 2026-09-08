import { randomUUID } from "node:crypto";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "./database.js";

/** L09: serialize cancellation and publication on the retained session. */
export async function lockActiveConsultantExecution(
  db: Queryable,
  accountId: string,
  runId: string,
  executionId: string,
): Promise<void> {
  const result = await db.query(
    `SELECT execution_id, last_checkpoint, is_invalidated
       FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
    [accountId, runId],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.is_invalidated ||
    row.execution_id !== executionId ||
    row.last_checkpoint === "user_cancelled"
  ) {
    throw Object.assign(new Error("Execution is no longer active."), {
      code: "execution-lease-lost",
    });
  }
}

export async function stopConsultantResearch(
  pool: ConnectionPool,
  accountId: string,
  runId: string,
  executionId: string,
): Promise<
  "stopped" | "already_stopped" | "not_found" | "stale" | "not_running"
> {
  return inTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT * FROM consultant_workflow_session
        WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
      [accountId, runId],
    );
    const session = result.rows[0];
    if (!session || session.is_invalidated) return "not_found";
    if (session.execution_id !== executionId) return "stale";
    if (session.last_checkpoint === "user_cancelled") return "already_stopped";
    if (
      [
        "progressive_reveal_ready",
        "workflow_complete",
        "pdf_generating",
      ].includes(session.current_state)
    )
      return "not_running";
    const stopped = await client.query<ConsultantWorkflowJob>(
      `UPDATE consultant_workflow_job SET status='failed', error_code='user-cancelled',
         lease_until=NULL, completed_at=clock_timestamp()
       WHERE account_id=$1 AND run_id=$2 AND execution_id=$3
         AND stage='research' AND status IN ('queued','running') RETURNING *`,
      [accountId, runId, executionId],
    );
    const stoppedJob = stopped.rows[0];
    if (!stoppedJob) return "not_running";
    const previous = session.workflow_metadata?.progress;
    const metadata = {
      error:
        "Research stopped by your request. Saved findings and approvals are retained.",
      retry_action: "research",
      stopped_by_user: true,
      progress: {
        phase: "user_cancelled",
        loop: previous?.loop ?? 0,
        max_loops: previous?.max_loops ?? 15,
        message:
          "Stopped by you. Worker cancellation is requested; already-dispatched provider calls may still finish.",
        updated_at: new Date().toISOString(),
      },
    };
    await client.query(
      `UPDATE consultant_workflow_session SET current_state='workflow_failed',
         last_checkpoint='user_cancelled',
         workflow_metadata=COALESCE(workflow_metadata,'{}'::jsonb) || $4::jsonb,
         updated_at=clock_timestamp()
       WHERE account_id=$1 AND run_id=$2 AND execution_id=$3`,
      [accountId, runId, executionId, JSON.stringify(metadata)],
    );
    await appendConsultantWorkflowEvent(client, stoppedJob, "user_cancelled", {
      state: "completed",
      message: "User stopped research; execution lease revoked.",
      activity: "MB-UX-LIVE-001 L09",
    });
    return "stopped";
  });
}

export type ConsultantJobStage = "prepare" | "research";
export interface ConsultantWorkflowIdentity {
  account_id: string;
  user_profile_id: string;
  run_id: string;
  execution_id: string;
  classification_id: string;
}
export interface ConsultantWorkflowJob extends ConsultantWorkflowIdentity {
  job_id: string;
  stage: ConsultantJobStage;
  mode: "live" | "demonstration" | "hybrid";
  status: "queued" | "running" | "completed" | "failed";
  lease_token: string | null;
}

export async function enqueueConsultantWorkflowJob(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  stage: ConsultantJobStage,
  mode: ConsultantWorkflowJob["mode"],
): Promise<ConsultantWorkflowJob> {
  const result = await db.query<ConsultantWorkflowJob>(
    `INSERT INTO consultant_workflow_job
      (job_id, account_id, user_profile_id, run_id, execution_id, classification_id, stage, mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING RETURNING *`,
    [
      randomUUID(),
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      stage,
      mode,
    ],
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await db.query<ConsultantWorkflowJob>(
    `SELECT * FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2
      AND ((execution_id=$3 AND stage=$4) OR status IN ('queued','running'))
      ORDER BY CASE WHEN execution_id=$3 AND stage=$4 THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    [identity.account_id, identity.run_id, identity.execution_id, stage],
  );
  if (!existing.rows[0]) throw new Error("Workflow job could not be queued.");
  return existing.rows[0];
}

/** An atomic claim prevents HTTP retries or multiple workers making duplicate provider calls. */
export async function claimConsultantWorkflowJob(
  db: Queryable,
  jobId?: string,
): Promise<ConsultantWorkflowJob | null> {
  const result = await db.query<ConsultantWorkflowJob>(
    `UPDATE consultant_workflow_job SET status='running', lease_token=$1,
      lease_until=clock_timestamp()+interval '90 seconds', started_at=clock_timestamp()
     WHERE job_id=(SELECT job_id FROM consultant_workflow_job WHERE status='queued'
       AND ($2::uuid IS NULL OR job_id=$2) ORDER BY created_at
       FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    [randomUUID(), jobId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function renewConsultantWorkflowJobLease(
  db: Queryable,
  job: ConsultantWorkflowJob,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE consultant_workflow_job SET lease_until=clock_timestamp()+interval '90 seconds'
     WHERE job_id=$1 AND lease_token=$2 AND status='running'
       AND lease_until>clock_timestamp()
       AND EXISTS (SELECT 1 FROM consultant_workflow_session s
         WHERE s.account_id=consultant_workflow_job.account_id
           AND s.run_id=consultant_workflow_job.run_id
           AND s.execution_id=consultant_workflow_job.execution_id
           AND NOT s.is_invalidated) RETURNING job_id`,
    [job.job_id, job.lease_token],
  );
  return result.rows.length === 1;
}

export async function finishConsultantWorkflowJob(
  db: Queryable,
  job: ConsultantWorkflowJob,
  errorCode?: string,
): Promise<void> {
  await db.query(
    `UPDATE consultant_workflow_job SET status=$3, error_code=$4,
      completed_at=clock_timestamp(), lease_until=NULL
     WHERE job_id=$1 AND lease_token=$2 AND status='running'`,
    [
      job.job_id,
      job.lease_token,
      errorCode ? "failed" : "completed",
      errorCode ?? null,
    ],
  );
}

/** Interrupted executions require an explicit retry: never silently repeat paid research. */
export async function failExpiredConsultantWorkflowJobs(
  db: Queryable,
): Promise<void> {
  await db.query(`WITH expired AS (
    UPDATE consultant_workflow_job j SET
      status=CASE WHEN
        (j.stage='research' AND EXISTS (SELECT 1 FROM consultant_output_v3 o
          WHERE o.account_id=j.account_id AND o.run_id=j.run_id AND o.execution_id=j.execution_id))
        OR (j.stage='prepare' AND EXISTS (SELECT 1 FROM consultant_workflow_session s
          WHERE s.account_id=j.account_id AND s.run_id=j.run_id AND s.execution_id=j.execution_id
            AND s.deep_prompt_revision IS NOT NULL AND s.current_state IN
              ('prep_step3_prompt_awaiting_approval','prep_step3_prompt_approved','research_dispatching','progressive_reveal_ready','workflow_complete')))
        THEN 'completed' ELSE 'failed' END,
      error_code='execution-interrupted', completed_at=clock_timestamp(), lease_until=NULL
    WHERE j.status='running' AND j.lease_until<clock_timestamp() RETURNING *
  ) UPDATE consultant_workflow_session s SET current_state='workflow_failed',
      workflow_metadata=s.workflow_metadata || jsonb_build_object(
        'error','The research worker was interrupted. Your approved request is saved. Retry to start a new execution.',
        'retry_action', e.stage), updated_at=clock_timestamp()
    FROM expired e WHERE e.status='failed' AND s.account_id=e.account_id AND s.run_id=e.run_id
      AND s.execution_id=e.execution_id AND NOT s.is_invalidated`);
}

export async function appendConsultantWorkflowEvent(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  phase: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO consultant_workflow_event
      (account_id,user_profile_id,run_id,execution_id,classification_id,phase,detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      phase,
      JSON.stringify(detail),
    ],
  );
}

/** Public activity summary excludes prompts, raw model output, costs and source content. */
export async function getConsultantWorkflowActivity(
  db: Queryable,
  accountId: string,
  runId: string,
  executionId: string,
) {
  const result = await db.query<{
    phase: string;
    loop: number;
    started: number;
    completed: number;
    failed: number;
    updated_at: Date;
  }>(
    `SELECT phase, COALESCE((detail->>'loop')::int,0) AS loop,
      count(*) FILTER (WHERE detail->>'state'='started')::int AS started,
      count(*) FILTER (WHERE detail->>'state'='completed')::int AS completed,
      count(*) FILTER (WHERE detail->>'state'='failed')::int AS failed,
      max(created_at) AS updated_at
    FROM consultant_workflow_event
    WHERE account_id=$1 AND run_id=$2 AND execution_id=$3 AND detail->>'state' IS NOT NULL
    GROUP BY phase, COALESCE((detail->>'loop')::int,0)
    ORDER BY min(created_at)`,
    [accountId, runId, executionId],
  );
  return result.rows.map((row) => ({
    ...row,
    updated_at: row.updated_at.toISOString(),
  }));
}

export async function listConsultantResearchSummaries(
  db: Queryable,
  accountId: string,
) {
  const result = await db.query<{
    run_id: string;
    state: string;
    title: string;
    updated_at: Date;
    mode: string;
    result_available: boolean;
    stopped_by_user: boolean;
  }>(
    `SELECT s.run_id, s.current_state AS state,
      COALESCE(s.original_intake->>'product_requirement', s.original_intake->>'productRequirement', '') AS title,
      s.updated_at, COALESCE(s.workflow_metadata->>'mode','unknown') AS mode,
      EXISTS(SELECT 1 FROM consultant_output_v3 o WHERE o.account_id=s.account_id AND o.run_id=s.run_id AND o.execution_id=s.execution_id) AS result_available,
      s.last_checkpoint IS NOT DISTINCT FROM 'user_cancelled' AS stopped_by_user
    FROM consultant_workflow_session s WHERE s.account_id=$1 AND NOT s.is_invalidated
    ORDER BY s.updated_at DESC LIMIT 100`,
    [accountId],
  );
  return result.rows.map((row) => ({
    ...row,
    updated_at: row.updated_at.toISOString(),
  }));
}
