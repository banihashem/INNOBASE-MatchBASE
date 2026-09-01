import { generateKeyPairSync } from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  ADMIN_SUB_ROLES,
  PERSISTED_TIERS,
  assertRuntimeIdentityPolicy,
  assertSession,
  assertUnsafeRequest,
  createGoogleOidcAdapter,
  createOpaqueSecret,
  createPkceTransaction,
  issueSession,
  resolveAuthorization,
  sha256Base64Url,
  validateOidcTransaction,
  verifyOidcIdToken,
} from "../src/index.js";

describe("OIDC and local-mode boundaries", () => {
  it("wires authorization-code PKCE through token exchange and verified JWKS identity", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = await new SignJWT({
      nonce: "nonce-fixture",
      name: "Verified Operator",
      email: "operator@example.test",
      email_verified: true,
      hd: "example.test",
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer("https://issuer.example.test")
      .setAudience("client-fixture")
      .setSubject("verified-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const jwk = { ...(await exportJWK(publicKey)), kid: "fixture-key" };
    const requests: string[] = [];
    const adapter = createGoogleOidcAdapter(
      {
        clientId: "client-fixture",
        clientSecret: "secret-fixture",
        redirectUri: "https://app.example.test/auth/google/callback",
        authorizationEndpoint: "https://issuer.example.test/authorize",
        tokenEndpoint: "https://issuer.example.test/token",
        issuer: "https://issuer.example.test",
        jwksUri: "https://issuer.example.test/jwks",
      },
      async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/token")) {
          expect(String(init?.body)).toContain(
            "code_verifier=verifier-fixture",
          );
          return Response.json({ id_token: token });
        }
        if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
        return new Response(null, { status: 404 });
      },
    );
    const authorization = new URL(
      adapter.authorizationUrl({
        state: "state-fixture",
        nonce: "nonce-fixture",
        challenge: "challenge-fixture",
      }),
    );
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("state")).toBe("state-fixture");
    await expect(
      adapter.complete({
        code: "code-fixture",
        nonce: "nonce-fixture",
        verifier: "verifier-fixture",
      }),
    ).resolves.toEqual({
      subject: "verified-subject",
      displayName: "Verified Operator",
      email: "operator@example.test",
      emailVerified: true,
      hostedDomain: "example.test",
    });
    expect(requests).toEqual([
      "https://issuer.example.test/token",
      "https://issuer.example.test/jwks",
    ]);
  });

  it("creates PKCE S256 and fails replay, expiry, and binding mismatches", () => {
    const pkce = createPkceTransaction();
    expect(pkce.method).toBe("S256");
    expect(pkce.challenge).toBe(sha256Base64Url(pkce.verifier));
    const base = {
      stateHash: sha256Base64Url(pkce.state),
      nonceHash: sha256Base64Url(pkce.nonce),
      verifierHash: sha256Base64Url(pkce.verifier),
      expiresAt: new Date("2030-01-01T00:05:00Z"),
    };
    const supplied = {
      state: pkce.state,
      nonce: pkce.nonce,
      verifier: pkce.verifier,
    };
    expect(() =>
      validateOidcTransaction(base, supplied, new Date("2030-01-01Z")),
    ).not.toThrow();
    expect(() =>
      validateOidcTransaction({ ...base, consumedAt: new Date() }, supplied),
    ).toThrow(/replay/);
    expect(() =>
      validateOidcTransaction({ ...base, expiresAt: new Date(0) }, supplied),
    ).toThrow(/expired/);
    expect(() =>
      validateOidcTransaction(
        base,
        { ...supplied, state: "wrong" },
        new Date("2030-01-01Z"),
      ),
    ).toThrow(/binding/);
  });

  it("verifies signature, issuer, audience, expiry and nonce", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = await new SignJWT({ nonce: "expected" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience("matchbase-local")
      .setSubject("synthetic-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifyOidcIdToken({
        token,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).resolves.toMatchObject({ subject: "synthetic-subject" });
    await expect(
      verifyOidcIdToken({
        token,
        key: publicKey,
        issuer: "https://wrong.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).rejects.toThrow();
    await expect(
      verifyOidcIdToken({
        token,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "wrong",
        expectedNonce: "expected",
      }),
    ).rejects.toThrow();
    await expect(
      verifyOidcIdToken({
        token,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "wrong",
      }),
    ).rejects.toThrow(/nonce/);

    const { publicKey: forgedKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    await expect(
      verifyOidcIdToken({
        token,
        key: forgedKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).rejects.toThrow();

    const expired = await new SignJWT({ nonce: "expected" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience("matchbase-local")
      .setSubject("synthetic-subject")
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey);
    await expect(
      verifyOidcIdToken({
        token: expired,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).rejects.toThrow();

    const missingNonce = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience("matchbase-local")
      .setSubject("synthetic-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifyOidcIdToken({
        token: missingNonce,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).rejects.toThrow(/nonce is missing/);

    const missingExpiration = await new SignJWT({ nonce: "expected" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience("matchbase-local")
      .setSubject("synthetic-subject")
      .setIssuedAt()
      .sign(privateKey);
    await expect(
      verifyOidcIdToken({
        token: missingExpiration,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).rejects.toThrow();
  });

  it("releases profile claims only from the verified token and withholds an unverified email", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = await new SignJWT({
      nonce: "expected",
      name: "  Verified   User  ",
      email: "unverified@example.test",
      email_verified: false,
      hd: "example.test",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience("matchbase-local")
      .setSubject("synthetic-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifyOidcIdToken({
        token,
        key: publicKey,
        issuer: "https://issuer.example.test",
        audience: "matchbase-local",
        expectedNonce: "expected",
      }),
    ).resolves.toEqual({
      issuer: "https://issuer.example.test",
      subject: "synthetic-subject",
      audience: "matchbase-local",
      displayName: "Verified User",
      hostedDomain: "example.test",
    });
  });

  it("refuses simulator or fixtures in production", () => {
    expect(() =>
      assertRuntimeIdentityPolicy({
        environment: "production",
        oidcSimulatorEnabled: true,
        syntheticFixtureEnabled: false,
      }),
    ).toThrow(/Production startup refused/);
    expect(() =>
      assertRuntimeIdentityPolicy({
        environment: "production",
        oidcSimulatorEnabled: false,
        syntheticFixtureEnabled: true,
      }),
    ).toThrow(/Production startup refused/);
    expect(() =>
      assertRuntimeIdentityPolicy({
        environment: "test",
        oidcSimulatorEnabled: true,
        syntheticFixtureEnabled: true,
      }),
    ).not.toThrow();
  });
});

describe("sessions, unsafe requests, and stored grants", () => {
  it("stores only opaque hashes and refuses expired/revoked/replayed handles", () => {
    const issued = issueSession();
    expect(issued.persisted.handleHash).not.toContain(issued.handle);
    expect(() =>
      assertSession(
        { ...issued.persisted, expiresAt: new Date("2030-01-01Z") },
        issued.handle,
        new Date("2029-01-01Z"),
      ),
    ).not.toThrow();
    expect(() =>
      assertSession(
        { ...issued.persisted, expiresAt: new Date(0) },
        issued.handle,
      ),
    ).toThrow(/expired/);
    expect(() =>
      assertSession(
        {
          ...issued.persisted,
          expiresAt: new Date("2030-01-01Z"),
          revokedAt: new Date(),
        },
        issued.handle,
      ),
    ).toThrow(/revoked/);
    expect(() =>
      assertSession(
        { ...issued.persisted, expiresAt: new Date("2030-01-01Z") },
        createOpaqueSecret(),
        new Date("2029-01-01Z"),
      ),
    ).toThrow(/refused/);
  });

  it("requires exact Origin and session-bound CSRF", () => {
    const csrf = createOpaqueSecret();
    const input = {
      expectedOrigin: "http://127.0.0.1:3000",
      suppliedOrigin: "http://127.0.0.1:3000",
      csrfHash: sha256Base64Url(csrf),
      suppliedCsrf: csrf,
    };
    expect(() => assertUnsafeRequest(input)).not.toThrow();
    expect(() =>
      assertUnsafeRequest({
        ...input,
        suppliedOrigin: "https://attacker.test",
      }),
    ).toThrow(/Origin/);
    expect(() =>
      assertUnsafeRequest({ ...input, suppliedCsrf: "wrong" }),
    ).toThrow(/CSRF/);
  });

  it("ignores client claims and resolves all authority from stored grants", () => {
    const stored = [
      {
        accountId: "account-a",
        userId: "user-a",
        tier: "demo",
        adminSubRoles: [],
        active: true,
      },
    ] as const;
    expect(resolveAuthorization(stored, "account-a", "user-a")).toMatchObject({
      tier: "demo",
      adminSubRoles: [],
    });
    expect(() => resolveAuthorization(stored, "account-b", "user-a")).toThrow(
      /refused/,
    );
  });

  it("resolves all four stored tiers and exactly six Admin sub-roles without client authority", () => {
    expect(PERSISTED_TIERS).toEqual([
      "demo",
      "standard",
      "consultant",
      "admin",
    ]);
    expect(ADMIN_SUB_ROLES).toEqual([
      "support",
      "analyst",
      "consultant_manager",
      "product",
      "security_audit",
      "super_admin",
    ]);
    for (const tier of PERSISTED_TIERS) {
      const grant = {
        accountId: `account-${tier}`,
        userId: `user-${tier}`,
        tier,
        adminSubRoles: tier === "admin" ? ADMIN_SUB_ROLES : [],
        active: true,
      } as const;
      expect(
        resolveAuthorization([grant], grant.accountId, grant.userId),
      ).toEqual(grant);
    }
  });
});
