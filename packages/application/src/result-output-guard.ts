import { appendAuditEvent, type TransactionClient } from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const OUTPUT_RESTRICTED_STATES = new Set(["escalated", "restricted"]);

export type ResultOutputGuard =
  | { readonly kind: "allowed"; readonly state: string }
  | { readonly kind: "not_visible" }
  | { readonly kind: "output_restricted" };

/**
 * Re-resolves the tenant- and owner-scoped run state under a row lock before
 * any result-bearing row is read. A deny is persisted in the same transaction;
 * callers must let that transaction commit before raising the public fault.
 */
export async function guardFreshRunOutputRead(
  client: TransactionClient,
  context: RequestContext,
  runId: string,
  routeClass: "run.status" | "run.result",
): Promise<ResultOutputGuard> {
  const run = await client.query<{ state: string }>(
    `SELECT state
       FROM research_run
      WHERE run_id=$1 AND account_id=$2 AND requested_by_user_id=$3
      FOR SHARE`,
    [runId, context.accountId, context.userId],
  );
  const state = run.rows[0]?.state;
  if (!state) return { kind: "not_visible" };
  if (!OUTPUT_RESTRICTED_STATES.has(state)) return { kind: "allowed", state };

  try {
    await appendAuditEvent(client, {
      accountId: context.accountId,
      actorUserId: context.userId,
      actorTier: context.tier,
      eventType: "access.denied",
      resourceKind: "research_run",
      resourceId: runId,
      outcome: "deny",
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      detail: {
        refusalCode: "MB-403-OUTPUT",
        reasonCode: "output_restricted",
        routeClass,
      },
    });
  } catch {
    throw new ApplicationFault(
      503,
      "audit-unavailable",
      "MB-503-AUDIT",
      "Audit persistence is unavailable.",
      true,
      {},
      true,
    );
  }
  return { kind: "output_restricted" };
}

export function outputRestrictedFault(): ApplicationFault {
  return new ApplicationFault(
    403,
    "output-restricted",
    "MB-403-OUTPUT",
    "Run output is not available.",
    false,
    {},
    true,
  );
}
