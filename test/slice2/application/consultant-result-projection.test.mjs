import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConsultantResultProjection,
  buildConsultantResultProjectionV2,
  compareConsultantRankingSignalsV2,
  resolveConsultantLandscape,
} from "../../../packages/application/dist/index.js";
import { parseConsultantResultProjectionV2 } from "../../../packages/contracts/dist/src/index.js";
import { DEFAULT_CONSULTANT_PROJECTION_CONFIG } from "../../../packages/data/dist/index.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../../../packages/ai-evidence/dist/src/standard.js";

const now = new Date("2026-08-25T00:00:00.000Z");
const constraints = buildStandardSyntheticHardConstraints();
const configurationRelease = {
  configId: "00000000-0000-4000-8000-000000000620",
  configVersion: "consultant-soft-cap.test.v1",
  contentSha256: "a".repeat(64),
  boundAt: new Date("2026-08-25T00:00:00.000Z"),
  effectiveReleaseAt: new Date("2026-08-24T00:00:00.000Z"),
};

function projection(scenario, softCap) {
  return buildConsultantResultProjection({
    completeResult: buildStandardSyntheticEvidenceGraph(
      `RUN-CONSULTANT-${scenario}-${softCap}`,
      scenario,
      constraints,
    ),
    projectionAsOf: now,
    hardConstraints: constraints,
    softCap,
  });
}

test("separates eligible and displayed counts and explicitly discloses truncation", () => {
  const result = projection("many", 3);
  assert.ok(result.landscape.eligible_count > 3);
  assert.equal(result.landscape.displayed_count, 3);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.landscape.soft_cap, 3);
  assert.equal(result.landscape.truncated, true);
  assert.equal(result.landscape.scarcity_override_applied, false);
  assert.match(
    result.landscape.truncation_notice,
    /configured display cap of 3/u,
  );
  assert.equal(result.scarcity, "none");
});

test("a below-cap non-scarce set returns every eligible candidate without a false scarcity override", () => {
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-BELOW-CAP",
    "many",
    constraints,
  );
  const before = structuredClone(graph);
  const result = buildConsultantResultProjection({
    completeResult: graph,
    projectionAsOf: now,
    hardConstraints: constraints,
    softCap: 20,
  });
  assert.equal(
    result.landscape.eligible_count,
    graph.eligible_candidate_ids.length,
  );
  assert.equal(
    result.landscape.displayed_count,
    graph.eligible_candidate_ids.length,
  );
  assert.equal(result.landscape.scarcity_override_applied, false);
  assert.equal(result.landscape.truncated, false);
  assert.equal(result.scarcity, "none");
  assert.deepEqual(graph, before);
});

for (const [scenario, expectedScarcity, expectedCount] of [
  ["zero", "zero", 0],
  ["one", "limited", 1],
  ["two", "limited", 2],
])
  test(`preserves P4 scarcity semantics for ${scenario}`, () => {
    const result = projection(scenario, 20);
    assert.equal(result.scarcity, expectedScarcity);
    assert.equal(result.landscape.eligible_count, expectedCount);
    assert.equal(result.landscape.displayed_count, expectedCount);
    assert.equal(
      result.landscape.scarcity_override_applied,
      expectedCount === 1 || expectedCount === 2,
    );
    assert.equal(result.landscape.truncated, false);
    assert.equal(result.candidates.length, expectedCount);
    if (expectedCount === 0)
      assert.equal(result.outcome, "no_responsible_match");
  });

test("rejects a soft cap below the documented minimum", () => {
  assert.throws(() => projection("many", 2), /at least 3/iu);
});

test("exactly three eligible candidates are all displayed without scarcity or padding", () => {
  assert.deepEqual(
    resolveConsultantLandscape(3, DEFAULT_CONSULTANT_PROJECTION_CONFIG.softCap),
    {
      eligible_count: 3,
      displayed_count: 3,
      soft_cap: 20,
      truncated: false,
      scarcity_override_applied: false,
    },
  );
});

test("more than the default 20 retains total eligibility and truncates display only", () => {
  assert.deepEqual(
    resolveConsultantLandscape(
      21,
      DEFAULT_CONSULTANT_PROJECTION_CONFIG.softCap,
    ),
    {
      eligible_count: 21,
      displayed_count: 20,
      soft_cap: 20,
      truncated: true,
      scarcity_override_applied: false,
      truncation_notice:
        "The eligible landscape was truncated at the configured display cap of 20.",
    },
  );
});

