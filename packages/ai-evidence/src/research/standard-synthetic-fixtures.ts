import type {
  StandardDimensionScoreV1,
  StandardEvidenceGraphV1,
  StandardEvidenceItemV1,
  StandardHardConstraintV1,
  StandardHiddenCandidateV1,
} from "@matchbase/contracts";
import { validateStandardEvidenceGraph } from "../evidence/standard.js";
import { standardContentSha256 } from "../evidence/standard.js";

export const STANDARD_SYNTHETIC_SCENARIO_COUNTS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  many: 4,
} as const;

export type StandardSyntheticScenario =
  keyof typeof STANDARD_SYNTHETIC_SCENARIO_COUNTS;

export function normalizeStandardSyntheticScenarioForConstraints(
  scenario: StandardSyntheticScenario,
  hardConstraintCount: number,
): StandardSyntheticScenario {
  if (!Number.isSafeInteger(hardConstraintCount) || hardConstraintCount < 0)
    throw new Error("Synthetic hard-constraint count is invalid.");
  return hardConstraintCount === 0 &&
    STANDARD_SYNTHETIC_SCENARIO_COUNTS[scenario] < 3
    ? "three"
    : scenario;
}

export function buildStandardSyntheticHardConstraints(): StandardHardConstraintV1[] {
  return [
    {
      constraint_id: "STD-CON-MANDATORY-CERTIFICATION",
      field_id: "FLD-CORE-COMP-01",
      operator: "equals",
      target: { value_state: "provided", value: "ISO-9001" },
      relaxability: "non_relaxable",
    },
    {
      constraint_id: "STD-CON-MINIMUM-CAPACITY",
      field_id: "FLD-CORE-CAP-01",
      operator: "minimum",
      target: {
        value_state: "provided",
        value: "1200",
        unit: "units/month",
      },
      relaxability: "relaxable",
      tolerance: "200 units/month",
      direction: "lower_is_acceptable",
    },
  ];
}

const SCORE_FIXTURES = [
  [45, 100, 45, 100, 100, 100],
  [90, 90, 90, 80, 80, 80],
  [70, 70, 70, 70, 70, 70],
  [60, 60, 60, 60, 60, 60],
] as const;

function dimensionsFor(index: number): StandardHiddenCandidateV1["dimensions"] {
  const scores = SCORE_FIXTURES[index - 1];
  if (!scores) throw new Error("Synthetic candidate score fixture is missing.");
  const confidence = index === 1 ? "low" : "high";
  const dimensions: StandardDimensionScoreV1[] = [
    {
      dimension_id: "category_product_fit",
      weight: 25,
      score: scores[0],
      confidence,
    },
    {
      dimension_id: "compliance_certification_fit",
      weight: 20,
      score: scores[1],
      confidence: "high",
    },
    {
      dimension_id: "volume_capacity_fit",
      weight: 15,
      score: scores[2],
      confidence,
    },
    {
      dimension_id: "price_tier_fit",
      weight: 15,
      score: scores[3],
      confidence: "high",
    },
    {
      dimension_id: "positioning_brand_fit",
      weight: 15,
      score: scores[4],
      confidence: "high",
    },
    {
      dimension_id: "geographic_reach_fit",
      weight: 10,
      score: scores[5],
      confidence: "high",
    },
  ];
  return dimensions as StandardHiddenCandidateV1["dimensions"];
}

