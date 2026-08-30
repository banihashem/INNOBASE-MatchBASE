import {
  AdminAuditApplication,
  parseAdminAuditQuery,
  parseAdminGuardrailMetricQuery,
  type RequestContext,
} from "@matchbase/application";

export interface AdminAuditRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly context: RequestContext;
  readonly application: AdminAuditApplication;
}

export interface AdminAuditRouteResponse {
  readonly status: 200;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function handleAdminAuditRoute(
  request: AdminAuditRouteRequest,
): Promise<AdminAuditRouteResponse | null> {
  if (request.method !== "GET") return null;
  if (request.pathname === "/api/v1/admin/audit") {
    return {
      status: 200,
      body: await request.application.read(
        request.context,
        parseAdminAuditQuery([...request.searchParams.entries()]),
      ),
    };
  }
  if (request.pathname === "/api/v1/admin/audit/export") {
    return {
      status: 200,
      body: await request.application.export(
        request.context,
        parseAdminAuditQuery([...request.searchParams.entries()], true),
      ),
      headers: {
        "Content-Disposition": 'attachment; filename="matchbase-audit.json"',
      },
    };
  }
  if (request.pathname === "/api/v1/admin/audit/guardrails") {
    return {
      status: 200,
      body: await request.application.guardrailMetrics(
        request.context,
        parseAdminGuardrailMetricQuery([...request.searchParams.entries()]),
      ),
    };
  }
  return null;
}
