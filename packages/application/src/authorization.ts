import type { PersistedTier } from "@matchbase/contracts";
import { ApplicationFault, type RequestContext } from "./types.js";

export const SLICE1_AUTHENTICATED_ENDPOINTS = [
  "GET /api/v1/me",
  "POST /api/v1/requests",
  "GET /api/v1/requests/:requestId",
  "POST /api/v1/requests/:requestId/versions",
  "POST /api/v1/requests/:requestId/versions/:version/confirmation",
  "POST /api/v1/runs",
  "GET /api/v1/runs",
  "GET /api/v1/runs/:runId",
  "GET /api/v1/runs/:runId/result",
  "POST /api/v1/runs/:runId/cancellation",
] as const;

export type Slice1AuthenticatedEndpoint =
  (typeof SLICE1_AUTHENTICATED_ENDPOINTS)[number];

const END_USER_TIERS: ReadonlySet<PersistedTier> = new Set(["demo"]);

/**
 * Slice 1 exposes the owner-bound Demo workflow only to Demo. Standard,
 * Consultant, and Admin identities can inspect their own resolved identity at
 * /me, but remain denied on every workflow endpoint because their complete
 * workflows are later slices and no current in-scope contract grants them.
 * Admin sub-roles never widen this allowlist.
 */
export function isSlice1EndpointAuthorized(
  context: Pick<RequestContext, "tier" | "adminSubRoles">,
  endpoint: Slice1AuthenticatedEndpoint,
): boolean {
  if (context.tier !== "admin" && context.adminSubRoles.length > 0) {
    return false;
  }
  if (endpoint === "GET /api/v1/me") return true;
  return END_USER_TIERS.has(context.tier);
}

export function assertSlice1EndpointAuthorized(
  context: Pick<RequestContext, "tier" | "adminSubRoles">,
  endpoint: Slice1AuthenticatedEndpoint,
): void {
  if (!isSlice1EndpointAuthorized(context, endpoint)) {
    throw new ApplicationFault(
      403,
      "tier-not-entitled",
      "MB-403-TIER",
      "Not entitled.",
    );
  }
}