test("v2 publishes deterministic TASK137 source facts and eligible reserves only", () => {
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-V2-MANY",
    "many",
    constraints,
  );
  graph.evidence.push({
    ...graph.evidence[0],
    evidence_id: "EVID-CONSULTANT-V2-EXCLUDED",
    verification_disposition: "excluded",
    exclusion_reason: "Not used by any decision-bearing claim.",
  });
  const input = {
    completeResult: graph,
    projectionAsOf: now,
    hardConstraints: constraints,
    softCap: 3,
    configurationRelease,
  };
  const first = buildConsultantResultProjectionV2(input);
  const second = buildConsultantResultProjectionV2(input);

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, "consultant-result-projection.v2");
  assert.equal(first.projection_version, 6);
  assert.equal(first.rfq_questions.length, 20);
  assert.equal(first.due_diligence_checklist.length, 8);
  assert.equal(
    first.source_policy.policy_id,
    "task137-rfq-wave-due-diligence.v1",
  );
  assert.equal(
    first.agent_authorship.human_consultant_authorship,
    "not_claimed",
  );
  assert.equal(first.full_limitations.production_release, "blocked");
  assert.equal(first.source_facts.length, graph.evidence.length);
  assert.ok(
    first.source_facts.every(
      (fact) =>
        fact.evidence_id &&
        ("exact_url" in fact
          ? fact.publisher_domain
          : !("publisher_domain" in fact) && fact.fixture_identity) &&
        fact.accessed_at &&
        fact.content_sha256 &&
        fact.extract,
    ),
  );
  assert.equal(first.configuration_release.soft_cap, 3);
  assert.equal(first.rfq_execution_snapshot.contact_state, "not_contacted");
  assert.equal(first.rfq_execution_snapshot.response_state, "not_collected");
  assert.deepEqual(first.rfq_execution_snapshot.expansion_model, {
    initial_wave_size: 3,
    subsequent_wave_size: 2,
    expansion_threshold: 3,
    effective_expansion_threshold: 3,
  });
  assert.match(
    first.rfq_execution_snapshot.wave_instance_id,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(first.wave_recommendations[0].candidates.length, 3);
  assert.equal(
    first.reserve_candidates.length,
    first.landscape.eligible_count - first.landscape.displayed_count,
  );
  for (const reserve of first.reserve_candidates) {
    assert.ok(graph.eligible_candidate_ids.includes(reserve.candidate_id));
    const candidate = graph.candidates.find(
      (entry) => entry.candidate_id === reserve.candidate_id,
    );
    assert.ok(candidate);
    assert.equal(candidate.mandatory_constraints_satisfied, true);
    assert.deepEqual(candidate.failed_constraint_ids, []);
  }
  assert.equal(first.excluded_evidence.length, 1);
  assert.match(
    first.excluded_evidence[0].exclusion_reason,
    /decision-bearing/u,
  );
  const forgedRanking = structuredClone(first);
  forgedRanking.wave_recommendations[0].candidates[0].candidate_id =
    "FORGED-CANDIDATE";
  assert.throws(
    () => parseConsultantResultProjectionV2(forgedRanking),
    /wave candidate projection is inconsistent/iu,
  );
  const forgedQueue = structuredClone(first);
  forgedQueue.rfq_execution_snapshot.selected_candidates.reverse();
  assert.throws(
    () => parseConsultantResultProjectionV2(forgedQueue),
    /queue binding is inconsistent/iu,
  );
  const forgedConfiguration = structuredClone(first);
  forgedConfiguration.configuration_release.soft_cap = 20;
  assert.throws(
    () => parseConsultantResultProjectionV2(forgedConfiguration),
    /configuration soft cap is inconsistent/iu,
  );
  const duplicateCitationShadow = JSON.parse(JSON.stringify(first));
  duplicateCitationShadow.candidates[1].citations.push(
    structuredClone(duplicateCitationShadow.candidates[0].citations[0]),
  );
  assert.throws(
    () => parseConsultantResultProjectionV2(duplicateCitationShadow),
    /citation evidence id is duplicated/iu,
  );
});

test("v2 restores live provenance only from an explicit trusted evidence binding", () => {
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-V2-LIVE",
    "many",
    constraints,
  );
  const liveEvidenceId = graph.claims.find((claim) =>
    graph.eligible_candidate_ids.includes(claim.candidate_id),
  ).evidence_ids[0];
  const evidence = graph.evidence.find(
    (item) => item.evidence_id === liveEvidenceId,
  );
  delete evidence.fixture_identity;
  evidence.exact_url = "https://publisher-01.example.invalid/source";
  evidence.publisher_domain = "publisher-01.example.invalid";
  evidence.published_or_updated = "not stated by source";
  const result = buildConsultantResultProjectionV2({
    completeResult: graph,
    trustedLiveEvidenceIds: new Set([liveEvidenceId]),
    projectionAsOf: now,
    hardConstraints: constraints,
    softCap: 3,
    configurationRelease,
  });
  assert.equal(
    result.source_facts.find((fact) => fact.evidence_id === liveEvidenceId)
      .provenance,
    "live_secure_fetch",
  );
});

test("v2 fails closed if a failed hard-gate candidate enters the eligible ledger", () => {
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-V2-FORGED-ELIGIBILITY",
    "many",
    constraints,
  );
  const failed = graph.candidates[0];
  failed.mandatory_constraints_satisfied = false;
  failed.failed_constraint_ids.push(constraints[0].constraint_id);
  assert.throws(
    () =>
      buildConsultantResultProjectionV2({
        completeResult: graph,
        projectionAsOf: now,
        hardConstraints: constraints,
        softCap: 3,
        configurationRelease,
      }),
    /failed hard-gate candidate/iu,
  );
});

test("v2 applies authoritative-claim and unresolved-limitation tie-breaks in order", () => {
  const base = {
    compatibilityScore: 80,
    corroboratedRequiredClaimCount: 2,
    authoritativeRequiredClaimCount: 1,
    unresolvedLimitationCount: 1,
    completeEvidenceTimestamp: 1_700_000_000_000,
    candidateId: "CAND-B",
  };
  assert.ok(
    compareConsultantRankingSignalsV2(
      { ...base, authoritativeRequiredClaimCount: 2 },
      base,
    ) < 0,
  );
  assert.ok(
    compareConsultantRankingSignalsV2(
      { ...base, unresolvedLimitationCount: 0 },
      base,
    ) < 0,
  );
});
