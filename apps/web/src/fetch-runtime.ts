import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  API_MINOR_VERSION,
  ApplicationFault,
  MatchBaseApplication,
  StandardWorkspaceApplication,
  assertSlice1EndpointAuthorized,
  type CanonicalRevisionInput,
  type IntakeInput,
  type RequestContext,
} from "@matchbase/application";
import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
  type CanonicalizationCapability,
} from "@matchbase/ai-evidence";
import {
  assertUnsafeRequest,
  createGoogleOidcAdapter,
  createPkceTransaction,
  issueSession,
  sha256Base64Url,
  validateOidcTransaction,
} from "@matchbase/auth";
import {
  appendAuditEvent,
  createPool,
  inTransaction,
  resolveStoredAuthorization,
  type ConnectionPool,
  type TransactionClient,
} from "@matchbase/data";
import { loadWebConfig, type WebConfig } from "./config";
import {
  handleStandardRoute,
  isSharedWorkspaceMutation,
  isStandardMutationIntent,
} from "./standard-route-core";
import { loadServerOwnedResearchAdmission } from "./server-owned-research-admission";

const HOST_SESSION_COOKIE = "__Host-matchbase_session";
const LOCAL_SESSION_COOKIE = "matchbase_session";
const HOST_CSRF_COOKIE = "__Host-matchbase_csrf";
const LOCAL_CSRF_COOKIE = "matchbase_csrf";
const SIMULATOR_TRANSACTION_COOKIE = "matchbase_simulator_transaction";
const GOOGLE_TRANSACTION_COOKIE = "matchbase_google_transaction";
const IDEMPOTENCY_PATTERN = /^[\x20-\x7e]{16,128}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface Services {
  config: WebConfig;
  pool: ConnectionPool;
  application: MatchBaseApplication;
  standardApplication: StandardWorkspaceApplication;
  googleProvider?: ReturnType<typeof createGoogleOidcAdapter>;
}

interface SessionContext {
  sessionId: string;
  csrfHash: string;
  requestContext: RequestContext;
}

function sessionCookieName(config: WebConfig): string {
  return config.environment === "production"
    ? HOST_SESSION_COOKIE
    : LOCAL_SESSION_COOKIE;
}

function csrfCookieName(config: WebConfig): string {
  return config.environment === "production"
    ? HOST_CSRF_COOKIE
    : LOCAL_CSRF_COOKIE;
}

function sessionCookieAttributes(config: WebConfig, httpOnly: boolean): string {
  return `Path=/; ${httpOnly ? "HttpOnly; " : ""}${config.environment === "production" ? "Secure; " : ""}SameSite=Lax`;
}

function simulatorTicket(
  config: WebConfig,
  state: string,
  fixture: "demo" | "standard",
): string {
  return createHmac("sha256", config.digestKey)
    .update(`${fixture}\u0000${state}`, "utf8")
    .digest("base64url");
}

function sealedTransaction(
  config: WebConfig,
  transaction: { state: string; nonce: string; verifier: string },
): string {
  const payload = Buffer.from(JSON.stringify(transaction), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", config.digestKey)
    .update(payload, "utf8")
    .digest("base64url");
  return `${payload}.${signature}`;
}

function openTransaction(
  config: WebConfig,
  value: string | null,
): { state: string; nonce: string; verifier: string } | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", config.digestKey)
    .update(payload, "utf8")
    .digest("base64url");
  if (signature !== expected) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.verifier !== "string"
    )
      return null;
    return {
      state: parsed.state,
      nonce: parsed.nonce,
      verifier: parsed.verifier,
    };
  } catch {
    return null;
  }
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

let singleton: Services | undefined;

/** Releases the lazily-created Fetch runtime pool during controlled shutdowns and isolated tests. */
export async function closeFetchRuntime(): Promise<void> {
  const current = singleton;
  singleton = undefined;
  if (current) await current.pool.end();
}

function services(): Services {
  if (singleton) return singleton;
  const config = loadWebConfig();
  const pool = createPool({ connectionString: config.databaseUrl, max: 20 });
  const canonicalizer: CanonicalizationCapability =
    config.syntheticFixtureEnabled
      ? new DeterministicFixtureCanonicalizer({
          digestKey: config.digestKey,
          digestKeyId: "runtime-v1",
          languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
        })
      : {
          capabilityId: "CAP-TRANSLATE",
          async canonicalize() {
            throw new Error(
              "No approved canonicalization route is configured.",
            );
          },
        };
  const googleProvider =
    config.googleClientId &&
    config.googleClientSecret &&
    config.googleRedirectUri &&
    config.googleAuthorizationEndpoint &&
    config.googleTokenEndpoint &&
    config.googleIssuer &&
    config.googleJwksUri
      ? createGoogleOidcAdapter({
          clientId: config.googleClientId,
          clientSecret: config.googleClientSecret,
          redirectUri: config.googleRedirectUri,
          authorizationEndpoint: config.googleAuthorizationEndpoint,
          tokenEndpoint: config.googleTokenEndpoint,
          issuer: config.googleIssuer,
          jwksUri: config.googleJwksUri,
        })
      : undefined;
  singleton = {
    config,
    pool,
    application: new MatchBaseApplication({
      pool,
      canonicalizer,
      privacyKey: config.digestKey,
      researchAdmission: loadServerOwnedResearchAdmission(config),
    }),
    standardApplication: new StandardWorkspaceApplication({
      pool,
      privacyKey: config.digestKey,
    }),
    ...(googleProvider ? { googleProvider } : {}),
  };
  return singleton;
}

