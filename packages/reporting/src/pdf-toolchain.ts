import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  P4_QA_CHECK_KEYS,
  type ArtifactQaOutcome,
  type P4QaCheckKey,
} from "./artifact-foundation.js";
export const PDF_RENDERER_VERSION = "WeasyPrint 69.0" as const;
export const PDF_VALIDATOR_VERSION = "veraPDF CLI 1.30.1" as const;
export type PdfGeometry = "a4" | "letter";
export interface ServerOwnedReportInput {
  readonly title: string;
  readonly subtitle?: string;
  readonly metadata?: {
    readonly document_id?: string;
    readonly status?: string;
    readonly prepared_at?: string;
    readonly classification?: string;
  };
  readonly sections: readonly {
    readonly heading: string;
    readonly paragraphs: readonly string[];
    readonly cards?: readonly {
      readonly label: string;
      readonly value: string;
      readonly detail?: string;
    }[];
    readonly tables?: readonly {
      readonly caption: string;
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }[];
  }[];
}
export interface PdfQaResult {
  readonly schema_version: "matchbase-pdf-qa.v1";
  readonly releasable: boolean;
  readonly renderer: typeof PDF_RENDERER_VERSION;
  readonly validator: typeof PDF_VALIDATOR_VERSION;
  readonly pdf_sha256: string;
  readonly checks: readonly {
    readonly check_key: P4QaCheckKey;
    readonly outcome: ArtifactQaOutcome;
    readonly basis: "machine" | "manual_required" | "missing_evidence";
  }[];
}
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function renderServerOwnedHtml(input: ServerOwnedReportInput): string {
  if (!input.title.trim() || input.sections.length === 0)
    throw new Error("A title and at least one section are required.");
  const body = input.sections
    .map((section, index) => {
      if (!section.heading.trim() || section.paragraphs.length === 0)
        throw new Error("Every section requires a heading and content.");
      const cards = section.cards?.length
        ? `<dl class="evidence-cards">${section.cards
            .map((card) => {
              if (!card.label.trim() || !card.value.trim())
                throw new Error(
                  "Every evidence card requires a label and value.",
                );
              return `<div class="evidence-card"><dt>${escapeHtml(card.label)}</dt><dd>${escapeHtml(card.value)}${card.detail?.trim() ? `<small>${escapeHtml(card.detail)}</small>` : ""}</dd></div>`;
            })
            .join("")}</dl>`
        : "";
      const tables =
        section.tables
          ?.map((table) => {
            if (
              !table.caption.trim() ||
              table.columns.length === 0 ||
              table.columns.some((column) => !column.trim()) ||
              table.rows.some((row) => row.length !== table.columns.length)
            )
              throw new Error(
                "Every evidence table requires a caption and rectangular, labelled data.",
              );
            const header = table.columns
              .map((column) => `<th scope="col">${escapeHtml(column)}</th>`)
              .join("");
            const rows = table.rows
              .map(
                (row) =>
                  `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
              )
              .join("");
            return `<table><caption>${escapeHtml(table.caption)}</caption><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
          })
          .join("") ?? "";
      return `<section class="report-section" aria-labelledby="section-${index + 1}"><h2 id="section-${index + 1}">${escapeHtml(section.heading)}</h2><div class="section-body">${section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${cards}${tables}</div></section>`;
    })
    .join("");
  const metadata =
    input.metadata === undefined
      ? ""
      : Object.entries(input.metadata)
          .flatMap(([key, value]) =>
            value?.trim()
              ? [
                  `<div class="meta-item"><dt>${escapeHtml(key.replaceAll("_", " "))}</dt><dd>${escapeHtml(value)}</dd></div>`,
                ]
              : [],
          )
          .join("");
  const subtitle = input.subtitle?.trim()
    ? `<p class="cover-subtitle">${escapeHtml(input.subtitle)}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title></head><body><div class="running-header" aria-hidden="true">MATCHBASE&nbsp; / &nbsp;CONSULTANT REPORT</div><div class="running-footer" aria-hidden="true">${escapeHtml(input.title)}</div><main><article class="report-cover"><div class="brand-lockup" aria-label="MatchBASE"><span class="brand-mark" aria-hidden="true">M</span><span>MatchBASE</span></div><div class="cover-rule" aria-hidden="true"></div><p class="document-type">Consultant research report</p><h1>${escapeHtml(input.title)}</h1>${subtitle}${metadata ? `<dl class="document-metadata">${metadata}</dl>` : ""}<p class="cover-notice">Decision support based only on the evidence and limitations stated in this document.</p></article><div class="report-content"><header class="content-introduction"><p class="eyebrow">MatchBASE consultant report</p><h2 class="contents-heading">Report structure</h2><p>This document is organised into numbered sections for review, decision-making and source tracing.</p></header>${body}</div></main></body></html>`;
}
export function weasyPrintArguments(
  geometry: PdfGeometry,
  htmlPath: string,
  outputPath: string,
): readonly string[] {
  if (
    !isAbsolute(htmlPath) ||
    !isAbsolute(outputPath) ||
    htmlPath.includes("..") ||
    outputPath.includes("..") ||
    /^(?:https?|data):/iu.test(htmlPath + outputPath)
  )
    throw new Error(
      "Renderer paths must be absolute local paths without traversal.",
    );
  return Object.freeze([
    "--pdf-tags",
    "--pdf-variant",
    "pdf/ua-1",
    "--allowed-protocols",
    "file,data",
    "--no-http-redirects",
    "--fail-on-http-errors",
    "--base-url",
    "file:///opt/matchbase/report-assets/",
    "--stylesheet",
    "/opt/matchbase/report-assets/report.css",
    "--stylesheet",
    `/opt/matchbase/report-assets/${geometry}.css`,
    htmlPath,
    outputPath,
  ]);
}
function complianceFromVeraJson(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("report" in value))
    return false;
  const report = value.report;
  if (
    typeof report !== "object" ||
    report === null ||
    !("jobs" in report) ||
    !Array.isArray(report.jobs) ||
    report.jobs.length !== 1
  )
    return false;
  const job = report.jobs[0];
  if (
    typeof job !== "object" ||
    job === null ||
    !("validationResult" in job) ||
    !Array.isArray(job.validationResult) ||
    job.validationResult.length !== 1
  )
    return false;
  const result = job.validationResult[0];
  if (typeof result !== "object" || result === null || !("details" in result))
    return false;
  const details = result.details;
  return (
    result.profileName === "PDF/UA-1 validation profile" &&
    result.jobEndStatus === "normal" &&
    result.compliant === true &&
    typeof details === "object" &&
    details !== null &&
    "failedRules" in details &&
    details.failedRules === 0 &&
    "failedChecks" in details &&
    details.failedChecks === 0
  );
}
export function evaluatePdfQa(
  pdfBytes: Uint8Array,
  reportModel: unknown,
  veraPdfJson: unknown,
): PdfQaResult {
  if (
    pdfBytes.byteLength < 8 ||
    new TextDecoder("ascii").decode(pdfBytes.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("Renderer output is not a PDF byte stream.");
  const serialized = JSON.stringify(reportModel);
  const model =
    typeof reportModel === "object" && reportModel !== null
      ? (reportModel as Record<string, unknown>)
      : {};
  const dimensions = Array.isArray(model.scoring_dimensions)
    ? model.scoring_dimensions
    : [];
  const sections = Array.isArray(model.sections) ? model.sections : [];
  const claims = Array.isArray(model.claims) ? model.claims : [];
  const citations = Array.isArray(model.citations) ? model.citations : [];
  const bandLabel =
    typeof model.band_label === "string" ? model.band_label : null;
  const renderBand =
    typeof model.render_band === "string" ? model.render_band : null;
  const waves = Array.isArray(model.wave_recommendations)
    ? model.wave_recommendations
    : null;
  const landscape =
    typeof model.landscape === "object" && model.landscape !== null
      ? (model.landscape as Record<string, unknown>)
      : null;
  const contradictions = Array.isArray(model.contradictions)
    ? model.contradictions
    : null;
  const sectionIds = new Set(
    sections.flatMap((x) =>
      typeof x === "object" && x !== null && "section_id" in x
        ? [String(x.section_id)]
        : [],
    ),
  );
  const required = [
    "SEC-00",
    "SEC-01",
    "SEC-02",
    "SEC-03",
    "SEC-04",
    "SEC-05",
    "SEC-06",
    "SEC-09",
    "SEC-10",
    "SEC-11",
    "SEC-13",
    "SEC-14",
    "SEC-15",
    "SEC-16",
    "SEC-17",
    "SEC-18",
    "SEC-19",
    "SEC-21",
    "SEC-22",
    "SEC-23",
  ];
  const citationIds = new Set(
    citations.flatMap((x) =>
      typeof x === "object" && x !== null && "claim_id" in x
        ? [String(x.claim_id)]
        : [],
    ),
  );
  const claimIds = claims.flatMap((x) =>
    typeof x === "object" && x !== null && "claim_id" in x
      ? [String(x.claim_id)]
      : [],
  );
  const calculated: Partial<Record<P4QaCheckKey, boolean>> = {
    band_label_equals_render_band:
      bandLabel !== null && renderBand !== null && bandLabel === renderBand,
    wave_separated_from_band:
      waves !== null &&
      waves.every(
        (wave) =>
          typeof wave === "object" &&
          wave !== null &&
          "wave_id" in wave &&
          !("band" in wave) &&
          !("band_label" in wave),
      ),
    citation_completeness: claimIds.every((id) => citationIds.has(id)),
    prohibited_phrase_scan:
      !/(guaranteed supplier|fully verified|risk[- ]free)/iu.test(serialized),
    weight_fidelity:
      dimensions.length === 6 &&
      dimensions.reduce(
        (sum, x) =>
          sum +
          (typeof x === "object" &&
          x !== null &&
          "weight" in x &&
          typeof x.weight === "number"
            ? x.weight
            : Number.NaN),
        0,
      ) === 1,
    required_sections_present: required.every((id) => sectionIds.has(id)),
    template_content_leakage: !/(lorem ipsum|\{\{|\[insert|placeholder)/iu.test(
      serialized,
    ),
    truncation_disclosure:
      landscape !== null &&
      typeof landscape.total_eligible_count === "number" &&
      typeof landscape.displayed_count === "number" &&
      (landscape.total_eligible_count <= landscape.displayed_count ||
        (typeof landscape.truncation_notice === "string" &&
          landscape.truncation_notice.trim().length > 0)),
    contradiction_declaration:
      contradictions !== null &&
      (contradictions.length === 0 || sectionIds.has("SEC-05.2")),
    veraPDF: complianceFromVeraJson(veraPdfJson),
    hash_and_lineage:
      typeof model.lineage === "object" && model.lineage !== null,
  };
  const checks = P4_QA_CHECK_KEYS.map((key) => {
    if (key === "tagged_structure" || key === "contrast_ratio")
      return Object.freeze({
        check_key: key,
        outcome: "fail" as const,
        basis: "manual_required" as const,
      });
    const observed = calculated[key];
    if (observed === undefined)
      return Object.freeze({
        check_key: key,
        outcome: "fail" as const,
        basis: "missing_evidence" as const,
      });
    return Object.freeze({
      check_key: key,
      outcome: observed === true ? ("pass" as const) : ("fail" as const),
      basis: "machine" as const,
    });
  });
  return Object.freeze({
    schema_version: "matchbase-pdf-qa.v1",
    releasable:
      checks.length === 16 && checks.every((x) => x.outcome === "pass"),
    renderer: PDF_RENDERER_VERSION,
    validator: PDF_VALIDATOR_VERSION,
    pdf_sha256: createHash("sha256").update(pdfBytes).digest("hex"),
    checks: Object.freeze(checks),
  });
}
