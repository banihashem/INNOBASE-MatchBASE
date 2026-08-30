import { createHmac, timingSafeEqual } from "node:crypto";
import {
  aggregateGuardrailActivations,
  exportAdminAuditEvents,
  readAdminAuditEvents,
  type AdminAuditCursorPosition,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXACT_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const EXPORT_MAXIMUM_ROWS = 10_000;

export interface AdminAuditQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly subject_user_id?: string;
  readonly resource_id?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface AdminGuardrailMetricQuery {
  readonly from: string;
  readonly to: string;
}

function queryFault(): never {
  throw new ApplicationFault(
    400,
    "invalid-query",
    "MB-400-QUERY",
    "Admin audit query is invalid.",
  );
}

function exactInstant(value: string): boolean {
  return EXACT_UTC_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

export function parseAdminAuditQuery(
  entries: readonly (readonly [string, string])[],
  exportMode = false,
): AdminAuditQuery {
  const allowed = new Set([
    "limit",
    "cursor",
    "subject_user_id",
    "resource_id",
    "from",
    "to",
  ]);
  const input: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key) || Object.hasOwn(input, key) || value.length === 0) {
      return queryFault();
    }
    input[key] = value;
  }
  if (exportMode && (input.limit !== undefined || input.cursor !== undefined)) {
    return queryFault();
  }
  const limit = exportMode
    ? EXPORT_MAXIMUM_ROWS
    : input.limit === undefined
      ? 50
      : Number(input.limit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    (!exportMode && limit > 100) ||
    (exportMode && limit !== EXPORT_MAXIMUM_ROWS)
  ) {
    return queryFault();
  }
  if (
    (input.subject_user_id !== undefined &&
      !UUID_PATTERN.test(input.subject_user_id)) ||
    (input.resource_id !== undefined &&
      !UUID_PATTERN.test(input.resource_id)) ||
    (input.from !== undefined && !exactInstant(input.from)) ||
    (input.to !== undefined && !exactInstant(input.to)) ||
    (input.from !== undefined &&
      input.to !== undefined &&
      Date.parse(input.from) >= Date.parse(input.to)) ||
    (input.cursor !== undefined && input.cursor.length > 2_048)
  ) {
    return queryFault();
  }
  return {
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.subject_user_id
      ? { subject_user_id: input.subject_user_id }
      : {}),
    ...(input.resource_id ? { resource_id: input.resource_id } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
  };
}

export function parseAdminGuardrailMetricQuery(
  entries: readonly (readonly [string, string])[],
): AdminGuardrailMetricQuery {
  const input = Object.fromEntries(entries);
  if (
    entries.length !== 2 ||
    Object.keys(input).length !== 2 ||
    typeof input.from !== "string" ||
    typeof input.to !== "string" ||
    !exactInstant(input.from) ||
    !exactInstant(input.to) ||
    Date.parse(input.from) >= Date.parse(input.to)
  ) {
    return queryFault();
  }
  return { from: input.from, to: input.to };
}

interface AuditCursorPayload {
  readonly kind: "admin_audit";
  readonly account_id: string;
  readonly user_id: string;
  readonly binding: string;
  readonly occurred_at: string;
  readonly audit_id: string;
}

function binding(query: AdminAuditQuery): string {
  return JSON.stringify({
    subject_user_id: query.subject_user_id ?? null,
    resource_id: query.resource_id ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    limit: query.limit,
  });
}

function publicEvent(event: {
  readonly occurred_at: Date;
}): Record<string, unknown> {
  return { ...event, occurred_at: event.occurred_at.toISOString() };
}

