import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  evaluatePdfQa,
  renderServerOwnedHtml,
  weasyPrintArguments,
  type PdfGeometry,
  type PdfQaResult,
  type ServerOwnedReportInput,
} from "./pdf-toolchain.js";

const exec = promisify(execFile);
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const digestPattern = /^[0-9a-f]{64}$/u;
export const GOVERNED_PDF_TOOLCHAIN_SHA256 =
  "af3810688779ce540e91eb42fc17304267c6384026d9eadc9d9e230957a083c0" as const;

export interface PdfRuntimeConfig {
  readonly weasyprint_path: string;
  readonly verapdf_path: string;
  readonly pdfinfo_path: string;
  readonly pdftotext_path: string;
  readonly template_sha256: string;
  readonly font_sha256: string;
  readonly toolchain_sha256: string;
  readonly allowed_attestation_sha256: string | null;
  readonly timeout_ms: number;
  readonly max_output_bytes: number;
  readonly max_page_count: number;
}
export interface TemplateQualificationAttestationV1 {
  readonly schema_version: "matchbase-template-qualification.v1";
  readonly template_sha256: string;
  readonly font_sha256: string;
  readonly toolchain_sha256: string;
  readonly qualified_checks: readonly ["contrast_ratio"];
  readonly evidence_sha256: string;
  readonly attestation_sha256: string;
}
export interface GeometryEvidence {
  readonly geometry: PdfGeometry;
  readonly sha256: string;
  readonly byte_size: number;
  readonly page_count: number;
  readonly page_size_points: readonly [number, number];
  readonly tagged: boolean;
  readonly title: string;
  readonly vera_ua1_compliant: boolean;
  readonly blank_content_pages: readonly number[];
  readonly inconsistent_chrome_pages: readonly number[];
}
export interface PdfPipelineResult {
  readonly downloadable_geometry: "a4";
  readonly downloadable_pdf: Uint8Array;
  readonly geometries: readonly [GeometryEvidence, GeometryEvidence];
  readonly qa: PdfQaResult;
  readonly template_attestation_accepted: boolean;
  readonly template_qualification: {
    readonly schema_version: "matchbase-template-machine-qualification.v1";
    readonly template_sha256: string;
    readonly font_sha256: string;
    readonly toolchain_sha256: string;
    readonly flow_only_css: boolean;
    readonly contrast_ratio_minimum: number;
    readonly text_coverage_both: boolean;
    readonly page_count_within_bound: boolean;
  };
}

