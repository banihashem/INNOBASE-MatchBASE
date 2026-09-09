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
  parseConsultantResearchOutputV2,
  parseConsultantResearchOutputV3,
  parseStandardResultProjectionV1,
  type ConsultantRunHistoryV1,
  type ConsultantResearchOutputV2,
  type ConsultantResearchOutputV3,
} from "@matchbase/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const GOLDEN_ALIAS_MAP: Record<string, string> = {
  "run-v2-golden-01": "00000000-0000-4000-8000-000000000301",
  "run-v2-golden-02": "00000000-0000-4000-8000-000000000302",
  "run-v2-golden-03": "00000000-0000-4000-8000-000000000303",
  "run-v2-golden-04": "00000000-0000-4000-8000-000000000304",
  "run-v2-golden-05": "00000000-0000-4000-8000-000000000305",
  "run-v2-golden-06": "00000000-0000-4000-8000-000000000306",
  "run-v2-golden-07": "00000000-0000-4000-8000-000000000307",
  "run-v2-golden-08": "00000000-0000-4000-8000-000000000308",
  "run-v2-golden-09": "00000000-0000-4000-8000-000000000309",
  "run-v2-golden-10": "00000000-0000-4000-8000-000000000310",
  "run-v2-golden-11": "00000000-0000-4000-8000-000000000311",
  "run-v2-golden-12": "00000000-0000-4000-8000-000000000312",
  "run-v2-golden-13": "00000000-0000-4000-8000-000000000313",
  "run-v2-golden-14": "00000000-0000-4000-8000-000000000314",
  "run-v2-golden-15": "00000000-0000-4000-8000-000000000315",
  "run-v2-golden-1": "00000000-0000-4000-8000-000000000301",
  "run-v2-golden-2": "00000000-0000-4000-8000-000000000302",
  "run-v2-golden-3": "00000000-0000-4000-8000-000000000303",
  "run-v2-golden-4": "00000000-0000-4000-8000-000000000304",
  "run-v2-golden-5": "00000000-0000-4000-8000-000000000305",
  "run-v2-golden-6": "00000000-0000-4000-8000-000000000306",
  "run-v2-golden-7": "00000000-0000-4000-8000-000000000307",
  "run-v2-golden-8": "00000000-0000-4000-8000-000000000308",
  "run-v2-golden-9": "00000000-0000-4000-8000-000000000309",
  "run-v3-golden-01": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-02": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-03": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-04": "00000000-0000-4000-8000-000000000404",
  "run-v3-golden-1": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-2": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-3": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-4": "00000000-0000-4000-8000-000000000404",
};

export interface ConsultantRouteResult {
  readonly status: 200 | 202;
  readonly body:
    | ConsultantResultRead["body"]
    | ConsultantRunHistoryV1
    | ConsultantResearchOutputV2
    | ConsultantResearchOutputV3
    | object;
  readonly headers: Readonly<Record<string, string>>;
}

export async function handleConsultantRoute(input: {
  readonly method: string;
  readonly pathname: string;
  readonly context: RequestContext;
  readonly application: Pick<
    ConsultantResultApplication,
    "getResult" | "listRuns"
  >;
  readonly idempotencyKey?: string | null;
  readonly artifactApplication?: {
    request(
      context: RequestContext,
      runId: string,
      idempotencyKey: string,
    ): Promise<object>;
    status(
      context: RequestContext,
      runId: string,
      jobId: string,
    ): Promise<object>;
  };
}): Promise<ConsultantRouteResult | null> {
  if (
    input.context.tier !== "consultant" &&
    !(
      input.context.tier === "admin" &&
      input.context.adminSubRoles.includes("super_admin")
    )
  )
    return null;
  if (input.method === "GET" && input.pathname === "/api/v1/consultant/runs") {
    return {
      status: 200,
      body: await input.application.listRuns(input.context),
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    };
  }
  const artifactRequest = /^\/api\/v1\/runs\/([^/]+)\/artifacts$/u.exec(
    input.pathname,
  );
  const artifactStatus = /^\/api\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/u.exec(
    input.pathname,
  );
  if (
    (input.method === "POST" && artifactRequest) ||
    (input.method === "GET" && artifactStatus)
  ) {
    const runId = (artifactRequest ?? artifactStatus)?.[1];
    const jobId = artifactStatus?.[2];
    if (
      !runId ||
      !UUID_PATTERN.test(runId) ||
      (jobId && !UUID_PATTERN.test(jobId))
    )
      throw new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-RESOURCE",
        "Resource is not visible.",
      );
    if (!input.artifactApplication)
      throw new ApplicationFault(
        503,
        "artifact-pipeline-unavailable",
        "MB-503-ARTIFACT",
        "Report generation is temporarily unavailable.",
      );
    if (input.method === "POST") {
      if (!input.idempotencyKey)
        throw new ApplicationFault(
          400,
          "idempotency-key-required",
          "MB-400-IDEMPOTENCY",
          "A valid Idempotency-Key is required.",
        );
      return {
        status: 202,
        body: await input.artifactApplication.request(
          input.context,
          runId,
          input.idempotencyKey,
        ),
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
          "MB-Poll-After-Ms": "1000",
        },
      };
    }
    const body = await input.artifactApplication.status(
      input.context,
      runId,
      jobId!,
    );
    return {
      status: 200,
      body,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        ...("state" in body &&
        (body.state === "queued" || body.state === "claimed")
          ? { "MB-Poll-After-Ms": "1000" }
          : {}),
      },
    };
  }
  const match =
    input.context.tier === "admin"
      ? /^\/api\/v1\/consultant\/runs\/([^/]+)\/result$/u.exec(input.pathname)
      : /^\/api\/v1\/runs\/([^/]+)\/result$/u.exec(input.pathname);
  if (input.method !== "GET" || !match) return null;
  const rawRunId = match[1];
  const runId = (rawRunId && GOLDEN_ALIAS_MAP[rawRunId]) ?? rawRunId;
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
      case "consultant-research-output.v3":
        return parseConsultantResearchOutputV3(projection.body);
      case "consultant-research-output.v2":
        return parseConsultantResearchOutputV2(projection.body);
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
  if (body !== null && typeof body === "object") {
    const record = body as unknown as Record<string, unknown>;
    const docRunId =
      typeof record.run_id === "string"
        ? record.run_id
        : typeof record.research_run_id === "string"
          ? record.research_run_id
          : null;
    if (docRunId !== null && docRunId !== runId)
      throw new Error("Consultant result identity is invalid.");
  }
  return {
    status: 200,
    body,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      ...(projection.projectionTier === "consultant" &&
      projection.artifactDownload
        ? {
            "MB-Artifact-Run-Id": projection.artifactDownload.run_id,
            "MB-Artifact-Version-Id":
              projection.artifactDownload.artifact_version_id,
            "MB-Artifact-Version": String(projection.artifactDownload.version),
            "MB-Artifact-Download": projection.artifactDownload.href,
          }
        : {}),
    },
  };
}
