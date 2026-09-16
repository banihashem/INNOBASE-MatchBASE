import {
  appendConsultantWorkflowEvent,
  inTransaction,
  recordResearchIncident,
  resumeFailedConsultantResearchExecution,
  safeResearchIncidentCode,
  withBoundedResearchIncidentStore,
  type ConnectionPool,
  type ConsultantWorkflowIdentity,
  type ConsultantWorkflowJob,
  type Queryable,
} from "@matchbase/data";
import {
  researchRecoveryDisposition,
  type ResearchRecoveryDisposition,
} from "./research-recovery-policy.js";

export interface ConsultantIncidentDecision {
  code: string;
  disposition: ResearchRecoveryDisposition;
}

export type ConsultantIncidentRecoveryAction =
  | "resumed_saved_stages"
  | "approval_required"
  | "provider_outcome_review_required"
  | "technical_review_required"
  | "cancelled"
  | "stale";

export function classifyConsultantIncident(
  error: unknown,
  cancelled = false,
  ambiguous = false,
) {
  const fault =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const details = [fault.provider_http_failure, fault.provider_failure].filter(
    (item) => item && typeof item === "object",
  ) as Record<string, unknown>[];
  const restricted = new Set([
    "authentication",
    "billing",
    "permission",
    "privacy",
    "refusal",
  ]);
  const category =
    details.find((item) => restricted.has(String(item.category)))?.category ??
    details.find((item) => [401, 402, 403].includes(Number(item.http_status)))
      ?.http_status;
  const code = typeof fault.code === "string" ? fault.code : "UNCLASSIFIED";
  const disposition = researchRecoveryDisposition({
    code,
    cancelled,
    retryable: fault.retryable === true,
    dispatched: fault.dispatched === true,
    provider_receipt_received: fault.provider_receipt_received === true,
    ...(category
      ? {
          provider_failure_category:
            typeof category === "string" ? category : "permission",
        }
      : {}),
  });
  return {
    code,
    disposition:
      ambiguous && !["cancelled", "blocked_by_authority"].includes(disposition)
        ? ("outcome_unknown" as const)
        : disposition,
  };
}

/** Containment is deterministic. A diagnostic/repair agent cannot change cost or evidence authority. */
export async function retainConsultantIncident(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  stage: "prepare" | "research",
  error: unknown,
  cancelled = false,
): Promise<ConsultantIncidentDecision> {
  let retained: ConsultantIncidentDecision | null = null;
  await withBoundedResearchIncidentStore(db, async (client) => {
    const uncertain = await client.query<{ uncertain: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM consultant_research_attempt
    WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND execution_id=$4 AND classification_id=$5
      AND provider_outcome='unknown' AND outcome<>'not_dispatched') AS uncertain`,
      [
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
      ],
    );
    const { code, disposition } = classifyConsultantIncident(
      error,
      cancelled,
      uncertain.rows[0]?.uncertain === true,
    );
    await recordResearchIncident(client, identity, {
      stage,
      disposition,
      code,
    });
    retained = { code, disposition };
  });
  if (!retained) throw new Error("Research incident was not durably retained.");
  return retained;
}

const recoverableDispositions = new Set<ResearchRecoveryDisposition>([
  "blocked_by_authority",
  "bounded_retry",
  "bounded_content_repair",
]);

function decisionPresentation(decision: ConsultantIncidentDecision): {
  action: Exclude<
    ConsultantIncidentRecoveryAction,
    "resumed_saved_stages" | "cancelled" | "stale"
  >;
  message: string;
} {
  if (decision.disposition === "outcome_unknown")
    return {
      action: "provider_outcome_review_required",
      message:
        "The provider dispatch outcome is uncertain. Automatic replay is blocked to prevent duplicate cost. Saved results and accounting evidence remain available for review.",
    };
  if (decision.disposition === "incident_required")
    return {
      action: "technical_review_required",
      message:
        "The incident was contained and recorded. It does not match an authorized automatic recovery playbook, so no provider request was repeated.",
    };
  return {
    action: "approval_required",
    message:
      "Automatic recovery checked the saved stages and approved allowance. This execution cannot continue safely. Review a current cost estimate below; completed round results remain available.",
  };
}

/**
 * Operational incident edge: reuse a strictly eligible saved execution or
 * publish the exact safe next action. It cannot widen cost, model, evidence or
 * dispatch authority and never treats diagnosis as release authorization.
 */
export async function applyConsultantIncidentRecovery(
  db: Queryable,
  job: ConsultantWorkflowJob,
  stage: "prepare" | "research",
  decision: ConsultantIncidentDecision,
): Promise<ConsultantIncidentRecoveryAction> {
  if (stage !== "research" || decision.disposition === "cancelled")
    return "cancelled";

  if (recoverableDispositions.has(decision.disposition) && "connect" in db) {
    try {
      const resumed = await resumeFailedConsultantResearchExecution(
        db as ConnectionPool,
        job.account_id,
        job.run_id,
        job.execution_id,
        true,
      );
      if (resumed.queued) return "resumed_saved_stages";
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        (error as { code?: string }).code !== "MB-409-EXECUTION-RESUME"
      )
        throw error;
    }
  }

  const presentation = decisionPresentation(decision);
  const faultCode = safeResearchIncidentCode(decision.code);
  const persist = async (client: Queryable) => {
    const updated = await client.query(
      `UPDATE consultant_workflow_session SET
         last_checkpoint=$6::text,
         workflow_metadata=(COALESCE(workflow_metadata,'{}'::jsonb)-'progress') ||
           jsonb_build_object(
             'retry_action','research',
              'recovery_state',$6::text,
             'progress',jsonb_build_object(
                'phase',$6::text,'loop',0,'max_loops',1,'message',$7::text,
               'updated_at',clock_timestamp()
             )
           ),
         updated_at=clock_timestamp()
       WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3
         AND execution_id=$4 AND
         COALESCE(classification->>'classification_id',workflow_metadata->>'classification_id')=$5::text
         AND current_state='workflow_failed' AND last_checkpoint IS DISTINCT FROM 'user_cancelled'
       RETURNING run_id`,
      [
        job.account_id,
        job.user_profile_id,
        job.run_id,
        job.execution_id,
        job.classification_id,
        presentation.action,
        presentation.message,
      ],
    );
    if (!updated.rows.length) return false;
    await appendConsultantWorkflowEvent(
      client,
      job,
      "incident_recovery_decision",
      {
        state: "completed",
        action: presentation.action,
        disposition: decision.disposition,
        fault_code: faultCode,
        message: presentation.message,
        activity: "MB-UX-QUALITY-001 L19",
      },
    );
    return true;
  };
  const updated =
    "connect" in db
      ? await inTransaction(db as ConnectionPool, persist)
      : await persist(db);
  return updated ? presentation.action : "stale";
}