function requireConfig(config: PdfRuntimeConfig): void {
  if (
    config.weasyprint_path !== "/opt/matchbase/pdf-venv/bin/weasyprint" ||
    config.verapdf_path !== "/opt/verapdf/verapdf" ||
    config.pdfinfo_path !== "/usr/bin/pdfinfo" ||
    config.pdftotext_path !== "/usr/bin/pdftotext"
  )
    throw new Error("Tool paths must equal the governed runtime paths.");
  for (const digest of [
    config.template_sha256,
    config.font_sha256,
    config.toolchain_sha256,
  ])
    if (!digestPattern.test(digest))
      throw new Error("Runtime digests must be lowercase SHA-256 values.");
  if (config.toolchain_sha256 !== GOVERNED_PDF_TOOLCHAIN_SHA256)
    throw new Error(
      "Toolchain digest does not equal the governed build identity.",
    );
  if (
    !Number.isSafeInteger(config.timeout_ms) ||
    config.timeout_ms < 1000 ||
    config.timeout_ms > 120000
  )
    throw new Error("timeout_ms is outside the governed bound.");
  if (
    !Number.isSafeInteger(config.max_output_bytes) ||
    config.max_output_bytes < 4096 ||
    config.max_output_bytes > 4_000_000
  )
    throw new Error("max_output_bytes is outside the governed bound.");
  if (
    !Number.isSafeInteger(config.max_page_count) ||
    config.max_page_count < 1 ||
    config.max_page_count > 100
  )
    throw new Error("max_page_count is outside the governed bound.");
}
const normalizeText = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim();
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}
function acceptedAttestation(
  attestation: TemplateQualificationAttestationV1 | undefined,
  config: PdfRuntimeConfig,
): boolean {
  if (
    !attestation ||
    attestation.schema_version !== "matchbase-template-qualification.v1"
  )
    return false;
  const payload = {
    schema_version: attestation.schema_version,
    template_sha256: attestation.template_sha256,
    font_sha256: attestation.font_sha256,
    toolchain_sha256: attestation.toolchain_sha256,
    qualified_checks: attestation.qualified_checks,
    evidence_sha256: attestation.evidence_sha256,
  };
  return (
    config.allowed_attestation_sha256 !== null &&
    digestPattern.test(config.allowed_attestation_sha256) &&
    attestation.template_sha256 === config.template_sha256 &&
    attestation.font_sha256 === config.font_sha256 &&
    attestation.toolchain_sha256 === config.toolchain_sha256 &&
    digestPattern.test(attestation.evidence_sha256) &&
    attestation.qualified_checks.length === 1 &&
    attestation.qualified_checks[0] === "contrast_ratio" &&
    sha256(JSON.stringify(payload)) === attestation.attestation_sha256 &&
    attestation.attestation_sha256 === config.allowed_attestation_sha256
  );
}
export function validateTemplateQualificationAttestation(
  attestation: TemplateQualificationAttestationV1 | undefined,
  config: PdfRuntimeConfig,
): boolean {
  requireConfig(config);
  return acceptedAttestation(attestation, config);
}
function parseVera(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("report" in value))
    return false;
  const report = value.report as Record<string, unknown>;
  if (!Array.isArray(report.jobs) || report.jobs.length !== 1) return false;
  const job = report.jobs[0] as Record<string, unknown>;
  if (!Array.isArray(job.validationResult) || job.validationResult.length !== 1)
    return false;
  const result = job.validationResult[0] as Record<string, unknown>;
  const details = result.details as Record<string, unknown> | undefined;
  return (
    result.profileName === "PDF/UA-1 validation profile" &&
    result.jobEndStatus === "normal" &&
    result.compliant === true &&
    details?.failedRules === 0 &&
    details.failedChecks === 0
  );
}
function parsePdfInfo(
  text: string,
  geometry: PdfGeometry,
): Omit<
  GeometryEvidence,
  | "geometry"
  | "sha256"
  | "byte_size"
  | "vera_ua1_compliant"
  | "blank_content_pages"
  | "inconsistent_chrome_pages"
