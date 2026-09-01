import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { P4_QA_CHECK_KEYS } from "../src/artifact-foundation.js";
import {
  evaluatePdfQa,
  renderServerOwnedHtml,
  weasyPrintArguments,
} from "../src/pdf-toolchain.js";

test("HTML is server-owned and escapes supplied text", () => {
  const html = renderServerOwnedHtml({
    title: "<script>x</script>",
    sections: [{ heading: "Need", paragraphs: ["https://evil.test <img>"] }],
  });
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
  assert.equal(html.includes("stylesheet"), false);
});

test("Consultant report renders a branded, numbered, accessible information hierarchy", () => {
  const html = renderServerOwnedHtml({
    title: "Synthetic agriculture assessment",
    subtitle: "Three-container qualification scenario",
    metadata: {
      document_id: "MB-SYN-001",
      status: "Qualification fixture",
      prepared_at: "2026-09-01",
      classification: "Synthetic evaluation data",
    },
    sections: [
      {
        heading: "Executive summary",
        paragraphs: ["No supplier claim is made."],
      },
      {
        heading: "Evidence boundaries",
        paragraphs: ["Only stated evidence may support a decision."],
        cards: [
          {
            label: "Evidence state",
            value: "Synthetic",
            detail: "No live source asserted.",
          },
        ],
        tables: [
          {
            caption: "Source-ready evidence register",
            columns: ["Claim", "Evidence ID"],
            rows: [["No supplier claim", "Not assigned"]],
          },
        ],
      },
    ],
  });
  assert.match(html, /class="report-cover"/u);
  assert.match(
    html,
    /class="running-header" aria-hidden="true">MATCHBASE&nbsp; \/ &nbsp;CONSULTANT REPORT/u,
  );
  assert.match(
    html,
    /class="running-footer" aria-hidden="true">Synthetic agriculture assessment/u,
  );
  assert.match(html, /class="brand-lockup" aria-label="MatchBASE"/u);
  assert.match(html, /<title>Synthetic agriculture assessment<\/title>/u);
  assert.match(html, /class="document-metadata"/u);
  assert.match(html, /<dt>document id<\/dt><dd>MB-SYN-001<\/dd>/u);
  assert.equal((html.match(/class="report-section"/gu) ?? []).length, 2);
  assert.match(html, /aria-labelledby="section-1"/u);
  assert.match(html, /<h2 id="section-2">Evidence boundaries<\/h2>/u);
  assert.match(html, /<dl class="evidence-cards">/u);
  assert.match(
    html,
    /<table><caption>Source-ready evidence register<\/caption>/u,
  );
  assert.match(html, /<th scope="col">Evidence ID<\/th>/u);
});

test("source-ready tables reject malformed or unlabelled structures", () => {
  assert.throws(() =>
    renderServerOwnedHtml({
      title: "Report",
      sections: [
        {
          heading: "Evidence",
          paragraphs: ["Bounded."],
          tables: [
            {
              caption: "Register",
              columns: ["Claim", "Source"],
              rows: [["Only one cell"]],
            },
          ],
        },
      ],
    }),
  );
  assert.throws(() =>
    renderServerOwnedHtml({
      title: "Report",
      sections: [
        {
          heading: "Evidence",
          paragraphs: ["Bounded."],
          cards: [{ label: "", value: "Synthetic" }],
        },
      ],
    }),
  );
});

test("optional metadata never creates invented placeholders", () => {
  const html = renderServerOwnedHtml({
    title: "Bounded report",
    sections: [{ heading: "Scope", paragraphs: ["Evidence only."] }],
  });
  assert.equal(html.includes("document-metadata"), false);
  assert.doesNotMatch(html, /(?:unknown|placeholder|not available|N\/A)/iu);
});

