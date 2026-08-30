import {
  CONSULTANT_UNAVAILABLE_SOURCES,
  type CompleteResultEvidenceV2,
  type ConsultantProjectionReadinessV1,
  type ConsultantUnavailableSourceV1,
  type DemoRationaleSourceV2,
  type StandardEvidenceItemV1,
} from "../src/index.js";

type AssertFalse<Value extends false> = Value;
type ExactAcceptedEvidence = Extract<
  StandardEvidenceItemV1,
  { exact_url: string; verification_disposition: "accepted" }
>;
type InvalidLiveFixture = Omit<
  ExactAcceptedEvidence,
  "provenance" | "source_kind"
> & {
  provenance: "live_secure_fetch";
  source_kind: "local_fixture";
  external_verification_basis: { kind: "not_externally_verified" };
};
type InvalidRationalePair = {
  candidate_id: "candidate";
  rule_outcome: "mandatory_rules_satisfied";
  rationale_short: "Did not pass all mandatory matching rules.";
};
type InvalidFetchedVerification = Omit<
  ExactAcceptedEvidence,
  "provenance" | "source_kind" | "verification_status"
> & {
  provenance: "live_secure_fetch";
  source_kind: "reserved_url";
  verification_status: "externally_verified";
  external_verification_basis: { kind: "not_externally_verified" };
};
type RejectLiveFixture = AssertFalse<
  InvalidLiveFixture extends CompleteResultEvidenceV2 ? true : false
>;
type RejectRationaleCrossPair = AssertFalse<
  InvalidRationalePair extends DemoRationaleSourceV2 ? true : false
>;
type RejectFetchedVerification = AssertFalse<
  InvalidFetchedVerification extends CompleteResultEvidenceV2 ? true : false
>;
void (null as unknown as RejectLiveFixture);
void (null as unknown as RejectRationaleCrossPair);
void (null as unknown as RejectFetchedVerification);

const validReadiness: ConsultantProjectionReadinessV1 = {
  outcome: "blocked",
  missing_sources: CONSULTANT_UNAVAILABLE_SOURCES,
};
void validReadiness;

const excludedSource: ConsultantUnavailableSourceV1 = {
  // @ts-expect-error excluded_sources is already represented by persisted evidence.
  source_id: "excluded_sources",
  status: "unavailable",
  reason_code: "not_produced_by_current_pipeline",
};
void excludedSource;

const omittedSources = [
  CONSULTANT_UNAVAILABLE_SOURCES[0],
  CONSULTANT_UNAVAILABLE_SOURCES[1],
  CONSULTANT_UNAVAILABLE_SOURCES[2],
  CONSULTANT_UNAVAILABLE_SOURCES[3],
  CONSULTANT_UNAVAILABLE_SOURCES[4],
  CONSULTANT_UNAVAILABLE_SOURCES[5],
] as const;
const omittedReadiness: ConsultantProjectionReadinessV1 = {
  outcome: "blocked",
  // @ts-expect-error the ledger cannot omit a source.
  missing_sources: omittedSources,
};
void omittedReadiness;

const reorderedSources = [
  CONSULTANT_UNAVAILABLE_SOURCES[1],
  CONSULTANT_UNAVAILABLE_SOURCES[0],
  CONSULTANT_UNAVAILABLE_SOURCES[2],
  CONSULTANT_UNAVAILABLE_SOURCES[3],
  CONSULTANT_UNAVAILABLE_SOURCES[4],
  CONSULTANT_UNAVAILABLE_SOURCES[5],
  CONSULTANT_UNAVAILABLE_SOURCES[6],
] as const;
const reorderedReadiness: ConsultantProjectionReadinessV1 = {
  outcome: "blocked",
  // @ts-expect-error the ledger cannot reorder sources.
  missing_sources: reorderedSources,
};
void reorderedReadiness;

const duplicatedSources = [
  CONSULTANT_UNAVAILABLE_SOURCES[0],
  CONSULTANT_UNAVAILABLE_SOURCES[1],
  CONSULTANT_UNAVAILABLE_SOURCES[2],
  CONSULTANT_UNAVAILABLE_SOURCES[3],
  CONSULTANT_UNAVAILABLE_SOURCES[4],
  CONSULTANT_UNAVAILABLE_SOURCES[5],
  CONSULTANT_UNAVAILABLE_SOURCES[5],
] as const;
const duplicatedReadiness: ConsultantProjectionReadinessV1 = {
  outcome: "blocked",
  // @ts-expect-error the ledger cannot duplicate a source.
  missing_sources: duplicatedSources,
};
void duplicatedReadiness;
