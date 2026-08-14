import { randomUUID } from "node:crypto";
import type { Queryable } from "./database.js";

export interface AuditEventInput {
  readonly accountId?: string;
  readonly actorUserId?: string;
  readonly actorTier?: "demo" | "standard" | "consultant" | "admin";
  readonly actorAdminSubRole?: string;
  readonly eventType: string;
  readonly resourceKind?: string;
  readonly resourceId?: string;
  readonly outcome: "allow" | "deny" | "error";
  readonly projectionVersionId?: string;
  readonly fieldsReleased?: readonly string[];
  readonly justification?: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export async function appendAuditEvent(
  client: Queryable,
  event: AuditEventInput,
): Promise<string> {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO audit_event (
       audit_id, account_id, actor_user_id, actor_tier, actor_admin_sub_role,
       event_type, resource_kind, resource_id, outcome, projection_version_id,
       fields_released, justification, request_correlation_id, deployment_id, detail
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
     )`,
    [
      auditId,
      event.accountId ?? null,
      event.actorUserId ?? null,
      event.actorTier ?? null,
      event.actorAdminSubRole ?? null,
      event.eventType,
      event.resourceKind ?? null,
      event.resourceId ?? null,
      event.outcome,
      event.projectionVersionId ?? null,
      event.fieldsReleased ?? null,
      event.justification ?? null,
      event.correlationId,
      event.deploymentId,
      JSON.stringify(event.detail ?? {}),
    ],
  );
  return auditId;
}
