import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import {
  ADVISORY_BOUNDARY,
  DIRECTIONAL_SCORE_STATEMENT,
  RESTRICTED_PARTY_NOTICE,
  assertRenderedBands,
  assertStructuredZeroEligibleFixture,
  fitBandLabel,
  fixtureSetSha256,
  p4QualificationFixtures,
} from "../packages/reporting/dist/src/index.js";

const repoRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(repoRoot, "..", "..");
const temporaryRoot = resolve(workspaceRoot, "tmp", "pdfs", "p4-reporting");
const outputRoot = resolve(workspaceRoot, "04_Product_Artifacts", "pdf");
const managementRoot = resolve(workspaceRoot, "01_Product_Management");
await mkdir(temporaryRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });

const fixtures = p4QualificationFixtures();
assertRenderedBands(fixtures.flatMap(({ bands }) => bands));
const zeroEligibleFixture = fixtures.find(({ zero_eligible }) => zero_eligible);
if (!zeroEligibleFixture)
  throw new Error("Zero-eligible qualification fixture is missing.");
assertStructuredZeroEligibleFixture(zeroEligibleFixture);

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const rows = fixtures
  .flatMap((fixture) =>
    fixture.bands.map(
      (band) => `<tr data-fixture="${fixture.fixture_id}">
        <td data-variable-content>${escapeHtml(fixture.supplier_name)}</td>
        <td data-variable-content>${escapeHtml(fixture.role_description)}</td>
        <td>${band.score}</td>
        <td data-band data-score="${band.score}" data-ceiling="${band.band_ceiling}">${fitBandLabel(band.displayed_band)}</td>
      </tr>`,
    ),
  )
  .join("\n");
const excludedCandidateItems =
  zeroEligibleFixture.negative_result.candidates_considered
    .map(
      ({ candidate_id, exclusion_reason }) =>
        `<li><strong>${escapeHtml(candidate_id)}:</strong> ${escapeHtml(exclusion_reason)}</li>`,
    )
    .join("\n");
