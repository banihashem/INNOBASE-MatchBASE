export const EVIDENCE_LINEAGE_LEDGER_SCHEMA_VERSION =
  "evidence-lineage-ledger.v1" as const;
export const CANDIDATE_IDENTITY_RESOLVER_VERSION =
  "candidate-identity-resolver.v1" as const;

export interface EvidenceValueRecordV1 {
  readonly valueId: string;
  readonly accountId: string;
  readonly runId: string;
  readonly candidateId: string;
  readonly claimId: string;
  readonly evidenceId: string;
  readonly fieldId: string;
  readonly valueSha256: string;
}

export interface EvidenceDriverRecordV1 {
  readonly driverId: string;
  readonly accountId: string;
  readonly runId: string;
  readonly candidateId: string;
  readonly claimId: string;
  readonly valueId: string;
  readonly evidenceId: string;
  readonly dimensionId: string;
  readonly direction: "supports" | "contradicts" | "limits";
}

export interface CandidateIdentityResolutionV1 {
  readonly resolutionId: string;
  readonly accountId: string;
  readonly runId: string;
  readonly candidateId: string;
  readonly canonicalIdentitySha256: string;
  readonly disposition: "distinct" | "duplicate" | "rejected_ambiguous";
  readonly mergedIntoCandidateId: string | null;
  readonly resolverVersion: typeof CANDIDATE_IDENTITY_RESOLVER_VERSION;
  readonly reasonCode:
    | "unique_canonical_identity"
    | "duplicate_canonical_identity"
    | "insufficient_identity"
    | "canonical_hash_collision";
}

export interface EvidenceLineageLedgerV1 {
  readonly schemaVersion: typeof EVIDENCE_LINEAGE_LEDGER_SCHEMA_VERSION;
  readonly accountId: string;
  readonly runId: string;
  readonly values: readonly EvidenceValueRecordV1[];
  readonly drivers: readonly EvidenceDriverRecordV1[];
  readonly identityResolutions: readonly CandidateIdentityResolutionV1[];
}
