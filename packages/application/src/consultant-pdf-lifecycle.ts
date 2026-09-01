import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  appendAuditEvent,
  inTransaction,
  type ConnectionPool,
} from "@matchbase/data";
import { assertConsultantWorkspaceAuthorized } from "./consultant-authorization.js";
import { ApplicationFault } from "./types.js";
import type { RequestContext } from "./types.js";

export interface ConsultantPdfObjectWriter {
  putImmutable(objectName: string, bytes: Uint8Array): Promise<string>;
}

const GCS_BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u;
const GCS_OBJECT = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/u;
const METADATA_TOKEN_ENDPOINT =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export function createCloudRunMetadataAccessTokenProvider(
  fetchImplementation: typeof fetch = fetch,
  now: () => number = Date.now,
): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetchImplementation(METADATA_TOKEN_ENDPOINT, {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("GCP metadata token request failed.");
      const body = (await response.json()) as {
        access_token?: unknown;
        expires_in?: unknown;
        token_type?: unknown;
      };
      if (
        typeof body.access_token !== "string" ||
        !body.access_token ||
        body.token_type !== "Bearer" ||
        !Number.isSafeInteger(body.expires_in) ||
        (body.expires_in as number) < 120 ||
        (body.expires_in as number) > 3600
      )
        throw new Error("GCP metadata token response is invalid.");
      cached = {
        token: body.access_token,
        expiresAt: now() + (body.expires_in as number) * 1000,
      };
      return cached.token;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createGcsImmutablePdfWriter(input: {
  readonly bucket: string;
  readonly accessToken: () => Promise<string>;
  readonly fetchImplementation?: typeof fetch;
}): ConsultantPdfObjectWriter {
  if (!GCS_BUCKET.test(input.bucket))
    throw new Error("Artifact GCS bucket is invalid.");
  const request = input.fetchImplementation ?? fetch;
  return Object.freeze({
    async putImmutable(objectName: string, bytes: Uint8Array): Promise<string> {
      if (
        !GCS_OBJECT.test(objectName) ||
        objectName.includes("..") ||
        bytes.byteLength < 1
      )
        throw new Error("Artifact GCS object identity is invalid.");
      const token = await input.accessToken();
      if (!token || token.length > 8192 || /\s/u.test(token))
        throw new Error("Artifact GCS token is invalid.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await request(
          `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(input.bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(objectName)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/pdf",
              "Content-Length": String(bytes.byteLength),
            },
            body: Buffer.from(bytes),
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (response.status === 412) {
          const existing = await request(
            `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(input.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              redirect: "error",
              signal: controller.signal,
            },
          );
          if (!existing.ok)
            throw new Error("Immutable artifact object reconciliation failed.");
          const observed = new Uint8Array(await existing.arrayBuffer());
          if (
            observed.byteLength !== bytes.byteLength ||
            !sha256(observed).equals(sha256(bytes))
          )
            throw new Error("Immutable artifact object collision detected.");
          return `gs://${input.bucket}/${objectName}`;
        }
        if (!response.ok)
          throw new Error("Immutable artifact GCS write failed.");
        const metadata = (await response.json()) as {
          bucket?: unknown;
          name?: unknown;
          generation?: unknown;
        };
        if (
          metadata.bucket !== input.bucket ||
          metadata.name !== objectName ||
          typeof metadata.generation !== "string" ||
          !/^\d+$/u.test(metadata.generation)
        )
          throw new Error("Artifact GCS write acknowledgement is invalid.");
        return `gs://${input.bucket}/${objectName}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export interface ConsultantPdfQaEvaluator {
  evaluate(input: {
    readonly bytes: Uint8Array;
    readonly runId: string;
    readonly result: Readonly<Record<string, unknown>>;
    readonly resultSha256: string;
  }): Promise<
    readonly {
      readonly checkKey: (typeof qaKeys)[number];
      readonly outcome: "pass" | "fail" | "warn";
      readonly detail: Readonly<Record<string, unknown>>;
      readonly tool: string;
      readonly toolVersion: string;
    }[]
  >;
}

export interface ConsultantPdfRenderer {
  readonly templateVersion: string;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly pageGeometry: "a4" | "letter";
  render(input: {
    readonly runId: string;
    readonly result: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly pageCount: number;
  }>;
}

export interface ConsultantPdfPipelineIdentity {
  readonly templateVersion: string;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly pageGeometry: "a4" | "letter";
}

export interface ConsultantPdfPipeline extends ConsultantPdfPipelineIdentity {
  run(input: {
    readonly runId: string;
    readonly accountId: string;
    readonly generatedByUserId: string;
    readonly result: Readonly<Record<string, unknown>>;
    readonly resultSha256: string;
    readonly canonicalRequestVersionId: string;
    readonly projectionVersionId: string;
    readonly scoringConfigVersionId: string;
    readonly modelPolicyVersionId: string;
    readonly analystDecisionSetId: string;
    readonly templateVersion: string;
    readonly pageGeometry: "a4" | "letter";
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly pageCount: number;
    readonly checks: Awaited<ReturnType<ConsultantPdfQaEvaluator["evaluate"]>>;
    readonly releasable: boolean;
    readonly qualification: ConsultantPdfQualificationEvidence;
  }>;
}

export interface ConsultantPdfGeometryEvidence {
  readonly geometry: "a4" | "letter";
  readonly sha256: string;
  readonly byteSize: number;
  readonly pageCount: number;
  readonly pageSizePoints: readonly [number, number];
  readonly tagged: boolean;
  readonly title: string;
  readonly veraUa1Compliant: boolean;
  readonly blankContentPages: readonly number[];
}

export interface ConsultantPdfQualificationEvidence {
  readonly schemaVersion: "consultant-pdf-qualification.v1";
  readonly templateSha256: string;
  readonly fontSha256: string;
  readonly toolchainSha256: string;
  readonly attestationSha256: string;
  readonly resultSha256: string;
  readonly reportModelSha256: string;
  readonly geometries: readonly [
    ConsultantPdfGeometryEvidence,
    ConsultantPdfGeometryEvidence,
  ];
}

export interface ConsultantReportModelBuilder<
  TModel = unknown,
  TReport = unknown,
> {
  build(source: Parameters<ConsultantPdfPipeline["run"]>[0]): Promise<{
    readonly reportModel: TModel;
    readonly report: TReport;
    readonly modelSha256: string;
  }>;
}

export interface ConsultantPdfArtifact {
  readonly run_id: string;
  readonly artifact_version_id: string;
  readonly version: number;
}

export async function preserveTerminalResultOnArtifactFailure<T>(
  terminal: T,
  operation: (() => Promise<void>) | undefined,
): Promise<T> {
  if (operation)
    try {
      await operation();
    } catch {
      // Reporting failure is separately durable and cannot revoke a terminal result.
    }
  return terminal;
}

const qaKeys = [
  "band_label_equals_render_band",
  "wave_separated_from_band",
  "overflow_collision",
  "citation_completeness",
  "prohibited_phrase_scan",
  "weight_fidelity",
  "required_sections_present",
  "template_content_leakage",
  "truncation_disclosure",
  "contradiction_declaration",
  "tagged_structure",
  "doc_title_flag",
  "veraPDF",
  "contrast_ratio",
  "page_geometry_both",
  "hash_and_lineage",
] as const;

function sha256(value: Uint8Array | string): Buffer {
  return createHash("sha256").update(value).digest();
}

const digestPattern = /^[0-9a-f]{64}$/u;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function validateConsultantPdfQualification(
  evidence: ConsultantPdfQualificationEvidence,
  expected: {
    readonly fileSha256: string;
    readonly resultSha256: string;
    readonly templateSha256: string;
    readonly pageCount: number;
    readonly byteSize: number;
  },
): string {
  const digests = [
    evidence.templateSha256,
    evidence.fontSha256,
    evidence.toolchainSha256,
    evidence.attestationSha256,
    evidence.resultSha256,
    evidence.reportModelSha256,
  ];
  if (
    evidence.schemaVersion !== "consultant-pdf-qualification.v1" ||
    !digests.every((digest) => digestPattern.test(digest)) ||
    evidence.templateSha256 !== expected.templateSha256 ||
    evidence.resultSha256 !== expected.resultSha256 ||
    evidence.geometries.length !== 2 ||
    new Set(evidence.geometries.map((item) => item.geometry)).size !== 2
  )
    throw new Error("Consultant PDF qualification lineage is invalid.");
  const a4 = evidence.geometries.find((item) => item.geometry === "a4");
  const letter = evidence.geometries.find((item) => item.geometry === "letter");
  if (
    !a4 ||
    !letter ||
    a4.sha256 !== expected.fileSha256 ||
    a4.byteSize !== expected.byteSize ||
    a4.pageCount !== expected.pageCount ||
    evidence.geometries.some(
      (item) =>
        !digestPattern.test(item.sha256) ||
        !Number.isSafeInteger(item.byteSize) ||
        item.byteSize < 1 ||
        !Number.isSafeInteger(item.pageCount) ||
        item.pageCount < 1 ||
        !item.tagged ||
        !item.veraUa1Compliant ||
        item.blankContentPages.length !== 0,
    )
  )
    throw new Error("Consultant PDF qualification geometry is invalid.");
  return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}

function escapePdfText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

/** Deterministic, bounded, single-page PDF used by the governed lifecycle. */
/** Isolated test fixture only; never used by the releasable lifecycle. */
export function renderConsultantResultPdfFixture(input: {
  readonly runId: string;
  readonly result: Readonly<Record<string, unknown>>;
}): Uint8Array {
  const landscape = input.result.landscape as
    Record<string, unknown> | undefined;
  const lines = [
    "MatchBASE Consultant Report",
    `Run: ${input.runId}`,
    `Outcome: ${Number(landscape?.eligible_count ?? 0) > 0 ? "Candidate landscape" : "No responsible match"}`,
    `Eligible candidates: ${String(landscape?.eligible_count ?? 0)}`,
    `Displayed candidates: ${String(landscape?.displayed_count ?? 0)}`,
    "Evidence remains source-bound. Verify mandatory constraints before engagement.",
  ];
  const stream = lines
    .map(
      (line, index) =>
        `BT /F1 ${index === 0 ? 18 : 11} Tf 54 ${770 - index * 34} Td (${escapePdfText(line)}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let document = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join(
      "\n",
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(document, "ascii"));
}

export interface ConsultantPdfRenderRequest extends ConsultantPdfArtifact {
  readonly job_id: string;
  readonly state: "queued" | "claimed" | "completed" | "failed";
}

export async function requestConsultantPdfArtifact(
  pool: ConnectionPool,
  input: {
    readonly accountId: string;
    readonly runId: string;
    readonly userId: string;
    readonly pipeline: ConsultantPdfPipelineIdentity;
    readonly idempotencyKey: string;
    readonly actorTier: "consultant" | "admin";
    readonly actorAdminSubRole?: string;
    readonly correlationId: string;
    readonly deploymentId: string;
  },
): Promise<ConsultantPdfRenderRequest> {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 256)
    throw new Error("Consultant PDF idempotency key is invalid.");
  if (
    !input.pipeline.templateVersion.trim() ||
    !input.pipeline.renderer.trim() ||
    !input.pipeline.rendererVersion.trim()
  )
    throw new Error("Consultant PDF renderer identity is invalid.");
  return inTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `consultant-pdf:${input.accountId}:${input.runId}`,
    ]);
    const keyHash = sha256(input.idempotencyKey);
    const existing = await client.query<{
      artifact_render_job_id: string;
      artifact_version_id: string;
      version: number;
      state: ConsultantPdfRenderRequest["state"];
      idempotency_key_sha256: Buffer;
    }>(
      `SELECT j.artifact_render_job_id,j.artifact_version_id,j.idempotency_key_sha256,v.version,j.state FROM artifact_render_job j JOIN artifact_version v ON v.account_id=j.account_id AND v.artifact_version_id=j.artifact_version_id WHERE j.account_id=$1 AND j.run_id=$2 ORDER BY v.version DESC LIMIT 1`,
      [input.accountId, input.runId],
    );
    if (
      existing.rows[0] &&
      !existing.rows[0].idempotency_key_sha256.equals(keyHash)
    )
      throw new ApplicationFault(
        409,
        "artifact-regeneration-not-authorized",
        "MB-409-ARTIFACT",
        "Report regeneration is not authorized for this run.",
      );
    if (existing.rows[0])
      return Object.freeze({
        run_id: input.runId,
        artifact_version_id: existing.rows[0].artifact_version_id,
        version: existing.rows[0].version,
        job_id: existing.rows[0].artifact_render_job_id,
        state: existing.rows[0].state,
      });
    const lineage = await client.query<{
      canonical_request_version_id: string;
      model_policy_version_id: string;
      scoring_config_version_id: string;
      result_sha256: Buffer;
      projection_version_id: string;
    }>(
      `SELECT r.canonical_request_version_id,r.model_policy_version_id,r.scoring_config_version_id,x.result_sha256,p.projection_version_id FROM research_run r JOIN run_result x ON x.account_id=r.account_id AND x.run_id=r.run_id JOIN LATERAL (SELECT projection_version_id FROM projection_serving WHERE account_id=r.account_id AND run_id=r.run_id AND subject_user_id=$3 AND tier='consultant' ORDER BY served_at DESC,projection_serving_id DESC LIMIT 1) p ON true WHERE r.account_id=$1 AND r.run_id=$2 AND ($4='admin' OR r.requested_by_user_id=$3) AND r.tier_at_submission='consultant' AND r.state IN ('complete','no_responsible_match')`,
      [input.accountId, input.runId, input.userId, input.actorTier],
    );
    const row = lineage.rows[0];
    if (!row) throw new Error("Consultant PDF lineage is unavailable.");
    const artifactId = randomUUID(),
      versionId = randomUUID(),
      jobId = randomUUID();
    await client.query(
      `INSERT INTO artifact(artifact_id,account_id,run_id,artifact_kind,current_version) VALUES($1,$2,$3,'consultant_pdf',1)`,
      [artifactId, input.accountId, input.runId],
    );
    await client.query(
      `INSERT INTO artifact_version(artifact_version_id,artifact_id,account_id,version,state,result_version,result_sha256,canonical_request_version_id,projection_version_id,analyst_decision_set_id,scoring_config_version_id,model_policy_version_id,template_version,renderer,renderer_version,page_geometry,generated_by_subject_id,qualification_contract_version) VALUES($1,$2,$3,1,'rendering','complete-result-foundation.v2',$4,$5,$6,'server-owned-live-research',$7,$8,$9,$10,$11,$12,$13,'consultant-pdf-qualification.v1')`,
      [
        versionId,
        artifactId,
        input.accountId,
        row.result_sha256,
        row.canonical_request_version_id,
        row.projection_version_id,
        row.scoring_config_version_id,
        row.model_policy_version_id,
        input.pipeline.templateVersion,
        input.pipeline.renderer,
        input.pipeline.rendererVersion,
        input.pipeline.pageGeometry,
        input.userId,
      ],
    );
    await client.query(
      `INSERT INTO artifact_render_job(artifact_render_job_id,artifact_version_id,account_id,run_id,state,requested_by_user_id,idempotency_key_sha256) VALUES($1,$2,$3,$4,'queued',$5,$6)`,
      [jobId, versionId, input.accountId, input.runId, input.userId, keyHash],
    );
    await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.userId,
      actorTier: input.actorTier,
      ...(input.actorAdminSubRole
        ? { actorAdminSubRole: input.actorAdminSubRole }
        : {}),
      eventType: "artifact.render.requested",
      resourceKind: "artifact_version",
      resourceId: versionId,
      outcome: "allow",
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: { runId: input.runId, jobId },
    });
    return Object.freeze({
      run_id: input.runId,
      artifact_version_id: versionId,
      version: 1,
      job_id: jobId,
      state: "queued",
    });
  });
}

