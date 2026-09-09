import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";
import { inTransaction, type ConnectionPool } from "./database.js";
import type { ResearchRoundRecord } from "./consultant-research-rounds.js";
import {
  saveConsultantOutputV3,
  type ConsultantWorkflowSessionRecord,
} from "./v3-repository.js";

/** MB-UX-LIVE-001 L15: recover completed batches without changing the failed source execution. */
export async function recoverFailedResearchRound(
  pool: ConnectionPool,
  accountId: string,
  runId: string,
  sourceExecutionId: string,
  build: (
    source: ResearchRoundRecord,
    executionId: string,
    session: ConsultantWorkflowSessionRecord,
    events: readonly {
      phase: string;
      detail: Record<string, unknown>;
      created_at: string | Date;
    }[],
  ) => {
    output: ConsultantResearchOutputV3;
    continuation: unknown;
  },
) {
  return inTransaction(pool, async (db) => {
    const fail = (): never => {
      throw new Error(
        "Saved research is not eligible for local evidence recovery.",
      );
    };
    const sessions = await db.query(
      `SELECT * FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
      [accountId, runId],
    );
    const session = sessions.rows[0];
    if (!session || session.is_invalidated) return fail();
    const existing = await db.query<{
      execution_id: string;
      output: ConsultantResearchOutputV3;
    }>(
      `SELECT execution_id,output FROM consultant_research_round WHERE account_id=$1 AND run_id=$2
       AND plan->>'recovery_source_execution_id'=$3 AND plan->>'recovery_kind'='failed_completed_batches' AND status='completed'`,
      [accountId, runId, sourceExecutionId],
    );
    if (existing.rows[0]) return { ...existing.rows[0], replayed: true };
    if (
      session.execution_id !== sourceExecutionId ||
      session.current_state !== "workflow_failed"
    )
      fail();
    const jobs = await db.query(
      `SELECT 1 FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2 AND status IN ('queued','running')`,
      [accountId, runId],
    );
    if (jobs.rows.length) fail();
    const sources = await db.query<ResearchRoundRecord>(
      `SELECT * FROM consultant_research_round WHERE account_id=$1 AND run_id=$2 AND execution_id=$3 AND status='failed' FOR UPDATE`,
      [accountId, runId, sourceExecutionId],
    );
    const source = sources.rows[0];
    if (
      !source ||
      source.output ||
      !session.approved_request_revision?.canonical_snapshot
    )
      return fail();
    const events = await db.query<{
      phase: string;
      detail: Record<string, unknown>;
      created_at: string | Date;
    }>(
      `SELECT phase,detail,created_at FROM consultant_workflow_event WHERE account_id=$1 AND run_id=$2 AND execution_id=$3 ORDER BY event_id`,
      [accountId, runId, sourceExecutionId],
    );
    const executionId = randomUUID();
    const recovered = build(
      source,
      executionId,
      session as ConsultantWorkflowSessionRecord,
      events.rows,
    );
    const output = recovered.output;
    if (
      output.execution_id !== executionId ||
      output.research_run_id !== runId ||
      output.user_profile_id !== session.user_profile_id ||
      output.classification_id !== session.classification?.classification_id ||
      output.primary_classification.classification_id !==
        output.classification_id ||
      !isDeepStrictEqual(
        output.approved_request_snapshot,
        session.approved_request_revision.canonical_snapshot,
      ) ||
      output.telemetry.total_cost_usd !== 0 ||
      output.telemetry.total_input_tokens !== 0 ||
      output.telemetry.total_output_tokens !== 0 ||
      output.supplier_candidates.length === 0
    )
      fail();
    const now = new Date().toISOString();
    const plan = {
      ...source.plan,
      title: "Recovered saved evidence",
      purpose:
        "Local revalidation of saved source quotations. No new research or provider calls.",
      parent_round_id: source.round_id,
      recovery_source_execution_id: sourceExecutionId,
      recovery_kind: "failed_completed_batches",
      research_models: [],
      extraction_model: "not-executed",
      synthesis_model: "deterministic-evidence-recovery",
      rates: [],
      max_calls: 0,
      max_input_tokens_per_call: 0,
      max_output_tokens_per_call: 0,
      estimated_low_usd: 0,
      estimated_high_usd: 0,
      pricing_checked_at: now,
      expires_at: now,
      assumptions: [
        "USD 0 local reprocessing; original failed execution, approvals and costs remain in history.",
      ],
    };
    await db.query(
      `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,completed_at,output,continuation)
       VALUES($1,$2,$3,$4,$5,$6,$7,'completed',$8,clock_timestamp(),$9,$10)`,
      [
        randomUUID(),
        accountId,
        session.user_profile_id,
        runId,
        output.classification_id,
        source.round_number,
        JSON.stringify(plan),
        executionId,
        JSON.stringify(output),
        JSON.stringify(recovered.continuation),
      ],
    );
    await saveConsultantOutputV3(db, { account_id: accountId, output });
    const progress = {
      phase: "completed",
      loop: source.round_number,
      max_loops: source.round_number,
      message: `${output.supplier_candidates.length} supplier dossiers recovered from saved evidence. No new research or provider cost.`,
      updated_at: now,
    };
    await db.query(
      `UPDATE consultant_workflow_session SET execution_id=$3,current_state='progressive_reveal_ready',last_checkpoint='progressive_reveal_ready',
       workflow_metadata=(COALESCE(workflow_metadata,'{}'::jsonb)-'error') || $4::jsonb,updated_at=clock_timestamp()
       WHERE account_id=$1 AND run_id=$2`,
      [
        accountId,
        runId,
        executionId,
        JSON.stringify({
          progress,
          retry_action: null,
          revealed_count: Math.min(5, output.supplier_candidates.length),
          recovery_source_execution_id: sourceExecutionId,
        }),
      ],
    );
    await db.query(
      `INSERT INTO consultant_workflow_event(account_id,user_profile_id,run_id,execution_id,classification_id,phase,detail)
       VALUES($1,$2,$3,$4,$5,'completed',$6)`,
      [
        accountId,
        session.user_profile_id,
        runId,
        executionId,
        output.classification_id,
        JSON.stringify({
          ...progress,
          state: "completed",
          recovery_source_execution_id: sourceExecutionId,
          cost_usd: 0,
          live_api_invoked: false,
        }),
      ],
    );
    return { execution_id: executionId, output, replayed: false };
  });
}
