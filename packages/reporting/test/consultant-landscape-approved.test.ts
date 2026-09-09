import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedRequestSnapshotV3,
  GOLDEN_SCENARIO_V3_01,
} from "@matchbase/contracts";
import {
  ConsultantReportLanguageError,
  generateConsultantLandscapeHtml,
} from "../src/consultant-landscape-report.js";

test("MB-UX-LIVE-001 L01 full report retains every profile, commercial observation and source", () => {
  const approved = createApprovedRequestSnapshotV3({
    revision_id: "report-approved-1",
    approved_at: "2026-09-07T00:00:00Z",
    product_name: "Specialty frozen poultry",
    product_category: "Food",
    approved_translation:
      "Exactly 7 units, CIF Sharjah, 36 months UAE warranty.",
  });
  const output = {
    ...GOLDEN_SCENARIO_V3_01,
    approved_request_snapshot: approved,
  };
  const html = generateConsultantLandscapeHtml(output);
  for (const supplier of output.supplier_candidates) {
    assert.ok(html.includes(supplier.legal_name), supplier.legal_name);
    if (supplier.commercial.incoterm)
      assert.ok(html.includes(supplier.commercial.incoterm));
    for (const gap of supplier.assessment.required_validation)
      assert.ok(
        html.includes(
          gap
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;"),
        ),
      );
  }
  for (const source of output.evidence_sources)
    assert.ok(html.includes(`id="evidence-${source.evidence_id}"`));
  assert.equal(
    (html.match(/class="page" id="supplier-\d+"/g) ?? []).length,
    output.supplier_candidates.length,
  );
  assert.equal(
    (html.match(/class="page" id="dossier-\d+"/g) ?? []).length,
    output.supplier_candidates.length,
  );
  assert.ok(html.includes(approved.content_hash));
  assert.ok(html.includes("CIF (Sharjah)"));
});

test("MB-UX-LIVE-001 L01 missing historical lineage cannot invent buyer requirements", () => {
  const html = generateConsultantLandscapeHtml({
    ...GOLDEN_SCENARIO_V3_01,
    supplier_candidates: [],
    claims: [],
    evidence_sources: [],
  });
  assert.ok(html.includes("no trustworthy approved request snapshot"));
  assert.ok(!html.includes("500 L nominal capacity"));
  assert.ok(!html.includes("Maximum 85 cm"));
  assert.ok(!html.includes("Two-year UAE warranty"));
});

test("MB-UX-LIVE-001 L01 report escapes untrusted supplier data and rejects active URL schemes", () => {
  const supplier = GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!;
  const html = generateConsultantLandscapeHtml({
    ...GOLDEN_SCENARIO_V3_01,
    supplier_candidates: [
      {
        ...supplier,
        legal_name: '<script>alert("x")</script>',
        website: "javascript:alert(1)",
      },
    ],
  });
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("&lt;script&gt;"));
});

const originalLanguageNarrative =
  "\u0647\u06cc\u0686 \u062a\u0623\u0645\u06cc\u0646\u200c\u06a9\u0646\u0646\u062f\u0647\u200c\u0627\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a";
const approvedWmfText =
  "We require the WMF 1500 S+ coffee machine for Dubai. Initial order is exactly 3 machines. Each machine must be new and unused with a traceable serial number. A minimum 12-month warranty valid in the UAE is mandatory. Delivery must occur no later than 30 calendar days after order confirmation. AutoClean is preferred and must be priced separately. State the milk system, grinder count, hopper configuration, electrical and water connections, dimensions and included accessories. Itemize machine price, options, taxes and delivery charges. Installation and maintenance contracts are excluded. Alternatives require separate buyer approval.";
function englishReportFixture() {
  const approved = createApprovedRequestSnapshotV3({
    revision_id: "english-report-request",
    approved_at: "2026-09-09T00:00:00Z",
    product_name: "WMF 1500 S+ coffee machines",
    product_category: "Coffee machines",
    approved_translation: approvedWmfText,
  });
  return {
    ...GOLDEN_SCENARIO_V3_01,
    research_mode: "live" as const,
    approved_request_snapshot: approved,
    request_snapshot: {
      ...GOLDEN_SCENARIO_V3_01.request_snapshot,
      product_name: approved.product_name,
    },
    executive_summary: {
      ...GOLDEN_SCENARIO_V3_01.executive_summary,
      direct_answer: originalLanguageNarrative,
    },
    limitations_and_disclosures: [
      {
        title: "Recorded request cost",
        severity: "info" as const,
        description:
          "USD 1.368138 recorded: preparation USD 0.401743; research USD 0.966396. Recorded API usage is not a provider invoice.",
      },
    ],
  };
}

