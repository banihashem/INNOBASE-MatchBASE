import { appendAuditEvent } from "./audit.js";
import { resolveStoredAdminAuthority } from "./admin-authorization.js";
import {
  inTransaction,
  type ConnectionPool,
  type TransactionClient,
} from "./database.js";

export const ADMIN_AUDIT_RELEASED_FIELDS = [
  "audit_id",
  "occurred_at",
  "account_id",
  "actor_user_id",
  "actor_tier",
  "actor_admin_sub_role",
  "on_behalf_of_user_id",
  "event_type",
  "resource_kind",
  "resource_id",
  "outcome",
  "projection_version_id",
  "fields_released",
  "justification",
  "request_correlation_id",
  "deployment_id",
  "detail",
  "event_schema_version",
] as const;

export interface AdminAuditFilter {
  readonly subjectUserId?: string;
  readonly resourceId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export interface AdminAuditCursorPosition {
  readonly occurredAt: Date;
  readonly auditId: string;
}

export interface AdminAuditReadInput extends AdminAuditFilter {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly limit: number;
  readonly cursor: AdminAuditCursorPosition | null;
}

export interface AdminAuditExportInput extends AdminAuditFilter {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly maximumRows: number;
}

export interface AdminAuditEventView {
  readonly audit_id: string;
  readonly occurred_at: Date;
  readonly account_id: string;
  readonly actor_user_id: string | null;
  readonly actor_tier: string | null;
  readonly actor_admin_sub_role: string | null;
  readonly on_behalf_of_user_id: string | null;
  readonly event_type: string;
  readonly resource_kind: string | null;
  readonly resource_id: string | null;
  readonly outcome: string;
  readonly projection_version_id: string | null;
  readonly fields_released: readonly string[] | null;
  readonly justification: string | null;
  readonly request_correlation_id: string;
  readonly deployment_id: string;
  readonly detail: unknown;
  readonly event_schema_version: number;
}

export type AdminAuditReadResult =
  | {
      readonly status: 200;
      readonly items: readonly AdminAuditEventView[];
      readonly hasMore: boolean;
      readonly nextPosition: AdminAuditCursorPosition | null;
      readonly disclosureAuditId: string;
    }
  | { readonly status: 403; readonly reason: "security-audit-required" };

export type AdminAuditExportResult =
  | {
      readonly status: 200;
      readonly items: readonly AdminAuditEventView[];
      readonly truncated: boolean;
      readonly disclosureAuditId: string;
    }
  | { readonly status: 403; readonly reason: "security-audit-required" };

async function securityAuditAuthorized(
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
    authority.adminSubRoles.includes("security_audit")
  );
}

function filterDetail(filter: AdminAuditFilter): Record<string, unknown> {
  return {
    subjectUserId: filter.subjectUserId ?? null,
    resourceId: filter.resourceId ?? null,
    from: filter.from?.toISOString() ?? null,
    to: filter.to?.toISOString() ?? null,
  };
}

async function recordDenied(
  client: TransactionClient,
  input: AdminAuditReadInput | AdminAuditExportInput,
  operation: "read" | "export",
): Promise<void> {
  await appendAuditEvent(client, {
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    eventType:
      operation === "read" ? "audit.read_denied" : "audit.export_denied",
    resourceKind: "audit_event",
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    outcome: "deny",
    fieldsReleased: [],
    correlationId: input.correlationId,
    deploymentId: input.deploymentId,
    detail: { reasonCode: "security-audit-required", ...filterDetail(input) },
  });
}

async function queryEvents(
  client: TransactionClient,
  filter: AdminAuditFilter,
  limit: number,
  cursor: AdminAuditCursorPosition | null,
): Promise<AdminAuditEventView[]> {
  const result = await client.query<AdminAuditEventView>(
    `SELECT audit_id,occurred_at,account_id,actor_user_id,actor_tier,
            actor_admin_sub_role,on_behalf_of_user_id,event_type,resource_kind,
            resource_id,outcome,projection_version_id,fields_released,
            justification,request_correlation_id,deployment_id,detail,
            event_schema_version
       FROM audit_event
      WHERE account_id=$1
        AND ($2::uuid IS NULL OR actor_user_id=$2)
        AND ($3::uuid IS NULL OR resource_id=$3)
        AND ($4::timestamptz IS NULL OR occurred_at >= $4)
        AND ($5::timestamptz IS NULL OR occurred_at < $5)
        AND ($6::timestamptz IS NULL OR (occurred_at,audit_id)<($6,$7::uuid))
      ORDER BY occurred_at DESC,audit_id DESC
      LIMIT $8`,
    [
      (filter as AdminAuditReadInput | AdminAuditExportInput).accountId,
      filter.subjectUserId ?? null,
      filter.resourceId ?? null,
      filter.from ?? null,
      filter.to ?? null,
      cursor?.occurredAt ?? null,
      cursor?.auditId ?? null,
      limit,
    ],
  );
  return result.rows;
}

export async function readAdminAuditEvents(
  pool: ConnectionPool,
  input: AdminAuditReadInput,
): Promise<AdminAuditReadResult> {
  return inTransaction(pool, async (client) => {
    if (
      !(await securityAuditAuthorized(
        client,
        input.accountId,
        input.actorUserId,
      ))
    ) {
      await recordDenied(client, input, "read");
      return { status: 403, reason: "security-audit-required" };
    }
    const rows = await queryEvents(
      client,
      input,
      input.limit + 1,
      input.cursor,
    );
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    const disclosureAuditId = await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      actorTier: "admin",
      actorAdminSubRole: "security_audit",
      eventType: "audit.read",
      resourceKind: "audit_event",
      outcome: "allow",
      fieldsReleased: ADMIN_AUDIT_RELEASED_FIELDS,
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { itemCount: items.length, ...filterDetail(input) },
    });
    return {
      status: 200,
      items,
      hasMore,
      nextPosition:
        hasMore && last
          ? { occurredAt: last.occurred_at, auditId: last.audit_id }
          : null,
      disclosureAuditId,
    };
  });
}

export async function exportAdminAuditEvents(
  pool: ConnectionPool,
  input: AdminAuditExportInput,
): Promise<AdminAuditExportResult> {
  return inTransaction(pool, async (client) => {
    if (
      !(await securityAuditAuthorized(
        client,
        input.accountId,
        input.actorUserId,
      ))
    ) {
      await recordDenied(client, input, "export");
      return { status: 403, reason: "security-audit-required" };
    }
    const rows = await queryEvents(client, input, input.maximumRows + 1, null);
    const truncated = rows.length > input.maximumRows;
    const items = rows.slice(0, input.maximumRows);
    const disclosureAuditId = await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      actorTier: "admin",
      actorAdminSubRole: "security_audit",
      eventType: "audit.exported",
      resourceKind: "audit_event",
      outcome: "allow",
      fieldsReleased: ADMIN_AUDIT_RELEASED_FIELDS,
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { itemCount: items.length, truncated, ...filterDetail(input) },
    });
    return { status: 200, items, truncated, disclosureAuditId };
  });
}
