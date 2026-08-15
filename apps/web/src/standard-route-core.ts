import {
  ApplicationFault,
  StandardWorkspaceApplication,
  parseConfirmation,
  parseDomainResolution,
  parseRunSubmission,
  parseStandardIntake,
  parseStandardVersion,
  type RequestContext,
  type StandardRouteResult,
} from "@matchbase/application";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_SEGMENT =
  /(?:^|\/)(?:attachments?|pdf|artifacts?|exports?|shares?|rescore|re-score|reresearch|re-research|candidates?|evidence)(?:\/|$)/iu;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** Distinguishes Standard mutations on paths shared with the accepted Demo API. */
export function isSharedWorkspaceMutation(
  method: string,
  pathname: string,
): boolean {
  return (
    method === "POST" &&
    (pathname === "/api/v1/requests" ||
      pathname === "/api/v1/runs" ||
      /^\/api\/v1\/requests\/[^/]+\/versions$/u.test(pathname) ||
      /^\/api\/v1\/requests\/[^/]+\/versions\/\d+\/confirmation$/u.test(
        pathname,
      ))
  );
}

export function isStandardMutationIntent(
  method: string,
  pathname: string,
  value: unknown,
): boolean {
  if (!isSharedWorkspaceMutation(method, pathname)) return false;
  const input = record(value);
  if (!input) return false;
  if (pathname === "/api/v1/requests")
    return (
      input.schema_version === "standard-intake-submission.v1" ||
      [
        "domain_pack_activation_token",
        "source_language",
        "fields",
        "hard_constraints",
        "exclusions",
        "conditional_requirements",
      ].some((key) => Object.hasOwn(input, key))
    );
  if (/^\/api\/v1\/requests\/[^/]+\/versions$/u.test(pathname))
    return Object.hasOwn(input, "structured_request");
  if (
    /^\/api\/v1\/requests\/[^/]+\/versions\/\d+\/confirmation$/u.test(pathname)
  )
    return Object.hasOwn(input, "contradiction_resolutions");
  if (pathname === "/api/v1/runs")
    return Object.hasOwn(input, "canonical_request_version");
  return false;
}

function visibleUuid(value: string | undefined): string {
  if (!value || !UUID_PATTERN.test(value))
    throw new ApplicationFault(
      403,
      "resource-not-visible",
      "MB-403-RESOURCE",
      "Resource is not visible.",
    );
  return value;
}

export interface StandardRouteRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: { get(name: string): string | null };
  body(): Promise<unknown>;
  context: RequestContext;
  idempotencyKey: string | null;
  application: StandardWorkspaceApplication;
}

