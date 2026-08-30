import {
  AdminEntitlementsApplication,
  parseAdminEntitlementMutationDto,
  parseAdminEntitlementReadQuery,
  type RequestContext,
} from "@matchbase/application";

export interface AdminEntitlementsRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly body: () => Promise<unknown>;
  readonly context: RequestContext;
  readonly idempotencyKey: string | null;
  readonly application: AdminEntitlementsApplication;
}

export interface AdminEntitlementsRouteResponse {
  readonly status: 200;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function handleAdminEntitlementsRoute(
  request: AdminEntitlementsRouteRequest,
): Promise<AdminEntitlementsRouteResponse | null> {
  if (request.pathname !== "/api/v1/admin/entitlements") {
    return null;
  }
  if (request.method === "GET") {
    const input = parseAdminEntitlementReadQuery([
      ...request.searchParams.entries(),
    ]);
    return {
      status: 200,
      body: await request.application.read(request.context, input),
    };
  }
  if (request.method !== "POST") return null;
  const input = parseAdminEntitlementMutationDto(await request.body());
  const result = await request.application.mutate(
    request.context,
    request.idempotencyKey ?? "",
    input,
  );
  return {
    status: 200,
    body: result.body,
    ...(result.replayed ? { headers: { "MB-Idempotent-Replay": "true" } } : {}),
  };
}
