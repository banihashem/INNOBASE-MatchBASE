import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ApplicationFault,
  API_MINOR_VERSION,
  MatchBaseApplication,
  assertSlice1EndpointAuthorized,
  type CanonicalRevisionInput,
  type IntakeInput,
  type RequestContext,
} from "@matchbase/application";
import {
  assertUnsafeRequest,
  createPkceTransaction,
  issueSession,
  sha256Base64Url,
  validateOidcTransaction,
} from "@matchbase/auth";
import {
  appendAuditEvent,
  inTransaction,
  resolveStoredAuthorization,
  type ConnectionPool,
} from "@matchbase/data";
import type { WebConfig } from "./config";

const SESSION_COOKIE = "__Host-matchbase_session";
const OIDC_COOKIE = "__Host-matchbase_oidc";
const IDEMPOTENCY_PATTERN = /^[\x20-\x7e]{16,128}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface GoogleOidcProvider {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    challenge: string;
    redirectUri: string;
    clientId: string;
  }): string;
  complete(input: { code: string; nonce: string; verifier: string }): Promise<{
    subject: string;
    email?: string;
    emailVerified?: boolean;
    hostedDomain?: string;
  }>;
}

interface RuntimeOptions {
  config: WebConfig;
  pool: ConnectionPool;
  application: MatchBaseApplication;
  googleProvider?: GoogleOidcProvider;
}

interface SessionContext {
  requestContext: RequestContext;
  csrfHash: string;
  sessionId: string;
  handle: string;
}

interface PendingOidc {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: Date;
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload)),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(payload);
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (
    !(request.headers["content-type"] ?? "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw new ApplicationFault(
      415,
      "unsupported-media-type",
      "MB-415-MEDIA",
      "JSON content type is required.",
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.byteLength;
    if (size > 1_048_576)
      throw new ApplicationFault(
        400,
        "invalid-request",
        "MB-400-BODY",
        "Request body is too large.",
      );
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationFault(
      400,
      "invalid-request",
      "MB-400-JSON",
      "Malformed JSON.",
    );
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationFault(
      400,
      "invalid-request",
      "MB-400-BODY",
      "JSON object is required.",
    );
  }
  return value as Record<string, unknown>;
}

function schemaFault(detail: string): never {
  throw new ApplicationFault(422, "schema-violation", "MB-422-SCHEMA", detail);
}

function assertClosedDto(
  input: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  detail: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedKeys.has(key)))
    schemaFault(detail);
}

function visibleUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApplicationFault(
      403,
      "resource-not-visible",
      "MB-403-RESOURCE",
      "Resource is not visible.",
    );
  }
  return value;
}

function intakeDto(value: unknown): IntakeInput {
  const input = object(value);
  assertClosedDto(
    input,
    [
      "sourceText",
      "fixtureCanonicalText",
      "fixtureCanonicalFields",
      "presentedFields",
    ],
    "Submitted intake is invalid.",
  );
  if (
    typeof input.sourceText !== "string" ||
    !input.sourceText.trim() ||
    typeof input.fixtureCanonicalText !== "string" ||
    !Array.isArray(input.fixtureCanonicalFields) ||
    !Array.isArray(input.presentedFields) ||
    input.presentedFields.some((field) => typeof field !== "string")
  ) {
    schemaFault("Submitted intake is invalid.");
  }
  return input as unknown as IntakeInput;
}

function revisionDto(value: unknown): CanonicalRevisionInput {
  const input = object(value);
  assertClosedDto(
    input,
    ["canonicalText", "fields", "readiness"],
    "Canonical revision is invalid.",
  );
  if (
    typeof input.canonicalText !== "string" ||
    !Array.isArray(input.fields) ||
    !["ready", "partially_ready", "not_ready"].includes(
      input.readiness as string,
    )
  ) {
    schemaFault("Canonical revision is invalid.");
  }
  for (const candidate of input.fields) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      schemaFault("Canonical revision is invalid.");
    const field = candidate as Record<string, unknown>;
    assertClosedDto(
      field,
      ["fieldId", "path", "valueState", "languageOrigin", "canonicalValue"],
      "Canonical revision is invalid.",
    );
    if (
      typeof field.fieldId !== "string" ||
      typeof field.path !== "string" ||
      typeof field.valueState !== "string" ||
      typeof field.languageOrigin !== "string" ||
      typeof field.canonicalValue !== "string"
    ) {
      schemaFault("Canonical revision is invalid.");
    }
  }
  return input as unknown as CanonicalRevisionInput;
}

