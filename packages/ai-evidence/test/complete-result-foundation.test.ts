import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSULTANT_UNAVAILABLE_SOURCE_IDS,
  ConsultantProjectionSourceUnavailableError,
  buildCompleteResultFoundation,
  requireConsultantProjectionSources,
  standardEvidenceGraphFromStoredCompleteResult,
  validateCompleteResultFoundation,
} from "../src/complete-result/foundation.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../src/research/standard-synthetic-fixtures.js";

function sourceGraph() {
  const constraints = buildStandardSyntheticHardConstraints();
  return buildStandardSyntheticEvidenceGraph(
    "RUN-COMPLETE-FOUNDATION",
    "many",
    constraints,
  );
}

test("builds a frozen tier-neutral foundation with all current eligible decision facts", () => {
  const graph = sourceGraph();
  graph.evidence.push({
    ...graph.evidence[0]!,
    evidence_id: "STD-EV-EXCLUDED-FOUNDATION",
    verification_disposition: "excluded",
    exclusion_reason: "Synthetic regression source was excluded by validation.",
  });
  const foundation = buildCompleteResultFoundation(graph);

  assert.equal(foundation.schema_version, "complete-result-foundation.v1");
  assert.ok(graph.eligible_candidate_ids.length > 3);
  assert.deepEqual(
    [...foundation.eligible_candidate_ids].sort(),
    foundation.candidates
      .filter((candidate) => candidate.mandatory_constraints_satisfied)
      .map((candidate) => candidate.candidate_id)
      .sort(),
  );
  assert.deepEqual(
    foundation.eligible_candidate_ids,
    graph.eligible_candidate_ids,
  );
  assert.deepEqual(foundation.candidates, graph.candidates);
  assert.deepEqual(foundation.claims, graph.claims);
  assert.deepEqual(foundation.evidence, graph.evidence);
  assert.equal(
    foundation.evidence.some(
      (item) => item.verification_disposition === "excluded",
    ),
    true,
  );
  assert.equal(Object.isFrozen(foundation), true);
  assert.equal(Object.isFrozen(foundation.candidates), true);
  assert.equal(Object.isFrozen(foundation.candidates[0]?.dimensions), true);
  assert.equal(JSON.stringify(foundation).includes('"tier"'), false);
});

test("records every unavailable Consultant source and fails closed with a typed error", () => {
  const foundation = buildCompleteResultFoundation(sourceGraph());

  assert.deepEqual(
    foundation.consultant_projection_readiness.missing_sources.map(
      (item) => item.source_id,
    ),
    CONSULTANT_UNAVAILABLE_SOURCE_IDS,
  );
  assert.ok(
    foundation.consultant_projection_readiness.missing_sources.every(
      (item) =>
        item.status === "unavailable" &&
        item.reason_code === "not_produced_by_current_pipeline",
    ),
  );
  assert.throws(
    () => requireConsultantProjectionSources(foundation),
    (error: unknown) => {
      assert.ok(error instanceof ConsultantProjectionSourceUnavailableError);
      assert.deepEqual(
        error.missingSourceIds,
        CONSULTANT_UNAVAILABLE_SOURCE_IDS,
      );
      return true;
    },
  );
});

test("rejects unvalidated or caller-invented fields instead of preserving them", () => {
  const graph = sourceGraph() as ReturnType<typeof sourceGraph> & {
    rfq_question_sets?: unknown[];
  };
  graph.rfq_question_sets = [];
  assert.throws(
    () => buildCompleteResultFoundation(graph),
    /unsupported fields: rfq_question_sets/iu,
  );

  const invalid = sourceGraph();
  invalid.eligible_candidate_ids.push("CANDIDATE-DOES-NOT-EXIST");
  assert.throws(
    () => buildCompleteResultFoundation(invalid),
    /ineligible candidate entered/iu,
  );

  const incomplete = sourceGraph();
  const omittedCandidateId = incomplete.eligible_candidate_ids.pop();
  assert.ok(omittedCandidateId);
  assert.equal(
    incomplete.candidates.find(
      (candidate) => candidate.candidate_id === omittedCandidateId,
    )?.mandatory_constraints_satisfied,
    true,
  );
  assert.throws(
    () => buildCompleteResultFoundation(incomplete),
    /candidate .* is missing from the eligible set/iu,
  );
});