test("MB-UX-LIVE-001 L13 historical non-English summary becomes a disclosed English presentation with all essential requirements", () => {
  const output = {
    ...englishReportFixture(),
    supplier_candidates: [],
    claims: [],
  };
  const original = structuredClone(output);
  const html = generateConsultantLandscapeHtml(output);
  assert.equal(/[\u0600-\u06ff]/u.test(html), false);
  assert.ok(html.includes("0 supplier profiles"));
  assert.ok(
    html.includes(
      `${output.evidence_sources.length} evidence sources and 0 claims`,
    ),
  );
  assert.ok(html.includes("no supplier ranking can be presented"));
  assert.ok(html.includes("English presentation reconstructed"));
  assert.ok(html.includes("not a new research or translation call"));
  assert.ok(html.includes(approvedWmfText));
  assert.ok(html.includes("USD 1.368138"));
  assert.ok(html.includes(output.approved_request_snapshot.content_hash));
  assert.ok(html.includes("Supplier Landscape - No Published Profiles"));
  assert.ok(!html.includes("1 to 0 of 0"));
  for (const source of output.evidence_sources)
    assert.ok(html.includes(`id="evidence-${source.evidence_id}"`));
  assert.deepEqual(
    output,
    original,
    "Historical narrative, source facts, and approval hashes remain immutable",
  );
});

test("MB-UX-LIVE-001 L13 reconstructed overview uses retained profile and observation counts without inventing qualification", () => {
  const output = englishReportFixture();
  const html = generateConsultantLandscapeHtml(output);
  assert.ok(
    html.includes(`${output.supplier_candidates.length} supplier profiles`),
  );
  assert.ok(html.includes("inclusion does not establish full compliance"));
  const prices = output.supplier_candidates.filter(
    (s) =>
      s.commercial.price_min !== undefined ||
      s.commercial.price_max !== undefined,
  ).length;
  const contacts = output.supplier_candidates.filter(
    (s) =>
      s.contacts?.sales_email ||
      s.contacts?.export_email ||
      s.contacts?.general_email ||
      s.contacts?.phone,
  ).length;
  assert.ok(
    html.includes(
      `${prices} profiles contain an observed price and ${contacts} contain business contact data`,
    ),
  );
  for (const supplier of output.supplier_candidates)
    assert.ok(html.includes(supplier.legal_name));
});

test("MB-UX-LIVE-001 L13 historical original-language fact provenance is projected only from complete approved English", () => {
  const output = englishReportFixture();
  output.approved_request_snapshot = {
    ...output.approved_request_snapshot,
    facts: output.approved_request_snapshot.facts.map((fact) => ({
      ...fact,
      source_clause: originalLanguageNarrative,
    })),
    unparsed_clauses: [originalLanguageNarrative],
  };
  const original = structuredClone(output);
  const html = generateConsultantLandscapeHtml(output);
  assert.ok(html.includes(approvedWmfText));
  assert.ok(html.includes("12 months"));
  assert.ok(html.includes("3 units"));
  assert.ok(html.includes("English presentation reconstructed"));
  assert.equal(/[\u0600-\u06ff]/u.test(html), false);
  assert.deepEqual(output, original);
});

test("MB-UX-LIVE-001 L13 non-English approved requirements cannot be silently omitted or presented as translated", () => {
  const output = englishReportFixture();
  output.approved_request_snapshot = {
    ...output.approved_request_snapshot,
    approved_translation: originalLanguageNarrative,
  };
  assert.throws(
    () => generateConsultantLandscapeHtml(output),
    (error) =>
      error instanceof ConsultantReportLanguageError &&
      error.code === "MB-422-PDF-ENGLISH-REQUIRED",
  );
});