function problem(
  error: ApplicationFault,
  correlationId: string,
): Record<string, unknown> {
  return {
    type: `about:matchbase/errors/${error.typeSuffix}`,
    title:
      error.status === 403
        ? "Forbidden"
        : error.status === 401
          ? "Session required"
          : "Request failed",
    status: error.status,
    code: error.code,
    detail: error.message,
    correlation_id: correlationId,
    retryable: error.retryable,
    errors: [],
  };
}

function statusEtag(status: {
  state: string;
  progress: { monotonic_sequence: number };
}): string {
  return `"${createHash("sha256").update(`${status.state}:${status.progress.monotonic_sequence}`).digest("base64url")}"`;
}

export function createWebRuntime(
  options: RuntimeOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const pendingOidc = new Map<string, PendingOidc>();

  async function resolveSession(
    request: IncomingMessage,
    correlationId: string,
  ): Promise<SessionContext> {
    const handle = cookieValue(request, SESSION_COOKIE);
    if (!handle)
      throw new ApplicationFault(
        401,
        "session-required",
        "MB-401-SESSION",
        "A valid session is required.",
      );
    const handleHash = Buffer.from(sha256Base64Url(handle), "base64url");
    const session = await options.pool.query<{
      session_id: string;
      account_id: string;
      user_id: string;
      csrf_token_hash: Buffer;
      session_active: boolean;
    }>(
      `SELECT s.session_id, s.account_id, s.user_id, s.csrf_token_hash,
              (s.revoked_at IS NULL
               AND s.absolute_expires_at > clock_timestamp()
               AND s.idle_expires_at > clock_timestamp()
               AND u.status = 'active') AS session_active
         FROM user_session s JOIN app_user u USING (account_id, user_id)
        WHERE s.handle_hash = $1`,
      [handleHash],
    );
    const row = session.rows[0];
    if (!row)
      throw new ApplicationFault(
        401,
        "session-required",
        "MB-401-SESSION",
        "A valid session is required.",
      );
    const authorization = row.session_active
      ? await resolveStoredAuthorization(
          options.pool,
          row.account_id,
          row.user_id,
        )
      : null;
    if (!row.session_active || !authorization) {
      const fault = !row.session_active
        ? new ApplicationFault(
            401,
            "session-required",
            "MB-401-SESSION",
            "A valid session is required.",
          )
        : new ApplicationFault(
            403,
            "tier-not-entitled",
            "MB-403-TIER",
            "Not entitled.",
          );
      await inTransaction(options.pool, (client) =>
        appendAuditEvent(client, {
          accountId: row.account_id,
          actorUserId: row.user_id,
          ...(authorization ? { actorTier: authorization.tier } : {}),
          eventType: "access.denied",
          resourceKind: "api_route",
          outcome: "deny",
          correlationId,
          deploymentId: options.config.deploymentId,
          detail: {
            status: fault.status,
            refusalCode: fault.code,
            resolutionStage: !row.session_active ? "session" : "entitlement",
          },
        }).then(() => undefined),
      );
      throw fault;
    }
    await options.pool.query(
      "UPDATE user_session SET last_used_at = clock_timestamp() WHERE session_id = $1",
      [row.session_id],
    );
    return {
      sessionId: row.session_id,
      handle,
      csrfHash: row.csrf_token_hash.toString("base64url"),
      requestContext: {
        accountId: row.account_id,
        userId: row.user_id,
        tier: authorization.tier,
        adminSubRoles: authorization.adminSubRoles,
        correlationId,
        deploymentId: options.config.deploymentId,
      },
    };
  }

  function assertUnsafe(
    request: IncomingMessage,
    session: SessionContext,
  ): string {
    assertUnsafeRequest({
      expectedOrigin: options.config.origin,
      suppliedOrigin: request.headers.origin ?? null,
      csrfHash: session.csrfHash,
      suppliedCsrf:
        typeof request.headers["x-csrf-token"] === "string"
          ? request.headers["x-csrf-token"]
          : null,
    });
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !IDEMPOTENCY_PATTERN.test(key)) {
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    }
    return key;
  }

  async function createSubjectSession(
    subject: string,
    attributes: {
      email?: string;
      emailVerified?: boolean;
      hostedDomain?: string;
    },
    correlationId: string,
  ): Promise<{ cookie: string; csrfToken: string }> {
    return inTransaction(options.pool, async (client) => {
      const found = await client.query<{ user_id: string; account_id: string }>(
        "SELECT user_id, account_id FROM app_user WHERE google_sub = $1 FOR UPDATE",
        [subject],
      );
      let userId = found.rows[0]?.user_id;
      let accountId = found.rows[0]?.account_id;
      if (!userId || !accountId) {
        userId = randomUUID();
        accountId = randomUUID();
        await client.query(
          "INSERT INTO account (account_id, display_name, status) VALUES ($1,'Demo account','active')",
          [accountId],
        );
        await client.query(
          `INSERT INTO app_user
             (user_id, account_id, google_sub, email, email_verified, hosted_domain, status)
           VALUES ($1,$2,$3,$4,$5,$6,'active')`,
          [
            userId,
            accountId,
            subject,
            attributes.email ?? null,
            attributes.emailVerified ?? false,
            attributes.hostedDomain ?? null,
          ],
        );
        await client.query(
          `INSERT INTO entitlement_grant
             (grant_id, account_id, user_id, tier, grant_actor_kind, justification, effective_from)
           VALUES ($1,$2,$3,'demo','system','default verified subject grant',clock_timestamp())`,
          [randomUUID(), accountId, userId],
        );
      }
      const issued = issueSession();
      await client.query(
        `INSERT INTO user_session
           (session_id, account_id, user_id, handle_hash, csrf_token_hash, absolute_expires_at, idle_expires_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp() + interval '8 hours',clock_timestamp() + interval '30 minutes')`,
        [
          randomUUID(),
          accountId,
          userId,
          Buffer.from(issued.persisted.handleHash, "base64url"),
          Buffer.from(issued.persisted.csrfHash, "base64url"),
        ],
      );
      await appendAuditEvent(client, {
        accountId,
        actorUserId: userId,
        actorTier: "demo",
        eventType: "session.created",
        resourceKind: "app_user",
        resourceId: userId,
        outcome: "allow",
        correlationId,
        deploymentId: options.config.deploymentId,
        detail: { simulator: options.config.oidcSimulatorEnabled },
      });
      return {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.handle)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        csrfToken: issued.csrfToken,
      };
    });
  }

  async function auditDenied(
    session: SessionContext | null,
    correlationId: string,
    path: string,
  ): Promise<void> {
    if (!session) return;
    await inTransaction(options.pool, (client) =>
      appendAuditEvent(client, {
        accountId: session.requestContext.accountId,
        actorUserId: session.requestContext.userId,
        actorTier: session.requestContext.tier,
        eventType: "access.denied",
        resourceKind: "api_route",
        outcome: "deny",
        correlationId,
        deploymentId: options.config.deploymentId,
        detail: { routeClass: path.split("/").slice(0, 4).join("/") },
      }).then(() => undefined),
    );
  }

  return async (request, response) => {
    const correlationId =
      typeof request.headers["mb-correlation-id"] === "string"
        ? request.headers["mb-correlation-id"]
        : randomUUID();
    response.setHeader("MB-Correlation-Id", correlationId);
    response.setHeader("MB-API-Version", API_MINOR_VERSION);
    response.setHeader("MB-Deployment-Id", options.config.deploymentId);
    response.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(request.url ?? "/", options.config.origin);
    const path = url.pathname;
    let session: SessionContext | null = null;
    try {
      const requestedVersion = request.headers["mb-api-version"];
      if (requestedVersion && requestedVersion !== API_MINOR_VERSION) {
        throw new ApplicationFault(
          400,
          "unsupported-api-version",
          "MB-400-VERSION",
          "Unsupported API version.",
        );
      }

      if (request.method === "GET" && path === "/") {
        const banner = options.config.oidcSimulatorEnabled
          ? '<p role="status" data-testid="test-mode-banner">TEST IDENTITY MODE — SYNTHETIC DATA ONLY</p>'
          : "";
        const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MatchBASE</title><body>${banner}<main><h1>MatchBASE</h1><p>Authenticated Demo reference runtime.</p><a href="${options.config.oidcSimulatorEnabled ? "/auth/simulator/start" : "/auth/google/start"}">Sign in</a></main></body></html>`;
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(Buffer.byteLength(page)),
        });
        response.end(page);
        return;
      }
      if (request.method === "GET" && path === "/api/v1/health") {
        json(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && path === "/api/v1/readiness") {
        const ready = await options.application.readiness();
        json(response, ready ? 200 : 503, {
          status: ready ? "ready" : "not_ready",
        });
        return;
      }
      if (request.method === "GET" && path === "/auth/simulator/start") {
        if (
          !options.config.oidcSimulatorEnabled ||
          options.config.environment === "production"
        ) {
          throw new ApplicationFault(
            404,
            "route-not-found",
            "MB-404-ROUTE",
            "Route not found.",
          );
        }
        response.writeHead(302, {
          Location: "/auth/simulator/callback?fixture=demo",
        });
        response.end();
        return;
      }
      if (request.method === "GET" && path === "/auth/simulator/callback") {
        if (
          !options.config.oidcSimulatorEnabled ||
          options.config.environment === "production" ||
          url.searchParams.get("fixture") !== "demo"
        ) {
          throw new ApplicationFault(
            404,
            "route-not-found",
            "MB-404-ROUTE",
            "Route not found.",
          );
        }
        const created = await createSubjectSession(
          "simulator-demo-subject-v1",
          { email: "demo@example.invalid", emailVerified: true },
          correlationId,
        );
        json(
          response,
          200,
          {
            authenticated: true,
            csrf_token: created.csrfToken,
            environment: "test",
          },
          { "Set-Cookie": created.cookie, "MB-CSRF-Token": created.csrfToken },
        );
        return;
      }
      if (request.method === "GET" && path === "/auth/google/start") {
        if (
          !options.googleProvider ||
          !options.config.googleClientId ||
          !options.config.googleRedirectUri
        ) {
          throw new ApplicationFault(
            503,
            "dependency-unavailable",
            "MB-503-OIDC",
            "Google sign-in is unavailable.",
            true,
            { "Retry-After": "30" },
          );
        }
        const transaction = createPkceTransaction();
        const transactionId = randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60_000);
        pendingOidc.set(transactionId, {
          state: transaction.state,
          nonce: transaction.nonce,
          verifier: transaction.verifier,
          expiresAt,
        });
        await options.pool.query(
          `INSERT INTO oauth_transaction
             (oauth_transaction_id, state_hash, nonce_hash, pkce_verifier_hash, redirect_uri,
              environment, simulator, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,false,$7)`,
          [
            transactionId,
            Buffer.from(sha256Base64Url(transaction.state), "base64url"),
            Buffer.from(sha256Base64Url(transaction.nonce), "base64url"),
            Buffer.from(sha256Base64Url(transaction.verifier), "base64url"),
            options.config.googleRedirectUri,
            options.config.environment,
            expiresAt,
          ],
        );
        response.writeHead(302, {
          Location: options.googleProvider.authorizationUrl({
            state: transaction.state,
            nonce: transaction.nonce,
            challenge: transaction.challenge,
            redirectUri: options.config.googleRedirectUri,
            clientId: options.config.googleClientId,
          }),
          "Set-Cookie": `${OIDC_COOKIE}=${transactionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
        });
        response.end();
        return;
      }
      if (request.method === "GET" && path === "/auth/google/callback") {
        const transactionId = cookieValue(request, OIDC_COOKIE);
        const pending = transactionId
          ? pendingOidc.get(transactionId)
          : undefined;
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (
          !transactionId ||
          !pending ||
          !state ||
          !code ||
          !options.googleProvider
        ) {
          throw new ApplicationFault(
            401,
            "session-required",
            "MB-401-OIDC",
            "Google sign-in failed.",
          );
        }
        const stored = await options.pool.query<{
          state_hash: Buffer;
          nonce_hash: Buffer;
          pkce_verifier_hash: Buffer;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          "SELECT state_hash, nonce_hash, pkce_verifier_hash, expires_at, consumed_at FROM oauth_transaction WHERE oauth_transaction_id = $1 FOR UPDATE",
          [transactionId],
        );
        const row = stored.rows[0];
        if (!row)
          throw new ApplicationFault(
            401,
            "session-required",
            "MB-401-OIDC",
            "Google sign-in failed.",
          );
        validateOidcTransaction(
          {
            stateHash: row.state_hash.toString("base64url"),
            nonceHash: row.nonce_hash.toString("base64url"),
            verifierHash: row.pkce_verifier_hash.toString("base64url"),
            expiresAt: row.expires_at,
            ...(row.consumed_at ? { consumedAt: row.consumed_at } : {}),
          },
          { state, nonce: pending.nonce, verifier: pending.verifier },
        );
        const identity = await options.googleProvider.complete({
          code,
          nonce: pending.nonce,
          verifier: pending.verifier,
        });
        await options.pool.query(
          "UPDATE oauth_transaction SET consumed_at = clock_timestamp() WHERE oauth_transaction_id = $1 AND consumed_at IS NULL",
          [transactionId],
        );
        pendingOidc.delete(transactionId);
        const created = await createSubjectSession(
          identity.subject,
          identity,
          correlationId,
        );
        response.writeHead(302, {
          Location: "/",
          "Set-Cookie": [
            created.cookie,
            `${OIDC_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
          ],
          "MB-CSRF-Token": created.csrfToken,
        });
        response.end();
        return;
      }

      session = await resolveSession(request, correlationId);
      if (request.method === "POST") assertUnsafe(request, session);

      if (request.method === "POST" && path === "/auth/logout") {
        await inTransaction(options.pool, async (client) => {
          await client.query(
            "UPDATE user_session SET revoked_at = clock_timestamp(), revoked_reason = 'logout' WHERE session_id = $1",
            [session!.sessionId],
          );
          await appendAuditEvent(client, {
            accountId: session!.requestContext.accountId,
            actorUserId: session!.requestContext.userId,
            actorTier: session!.requestContext.tier,
            eventType: "session.revoked",
            resourceKind: "app_user",
            resourceId: session!.requestContext.userId,
            outcome: "allow",
            correlationId,
            deploymentId: options.config.deploymentId,
            detail: { reasonCode: "logout" },
          });
        });
        response.writeHead(204, {
          "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        });
        response.end();
        return;
      }
      if (request.method === "GET" && path === "/api/v1/me") {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "GET /api/v1/me",
        );
        json(response, 200, {
          ...(await options.application.me(session.requestContext)),
          environment: options.config.environment,
        });
        return;
      }
      if (request.method === "POST" && path === "/api/v1/requests") {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "POST /api/v1/requests",
        );
        const input = intakeDto(await body(request));
        const result = await options.application.createRequest(
          session.requestContext,
          request.headers["idempotency-key"] as string,
          input,
        );
        json(
          response,
          201,
          result,
          result.idempotent_replay ? { "MB-Idempotent-Replay": "true" } : {},
        );
        return;
      }
      const requestMatch = /^\/api\/v1\/requests\/([^/]+)$/u.exec(path);
      if (request.method === "GET" && requestMatch) {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "GET /api/v1/requests/:requestId",
        );
        json(
          response,
          200,
          await options.application.getRequest(
            session.requestContext,
            visibleUuid(requestMatch[1]),
          ),
        );
        return;
      }
      const versionMatch = /^\/api\/v1\/requests\/([^/]+)\/versions$/u.exec(
        path,
      );
      if (request.method === "POST" && versionMatch) {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "POST /api/v1/requests/:requestId/versions",
        );
        json(
          response,
          201,
          await options.application.createVersion(
            session.requestContext,
            visibleUuid(versionMatch[1]),
            revisionDto(await body(request)),
          ),
        );
        return;
      }
      const confirmationMatch =
        /^\/api\/v1\/requests\/([^/]+)\/versions\/(\d+)\/confirmation$/u.exec(
          path,
        );
      if (request.method === "POST" && confirmationMatch) {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "POST /api/v1/requests/:requestId/versions/:version/confirmation",
        );
        const requestId = visibleUuid(confirmationMatch[1]);
        await options.application.assertRequestVisible(
          session.requestContext,
          requestId,
        );
        const input = object(await body(request));
        assertClosedDto(input, ["accepted"], "Confirmation is invalid.");
        if (typeof input.accepted !== "boolean")
          schemaFault("Confirmation is invalid.");
        json(
          response,
          200,
          await options.application.confirmVersion(
            session.requestContext,
            requestId,
            Number(confirmationMatch[2]),
            input.accepted === true,
          ),
        );
        return;
      }
      if (request.method === "POST" && path === "/api/v1/runs") {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "POST /api/v1/runs",
        );
        const input = object(await body(request));
        assertClosedDto(
          input,
          ["request_id", "version"],
          "Run input is invalid.",
        );
        const requestId = visibleUuid(input.request_id);
        if (
          typeof input.version !== "number" ||
          !Number.isSafeInteger(input.version) ||
          input.version < 1
        ) {
          schemaFault("Run input is invalid.");
        }
        const result = await options.application.submitRun(
          session.requestContext,
          request.headers["idempotency-key"] as string,
          {
            requestId,
            version: input.version,
          },
        );
        json(
          response,
          202,
          result,
          result.idempotent_replay ? { "MB-Idempotent-Replay": "true" } : {},
        );
        return;
      }
      if (request.method === "GET" && path === "/api/v1/runs") {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "GET /api/v1/runs",
        );
        json(
          response,
          200,
          await options.application.listRuns(
            session.requestContext,
            url.searchParams.get("cursor") ?? undefined,
          ),
        );
        return;
      }
      const resultMatch = /^\/api\/v1\/runs\/([^/]+)\/result$/u.exec(path);
      if (request.method === "GET" && resultMatch) {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "GET /api/v1/runs/:runId/result",
        );
        const disclosure = await options.application.getRunResult(
          session.requestContext,
          visibleUuid(resultMatch[1]),
        );
        json(response, 200, disclosure.body);
        return;
      }
      const cancellationMatch =
        /^\/api\/v1\/runs\/([^/]+)\/cancellation$/u.exec(path);
      if (request.method === "POST" && cancellationMatch) {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "POST /api/v1/runs/:runId/cancellation",
        );
        json(
          response,
          202,
          await options.application.cancelRun(
            session.requestContext,
            visibleUuid(cancellationMatch[1]),
          ),
        );
        return;
      }
      const runMatch = /^\/api\/v1\/runs\/([^/]+)$/u.exec(path);
      if (request.method === "GET" && runMatch) {
        assertSlice1EndpointAuthorized(
          session.requestContext,
          "GET /api/v1/runs/:runId",
        );
        const runStatus = await options.application.getRunStatus(
          session.requestContext,
          visibleUuid(runMatch[1]),
        );
        const etag = statusEtag(runStatus);
        const pollHeader =
          runStatus.poll_after_ms === null
            ? "0"
            : String(runStatus.poll_after_ms);
        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304, {
            ETag: etag,
            "MB-Poll-After-Ms": pollHeader,
          });
          response.end();
          return;
        }
        json(response, 200, runStatus, {
          ETag: etag,
          "MB-Poll-After-Ms": pollHeader,
        });
        return;
      }
      throw new ApplicationFault(
        404,
        "route-not-found",
        "MB-404-ROUTE",
        "Route not found.",
      );
    } catch (caught) {
      let fault: ApplicationFault;
      if (caught instanceof ApplicationFault) fault = caught;
      else if (
        caught instanceof Error &&
        /Origin refused|CSRF refused/u.test(caught.message)
      ) {
        fault = new ApplicationFault(
          403,
          "resource-not-visible",
          "MB-403-REQUEST",
          "Request refused.",
        );
      } else {
        fault = new ApplicationFault(
          500,
          "internal",
          "MB-500-INTERNAL",
          "The request could not be completed.",
          true,
        );
      }
      if (session) {
        try {
          await auditDenied(session, correlationId, path);
        } catch {
          const auditFault = new ApplicationFault(
            503,
            "audit-unavailable",
            "MB-503-AUDIT",
            "Audit persistence is unavailable.",
            true,
          );
          json(response, auditFault.status, problem(auditFault, correlationId));
          return;
        }
      }
      json(response, fault.status, problem(fault, correlationId), {
        ...fault.headers,
      });
    }
  };
}
