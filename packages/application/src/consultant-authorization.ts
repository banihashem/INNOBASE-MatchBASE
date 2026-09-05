import {
  appendAuditEvent,
  inTransaction,
  type ConnectionPool,
  type ConsultantWorkflowSessionRecord,
} from "@matchbase/data";
import {
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
  GOLDEN_SCENARIO_V3_03,
  GOLDEN_SCENARIO_V3_04,
  parseConsultantResearchOutputV3,
  type ConsultantResearchOutputV3,
} from "@matchbase/contracts";
import { ApplicationFault, type RequestContext } from "./types.js";
import { getWorkflowSession } from "./consultant-v3-service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const GOLDEN_ALIAS_MAP: Record<string, string> = {
  "run-v3-golden-01": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-02": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-03": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-04": "00000000-0000-4000-8000-000000000404",
  "run-v3-golden-1": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-2": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-3": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-4": "00000000-0000-4000-8000-000000000404",
};

const GOLDEN_SCENARIO_MAP: Record<string, ConsultantResearchOutputV3> = {
  "00000000-0000-4000-8000-000000000401": GOLDEN_SCENARIO_V3_01,
  "00000000-0000-4000-8000-000000000402": GOLDEN_SCENARIO_V3_02,
  "00000000-0000-4000-8000-000000000403": GOLDEN_SCENARIO_V3_03,
  "00000000-0000-4000-8000-000000000404": GOLDEN_SCENARIO_V3_04,
};

const GOLDEN_RUN_IDS = new Set(Object.keys(GOLDEN_SCENARIO_MAP));

export async function assertConsultantWorkspaceAuthorized(
  pool: ConnectionPool,
  context: RequestContext,
  routeClass: string,
): Promise<void> {
  const grant = await pool.query<{ tier: string; is_super_admin: boolean }>(
    `SELECT eg.tier,
            EXISTS (
              SELECT 1 FROM admin_role_grant arg
               WHERE arg.account_id=eg.account_id AND arg.user_id=eg.user_id
                 AND arg.sub_role='super_admin'
                 AND arg.effective_from <= clock_timestamp()
                 AND (arg.effective_to IS NULL OR arg.effective_to > clock_timestamp())
                 AND arg.revoked_at IS NULL
            ) AS is_super_admin
       FROM entitlement_grant eg
      WHERE account_id=$1 AND user_id=$2
        AND effective_from <= clock_timestamp()
        AND (effective_to IS NULL OR effective_to > clock_timestamp())
        AND revoked_at IS NULL
      ORDER BY effective_from DESC,created_at DESC
      LIMIT 1`,
    [context.accountId, context.userId],
  );
  if (context.tier === "consultant" && grant.rows[0]?.tier === "consultant")
    return;
  if (
    context.tier === "admin" &&
    context.adminSubRoles.includes("super_admin") &&
    grant.rows[0]?.tier === "admin" &&
    grant.rows[0].is_super_admin
  )
    return;
  await inTransaction(pool, (client) =>
    appendAuditEvent(client, {
      accountId: context.accountId,
      actorUserId: context.userId,
      actorTier: context.tier,
      eventType: "access.denied",
      resourceKind: "consultant_workspace",
      outcome: "deny",
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      detail: { refusalCode: "MB-403-CONSULTANT", routeClass },
    }).then(() => undefined),
  );
  throw new ApplicationFault(
    403,
    "consultant-workspace-not-entitled",
    "MB-403-CONSULTANT",
    "Consultant workspace access is not permitted.",
    false,
    {},
    true,
  );
}

