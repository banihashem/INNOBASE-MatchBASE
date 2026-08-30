import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ADMIN_GOVERNANCE_STATES,
  ADMIN_RUN_FAILURE_CLASSES,
  ADMIN_RUN_STATES,
  AdminRunsIntegrityError,
  readAdminRuns,
  type AdminGovernanceState,
  type AdminRunFailureClass,
  type AdminRunState,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const ADMIN_RUNS_PROJECTION = "admin-governance-status-v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AdminRunsReadQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly governance_state?: AdminGovernanceState;
  readonly run_state?: AdminRunState;
  readonly failure_class?: AdminRunFailureClass;
}

export interface AdminRunsReadBody {
  readonly items: readonly {
    readonly run_id: string;
    readonly governance_state: AdminGovernanceState;
    readonly reason_code: string;
    readonly trigger_rule_id?: string;
    readonly raised_at: string;
    readonly run_state: AdminRunState;
    readonly human_action_required: boolean;
    readonly automated_path_blocked: boolean;
  }[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

interface CursorPayload {
  readonly kind: "admin_runs";
  readonly account_id: string;
  readonly user_id: string;
  readonly query: string;
  readonly projection: typeof ADMIN_RUNS_PROJECTION;
  readonly last_at: string;
  readonly last_id: string;
}

function queryFault(): never {
  throw new ApplicationFault(
    400,
    "invalid-query",
    "MB-400-QUERY",
    "Admin run query is invalid.",
  );
}

export function parseAdminRunsReadQuery(
  entries: readonly (readonly [string, string])[],
): AdminRunsReadQuery {
  const allowed = new Set([
    "limit",
    "cursor",
    "governance_state",
    "run_state",
    "failure_class",
  ]);
  const input: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key) || Object.hasOwn(input, key) || value.length === 0) {
      return queryFault();
    }
    input[key] = value;
  }
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return queryFault();
  }
  const governanceState =
    input.governance_state === undefined
      ? undefined
      : ADMIN_GOVERNANCE_STATES.find(
          (state) => state === input.governance_state,
        );
  const runState =
    input.run_state === undefined
      ? undefined
      : ADMIN_RUN_STATES.find((state) => state === input.run_state);
  const failureClass =
    input.failure_class === undefined
      ? undefined
      : ADMIN_RUN_FAILURE_CLASSES.find(
          (candidate) => candidate === input.failure_class,
        );
  if (
    (input.governance_state !== undefined && !governanceState) ||
    (input.run_state !== undefined && !runState) ||
    (input.failure_class !== undefined && !failureClass) ||
    (input.cursor !== undefined && input.cursor.length > 2_048)
  ) {
    return queryFault();
  }
  return {
    limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(governanceState ? { governance_state: governanceState } : {}),
    ...(runState ? { run_state: runState } : {}),
    ...(failureClass ? { failure_class: failureClass } : {}),
  };
}

function queryBinding(query: AdminRunsReadQuery): string {
  return JSON.stringify({
    limit: query.limit,
    governance_state: query.governance_state ?? null,
    run_state: query.run_state ?? null,
    failure_class: query.failure_class ?? null,
  });
}

export class AdminRunsApplication {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly cursorKey: Buffer,
  ) {
    if (cursorKey.byteLength < 32) {
      throw new Error("Admin run cursor key must contain at least 32 bytes.");
    }
  }

  async read(
    context: RequestContext,
    query: AdminRunsReadQuery,
  ): Promise<AdminRunsReadBody> {
    const cursor = query.cursor
      ? this.openCursor(context, query.cursor, queryBinding(query))
      : null;
    let result: Awaited<ReturnType<typeof readAdminRuns>>;
    try {
      result = await readAdminRuns(this.pool, {
        accountId: context.accountId,
        actorUserId: context.userId,
        limit: query.limit,
        cursor: cursor
          ? { raisedAt: new Date(cursor.last_at), auditId: cursor.last_id }
          : null,
        ...(query.governance_state
          ? { governanceState: query.governance_state }
          : {}),
        ...(query.run_state ? { runState: query.run_state } : {}),
        ...(query.failure_class ? { failureClass: query.failure_class } : {}),
      });
    } catch (error) {
      if (error instanceof AdminRunsIntegrityError) {
        throw new ApplicationFault(
          503,
          "integrity-error",
          "MB-503-INTEGRITY",
          "The governance run projection is unavailable because its stored state is inconsistent.",
          false,
        );
      }
      throw new ApplicationFault(
        503,
        "admin-run-read-unavailable",
        "MB-503-ADMIN-RUNS",
        "The governance run projection could not be read.",
        true,
      );
    }
    if (result.status === 403) {
      throw new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-ADMIN-RUNS",
        "The Admin run projection is not visible.",
      );
    }
    const nextCursor = result.nextPosition
      ? this.sealCursor(
          context,
          queryBinding(query),
          result.nextPosition.raisedAt.toISOString(),
          result.nextPosition.auditId,
        )
      : null;
    return {
      items: result.items.map((item) => ({
        ...item,
        raised_at: item.raised_at.toISOString(),
      })),
      page: {
        next_cursor: nextCursor,
        has_more: result.hasMore,
        limit: query.limit,
      },
    };
  }

  private sealCursor(
    context: RequestContext,
    query: string,
    lastAt: string,
    lastId: string,
  ): string {
    const encoded = Buffer.from(
      JSON.stringify({
        kind: "admin_runs",
        account_id: context.accountId,
        user_id: context.userId,
        query,
        projection: ADMIN_RUNS_PROJECTION,
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
      ) {
        throw new Error();
      }
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<CursorPayload>;
      if (
        parsed.kind !== "admin_runs" ||
        parsed.account_id !== context.accountId ||
        parsed.user_id !== context.userId ||
        parsed.query !== query ||
        parsed.projection !== ADMIN_RUNS_PROJECTION ||
        typeof parsed.last_at !== "string" ||
        Number.isNaN(Date.parse(parsed.last_at)) ||
        typeof parsed.last_id !== "string" ||
        !UUID_PATTERN.test(parsed.last_id)
      ) {
        throw new Error();
      }
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