export class AdminAuditApplication {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly cursorKey: Buffer,
  ) {
    if (cursorKey.byteLength < 32) {
      throw new Error("Admin audit cursor key must contain at least 32 bytes.");
    }
  }

  async read(context: RequestContext, query: AdminAuditQuery) {
    const cursor = query.cursor
      ? this.openCursor(context, query.cursor, binding(query))
      : null;
    const result = await readAdminAuditEvents(this.pool, {
      accountId: context.accountId,
      actorUserId: context.userId,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      limit: query.limit,
      cursor,
      ...(query.subject_user_id
        ? { subjectUserId: query.subject_user_id }
        : {}),
      ...(query.resource_id ? { resourceId: query.resource_id } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
    if (result.status === 403) return this.forbidden();
    return {
      items: result.items.map(publicEvent),
      page: {
        limit: query.limit,
        has_more: result.hasMore,
        next_cursor: result.nextPosition
          ? this.sealCursor(context, binding(query), result.nextPosition)
          : null,
      },
      disclosure_audit_id: result.disclosureAuditId,
    };
  }

  async export(context: RequestContext, query: AdminAuditQuery) {
    const result = await exportAdminAuditEvents(this.pool, {
      accountId: context.accountId,
      actorUserId: context.userId,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      maximumRows: EXPORT_MAXIMUM_ROWS,
      ...(query.subject_user_id
        ? { subjectUserId: query.subject_user_id }
        : {}),
      ...(query.resource_id ? { resourceId: query.resource_id } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
    if (result.status === 403) return this.forbidden();
    return {
      schema_version: "admin-audit-export.v1",
      items: result.items.map(publicEvent),
      truncated: result.truncated,
      disclosure_audit_id: result.disclosureAuditId,
    };
  }

  async guardrailMetrics(
    context: RequestContext,
    query: AdminGuardrailMetricQuery,
  ) {
    const result = await aggregateGuardrailActivations(this.pool, {
      accountId: context.accountId,
      actorUserId: context.userId,
      from: new Date(query.from),
      to: new Date(query.to),
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
    });
    if (result.status === 403) return this.forbidden();
    return {
      from: query.from,
      to: query.to,
      evaluation_count: result.evaluationCount,
      activation_count: result.activationCount,
      activation_rate: result.activationRate,
      by_guardrail: result.byGuardrail.map((row) => ({
        guardrail_identifier: row.guardrailIdentifier,
        evaluation_count: row.evaluationCount,
        activation_count: row.activationCount,
        activation_rate: row.activationRate,
      })),
      disclosure_audit_id: result.disclosureAuditId,
    };
  }

  private forbidden(): never {
    throw new ApplicationFault(
      403,
      "audit-role-required",
      "MB-403-AUDIT",
      "The audit resource is not visible.",
      false,
      {},
      true,
    );
  }

  private sealCursor(
    context: RequestContext,
    queryBinding: string,
    position: AdminAuditCursorPosition,
  ): string {
    const encoded = Buffer.from(
      JSON.stringify({
        kind: "admin_audit",
        account_id: context.accountId,
        user_id: context.userId,
        binding: queryBinding,
        occurred_at: position.occurredAt.toISOString(),
        audit_id: position.auditId,
      } satisfies AuditCursorPayload),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.cursorKey).update(encoded).digest("base64url")}`;
  }

  private openCursor(
    context: RequestContext,
    value: string,
    queryBinding: string,
  ): AdminAuditCursorPosition {
    try {
      const [encoded, signature, extra] = value.split(".");
      if (!encoded || !signature || extra) throw new Error();
      const expected = createHmac("sha256", this.cursorKey)
        .update(encoded)
        .digest();
      const supplied = Buffer.from(signature, "base64url");
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      ) {
        throw new Error();
      }
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<AuditCursorPayload>;
      if (
        payload.kind !== "admin_audit" ||
        payload.account_id !== context.accountId ||
        payload.user_id !== context.userId ||
        payload.binding !== queryBinding ||
        typeof payload.occurred_at !== "string" ||
        !exactInstant(payload.occurred_at) ||
        typeof payload.audit_id !== "string" ||
        !UUID_PATTERN.test(payload.audit_id)
      ) {
        throw new Error();
      }
      return {
        occurredAt: new Date(payload.occurred_at),
        auditId: payload.audit_id,
      };
    } catch {
      throw new ApplicationFault(
        400,
        "invalid-cursor",
        "MB-400-CURSOR",
        "Invalid cursor.",
      );
    }
  }
}