test("MB-UX-LIVE-001 L14 untranslated supplier facts, claims and risks fail explicitly instead of disappearing", () => {
  const output = englishReportFixture();
  const supplier = output.supplier_candidates[0]!;
  assert.throws(
    () =>
      generateConsultantLandscapeHtml({
        ...output,
        supplier_candidates: [
          { ...supplier, legal_name: originalLanguageNarrative },
        ],
      }),
    ConsultantReportLanguageError,
  );
  assert.throws(
    () =>
      generateConsultantLandscapeHtml({
        ...output,
        claims: [
          { ...output.claims[0]!, claim_text: originalLanguageNarrative },
        ],
      }),
    ConsultantReportLanguageError,
  );
  assert.throws(
    () =>
      generateConsultantLandscapeHtml({
        ...output,
        supplier_candidates: [
          {
            ...supplier,
            assessment: {
              ...supplier.assessment,
              limiting_gaps: [originalLanguageNarrative],
            },
          },
        ],
      }),
    ConsultantReportLanguageError,
  );
  assert.throws(
    () =>
      generateConsultantLandscapeHtml({
        ...output,
        executive_summary: {
          ...output.executive_summary,
          key_findings: [originalLanguageNarrative],
        },
      }),
    ConsultantReportLanguageError,
  );
});

test("MB-UX-LIVE-001 L14 original-language sources disclose an English claim projection without changing evidence", () => {
  const output = englishReportFixture();
  const source = output.evidence_sources[0]!;
  const negative = {
    ...output.claims[0]!,
    claim_id: "negative-source-claim",
    claim_text:
      "Published stock status is sold out; requested quantity is not confirmed.",
    evidence_ids: [source.evidence_id],
  };
  const projected = {
    ...output,
    claims: [...output.claims, negative],
    evidence_sources: [
      {
        ...source,
        source_title: originalLanguageNarrative,
        publisher: originalLanguageNarrative,
        excerpt_summary: originalLanguageNarrative,
        contradicts_claim_ids: [negative.claim_id],
      },
      {
        ...source,
        evidence_id: "unlinked-original-source",
        source_id: "unlinked-source-id",
        source_title: originalLanguageNarrative,
        excerpt_summary: originalLanguageNarrative,
        supports_claim_ids: [],
        contradicts_claim_ids: [],
      },
    ],
  };
  const original = structuredClone(projected);
  const baselineHtml = generateConsultantLandscapeHtml(output);
  const html = generateConsultantLandscapeHtml(projected);
  assert.ok(
    html.includes("Original-language source - Original-language publisher"),
  );
  assert.ok(
    html.includes(
      "Original-language quotation remains in the saved evidence and at the source link",
    ),
  );
  assert.ok(
    html.includes("not a translation or evidence of a full source review"),
  );
  assert.ok(html.includes(negative.claim_text));
  assert.ok(html.includes(negative.claim_id));
  assert.ok(
    html.includes(
      "Source retained; no published claim is attributed to this source.",
    ),
  );
  for (const s of projected.evidence_sources) {
    assert.ok(html.includes(`id="evidence-${s.evidence_id}"`));
    assert.ok(html.includes(s.source_id));
    assert.ok(html.includes(s.source_url.replaceAll("&", "&amp;")));
    assert.ok(html.includes(s.retrieved_at));
  }
  for (const claim of projected.claims) {
    const rendered = claim.claim_text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
    if (baselineHtml.includes(rendered)) assert.ok(html.includes(rendered));
  }
  assert.ok(!html.includes(originalLanguageNarrative));
  assert.deepEqual(projected, original);
});

test("MB-UX-LIVE-001 L13 existing English reports retain exact findings and accented official names", () => {
  const output = englishReportFixture();
  const supplier = output.supplier_candidates[0]!;
  const directAnswer =
    "Recorded product observations require further commercial validation. Test specifications: 5 \u03a9 resistance and 20 \u03bcm filter size.";
  const html = generateConsultantLandscapeHtml({
    ...output,
    executive_summary: {
      ...output.executive_summary,
      direct_answer: directAnswer,
    },
    supplier_candidates: [
      { ...supplier, legal_name: "S\u00e3o Paulo Equipment" },
    ],
  });
  assert.ok(html.includes(directAnswer));
  assert.ok(html.includes("S\u00e3o Paulo Equipment"));
  assert.ok(!html.includes("English presentation reconstructed"));
});
