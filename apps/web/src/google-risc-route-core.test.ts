import { describe, expect, it, vi } from "vitest";
import { ApplicationFault } from "@matchbase/application";
import { GOOGLE_RISC_EVENT_TYPES } from "@matchbase/auth";
import { handleGoogleRiscRoute } from "./google-risc-route-core";

const verified = {
  issuer: "https://accounts.google.com",
  audience: "client-id.apps.googleusercontent.com",
  issuedAt: 1_700_000_000,
  eventId: "event-1",
  eventType: GOOGLE_RISC_EVENT_TYPES.sessionsRevoked,
  googleSubject: "google-subject-1",
  terminateSessions: true,
} as const;

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    pathname: "/auth/google/risc",
    contentType: "application/secevent+jwt",
    body: "signed.jwt.value",
    correlationId: "correlation-1",
    deploymentId: "deployment-1",
    verifier: { verify: vi.fn(async () => verified) },
    apply: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Google RISC receiver route", () => {
  it("verifies, durably applies, and acknowledges a valid event", async () => {
    const input = request();
    await expect(handleGoogleRiscRoute(input)).resolves.toMatchObject({
      status: 202,
    });
    expect(input.apply).toHaveBeenCalledWith({
      ...verified,
      correlationId: "correlation-1",
      deploymentId: "deployment-1",
    });
  });

  it("fails closed on signature validation, media type, and persistence failures", async () => {
    const variants = [
      request({
        verifier: { verify: vi.fn(async () => Promise.reject(new Error())) },
      }),
      request({ contentType: "application/json" }),
      request({ apply: vi.fn(async () => Promise.reject(new Error())) }),
    ];
    const expected = [400, 415, 503];
    for (const [index, input] of variants.entries()) {
      await expect(handleGoogleRiscRoute(input)).rejects.toMatchObject({
        status: expected[index]!,
      } satisfies Pick<ApplicationFault, "status">);
    }
  });

  it("does not claim unrelated paths and rejects unsupported methods", async () => {
    await expect(
      handleGoogleRiscRoute(request({ pathname: "/auth/google/start" })),
    ).resolves.toBeNull();
    await expect(
      handleGoogleRiscRoute(request({ method: "GET" })),
    ).rejects.toMatchObject({ status: 405 });
  });
});
