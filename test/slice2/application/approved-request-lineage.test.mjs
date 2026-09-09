import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedRequestSnapshotV3,
  GOLDEN_SCENARIO_V3_01,
} from "../../../packages/contracts/dist/src/index.js";
import { PreparationModelGateway } from "../../../packages/application/dist/preparation-gateway.js";
import { synthesizeConsultantOutputV3 } from "../../../packages/application/dist/synthesis-engine.js";

const lane = {
  model: "local-test",
  text: "",
  input_tokens: 0,
  output_tokens: 0,
  latency_ms: 0,
  cost_usd: 0,
  live_api_invoked: false,
};
const result = {
  lane_g_result: lane,
  lane_o_result: lane,
  candidates: [],
  evidence_sources: [],
  claims: [],
  verification_loops_completed: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cost_usd: 0,
  total_latency_ms: 0,
};
const base = {
  user_profile_id: "test-user",
  research_run_id: "test-run",
  execution_id: "test-execution",
  classification_id: "test-classification",
  product_name: "Industrial equipment",
  product_category: "Machinery",
  dual_lane_result: result,
};

test("MB-UX-LIVE-001 L01 unit-equivalent approved text stays equivalent through Step2 Step3 and output", async () => {
  const approved = createApprovedRequestSnapshotV3({
    revision_id: "lineage-1",
    approved_at: "2026-09-07T00:00:00Z",
    product_name: "Commercial water heater",
    product_category: "HVAC",
    approved_translation:
      "750 L commercial water heater, maximum outer diameter 850 mm, minimum 12 bar, three-phase 415V 60Hz, 36 months UAE warranty, exactly 7 units, DDP Abu Dhabi, safety-valve compatibility, documented thermal insulation, BMS thermostat.",
  });
  const request = {
    revision_id: approved.revision_id,
    english_translation: approved.approved_translation,
    product_name: approved.product_name,
    product_category: approved.product_category,
    approved_at: approved.approved_at,
    key_specifications: [],
    canonical_snapshot: approved,
  };
  const classification = {
    classification_id: "test-classification",
    scheme: "CUSTOM_MATCHBASE",
    code: "UNCLASSIFIED",
    version: "1",
    level: "provisional",
    label: "Unclassified",
    description: "Not externally classified",
    is_primary: true,
    confidence: "not_assessed",
    assigned_at: approved.approved_at,
  };
  const gateway = new PreparationModelGateway();
  const advisory = await gateway.generateAdvisoryLoops(request, classification);
  const prompt = await gateway.generateDeepResearchPrompt(
    request,
    advisory,
    classification,
  );
  assert.ok(prompt.prompt_text.includes(approved.approved_translation));
  assert.ok(
    prompt.discovery_criteria.some((value) => value.includes("Maximum 85 cm")),
  );
  assert.ok(!prompt.prompt_text.includes("850 cm"));
  assert.ok(!JSON.stringify(advisory).includes("DDP Dubai"));
  const output = synthesizeConsultantOutputV3({
    ...base,
    approved_request_snapshot: approved,
    primary_classification: classification,
  });
  assert.equal(
    output.approved_request_snapshot.content_hash,
    approved.content_hash,
  );
  assert.equal(
    output.request_snapshot.product_attributes.max_outer_diameter_cm,
    85,
  );
  assert.equal(
    output.request_snapshot.product_attributes.destination,
    "Abu Dhabi",
  );
  assert.equal(output.request_snapshot.product_attributes.quantity, 7);
  assert.ok(
    output.request_snapshot.product_attributes.electrical.includes("60 Hz"),
  );
});

test("MB-UX-LIVE-001 L01 no approval cannot borrow intake or template facts", () => {
  const output = synthesizeConsultantOutputV3({
    ...base,
    intake: {
      product_requirement: "500L water heater",
      technical_compliance: "400V",
      order_profile: "10 units DDP Dubai",
    },
  });
  assert.deepEqual(output.request_snapshot.product_attributes, {});
  assert.equal(output.primary_classification.scheme, "CUSTOM_MATCHBASE");
  assert.equal(output.primary_classification.code, "UNCLASSIFIED");
  assert.ok(
    output.limitations_and_disclosures.some((l) =>
      l.title.includes("lineage unavailable"),
    ),
  );
  assert.deepEqual(output.claims, []);
});

test("MB-UX-LIVE-001 L01 live synthesis retains only provider evidence and refuses fixtures", () => {
  const live = {
    ...result,
    lane_g_result: { ...lane, live_api_invoked: true },
    synthesis_result: {
      ...lane,
      live_api_invoked: true,
      model: "verified-synthesis-model",
    },
    synthesis_summary: "No sufficiently supported suppliers were found.",
  };
  const approved = createApprovedRequestSnapshotV3({
    revision_id: "live-1",
    approved_at: "2026-09-07T00:00:00Z",
    product_name: "Precision valves",
    product_category: "Components",
    approved_translation: "Precision valves, exactly 11 units, FCA Hamburg.",
  });
  const output = synthesizeConsultantOutputV3({
    ...base,
    approved_request_snapshot: approved,
    dual_lane_result: live,
  });
  assert.equal(output.research_mode, "live");
  assert.deepEqual(output.evidence_sources, []);
  assert.deepEqual(output.claims, []);
  assert.equal(output.telemetry.synthesis_model_id, "verified-synthesis-model");
  assert.equal(output.executive_summary.direct_answer, live.synthesis_summary);
  assert.throws(
    () =>
      synthesizeConsultantOutputV3({
        ...base,
        approved_request_snapshot: approved,
        dual_lane_result: {
          ...live,
          candidates: [GOLDEN_SCENARIO_V3_01.supplier_candidates[0]],
        },
      }),
    /cannot consume demonstration/,
  );
});
