import {
  appendAuditEvent,
  inTransaction,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

export async function assertConsultantWorkspaceAuthorized(
  pool: ConnectionPool,
  context: RequestContext,
  routeClass: string,
): Promise<void> {
  const grant = await pool.query<{ tier: string }>(
    `SELECT tier
       FROM entitlement_grant
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
