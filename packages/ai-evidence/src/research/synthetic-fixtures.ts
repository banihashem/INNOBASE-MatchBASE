import type {
  CandidateV1,
  ClaimV1,
  EvidenceGraphV1,
  EvidenceItemV1,
} from "@matchbase/contracts";
import type { ResearchCapability, ResearchInput } from "../capabilities.js";
import { contentSha256, validateEvidenceGraph } from "../evidence/integrity.js";

export const SYNTHETIC_CASE_COUNTS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  many: 4,
} as const;

export function selectEligibleCandidateIds(
  candidates: readonly CandidateV1[],
): string[] {
  return candidates
    .filter((candidate) => candidate.mandatoryConstraintsSatisfied)
    .sort((left, right) =>
      left.deterministicRankKey.localeCompare(right.deterministicRankKey, "en"),
    )
    .map((candidate) => candidate.candidateId);
}

function syntheticCandidate(index: number): {
  candidate: CandidateV1;
  claim: ClaimV1;
  evidence: EvidenceItemV1;
} {
  const suffix = String(index).padStart(2, "0");
  const candidateId = `CAND-FIX-${suffix}`;
  const claimId = `CLM-FIX-${suffix}`;
  const evidenceId = `EVD-FIX-${suffix}`;
  const extract = `Synthetic fixture record ${suffix} confirms the declared manufacturing profile for evaluation only.`;
  return {
    candidate: {
      candidateId,
      displayName: `Fixture Manufacturer ${suffix}`,
      countryCode: index % 2 === 0 ? "DE" : "NL",
      rationaleShort:
        "The repository-owned fixture satisfies every declared mandatory constraint.",
      rationaleClaimIds: [claimId],
      compatibilityScore: 90 - index,
      fitBand: "strong",
      bandCeiling: "strong",
      displayedBand: "strong",
      dimensionScores: { technical: 90 - index, trade: 85 - index },
      citations: [evidenceId],
      verificationStatus: "synthetic",
      mandatoryConstraintsSatisfied: true,
      failedConstraintIds: [],
      deterministicRankKey: `${String(100 - (90 - index)).padStart(3, "0")}:${candidateId}`,
    },
    claim: {
      claimId,
      candidateId,
      text: `Fixture candidate ${suffix} satisfies the mandatory synthetic constraint set.`,
      decisionBearing: true,
      verificationStatus: "synthetic",
      evidenceConfidence: "high",
      evidenceIds: [evidenceId],
    },
    evidence: {
      evidenceId,
      sourceKind: "synthetic_fixture",
      url: `https://supplier-${suffix}.example.invalid/evidence`,
      title: `Synthetic evidence ${suffix}`,
      publisher: "MatchBASE fixture corpus",
      publisherDomain: "example.invalid",
      retrievedAt: "2026-08-14T00:00:00.000Z",
      contentSha256: contentSha256(extract),
      extract,
      verificationDisposition: "accepted",
      exclusionReason: "",
    },
  };
}

export function buildSyntheticEvidenceGraph(
  runId: string,
  fixtureCase: keyof typeof SYNTHETIC_CASE_COUNTS,
): EvidenceGraphV1 {
  const count = SYNTHETIC_CASE_COUNTS[fixtureCase];
  const records = Array.from({ length: count }, (_, index) =>
    syntheticCandidate(index + 1),
  );
  const candidates = records.map((record) => record.candidate);

  // The gate is evaluated before sorting. A score can never restore an ineligible item.
  const eligibleCandidateIds = selectEligibleCandidateIds(candidates);

  const graph: EvidenceGraphV1 = {
    schemaVersion: "evidence-graph.v1",
    runId,
    candidates,
    claims: records.map((record) => record.claim),
    evidence: records.map((record) => record.evidence),
    eligibleCandidateIds,
    gateEvaluationCompletedAt: "2026-08-14T00:00:00.000Z",
  };
  validateEvidenceGraph(graph);
  return graph;
}

export class SyntheticFixtureResearchAdapter implements ResearchCapability {
  readonly capabilityId = "CAP-SEARCH" as const;

  async research(input: ResearchInput): Promise<EvidenceGraphV1> {
    return buildSyntheticEvidenceGraph(input.runId, input.fixtureCase);
  }
}