export class ConsultantPdfArtifactApplication {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly pipeline: ConsultantPdfPipelineIdentity,
  ) {}

  async request(
    context: RequestContext,
    runId: string,
    idempotencyKey: string,
  ): Promise<ConsultantPdfRenderRequest> {
    await assertConsultantWorkspaceAuthorized(
      this.pool,
      context,
      "result.read",
    );
    return requestConsultantPdfArtifact(this.pool, {
      accountId: context.accountId,
      runId,
      userId: context.userId,
      actorTier: context.tier === "admin" ? "admin" : "consultant",
      ...(context.tier === "admin" && context.adminSubRoles[0]
        ? { actorAdminSubRole: context.adminSubRoles[0] }
        : {}),
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      pipeline: this.pipeline,
      idempotencyKey,
    });
  }

  async status(
    context: RequestContext,
    runId: string,
    jobId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    await assertConsultantWorkspaceAuthorized(
      this.pool,
      context,
      "result.read",
    );
    const selected = await this.pool.query<{
      artifact_render_job_id: string;
      artifact_version_id: string;
      state: string;
      version: number;
      failure_detail: Readonly<Record<string, unknown>> | null;
    }>(
      `SELECT j.artifact_render_job_id,j.artifact_version_id,j.state,v.version,j.failure_detail FROM artifact_render_job j JOIN artifact_version v ON v.account_id=j.account_id AND v.artifact_version_id=j.artifact_version_id JOIN research_run r ON r.account_id=j.account_id AND r.run_id=j.run_id WHERE j.account_id=$1 AND j.run_id=$2 AND j.artifact_render_job_id=$3 AND ($4='admin' OR r.requested_by_user_id=$5)`,
      [context.accountId, runId, jobId, context.tier, context.userId],
    );
    const row = selected.rows[0];
    if (!row)
      throw new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-RESOURCE",
        "Resource is not visible.",
      );
    return Object.freeze({
      run_id: runId,
      job_id: row.artifact_render_job_id,
      artifact_version_id: row.artifact_version_id,
      version: row.version,
      state: row.state,
      ...(row.failure_detail ? { failure: row.failure_detail } : {}),
    });
  }
}