function cookie(request: Request, name: string): string | null {
  for (const segment of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...parts] = segment.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function responseHeaders(
  config: WebConfig,
  correlationId: string,
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(extra);
  headers.set("MB-API-Version", API_MINOR_VERSION);
  headers.set("MB-Correlation-Id", correlationId);
  headers.set("MB-Deployment-Id", config.deploymentId);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function json(
  config: WebConfig,
  correlationId: string,
  value: unknown,
  status = 200,
  extra?: HeadersInit,
): Response {
  const headers = responseHeaders(config, correlationId, extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

function faultBody(
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

function visibleUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ApplicationFault(
      403,
      "resource-not-visible",
      "MB-403-RESOURCE",
      "Resource is not visible.",
    );
  }
  return value;
}

function sourceText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > 20_000
  ) {
    throw new ApplicationFault(
      422,
      "schema-violation",
      "MB-422-SCHEMA",
      "Submitted intake is invalid.",
    );
  }
  return value;
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
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    schemaFault(detail);
  }
}

function stringArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  detail: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > allowed.size ||
    value.some((item) => typeof item !== "string" || !allowed.has(item)) ||
    new Set(value).size !== value.length
  ) {
    schemaFault(detail);
  }
  return value as string[];
}

function canonicalFields(value: unknown): CanonicalRevisionInput["fields"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new ApplicationFault(
      422,
      "schema-violation",
      "MB-422-SCHEMA",
      "Canonical fields are invalid.",
    );
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      schemaFault("Canonical fields are invalid.");
    const field = candidate as Record<string, unknown>;
    assertClosedDto(
      field,
      [
        "fieldId",
        "field_id",
        "path",
        "valueState",
        "value_state",
        "languageOrigin",
        "language_origin",
        "canonicalValue",
        "canonical_value",
      ],
      "Canonical fields are invalid.",
    );
    if (
      ("fieldId" in field && "field_id" in field) ||
      ("valueState" in field && "value_state" in field) ||
      ("languageOrigin" in field && "language_origin" in field) ||
      ("canonicalValue" in field && "canonical_value" in field)
    ) {
      schemaFault("Canonical fields are invalid.");
    }
    const fieldId = field.fieldId ?? field.field_id;
    const path = field.path;
    const valueState = field.valueState ?? field.value_state;
    const languageOrigin = field.languageOrigin ?? field.language_origin;
    const canonicalValue = field.canonicalValue ?? field.canonical_value;
    if (
      typeof fieldId !== "string" ||
      typeof path !== "string" ||
      typeof valueState !== "string" ||
      typeof languageOrigin !== "string" ||
      typeof canonicalValue !== "string" ||
      !/^[a-z][a-z0-9_-]{0,63}$/u.test(fieldId) ||
      !/^[a-z][a-z0-9_.-]{0,127}$/u.test(path) ||
      !["provided", "explicitly_unknown", "not_asked"].includes(valueState) ||
      ![
        "entered_in_english",
        "translated",
        "protected_span",
        "derived_deterministic",
      ].includes(languageOrigin) ||
      !canonicalValue.trim() ||
      canonicalValue.length > 2_000 ||
      [...canonicalValue].some(
        (character) =>
          /\p{Letter}/u.test(character) && !/\p{Script=Latin}/u.test(character),
      ) ||
      (valueState === "provided" && !/[A-Za-z]/u.test(canonicalValue))
    ) {
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "Canonical fields are invalid.",
      );
    }
    return {
      fieldId,
      path,
      valueState:
        valueState as CanonicalRevisionInput["fields"][number]["valueState"],
      languageOrigin:
        languageOrigin as CanonicalRevisionInput["fields"][number]["languageOrigin"],
      canonicalValue,
    };
  });
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (
    !(request.headers.get("content-type") ?? "")
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
  try {
    return object(await request.json());
  } catch (error) {
    if (error instanceof ApplicationFault) throw error;
    throw new ApplicationFault(
      400,
      "invalid-request",
      "MB-400-JSON",
      "Malformed JSON.",
    );
  }
}