test("pagination uses only the default page and a furniture-free first page", async () => {
  const root = new URL("../../pdf-toolchain/", import.meta.url);
  const [reportCss, a4Css, letterCss] = await Promise.all([
    readFile(new URL("report.css", root), "utf8"),
    readFile(new URL("a4.css", root), "utf8"),
    readFile(new URL("letter.css", root), "utf8"),
  ]);
  assert.doesNotMatch(reportCss, /\bpage\s*:/u);
  for (const geometryCss of [a4Css, letterCss]) {
    assert.equal((geometryCss.match(/@page\s*\{/gu) ?? []).length, 1);
    assert.equal((geometryCss.match(/@page\s+:first\s*\{/gu) ?? []).length, 1);
    assert.doesNotMatch(geometryCss, /@page\s+(?:cover|report)\b/u);
  }
});

test("renderer arguments are local-only and geometry-specific", () => {
  const args = weasyPrintArguments(
    "a4",
    "/work/report.html",
    "/work/report.pdf",
  );
  assert.deepEqual(args.slice(0, 7), [
    "--pdf-tags",
    "--pdf-variant",
    "pdf/ua-1",
    "--allowed-protocols",
    "file,data",
    "--no-http-redirects",
    "--fail-on-http-errors",
  ]);
  assert.equal(args.includes("/opt/matchbase/report-assets/a4.css"), true);
  assert.equal(args.includes("/opt/matchbase/report-assets/report.css"), true);
  assert.throws(() =>
    weasyPrintArguments("letter", "https://example.test/a", "/work/a.pdf"),
  );
});

test("QA emits exactly sixteen checks and fails closed on missing or manual evidence", () => {
  const report = evaluatePdfQa(
    new TextEncoder().encode("%PDF-1.7\nfixture"),
    {},
    {},
  );
  assert.deepEqual(
    report.checks.map((check) => check.check_key),
    P4_QA_CHECK_KEYS,
  );
  assert.equal(report.checks.length, 16);
  assert.equal(report.releasable, false);
  assert.equal(
    report.checks.some((check) => check.basis === "missing_evidence"),
    true,
  );
  assert.equal(
    report.checks.find((check) => check.check_key === "tagged_structure")
      ?.basis,
    "manual_required",
  );
});

test("QA cannot be authorized with caller supplied booleans", () => {
  const forged = Object.fromEntries(P4_QA_CHECK_KEYS.map((key) => [key, true]));
  const report = evaluatePdfQa(
    new TextEncoder().encode("%PDF-1.7\nfixture"),
    forged,
    { isCompliant: true },
  );
  assert.equal(report.releasable, false);
  assert.equal(report.checks.length, 16);
});

test("veraPDF admission requires the closed UA-1 result shape", () => {
  const report = evaluatePdfQa(
    new TextEncoder().encode("%PDF-1.7\nfixture"),
    {},
    {
      unrelated: {
        compliant: true,
        profileName: "PDF/UA-1 validation profile",
      },
    },
  );
  assert.equal(
    report.checks.find((check) => check.check_key === "veraPDF")?.outcome,
    "fail",
  );
});

test("band, wave, truncation and contradiction checks derive from model structure", () => {
  const model = {
    band_label: "qualified",
    render_band: "qualified",
    wave_recommendations: [{ wave_id: "RFQ_WAVE_INITIAL", candidates: [] }],
    landscape: {
      total_eligible_count: 5,
      displayed_count: 3,
      truncation_notice: "Two eligible candidates are not displayed.",
    },
    contradictions: [{ contradiction_id: "c1" }],
    sections: [{ section_id: "SEC-05.2" }],
  };
  const report = evaluatePdfQa(
    new TextEncoder().encode("%PDF-1.7\nfixture"),
    model,
    {},
  );
  for (const key of [
    "band_label_equals_render_band",
    "wave_separated_from_band",
    "truncation_disclosure",
    "contradiction_declaration",
  ] as const)
    assert.equal(
      report.checks.find((check) => check.check_key === key)?.outcome,
      "pass",
    );
});

test("undisclosed truncation and contradiction fail closed", () => {
  const model = {
    band_label: "a",
    render_band: "b",
    wave_recommendations: [{ wave_id: "RFQ_WAVE_INITIAL", band: "a" }],
    landscape: { total_eligible_count: 5, displayed_count: 3 },
    contradictions: [{ contradiction_id: "c1" }],
    sections: [],
  };
  const report = evaluatePdfQa(
    new TextEncoder().encode("%PDF-1.7\nfixture"),
    model,
    {},
  );
  for (const key of [
    "band_label_equals_render_band",
    "wave_separated_from_band",
    "truncation_disclosure",
    "contradiction_declaration",
  ] as const)
    assert.equal(
      report.checks.find((check) => check.check_key === key)?.outcome,
      "fail",
    );
});
