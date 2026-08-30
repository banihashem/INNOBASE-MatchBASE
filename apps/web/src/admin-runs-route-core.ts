import {
  AdminRunsApplication,
  parseAdminRunsReadQuery,
  type RequestContext,
} from "@matchbase/application";

export interface AdminRunsRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly context: RequestContext;
  readonly application: AdminRunsApplication;
}

export interface AdminRunsRouteResponse {
  readonly status: 200;
  readonly body: unknown;
}

export async function handleAdminRunsRoute(
  request: AdminRunsRouteRequest,
): Promise<AdminRunsRouteResponse | null> {
  if (request.pathname !== "/api/v1/admin/runs" || request.method !== "GET") {
    return null;
  }
  const query = parseAdminRunsReadQuery([...request.searchParams.entries()]);
  return {
    status: 200,
    body: await request.application.read(request.context, query),
  };
}