export async function authorizeConsultantRunResourceRead(options: {
  context: RequestContext;
  runId: string;
  pool: ConnectionPool;
  resourceKind?: "report_pdf" | "report_json" | "run_result" | "run_detail";
}): Promise<{
  status: 200;
  runId: string;
  output: ConsultantResearchOutputV3;
  session?: ConsultantWorkflowSessionRecord;
}> {
  const { context, runId, pool, resourceKind = "report_pdf" } = options;

  if (!context || !context.userId || !context.accountId) {
    throw new ApplicationFault(
      401,
      "session-required",
      "MB-401-SESSION",
      "A valid session is required.",
    );
  }

  const isConsultant = context.tier === "consultant";
  const isSuperAdmin =
    context.tier === "admin" &&
    Array.isArray(context.adminSubRoles) &&
    context.adminSubRoles.includes("super_admin");

  if (!isConsultant && !isSuperAdmin) {
    await inTransaction(pool, (client) =>
      appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "access.denied",
        resourceKind,
        outcome: "deny",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: { refusalCode: "MB-403-TIER", runId },
      }).then(() => undefined),
    );
    throw new ApplicationFault(
      403,
      "tier-not-entitled",
      "MB-403-TIER",
      "Consultant workspace entitlement required.",
      false,
      {},
      true,
    );
  }

  const effectiveRunId = GOLDEN_ALIAS_MAP[runId] ?? runId;
  if (!UUID_PATTERN.test(effectiveRunId)) {
    throw new ApplicationFault(
      404,
      "run-not-found",
      "MB-404-RUN",
      "The requested run was not found.",
    );
  }

  // Query DB for output and session
  const res = await pool.query<{
    output_id: string | null;
    output_account_id: string | null;
    output_run_id: string | null;
    document_payload: unknown;
    research_status: string | null;
    output_is_invalidated: boolean | null;
    output_invalidation_reason: string | null;
    session_id: string | null;
    session_account_id: string | null;
    session_run_id: string | null;
    user_profile_id: string | null;
    current_state: string | null;
    original_intake: unknown;
    draft_revision: unknown;
    approved_request_revision: unknown;
    advisory_output: unknown;
    advisory_loop_records: unknown;
    deep_prompt_revision: unknown;
    approvals: unknown;
    classification: unknown;
    execution_id: string | null;
    last_checkpoint: string | null;
    session_is_invalidated: boolean | null;
    session_invalidation_reason: string | null;
    session_created_at: Date | null;
    session_updated_at: Date | null;
  }>(
    `SELECT
       o.output_id,
       o.account_id AS output_account_id,
       o.run_id AS output_run_id,
       o.document_payload,
       o.research_status,
       o.is_invalidated AS output_is_invalidated,
       o.invalidation_reason AS output_invalidation_reason,
       s.session_id,
       s.account_id AS session_account_id,
       s.run_id AS session_run_id,
       s.user_profile_id,
       s.current_state,
       s.original_intake,
       s.draft_revision,
       s.approved_request_revision,
       s.advisory_output,
       s.advisory_loop_records,
       s.deep_prompt_revision,
       s.approvals,
       s.classification,
       s.execution_id,
       s.last_checkpoint,
       s.is_invalidated AS session_is_invalidated,
       s.invalidation_reason AS session_invalidation_reason,
       s.created_at AS session_created_at,
       s.updated_at AS session_updated_at
     FROM (
       SELECT * FROM consultant_output_v3 WHERE run_id = $1 LIMIT 1
     ) o
     FULL OUTER JOIN (
       SELECT * FROM consultant_workflow_session WHERE run_id = $1 LIMIT 1
     ) s ON s.run_id = o.run_id`,
    [effectiveRunId],
  );

  const row = res.rows[0];

  // If not found in DB
  if (!row || (!row.output_id && !row.session_id)) {
    // Check in-memory workflow session
    const memorySession = getWorkflowSession(effectiveRunId);
    if (memorySession) {
      const isOwner = memorySession.account_id === context.accountId;
      if (!isOwner && !isSuperAdmin) {
        throw new ApplicationFault(
          404,
          "run-not-found",
          "MB-404-RUN",
          "The requested run was not found.",
        );
      }
      if (memorySession.state === "invalidated") {
        throw new ApplicationFault(
          410,
          "run-invalidated",
          "MB-410-INVALIDATED",
          "This research run has been invalidated due to audit non-compliance.",
          false,
          { run_id: effectiveRunId },
        );
      }
      if (memorySession.output) {
        return {
          status: 200,
          runId: effectiveRunId,
          output: memorySession.output,
        };
      }
    }

    // Check golden scenarios fallback
    const goldenFallback = GOLDEN_SCENARIO_MAP[effectiveRunId];
    if (goldenFallback) {
      return {
        status: 200,
        runId: effectiveRunId,
        output: goldenFallback,
      };
    }

    throw new ApplicationFault(
      404,
      "run-not-found",
      "MB-404-RUN",
      "The requested run was not found.",
    );
  }

  // Determine owner
  const ownerAccountId = row.output_account_id ?? row.session_account_id;
  const isGolden = GOLDEN_RUN_IDS.has(effectiveRunId);
  const isOwner = isGolden || ownerAccountId === context.accountId;

  // If not owner and not super admin -> 404 (privacy-preserving)
  if (!isOwner && !isSuperAdmin) {
    throw new ApplicationFault(
      404,
      "run-not-found",
      "MB-404-RUN",
      "The requested run was not found.",
    );
  }

  // Check invalidation
  const isInvalidated =
    Boolean(row.output_is_invalidated) ||
    Boolean(row.session_is_invalidated) ||
    row.current_state === "invalidated" ||
    (row.research_status === "failed" &&
      Boolean(
        row.output_invalidation_reason || row.session_invalidation_reason,
      ));

  if (isInvalidated) {
    const invalidationReason =
      row.output_invalidation_reason ??
      row.session_invalidation_reason ??
      "This research run has been invalidated due to audit non-compliance.";
    throw new ApplicationFault(
      410,
      "run-invalidated",
      "MB-410-INVALIDATED",
      "This research run has been invalidated due to audit non-compliance.",
      false,
      { invalidation_reason: invalidationReason, run_id: effectiveRunId },
    );
  }

  // Parse output
  let output: ConsultantResearchOutputV3 | undefined;
  if (row.document_payload) {
    output = parseConsultantResearchOutputV3(row.document_payload);
  } else if (GOLDEN_SCENARIO_MAP[effectiveRunId]) {
    output = GOLDEN_SCENARIO_MAP[effectiveRunId];
  } else {
    const mem = getWorkflowSession(effectiveRunId);
    if (mem?.output) output = mem.output;
  }

  if (!output) {
    throw new ApplicationFault(
      404,
      "run-not-found",
      "MB-404-RUN",
      "The requested run was not found.",
    );
  }

  const session: ConsultantWorkflowSessionRecord | undefined = row.session_id
    ? {
        session_id: row.session_id,
        account_id: row.session_account_id!,
        run_id: row.session_run_id!,
        user_profile_id: row.user_profile_id!,
        current_state: row.current_state!,
        original_intake: row.original_intake as Record<string, unknown>,
        draft_revision: row.draft_revision as Record<string, unknown> | null,
        approved_request_revision: row.approved_request_revision as Record<
          string,
          unknown
        > | null,
        advisory_output: row.advisory_output as Record<string, unknown> | null,
        advisory_loop_records: row.advisory_loop_records as
          Record<string, unknown>[] | null,
        deep_prompt_revision: row.deep_prompt_revision as Record<
          string,
          unknown
        > | null,
        approvals: Array.isArray(row.approvals)
          ? (row.approvals as readonly Record<string, unknown>[])
          : [],
        classification: row.classification as Record<string, unknown> | null,
        execution_id: row.execution_id,
        last_checkpoint: row.last_checkpoint,
        is_invalidated: Boolean(row.session_is_invalidated),
        invalidation_reason: row.session_invalidation_reason,
        created_at:
          row.session_created_at?.toISOString?.() ??
          String(row.session_created_at ?? ""),
        updated_at:
          row.session_updated_at?.toISOString?.() ??
          String(row.session_updated_at ?? ""),
      }
    : undefined;

  return {
    status: 200,
    runId: effectiveRunId,
    output,
    ...(session ? { session } : {}),
  };
}
