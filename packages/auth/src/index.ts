import {
  createHash,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from "jose";
import type { AdminSubRole, PersistedTier } from "@matchbase/contracts";

export * from "./risc";

export {
  ADMIN_SUB_ROLES,
  PERSISTED_TIERS,
  type AdminSubRole,
  type PersistedTier,
} from "@matchbase/contracts";

export type RuntimeEnvironment = "local" | "test" | "production";

export interface RuntimeIdentityPolicy {
  environment: RuntimeEnvironment;
  oidcSimulatorEnabled: boolean;
  syntheticFixtureEnabled: boolean;
}

export function assertRuntimeIdentityPolicy(
  policy: RuntimeIdentityPolicy,
): void {
  if (
    policy.environment === "production" &&
    (policy.oidcSimulatorEnabled || policy.syntheticFixtureEnabled)
  ) {
    throw new Error(
      "Production startup refused: local identity or synthetic fixture mode is enabled.",
    );
  }
}

export function createOpaqueSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function createPkceTransaction(): {
  verifier: string;
  challenge: string;
  method: "S256";
  state: string;
  nonce: string;
} {
  const verifier = createOpaqueSecret(48);
  return {
    verifier,
    challenge: sha256Base64Url(verifier),
    method: "S256",
    state: createOpaqueSecret(),
    nonce: createOpaqueSecret(),
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export interface StoredOidcTransaction {
  stateHash: string;
  nonceHash: string;
  verifierHash: string;
  expiresAt: Date;
  consumedAt?: Date;
}

export function validateOidcTransaction(
  transaction: StoredOidcTransaction,
  supplied: { state: string; nonce: string; verifier: string },
  now = new Date(),
): void {
  if (transaction.consumedAt)
    throw new Error("OIDC transaction replay refused.");
  if (transaction.expiresAt.getTime() <= now.getTime()) {
    throw new Error("OIDC transaction expired.");
  }
  const comparisons = [
    [transaction.stateHash, sha256Base64Url(supplied.state)],
    [transaction.nonceHash, sha256Base64Url(supplied.nonce)],
    [transaction.verifierHash, sha256Base64Url(supplied.verifier)],
  ] as const;
  if (
    !comparisons.every(([expected, actual]) =>
      constantTimeEqual(expected, actual),
    )
  ) {
    throw new Error("OIDC transaction binding failed.");
  }
}

export interface VerifiedOidcIdentity {
  issuer: string;
  subject: string;
  audience: string | string[];
}

export async function verifyOidcIdToken(input: {
  token: string;
  key: KeyObject | JWK | Uint8Array | JWTVerifyGetKey;
  issuer: string;
  audience: string;
  expectedNonce: string;
  now?: Date;
}): Promise<VerifiedOidcIdentity> {
  const options: JWTVerifyOptions = {
    issuer: input.issuer,
    audience: input.audience,
    algorithms: ["RS256", "ES256"],
    requiredClaims: ["exp", "iat", "sub"],
    ...(input.now ? { currentDate: input.now } : {}),
  };
  const { payload } = await jwtVerify(input.token, input.key, options);
  if (!payload.sub) throw new Error("OIDC subject is missing.");
  if (typeof payload.nonce !== "string")
    throw new Error("OIDC nonce is missing.");
  if (!constantTimeEqual(payload.nonce, input.expectedNonce)) {
    throw new Error("OIDC nonce mismatch.");
  }
  if (!payload.aud) throw new Error("OIDC audience is missing.");
  return {
    issuer: payload.iss ?? "",
    subject: payload.sub,
    audience: payload.aud,
  };
}

export interface GoogleOidcAdapterConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  issuer: string;
  jwksUri: string;
}

export interface GoogleOidcIdentity {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  hostedDomain?: string;
}

export function createGoogleOidcAdapter(
  config: GoogleOidcAdapterConfig,
  fetchImplementation: typeof fetch = fetch,
): {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    challenge: string;
  }): string;
  complete(input: {
    code: string;
    nonce: string;
    verifier: string;
  }): Promise<GoogleOidcIdentity>;
} {
  const remoteKeys = createRemoteJWKSet(new URL(config.jwksUri), {
    [customFetch]: fetchImplementation,
  });
  return {
    authorizationUrl(input) {
      const url = new URL(config.authorizationEndpoint);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        code_challenge: input.challenge,
        code_challenge_method: "S256",
        state: input.state,
        nonce: input.nonce,
      }).toString();
      return url.toString();
    },
    async complete(input) {
      const response = await fetchImplementation(config.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          code: input.code,
          code_verifier: input.verifier,
        }),
        redirect: "error",
      });
      if (!response.ok) throw new Error("OIDC token exchange failed.");
      const token = (await response.json()) as Record<string, unknown>;
      if (typeof token.id_token !== "string")
        throw new Error("OIDC ID token is missing.");
      const identity = await verifyOidcIdToken({
        token: token.id_token,
        key: remoteKeys,
        issuer: config.issuer,
        audience: config.clientId,
        expectedNonce: input.nonce,
      });
      return { subject: identity.subject };
    },
  };
}

export interface SessionRecord {
  handleHash: string;
  csrfHash: string;
  expiresAt: Date;
  revokedAt?: Date;
}

export function issueSession(): {
  handle: string;
  csrfToken: string;
  persisted: Pick<SessionRecord, "handleHash" | "csrfHash">;
} {
  const handle = createOpaqueSecret();
  const csrfToken = createOpaqueSecret();
  return {
    handle,
    csrfToken,
    persisted: {
      handleHash: sha256Base64Url(handle),
      csrfHash: sha256Base64Url(csrfToken),
    },
  };
}

export function assertSession(
  record: SessionRecord,
  suppliedHandle: string,
  now = new Date(),
): void {
  if (record.revokedAt) throw new Error("Session revoked.");
  if (record.expiresAt.getTime() <= now.getTime())
    throw new Error("Session expired.");
  if (!constantTimeEqual(record.handleHash, sha256Base64Url(suppliedHandle))) {
    throw new Error("Session refused.");
  }
}

export function assertUnsafeRequest(input: {
  expectedOrigin: string;
  suppliedOrigin: string | null;
  csrfHash: string;
  suppliedCsrf: string | null;
}): void {
  if (!input.suppliedOrigin || input.suppliedOrigin !== input.expectedOrigin) {
    throw new Error("Origin refused.");
  }
  if (
    !input.suppliedCsrf ||
    !constantTimeEqual(input.csrfHash, sha256Base64Url(input.suppliedCsrf))
  ) {
    throw new Error("CSRF refused.");
  }
}

export interface StoredGrant {
  accountId: string;
  userId: string;
  tier: PersistedTier;
  adminSubRoles: readonly AdminSubRole[];
  active: boolean;
}

export function resolveAuthorization(
  grants: readonly StoredGrant[],
  accountId: string,
  userId: string,
): StoredGrant {
  const grant = grants.find(
    (candidate) =>
      candidate.active &&
      candidate.accountId === accountId &&
      candidate.userId === userId,
  );
  if (!grant) throw new Error("Authorization refused.");
  return grant;
}
