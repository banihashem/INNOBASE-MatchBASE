import { randomUUID } from "node:crypto";
import { serializeWorkflowEventDetail } from "./workflow-event-json.js";
import { assertResearchOutputRights } from "./consultant-output-rights.js";
import { assertLogicalRequestRunFence } from "./consultant-research-renewal.js";
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
  await assertLogicalRequestRunFence(db, accountId, runId);
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
    await assertLogicalRequestRunFence(client, accountId, runId);
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
  resume_count?: number;
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
      lease_until=clock_timestamp()+interval '90 seconds', started_at=COALESCE(started_at,clock_timestamp())
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

/** New approvals may opt into bounded same-execution recovery; legacy approvals never do. */
export async function failExpiredConsultantWorkflowJobs(
  db: Queryable,
): Promise<void> {
  // Materialized session locks precede job locks, matching cancellation/publication.
  await db.query(`WITH locked_sessions AS MATERIALIZED (
    SELECT s.* FROM consultant_workflow_session s WHERE EXISTS (
      SELECT 1 FROM consultant_workflow_job j WHERE j.account_id=s.account_id AND j.run_id=s.run_id
        AND j.status='running' AND j.lease_until<clock_timestamp())
      ORDER BY s.run_id FOR UPDATE OF s SKIP LOCKED LIMIT 25
  ), locked_jobs AS MATERIALIZED (
    SELECT j.job_id FROM consultant_workflow_job j JOIN locked_sessions s
      ON s.account_id=j.account_id AND s.run_id=j.run_id
      WHERE j.status='running' AND j.lease_until<clock_timestamp()
      ORDER BY j.job_id FOR UPDATE OF j
  ), recoverable AS MATERIALIZED (
    SELECT j.job_id FROM consultant_workflow_job j JOIN locked_jobs l ON l.job_id=j.job_id
      JOIN locked_sessions s ON s.account_id=j.account_id AND s.run_id=j.run_id
      JOIN consultant_research_round r ON r.account_id=j.account_id AND r.execution_id=j.execution_id
      WHERE j.stage='research' AND s.execution_id=j.execution_id AND NOT s.is_invalidated
        AND s.last_checkpoint IS DISTINCT FROM 'user_cancelled'
        AND s.user_profile_id=j.user_profile_id AND r.user_profile_id=j.user_profile_id
        AND r.classification_id=j.classification_id AND r.status='approved'
        AND COALESCE(s.classification->>'classification_id',s.workflow_metadata->>'classification_id')=j.classification_id::text
        AND r.plan->'execution_recovery'->>'version'='durable.v1'
        AND j.resume_count<LEAST(2,(r.plan->'execution_recovery'->>'max_resumes')::integer)
        AND r.approved_at+LEAST(86400000,(r.plan->'execution_recovery'->>'valid_for_ms')::bigint)*interval '1 millisecond'>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM consultant_research_attempt a WHERE a.account_id=j.account_id
          AND a.execution_id=j.execution_id AND a.provider_outcome='unknown' AND a.outcome<>'not_dispatched')
        AND NOT EXISTS(SELECT 1 FROM consultant_provider_call c WHERE c.account_id=j.account_id AND c.execution_id=j.execution_id
          AND c.detail->>'dispatched' IS DISTINCT FROM 'false'
          AND NOT EXISTS(SELECT 1 FROM consultant_research_attempt a WHERE a.request_id=c.request_id))
        AND (SELECT count(*) FROM consultant_research_attempt a WHERE a.account_id=j.account_id
          AND a.execution_id=j.execution_id AND a.outcome<>'not_dispatched')<(r.plan->>'max_calls')::integer
  ), expired AS (
    UPDATE consultant_workflow_job j SET
      status=CASE WHEN
        (j.stage='research' AND EXISTS (SELECT 1 FROM consultant_output_v3 o
          WHERE o.account_id=j.account_id AND o.run_id=j.run_id AND o.execution_id=j.execution_id))
        OR (j.stage='prepare' AND EXISTS (SELECT 1 FROM consultant_workflow_session s
          WHERE s.account_id=j.account_id AND s.run_id=j.run_id AND s.execution_id=j.execution_id
            AND s.deep_prompt_revision IS NOT NULL AND s.current_state IN
              ('prep_step3_prompt_awaiting_approval','prep_step3_prompt_approved','research_dispatching','progressive_reveal_ready','workflow_complete')))
        THEN 'completed'
        WHEN EXISTS(SELECT 1 FROM recoverable r WHERE r.job_id=j.job_id) THEN 'queued' ELSE 'failed' END,
      resume_count=j.resume_count+CASE WHEN EXISTS(SELECT 1 FROM recoverable r WHERE r.job_id=j.job_id) THEN 1 ELSE 0 END,
      error_code='execution-interrupted', completed_at=CASE WHEN EXISTS(SELECT 1 FROM recoverable r WHERE r.job_id=j.job_id)
        THEN NULL ELSE clock_timestamp() END, lease_until=NULL,lease_token=NULL
    FROM locked_jobs l WHERE j.job_id=l.job_id AND j.status='running' AND j.lease_until<clock_timestamp() RETURNING j.*
  ) UPDATE consultant_workflow_session s SET
      current_state=CASE WHEN e.status='queued' THEN 'research_dispatching' ELSE 'workflow_failed' END,
      workflow_metadata=s.workflow_metadata || CASE WHEN e.status='queued' THEN jsonb_build_object(
        'error',NULL,'retry_action',NULL,'recovery_state','resuming_saved_stages',
        'progress',jsonb_build_object('phase','resuming_saved_stages','loop',0,'max_loops',1,
          'message','Worker interrupted. Resuming eligible saved stages within your approved allowance.',
          'updated_at',clock_timestamp())) ELSE jsonb_build_object(
        'error','The research worker was interrupted. Saved results and possible provider charges are retained. Review before retrying.',
        'retry_action', e.stage,'recovery_state','review_required') END, updated_at=clock_timestamp()
    FROM expired e WHERE e.status IN ('failed','queued') AND s.account_id=e.account_id AND s.run_id=e.run_id
      AND s.execution_id=e.execution_id AND NOT s.is_invalidated AND s.last_checkpoint IS DISTINCT FROM 'user_cancelled'`);
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
      serializeWorkflowEventDetail(detail),
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
  userProfileId?: string,
) {
  const result = await db.query<{
    run_id: string;
    state: string;
    title: string;
    updated_at: Date;
    mode: string;
    result_available: boolean;
    stopped_by_user: boolean;
    user_profile_id: string;
    execution_id: string | null;
    classification_id: string | null;
  }>(
    `SELECT s.run_id, s.user_profile_id,s.execution_id,
      COALESCE(s.classification->>'classification_id',s.workflow_metadata->>'classification_id') AS classification_id,s.current_state AS state,
      COALESCE(s.original_intake->>'product_requirement', s.original_intake->>'productRequirement', '') AS title,
      s.updated_at, COALESCE(s.workflow_metadata->>'mode','unknown') AS mode,
      EXISTS(SELECT 1 FROM consultant_output_v3 o WHERE o.account_id=s.account_id AND o.run_id=s.run_id AND o.execution_id=s.execution_id) AS result_available,
      s.last_checkpoint IS NOT DISTINCT FROM 'user_cancelled' AS stopped_by_user
    FROM consultant_workflow_session s WHERE s.account_id=$1 AND ($2::uuid IS NULL OR s.user_profile_id=$2) AND NOT s.is_invalidated
    ORDER BY s.updated_at DESC LIMIT 100`,
    [accountId, userProfileId ?? null],
  );
  return Promise.all(
    result.rows.map(async (row) => {
      let available = row.result_available;
      if (available && row.execution_id && row.classification_id) {
        try {
          await assertResearchOutputRights(db, {
            account_id: accountId,
            user_profile_id: row.user_profile_id,
            run_id: row.run_id,
            execution_id: row.execution_id,
            classification_id: row.classification_id,
          });
        } catch (error) {
          if ((error as { code?: string }).code !== "MB-409-EVIDENCE-WITHDRAWN")
            throw error;
          available = false;
        }
      }
      return {
        run_id: row.run_id,
        state: row.state,
        title: row.title,
        mode: row.mode,
        result_available: available,
        stopped_by_user: row.stopped_by_user,
        updated_at: row.updated_at.toISOString(),
      };
    }),
  );
}