test("requires a non-empty trimmed reason for every excluded source", () => {
  for (const exclusionReason of ["", "   ", "\t\r\n"]) {
    const graph = sourceGraph();
    graph.evidence.push({
      ...graph.evidence[0]!,
      evidence_id: `STD-EV-EXCLUDED-${JSON.stringify(exclusionReason)}`,
      verification_disposition: "excluded",
      exclusion_reason: exclusionReason,
    });
    assert.throws(
      () => buildCompleteResultFoundation(graph),
      /excluded evidence .* requires a non-empty reason/iu,
    );
  }
});

test("foundation bytes are deterministic and isolated from later input mutation", () => {
  const firstInput = sourceGraph();
  const first = buildCompleteResultFoundation(firstInput);
  const second = buildCompleteResultFoundation(structuredClone(firstInput));
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  firstInput.candidates[0]!.display_name = "mutated after construction";
  assert.notEqual(
    first.candidates[0]!.display_name,
    firstInput.candidates[0]!.display_name,
  );
});

test("round-trips the foundation for Standard reads and accepts validated legacy rows", () => {
  const graph = sourceGraph();
  const foundation = buildCompleteResultFoundation(graph);

  assert.doesNotThrow(() => validateCompleteResultFoundation(foundation));
  const restored = standardEvidenceGraphFromStoredCompleteResult(foundation);
  assert.deepEqual(restored, graph);
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(Object.isFrozen(restored.candidates[0]), true);

  const legacy = standardEvidenceGraphFromStoredCompleteResult(graph);
  assert.deepEqual(legacy, graph);
  assert.equal(Object.isFrozen(legacy), true);
});

test("fails stored reads closed for unknown versions and forged readiness", () => {
  const unknownVersion = {
    ...structuredClone(sourceGraph()),
    schema_version: "complete-result-foundation.v2",
  };
  assert.throws(
    () => standardEvidenceGraphFromStoredCompleteResult(unknownVersion),
    /schema version is unsupported/iu,
  );

  const forged = structuredClone(
    buildCompleteResultFoundation(sourceGraph()),
  ) as unknown as Record<string, unknown>;
  const readiness = forged.consultant_projection_readiness as {
    missing_sources: unknown[];
  };
  readiness.missing_sources.pop();
  assert.throws(
    () => standardEvidenceGraphFromStoredCompleteResult(forged),
    /source ledger is invalid/iu,
  );
});

test("fails stored reads closed for legacy Demo and projection-only fields", () => {
  const legacyDemo = {
    schemaVersion: "evidence-graph.v1",
    runId: "RUN-LEGACY-DEMO",
    candidates: [],
    claims: [],
    evidence: [],
    eligibleCandidateIds: [],
    gateEvaluationCompletedAt: "2026-08-25T00:00:00.000Z",
  };
  assert.throws(
    () => standardEvidenceGraphFromStoredCompleteResult(legacyDemo),
    /schema version is unsupported/iu,
  );

  const inventedCandidate = structuredClone(
    buildCompleteResultFoundation(sourceGraph()),
  ) as unknown as {
    candidates: Array<Record<string, unknown>>;
  };
  inventedCandidate.candidates[0]!.rationale_short = "Invented projection fact";
  assert.throws(
    () => standardEvidenceGraphFromStoredCompleteResult(inventedCandidate),
    /unsupported fields: rationale_short/iu,
  );

  const inventedEvidence = structuredClone(
    buildCompleteResultFoundation(sourceGraph()),
  ) as unknown as {
    evidence: Array<Record<string, unknown>>;
  };
  inventedEvidence.evidence[0]!.external_url = "https://example.invalid";
  assert.throws(
    () => standardEvidenceGraphFromStoredCompleteResult(inventedEvidence),
    /unsupported fields: external_url/iu,
  );

  const inventedVerification = structuredClone(
    buildCompleteResultFoundation(sourceGraph()),
  ) as unknown as {
    evidence: Array<Record<string, unknown>>;
  };
  inventedVerification.evidence[0]!.verification_status = "synthetic";
  assert.throws(
    () => standardEvidenceGraphFromStoredCompleteResult(inventedVerification),
    /verification_status has an invalid value/iu,
  );
});
