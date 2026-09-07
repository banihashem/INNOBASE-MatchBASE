import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedRequestSnapshotV3,
  GOLDEN_SCENARIO_V3_01,
} from "@matchbase/contracts";
import { generateConsultantLandscapeHtml } from "../src/consultant-landscape-report.js";

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