export async function executeNextConsultantPdfRenderJob(
  pool: ConnectionPool,
  input: {
    readonly writer: ConsultantPdfObjectWriter;
    readonly pipeline: ConsultantPdfPipeline;
    readonly deploymentId: string;
  },
): Promise<ConsultantPdfRenderRequest | null> {
  await sweepExpiredConsultantPdfRenderJob(input.deploymentId, pool);
  const claimed = await inTransaction(pool, async (client) => {
    const found = await client.query<{
      artifact_render_job_id: string;
      artifact_version_id: string;
      account_id: string;
      run_id: string;
      version: number;
      result_sha256: Buffer;
      current_result_sha256: Buffer;
      complete_result_document: Readonly<Record<string, unknown>>;
      template_version: string;
      renderer: string;
      renderer_version: string;
      page_geometry: "a4" | "letter";
      projection_released: boolean;
      canonical_request_version_id: string;
      projection_version_id: string;
      scoring_config_version_id: string;
      model_policy_version_id: string;
      generated_by_subject_id: string;
      analyst_decision_set_id: string;
    }>(
      `SELECT j.artifact_render_job_id,j.artifact_version_id,j.account_id,j.run_id,v.version,v.result_sha256,x.result_sha256 AS current_result_sha256,v.template_version,v.renderer,v.renderer_version,v.page_geometry,v.canonical_request_version_id,v.projection_version_id,v.scoring_config_version_id,v.model_policy_version_id,v.generated_by_subject_id,v.analyst_decision_set_id,x.complete_result_document,(p.released_at IS NOT NULL) AS projection_released FROM artifact_render_job j JOIN artifact_version v ON v.account_id=j.account_id AND v.artifact_version_id=j.artifact_version_id JOIN run_result x ON x.account_id=j.account_id AND x.run_id=j.run_id LEFT JOIN projection_version p ON p.projection_version_id=v.projection_version_id WHERE (j.state='queued' OR (j.state='claimed' AND j.lease_expires_at < clock_timestamp())) AND j.attempt_count < 2 AND v.state='rendering' ORDER BY j.created_at,j.artifact_render_job_id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
    );
    const row = found.rows[0];
    if (!row) return null;
    await client.query(
      `UPDATE artifact_render_job SET state='claimed',attempt_count=attempt_count+1,claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '10 minutes' WHERE artifact_render_job_id=$1 AND (state='queued' OR (state='claimed' AND lease_expires_at < clock_timestamp()))`,
      [row.artifact_render_job_id],
    );
    return row;
  });
  if (!claimed) return null;
  const fail = async (
    versionState: "render_failed" | "qa_failed",
    stage: string,
  ) =>
    inTransaction(pool, async (client) => {
      await client.query(
        `UPDATE artifact_version SET state=$2,failure_class=$3,failure_detail=$4::jsonb WHERE artifact_version_id=$1 AND state='rendering'`,
        [
          claimed.artifact_version_id,
          versionState,
          versionState === "qa_failed" ? "qa_failure" : "render_failure",
          JSON.stringify({ stage }),
        ],
      );
      await appendAuditEvent(client, {
        accountId: claimed.account_id,
        eventType:
          versionState === "qa_failed"
            ? "artifact.qa.failed"
            : "artifact.render.failed",
        resourceKind: "artifact_version",
        resourceId: claimed.artifact_version_id,
        outcome: "error",
        correlationId: `artifact-worker:${claimed.artifact_render_job_id}`,
        deploymentId: input.deploymentId,
        detail: { runId: claimed.run_id, stage },
      });
      await client.query(
        `UPDATE artifact_render_job SET state='failed',lease_expires_at=NULL,completed_at=clock_timestamp(),failure_detail=$2::jsonb WHERE artifact_render_job_id=$1 AND state='claimed'`,
        [claimed.artifact_render_job_id, JSON.stringify({ stage })],
      );
    });
  if (
    !claimed.result_sha256.equals(claimed.current_result_sha256) ||
    !claimed.projection_released ||
    claimed.template_version !== input.pipeline.templateVersion ||
    claimed.renderer !== input.pipeline.renderer ||
    claimed.renderer_version !== input.pipeline.rendererVersion ||
    claimed.page_geometry !== input.pipeline.pageGeometry
  ) {
    await fail("render_failed", "lineage_or_renderer_identity_mismatch");
    throw new Error("Consultant PDF lineage or renderer identity drifted.");
  }
  let rendered;
  try {
    rendered = await input.pipeline.run({
      runId: claimed.run_id,
      accountId: claimed.account_id,
      generatedByUserId: claimed.generated_by_subject_id,
      result: claimed.complete_result_document,
      resultSha256: claimed.result_sha256.toString("hex"),
      canonicalRequestVersionId: claimed.canonical_request_version_id,
      projectionVersionId: claimed.projection_version_id,
      scoringConfigVersionId: claimed.scoring_config_version_id,
      modelPolicyVersionId: claimed.model_policy_version_id,
      analystDecisionSetId: claimed.analyst_decision_set_id,
      templateVersion: claimed.template_version,
      pageGeometry: claimed.page_geometry,
    });
  } catch {
    await fail("render_failed", "renderer");
    throw new Error("Consultant PDF renderer failed.");
  }
  const { bytes } = rendered;
  if (
    bytes.byteLength < 1 ||
    !Number.isSafeInteger(rendered.pageCount) ||
    rendered.pageCount < 1
  ) {
    await fail("render_failed", "renderer_output");
    throw new Error("Consultant PDF renderer output is invalid.");
  }
  const fileHash = sha256(bytes);
  let qualificationSha256: string;
  try {
    qualificationSha256 = validateConsultantPdfQualification(
      rendered.qualification,
      {
        fileSha256: fileHash.toString("hex"),
        resultSha256: claimed.result_sha256.toString("hex"),
        templateSha256: claimed.template_version,
        pageCount: rendered.pageCount,
        byteSize: bytes.byteLength,
      },
    );
  } catch {
    await fail("qa_failed", "qualification_lineage");
    throw new Error("Consultant PDF qualification lineage failed closed.");
  }
  const checks = rendered.checks;
  const byKey = new Map(checks.map((check) => [check.checkKey, check]));
  if (
    !rendered.releasable ||
    checks.length !== qaKeys.length ||
    byKey.size !== qaKeys.length ||
    qaKeys.some((key) => byKey.get(key)?.outcome !== "pass")
  ) {
    await fail("qa_failed", "blocking_qa");
    throw new Error("Consultant PDF failed blocking QA.");
  }
  try {
    await inTransaction(pool, async (client) => {
      for (const key of qaKeys) {
        const check = byKey.get(key)!;
        await client.query(
          `INSERT INTO artifact_qa_check(qa_check_id,artifact_version_id,account_id,check_key,outcome,detail,tool,tool_version) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (artifact_version_id,check_key) DO NOTHING`,
          [
            randomUUID(),
            claimed.artifact_version_id,
            claimed.account_id,
            key,
            check.outcome,
            JSON.stringify({
              ...check.detail,
              qualificationSha256,
            }),
            check.tool,
            check.toolVersion,
          ],
        );
      }
      const persisted = await client.query<{
        check_key: (typeof qaKeys)[number];
        outcome: string;
        detail: Readonly<Record<string, unknown>>;
        tool: string;
        tool_version: string;
      }>(
        `SELECT check_key,outcome,detail,tool,tool_version FROM artifact_qa_check WHERE artifact_version_id=$1`,
        [claimed.artifact_version_id],
      );
      const persistedByKey = new Map(
        persisted.rows.map((row) => [row.check_key, row]),
      );
      if (
        persisted.rows.length !== qaKeys.length ||
        qaKeys.some((key) => {
          const expected = byKey.get(key)!;
          const observed = persistedByKey.get(key);
          return (
            !observed ||
            observed.outcome !== expected.outcome ||
            observed.tool !== expected.tool ||
            observed.tool_version !== expected.toolVersion ||
            !isDeepStrictEqual(observed.detail, {
              ...expected.detail,
              qualificationSha256,
            })
          );
        })
      )
        throw new Error("Consultant PDF persisted QA admission drifted.");
    });
  } catch (error) {
    await fail("qa_failed", "qa_persistence_or_reconciliation");
    throw error;
  }
  const leaseRenewed = await pool.query(
    `UPDATE artifact_render_job SET lease_expires_at=clock_timestamp()+interval '10 minutes' WHERE artifact_render_job_id=$1 AND state='claimed' AND lease_expires_at>clock_timestamp() RETURNING artifact_render_job_id`,
    [claimed.artifact_render_job_id],
  );
  if (leaseRenewed.rowCount !== 1)
    throw new Error("Consultant PDF render lease expired before object write.");
  const objectName = `consultant/${claimed.account_id}/${claimed.run_id}/${claimed.artifact_version_id}.pdf`;
  let storageUri: string;
  try {
    storageUri = await input.writer.putImmutable(objectName, bytes);
  } catch (error) {
    await fail("render_failed", "immutable_object_write");
    throw error;
  }
  await inTransaction(pool, async (client) => {
    const released = await client.query(
      `UPDATE artifact_version SET state='released',storage_uri=$2,file_sha256=$3,byte_size=$4,page_count=$5,qualification_evidence=$6::jsonb,qualification_sha256=$7,rendered_at=clock_timestamp(),released_at=clock_timestamp() WHERE artifact_version_id=$1 AND state='rendering'`,
      [
        claimed.artifact_version_id,
        storageUri,
        fileHash,
        bytes.byteLength,
        rendered.pageCount,
        JSON.stringify(rendered.qualification),
        Buffer.from(qualificationSha256, "hex"),
      ],
    );
    const completed = await client.query(
      `UPDATE artifact_render_job SET state='completed',lease_expires_at=NULL,completed_at=clock_timestamp() WHERE artifact_render_job_id=$1 AND state='claimed'`,
      [claimed.artifact_render_job_id],
    );
    if (released.rowCount !== 1 || completed.rowCount !== 1)
      throw new Error("Consultant PDF release state drifted.");
    await appendAuditEvent(client, {
      accountId: claimed.account_id,
      eventType: "artifact.released",
      resourceKind: "artifact_version",
      resourceId: claimed.artifact_version_id,
      outcome: "allow",
      correlationId: `artifact-worker:${claimed.artifact_render_job_id}`,
      deploymentId: input.deploymentId,
      detail: {
        runId: claimed.run_id,
        fileSha256: fileHash.toString("hex"),
      },
    });
  });
  return Object.freeze({
    run_id: claimed.run_id,
    artifact_version_id: claimed.artifact_version_id,
    version: claimed.version,
    job_id: claimed.artifact_render_job_id,
    state: "completed",
  });
}

export async function sweepExpiredConsultantPdfRenderJob(
  deploymentId: string,
  pool: ConnectionPool,
): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const selected = await client.query<{
      artifact_render_job_id: string;
      artifact_version_id: string;
      account_id: string;
      run_id: string;
    }>(
      `SELECT artifact_render_job_id,artifact_version_id,account_id,run_id FROM artifact_render_job WHERE state='claimed' AND attempt_count>=2 AND lease_expires_at<clock_timestamp() ORDER BY lease_expires_at,artifact_render_job_id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const row = selected.rows[0];
    if (!row) return false;
    const detail = JSON.stringify({ stage: "worker_lease_exhausted" });
    await client.query(
      `UPDATE artifact_version SET state='render_failed',failure_class='render_failure',failure_detail=$2::jsonb WHERE artifact_version_id=$1 AND state='rendering'`,
      [row.artifact_version_id, detail],
    );
    await client.query(
      `UPDATE artifact_render_job SET state='failed',lease_expires_at=NULL,completed_at=clock_timestamp(),failure_detail=$2::jsonb WHERE artifact_render_job_id=$1 AND state='claimed'`,
      [row.artifact_render_job_id, detail],
    );
    await appendAuditEvent(client, {
      accountId: row.account_id,
      eventType: "artifact.render.failed",
      resourceKind: "artifact_version",
      resourceId: row.artifact_version_id,
      outcome: "error",
      correlationId: `artifact-worker:${row.artifact_render_job_id}`,
      deploymentId,
      detail: { runId: row.run_id, stage: "worker_lease_exhausted" },
    });
    return true;
  });
}
