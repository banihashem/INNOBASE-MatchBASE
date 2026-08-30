import type {
  ConsultantResultApplication,
  ConsultantResultRead,
  RequestContext,
} from "@matchbase/application";
import { ApplicationFault } from "@matchbase/application";
import {
  parseDemoProjectionV1,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseStandardResultProjectionV1,
} from "@matchbase/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ConsultantRouteResult {
  readonly status: 200;
  readonly body: ConsultantResultRead["body"];
  readonly headers: Readonly<Record<string, string>>;
}

export async function handleConsultantRoute(input: {
  readonly method: string;
  readonly pathname: string;
  readonly context: RequestContext;
  readonly application: Pick<ConsultantResultApplication, "getResult">;
}): Promise<ConsultantRouteResult | null> {
  if (input.context.tier !== "consultant") return null;
  const match = /^\/api\/v1\/runs\/([^/]+)\/result$/u.exec(input.pathname);
  if (input.method !== "GET" || !match) return null;
  const runId = match[1];
  if (!runId || !UUID_PATTERN.test(runId))
    throw new ApplicationFault(
      403,
      "resource-not-visible",
      "MB-403-RESOURCE",
      "Resource is not visible.",
    );
  const projection = await input.application.getResult(input.context, runId);
  const body = (() => {
    switch (projection.body.schema_version) {
      case "consultant-result-projection.v2":
        return parseConsultantResultProjectionV2(projection.body);
      case "consultant-result-projection.v1":
        return parseConsultantResultProjectionV1(projection.body);
      case "standard-result-projection.v1":
        return parseStandardResultProjectionV1(projection.body);
      case "demo-projection.v1":
        return parseDemoProjectionV1(projection.body);
      default:
        throw new Error("Consultant result schema is unsupported.");
    }
  })();
  if (
    body !== null &&
    typeof body === "object" &&
    "run_id" in body &&
    body.run_id !== runId
  )
    throw new Error("Consultant result identity is invalid.");
  return {
    status: 200,
    body,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  };
}
