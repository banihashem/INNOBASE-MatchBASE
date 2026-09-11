import { createHash } from "node:crypto";
import { inTransaction, type ConnectionPool } from "./database.js";
import {
  ResearchRoundFault,
  readConsultantCostEvents,
  type ResearchRoundRecord,
} from "./consultant-research-rounds.js";
import {
  appendConsultantWorkflowEvent,
  type ConsultantWorkflowIdentity,
  type ConsultantWorkflowJob,
} from "./consultant-workflow-jobs.js";
import type { ConsultantWorkflowSessionRecord } from "./v3-repository.js";

type CallEvent = { phase: string; detail: Record<string, unknown> };

/** Count dispatch identities, not their started/failed/completed audit duplicates. */
export function summarizeResearchExecutionAllowance(
  events: readonly CallEvent[],
) {
  const requests = new Map<string, { phase: string; consumed: boolean }>();
  for (const { phase, detail } of events) {
    if (
      detail.model === "http-primary-source" ||
      typeof detail.request_id !== "string"
    )
      continue;
    const existing = requests.get(detail.request_id);
    if (existing && existing.phase !== phase)
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-ALLOWANCE",
        "Saved request phases conflict. No provider request was sent.",
      );
    requests.set(detail.request_id, {
      phase,
      // Missing dispatch accounting is unknown consumption, never a fresh allowance.
      consumed: Boolean(
        existing?.consumed ||
        detail.dispatched !== false ||
        detail.provider_generation_id,
      ),
    });
  }
  const consumed = [...requests.entries()].filter(
    ([, request]) => request.consumed,
  );
  return {
    consumed_provider_calls: consumed.length,
    consumed_focus_attempts: consumed.filter(
      ([, request]) => request.phase === "research_focus_analysis",
    ).length,
    consumed_request_ids: consumed.map(([id]) => id).sort(),
  };
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function reject(message: string): never {
  throw new ResearchRoundFault(409, "MB-409-FOCUS-RECOVERY", message);
}

/**
 * Operator-only recovery of a truncated focus analysis before downstream research.
 * Dry-run is the default. Execute requires the snapshot hash from a reviewed dry-run.
 * No approval, plan, provider route, source evidence or execution identity is changed.
 */
