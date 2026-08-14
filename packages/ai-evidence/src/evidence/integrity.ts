import { createHash } from "node:crypto";
import type {
  CandidateV1,
  ClaimV1,
  EvidenceGraphV1,
  EvidenceItemV1,
} from "@matchbase/contracts";

export function contentSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueIds<T>(
  values: readonly T[],
  getId: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (!id || result.has(id))
      throw new Error(`${label} identifiers must be unique.`);
    result.set(id, value);
  }
  return result;
}

function acceptedEvidence(
  claim: ClaimV1,
  evidenceById: ReadonlyMap<string, EvidenceItemV1>,
): EvidenceItemV1[] {
  return claim.evidenceIds.map((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence)
      throw new Error(`Claim ${claim.claimId} has dangling evidence.`);
    return evidence;
  });
}

export function validateEvidenceGraph(graph: EvidenceGraphV1): void {
  if (graph.schemaVersion !== "evidence-graph.v1") {
    throw new Error("Evidence graph schema version is invalid.");
  }
  const candidates = uniqueIds(
    graph.candidates,
    (item) => item.candidateId,
    "Candidate",
  );
  const claims = uniqueIds(graph.claims, (item) => item.claimId, "Claim");
  const evidence = uniqueIds(
    graph.evidence,
    (item) => item.evidenceId,
    "Evidence",
  );

  for (const item of graph.evidence) {
    if (item.contentSha256 !== contentSha256(item.extract)) {
      throw new Error(`Evidence ${item.evidenceId} content hash is invalid.`);
    }
    if (
      item.sourceKind === "synthetic_fixture" &&
      !(
        item.url.startsWith("fixture://") ||
        /^https:\/\/[^/]+\.example\.invalid(?:\/|$)/u.test(item.url)
      )
    ) {
      throw new Error(
        `Synthetic evidence ${item.evidenceId} uses a reachable URL shape.`,
      );
    }
  }
  for (const claim of graph.claims) {
    if (!candidates.has(claim.candidateId)) {
      throw new Error(`Claim ${claim.claimId} has a dangling candidate.`);
    }
    const linked = acceptedEvidence(claim, evidence);
    if (
      claim.decisionBearing &&
      !linked.some((item) => item.verificationDisposition === "accepted")
    ) {
      throw new Error(
        `Decision-bearing claim ${claim.claimId} lacks accepted evidence.`,
      );
    }
  }
  for (const candidate of graph.candidates) {
    const isEligible = graph.eligibleCandidateIds.includes(
      candidate.candidateId,
    );
    if (
      isEligible &&
      (!candidate.rationaleShort.trim() ||
        candidate.rationaleClaimIds.length === 0 ||
        candidate.citations.length === 0)
    ) {
      throw new Error(
        `Eligible candidate ${candidate.candidateId} requires non-empty rationale claims and citations.`,
      );
    }
    const rationaleEvidence = new Set<string>();
    for (const claimId of candidate.rationaleClaimIds) {
      const claim = claims.get(claimId);
      if (!claim || claim.candidateId !== candidate.candidateId) {
        throw new Error(
          `Candidate ${candidate.candidateId} has a dangling rationale claim.`,
        );
      }
      const linked = acceptedEvidence(claim, evidence);
      linked.forEach((item) => rationaleEvidence.add(item.evidenceId));
      if (
        !claim.decisionBearing ||
        !linked.some((item) => item.verificationDisposition === "accepted")
      ) {
        throw new Error(
          `Candidate ${candidate.candidateId} uses an unsupported rationale claim.`,
        );
      }
    }
    for (const citationId of candidate.citations) {
      if (!evidence.has(citationId)) {
        throw new Error(
          `Candidate ${candidate.candidateId} has a dangling citation.`,
        );
      }
      if (!rationaleEvidence.has(citationId)) {
        throw new Error(
          `Candidate ${candidate.candidateId} cites evidence outside its rationale claims.`,
        );
      }
    }
  }
  const eligible = new Set(graph.eligibleCandidateIds);
  if (eligible.size !== graph.eligibleCandidateIds.length) {
    throw new Error("Eligible candidate identifiers must be unique.");
  }
  for (const candidateId of eligible) {
    const candidate = candidates.get(candidateId);
    if (!candidate || !candidate.mandatoryConstraintsSatisfied) {
      throw new Error(
        "An ineligible candidate entered the eligible result set.",
      );
    }
  }
}

export function eligibleClaimsForCandidate(
  candidate: CandidateV1,
  claims: readonly ClaimV1[],
): ClaimV1[] {
  const claimIds = new Set(candidate.rationaleClaimIds);
  return claims.filter((claim) => claimIds.has(claim.claimId));
}
