import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLDEN_SCENARIO_V3_01,
  compileSearchDimensionPlan,
  createSearchDimensionConfiguration,
  parseConsultantResearchOutputV3,
} from "../../../packages/contracts/dist/src/index.js";
import { buildSearchDimensionOutput } from "../../../packages/application/dist/search-dimension-output.js";
import { generateConsultantLandscapeHtml } from "../../../packages/reporting/dist/src/consultant-landscape-report.js";
import { renderSearchDimensionAssessment } from "../../../packages/reporting/dist/src/dimension-report.js";

function fixture() {
  const output = structuredClone(GOLDEN_SCENARIO_V3_01);
  output.research_mode = "hybrid";
  output.generated_at = "2026-10-03T00:00:00.000Z";
  output.as_of_date = output.generated_at;
  output.supplier_candidates = [output.supplier_candidates[0]];
  output.total_candidates_found = 1;
  output.executive_summary.candidate_count = 1;
  const supplier = output.supplier_candidates[0];
  supplier.entity_basis = "live_verified";
  supplier.evidence_basis = "live_evidence";
  delete supplier.fixture_entity_id;
  supplier.commercial = {
    commercial_confidence: "medium",
    commercial_evidence_ids: [],
  };
  output.claims = [];
  output.evidence_sources = [];
  const configuration = createSearchDimensionConfiguration({
    profile_ids: ["logistics.ocean", "industrial.pumps"],
  });
  const plan = () =>
    compileSearchDimensionPlan(configuration, {
      owner_scope: {
        account_id: "isolated-account",
        user_profile_id: output.user_profile_id,
      },
      primary_classification_id: output.classification_id,
      original_buyer_intent:
        "Industrial pump supplier research with freight and a commercial contact.",
    });
  const source = {
    evidence_id: "dimension-source-1",
    source_id: "dimension-source-1",
    source_url: "https://supplier.example/offer",
    source_title: "Official supplier offer",
    publisher: "Supplier",
    source_type: "official_website",
    retrieved_at: "2026-10-02T00:00:00.000Z",
    freshness_status: "current",
    verification_status: "externally_verified",
    excerpt_summary: "",
    supports_claim_ids: [],
    contradicts_claim_ids: [],
  };
  output.evidence_sources.push(source);
  const add = (field_path, value) => {
    const claim = {
      claim_id: `dimension-claim-${output.claims.length + 1}`,
      supplier_entity_id: supplier.supplier_entity_id,
      claim_type: field_path.startsWith("commercial.") ? "pricing" : "identity",
      field_path,
      claim_text: `${field_path}: ${value}`,
      normalized_value: value,
      status: "externally_verified",
      confidence: "medium",
      conflict_status: "single_source",
      evidence_ids: [source.evidence_id],
    };
    output.claims.push(claim);
    source.supports_claim_ids.push(claim.claim_id);
    source.excerpt_summary += ` ${field_path}: ${value}.`;
    return claim;
  };
  const build = () => ({
    ...output,
    ...buildSearchDimensionOutput(plan(), output),
  });
  const row = (result, id) =>
    result.search_dimension_assessments[0].dimensions.find(
      (entry) => entry.dimension_id === id,
    );
  return { output, supplier, configuration, source, add, plan, build, row };
}

test("MB-SEARCH-DIMENSIONS-002 L01 canonical current evidence yields unknown research coverage without changing rank", () => {
  const { output, add, build, row } = fixture();
  add("contacts.sales_email", "sales@supplier.example");
  add("headquarters_address", "120 Main Street, Dubai");
  add("search_dimensions.pump.materials", "Duplex steel");
  add("specifications.pump_materials", "Duplex steel");
  const before = structuredClone(output.supplier_candidates[0].assessment);
  const result = build();
  assert.deepEqual(parseConsultantResearchOutputV3(result), result);
  assert.equal(row(result, "core.contact").execution_status, "completed");
  assert.equal(row(result, "core.contact").outcome, "unknown");
  assert.deepEqual(row(result, "core.contact").observed_values, [
    "sales@supplier.example",
  ]);
  assert.equal(row(result, "core.location").execution_status, "completed");
  assert.equal(row(result, "pump.materials").execution_status, "unexecuted");
  assert.equal(row(result, "pump.materials").outcome, "unknown");
  assert.equal(
    result.search_dimension_assessments[0].eligibility,
    "needs_review",
  );
  assert.deepEqual(result.supplier_candidates[0].assessment, before);
  for (const observation of result.search_dimension_observations) {
    assert.equal(observation.trace.execution_id, output.execution_id);
    assert.equal(observation.trace.research_run_id, output.research_run_id);
    assert.equal(observation.source.source_id, "dimension-source-1");
    assert.ok(observation.source.literal_excerpt.includes(observation.value));
  }
});