function conditionalResult(
  application: StandardWorkspaceApplication,
  body: unknown,
  ifNoneMatch: string | null,
  status = 200,
  headers: Record<string, string> = {},
): StandardRouteResult {
  const etag = application.etag(body);
  return ifNoneMatch === etag
    ? {
        status: 304,
        body: null,
        headers: {
          ...headers,
          ETag: etag,
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      }
    : {
        status,
        body,
        headers: {
          ...headers,
          ETag: etag,
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      };
}

type ProjectionKind =
  | "request_history"
  | "request_detail"
  | "version_history"
  | "run_history"
  | "run_status"
  | "run_result";
type ProjectionResourceKind =
  | "request_history"
  | "request"
  | "request_version_history"
  | "run_history"
  | "run_status"
  | "run_result";

async function conditionalProjectionResult(
  application: StandardWorkspaceApplication,
  context: RequestContext,
  projectionKind: ProjectionKind,
  resourceKind: ProjectionResourceKind,
  resourceId: string,
  requestId: string | undefined,
  runId: string | undefined,
  body: Record<string, unknown>,
  ifNoneMatch: string | null,
  headers: Record<string, string> = {},
): Promise<StandardRouteResult> {
  const result = conditionalResult(
    application,
    body,
    ifNoneMatch,
    200,
    headers,
  );
  if (result.status === 304)
    await application.recordNotModifiedProjection(
      context,
      resourceKind,
      resourceId,
      requestId,
      runId,
    );
  else
    await application.recordServedProjection(
      context,
      projectionKind,
      resourceKind,
      resourceId,
      requestId,
      runId,
      body as unknown as Record<string, unknown>,
    );
  return result;
}

/** Shared native/Fetch classifier. It contains no framework-specific response logic. */
export async function handleStandardRoute(
  request: StandardRouteRequest,
): Promise<StandardRouteResult | null> {
  const { method, pathname: path, application, context } = request;
  if (!path.startsWith("/api/v1/")) return null;
  if (FORBIDDEN_SEGMENT.test(path))
    await application.refuseAction(
      context,
      path.split("/").filter(Boolean).at(-1) ?? "unknown",
    );

  if (method === "POST" && path === "/api/v1/domain-packs/resolution") {
    await application.authorize(context, "domain_pack.resolve");
    return {
      status: 200,
      body: await application.resolveDomainPack(
        context,
        parseDomainResolution(await request.body()),
      ),
    };
  }
  const pack = /^\/api\/v1\/domain-packs\/([^/]+)$/u.exec(path);
  if (method === "GET" && pack)
    return conditionalResult(
      application,
      await application.getDomainPack(
        context,
        decodeURIComponent(pack[1]!),
        request.headers.get("mb-domain-pack-activation"),
      ),
      request.headers.get("if-none-match"),
    );

  if (method === "POST" && path === "/api/v1/requests") {
    if (!request.idempotencyKey)
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    await application.authorize(context, "request.create");
    const body = await application.createRequest(
      context,
      request.idempotencyKey,
      parseStandardIntake(await request.body()),
    );
    return {
      status: 201,
      body,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    };
  }
  if (method === "GET" && path === "/api/v1/requests") {
    const filter = request.searchParams.get("filter") ?? "all";
    if (
      ![
        "all",
        "active",
        "completed",
        "failed",
        "cancelled",
        "scarce",
        "superseded",
      ].includes(filter)
    )
      throw new ApplicationFault(
        400,
        "invalid-filter",
        "MB-400-FILTER",
        "Invalid history filter.",
      );
    const body = await application.listRequests(
      context,
      request.searchParams.get("cursor") ?? undefined,
      request.searchParams.get("q") ?? "",
      filter,
      false,
    );
    const firstRequestId = Array.isArray(body.items)
      ? (body.items[0] as { request_id?: string } | undefined)?.request_id
      : undefined;
    return conditionalProjectionResult(
      application,
      context,
      "request_history",
      "request_history",
      context.userId,
      firstRequestId,
      undefined,
      body,
      request.headers.get("if-none-match"),
    );
  }
  const versions = /^\/api\/v1\/requests\/([^/]+)\/versions$/u.exec(path);
  if (method === "GET" && versions) {
    const requestId = visibleUuid(versions[1]);
    const body = await application.listVersions(
      context,
      requestId,
      request.searchParams.get("cursor") ?? undefined,
      false,
    );
    return conditionalProjectionResult(
      application,
      context,
      "version_history",
      "request_version_history",
      requestId,
      requestId,
      undefined,
      body,
      request.headers.get("if-none-match"),
    );
  }
  if (method === "POST" && versions) {
    if (!request.idempotencyKey)
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    await application.authorize(context, "request.version_create");
    const input = parseStandardVersion(await request.body());
    const requestId = visibleUuid(versions[1]);
    const mutation = await application.createVersionIdempotent(
      context,
      request.idempotencyKey,
      requestId,
      input,
    );
    return {
      status: 201,
      body: mutation.body,
      headers: mutation.replayed ? { "MB-Idempotent-Replay": "true" } : {},
    };
  }
  const confirmation =
    /^\/api\/v1\/requests\/([^/]+)\/versions\/(\d+)\/confirmation$/u.exec(path);
  if (method === "POST" && confirmation) {
    const requestId = visibleUuid(confirmation[1]);
    if (!request.idempotencyKey)
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    await application.authorize(context, "request.confirm");
    const input = parseConfirmation(await request.body());
    const pathVersion = Number(confirmation[2]);
    const mutation = await application.confirmVersionIdempotent(
      context,
      request.idempotencyKey,
      requestId,
      pathVersion,
      input,
    );
    return {
      status: 200,
      body: mutation.body,
      headers: mutation.replayed ? { "MB-Idempotent-Replay": "true" } : {},
    };
  }
  const requestDetail = /^\/api\/v1\/requests\/([^/]+)$/u.exec(path);
  if (method === "GET" && requestDetail) {
    const requestId = visibleUuid(requestDetail[1]);
    const body = await application.getRequest(context, requestId, false);
    return conditionalProjectionResult(
      application,
      context,
      "request_detail",
      "request",
      requestId,
      requestId,
      undefined,
      body,
      request.headers.get("if-none-match"),
    );
  }

  if (method === "POST" && path === "/api/v1/runs") {
    if (!request.idempotencyKey)
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    await application.authorize(context, "run.submit");
    const input = parseRunSubmission(await request.body());
    const body = await application.submitRun(
      context,
      request.idempotencyKey,
      visibleUuid(input.request_id),
      input.canonical_request_version,
    );
    return {
      status: 202,
      body,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        ...((body as { idempotent_replay?: boolean }).idempotent_replay
          ? { "MB-Idempotent-Replay": "true" }
          : {}),
      },
    };
  }
  if (method === "GET" && path === "/api/v1/runs") {
    const requestId = request.searchParams.get("request_id") ?? "";
    if (requestId) visibleUuid(requestId);
    const filter = request.searchParams.get("filter") ?? "all";
    if (
      ![
        "all",
        "active",
        "completed",
        "failed",
        "cancelled",
        "scarce",
        "superseded",
      ].includes(filter)
    )
      throw new ApplicationFault(
        400,
        "invalid-filter",
        "MB-400-FILTER",
        "Invalid history filter.",
      );
    const body = await application.listRuns(
      context,
      request.searchParams.get("cursor") ?? undefined,
      requestId,
      filter,
      false,
    );
    const firstRunId = Array.isArray(body.items)
      ? (body.items[0] as { run_id?: string } | undefined)?.run_id
      : undefined;
    return conditionalProjectionResult(
      application,
      context,
      "run_history",
      "run_history",
      context.userId,
      undefined,
      firstRunId,
      body,
      request.headers.get("if-none-match"),
    );
  }
  const result = /^\/api\/v1\/runs\/([^/]+)\/result$/u.exec(path);
  if (method === "GET" && result) {
    const runId = visibleUuid(result[1]);
    const body = await application.getResult(context, runId, false);
    return conditionalProjectionResult(
      application,
      context,
      "run_result",
      "run_result",
      runId,
      undefined,
      runId,
      body as unknown as Record<string, unknown>,
      request.headers.get("if-none-match"),
    );
  }
  const cancellation = /^\/api\/v1\/runs\/([^/]+)\/cancellation$/u.exec(path);
  if (method === "POST" && cancellation) {
    if (!request.idempotencyKey)
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    const mutation = await application.cancelRunIdempotent(
      context,
      request.idempotencyKey,
      visibleUuid(cancellation[1]),
    );
    return {
      status: 202,
      body: mutation.body,
      headers: mutation.replayed ? { "MB-Idempotent-Replay": "true" } : {},
    };
  }
  const run = /^\/api\/v1\/runs\/([^/]+)$/u.exec(path);
  if (method === "GET" && run) {
    const runId = visibleUuid(run[1]);
    const body = await application.getRun(context, runId, false);
    const pollAfter = (body as { poll_after_ms?: number }).poll_after_ms;
    return conditionalProjectionResult(
      application,
      context,
      "run_status",
      "run_status",
      runId,
      undefined,
      runId,
      body,
      request.headers.get("if-none-match"),
      pollAfter === undefined ? {} : { "MB-Poll-After-Ms": String(pollAfter) },
    );
  }
  return null;
}
