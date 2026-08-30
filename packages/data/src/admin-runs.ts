import {
  requireAdminSubRole,
  requirePersistedTier,
  type AdminSubRole,
} from "@matchbase/contracts";
import {
  inTransaction,
  type ConnectionPool,
  type TransactionClient,
} from "./database.js";

export const ADMIN_GOVERNANCE_STATES = [
  "Review Required",
  "Escalated to Human",
  "Output Restricted",
  "Evaluation Failed",
] as const;
export type AdminGovernanceState = (typeof ADMIN_GOVERNANCE_STATES)[number];

export const ADMIN_RUN_STATES = [
  "queued",
  "researching",
  "escalated",
  "restricted",
  "scoring",
  "cancelling",
  "failed_retryable",
  "complete",
  "no_responsible_match",
  "failed",
  "cancelled",
  "superseded",
] as const;
export type AdminRunState = (typeof ADMIN_RUN_STATES)[number];

export const ADMIN_RUN_FAILURE_CLASSES = [
  "provider_unavailable",
  "canonicalization_failed",
  "evidence_subsystem_unavailable",
  "timeout",
] as const;
export type AdminRunFailureClass = (typeof ADMIN_RUN_FAILURE_CLASSES)[number];

const ADMIN_RUN_READ_ROLES: readonly AdminSubRole[] = [
  "support",
  "analyst",
  "super_admin",
];
// No released semantic registry exists for governance reason codes. Until one
// is published, no stored token is disclosed: the projection emits this fixed,
// non-content sentinel for both missing and unregistered values.
export const ADMIN_GOVERNANCE_REASON_UNAVAILABLE = "reason_unavailable";
const TRIGGER_RULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYSTEM_ACTOR_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/u;

export interface AdminRunsCursorPosition {
  readonly raisedAt: Date;
  readonly auditId: string;
}

export interface AdminRunsReadInput {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly limit: number;
  readonly cursor: AdminRunsCursorPosition | null;
  readonly governanceState?: AdminGovernanceState;
  readonly runState?: AdminRunState;
  readonly failureClass?: AdminRunFailureClass;
}

export interface AdminRunReadItem {
  readonly run_id: string;
  readonly governance_state: AdminGovernanceState;
  readonly reason_code: string;
  readonly trigger_rule_id?: string;
  readonly raised_at: Date;
  readonly run_state: AdminRunState;
  readonly human_action_required: boolean;
  readonly automated_path_blocked: boolean;
}

export type AdminRunsReadResult =
  | {
      readonly status: 200;
      readonly items: readonly AdminRunReadItem[];
      readonly hasMore: boolean;
      readonly nextPosition: AdminRunsCursorPosition | null;
    }
  | { readonly status: 403; readonly reason: "admin-run-read-required" };

export class AdminRunsIntegrityError extends Error {
  constructor() {
    super("Admin governance run state is inconsistent with its audit record.");
    this.name = "AdminRunsIntegrityError";
  }
}

interface GovernanceAuditDetail {
  readonly to: AdminGovernanceState;
  readonly reasonCode: typeof ADMIN_GOVERNANCE_REASON_UNAVAILABLE;
  readonly triggerRuleId?: string;
  readonly failureClass?: AdminRunFailureClass;
}

function exactString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function governanceDetail(
  value: {
    readonly toState: unknown;
    readonly triggerRuleId: unknown;
    readonly failureClass: unknown;
    readonly systemActor: unknown;
  },
  actorUserId: string | null,
): GovernanceAuditDetail {
  const to = ADMIN_GOVERNANCE_STATES.find((state) => state === value.toState);
  const triggerRuleId =
    value.triggerRuleId === null
      ? undefined
      : exactString(value.triggerRuleId, TRIGGER_RULE_PATTERN);
  const failureClass =
    value.failureClass === null
      ? undefined
      : ADMIN_RUN_FAILURE_CLASSES.find(
          (candidate) => candidate === value.failureClass,
        );
  if (
    !to ||
    (value.triggerRuleId !== null && !triggerRuleId) ||
    (value.failureClass !== null && !failureClass)
  ) {
    throw new AdminRunsIntegrityError();
  }
  if (
    actorUserId === null &&
    (!triggerRuleId || !exactString(value.systemActor, SYSTEM_ACTOR_PATTERN))
  ) {
    throw new AdminRunsIntegrityError();
  }
  return {
    to,
    reasonCode: ADMIN_GOVERNANCE_REASON_UNAVAILABLE,
    ...(triggerRuleId ? { triggerRuleId } : {}),
    ...(failureClass ? { failureClass } : {}),
  };
}

function expectedRunState(state: AdminGovernanceState): AdminRunState {
  if (state === "Review Required" || state === "Escalated to Human") {
    return "escalated";
  }
  if (state === "Output Restricted") return "restricted";
  return "failed";
}

async function actorMayReadAdminRuns(
  client: TransactionClient,
  accountId: string,
  actorUserId: string,
): Promise<boolean> {
  const actor = await client.query<{ tier: unknown }>(
    `SELECT eg.tier
       FROM app_user u
       JOIN entitlement_grant eg
         ON eg.account_id=u.account_id AND eg.user_id=u.user_id
      WHERE u.account_id=$1 AND u.user_id=$2 AND u.status='active'
        AND eg.effective_from<=clock_timestamp()
        AND (eg.effective_to IS NULL OR eg.effective_to>clock_timestamp())
        AND eg.revoked_at IS NULL
      ORDER BY eg.effective_from DESC,eg.created_at DESC
      LIMIT 1
      FOR SHARE OF u,eg`,
    [accountId, actorUserId],
  );
  if (!actor.rows[0] || requirePersistedTier(actor.rows[0].tier) !== "admin") {
    return false;
  }
  const roles = await client.query<{ sub_role: unknown }>(
    `SELECT arg.sub_role
       FROM admin_role_grant arg
      WHERE arg.account_id=$1 AND arg.user_id=$2
        AND arg.effective_from<=clock_timestamp()
        AND (arg.effective_to IS NULL OR arg.effective_to>clock_timestamp())
        AND arg.revoked_at IS NULL
      FOR SHARE`,
    [accountId, actorUserId],
  );
  return roles.rows
    .map((row) => requireAdminSubRole(row.sub_role))
    .some((role) => ADMIN_RUN_READ_ROLES.includes(role));
}