export async function recoverApprovedFocusStage(
  pool: ConnectionPool,
  identity: ConsultantWorkflowIdentity & { round_id: string },
  options: { execute?: boolean; expected_snapshot_hash?: string } = {},
) {
  return inTransaction(pool, async (db) => {
    const sessions = await db.query<ConsultantWorkflowSessionRecord>(
      `SELECT * FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
      [identity.account_id, identity.run_id],
    );
    const session = sessions.rows[0];
    if (
      !session ||
      session.is_invalidated ||
      session.user_profile_id !== identity.user_profile_id ||
      session.execution_id !== identity.execution_id ||
      session.current_state !== "workflow_failed" ||
      session.workflow_metadata?.stopped_by_user === true ||
      session.last_checkpoint === "user_cancelled" ||
      (session.classification?.classification_id ??
        session.workflow_metadata?.classification_id) !==
        identity.classification_id
    )
      reject(
        "The stopped execution does not match the supplied owner and current request.",
      );
    const allRounds = await db.query<ResearchRoundRecord>(
      `SELECT * FROM consultant_research_round WHERE account_id=$1 AND run_id=$2 ORDER BY created_at,round_id FOR UPDATE`,
      [identity.account_id, identity.run_id],
    );
    const round = allRounds.rows.find(
      (item) => item.round_id === identity.round_id,
    );
    if (
      !round ||
      round.execution_id !== identity.execution_id ||
      round.status !== "failed" ||
      round.user_profile_id !== identity.user_profile_id ||
      round.classification_id !== identity.classification_id ||
      !round.approved_at ||
      round.output ||
      round.continuation ||
      round.round_number < 2 ||
      round.round_number > 5 ||
      round.plan.round_number !== round.round_number ||
      round.plan.focus_analysis_required !== true ||
      round.plan.mode !== "live" ||
      session.workflow_metadata?.mode !== "live"
    )
      reject(
        "Only the current approved live round stopped before focused research is eligible.",
      );
    if (allRounds.rows.at(-1)?.round_id !== round.round_id)
      reject("A later quote or round exists. Recovery cannot supersede it.");
    const parent = allRounds.rows.find(
      (item) => item.round_id === round.plan.parent_round_id,
    );
    if (
      !parent ||
      parent.status !== "completed" ||
      !parent.output ||
      !parent.continuation ||
      parent.user_profile_id !== identity.user_profile_id ||
      parent.classification_id !== identity.classification_id ||
      parent.round_number !== round.round_number - 1 ||
      !Array.isArray(parent.continuation.indexed_leads) ||
      allRounds.rows.some(
        (item) =>
          item.status === "completed" &&
          item.round_number >= round.round_number,
      )
    )
      reject(
        "The completed parent checkpoint is unavailable or is no longer current.",
      );
    const sourceHash = hash([
      session.approved_request_revision,
      session.deep_prompt_revision,
    ]);
    if (
      !session.deep_prompt_revision?.is_approved ||
      !session.approved_request_revision ||
      round.plan.request_hash !== sourceHash ||
      parent.plan.request_hash !== sourceHash ||
      !session.approvals?.some((approval) => approval.step === "step1") ||
      !session.approvals?.some((approval) => approval.step === "step3")
    )
      reject(
        "The original approved source no longer matches the approved round.",
      );
    const jobs = await db.query<
      ConsultantWorkflowJob & {
        error_code: string | null;
        retained_record: Record<string, unknown>;
      }
    >(
      `SELECT j.*,to_jsonb(j) AS retained_record FROM consultant_workflow_job j WHERE account_id=$1 AND run_id=$2 FOR UPDATE`,
      [identity.account_id, identity.run_id],
    );
    const matchingJobs = jobs.rows.filter(
      (job) => job.execution_id === identity.execution_id,
    );
    const job = matchingJobs[0];
    if (
      jobs.rows.some(
        (item) => item.status === "queued" || item.status === "running",
      ) ||
      matchingJobs.length !== 1 ||
      !job ||
      job.stage !== "research" ||
      job.status !== "failed" ||
      job.error_code !== "workflow-execution-failed" ||
      job.user_profile_id !== identity.user_profile_id ||
      job.classification_id !== identity.classification_id ||
      job.mode !== round.plan.mode
    )
      reject(
        "The failed job is not idle or does not match the approved execution.",
      );
    const events = await db.query<
      CallEvent & {
        event_id: string;
        user_profile_id: string;
        classification_id: string;
      }
    >(
      `SELECT event_id,phase,detail,user_profile_id,classification_id FROM consultant_workflow_event
       WHERE account_id=$1 AND run_id=$2 AND execution_id=$3 ORDER BY event_id`,
      [identity.account_id, identity.run_id, identity.execution_id],
    );
    const lastFailure = events.rows
      .filter((event) => event.phase === "failed")
      .at(-1);
    if (
      lastFailure?.detail.code !== "MB-422-LIVE-OUTPUT-LIMIT" ||
      lastFailure.detail.stage !== "research" ||
      events.rows.some(
        (event) =>
          event.user_profile_id !== identity.user_profile_id ||
          event.classification_id !== identity.classification_id ||
          ![
            "discovery",
            "research_focus_analysis",
            "research_focus_analysis_validation",
            "research_focus_recovery",
            "failed",
          ].includes(event.phase),
      )
    )
      reject(
        "The retained failure is not an isolated focus-analysis output limit.",
      );
    const calls = (
      await readConsultantCostEvents(db, identity.account_id, identity.run_id)
    )
      .filter((event) => event.execution_id === identity.execution_id)
      .sort(
        (a, b) =>
          String(a.detail.request_id).localeCompare(
            String(b.detail.request_id),
          ) || JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
    const mismatchedCalls = await db.query(
      `SELECT request_id FROM consultant_provider_call WHERE account_id=$1 AND run_id=$2 AND execution_id=$3
       AND (user_profile_id<>$4 OR classification_id<>$5)`,
      [
        identity.account_id,
        identity.run_id,
        identity.execution_id,
        identity.user_profile_id,
        identity.classification_id,
      ],
    );
    if (mismatchedCalls.rows.length)
      reject("Retained provider-call ownership is inconsistent.");
    if (
      !calls.length ||
      calls.some((call) => call.phase !== "research_focus_analysis")
    )
      reject(
        "Downstream or unrecognized provider work prevents this narrow recovery.",
      );
    const allowance = summarizeResearchExecutionAllowance(calls);
    const attempts = round.plan.automatic_recovery_attempts ?? 1;
    if (
      !Number.isSafeInteger(attempts) ||
      attempts < 1 ||
      attempts > 3 ||
      !Number.isSafeInteger(round.plan.max_calls) ||
      round.plan.max_calls < 2 ||
      !Number.isSafeInteger(round.plan.max_output_tokens_per_call) ||
      round.plan.max_output_tokens_per_call < 1 ||
      allowance.consumed_focus_attempts < 1 ||
      allowance.consumed_focus_attempts >= attempts ||
      allowance.consumed_provider_calls >= round.plan.max_calls - 1 ||
      calls.some(
        (call) =>
          call.detail.state !== "failed" && call.detail.state !== "completed",
      )
    )
      reject(
        "The original approval has no safely reusable focus-attempt allowance.",
      );
    const snapshotHash = hash({
      session,
      round,
      parent,
      job,
      events: events.rows,
      calls,
    });
    const result = {
      ...identity,
      eligible: true,
      executed: options.execute === true,
      snapshot_hash: snapshotHash,
      approved_source_hash: sourceHash,
      parent_round_id: parent.round_id,
      parent_checkpoint_hash: hash([parent.output, parent.continuation]),
      ...allowance,
      remaining_focus_attempts: attempts - allowance.consumed_focus_attempts,
      remaining_provider_calls:
        round.plan.max_calls - allowance.consumed_provider_calls,
      max_output_tokens_per_call: round.plan.max_output_tokens_per_call,
      job_id: job.job_id,
    };
    if (!options.execute) return result;
    if (options.expected_snapshot_hash !== snapshotHash)
      reject(
        "The reviewed recovery snapshot changed. Run a fresh dry-run before execution.",
      );
    // Preserve the complete prior failed job and session status before clearing scheduling fields.
    await appendConsultantWorkflowEvent(
      db,
      identity,
      "research_focus_recovery",
      {
        ...result,
        activity: "MB-UX-QUALITY-001 L05",
        recovery_kind: "approved_focus_output_limit",
        previous_job: job.retained_record,
        previous_status: {
          current_state: session.current_state,
          last_checkpoint: session.last_checkpoint,
          workflow_metadata: session.workflow_metadata,
        },
        approved_plan_hash: hash(round.plan),
        approvals_hash: hash(session.approvals),
        approval_changed: false,
        inference_dispatched_by_recovery: false,
        message:
          "Requeued the same approved execution with prior dispatches and focus attempts deducted. No new round or approval was created.",
      },
    );
    await db.query(
      `UPDATE consultant_research_round SET status='approved',completed_at=NULL WHERE round_id=$1`,
      [round.round_id],
    );
    await db.query(
      `UPDATE consultant_workflow_job SET status='queued',lease_token=NULL,lease_until=NULL,
      started_at=NULL,completed_at=NULL,error_code=NULL WHERE job_id=$1`,
      [job.job_id],
    );
    await db.query(
      `UPDATE consultant_workflow_session SET current_state='research_dispatching',last_checkpoint='queued',
      workflow_metadata=(workflow_metadata-'error') || $3::jsonb,updated_at=clock_timestamp() WHERE account_id=$1 AND run_id=$2`,
      [
        identity.account_id,
        identity.run_id,
        JSON.stringify({
          retry_action: "research",
          progress: {
            phase: "queued",
            loop: round.round_number,
            max_loops: round.round_number,
            message: `Resuming approved round ${round.round_number}. Previous results, costs and approvals are retained.`,
            updated_at: new Date().toISOString(),
          },
          focus_recovery: { snapshot_hash: snapshotHash, ...allowance },
        }),
      ],
    );
    return result;
  });
}
