import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchSynthesisMessages } from "../../../packages/application/dist/research-synthesis-context.js";
import { createRoundCallGuard } from "../../../packages/application/dist/consultant-research-cost.js";

const input = () => ({
  approved_request: {
    product_requirement: "KOH flakes; at least 90% purity",
    technical_compliance: "ISO9001 or applicable standard",
    order_profile: "Quantity remains unconfirmed",
  },
  mandatory_requirements: [
    "At least 90% purity",
    "ISO9001 or applicable standard",
  ],
  candidates: [
    {
      candidate_id: "candidate-1",
      supplier_entity_id: "entity-1",
      legal_name: "Example Chemicals",
      offering: { product_name: "KOH flakes" },
      assessment: { compatibility_score: 60, unknowns: ["Current quotation"] },
    },
  ],
  claims: [
    {
      claim_id: "claim-1",
      supplier_entity_id: "entity-1",
      field_path: "offering.product_name",
      claim_text: "KOH flakes purity 90%",
      status: "externally_verified",
      confidence: "medium",
      conflict_status: "single_source",
      evidence_ids: ["evidence-1"],
    },
    {
      claim_id: "claim-2",
      supplier_entity_id: "entity-1",
      field_path: "commercial.price_min",
      claim_text: "Published indication USD 850 per tonne on 2026-09-11",
      normalized_value: 850,
      unit: "USD/tonne",
      status: "externally_verified",
      confidence: "medium",
      conflict_status: "single_source",
      evidence_ids: ["evidence-1"],
    },
  ],
  sources: [
    {
      evidence_id: "evidence-1",
      source_id: "source-1",
      source_url: "https://example.com/product",
      source_title: "Product and dated offer",
      publisher: "Example Chemicals",
      source_type: "official_website",
      retrieved_at: "2026-09-11T12:00:00Z",
      published_at: "2026-09-11T00:00:00Z",
      freshness_status: "current",
      verification_status: "externally_verified",
      excerpt_summary: "A".repeat(6000),
      supports_claim_ids: ["claim-1", "claim-2"],
      contradicts_claim_ids: [],
    },
  ],
  excluded_candidates: [
    { legal_name: "Unrelated seller", reason: "Different product" },
  ],
  verification_loops_completed: 2,
  stop_reason: "user_review",
  coverage_gaps: ["Independent certification verification remains incomplete"],
});
const bytes = (messages) =>
  Buffer.byteLength(JSON.stringify(messages), "utf8") + 512;
const content = (messages) => JSON.parse(messages[1].content);
const guard = (maxInput) =>
  createRoundCallGuard({
    mode: "demonstration",
    research_models: ["fixture"],
    extraction_model: "fixture",
    synthesis_model: "fixture",
    rates: [],
    max_calls: 3,
    max_output_tokens_per_call: 16000,
    max_input_tokens_per_call: maxInput,
  });
const request = (messages) => ({
  model: "fixture",
  messages,
  max_tokens: 16000,
  response_format: {
    type: "json_schema",
    json_schema: { name: "matchbase_live_synthesis" },
  },
});

test("MB-UX-QUALITY-001 L05 synthesis preserves the complete request at the exact serialized allowance", async () => {
  const context = input();
  const full = buildResearchSynthesisMessages(context);
  const limit = bytes(full);
  const result = buildResearchSynthesisMessages(context, limit);
  assert.deepEqual(result, full);
  assert.deepEqual(content(result), context);
  await guard(limit)(request(result), false);
});

test("MB-UX-QUALITY-001 L05 synthesis source excerpts resolve the observed 167-byte overflow without dropping claims", async () => {
  const context = input();
  const saved = structuredClone(context);
  const full = buildResearchSynthesisMessages(context);
  const limit = bytes(full) - 167;
  await assert.rejects(guard(limit)(request(full), false), {
    code: "MB-409-ROUND-ALLOWANCE",
  });
  const bounded = buildResearchSynthesisMessages(context, limit);
  const projected = content(bounded);
  assert.ok(bytes(bounded) <= limit);
  await guard(limit)(request(bounded), false);
  assert.deepEqual(context, saved);
  for (const key of Object.keys(context).filter((key) => key !== "sources"))
    assert.deepEqual(projected[key], context[key]);
  assert.deepEqual(
    projected.sources.map(({ excerpt_summary: _excerpt, ...source }) => source),
    context.sources.map(({ excerpt_summary: _excerpt, ...source }) => source),
  );
  assert.ok(
    projected.sources[0].excerpt_summary.length <
      context.sources[0].excerpt_summary.length,
  );
  assert.match(
    projected.context_disclosure,
    /An omitted passage is not evidence of absence or contradiction/,
  );
});

test("MB-UX-QUALITY-001 L05 synthesis budgets the 512-byte margin before dispatch", async () => {
  const context = input();
  const full = buildResearchSynthesisMessages(context);
  const limit = Buffer.byteLength(JSON.stringify(full), "utf8") + 511;
  assert.equal(bytes(full), limit + 1);
  const bounded = buildResearchSynthesisMessages(context, limit);
  assert.notDeepEqual(bounded, full);
  await guard(limit)(request(bounded), false);
});

test("MB-UX-QUALITY-001 L05 synthesis budgets UTF8 and nested escaping while preserving immutable facts", async () => {
  const context = input();
  context.sources[0].excerpt_summary =
    'Supplier "quoted" \\ evidence 日本語 🧪 '.repeat(500);
  context.claims[0].claim_text =
    'Actual documented product "KOH" / 日本語 / 🧪';
  const original = structuredClone(context);
  const full = buildResearchSynthesisMessages(context);
  const limit = 18000;
  assert.ok(bytes(full) > limit);
  const bounded = buildResearchSynthesisMessages(context, limit);
  await guard(limit)(request(bounded), false);
  assert.ok(bytes(bounded) <= limit);
  assert.deepEqual(content(bounded).claims, context.claims);
  assert.ok(
    !/[\uD800-\uDBFF]$/.test(content(bounded).sources[0].excerpt_summary),
  );
  assert.deepEqual(context, original);
});

test("MB-UX-QUALITY-001 L05 synthesis never shortens immutable claims to fit an impossible allowance", () => {
  const context = input();
  context.claims[0].claim_text = "Immutable validated fact ".repeat(20000);
  const saved = structuredClone(context);
  assert.throws(() => buildResearchSynthesisMessages(context, 240000), {
    code: "MB-409-ROUND-ALLOWANCE",
  });
  assert.deepEqual(context, saved);
});

test("MB-UX-QUALITY-001 L05 source-summary compaction preserves complete contradiction references", () => {
  const context = input();
  context.sources[0].contradicts_claim_ids = ["claim-2"];
  context.claims[1].conflict_status = "contradicted";
  const bounded = buildResearchSynthesisMessages(
    context,
    bytes(buildResearchSynthesisMessages(context)) - 500,
  );
  assert.deepEqual(content(bounded).sources[0].contradicts_claim_ids, [
    "claim-2",
  ]);
  assert.equal(content(bounded).claims[1].conflict_status, "contradicted");
  assert.equal(content(bounded).claims[1].normalized_value, 850);
});
