import {
  PDF_RENDERER_VERSION,
  PDF_VALIDATOR_VERSION,
  runPdfPipeline,
  validateTemplateQualificationAttestation,
  type PdfRuntimeConfig,
  type ServerOwnedReportInput,
  type TemplateQualificationAttestationV1,
} from "@matchbase/reporting";
import type { ConnectionPool } from "@matchbase/data";
import { readFile } from "node:fs/promises";
import type {
  ConsultantPdfPipeline,
  ConsultantPdfPipelineIdentity,
  ConsultantReportModelBuilder,
} from "./consultant-pdf-lifecycle.js";
import { DatabaseConsultantReportModelBuilder } from "./consultant-report-model-builder.js";

export function createConsultantPdfReportingPipeline(input: {
  readonly builder: ConsultantReportModelBuilder<
    unknown,
    ServerOwnedReportInput
  >;
  readonly config: PdfRuntimeConfig;
  readonly attestation: TemplateQualificationAttestationV1;
}): ConsultantPdfPipeline {
  return Object.freeze({
    templateVersion: input.config.template_sha256,
    renderer: "matchbase-weasyprint-verapdf",
    rendererVersion: PDF_RENDERER_VERSION,
    pageGeometry: "a4" as const,
    async run(source: Parameters<ConsultantPdfPipeline["run"]>[0]) {
      const built = await input.builder.build(source);
      const result = await runPdfPipeline(
        built.report,
        built.reportModel,
        input.config,
        input.attestation,
      );
      const a4 = result.geometries.find((item) => item.geometry === "a4");
      if (!a4 || !result.qa.releasable || !result.template_attestation_accepted)
        throw new Error("Consultant PDF reporting pipeline failed closed.");
      return Object.freeze({
        bytes: result.downloadable_pdf,
        pageCount: a4.page_count,
        releasable: true,
        qualification: Object.freeze({
          schemaVersion: "consultant-pdf-qualification.v1" as const,
          templateSha256: result.template_qualification.template_sha256,
          fontSha256: result.template_qualification.font_sha256,
          toolchainSha256: result.template_qualification.toolchain_sha256,
          attestationSha256: input.attestation.attestation_sha256,
          resultSha256: source.resultSha256,
          reportModelSha256: built.modelSha256,
          geometries: Object.freeze(
            result.geometries.map((geometry) =>
              Object.freeze({
                geometry: geometry.geometry,
                sha256: geometry.sha256,
                byteSize: geometry.byte_size,
                pageCount: geometry.page_count,
                pageSizePoints: geometry.page_size_points,
                tagged: geometry.tagged,
                title: geometry.title,
                veraUa1Compliant: geometry.vera_ua1_compliant,
                blankContentPages: geometry.blank_content_pages,
              }),
            ),
          ) as unknown as readonly [
            import("./consultant-pdf-lifecycle.js").ConsultantPdfGeometryEvidence,
            import("./consultant-pdf-lifecycle.js").ConsultantPdfGeometryEvidence,
          ],
        }),
        checks: Object.freeze(
          result.qa.checks.map((check) =>
            Object.freeze({
              checkKey: check.check_key,
              outcome: check.outcome,
              detail: Object.freeze({ basis: check.basis }),
              tool:
                check.check_key === "veraPDF"
                  ? "veraPDF"
                  : "matchbase-pdf-toolchain",
              toolVersion:
                check.check_key === "veraPDF"
                  ? PDF_VALIDATOR_VERSION
                  : PDF_RENDERER_VERSION,
            }),
          ),
        ),
      });
    },
  });
}

export function createEnvironmentConsultantPdfIdentity(
  environment: NodeJS.ProcessEnv,
): ConsultantPdfPipelineIdentity | null {
  if (environment.MATCHBASE_CONSULTANT_PDF_RUNTIME !== "enabled") return null;
  const template = environment.MATCHBASE_PDF_TEMPLATE_SHA256;
  const font = environment.MATCHBASE_PDF_FONT_SHA256;
  const toolchain = environment.MATCHBASE_PDF_TOOLCHAIN_SHA256;
  const allowedAttestation =
    environment.MATCHBASE_PDF_ALLOWED_ATTESTATION_SHA256;
  if (!template || !font || !toolchain || !allowedAttestation)
    throw new Error("Consultant PDF runtime identity is incomplete.");
  if (
    ![template, font, toolchain, allowedAttestation].every((value) =>
      /^[0-9a-f]{64}$/u.test(value),
    )
  )
    throw new Error("Consultant PDF runtime identity digest is invalid.");
  return Object.freeze({
    templateVersion: template,
    renderer: "matchbase-weasyprint-verapdf",
    rendererVersion: PDF_RENDERER_VERSION,
    pageGeometry: "a4",
  });
}

export async function createEnvironmentConsultantPdfPipeline(
  pool: ConnectionPool,
  environment: NodeJS.ProcessEnv,
  loadAttestation: () => Promise<string> = () =>
    readFile("/opt/matchbase/report-assets/template-attestation.json", "utf8"),
): Promise<ConsultantPdfPipeline | null> {
  if (!createEnvironmentConsultantPdfIdentity(environment)) return null;
  const template = environment.MATCHBASE_PDF_TEMPLATE_SHA256!;
  const font = environment.MATCHBASE_PDF_FONT_SHA256!;
  const toolchain = environment.MATCHBASE_PDF_TOOLCHAIN_SHA256!;
  const allowedAttestation =
    environment.MATCHBASE_PDF_ALLOWED_ATTESTATION_SHA256!;
  const attestationText = await loadAttestation();
  let attestation: TemplateQualificationAttestationV1;
  try {
    attestation = JSON.parse(
      attestationText,
    ) as TemplateQualificationAttestationV1;
  } catch {
    throw new Error("Consultant PDF template attestation is invalid JSON.");
  }
  const config: PdfRuntimeConfig = {
    weasyprint_path: "/opt/matchbase/pdf-venv/bin/weasyprint",
    verapdf_path: "/opt/verapdf/verapdf",
    pdfinfo_path: "/usr/bin/pdfinfo",
    pdftotext_path: "/usr/bin/pdftotext",
    template_sha256: template,
    font_sha256: font,
    toolchain_sha256: toolchain,
    allowed_attestation_sha256: allowedAttestation,
    timeout_ms: 120_000,
    max_output_bytes: 4_000_000,
    max_page_count: 100,
  };
  if (!validateTemplateQualificationAttestation(attestation, config))
    throw new Error("Consultant PDF template attestation is not admitted.");
  return createConsultantPdfReportingPipeline({
    builder: new DatabaseConsultantReportModelBuilder(pool),
    config,
    attestation,
  });
}
