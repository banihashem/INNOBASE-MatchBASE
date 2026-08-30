import { ApplicationFault } from "@matchbase/application";
import type { ApplyGoogleRiscEventInput } from "@matchbase/data";
import type { VerifiedGoogleRiscEvent } from "@matchbase/auth";

export interface GoogleRiscRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly contentType: string | null;
  readonly body: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly verifier?: {
    verify(token: string): Promise<VerifiedGoogleRiscEvent>;
  };
  readonly apply: (input: ApplyGoogleRiscEventInput) => Promise<unknown>;
}

export interface GoogleRiscRouteResponse {
  readonly status: 202;
  readonly headers: Readonly<Record<string, string>>;
}

export async function handleGoogleRiscRoute(
  request: GoogleRiscRouteRequest,
): Promise<GoogleRiscRouteResponse | null> {
  if (request.pathname !== "/auth/google/risc") return null;
  if (request.method !== "POST") {
    throw new ApplicationFault(
      405,
      "method-not-allowed",
      "MB-405-RISC",
      "Method not allowed.",
      false,
      { Allow: "POST" },
    );
  }
  if (
    request.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/secevent+jwt"
  ) {
    throw new ApplicationFault(
      415,
      "unsupported-media-type",
      "MB-415-RISC",
      "Security event JWT content type is required.",
    );
  }
  if (!request.verifier) {
    throw new ApplicationFault(
      503,
      "dependency-unavailable",
      "MB-503-RISC",
      "Security event processing is unavailable.",
      true,
      { "Retry-After": "30" },
    );
  }
  if (!request.body || request.body.length > 32_768) {
    throw new ApplicationFault(
      400,
      "invalid-security-event",
      "MB-400-RISC",
      "Security event token is invalid.",
    );
  }
  let verified: VerifiedGoogleRiscEvent;
  try {
    verified = await request.verifier.verify(request.body);
  } catch {
    throw new ApplicationFault(
      400,
      "invalid-security-event",
      "MB-400-RISC",
      "Security event token is invalid.",
    );
  }
  try {
    await request.apply({
      ...verified,
      correlationId: request.correlationId,
      deploymentId: request.deploymentId,
    });
  } catch {
    throw new ApplicationFault(
      503,
      "dependency-unavailable",
      "MB-503-RISC",
      "Security event processing is unavailable.",
      true,
      { "Retry-After": "30" },
    );
  }
  return Object.freeze({
    status: 202,
    headers: Object.freeze({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }),
  });
}
