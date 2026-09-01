import {
  appendAuditEvent,
  inTransaction,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

/** Authorizes from the stored grant. The caller-supplied tier is never trusted. */
export async function assertStandardWorkspaceAuthorized(
  pool: ConnectionPool,
  context: RequestContext,
  routeClass: string,
): Promise<"standard" | "consultant"> {
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
      WHERE account_id = $1 AND user_id = $2
        AND effective_from <= clock_timestamp()
        AND (effective_to IS NULL OR effective_to > clock_timestamp())
        AND revoked_at IS NULL
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1`,
    [context.accountId, context.userId],
  );
  const stored = grant.rows[0];
  if (context.tier === "standard" && stored?.tier === "standard")
    return "standard";
  if (
    context.tier === "admin" &&
    context.adminSubRoles.includes("super_admin") &&
    stored?.tier === "admin" &&
    stored.is_super_admin
  )
    return "consultant";
  await inTransaction(pool, (client) =>
    appendAuditEvent(client, {
      accountId: context.accountId,
      actorUserId: context.userId,
      actorTier: context.tier,
      eventType: "access.denied",
      resourceKind: "standard_workspace",
      outcome: "deny",
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      detail: { refusalCode: "MB-403-STANDARD", routeClass },
    }).then(() => undefined),
  );
  throw new ApplicationFault(
    403,
    "standard-workspace-not-entitled",
    "MB-403-STANDARD",
    "Standard workspace access is not permitted.",
    false,
    {},
    true,
  );
}

export function standardNotVisible(): ApplicationFault {
  return new ApplicationFault(
    403,
    "resource-not-visible",
    "MB-403-RESOURCE",
    "Resource is not visible.",
  );
}