function standardFixtureRecord(index: number): {
  candidate: StandardHiddenCandidateV1;
  claim: StandardEvidenceGraphV1["claims"][number];
  evidence: StandardEvidenceItemV1;
  value: StandardEvidenceGraphV1["evidenced_values"][number];
} {
  const suffix = String(index).padStart(2, "0");
  const candidateId = `STD-CAND-FIX-${suffix}`;
  const claimId = `STD-CLM-FIX-${suffix}`;
  const evidenceId = `STD-EVD-FIX-${suffix}`;
  const extract = `Repository fixture ${suffix} supports the declared synthetic organization capability for deterministic evaluation.`;
  return {
    candidate: {
      candidate_id: candidateId,
      display_name: `Standard Fixture Manufacturer ${suffix}`,
      country_code: index % 2 === 0 ? "DE" : "NL",
      rationale_extended:
        "Repository-owned evidence supports the declared synthetic capability within the stated limitations.",
      rationale_claim_ids: [claimId],
      mandatory_constraints_satisfied: true,
      failed_constraint_ids: [],
      dimensions: dimensionsFor(index),
      verification_status: "claimed",
      evidence_confidence: index === 1 ? "low" : "high",
      deterministic_tie_breaker: candidateId,
    },
    claim: {
      claim_id: claimId,
      candidate_id: candidateId,
      text: `Synthetic organization ${suffix} declares the fixture capability.`,
      decision_bearing: true,
      high_risk: false,
      verification_status: "claimed",
      evidence_confidence: index === 1 ? "low" : "high",
      evidence_ids: [evidenceId],
      corroboration: {
        required: false,
        status: "not_required",
        independent_evidence_ids: [],
      },
    },
    evidence: {
      evidence_id: evidenceId,
      source_kind: "synthetic_fixture",
      fixture_identity: `fixture://matchbase/standard/candidate-${suffix}`,
      title: `Standard synthetic capability evidence ${suffix}`,
      publisher: "MatchBASE repository fixture corpus",
      publisher_domain: `publisher-${suffix}.example.invalid`,
      published_or_updated: "2026-08-15",
      accessed_at: "2026-08-15T00:00:00.000+00:00",
      source_tier: "primary",
      verification_status: "claimed",
      access_state: "available",
      volatility_class: "moderate",
      extract,
      content_sha256: standardContentSha256(extract),
      verification_disposition: "accepted",
      provenance: "synthetic_fixture",
    },
    value: {
      value_id: `STD-VAL-FIX-${suffix}`,
      candidate_id: candidateId,
      kind: "capacity",
      value: `${1000 + index * 100} synthetic units per month`,
      verification_status: "claimed",
      evidence_ids: [evidenceId],
    },
  };
}

export function buildStandardSyntheticEvidenceGraph(
  runId: string,
  scenario: StandardSyntheticScenario,
  runBoundCanonicalHardConstraints: readonly StandardHardConstraintV1[],
): StandardEvidenceGraphV1 {
  const eligibleCount = STANDARD_SYNTHETIC_SCENARIO_COUNTS[scenario];
  const rejectedCount = Math.max(0, 3 - eligibleCount);
  const constraintIds = runBoundCanonicalHardConstraints.map(
    (constraint) => constraint.constraint_id,
  );
  if (
    new Set(constraintIds).size !== constraintIds.length ||
    constraintIds.some((constraintId) => constraintId.length === 0)
  )
    throw new Error(
      "Synthetic scarcity fixtures require unique run-bound canonical constraint identifiers.",
    );
  if (rejectedCount > 0 && constraintIds.length === 0)
    throw new Error(
      "Synthetic scarcity fixture requires a run-bound canonical hard constraint.",
    );
  const recordCount = eligibleCount + rejectedCount;
  const records = Array.from({ length: recordCount }, (_, index) =>
    standardFixtureRecord(index + 1),
  );
  Array.from({ length: rejectedCount }, (_, index) => index).forEach(
    (index) => {
      const constraintId = constraintIds[index % constraintIds.length]!;
      const candidate = records[eligibleCount + index]!.candidate;
      candidate.mandatory_constraints_satisfied = false;
      candidate.failed_constraint_ids = [constraintId];
    },
  );
  const graph: StandardEvidenceGraphV1 = {
    schema_version: "standard-evidence-graph.v1",
    run_id: runId,
    candidates: records.map((record) => record.candidate),
    claims: records.map((record) => record.claim),
    evidence: records.map((record) => record.evidence),
    evidenced_values: records.map((record) => record.value),
    eligible_candidate_ids: records
      .slice(0, eligibleCount)
      .map((record) => record.candidate.candidate_id),
    gate_evaluations: [
      {
        gate_id: "mandatory_constraints",
        label: "Mandatory constraint failures",
        eliminated_count: rejectedCount,
      },
      {
        gate_id: "evidence_sufficiency",
        label: "Insufficient decision evidence",
        eliminated_count: 0,
      },
    ],
    unknown_count: scenario === "zero" ? 2 : 0,
    not_asked_count: 1,
    gate_evaluation_completed_at: "2026-08-15T00:00:00.000+00:00",
  };
  validateStandardEvidenceGraph(graph);
  return graph;
}
