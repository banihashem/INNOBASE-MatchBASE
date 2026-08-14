export const EVIDENCE_GRAPH_SCHEMA_VERSION = "evidence-graph.v1" as const;

export type VerificationStatus =
  | "claimed"
  | "externally_verified"
  | "inferred"
  | "stale"
  | "conflicting"
  | "unknown"
  | "synthetic";

export interface EvidenceItemV1 {
  evidenceId: string;
  sourceKind: "synthetic_fixture" | "reserved_url" | "local_fixture";
  url: string;
  title: string;
  publisher: string;
  publisherDomain: string;
  retrievedAt: string;
  contentSha256: string;
  extract: string;
  verificationDisposition: "accepted" | "excluded";
  exclusionReason: string;
}

export interface ClaimV1 {
  claimId: string;
  candidateId: string;
  text: string;
  decisionBearing: boolean;
  verificationStatus: VerificationStatus;
  evidenceConfidence: "high" | "medium" | "low";
  evidenceIds: string[];
}

export interface CandidateV1 {
  candidateId: string;
  displayName: string;
  countryCode: string;
  rationaleShort: string;
  rationaleClaimIds: string[];
  compatibilityScore: number;
  fitBand: string;
  bandCeiling: string;
  displayedBand: string;
  dimensionScores: Record<string, number>;
  citations: string[];
  verificationStatus: VerificationStatus;
  mandatoryConstraintsSatisfied: boolean;
  failedConstraintIds: string[];
  deterministicRankKey: string;
}

export interface EvidenceGraphV1 {
  schemaVersion: typeof EVIDENCE_GRAPH_SCHEMA_VERSION;
  runId: string;
  candidates: CandidateV1[];
  claims: ClaimV1[];
  evidence: EvidenceItemV1[];
  eligibleCandidateIds: string[];
  gateEvaluationCompletedAt: string;
}