> {
  const pages = /^Pages:\s+(\d+)$/mu.exec(text);
  const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/mu.exec(text);
  const tagged = /^Tagged:\s+yes$/mu.test(text);
  const title = /^Title:\s+(.+)$/mu.exec(text)?.[1]?.trim() ?? "";
  if (!pages || !size || !tagged || !title)
    throw new Error(
      "pdfinfo output lacks required title/tag/geometry evidence.",
    );
  const pair: [number, number] = [Number(size[1]), Number(size[2])];
  const expected: readonly [number, number] =
    geometry === "a4" ? [595.276, 841.89] : [612, 792];
  if (
    Math.abs(pair[0] - expected[0]) > 0.02 ||
    Math.abs(pair[1] - expected[1]) > 0.02
  )
    throw new Error(`Unexpected ${geometry} page geometry.`);
  return {
    page_count: Number(pages[1]),
    page_size_points: pair,
    tagged,
    title,
  };
}
function chromeBoundingBoxesAreVisible(
  bboxXhtml: string,
  pageHeight: number,
  reportTitle: string,
): boolean {
  const words = [
    ...bboxXhtml.matchAll(/<word[^>]*yMin="([0-9.]+)"[^>]*>([^<]+)<\/word>/gu),
  ].map((match) => ({ y: Number(match[1]), text: match[2]! }));
  const footerToken = normalizeText(reportTitle).split(" ")[0];
  return (
    words.some(
      (word) => word.text === "MATCHBASE" && word.y >= 0 && word.y < 45,
    ) &&
    words.some(
      (word) =>
        word.text === footerToken &&
        word.y > pageHeight - 45 &&
        word.y <= pageHeight,
    ) &&
    words.some(
      (word) =>
        /^\d+$/u.test(word.text) &&
        word.y > pageHeight - 45 &&
        word.y <= pageHeight,
    )
  );
}
async function runTool(
  path: string,
  args: readonly string[],
  config: PdfRuntimeConfig,
): Promise<string> {
  const result = await exec(path, [...args], {
    timeout: config.timeout_ms,
    maxBuffer: config.max_output_bytes,
    env: {
      PATH: "/opt/matchbase/pdf-venv/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      HOME: "/tmp",
      FONTCONFIG_FILE: "/opt/matchbase/report-assets/fonts.conf",
    },
  });
  if (result.stderr.trim())
    throw new Error("PDF tool emitted diagnostics; admission is fail-closed.");
  return result.stdout;
}
export async function runPdfPipeline(
  report: ServerOwnedReportInput,
  reportModel: unknown,
  config: PdfRuntimeConfig,
  attestation?: TemplateQualificationAttestationV1,
): Promise<PdfPipelineResult> {
  requireConfig(config);
  const workspace = await mkdtemp("/work/matchbase-pdf-");
  try {
    const cssFiles = await Promise.all(
      ["report.css", "a4.css", "letter.css"].map((name) =>
        readFile(`/opt/matchbase/report-assets/${name}`, "utf8"),
      ),
    );
    const runtimeTemplateSha = sha256(cssFiles.join(""));
    if (runtimeTemplateSha !== config.template_sha256)
      throw new Error("Runtime template digest mismatch.");
    const runtimeFontSha = sha256(
      await readFile("/opt/matchbase/fonts/DejaVuSans.ttf"),
    );
    if (runtimeFontSha !== config.font_sha256)
      throw new Error("Runtime font digest mismatch.");
    const css = cssFiles.join("\n");
    const flowOnly =
      !/(?:^|[;{]\s*)(?:position\s*:\s*(?:absolute|fixed)|transform\s*:|float\s*:|overflow\s*:\s*(?:hidden|clip)|margin(?:-[a-z]+)?\s*:\s*-)/imu.test(
        css,
      );
    if (!flowOnly)
      throw new Error("Template CSS violates the governed flow-only policy.");
    const palette = new Map(
      [
        ...css.matchAll(
          /--(ink|secondary|muted|paper|accent|deep)\s*:\s*(#[0-9a-f]{6})/giu,
        ),
      ].map((match) => [match[1]!.toLowerCase(), match[2]!.toLowerCase()]),
    );
    if (palette.size !== 6)
      throw new Error("Template palette is not machine-readable.");
    const paper = palette.get("paper")!;
    const deep = palette.get("deep")!;
    const minimumContrast = Math.min(
      ...["ink", "secondary", "muted", "accent", "deep"].map((name) =>
        contrast(palette.get(name)!, paper),
      ),
      contrast(paper, deep),
    );
    if (!Number.isFinite(minimumContrast))
      throw new Error("Template palette is not machine-readable.");
    const htmlPath = join(workspace, "report.html");
    await writeFile(htmlPath, renderServerOwnedHtml(report), {
      encoding: "utf8",
      mode: 0o600,
    });
    const expectedText = [
      report.title,
      ...report.sections.flatMap((section) => [
        section.heading,
        ...section.paragraphs,
      ]),
    ].map(normalizeText);
    const coverage: boolean[] = [];
    const evidence: GeometryEvidence[] = [];
    let a4Bytes: Uint8Array | null = null;
    let a4Vera: unknown = null;
    for (const geometry of ["a4", "letter"] as const) {
      const pdfPath = join(workspace, `${geometry}.pdf`);
      const veraPath = join(workspace, `${geometry}.vera.json`);
      const args = weasyPrintArguments(
        geometry,
        htmlPath.replaceAll("\\", "/"),
        pdfPath.replaceAll("\\", "/"),
      );
      await runTool(config.weasyprint_path, args, config);
      const pdf = await readFile(pdfPath);
      const veraText = await runTool(
        config.verapdf_path,
        ["--format", "json", "--flavour", "ua1", pdfPath],
        config,
      );
      await writeFile(veraPath, veraText, { mode: 0o600 });
      let vera: unknown;
      try {
        vera = JSON.parse(veraText);
      } catch {
        throw new Error("veraPDF returned malformed JSON.");
      }
      const info = parsePdfInfo(
        await runTool(config.pdfinfo_path, [pdfPath], config),
        geometry,
      );
      const compliant = parseVera(vera);
      if (!compliant) throw new Error("veraPDF UA-1 validation failed.");
      const extracted = normalizeText(
        await runTool(config.pdftotext_path, ["-layout", pdfPath, "-"], config),
      );
      coverage.push(
        expectedText.every((fragment) => extracted.includes(fragment)),
      );
      const blankPages: number[] = [];
      const inconsistentChromePages: number[] = [];
      for (let page = 1; page <= info.page_count; page += 1) {
        const pageText = normalizeText(
          await runTool(
            config.pdftotext_path,
            ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"],
            config,
          ),
        );
        if (!pageText.replace(/^\d+$/u, "").trim()) blankPages.push(page);
        if (page > 1) {
          const bbox = await runTool(
            config.pdftotext_path,
            [
              "-f",
              String(page),
              "-l",
              String(page),
              "-bbox-layout",
              pdfPath,
              "-",
            ],
            config,
          );
          if (
            !chromeBoundingBoxesAreVisible(
              bbox,
              info.page_size_points[1],
              report.title,
            )
          )
            inconsistentChromePages.push(page);
        }
      }
      evidence.push(
        Object.freeze({
          geometry,
          sha256: sha256(pdf),
          byte_size: pdf.byteLength,
          ...info,
          vera_ua1_compliant: compliant,
          blank_content_pages: Object.freeze(blankPages),
          inconsistent_chrome_pages: Object.freeze(inconsistentChromePages),
        }),
      );
      if (geometry === "a4") {
        a4Bytes = pdf;
        a4Vera = vera;
      }
    }
    if (!a4Bytes || evidence.length !== 2)
      throw new Error("Both geometry renders are required.");
    const baseline = evaluatePdfQa(a4Bytes, reportModel, a4Vera);
    const admitted = acceptedAttestation(attestation, config);
    const geometryChecks = new Map<string, boolean>([
      ["tagged_structure", evidence.every((x) => x.tagged)],
      ["doc_title_flag", evidence.every((x) => x.title === report.title)],
      ["page_geometry_both", evidence.length === 2],
    ]);
    geometryChecks.set(
      "overflow_collision",
      flowOnly &&
        coverage.every(Boolean) &&
        evidence.every(
          (x) =>
            x.page_count <= config.max_page_count &&
            x.blank_content_pages.length === 0 &&
            x.inconsistent_chrome_pages.length === 0,
        ),
    );
    geometryChecks.set("contrast_ratio", minimumContrast >= 4.5);
    const checks = baseline.checks.map((check) =>
      geometryChecks.has(check.check_key)
        ? Object.freeze({
            check_key: check.check_key,
            outcome:
              geometryChecks.get(check.check_key) === true
                ? ("pass" as const)
                : ("fail" as const),
            basis: "machine" as const,
          })
        : check,
    );
    const qa = Object.freeze({
      ...baseline,
      checks: Object.freeze(checks),
      releasable:
        checks.length === 16 && checks.every((x) => x.outcome === "pass"),
    });
    const qualification = Object.freeze({
      schema_version: "matchbase-template-machine-qualification.v1" as const,
      template_sha256: runtimeTemplateSha,
      font_sha256: config.font_sha256,
      toolchain_sha256: config.toolchain_sha256,
      flow_only_css: flowOnly,
      contrast_ratio_minimum: minimumContrast,
      text_coverage_both: coverage.length === 2 && coverage.every(Boolean),
      page_count_within_bound: evidence.every(
        (x) => x.page_count <= config.max_page_count,
      ),
    });
    return Object.freeze({
      downloadable_geometry: "a4",
      downloadable_pdf: Uint8Array.from(a4Bytes),
      geometries: Object.freeze(evidence) as unknown as readonly [
        GeometryEvidence,
        GeometryEvidence,
      ],
      qa,
      template_attestation_accepted: admitted,
      template_qualification: qualification,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
