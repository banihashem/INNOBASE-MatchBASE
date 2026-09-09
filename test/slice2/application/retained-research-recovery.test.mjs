import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApprovedRequestSnapshotV3 } from "../../../packages/contracts/dist/src/index.js";
import { buildRetainedResearchRecovery } from "../../../packages/application/dist/retained-research-recovery.js";
import {
  assembleLiveSuppliers,
  ingestLiveEvidence,
} from "../../../packages/application/dist/live-supplier-evidence.js";

function fixture() {
  const requirement = "Industrial pumps";
  const url = "https://aster.example.com/catalog";
  const identity = "Aster Industrial GmbH is a manufacturer.";
  const capability = "We manufacture industrial pumps.";
  const text = `${identity}\nCatalog introduction.\n${capability}`;
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
    product: { status: "verified", source_urls: [url], quote: capability },
    facts: [],
    certifications: [],
    constraints: [
      {
        constraint: requirement,
        dimension: "product",
        status: "verified",
        source_urls: [url],
        quote: capability,
      },
    ],
    unknowns: ["Current quotation"],
    risks: [],
  };
  const evidence = new Map();
  ingestLiveEvidence(
    {
      candidates: [],
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
      summary: "Retained test observations",
      evidence_exhausted: false,
    },
    [{ url, title: "Aster catalog", content: text }],
    evidence,
  );
  const approved = createApprovedRequestSnapshotV3({
    revision_id: randomUUID(),
    approved_translation: "We require industrial pumps.",
    product_name: "Industrial pumps",
    product_category: "Pumps",
    approved_at: "2026-09-08T10:00:00Z",
  });
  const classificationId = randomUUID();
  const prior = {
    schema_version: "consultant-research-output.v3",
    schema_contract_version: 1,
    user_profile_id: randomUUID(),
    research_run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: classificationId,
    title: "Industrial pumps Supplier Landscape",
    subtitle: "0 Evidence-Based Supplier Profiles",
    generated_at: "2026-09-08T12:00:00Z",
    as_of_date: "2026-09-08",
    research_mode: "live",
    research_status: "insufficient_evidence",
    primary_classification: {
      classification_id: classificationId,
      scheme: "CUSTOM_MATCHBASE",
      code: "PUMPS",
      version: "1",
      level: "provisional",
      label: "Pumps",
      description: "Industrial pumps",
      is_primary: true,
      confidence: "medium",
      assigned_at: "2026-09-08T10:00:00Z",
    },
    secondary_classifications: [],
    approved_request_snapshot: approved,
    request_snapshot: {
      product_name: "Industrial pumps",
      product_category: "Pumps",
      business_context: [approved.approved_translation],
    },
    executive_summary: {
      headline: "0 suppliers",
      direct_answer: "No candidates",
      key_findings: ["0 prices"],
      candidate_count: 0,
      no_match_summary: "Old no-match text",
    },
    target_candidates_count: 20,
    total_candidates_found: 0,
    supplier_candidates: [],
    claims: [],
    evidence_sources: [],
    telemetry: {
      lanes_executed: ["original-test-model"],
      verification_loops_count: 3,
      total_input_tokens: 321,
      total_output_tokens: 123,
      total_cost_usd: 1.75,
      execution_latency_ms: 1000,
      synthesis_model_id: "original-test-model",
      executed_at: "2026-09-08T12:00:00Z",
    },
    report_artifact: { obsolete: true },
    limitations_and_disclosures: [
      {
        title: "Candidate coverage",
        description: "0 candidates",
        severity: "advisory",
      },
      {
        title: "Evidence scope",
        description: "Current quotation remains unknown",
        severity: "advisory",
      },
    ],
  };
  return {
    prior_output: prior,
    execution_id: randomUUID(),
    recovered_at: "2026-09-09T12:00:00Z",
    mandatory_requirements: [requirement],
    continuation: {
      roster: [["aster.example.com", candidate]],
      evidence: [...evidence],
      retrieved: [],
      remaining_gaps: ["Current quotation"],
      coverage_gaps: ["Earlier independent cross-check was incomplete."],
      entity_ids: [["aster.example.com", randomUUID()]],
    },
  };
}

test("L11 retained recovery publishes grounded profiles without mutating evidence, accounting or approval", (t) => {
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("Recovery must never perform network calls"),
  );
  const input = fixture();
  const original = structuredClone(input);
  assert.equal(
    assembleLiveSuppliers(
      input.continuation.roster.map(([, c]) => c),
      input.mandatory_requirements,
      new Map(input.continuation.evidence),
      20,
    ).candidates.length,
    0,
  );
  const result = buildRetainedResearchRecovery(input);
  assert.deepEqual(input, original);
  assert.equal(result.output.supplier_candidates.length, 1);
  assert.equal(result.output.executive_summary.candidate_count, 1);
  assert.equal(result.output.total_candidates_found, 1);
  assert.equal(result.output.executive_summary.no_match_summary, undefined);
  assert.equal(result.output.report_artifact, undefined);
  assert.deepEqual(
    result.output.approved_request_snapshot,
    input.prior_output.approved_request_snapshot,
  );
  assert.equal(result.output.execution_id, input.execution_id);
  assert.equal(result.output.as_of_date, input.prior_output.as_of_date);
  assert.equal(
    result.output.supplier_candidates[0].supplier_entity_id,
    input.continuation.entity_ids[0][1],
  );
  assert.deepEqual(
    result.recovery_audit.historical_telemetry,
    original.prior_output.telemetry,
  );
  assert.equal(result.output.telemetry.total_cost_usd, 0);
  assert.equal(result.output.telemetry.verification_loops_count, 0);
  assert.deepEqual(result.output.telemetry.lanes_executed, []);
  assert.match(result.output.executive_summary.direct_answer, /deterministic/);
  assert.ok(
    result.output.limitations_and_disclosures.some((item) =>
      item.description.includes("Earlier independent cross-check"),
    ),
  );
  assert.deepEqual(
    result.output.evidence_sources.map((item) => item.source_url),
    input.continuation.evidence.map(([url]) => url),
  );
});

test("L11 retained recovery leaves fabricated proofs and demonstrated mandatory failures excluded", () => {
  const input = fixture();
  input.continuation.roster[0][1].product.quote =
    "Invented capability not found in retained source";
  let result = buildRetainedResearchRecovery(input);
  assert.equal(result.output.supplier_candidates.length, 0);
  assert.equal(result.output.research_status, "insufficient_evidence");
  assert.ok(result.output.executive_summary.no_match_summary);
  const unmet = fixture();
  unmet.continuation.roster[0][1].constraints[0].status = "unmet";
  result = buildRetainedResearchRecovery(unmet);
  assert.equal(result.output.supplier_candidates.length, 0);
  assert.ok(result.excluded_candidates.length);
});

test("L11 recovery requires distinct execution, valid original approval and original mandatory criteria", () => {
  let input = fixture();
  input.execution_id = input.prior_output.execution_id;
  assert.throws(() => buildRetainedResearchRecovery(input), /distinct/);
  input = fixture();
  input.prior_output.approved_request_snapshot.approved_translation =
    "Changed without reapproval";
  assert.throws(() => buildRetainedResearchRecovery(input), /snapshot/);
  input = fixture();
  input.mandatory_requirements = [];
  assert.throws(() => buildRetainedResearchRecovery(input), /mandatory/);
});
