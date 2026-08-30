import { type KeyObject } from "node:crypto";
import {
  compactVerify,
  createRemoteJWKSet,
  customFetch,
  type CompactVerifyGetKey,
  type JWK,
} from "jose";

export const GOOGLE_RISC_EVENT_TYPES = Object.freeze({
  sessionsRevoked:
    "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
  tokensRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  tokenRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
  accountDisabled:
    "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  accountEnabled:
    "https://schemas.openid.net/secevent/risc/event-type/account-enabled",
  credentialChangeRequired:
    "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
  verification:
    "https://schemas.openid.net/secevent/risc/event-type/verification",
} as const);

const EVENT_TYPES = new Set<string>(Object.values(GOOGLE_RISC_EVENT_TYPES));

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export interface VerifiedGoogleRiscEvent {
  readonly issuer: string;
  readonly audience: string;
  readonly issuedAt: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly googleSubject?: string;
  readonly oauthTokenIdentifier?: {
    readonly algorithm: "prefix" | "hash_base64_sha512_sha512";
    readonly value: string;
  };
  readonly terminateSessions: boolean;
  readonly reason?: string;
  readonly verificationState?: string;
}

export function createGoogleRiscVerifier(
  config: {
    readonly issuer: string;
    readonly jwksUri: string;
    readonly audiences: readonly string[];
  },
  fetchImplementation: typeof fetch = fetch,
): { verify(token: string): Promise<VerifiedGoogleRiscEvent> } {
  const remoteKeys = createRemoteJWKSet(new URL(config.jwksUri), {
    [customFetch]: fetchImplementation,
  });
  return Object.freeze({
    verify(token: string) {
      return verifyGoogleRiscSecurityEventToken({
        token,
        key: remoteKeys,
        issuer: config.issuer,
        audiences: config.audiences,
      });
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maximum = 512): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !hasControlCharacter(value)
    ? value
    : undefined;
}

export async function verifyGoogleRiscSecurityEventToken(input: {
  readonly token: string;
  readonly key: KeyObject | JWK | Uint8Array | CompactVerifyGetKey;
  readonly issuer: string;
  readonly audiences: readonly string[];
}): Promise<VerifiedGoogleRiscEvent> {
  if (!input.token || input.token.length > 32_768) {
    throw new Error("RISC security event token is invalid.");
  }
  if (
    !boundedString(input.issuer) ||
    input.audiences.length === 0 ||
    input.audiences.some((audience) => !boundedString(audience))
  ) {
    throw new Error("RISC verifier configuration is invalid.");
  }
  const verified = await compactVerify(input.token, input.key, {
    algorithms: ["RS256"],
  });
  let payload: Record<string, unknown>;
  try {
    payload =
      record(JSON.parse(new TextDecoder().decode(verified.payload))) ?? {};
  } catch {
    throw new Error("RISC security event payload is invalid.");
  }
  const issuer = boundedString(payload.iss);
  const eventId = boundedString(payload.jti);
  if (
    issuer !== input.issuer ||
    typeof payload.aud !== "string" ||
    !input.audiences.includes(payload.aud) ||
    !Number.isSafeInteger(payload.iat) ||
    Number(payload.iat) < 1 ||
    !eventId ||
    "sub" in payload
  ) {
    throw new Error("RISC security event claims are invalid.");
  }
  const events = record(payload.events);
  if (!events || Object.keys(events).length !== 1) {
    throw new Error("RISC security event set must contain exactly one event.");
  }
  const [eventType] = Object.keys(events);
  if (!eventType || !EVENT_TYPES.has(eventType)) {
    throw new Error("RISC security event type is unsupported.");
  }
  const event = record(events[eventType]);
  if (!event) throw new Error("RISC security event body is invalid.");
  const subject = record(event.subject);
  const googleSubject = subject ? boundedString(subject.sub, 255) : undefined;
  let oauthTokenIdentifier: VerifiedGoogleRiscEvent["oauthTokenIdentifier"];
  if (eventType === GOOGLE_RISC_EVENT_TYPES.tokenRevoked) {
    const algorithm = subject?.token_identifier_alg;
    const value = boundedString(subject?.token, 512);
    const validValue =
      algorithm === "prefix"
        ? value?.length === 16
        : algorithm === "hash_base64_sha512_sha512" &&
          value !== undefined &&
          /^(?:[A-Za-z0-9_-]{86}|[A-Za-z0-9+/]{86}==|[A-Za-z0-9+/]{87}=|[A-Za-z0-9+/]{88})$/u.test(
            value,
          );
    if (
      subject?.subject_type !== "oauth_token" ||
      subject.token_type !== "refresh_token" ||
      value === undefined ||
      !validValue ||
      (algorithm !== "prefix" && algorithm !== "hash_base64_sha512_sha512")
    ) {
      throw new Error("RISC OAuth token subject is invalid.");
    }
    oauthTokenIdentifier = { algorithm, value };
  } else if (eventType !== GOOGLE_RISC_EVENT_TYPES.verification) {
    if (
      !subject ||
      !["iss-sub", "id_token_claims"].includes(String(subject.subject_type)) ||
      ![input.issuer, `${input.issuer}/`].includes(String(subject.iss)) ||
      !googleSubject
    ) {
      throw new Error("RISC security event subject is invalid.");
    }
  }
  const reason = boundedString(event.reason, 64);
  const verificationState = boundedString(event.state, 512);
  if (
    eventType === GOOGLE_RISC_EVENT_TYPES.verification &&
    !verificationState
  ) {
    throw new Error("RISC verification state is invalid.");
  }
  const terminateSessions =
    eventType === GOOGLE_RISC_EVENT_TYPES.sessionsRevoked ||
    eventType === GOOGLE_RISC_EVENT_TYPES.tokensRevoked ||
    eventType === GOOGLE_RISC_EVENT_TYPES.accountDisabled;
  return Object.freeze({
    issuer,
    audience: payload.aud,
    issuedAt: Number(payload.iat),
    eventId,
    eventType,
    ...(googleSubject ? { googleSubject } : {}),
    ...(oauthTokenIdentifier ? { oauthTokenIdentifier } : {}),
    terminateSessions,
    ...(reason ? { reason } : {}),
    ...(verificationState ? { verificationState } : {}),
  });
}