test("MB-SEARCH-DIMENSIONS-002 L01 missing evidence, noncurrent sources and partial contact observations cannot decide predicates", () => {
  for (const mutate of [
    ({ output }) => {
      output.research_mode = "fixture";
    },
    ({ source }) => {
      source.freshness_status = "historical";
    },
    ({ source }) => {
      source.retrieved_at = "2026-10-04T00:00:00Z";
    },
    ({ source }) => {
      source.supports_claim_ids = [];
    },
    ({ source }) => {
      source.excerpt_summary = "No literal value";
    },
    ({ source }) => {
      source.source_url = "https://name:secret@host.example/";
    },
    ({ output }) => {
      output.claims[0].status = "inferred";
    },
    ({ configuration }) => {
      const selection = configuration.selections.find(
        (entry) => entry.dimension_id === "core.contact",
      );
      selection.operator = "equals";
      selection.expected = "other@supplier.example";
    },
    ({ configuration }) => {
      configuration.selections.find(
        (entry) => entry.dimension_id === "core.contact",
      ).scope.lot_id = "lot-b";
    },
  ]) {
    const state = fixture();
    state.add("contacts.general_email", "info@supplier.example");
    mutate(state);
    const result = state.build();
    assert.equal(state.row(result, "core.contact").outcome, "unknown");
    assert.equal(
      state.row(result, "core.contact").execution_status,
      "unexecuted",
    );
  }
});

test("MB-SEARCH-DIMENSIONS-002 L01 supplier price admission requires same-source date currency unit and current validity", () => {
  const state = fixture();
  for (const [field, value] of [
    ["price_min", "120"],
    ["price_date", "2026-10-01"],
    ["currency", "USD"],
    ["unit", "unit"],
  ])
    state.add(`commercial.${field}`, value);
  Object.assign(state.supplier.commercial, {
    price_min: 120,
    price_date: "2026-10-01",
    currency: "USD",
    unit: "unit",
  });
  state.source.excerpt_summary += " Published 2026-10-01.";
  assert.equal(
    state.row(state.build(), "core.price").execution_status,
    "completed",
  );
  assert.equal(state.row(state.build(), "core.price").outcome, "unknown");
  state.output.claims.find(
    (entry) => entry.field_path === "commercial.price_date",
  ).evidence_ids = ["unknown-source"];
  assert.equal(
    state.row(state.build(), "core.price").execution_status,
    "unexecuted",
  );
  state.output.claims.find(
    (entry) => entry.field_path === "commercial.price_date",
  ).evidence_ids = [state.source.evidence_id];
  state.add("commercial.price_validity", "2026-10-02");
  state.supplier.commercial.price_validity = "2026-10-02";
  assert.equal(
    state.row(state.build(), "core.price").execution_status,
    "unexecuted",
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 parser rejects forged eligibility observations sources trace and partial bundles", () => {
  const state = fixture();
  state.add("contacts.sales_email", "sales@supplier.example");
  const valid = state.build();
  for (const mutate of [
    (result) => {
      result.search_dimension_assessments[0].eligibility = "eligible";
    },
    (result) => {
      result.search_dimension_assessments[0].plan_hash = "forged";
    },
    (result) => {
      result.search_dimension_observations[0].trace.execution_id =
        "other-execution";
    },
    (result) => {
      result.search_dimension_observations[0].value =
        "invented@supplier.example";
    },
    (result) => {
      result.search_dimension_observations[0].source.uri =
        "https://unrelated.example/";
    },
    (result) => {
      result.search_dimension_plan.primary_classification_id = "other-primary";
    },
    (result) => {
      result.evidence_sources = [];
    },
    (result) => {
      delete result.search_dimension_observations;
    },
    (result) => {
      delete result.search_dimension_plan;
    },
  ]) {
    const result = structuredClone(valid);
    mutate(result);
    assert.throws(() => parseConsultantResearchOutputV3(result), /dimension/i);
  }
  assert.throws(
    () =>
      buildSearchDimensionOutput(state.plan(), {
        ...state.output,
        user_profile_id: "other-owner",
      }),
    /owner/,
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 PDF shows the same pinned assessment and preserves historical reports", () => {
  const state = fixture();
  state.add("contacts.sales_email", "sales@supplier.example");
  const result = state.build();
  const html = generateConsultantLandscapeHtml(result);
  assert.ok(html.includes('id="dimensions-0"'));
  assert.ok(html.includes(result.search_dimension_plan.plan_hash));
  assert.ok(html.includes("unknown / completed"));
  assert.ok(html.includes("sales@supplier.example"));
  assert.ok(
    html.includes("Arbitrary dimension-labelled claims remain unassessed"),
  );
  assert.ok(
    !generateConsultantLandscapeHtml(state.output).includes(
      'id="dimensions-0"',
    ),
  );
  const assessment = structuredClone(result.search_dimension_assessments[0]);
  assessment.dimensions[0].label = "<script>alert(1)</script>";
  assessment.dimensions[0].observed_values = ["متن اصلی"];
  assessment.dimensions[0].source_refs = ["javascript:alert(1)"];
  const rendered = renderSearchDimensionAssessment(assessment);
  assert.ok(rendered.includes("&lt;script&gt;"));
  assert.ok(!rendered.includes("<script>"));
  assert.ok(!rendered.includes("متن اصلی"));
  assert.ok(rendered.includes("English interpretation unavailable"));
  assert.ok(!rendered.includes("javascript:"));
});

test("MB-SEARCH-DIMENSIONS-002 L01 original-language dynamic clues retain evidence without blocking an English PDF", () => {
  const state = fixture();
  state.add("search_dimensions.logistics.lane", "مسیر حمل");
  const original = structuredClone(state.output.claims);
  const result = state.build();
  const html = generateConsultantLandscapeHtml(result);
  assert.ok(!html.includes("مسیر حمل"));
  assert.ok(html.includes("Original-language dimension source claim retained"));
  assert.deepEqual(result.claims, original);
  assert.equal(result.search_dimension_assessments[0].coverage.grounded, 0);
  assert.equal(
    result.search_dimension_assessments[0].eligibility,
    "needs_review",
  );
});
