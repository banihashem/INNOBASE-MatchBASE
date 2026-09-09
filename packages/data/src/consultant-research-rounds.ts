import { createHash, randomUUID } from "node:crypto";
import type {
  ResearchRoundPlan,
  ResearchRoundView,
} from "@matchbase/contracts";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "./database.js";
import {
  enqueueConsultantWorkflowJob,
  type ConsultantWorkflowIdentity,
} from "./consultant-workflow-jobs.js";

export interface ResearchRoundRecord extends ResearchRoundView {
  account_id: string;
  run_id: string;
  output: Record<string, unknown> | null;
  continuation: Record<string, unknown> | null;
}
export class ResearchRoundFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const conflict = (message: string): never => {
  throw new ResearchRoundFault(409, "MB-409-ROUND-APPROVAL", message);
};

export async function settleResearchRounds(
  db: Queryable,
  accountId: string,
  runId: string,
) {
  await db.query(
    `UPDATE consultant_research_round r SET
    status=CASE WHEN j.error_code='user-cancelled' THEN 'cancelled' ELSE 'failed' END,
    completed_at=COALESCE(j.completed_at,clock_timestamp())
    FROM consultant_workflow_job j WHERE r.account_id=$1 AND r.run_id=$2
      AND r.execution_id=j.execution_id AND j.stage='research' AND j.status='failed' AND r.status='approved'`,
    [accountId, runId],
  );
}
export async function listResearchRounds(
  db: Queryable,
  accountId: string,
  runId: string,
): Promise<ResearchRoundRecord[]> {
  await settleResearchRounds(db, accountId, runId);
  const result = await db.query<ResearchRoundRecord>(
    `SELECT *, (output IS NOT NULL) AS output_available,
    CASE WHEN output IS NULL THEN NULL ELSE jsonb_array_length(output->'supplier_candidates') END AS candidate_count
    FROM consultant_research_round WHERE account_id=$1 AND run_id=$2 ORDER BY created_at,round_id`,
    [accountId, runId],
  );
  return result.rows;
}
export async function getResearchRoundForExecution(
  db: Queryable,
  accountId: string,
  executionId: string,
): Promise<ResearchRoundRecord | null> {
  const rows = await db.query<ResearchRoundRecord>(
    `SELECT * FROM consultant_research_round WHERE account_id=$1 AND execution_id=$2`,
    [accountId, executionId],
  );
  return rows.rows[0] ?? null;
}
export async function saveResearchQuote(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  plan: ResearchRoundPlan,
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.classification_id,
      plan.round_number,
      JSON.stringify(plan),
    ],
  );
  return id;
}