async function sessionFor(
  request: Request,
  current: Services,
  correlationId: string,
  path: string,
): Promise<SessionContext> {
  const handle = cookie(request, sessionCookieName(current.config));
  if (!handle)
    throw new ApplicationFault(
      401,
      "session-required",
      "MB-401-SESSION",
      "A valid session is required.",
    );
  type Resolution =
    | { kind: "anonymous" }
    | { kind: "denied"; fault: ApplicationFault }
    | { kind: "allowed"; session: SessionContext };
  let resolution: Resolution;
  try {
    resolution = await inTransaction(current.pool, async (client) => {
      const found = await client.query<{
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
          WHERE s.handle_hash = $1
          FOR UPDATE OF s`,
        [Buffer.from(sha256Base64Url(handle), "base64url")],
      );
      const row = found.rows[0];
      if (!row) return { kind: "anonymous" };
      const authorization = row.session_active
        ? await resolveStoredAuthorization(client, row.account_id, row.user_id)
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
        await appendAuditEvent(client, {
          accountId: row.account_id,
          actorUserId: row.user_id,
          ...(authorization ? { actorTier: authorization.tier } : {}),
          eventType: "access.denied",
          resourceKind: "api_route",
          outcome: "deny",
          correlationId,
          deploymentId: current.config.deploymentId,
          detail: {
            routeClass: path.split("/").slice(0, 4).join("/"),
            status: fault.status,
            refusalCode: fault.code,
            resolutionStage: !row.session_active ? "session" : "entitlement",
          },
        });
        return { kind: "denied", fault };
      }
      await client.query(
        "UPDATE user_session SET last_used_at = clock_timestamp() WHERE session_id = $1",
        [row.session_id],
      );
      return {
        kind: "allowed",
        session: {
          sessionId: row.session_id,
          csrfHash: row.csrf_token_hash.toString("base64url"),
          requestContext: {
            accountId: row.account_id,
            userId: row.user_id,
            tier: authorization.tier,
            adminSubRoles: authorization.adminSubRoles,
            correlationId,
            deploymentId: current.config.deploymentId,
          },
        },
      };
    });
  } catch {
    throw new ApplicationFault(
      503,
      "audit-unavailable",
      "MB-503-AUDIT",
      "Audit persistence is unavailable.",
      true,
    );
  }
  if (resolution.kind === "anonymous")
    throw new ApplicationFault(
      401,
      "session-required",
      "MB-401-SESSION",
      "A valid session is required.",
    );
  if (resolution.kind === "denied") throw resolution.fault;
  return resolution.session;
}

function unsafeKey(
  request: Request,
  current: Services,
  session: SessionContext,
): string {
  try {
    assertUnsafeRequest({
      expectedOrigin: current.config.origin,
      suppliedOrigin: request.headers.get("origin"),
      csrfHash: session.csrfHash,
      suppliedCsrf: request.headers.get("x-csrf-token"),
    });
  } catch {
    throw new ApplicationFault(
      403,
      "resource-not-visible",
      "MB-403-REQUEST",
      "Request refused.",
    );
  }
  const key = request.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_PATTERN.test(key)) {
    throw new ApplicationFault(
      400,
      "idempotency-key-required",
      "MB-400-IDEMPOTENCY",
      "A valid Idempotency-Key is required.",
    );
  }
  return key;
}

async function simulatorSession(
  current: Services,
  correlationId: string,
  client: TransactionClient,
  identity: {
    subject: string;
    displayName: string;
    email?: string;
    emailVerified?: boolean;
    hostedDomain?: string;
    simulator: boolean;
    tier: "demo" | "standard";
  },
): Promise<{ handle: string; csrf: string }> {
  const existing = await client.query<{
    account_id: string;
    user_id: string;
  }>(
    "SELECT account_id, user_id FROM app_user WHERE google_sub = $1 FOR UPDATE",
    [identity.subject],
  );
  let accountId = existing.rows[0]?.account_id;
  let userId = existing.rows[0]?.user_id;
  if (!accountId || !userId) {
    accountId = randomUUID();
    userId = randomUUID();
    await client.query(
      "INSERT INTO account (account_id, display_name, status) VALUES ($1,$2,'active')",
      [accountId, identity.displayName],
    );
    await client.query(
      `INSERT INTO app_user (user_id, account_id, google_sub, email, email_verified, hosted_domain, status)
         VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [
        userId,
        accountId,
        identity.subject,
        identity.email ?? null,
        identity.emailVerified ?? false,
        identity.hostedDomain ?? null,
      ],
    );
    if (identity.tier === "demo") {
      await client.query(
        `INSERT INTO entitlement_grant
           (grant_id, account_id, user_id, tier, grant_actor_kind, justification, effective_from)
         VALUES ($1,$2,$3,'demo','system','default simulator grant',clock_timestamp())`,
        [randomUUID(), accountId, userId],
      );
    } else {
      const grantorId = randomUUID();
      await client.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status)
         VALUES($1,$2,$3,true,'active')`,
        [grantorId, accountId, `${identity.subject}:grantor`],
      );
      await client.query(
        `INSERT INTO entitlement_grant
           (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from)
         VALUES($1,$2,$3,'standard','user',$4,'signed standard simulator fixture',clock_timestamp())`,
        [randomUUID(), accountId, userId, grantorId],
      );
    }
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
    actorTier: identity.tier,
    eventType: "session.created",
    resourceKind: "app_user",
    resourceId: userId,
    outcome: "allow",
    correlationId,
    deploymentId: current.config.deploymentId,
    detail: { simulator: identity.simulator },
  });
  return { handle: issued.handle, csrf: issued.csrfToken };
}

async function auditDenied(
  current: Services,
  session: SessionContext | null,
  path: string,
  fault: ApplicationFault,
): Promise<void> {
  if (!session) return;
  await inTransaction(current.pool, async (client) => {
    await appendAuditEvent(client, {
      accountId: session.requestContext.accountId,
      actorUserId: session.requestContext.userId,
      actorTier: session.requestContext.tier,
      eventType: "access.denied",
      resourceKind: "api_route",
      outcome: "deny",
      correlationId: session.requestContext.correlationId,
      deploymentId: current.config.deploymentId,
      detail: {
        routeClass: path.split("/").slice(0, 4).join("/"),
        status: fault.status,
        refusalCode: fault.code,
      },
    });
  });
}

export async function handleRoute(request: Request): Promise<Response> {
  const current = services();
  const suppliedCorrelationId = request.headers.get("mb-correlation-id");
  const correlationId =
    suppliedCorrelationId &&
    /^[A-Za-z0-9._:-]{1,128}$/u.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : randomUUID();
  const url = new URL(request.url);
  const path = url.pathname;
  let parsedBody: Promise<Record<string, unknown>> | undefined;
  const readRequestBody = (): Promise<Record<string, unknown>> =>
    (parsedBody ??= requestBody(request));
  let session: SessionContext | null = null;
  try {
    const pinned = request.headers.get("mb-api-version");
    if (pinned && pinned !== API_MINOR_VERSION) {
      throw new ApplicationFault(
        400,
        "unsupported-api-version",
        "MB-400-VERSION",
        "Unsupported API version.",
      );
    }
    if (request.method === "GET" && path === "/api/v1/health")
      return json(current.config, correlationId, { status: "ok" });
    if (request.method === "GET" && path === "/api/v1/readiness") {
      const ready =
        (await current.application.readiness()) &&
        (await current.standardApplication.readiness());
      return json(
        current.config,
        correlationId,
        { status: ready ? "ready" : "not_ready" },
        ready ? 200 : 503,
      );
    }
    if (request.method === "GET" && path === "/auth/simulator/start") {
      if (
        !current.config.oidcSimulatorEnabled ||
        current.config.environment === "production"
      ) {
        throw new ApplicationFault(
          404,
          "route-not-found",
          "MB-404-ROUTE",
          "Route not found.",
        );
      }
      const fixture = url.searchParams.get("fixture") ?? "demo";
      if (fixture !== "demo" && fixture !== "standard")
        throw new ApplicationFault(
          404,
          "route-not-found",
          "MB-404-ROUTE",
          "Route not found.",
        );
      const transaction = createPkceTransaction();
      await current.pool.query(
        `INSERT INTO oauth_transaction
           (oauth_transaction_id, state_hash, nonce_hash, pkce_verifier_hash,
            redirect_uri, environment, simulator, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,clock_timestamp() + interval '5 minutes')`,
        [
          randomUUID(),
          Buffer.from(sha256Base64Url(transaction.state), "base64url"),
          Buffer.from(sha256Base64Url(transaction.nonce), "base64url"),
          Buffer.from(sha256Base64Url(transaction.verifier), "base64url"),
          `${current.config.origin}/auth/simulator/callback`,
          current.config.environment,
        ],
      );
      const headers = responseHeaders(current.config, correlationId, {
        Location: `/auth/simulator/callback?fixture=${fixture}&state=${encodeURIComponent(transaction.state)}&ticket=${encodeURIComponent(simulatorTicket(current.config, transaction.state, fixture))}`,
      });
      headers.append(
        "Set-Cookie",
        `${SIMULATOR_TRANSACTION_COOKIE}=${encodeURIComponent(sealedTransaction(current.config, transaction))}; ${sessionCookieAttributes(current.config, true)}; Max-Age=300`,
      );
      return new Response(null, {
        status: 302,
        headers,
      });
    }
    if (request.method === "GET" && path === "/auth/simulator/callback") {
      const state = url.searchParams.get("state") ?? "";
      const ticket = url.searchParams.get("ticket") ?? "";
      const fixture = url.searchParams.get("fixture");
      const transactionSecrets = openTransaction(
        current.config,
        cookie(request, SIMULATOR_TRANSACTION_COOKIE),
      );
      if (
        !current.config.oidcSimulatorEnabled ||
        current.config.environment === "production" ||
        (fixture !== "demo" && fixture !== "standard") ||
        !state ||
        !transactionSecrets ||
        transactionSecrets.state !== state ||
        !sameSecret(ticket, simulatorTicket(current.config, state, fixture))
      ) {
        throw new ApplicationFault(
          404,
          "route-not-found",
          "MB-404-ROUTE",
          "Route not found.",
        );
      }
      const issued = await inTransaction(current.pool, async (client) => {
        const found = await client.query<{
          oauth_transaction_id: string;
          state_hash: Buffer;
          nonce_hash: Buffer;
          pkce_verifier_hash: Buffer;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          `SELECT oauth_transaction_id, state_hash, nonce_hash, pkce_verifier_hash,
                  expires_at, consumed_at
             FROM oauth_transaction
            WHERE state_hash = $1 AND simulator = true
            FOR UPDATE`,
          [Buffer.from(sha256Base64Url(state), "base64url")],
        );
        const transaction = found.rows[0];
        if (!transaction)
          throw new ApplicationFault(
            403,
            "resource-not-visible",
            "MB-403-REQUEST",
            "Request refused.",
          );
        try {
          validateOidcTransaction(
            {
              stateHash: transaction.state_hash.toString("base64url"),
              nonceHash: transaction.nonce_hash.toString("base64url"),
              verifierHash:
                transaction.pkce_verifier_hash.toString("base64url"),
              expiresAt: transaction.expires_at,
              ...(transaction.consumed_at
                ? { consumedAt: transaction.consumed_at }
                : {}),
            },
            {
              state,
              nonce: transactionSecrets.nonce,
              verifier: transactionSecrets.verifier,
            },
          );
        } catch {
          throw new ApplicationFault(
            403,
            "resource-not-visible",
            "MB-403-REQUEST",
            "Request refused.",
          );
        }
        await client.query(
          "UPDATE oauth_transaction SET consumed_at = clock_timestamp() WHERE oauth_transaction_id = $1",
          [transaction.oauth_transaction_id],
        );
        return simulatorSession(current, correlationId, client, {
          subject: `simulator-${fixture}-subject-v1:${current.config.deploymentId}`,
          displayName:
            fixture === "standard" ? "Synthetic Standard" : "Synthetic Demo",
          email: `${fixture}@example.invalid`,
          emailVerified: true,
          simulator: true,
          tier: fixture,
        });
      });
      const headers = responseHeaders(current.config, correlationId, {
        Location: "/",
      });
      headers.append(
        "Set-Cookie",
        `${sessionCookieName(current.config)}=${encodeURIComponent(issued.handle)}; ${sessionCookieAttributes(current.config, true)}`,
      );
      headers.append(
        "Set-Cookie",
        `${csrfCookieName(current.config)}=${encodeURIComponent(issued.csrf)}; ${sessionCookieAttributes(current.config, false)}`,
      );
      headers.append(
        "Set-Cookie",
        `${SIMULATOR_TRANSACTION_COOKIE}=; ${sessionCookieAttributes(current.config, true)}; Max-Age=0`,
      );
      return new Response(null, { status: 303, headers });
    }
    if (request.method === "GET" && path === "/auth/google/start") {
      if (!current.googleProvider || !current.config.googleRedirectUri) {
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
      await current.pool.query(
        `INSERT INTO oauth_transaction
           (oauth_transaction_id, state_hash, nonce_hash, pkce_verifier_hash,
            redirect_uri, environment, simulator, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,false,clock_timestamp() + interval '5 minutes')`,
        [
          randomUUID(),
          Buffer.from(sha256Base64Url(transaction.state), "base64url"),
          Buffer.from(sha256Base64Url(transaction.nonce), "base64url"),
          Buffer.from(sha256Base64Url(transaction.verifier), "base64url"),
          current.config.googleRedirectUri,
          current.config.environment,
        ],
      );
      const headers = responseHeaders(current.config, correlationId, {
        Location: current.googleProvider.authorizationUrl({
          state: transaction.state,
          nonce: transaction.nonce,
          challenge: transaction.challenge,
        }),
      });
      headers.append(
        "Set-Cookie",
        `${GOOGLE_TRANSACTION_COOKIE}=${encodeURIComponent(sealedTransaction(current.config, transaction))}; ${sessionCookieAttributes(current.config, true)}; Max-Age=300`,
      );
      return new Response(null, { status: 302, headers });
    }
    if (request.method === "GET" && path === "/auth/google/callback") {
      const transaction = openTransaction(
        current.config,
        cookie(request, GOOGLE_TRANSACTION_COOKIE),
      );
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (!current.googleProvider || !transaction || !state || !code) {
        throw new ApplicationFault(
          401,
          "session-required",
          "MB-401-OIDC",
          "Google sign-in failed.",
        );
      }
      const issued = await inTransaction(current.pool, async (client) => {
        const found = await client.query<{
          oauth_transaction_id: string;
          state_hash: Buffer;
          nonce_hash: Buffer;
          pkce_verifier_hash: Buffer;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          `SELECT oauth_transaction_id, state_hash, nonce_hash, pkce_verifier_hash,
                  expires_at, consumed_at
             FROM oauth_transaction
            WHERE state_hash = $1 AND simulator = false
            FOR UPDATE`,
          [Buffer.from(sha256Base64Url(state), "base64url")],
        );
        const stored = found.rows[0];
        if (!stored)
          throw new ApplicationFault(
            401,
            "session-required",
            "MB-401-OIDC",
            "Google sign-in failed.",
          );
        try {
          validateOidcTransaction(
            {
              stateHash: stored.state_hash.toString("base64url"),
              nonceHash: stored.nonce_hash.toString("base64url"),
              verifierHash: stored.pkce_verifier_hash.toString("base64url"),
              expiresAt: stored.expires_at,
              ...(stored.consumed_at ? { consumedAt: stored.consumed_at } : {}),
            },
            {
              state,
              nonce: transaction.nonce,
              verifier: transaction.verifier,
            },
          );
        } catch {
          throw new ApplicationFault(
            401,
            "session-required",
            "MB-401-OIDC",
            "Google sign-in failed.",
          );
        }
        const identity = await current.googleProvider!.complete({
          code,
          nonce: transaction.nonce,
          verifier: transaction.verifier,
        });
        await client.query(
          "UPDATE oauth_transaction SET consumed_at = clock_timestamp() WHERE oauth_transaction_id = $1",
          [stored.oauth_transaction_id],
        );
        return simulatorSession(current, correlationId, client, {
          ...identity,
          displayName: "Google user",
          simulator: false,
          tier: "demo",
        });
      });
      const headers = responseHeaders(current.config, correlationId, {
        Location: "/",
      });
      headers.append(
        "Set-Cookie",
        `${sessionCookieName(current.config)}=${encodeURIComponent(issued.handle)}; ${sessionCookieAttributes(current.config, true)}`,
      );
      headers.append(
        "Set-Cookie",
        `${csrfCookieName(current.config)}=${encodeURIComponent(issued.csrf)}; ${sessionCookieAttributes(current.config, false)}`,
      );
      headers.append(
        "Set-Cookie",
        `${GOOGLE_TRANSACTION_COOKIE}=; ${sessionCookieAttributes(current.config, true)}; Max-Age=0`,
      );
      return new Response(null, { status: 303, headers });
    }

    session = await sessionFor(request, current, correlationId, path);
    const idempotencyKey =
      request.method === "POST" ? unsafeKey(request, current, session) : null;

    if (request.method === "POST" && path === "/auth/logout") {
      await inTransaction(current.pool, async (client) => {
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
          deploymentId: current.config.deploymentId,
          detail: { reasonCode: "logout" },
        });
      });
      const logoutHeaders = responseHeaders(current.config, correlationId);
      logoutHeaders.append(
        "Set-Cookie",
        `${sessionCookieName(current.config)}=; ${sessionCookieAttributes(current.config, true)}; Max-Age=0`,
      );
      logoutHeaders.append(
        "Set-Cookie",
        `${csrfCookieName(current.config)}=; ${sessionCookieAttributes(current.config, false)}; Max-Age=0`,
      );
      return new Response(null, { status: 204, headers: logoutHeaders });
    }
    if (request.method === "GET" && path === "/api/v1/me") {
      assertSlice1EndpointAuthorized(session.requestContext, "GET /api/v1/me");
      const csrfToken = cookie(request, csrfCookieName(current.config));
      if (!csrfToken || sha256Base64Url(csrfToken) !== session.csrfHash) {
        throw new ApplicationFault(
          401,
          "session-required",
          "MB-401-SESSION",
          "A valid session is required.",
        );
      }
      const body = {
        ...(await current.application.me(session.requestContext)),
        csrf_token: csrfToken,
        environment: current.config.environment,
      };
      await current.application.recordDisclosure(
        session.requestContext,
        "identity.projected",
        "app_user",
        session.requestContext.userId,
      );
      return json(current.config, correlationId, body);
    }
    const standardMutationIntent =
      session.requestContext.tier === "demo" &&
      isSharedWorkspaceMutation(request.method, path) &&
      isStandardMutationIntent(request.method, path, await readRequestBody());
    if (
      session.requestContext.tier !== "demo" ||
      path.startsWith("/api/v1/domain-packs/") ||
      standardMutationIntent
    ) {
      const standard = await handleStandardRoute({
        method: request.method,
        pathname: path,
        searchParams: url.searchParams,
        headers: request.headers,
        body: readRequestBody,
        context: session.requestContext,
        idempotencyKey,
        application: current.standardApplication,
      });
      if (standard) {
        if (standard.status === 304) {
          return new Response(null, {
            status: 304,
            headers: responseHeaders(
              current.config,
              correlationId,
              standard.headers,
            ),
          });
        }
        return json(
          current.config,
          correlationId,
          standard.body,
          standard.status,
          standard.headers,
        );
      }
    }
    if (request.method === "POST" && path === "/api/v1/requests") {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "POST /api/v1/requests",
      );
      const input = await readRequestBody();
      assertClosedDto(
        input,
        ["source_text", "presented_fields", "unknown_fields"],
        "Submitted intake is invalid.",
      );
      const presentedFields = stringArray(
        input.presented_fields,
        new Set(["need", "mandatory_constraints", "preferences_context"]),
        "Submitted intake is invalid.",
      );
      if (presentedFields.length !== 3)
        schemaFault("Submitted intake is invalid.");
      const unknownFields = stringArray(
        input.unknown_fields,
        new Set(["preferences_context"]),
        "Submitted intake is invalid.",
      );
      const result = await current.application.createRequest(
        session.requestContext,
        idempotencyKey!,
        {
          sourceText: sourceText(input.source_text),
          fixtureCanonicalText:
            "Synthetic industrial sourcing request for local evaluation",
          fixtureCanonicalFields: [
            {
              fieldId: "need",
              path: "product.need",
              valueState: "provided",
              languageOrigin: "translated",
              canonicalValue: "Synthetic industrial sourcing need",
            },
            {
              fieldId: "mandatory_constraints",
              path: "product.mandatory_constraints",
              valueState: "provided",
              languageOrigin: "translated",
              canonicalValue: "Synthetic mandatory constraints",
            },
            {
              fieldId: "preferences_context",
              path: "commercial.preferences_context",
              valueState: unknownFields.includes("preferences_context")
                ? "explicitly_unknown"
                : "provided",
              languageOrigin: "translated",
              canonicalValue: unknownFields.includes("preferences_context")
                ? "Unknown"
                : "Synthetic preferences and context",
            },
          ],
          presentedFields,
        } satisfies IntakeInput,
      );
      return json(
        current.config,
        correlationId,
        result,
        201,
        result.idempotent_replay
          ? { "MB-Idempotent-Replay": "true" }
          : undefined,
      );
    }
    const requestMatch = /^\/api\/v1\/requests\/([^/]+)$/u.exec(path);
    if (request.method === "GET" && requestMatch) {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "GET /api/v1/requests/:requestId",
      );
      const requestId = visibleUuid(requestMatch[1]!);
      const body = await current.application.getRequest(
        session.requestContext,
        requestId,
      );
      await current.application.recordDisclosure(
        session.requestContext,
        "request.projected",
        "sourcing_request",
        requestId,
      );
      return json(current.config, correlationId, body);
    }
    const versionMatch = /^\/api\/v1\/requests\/([^/]+)\/versions$/u.exec(path);
    if (request.method === "POST" && versionMatch) {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "POST /api/v1/requests/:requestId/versions",
      );
      const requestId = visibleUuid(versionMatch[1]!);
      await current.application.assertRequestVisible(
        session.requestContext,
        requestId,
      );
      const input = await readRequestBody();
      assertClosedDto(
        input,
        ["canonical_text", "fields", "readiness"],
        "Canonical revision is invalid.",
      );
      if (
        typeof input.canonical_text !== "string" ||
        !input.canonical_text.trim() ||
        Buffer.byteLength(input.canonical_text, "utf8") > 20_000 ||
        !["ready", "partially_ready", "not_ready"].includes(
          input.readiness as string,
        )
      ) {
        schemaFault("Canonical revision is invalid.");
      }
      return json(
        current.config,
        correlationId,
        await current.application.createVersion(
          session.requestContext,
          requestId,
          {
            canonicalText: input.canonical_text,
            fields: canonicalFields(input.fields),
            readiness: input.readiness as CanonicalRevisionInput["readiness"],
          },
        ),
        201,
      );
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
      const requestId = visibleUuid(confirmationMatch[1]!);
      await current.application.assertRequestVisible(
        session.requestContext,
        requestId,
      );
      const input = await readRequestBody();
      assertClosedDto(input, ["accepted"], "Confirmation is invalid.");
      if (typeof input.accepted !== "boolean")
        schemaFault("Confirmation is invalid.");
      return json(
        current.config,
        correlationId,
        await current.application.confirmVersion(
          session.requestContext,
          requestId,
          Number(confirmationMatch[2]),
          input.accepted === true,
        ),
      );
    }
    if (request.method === "POST" && path === "/api/v1/runs") {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "POST /api/v1/runs",
      );
      const input = await readRequestBody();
      assertClosedDto(
        input,
        ["request_id", "version"],
        "Run input is invalid.",
      );
      const requestId = visibleUuid(
        typeof input.request_id === "string" ? input.request_id : "",
      );
      if (
        typeof input.version !== "number" ||
        !Number.isSafeInteger(input.version) ||
        input.version < 1
      ) {
        schemaFault("Run input is invalid.");
      }
      const result = await current.application.submitRun(
        session.requestContext,
        idempotencyKey!,
        {
          requestId,
          version: input.version,
        },
      );
      const status = await current.application.getRunStatus(
        session.requestContext,
        String(result.run_id),
      );
      return json(
        current.config,
        correlationId,
        {
          ...status,
          quota: result.quota,
          research_mode: result.research_mode,
        },
        202,
        result.idempotent_replay
          ? { "MB-Idempotent-Replay": "true" }
          : undefined,
      );
    }
    if (request.method === "GET" && path === "/api/v1/runs") {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "GET /api/v1/runs",
      );
      const body = await current.application.listRuns(
        session.requestContext,
        url.searchParams.get("cursor") ?? undefined,
      );
      await current.application.recordDisclosure(
        session.requestContext,
        "run.list.projected",
        "research_run",
      );
      return json(current.config, correlationId, body);
    }
    const resultMatch = /^\/api\/v1\/runs\/([^/]+)\/result$/u.exec(path);
    if (request.method === "GET" && resultMatch) {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "GET /api/v1/runs/:runId/result",
      );
      const disclosure = await current.application.getRunResult(
        session.requestContext,
        visibleUuid(resultMatch[1]!),
      );
      return json(current.config, correlationId, disclosure.body);
    }
    const cancellationMatch = /^\/api\/v1\/runs\/([^/]+)\/cancellation$/u.exec(
      path,
    );
    if (request.method === "POST" && cancellationMatch) {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "POST /api/v1/runs/:runId/cancellation",
      );
      return json(
        current.config,
        correlationId,
        await current.application.cancelRun(
          session.requestContext,
          visibleUuid(cancellationMatch[1]!),
        ),
        202,
      );
    }
    const runMatch = /^\/api\/v1\/runs\/([^/]+)$/u.exec(path);
    if (request.method === "GET" && runMatch) {
      assertSlice1EndpointAuthorized(
        session.requestContext,
        "GET /api/v1/runs/:runId",
      );
      const runId = visibleUuid(runMatch[1]!);
      const status = await current.application.getRunStatus(
        session.requestContext,
        runId,
      );
      await current.application.recordDisclosure(
        session.requestContext,
        "run.status.projected",
        "research_run",
        runId,
      );
      const etag = `"${createHash("sha256").update(`${status.state}:${status.progress.monotonic_sequence}`).digest("base64url")}"`;
      const polling =
        status.poll_after_ms === null ? "0" : String(status.poll_after_ms);
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: responseHeaders(current.config, correlationId, {
            ETag: etag,
            "MB-Poll-After-Ms": polling,
          }),
        });
      }
      return json(current.config, correlationId, status, 200, {
        ETag: etag,
        "MB-Poll-After-Ms": polling,
      });
    }
    throw new ApplicationFault(
      404,
      "route-not-found",
      "MB-404-ROUTE",
      "Route not found.",
    );
  } catch (error) {
    const fault =
      error instanceof ApplicationFault
        ? error
        : new ApplicationFault(
            500,
            "internal",
            "MB-500-INTERNAL",
            "The request could not be completed.",
            true,
          );
    if (session && !fault.auditRecorded) {
      try {
        await auditDenied(current, session, path, fault);
      } catch {
        const auditFault = new ApplicationFault(
          503,
          "audit-unavailable",
          "MB-503-AUDIT",
          "Audit persistence is unavailable.",
          true,
        );
        return json(
          current.config,
          correlationId,
          faultBody(auditFault, correlationId),
          auditFault.status,
        );
      }
    }
    return json(
      current.config,
      correlationId,
      faultBody(fault, correlationId),
      fault.status,
      fault.headers,
    );
  }
}