const relaxationItems = zeroEligibleFixture.negative_result.relaxation_options
  .map(
    ({ option_id, description }) =>
      `<li><strong>${escapeHtml(option_id)}:</strong> ${escapeHtml(description)}</li>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MatchBASE P4 Dual-Geometry Qualification</title>
<style>
  :root { color-scheme: light; --red:#C4292A; --text:#22252C; --muted:#6E727C; }
  * { box-sizing:border-box; }
  body { margin:0; color:var(--text); font:9.7pt/1.38 Arial, sans-serif; }
  header, footer { color:var(--muted); font-size:8pt; }
  header { border-bottom:1px solid #d9dce2; padding-bottom:4mm; margin-bottom:5mm; }
  footer { border-top:1px solid #d9dce2; padding-top:3mm; margin-top:5mm; }
  h1 { font-size:22pt; line-height:1.08; margin:0 0 4mm; }
  h2 { font-size:14pt; color:var(--red); margin:6mm 0 2.5mm; break-after:avoid; }
  h3 { font-size:11pt; margin:4mm 0 1.5mm; break-after:avoid; }
  p, li, td, th { orphans:3; widows:3; overflow-wrap:anywhere; word-break:normal; }
  .control { display:grid; grid-template-columns:minmax(34mm, 0.8fr) minmax(80mm, 2.2fr); gap:1.2mm 4mm; padding:3.5mm; background:#f3f4f6; border-left:2mm solid var(--red); }
  .control dt { font-weight:700; }
  .control dd { margin:0; }
  .notice { padding:3.5mm; border:1px solid #bbbfc8; background:#fafafa; break-inside:avoid; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  tr { break-inside:avoid; }
  th, td { border:0.25mm solid #aeb3bd; padding:2mm; vertical-align:top; }
  th { color:#fff; background:#7A1E20; text-align:left; }
  th:nth-child(1), td:nth-child(1) { width:31%; }
  th:nth-child(2), td:nth-child(2) { width:42%; }
  th:nth-child(3), td:nth-child(3) { width:9%; }
  th:nth-child(4), td:nth-child(4) { width:18%; }
  [data-variable-content] { min-width:0; }
  .negative { border-left:2mm solid #5a6270; padding-left:4mm; }
  .source-url { font-size:8.5pt; line-height:1.25; }
  a { color:#254b87; text-decoration:underline; }
  @media print { a { color:#22252C; } }
</style></head><body>
<header aria-hidden="true">CONFIDENTIAL - FOR REVIEW - MatchBASE synthetic qualification</header>
<main>
<h1>MatchBASE P4 Dual-Geometry Qualification</h1>
<dl class="control" aria-label="Document control">
<dt>Document</dt><dd>MatchBASE P4 Dual-Geometry Qualification</dd>
<dt>Prepared by</dt><dd>MatchBASE isolated-local qualification pipeline</dd>
<dt>Prepared date</dt><dd>2026-08-29</dd>
<dt>Classification</dt><dd>Confidential</dd>
<dt>Status</dt><dd>For Review</dd>
<dt>Basis</dt><dd>Synthetic fixtures only; no real-user or supplier data</dd>
</dl>
<h2>Confidentiality and reliance notice</h2>
<div class="notice" data-variable-content><p>${escapeHtml(ADVISORY_BOUNDARY)}</p><p>This qualification artifact is confidential and may be relied on only as evidence of the isolated-local synthetic checks stated in this document. It is not a production release, procurement decision, legal opinion, or supplier verification.</p></div>
<h2>Scoring model and render-time band assertion</h2>
<p data-variable-content>${escapeHtml(DIRECTIONAL_SCORE_STATEMENT)}</p>
<table aria-label="Band and long-content qualification fixtures">
<thead><tr><th scope="col">Supplier</th><th scope="col">Role / qualification condition</th><th scope="col">Score</th><th scope="col">Displayed band</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>No-responsible-match deliverable</h2>
<section class="negative" data-variable-content>
<p><strong>Search performed:</strong> ${escapeHtml(zeroEligibleFixture.negative_result.search_performed.scope)}</p>
<p><strong>Search ID:</strong> ${escapeHtml(zeroEligibleFixture.negative_result.search_performed.search_id)}</p>
<h3>Candidates considered and exclusion reasons</h3>
<ul>${excludedCandidateItems}</ul>
<h3>Relaxation options</h3>
<ul>${relaxationItems}</ul>
<p>Every relaxation option preserves all hard gates. No candidate is padded into the result.</p>
<p>${escapeHtml(RESTRICTED_PARTY_NOTICE)}</p>
</section>
<h2>Source register</h2>
<p data-variable-content>Fixture set SHA-256: ${fixtureSetSha256(fixtures)}</p>
<p class="source-url" data-variable-content>Long URL fixture: https://evidence.synthetic.matchbase.invalid/qualification/source-register/this-is-a-deliberately-long-path-used-only-to-prove-that-source-register-values-wrap-without-clipping-or-truncation-at-both-supported-page-geometries</p>
</main>
<footer aria-hidden="true">CONFIDENTIAL - FOR REVIEW - classification and status are carried in artifact content</footer>
</body></html>`;

const htmlPath = resolve(temporaryRoot, "p4-qualification.html");
await writeFile(htmlPath, html, "utf8");

const bandRank = { "Low Fit": 0, "Potential Fit": 1, "Strong Fit": 2 };
const expectedBand = (score, ceiling) => {
  const fit =
    score >= 76 ? "Strong Fit" : score >= 46 ? "Potential Fit" : "Low Fit";
  const cap = {
    low_fit: "Low Fit",
    potential_fit: "Potential Fit",
    strong_fit: "Strong Fit",
  }[ceiling];
  return bandRank[fit] <= bandRank[cap] ? fit : cap;
};

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const results = [];
try {
  for (const geometry of ["A4", "Letter"]) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
    });
    await page.goto(new URL(`file:///${htmlPath.replaceAll("\\", "/")}`).href, {
      waitUntil: "load",
    });
    await page.emulateMedia({ media: "print" });
    const qa = await page.evaluate(() => {
      const rect = (element) => element.getBoundingClientRect();
      const overflow = [...document.querySelectorAll("[data-variable-content]")]
        .filter(
          (element) =>
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1,
        )
        .map((element) => element.textContent?.slice(0, 100));
      const collisions = [];
      for (const row of document.querySelectorAll("tr")) {
        const cells = [...row.children].map(rect);
        for (let index = 1; index < cells.length; index += 1) {
          if (cells[index - 1].right > cells[index].left + 0.5)
            collisions.push(row.textContent?.slice(0, 100));
        }
      }
      const bands = [...document.querySelectorAll("[data-band]")].map(
        (element) => ({
          score: Number(element.getAttribute("data-score")),
          ceiling: element.getAttribute("data-ceiling"),
          label: element.textContent?.trim(),
        }),
      );
      return {
        overflow,
        collisions,
        bands,
        title: document.title,
        lang: document.documentElement.lang,
      };
    });
    if (qa.overflow.length || qa.collisions.length)
      throw new Error(
        `${geometry} overflow/collision QA failed: ${JSON.stringify(qa)}`,
      );
    for (const band of qa.bands) {
      const expected = expectedBand(band.score, band.ceiling);
      if (band.label !== expected)
        throw new Error(
          `${geometry} rendered band mismatch: expected ${expected}, received ${band.label}`,
        );
    }
    if (
      qa.title !== "MatchBASE P4 Dual-Geometry Qualification" ||
      qa.lang !== "en"
    )
      throw new Error(`${geometry} document title or language is invalid.`);
    const outputPath = resolve(
      outputRoot,
      `MatchBASE_P4_Dual_Geometry_Qualification_2026-08-29_${geometry}.pdf`,
    );
    await page.pdf({
      path: outputPath,
      format: geometry,
      printBackground: true,
      tagged: true,
      outline: true,
      margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
    });
    await page.close();
    const bytes = await readFile(outputPath);
    results.push({
      geometry: geometry.toLocaleLowerCase("en-US"),
      path: outputPath,
      byte_size: bytes.byteLength,
      file_sha256: createHash("sha256")
        .update(bytes)
        .digest("hex")
        .toUpperCase(),
      dom_overflow_count: qa.overflow.length,
      dom_collision_count: qa.collisions.length,
      rendered_band_count: qa.bands.length,
    });
  }
} finally {
  await browser.close();
}

