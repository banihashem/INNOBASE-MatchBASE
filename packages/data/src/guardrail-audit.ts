import { appendAuditEvent } from "./audit.js";
import { resolveStoredAdminAuthority } from "./admin-authorization.js";
import { inTransaction, type ConnectionPool } from "./database.js";

export const GUARDRAIL_IDENTIFIERS = [
  "prohibited_phrasing",
  "explanation_suppression",
  "injection_detection",
] as const;
export type GuardrailIdentifier = (typeof GUARDRAIL_IDENTIFIERS)[number];
export const GUARDRAIL_DISPOSITIONS = [
  "allowed",
  "blocked",
  "suppressed",
  "escalated",
] as const;
export type GuardrailDisposition = (typeof GUARDRAIL_DISPOSITIONS)[number];

export interface GuardrailEvaluationInput {
  readonly accountId: string;
  readonly runId: string;
  readonly guardrailIdentifier: GuardrailIdentifier;
  readonly trigger: string;
  readonly disposition: GuardrailDisposition;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export async function recordGuardrailEvaluation(
  pool: ConnectionPool,
  input: GuardrailEvaluationInput,
): Promise<string> {
  if (
    !GUARDRAIL_IDENTIFIERS.includes(input.guardrailIdentifier) ||
    !GUARDRAIL_DISPOSITIONS.includes(input.disposition) ||
    !/^[a-z][a-z0-9._:-]{0,127}$/u.test(input.trigger)
  ) {
    throw new Error(
      "Guardrail evaluation input is outside the closed contract.",
    );
  }
  return inTransaction(pool, (client) =>
    appendAuditEvent(client, {
      accountId: input.accountId,
      eventType:
        input.disposition === "allowed"
          ? "guardrail.evaluated"
          : "guardrail.activated",
      resourceKind: "research_run",
      resourceId: input.runId,
      outcome: input.disposition === "allowed" ? "allow" : "deny",
      fieldsReleased: [],
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: {
        guardrailIdentifier: input.guardrailIdentifier,
        trigger: input.trigger,
        disposition: input.disposition,
      },
    }),
  );
}

export interface GuardrailMetricInput {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly from: Date;
  readonly to: Date;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export type GuardrailMetricResult =
  | {
      readonly status: 200;
      readonly evaluationCount: number;
      readonly activationCount: number;
      readonly activationRate: number;
      readonly byGuardrail: readonly {
        readonly guardrailIdentifier: GuardrailIdentifier;
        readonly evaluationCount: number;
        readonly activationCount: number;
        readonly activationRate: number;
      }[];
      readonly disclosureAuditId: string;
    }
  | { readonly status: 403; readonly reason: "security-audit-required" };

export async function aggregateGuardrailActivations(
  pool: ConnectionPool,
  input: GuardrailMetricInput,
): Promise<GuardrailMetricResult> {
  return inTransaction(pool, async (client) => {
    const authority = await resolveStoredAdminAuthority(
      client,
      input.accountId,
      input.actorUserId,
    );
    if (
      authority?.tier !== "admin" ||
      !authority.adminSubRoles.includes("security_audit")
    ) {
      await appendAuditEvent(client, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        eventType: "guardrail.metrics_denied",
        resourceKind: "audit_event",
        outcome: "deny",
        fieldsReleased: [],
        correlationId: input.correlationId,
        deploymentId: input.deploymentId,
        detail: { reasonCode: "security-audit-required" },
      });
      return { status: 403, reason: "security-audit-required" };
    }
    const result = await client.query<{
      guardrail_identifier: GuardrailIdentifier;
      evaluation_count: number;
      activation_count: number;
    }>(
      `SELECT detail->>'guardrailIdentifier' AS guardrail_identifier,
              count(*)::int AS evaluation_count,
              count(*) FILTER (WHERE event_type='guardrail.activated')::int
                AS activation_count
         FROM audit_event
        WHERE account_id=$1 AND occurred_at >= $2 AND occurred_at < $3
          AND event_type IN ('guardrail.evaluated','guardrail.activated')
        GROUP BY detail->>'guardrailIdentifier'
        ORDER BY detail->>'guardrailIdentifier'`,
      [input.accountId, input.from, input.to],
    );
    const byGuardrail = result.rows.map((row) => ({
      guardrailIdentifier: row.guardrail_identifier,
      evaluationCount: row.evaluation_count,
      activationCount: row.activation_count,
      activationRate:
        row.evaluation_count === 0
          ? 0
          : row.activation_count / row.evaluation_count,
    }));
    const evaluationCount = byGuardrail.reduce(
      (total, row) => total + row.evaluationCount,
      0,
    );
    const activationCount = byGuardrail.reduce(
      (total, row) => total + row.activationCount,
      0,
    );
    const disclosureAuditId = await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      actorTier: "admin",
      actorAdminSubRole: "security_audit",
      eventType: "guardrail.metrics_read",
      resourceKind: "audit_event",
      outcome: "allow",
      fieldsReleased: [
        "evaluation_count",
        "activation_count",
        "activation_rate",
        "by_guardrail",
      ],
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { from: input.from.toISOString(), to: input.to.toISOString() },
    });
    return {
      status: 200,
      evaluationCount,
      activationCount,
      activationRate:
        evaluationCount === 0 ? 0 : activationCount / evaluationCount,
      byGuardrail,
      disclosureAuditId,
    };
  });
}
