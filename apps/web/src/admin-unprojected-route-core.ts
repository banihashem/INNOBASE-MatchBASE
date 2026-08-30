import {
  AdminUnprojectedApplication,
  parseAdminUnprojectedReadDto,
  type RequestContext,
} from "@matchbase/application";

export interface AdminUnprojectedRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly body: () => Promise<unknown>;
  readonly context: RequestContext;
  readonly application: AdminUnprojectedApplication;
}

export interface AdminUnprojectedRouteResponse {
  readonly status: 200;
  readonly body: unknown;
}

export async function handleAdminUnprojectedRoute(
  request: AdminUnprojectedRouteRequest,
): Promise<AdminUnprojectedRouteResponse | null> {
  if (
    request.pathname !== "/api/v1/admin/unprojected-result" ||
    request.method !== "POST"
  ) {
    return null;
  }
  return {
    status: 200,
    body: await request.application.read(
      request.context,
      parseAdminUnprojectedReadDto(await request.body()),
    ),
  };
}
