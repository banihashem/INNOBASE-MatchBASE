import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApprovedRequestSnapshotV3 } from "../../../packages/contracts/dist/src/index.js";
import { buildFailedResearchRecovery } from "../../../packages/application/dist/failed-research-recovery.js";

function fixture() {
  const source_execution_id = randomUUID();
  const url = "https://aster.example.com/catalog";
  const identity = "Aster Industrial GmbH makes industrial pumps.";
  const product = "We manufacture industrial pumps.";
  const candidate = {
    legal_name: "Aster Industrial GmbH",
    country: "Unknown",
    headquarters: "Unknown",
    website: "https://aster.example.com",
    supplier_type: "manufacturer",
    manufacturer_status: "direct_manufacturer",
    identity: { status: "verified", source_urls: [url], quote: identity },
    product_name: "Industrial pumps",
    product_family: "Pumps",
    product_origin: "Unknown",
    product: { status: "verified", source_urls: [url], quote: product },
    facts: [],
    certifications: [],
    constraints: [],
    unknowns: ["Current quotation"],
    risks: [],
  };
  const payload = {
    candidates: [candidate],
    evidence: [
      {
        url,
        title: "Aster catalog",
        publisher: "Aster",
        source_type: "official_website",
        excerpt: identity,
      },
    ],
    remaining_gaps: ["Current quotation"],
    evidence_exhausted: false,
    summary: "Retained observations",
  };
  const approved = createApprovedRequestSnapshotV3({
    revision_id: randomUUID(),
    approved_translation: "We require industrial pumps.",
    product_name: "Industrial pumps",
    product_category: "Pumps",
    approved_at: "2026-09-09T10:00:00Z",
  });
  const session = {
    session_id: randomUUID(),
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: source_execution_id,
    current_state: "workflow_failed",
    original_intake: { product_requirement: "Original request" },
    approved_request_revision: { canonical_snapshot: approved },
    deep_prompt_revision: { discovery_criteria: ["Industrial pumps"] },
    classification: {
      classification_id: randomUUID(),
      scheme: "CUSTOM_MATCHBASE",
      code: "PUMP",
      version: "1",
      level: "provisional",
      label: "Pumps",
      description: "Pumps",
      is_primary: true,
      confidence: "not_assessed",
      assigned_at: "2026-09-09T10:00:00Z",
    },
  };
  const events = [
    {
      phase: "discovery_gemini",
      created_at: "2026-09-09T10:01:00Z",
      detail: {
        state: "completed",
        is_byok: true,
        response_citations: [
          {
            url,
            title: "Aster catalog",
            content_excerpt: `${identity}\n${product}`,
          },
        ],
      },
    },
    {
      phase: "discovery_gemini_extraction_batch",
      created_at: "2026-09-09T10:02:00Z",
      detail: {
        state: "completed",
        is_byok: true,
        finish_reason: "stop",
        request_id: randomUUID(),
        response_content: JSON.stringify(payload),
      },
    },
    {
      phase: "discovery_openai_extraction_batch",
      created_at: "2026-09-09T10:03:00Z",
      detail: {
        state: "failed",
        is_byok: true,
        finish_reason: "length",
        request_id: randomUUID(),
        response_content: JSON.stringify(payload),
      },
    },
  ];
  return { session, source_execution_id, execution_id: randomUUID(), events };
}

test("L15 failed recovery publishes complete siblings with original dates, explicit missing batch and no input mutation", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildFailedResearchRecovery(input);
  assert.equal(result.output.supplier_candidates.length, 1);
  assert.equal(result.completed_batch_count, 1);
  assert.equal(result.missing_batch_count, 1);
  assert.equal(result.output.research_status, "partial");
  assert.equal(result.output.telemetry.total_cost_usd, 0);
  assert.deepEqual(result.output.telemetry.lanes_executed, []);
  assert.equal(result.output.as_of_date, "2026-09-09");
  assert.match(
    result.output.limitations_and_disclosures
      .map((x) => x.description)
      .join(" "),
    /incomplete or failed and is excluded/,
  );
  assert.deepEqual(input, before);
});

test("L15 recovery cannot turn successful extraction prose into missing native evidence", () => {
  const input = fixture();
  delete input.events[0].detail.response_citations[0].content_excerpt;
  const result = buildFailedResearchRecovery(input);
  assert.equal(result.output.supplier_candidates.length, 0);
  assert.equal(result.output.research_status, "insufficient_evidence");
});

test("L15 truncated and current-schema-invalid responses are never published", () => {
  for (const mutation of [
    (d) => (d.response_truncated = true),
    (d) => (d.finish_reason = "length"),
    (d) => (d.response_content = '{"candidates": []}'),
    (d) => (d.is_byok = false),
  ]) {
    const input = fixture();
    mutation(input.events[1].detail);
    assert.throws(
      () => buildFailedResearchRecovery(input),
      /No completed extraction batch/,
    );
  }
});

test("L15 recovery rejects active, stale, invalidated or unapproved source sessions", () => {
  for (const mutation of [
    (s) => (s.current_state = "lane_gemini_running"),
    (s) => (s.execution_id = randomUUID()),
    (s) => (s.is_invalidated = true),
    (s) => delete s.approved_request_revision,
    (s) => (s.deep_prompt_revision.discovery_criteria = []),
  ]) {
    const input = fixture();
    mutation(input.session);
    assert.throws(
      () => buildFailedResearchRecovery(input),
      /current failed execution/,
    );
  }
});
