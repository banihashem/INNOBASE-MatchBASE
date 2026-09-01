import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ADMIN_RESEARCH_RUN_STATES,
  readAdminResearch,
  type AdminResearchRunState,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const PROJECTION = "admin-research-inventory.v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AdminResearchQuery {
  readonly limit: number;
  readonly scope: "all" | "own";
  readonly cursor?: string;
  readonly subject_user_id?: string;
  readonly state?: AdminResearchRunState;
  readonly purpose: string;
}

interface CursorPayload {
  readonly kind: "admin_research";
  readonly account_id: string;
  readonly user_id: string;
  readonly query: string;
  readonly projection: typeof PROJECTION;
  readonly last_at: string;
  readonly last_id: string;
}

function invalidQuery(): never {
  throw new ApplicationFault(
    400,
    "invalid-query",
    "MB-400-ADMIN-RESEARCH",
    "Admin research query is invalid.",
  );
}

export function parseAdminResearchQuery(
  entries: readonly (readonly [string, string])[],
): AdminResearchQuery {
  const allowed = new Set([
    "limit",
    "scope",
    "cursor",
    "subject_user_id",
    "state",
    "purpose",
  ]);
  const input: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key) || Object.hasOwn(input, key) || value.length === 0)
      return invalidQuery();
    input[key] = value;
  }
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  const scope = input.scope ?? "all";
  const state =
    input.state === undefined
      ? undefined
      : ADMIN_RESEARCH_RUN_STATES.find(
          (candidate) => candidate === input.state,
        );
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (scope !== "all" && scope !== "own") ||
    (input.subject_user_id !== undefined &&
      !UUID_PATTERN.test(input.subject_user_id)) ||
    (input.state !== undefined && !state) ||
    (input.cursor !== undefined && input.cursor.length > 2_048) ||
    input.purpose === undefined ||
    input.purpose !== input.purpose.trim() ||
    input.purpose.length < 1 ||
    input.purpose.length > 500 ||
    [...input.purpose].some(
      (character) => (character.codePointAt(0) ?? 0) <= 0x1f,
    )
  )
    return invalidQuery();
  return {
    limit,
    scope,
    purpose: input.purpose,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.subject_user_id
      ? { subject_user_id: input.subject_user_id }
      : {}),
    ...(state ? { state } : {}),
  };
}

function queryBinding(query: AdminResearchQuery): string {
  return JSON.stringify({
    limit: query.limit,
    scope: query.scope,
    subject_user_id: query.subject_user_id ?? null,
    state: query.state ?? null,
    purpose: query.purpose,
  });
}

export class AdminResearchApplication {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly cursorKey: Buffer,
  ) {
    if (cursorKey.byteLength < 32)
      throw new Error(
        "Admin research cursor key must contain at least 32 bytes.",
      );
  }

  async read(context: RequestContext, query: AdminResearchQuery) {
    const binding = queryBinding(query);
    const cursor = query.cursor
      ? this.openCursor(context, query.cursor, binding)
      : null;
    let result: Awaited<ReturnType<typeof readAdminResearch>>;
    try {
      result = await readAdminResearch(this.pool, {
        accountId: context.accountId,
        actorUserId: context.userId,
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        limit: query.limit,
        scope: query.scope,
        cursor: cursor
          ? { queuedAt: new Date(cursor.last_at), runId: cursor.last_id }
          : null,
        purpose: query.purpose,
        ...(query.subject_user_id
          ? { subjectUserId: query.subject_user_id }
          : {}),
        ...(query.state ? { runState: query.state } : {}),
      });
    } catch {
      throw new ApplicationFault(
        503,
        "admin-research-unavailable",
        "MB-503-ADMIN-RESEARCH",
        "Admin research inventory is unavailable.",
        true,
      );
    }
    if (result.status === 403)
      throw new ApplicationFault(
        403,
        "admin-research-not-visible",
        "MB-403-ADMIN-RESEARCH",
        "Admin research inventory is not visible.",
        false,
        {},
        true,
      );
    const nextCursor = result.nextPosition
      ? this.sealCursor(
          context,
          binding,
          result.nextPosition.queuedAt.toISOString(),
          result.nextPosition.runId,
        )
      : null;
    return {
      schema_version: PROJECTION,
      items: result.items.map((item) => ({
        ...item,
        queued_at: item.queued_at.toISOString(),
        updated_at: item.updated_at.toISOString(),
      })),
      page: {
        limit: query.limit,
        has_more: result.hasMore,
        next_cursor: nextCursor,
      },
      privacy_boundary: {
        source_text_released: false,
        email_released: false,
        complete_result_released: false,
      },
    } as const;
  }

  private sealCursor(
    context: RequestContext,
    query: string,
    lastAt: string,
    lastId: string,
  ): string {
    const encoded = Buffer.from(
      JSON.stringify({
        kind: "admin_research",
        account_id: context.accountId,
        user_id: context.userId,
        query,
        projection: PROJECTION,
        last_at: lastAt,
        last_id: lastId,
      } satisfies CursorPayload),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.cursorKey).update(encoded).digest("base64url")}`;
  }

  private openCursor(
    context: RequestContext,
    value: string,
    query: string,
  ): CursorPayload {
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
      )
        throw new Error();
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<CursorPayload>;
      if (
        parsed.kind !== "admin_research" ||
        parsed.account_id !== context.accountId ||
        parsed.user_id !== context.userId ||
        parsed.query !== query ||
        parsed.projection !== PROJECTION ||
        typeof parsed.last_at !== "string" ||
        Number.isNaN(Date.parse(parsed.last_at)) ||
        typeof parsed.last_id !== "string" ||
        !UUID_PATTERN.test(parsed.last_id)
      )
        throw new Error();
      return parsed as CursorPayload;
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