const popplerRoot =
  "C:/Users/ehsan/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin";
for (const result of results) {
  const info = spawnSync(resolve(popplerRoot, "pdfinfo.exe"), [result.path], {
    encoding: "utf8",
  });
  if (info.status !== 0) throw new Error(info.stderr || "pdfinfo failed");
  const textPath = resolve(temporaryRoot, `${result.geometry}.txt`);
  const python =
    "C:/Users/ehsan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
  const extraction = [
    "from pathlib import Path",
    "from pypdf import PdfReader",
    "import sys",
    "reader=PdfReader(sys.argv[1])",
    "Path(sys.argv[2]).write_text('\\n'.join((page.extract_text() or '') for page in reader.pages), encoding='utf-8')",
  ].join(";");
  const textRun = spawnSync(python, ["-c", extraction, result.path, textPath], {
    encoding: "utf8",
  });
  if (textRun.status !== 0)
    throw new Error(
      textRun.stderr || textRun.error?.message || "PDF text extraction failed",
    );
  const extracted = await readFile(textPath, "utf8");
  for (const required of [
    DIRECTIONAL_SCORE_STATEMENT,
    RESTRICTED_PARTY_NOTICE,
    fixtures[1].supplier_name,
    fixtures[2].role_description,
    "Potential Fit",
    "Strong Fit",
    ...zeroEligibleFixture.negative_result.candidates_considered.map(
      ({ exclusion_reason }) => exclusion_reason,
    ),
    ...zeroEligibleFixture.negative_result.relaxation_options.map(
      ({ description }) => description,
    ),
  ]) {
    const normalizeExtracted = (value) =>
      value.replaceAll(/-\s+/gu, "-").replaceAll(/\s+/gu, " ").trim();
    if (!normalizeExtracted(extracted).includes(normalizeExtracted(required)))
      throw new Error(
        `${result.geometry} extracted PDF text lost required content: ${required}`,
      );
  }
  result.pdfinfo = Object.fromEntries(
    info.stdout
      .split(/\r?\n/u)
      .map((line) => line.match(/^([^:]+):\s*(.+)$/u))
      .filter(Boolean)
      .map((match) => [match[1].trim(), match[2].trim()]),
  );
}

const evidence = {
  schema_version: "matchbase.p4-reporting-qualification/v1",
  recorded_at: "2026-08-29T08:16:49Z",
  environment: "ISOLATED_LOCAL",
  data_class: "SYNTHETIC_ONLY",
  fixture_set_sha256: fixtureSetSha256(fixtures).toUpperCase(),
  gate_results: {
    GF_PDF_013: "PASS",
    GF_PDF_019a_A4: "PASS",
    GF_PDF_019a_LETTER: "PASS",
    GF_PDF_019b_A4: "PASS",
    GF_PDF_019b_LETTER: "PASS",
    G1_band_assertion: "PASS",
    G3_overflow_collision: "PASS",
    G13_page_geometry_both: "PASS",
    G11_template_level_human_review: "BLOCKED_HUMAN",
    counsel_notice_approval: "BLOCKED_HUMAN",
  },
  artifacts: results,
};
const evidencePath = resolve(
  managementRoot,
  "P4_REPORTING_QUALIFICATION_EVIDENCE_2026-08-29.json",
);
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ evidencePath, results }, null, 2)}\n`);
