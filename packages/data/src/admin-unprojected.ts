import { appendAuditEvent } from "./audit.js";
import { resolveStoredAdminAuthority } from "./admin-authorization.js";
import { inTransaction, type ConnectionPool } from "./database.js";

export const ADMIN_UNPROJECTED_RESULT_FIELDS = [
  "run_id",
  "outcome",
  "eligible_count",
  "considered_count",
  "scarcity",
  "limitations_text",
  "complete_result_document",
  "result_sha256",
  "assembled_at",
] as const;

export interface AdminUnprojectedReadInput {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly runId: string;
  readonly justification: string;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export interface AdminUnprojectedResultView {
  readonly run_id: string;
  readonly outcome: string;
  readonly eligible_count: number;
  readonly considered_count: number;
  readonly scarcity: unknown;
  readonly limitations_text: string;
  readonly complete_result_document: unknown;
  readonly result_sha256: string;
  readonly assembled_at: Date;
}

export type AdminUnprojectedReadResult =
  | {
      readonly status: 200;
      readonly body: AdminUnprojectedResultView;
      readonly disclosureAuditId: string;
    }
  | {
      readonly status: 403;
      readonly reason: "analyst-required" | "resource-not-visible";
    };

export async function readAdminUnprojectedResult(
  pool: ConnectionPool,
  input: AdminUnprojectedReadInput,
): Promise<AdminUnprojectedReadResult> {
  return inTransaction(pool, async (client) => {
    const authority = await resolveStoredAdminAuthority(
      client,
      input.accountId,
      input.actorUserId,
    );
    const analyst =
      authority?.tier === "admin" &&
      authority.adminSubRoles.includes("analyst");
    if (!analyst) {
      await appendAuditEvent(client, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        eventType: "unprojected.access_denied",
        resourceKind: "research_run",
        resourceId: input.runId,
        outcome: "deny",
        fieldsReleased: [],
        justification: input.justification,
        correlationId: input.correlationId,
        deploymentId: input.deploymentId,
        detail: { reasonCode: "analyst-required" },
      });
      return { status: 403, reason: "analyst-required" };
    }
    const found = await client.query<{
      run_id: string;
      outcome: string;
      eligible_count: number;
      considered_count: number;
      scarcity: unknown;
      limitations_text: string;
      complete_result_document: unknown;
      result_sha256: Buffer;
      assembled_at: Date;
    }>(
      `SELECT run_id,outcome,eligible_count,considered_count,scarcity,
              limitations_text,complete_result_document,result_sha256,assembled_at
         FROM run_result
        WHERE account_id=$1 AND run_id=$2
        FOR SHARE`,
      [input.accountId, input.runId],
    );
    const row = found.rows[0];
    if (!row) {
      await appendAuditEvent(client, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        actorTier: "admin",
        actorAdminSubRole: "analyst",
        eventType: "unprojected.access_denied",
        resourceKind: "research_run",
        resourceId: input.runId,
        outcome: "deny",
        fieldsReleased: [],
        justification: input.justification,
        correlationId: input.correlationId,
        deploymentId: input.deploymentId,
        detail: { reasonCode: "resource-not-visible" },
      });
      return { status: 403, reason: "resource-not-visible" };
    }
    const body: AdminUnprojectedResultView = {
      ...row,
      result_sha256: row.result_sha256.toString("hex"),
    };
    const disclosureAuditId = await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      actorTier: "admin",
      actorAdminSubRole: "analyst",
      eventType: "unprojected.accessed",
      resourceKind: "research_run",
      resourceId: input.runId,
      outcome: "allow",
      fieldsReleased: ADMIN_UNPROJECTED_RESULT_FIELDS,
      justification: input.justification,
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { resultSha256: body.result_sha256 },
    });
    return { status: 200, body, disclosureAuditId };
  });
}