/** The session lock serializes consent, competing tabs, stop and publication. */
export async function approveResearchQuote(
  pool: ConnectionPool,
  accountId: string,
  userId: string,
  runId: string,
  quoteId: string,
  currentHash: string,
) {
  return inTransaction(pool, async (db) => {
    const sessions = await db.query(
      `SELECT * FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
      [accountId, runId],
    );
    const session = sessions.rows[0];
    if (
      !session ||
      session.user_profile_id !== userId ||
      session.is_invalidated
    )
      throw new ResearchRoundFault(404, "MB-404-ROUND", "Research not found.");
    const quotes = await db.query<ResearchRoundRecord>(
      `SELECT * FROM consultant_research_round WHERE round_id=$1 AND account_id=$2 AND run_id=$3 FOR UPDATE`,
      [quoteId, accountId, runId],
    );
    const quote = quotes.rows[0];
    if (!quote)
      throw new ResearchRoundFault(
        404,
        "MB-404-ROUND",
        "Research quote not found.",
      );
    if (quote.status === "approved" || quote.status === "completed") {
      const jobs = await db.query(
        `SELECT job_id,status FROM consultant_workflow_job WHERE account_id=$1 AND execution_id=$2 AND stage='research'`,
        [accountId, quote.execution_id],
      );
      return {
        round_id: quoteId,
        execution_id: quote.execution_id,
        job: jobs.rows[0],
        replayed: true,
      };
    }
    if (quote.status !== "proposed")
      conflict("This attempt ended. Review a fresh quote before trying again.");
    if (new Date(quote.plan.expires_at).getTime() <= Date.now())
      conflict("This estimate expired. Refresh the estimate before approving.");
    const lockedHash = createHash("sha256")
      .update(
        JSON.stringify([
          session.approved_request_revision,
          session.deep_prompt_revision,
        ]),
      )
      .digest("hex");
    if (
      quote.plan.request_hash !== lockedHash ||
      currentHash !== lockedHash ||
      !session.deep_prompt_revision?.is_approved
    )
      conflict("The approved request changed. Refresh the estimate.");
    const active = await db.query(
      `SELECT job_id FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2 AND status IN ('queued','running')`,
      [accountId, runId],
    );
    if (active.rows.length)
      conflict("A research or preparation stage is already running.");
    const completed = await db.query<{
      round_id: string;
      round_number: number;
    }>(
      `SELECT round_id,round_number FROM consultant_research_round WHERE account_id=$1 AND run_id=$2 AND status='completed' ORDER BY round_number DESC LIMIT 1`,
      [accountId, runId],
    );
    const parent = completed.rows[0];
    if (
      (parent?.round_id ?? null) !== quote.plan.parent_round_id ||
      quote.round_number !== (parent?.round_number ?? 0) + 1
    )
      conflict(
        "Newer round results are available. Review an updated estimate.",
      );
    await settleResearchRounds(db, accountId, runId);
    const executionId = randomUUID();
    await db.query(
      `UPDATE consultant_research_round SET status='approved',execution_id=$2,approved_at=clock_timestamp() WHERE round_id=$1`,
      [quoteId, executionId],
    );
    const metadata = {
      ...session.workflow_metadata,
      round_id: quoteId,
      round_number: quote.round_number,
      error: null,
      retry_action: "research",
      stopped_by_user: false,
      progress: {
        phase: "queued",
        loop: quote.round_number,
        max_loops: quote.round_number,
        message: `Approved round ${quote.round_number} is queued. No later round will start automatically.`,
        updated_at: new Date().toISOString(),
      },
    };
    await db.query(
      `UPDATE consultant_workflow_session SET execution_id=$3,current_state='research_dispatching',last_checkpoint='queued',workflow_metadata=$4,updated_at=clock_timestamp() WHERE account_id=$1 AND run_id=$2`,
      [accountId, runId, executionId, JSON.stringify(metadata)],
    );
    const job = await enqueueConsultantWorkflowJob(
      db,
      {
        account_id: accountId,
        user_profile_id: userId,
        run_id: runId,
        classification_id:
          session.classification?.classification_id ??
          metadata.classification_id,
        execution_id: executionId,
      },
      "research",
      quote.plan.mode,
    );
    if (job.execution_id !== executionId)
      conflict("A competing execution already owns this request.");
    return {
      round_id: quoteId,
      execution_id: executionId,
      job,
      replayed: false,
    };
  });
}
export async function completeResearchRound(
  db: Queryable,
  accountId: string,
  executionId: string,
  output: unknown,
  continuation: unknown,
) {
  const result = await db.query(
    `UPDATE consultant_research_round SET status='completed',output=$3,continuation=$4,completed_at=clock_timestamp()
    WHERE account_id=$1 AND execution_id=$2 AND status='approved' RETURNING round_id`,
    [
      accountId,
      executionId,
      JSON.stringify(output),
      JSON.stringify(continuation ?? null),
    ],
  );
  if (result.rows.length !== 1)
    conflict("This research round no longer permits publication.");
}

/** Accounting persists independently of execution leases, including late/cancelled responses. */
export async function recordConsultantProviderCall(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  event: Record<string, unknown>,
) {
  if (
    typeof event.request_id !== "string" ||
    !event.model ||
    event.model === "http-primary-source"
  )
    return;
  const fields = [
    "request_id",
    "provider_generation_id",
    "state",
    "model",
    "requested_model",
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
  ];
  const detail = Object.fromEntries(
    fields
      .filter((key) => event[key] !== undefined)
      .map((key) => [key, event[key]]),
  );
  await db.query(
    `INSERT INTO consultant_provider_call(request_id,account_id,user_profile_id,run_id,execution_id,classification_id,phase,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(request_id) DO UPDATE SET
    detail=CASE WHEN consultant_provider_call.detail->>'state' IN ('completed','failed') AND EXCLUDED.detail->>'state'='started'
      THEN consultant_provider_call.detail ELSE consultant_provider_call.detail || EXCLUDED.detail END,updated_at=clock_timestamp()`,
    [
      event.request_id,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      String(event.phase ?? "research"),
      JSON.stringify(detail),
    ],
  );
}
export async function readConsultantCostEvents(
  db: Queryable,
  accountId: string,
  runId: string,
) {
  const result = await db.query<{
    execution_id: string;
    phase: string;
    detail: Record<string, unknown>;
  }>(
    `SELECT execution_id,phase,detail FROM consultant_provider_call WHERE account_id=$1 AND run_id=$2
    UNION ALL SELECT e.execution_id,e.phase,e.detail FROM consultant_workflow_event e WHERE e.account_id=$1 AND e.run_id=$2
    AND e.detail ? 'request_id' AND e.detail->>'model'<>'http-primary-source'
    AND NOT EXISTS(SELECT 1 FROM consultant_provider_call c WHERE c.request_id::text=e.detail->>'request_id')`,
    [accountId, runId],
  );
  return result.rows;
}
