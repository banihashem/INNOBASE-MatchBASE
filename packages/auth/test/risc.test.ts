import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  GOOGLE_RISC_EVENT_TYPES,
  verifyGoogleRiscSecurityEventToken,
} from "../src/risc";

const issuer = "https://accounts.google.com";
const audience = "client-id.apps.googleusercontent.com";

async function fixture(
  payload: Record<string, unknown>,
  key: KeyObject,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
    .sign(key);
}

describe("Google RISC security event validation", () => {
  it("verifies a session revocation and returns the Google subject", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = await fixture(
      {
        iss: issuer,
        aud: audience,
        iat: 1_700_000_000,
        jti: "event-1",
        events: {
          [GOOGLE_RISC_EVENT_TYPES.sessionsRevoked]: {
            subject: {
              subject_type: "iss-sub",
              iss: `${issuer}/`,
              sub: "google-subject-1",
            },
          },
        },
      },
      privateKey,
    );
    await expect(
      verifyGoogleRiscSecurityEventToken({
        token,
        key: publicKey,
        issuer,
        audiences: [audience],
      }),
    ).resolves.toMatchObject({
      eventId: "event-1",
      googleSubject: "google-subject-1",
      terminateSessions: true,
    });
  });

  it("accepts an old historical event without enforcing expiration", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = await fixture(
      {
        iss: issuer,
        aud: audience,
        iat: 1,
        exp: 2,
        jti: "verification-1",
        events: {
          [GOOGLE_RISC_EVENT_TYPES.verification]: { state: "stream-check" },
        },
      },
      privateKey,
    );
    await expect(
      verifyGoogleRiscSecurityEventToken({
        token,
        key: publicKey,
        issuer,
        audiences: [audience],
      }),
    ).resolves.toMatchObject({
      verificationState: "stream-check",
      terminateSessions: false,
    });
  });

  it("accepts the official singular token-revoked OAuth subject without inventing a user", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = await fixture(
      {
        iss: issuer,
        aud: audience,
        iat: 1_700_000_000,
        jti: "token-revoked-1",
        events: {
          [GOOGLE_RISC_EVENT_TYPES.tokenRevoked]: {
            subject: {
              subject_type: "oauth_token",
              token_type: "refresh_token",
              token_identifier_alg: "prefix",
              token: "1234567890abcdef",
            },
          },
        },
      },
      privateKey,
    );
    await expect(
      verifyGoogleRiscSecurityEventToken({
        token,
        key: publicKey,
        issuer,
        audiences: [audience],
      }),
    ).resolves.toMatchObject({
      eventType: GOOGLE_RISC_EVENT_TYPES.tokenRevoked,
      oauthTokenIdentifier: {
        algorithm: "prefix",
        value: "1234567890abcdef",
      },
      terminateSessions: false,
    });
  });

  it("rejects wrong audiences, top-level subjects, and unsupported events", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const variants = [
      {
        aud: "wrong-client",
        eventType: GOOGLE_RISC_EVENT_TYPES.sessionsRevoked,
      },
      {
        aud: audience,
        eventType: GOOGLE_RISC_EVENT_TYPES.sessionsRevoked,
        sub: "forbidden-top-level-subject",
      },
      { aud: audience, eventType: "https://attacker.example/event" },
    ];
    for (const variant of variants) {
      const token = await fixture(
        {
          iss: issuer,
          aud: variant.aud,
          iat: 1_700_000_000,
          jti: "event-invalid",
          ...(variant.sub ? { sub: variant.sub } : {}),
          events: {
            [variant.eventType]: {
              subject: {
                subject_type: "iss-sub",
                iss: issuer,
                sub: "google-subject-1",
              },
            },
          },
        },
        privateKey,
      );
      await expect(
        verifyGoogleRiscSecurityEventToken({
          token,
          key: publicKey,
          issuer,
          audiences: [audience],
        }),
      ).rejects.toThrow(/RISC security event/iu);
    }
  });

  it("rejects a token signed by an untrusted key", async () => {
    const trusted = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const untrusted = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = await fixture(
      {
        iss: issuer,
        aud: audience,
        iat: 1_700_000_000,
        jti: "event-untrusted",
        events: {
          [GOOGLE_RISC_EVENT_TYPES.sessionsRevoked]: {
            subject: {
              subject_type: "iss-sub",
              iss: issuer,
              sub: "google-subject-1",
            },
          },
        },
      },
      untrusted.privateKey,
    );
    await expect(
      verifyGoogleRiscSecurityEventToken({
        token,
        key: trusted.publicKey,
        issuer,
        audiences: [audience],
      }),
    ).rejects.toThrow();
  });
});