/**
 * Tenant-scoped, status-only governance projection. Stored entitlements are
 * re-resolved at this boundary and no request, candidate, evidence, result or
 * provider-error column is selected.
 */
export async function readAdminRuns(
  pool: ConnectionPool,
  input: AdminRunsReadInput,
): Promise<AdminRunsReadResult> {
  return inTransaction(pool, async (client) => {
    if (
      !(await actorMayReadAdminRuns(client, input.accountId, input.actorUserId))
    ) {
      return { status: 403, reason: "admin-run-read-required" };
    }
    type GovernanceProjectionRow = {
      run_id: string;
      run_state: unknown;
      audit_id: string | null;
      raised_at: Date | null;
      actor_user_id: string | null;
      to_state: unknown;
      reason_code: unknown;
      trigger_rule_id: unknown;
      failure_class: unknown;
      system_actor: unknown;
    };
    const latestGovernanceCte = `WITH latest_governance AS (
         SELECT DISTINCT ON (a.resource_id)
                a.resource_id AS run_id,a.audit_id,a.occurred_at,
                a.actor_user_id,a.detail->>'to' AS to_state,
                a.detail->>'reason_code' AS reason_code,
                a.detail->>'trigger_rule_id' AS trigger_rule_id,
                a.detail->>'failure_class' AS failure_class,
                a.detail->>'system_actor' AS system_actor
           FROM audit_event a
          WHERE a.account_id=$1
            AND a.event_type='governance.state_changed'
            AND a.resource_kind='research_run'
          ORDER BY a.resource_id,a.occurred_at DESC,a.audit_id DESC
       )`;
    const preflight = await client.query<GovernanceProjectionRow>(
      `${latestGovernanceCte}
       SELECT rr.run_id,rr.state AS run_state,g.audit_id,
              g.occurred_at AS raised_at,g.actor_user_id,g.to_state,
              g.reason_code,g.trigger_rule_id,g.failure_class,g.system_actor
         FROM research_run rr
         LEFT JOIN latest_governance g ON g.run_id=rr.run_id
        WHERE rr.account_id=$1
          AND (rr.state IN ('escalated','restricted') OR
               g.to_state=ANY($2::text[]))`,
      [input.accountId, ADMIN_GOVERNANCE_STATES],
    );
    const validateRow = (
      row: GovernanceProjectionRow,
    ): AdminRunReadItem & { auditId: string } => {
      if (!row.audit_id || !row.raised_at) throw new AdminRunsIntegrityError();
      const runState = ADMIN_RUN_STATES.find(
        (state) => state === row.run_state,
      );
      const detail = governanceDetail(
        {
          toState: row.to_state,
          triggerRuleId: row.trigger_rule_id,
          failureClass: row.failure_class,
          systemActor: row.system_actor,
        },
        row.actor_user_id,
      );
      if (!runState || runState !== expectedRunState(detail.to)) {
        throw new AdminRunsIntegrityError();
      }
      return {
        run_id: row.run_id,
        governance_state: detail.to,
        reason_code: detail.reasonCode,
        ...(detail.triggerRuleId
          ? { trigger_rule_id: detail.triggerRuleId }
          : {}),
        raised_at: row.raised_at,
        run_state: runState,
        human_action_required: true,
        automated_path_blocked: true,
        auditId: row.audit_id,
      };
    };
    preflight.rows.forEach(validateRow);

    const result = await client.query<GovernanceProjectionRow>(
      `${latestGovernanceCte}
       SELECT rr.run_id,rr.state AS run_state,g.audit_id,
              g.occurred_at AS raised_at,g.actor_user_id,g.to_state,
              g.reason_code,g.trigger_rule_id,g.failure_class,g.system_actor
         FROM research_run rr
         JOIN latest_governance g ON g.run_id=rr.run_id
        WHERE rr.account_id=$1
          AND g.to_state=ANY($2::text[])
          AND ($3::text IS NULL OR g.to_state=$3)
          AND ($4::text IS NULL OR rr.state=$4)
          AND ($5::text IS NULL OR g.failure_class=$5)
          AND ($6::timestamptz IS NULL OR
               (g.occurred_at,g.audit_id)<($6,$7::uuid))
        ORDER BY g.occurred_at DESC,g.audit_id DESC
        LIMIT $8`,
      [
        input.accountId,
        ADMIN_GOVERNANCE_STATES,
        input.governanceState ?? null,
        input.runState ?? null,
        input.failureClass ?? null,
        input.cursor?.raisedAt ?? null,
        input.cursor?.auditId ?? null,
        input.limit + 1,
      ],
    );
    const mapped = result.rows.map(validateRow);
    const hasMore = mapped.length > input.limit;
    const page = mapped.slice(0, input.limit);
    const last = page.at(-1);
    return {
      status: 200,
      items: page.map(({ auditId: _auditId, ...item }) => item),
      hasMore,
      nextPosition:
        hasMore && last
          ? { raisedAt: last.raised_at, auditId: last.auditId }
          : null,
    };
  });
}
