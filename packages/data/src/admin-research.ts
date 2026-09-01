import { appendAuditEvent } from "./audit.js";
import { resolveStoredAdminAuthority } from "./admin-authorization.js";
import {
  inTransaction,
  type ConnectionPool,
  type TransactionClient,
} from "./database.js";

export const ADMIN_RESEARCH_RUN_STATES = [
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
export type AdminResearchRunState = (typeof ADMIN_RESEARCH_RUN_STATES)[number];

export interface AdminResearchCursorPosition {
  readonly queuedAt: Date;
  readonly runId: string;
}

export interface AdminResearchReadInput {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly limit: number;
  readonly cursor: AdminResearchCursorPosition | null;
  readonly scope: "all" | "own";
  readonly subjectUserId?: string;
  readonly runState?: AdminResearchRunState;
  readonly purpose: string;
}

export interface AdminResearchReadItem {
  readonly account_id: string;
  readonly run_id: string;
  readonly request_id: string;
  readonly requester: {
    readonly user_id: string;
    readonly display_name: string;
  };
  readonly request_summary: string;
  readonly tier_at_submission: "demo" | "standard" | "consultant";
  readonly research_mode: "synthetic_reference" | "qualified_live_research";
  readonly state: AdminResearchRunState;
  readonly queued_at: Date;
  readonly updated_at: Date;
  readonly outcome: string | null;
  readonly eligible_count: number | null;
  readonly considered_count: number | null;
  readonly result_available: boolean;
}

export type AdminResearchReadResult =
  | {
      readonly status: 200;
      readonly items: readonly AdminResearchReadItem[];
      readonly hasMore: boolean;
      readonly nextPosition: AdminResearchCursorPosition | null;
    }
  | { readonly status: 403; readonly reason: "super-admin-required" };

const RELEASED_FIELDS = [
  "items[].account_id",
  "items[].run_id",
  "items[].request_id",
  "items[].requester.user_id",
  "items[].requester.display_name",
  "items[].request_summary",
  "items[].tier_at_submission",
  "items[].research_mode",
  "items[].state",
  "items[].queued_at",
  "items[].updated_at",
  "items[].outcome",
  "items[].eligible_count",
  "items[].considered_count",
  "items[].result_available",
] as const;

function boundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}…`
    : normalized;
}

/** Produces a bounded operational label; the source document is never returned. */
export function adminResearchRequestSummary(document: unknown): string {
  if (!document || typeof document !== "object" || Array.isArray(document))
    return "Canonical request available";
  const record = document as Record<string, unknown>;
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const values = fields.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const field = entry as Record<string, unknown>;
    const label = boundedText(field.field_id ?? field.fieldId);
    const typed =
      field.typed_value && typeof field.typed_value === "object"
        ? (field.typed_value as Record<string, unknown>)
        : null;
    const value = boundedText(
      typed?.value ?? field.canonical_value ?? field.canonicalValue,
    );
    return value ? [`${label ?? "field"}: ${value}`] : [];
  });
  const canonicalText = boundedText(
    record.canonical_text ?? record.canonicalText,
  );
  return (
    values.slice(0, 3).join(" · ") ||
    canonicalText ||
    "Canonical request available"
  );
}

async function hasSuperAdminAuthority(
  client: TransactionClient,
  accountId: string,
  actorUserId: string,
): Promise<boolean> {
  const authority = await resolveStoredAdminAuthority(
    client,
    accountId,
    actorUserId,
  );
  return (
    authority?.tier === "admin" &&
    authority.adminSubRoles.includes("super_admin")
  );
}

/**
 * System-wide super-admin operational inventory. The `own` scope remains
 * actor-and-account bounded. Both scopes intentionally exclude source text,
 * evidence, provider payloads, raw errors, emails and complete result documents.
 */
export async function readAdminResearch(
  pool: ConnectionPool,
  input: AdminResearchReadInput,
): Promise<AdminResearchReadResult> {
  return inTransaction(pool, async (client) => {
    if (
      !(await hasSuperAdminAuthority(
        client,
        input.accountId,
        input.actorUserId,
      ))
    ) {
      await appendAuditEvent(client, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        eventType: "admin.research_inventory.access_denied",
        resourceKind: "research_run",
        outcome: "deny",
        fieldsReleased: [],
        justification: input.purpose,
        correlationId: input.correlationId,
        deploymentId: input.deploymentId,
        detail: { reasonCode: "super-admin-required" },
      });
      return { status: 403, reason: "super-admin-required" };
    }

    const selected = await client.query<{
      account_id: string;
      run_id: string;
      request_id: string;
      requested_by_user_id: string;
      display_name: string | null;
      canonical_document: unknown;
      tier_at_submission: "demo" | "standard" | "consultant";
      research_mode: "synthetic_reference" | "qualified_live_research";
      state: AdminResearchRunState;
      queued_at: Date;
      updated_at: Date;
      outcome: string | null;
      eligible_count: number | null;
      considered_count: number | null;
      result_available: boolean;
    }>(
      `SELECT rr.run_id,v.request_id,rr.requested_by_user_id,u.display_name,
              rr.account_id,v.canonical_document,rr.tier_at_submission,rr.research_mode,
              CASE WHEN rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL
                   THEN 'failed' ELSE rr.state END AS state,
              rr.queued_at,
              GREATEST(rr.queued_at,COALESCE(rr.started_at,rr.queued_at),
                       COALESCE(rr.completed_at,lt.completed_at,rr.queued_at),
                       COALESCE(rr.cancelled_at,rr.queued_at)) AS updated_at,
              COALESCE(rs.outcome,
                       CASE WHEN rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL
                            THEN 'failed' END) AS outcome,
              rs.eligible_count,rs.considered_count,
              (rs.complete_result_document IS NOT NULL AND
               rr.state IN ('complete','no_responsible_match')) AS result_available
         FROM research_run rr
         JOIN canonical_request_version v
           ON v.account_id=rr.account_id
          AND v.canonical_request_version_id=rr.canonical_request_version_id
         JOIN app_user u
           ON u.account_id=rr.account_id AND u.user_id=rr.requested_by_user_id
         LEFT JOIN run_result rs
           ON rs.account_id=rr.account_id AND rs.run_id=rr.run_id
         LEFT JOIN live_research_terminal lt
           ON lt.account_id=rr.account_id AND lt.run_id=rr.run_id
        WHERE ($2::text='all' OR (rr.account_id=$1 AND rr.requested_by_user_id=$3))
          AND ($4::uuid IS NULL OR rr.requested_by_user_id=$4)
          AND ($5::text IS NULL OR
               CASE WHEN rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL
                    THEN 'failed' ELSE rr.state END=$5)
          AND ($6::timestamptz IS NULL OR (rr.queued_at,rr.run_id)<($6,$7::uuid))
        ORDER BY rr.queued_at DESC,rr.run_id DESC
        LIMIT $8`,
      [
        input.accountId,
        input.scope,
        input.actorUserId,
        input.subjectUserId ?? null,
        input.runState ?? null,
        input.cursor?.queuedAt ?? null,
        input.cursor?.runId ?? null,
        input.limit + 1,
      ],
    );
    const hasMore = selected.rows.length > input.limit;
    const rows = selected.rows.slice(0, input.limit);
    const items = rows.map((row): AdminResearchReadItem => ({
      run_id: row.run_id,
      account_id: row.account_id,
      request_id: row.request_id,
      requester: {
        user_id: row.requested_by_user_id,
        display_name:
          boundedText(row.display_name) ??
          `User ${row.requested_by_user_id.slice(0, 8)}`,
      },
      request_summary: adminResearchRequestSummary(row.canonical_document),
      tier_at_submission: row.tier_at_submission,
      research_mode: row.research_mode,
      state: row.state,
      queued_at: row.queued_at,
      updated_at: row.updated_at,
      outcome: row.outcome,
      eligible_count: row.eligible_count,
      considered_count: row.considered_count,
      result_available: row.result_available,
    }));
    await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      actorTier: "admin",
      actorAdminSubRole: "super_admin",
      eventType: "admin.research_inventory.projected",
      resourceKind: "research_run",
      outcome: "allow",
      justification: input.purpose,
      fieldsReleased: RELEASED_FIELDS,
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: {
        scope: input.scope,
        subjectFilterApplied: Boolean(input.subjectUserId),
        stateFilterApplied: Boolean(input.runState),
        itemCount: items.length,
        sourceTextReleased: false,
        completeResultReleased: false,
        systemWide: input.scope === "all",
      },
    });
    const last = rows.at(-1);
    return {
      status: 200,
      items,
      hasMore,
      nextPosition:
        hasMore && last
          ? { queuedAt: last.queued_at, runId: last.run_id }
          : null,
    };
  });
}
