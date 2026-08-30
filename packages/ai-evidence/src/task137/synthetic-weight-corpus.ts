import { createHash } from "node:crypto";
import {
  STANDARD_DIMENSIONS,
  type StandardDimensionId,
} from "@matchbase/contracts";

export const TASK137_SYNTHETIC_CORPUS_SCHEMA_VERSION =
  "task137-synthetic-weight-corpus.v1" as const;
export const TASK137_SYNTHETIC_CORPUS_ID =
  "TASK137-SYNTHETIC-WEIGHT-CORPUS-V1" as const;

export const TASK137_SYNTHETIC_DIMENSIONS = STANDARD_DIMENSIONS.map(
  ({ dimension_id, weight }) => ({ dimensionId: dimension_id, weight }),
);

export const TASK137_SYNTHETIC_BASE_WEIGHTS = [25, 20, 15, 15, 15, 10] as const;

export const TASK137_SYNTHETIC_RATINGS = [0, 25, 50, 75, 100] as const;

export const TASK137_SYNTHETIC_STRATA = [
  "S1_SINGLE_AXIS",
  "S2_BALANCED",
  "S3_HARD_GATE",
  "S4_BOUNDARY",
  "S5_EVIDENCE",
  "S6_WAVE_SCARCITY",
] as const;

export type Task137SyntheticStratum = (typeof TASK137_SYNTHETIC_STRATA)[number];
export type Task137SyntheticRating = (typeof TASK137_SYNTHETIC_RATINGS)[number];
export type Task137SyntheticRatings = readonly [
  Task137SyntheticRating,
  Task137SyntheticRating,
  Task137SyntheticRating,
  Task137SyntheticRating,
  Task137SyntheticRating,
  Task137SyntheticRating,
];
export type Task137SyntheticWeights = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];
export type Task137SyntheticGateState =
  "ELIGIBLE" | "INELIGIBLE" | "PENDING_REVIEW";
export type Task137SyntheticEvidenceVerification =
  | "INDEPENDENTLY_CORROBORATED"
  | "AUTHORITATIVE_FIELD_VERIFIED"
  | "SUPPLIER_ONLY"
  | "MISSING"
  | "FETCHED_UNVERIFIED"
  | "CONFLICTING"
  | "INVALIDATED";
export type Task137SyntheticScarcity =
  | "NONE_ELIGIBLE"
  | "SOLE_ELIGIBLE"
  | "LIMITED_COMPETITION"
  | "SUFFICIENT_COMPETITION";
export type Task137SyntheticPromotionTrigger =
  | "WITHDRAWAL"
  | "RFQ_DEADLINE_MISSED"
  | "DEEP_DILIGENCE_HARD_GATE_FAILURE"
  | "EVIDENCE_INVALIDATED"
  | "LEGAL_OR_COMPLIANCE_RESTRICTION"
  | "CAPACITY_OR_DELIVERY_COMMITMENT_FAILED";

export interface Task137SyntheticEvidence {
  readonly evidenceId: string;
  readonly dimensionId: StandardDimensionId | "excluded_fixture";
  readonly verification: Task137SyntheticEvidenceVerification;
  readonly disposition: "USED" | "EXCLUDED";
  readonly contentSha256: string;
  readonly exclusionReason?: string;
}

export interface Task137SyntheticCandidate {
  readonly candidateId: string;
  readonly gateState: Task137SyntheticGateState;
  readonly ratings: Task137SyntheticRatings;
  readonly usedEvidenceIds: readonly string[];
  readonly evidence: readonly Task137SyntheticEvidence[];
  readonly corroboratedClaimCount: number;
  readonly authoritativeClaimCount: number;
  readonly unresolvedLimitationCount: number;
  readonly completeEvidenceOrdinal: number;
}

export interface Task137SyntheticExpectedResult {
  readonly scoreByCandidate: Readonly<Record<string, number>>;
  readonly eligibleOrder: readonly string[];
  readonly displayedCandidateIds: readonly string[];
  readonly reserveCandidateIds: readonly string[];
  readonly promotedCandidateId?: string;
  readonly scarcity: Task137SyntheticScarcity;
  readonly eligibleCount: number;
  readonly displayedCount: number;
  readonly truncated: boolean;
  readonly scarcityOverrideApplied: boolean;
  readonly entitlementProjection: {
    readonly demo: "COARSE_RESULT_ONLY";
    readonly standard: "EVIDENCE_SUMMARY";
    readonly consultant: "GOVERNED_FULL_RESULT";
  };
  readonly rationaleSourceIdsByCandidate: Readonly<
    Record<string, readonly string[]>
  >;
}

export type Task137TieBreakKey =
  | "CORROBORATED_REQUIRED_CLAIMS"
  | "AUTHORITATIVE_REQUIRED_CLAIMS"
  | "UNRESOLVED_LIMITATIONS"
  | "COMPLETE_EVIDENCE_ORDINAL"
  | "IMMUTABLE_CANDIDATE_ID";

export interface Task137SyntheticCorpusCase {
  readonly caseId: string;
  readonly caseVersion: 1;
  readonly stratum: Task137SyntheticStratum;
  readonly ordinal: number;
  readonly businessFrame: {
    readonly product_requirement: string;
    readonly quantity_requirement: string;
    readonly target_market: string;
  };
  readonly softCap: number;
  readonly candidates: readonly Task137SyntheticCandidate[];
  readonly promotionTrigger?: Task137SyntheticPromotionTrigger;
  readonly tieBreakExpectation?: {
    readonly decidingKey: Task137TieBreakKey;
    readonly higherPriorityCandidateId: string;
    readonly lowerPriorityCandidateId: string;
  };
  readonly expected: Task137SyntheticExpectedResult;
  readonly caseSha256: string;
}

export interface Task137SyntheticCorpus {
  readonly schemaVersion: typeof TASK137_SYNTHETIC_CORPUS_SCHEMA_VERSION;
  readonly corpusId: typeof TASK137_SYNTHETIC_CORPUS_ID;
  readonly cases: readonly Task137SyntheticCorpusCase[];
  readonly corpusSha256: string;
}

interface CandidateDraft {
  readonly gateState: Task137SyntheticGateState;
  readonly ratings: Task137SyntheticRatings;
  readonly verification?: readonly Task137SyntheticEvidenceVerification[];
  readonly corroboratedClaimCount?: number;
  readonly authoritativeClaimCount?: number;
  readonly unresolvedLimitationCount?: number;
  readonly completeEvidenceOrdinal?: number;
}

interface CaseDraft {
  readonly stratum: Task137SyntheticStratum;
  readonly softCap: number;
  readonly candidates: readonly CandidateDraft[];
  readonly promotionTrigger?: Task137SyntheticPromotionTrigger;
  readonly tieBreakExpectation?: {
    readonly decidingKey: Task137TieBreakKey;
    readonly higherPriorityCandidateOrdinal: number;
    readonly lowerPriorityCandidateOrdinal: number;
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function task137CanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function task137Sha256(value: unknown): string {
  return createHash("sha256")
    .update(task137CanonicalJson(value), "utf8")
    .digest("hex");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function ratingTuple(values: readonly number[]): Task137SyntheticRatings {
  if (
    values.length !== TASK137_SYNTHETIC_DIMENSIONS.length ||
    values.some(
      (value) =>
        !TASK137_SYNTHETIC_RATINGS.includes(value as Task137SyntheticRating),
    )
  ) {
    throw new Error("TASK137 synthetic ratings require six closed values.");
  }
  return [...values] as unknown as Task137SyntheticRatings;
}

function referenceScore(
  ratings: Task137SyntheticRatings,
  weights: Task137SyntheticWeights = TASK137_SYNTHETIC_BASE_WEIGHTS,
): number {
  const weighted = ratings.reduce<number>(
    (total, rating, index) => total + rating * (weights[index] ?? 0),
    0,
  );
  return Math.floor(weighted + 0.5) / 100;
}

function evidenceCeiling(
  state: Task137SyntheticEvidenceVerification,
): Task137SyntheticRating {
  if (
    state === "INDEPENDENTLY_CORROBORATED" ||
    state === "AUTHORITATIVE_FIELD_VERIFIED"
  )
    return 100;
  if (state === "INVALIDATED") return 0;
  return 50;
}

function defaultVerification(
  ratings: Task137SyntheticRatings,
): readonly Task137SyntheticEvidenceVerification[] {
  return ratings.map((rating) =>
    rating > 50 ? "INDEPENDENTLY_CORROBORATED" : "FETCHED_UNVERIFIED",
  );
}

function buildCandidate(
  caseId: string,
  candidateIndex: number,
  draft: CandidateDraft,
): Task137SyntheticCandidate {
  const candidateId = `${caseId}-C${String(candidateIndex + 1).padStart(2, "0")}`;
  const verification = draft.verification ?? defaultVerification(draft.ratings);
  if (verification.length !== TASK137_SYNTHETIC_DIMENSIONS.length)
    throw new Error("TASK137 candidate requires six evidence bindings.");
  verification.forEach((state, index) => {
    if ((draft.ratings[index] ?? 0) > evidenceCeiling(state))
      throw new Error("TASK137 synthetic rating exceeds its evidence ceiling.");
  });
  const usedEvidence = TASK137_SYNTHETIC_DIMENSIONS.flatMap(
    ({ dimensionId }, dimensionIndex): Task137SyntheticEvidence[] => {
      const evidenceId = `${candidateId}-E${dimensionIndex + 1}`;
      const state = verification[dimensionIndex]!;
      if (state === "MISSING") return [];
      return [
        {
          evidenceId,
          dimensionId,
          verification: state,
          disposition: "USED",
          contentSha256: task137Sha256({
            candidateId,
            dimensionId,
            state,
            fixture: "synthetic-only",
          }),
        },
      ];
    },
  );
  const excluded: Task137SyntheticEvidence = {
    evidenceId: `${candidateId}-EXCLUDED`,
    dimensionId: "excluded_fixture",
    verification: "FETCHED_UNVERIFIED",
    disposition: "EXCLUDED",
    exclusionReason: "Synthetic fetched fixture is not used by a scoring rule.",
    contentSha256: task137Sha256({ candidateId, excluded: true }),
  };
  return {
    candidateId,
    gateState: draft.gateState,
    ratings: draft.ratings,
    usedEvidenceIds: usedEvidence.map(({ evidenceId }) => evidenceId),
    evidence: [...usedEvidence, excluded],
    corroboratedClaimCount:
      draft.corroboratedClaimCount ??
      verification.filter((state) => state === "INDEPENDENTLY_CORROBORATED")
        .length,
    authoritativeClaimCount:
      draft.authoritativeClaimCount ??
      verification.filter((state) => state === "AUTHORITATIVE_FIELD_VERIFIED")
        .length,
    unresolvedLimitationCount:
      draft.unresolvedLimitationCount ??
      verification.filter((state) =>
        [
          "FETCHED_UNVERIFIED",
          "CONFLICTING",
          "SUPPLIER_ONLY",
          "MISSING",
        ].includes(state),
      ).length,
    completeEvidenceOrdinal:
      draft.completeEvidenceOrdinal ?? candidateIndex + 1,
  };
}

function compareCandidates(
  left: Task137SyntheticCandidate,
  right: Task137SyntheticCandidate,
): number {
  const scoreDifference =
    referenceScore(right.ratings) - referenceScore(left.ratings);
  return (
    scoreDifference ||
    right.corroboratedClaimCount - left.corroboratedClaimCount ||
    right.authoritativeClaimCount - left.authoritativeClaimCount ||
    left.unresolvedLimitationCount - right.unresolvedLimitationCount ||
    left.completeEvidenceOrdinal - right.completeEvidenceOrdinal ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function scarcity(eligibleCount: number): Task137SyntheticScarcity {
  if (eligibleCount === 0) return "NONE_ELIGIBLE";
  if (eligibleCount === 1) return "SOLE_ELIGIBLE";
  if (eligibleCount === 2) return "LIMITED_COMPETITION";
  return "SUFFICIENT_COMPETITION";
}

function finalizeCase(
  draft: CaseDraft,
  ordinal: number,
): Task137SyntheticCorpusCase {
  const caseId = `TASK137-${draft.stratum}-${String(ordinal + 1).padStart(3, "0")}`;
  const candidates = draft.candidates.map((candidate, candidateIndex) =>
    buildCandidate(caseId, candidateIndex, candidate),
  );
  const eligible = candidates
    .filter(({ gateState }) => gateState === "ELIGIBLE")
    .sort(compareCandidates);
  const displayed = eligible.slice(0, draft.softCap);
  const reserve = eligible.slice(draft.softCap);
  const promotedCandidateId =
    draft.promotionTrigger === undefined ? undefined : reserve[0]?.candidateId;
  const expected: Task137SyntheticExpectedResult = {
    scoreByCandidate: Object.fromEntries(
      candidates.map((candidate) => [
        candidate.candidateId,
        referenceScore(candidate.ratings),
      ]),
    ),
    eligibleOrder: eligible.map(({ candidateId }) => candidateId),
    displayedCandidateIds: displayed.map(({ candidateId }) => candidateId),
    reserveCandidateIds: reserve.map(({ candidateId }) => candidateId),
    ...(promotedCandidateId === undefined ? {} : { promotedCandidateId }),
    scarcity: scarcity(eligible.length),
    eligibleCount: eligible.length,
    displayedCount: displayed.length,
    truncated: eligible.length > draft.softCap,
    scarcityOverrideApplied: eligible.length < draft.softCap,
    entitlementProjection: {
      demo: "COARSE_RESULT_ONLY",
      standard: "EVIDENCE_SUMMARY",
      consultant: "GOVERNED_FULL_RESULT",
    },
    rationaleSourceIdsByCandidate: Object.fromEntries(
      eligible.map(({ candidateId }) => [
        candidateId,
        ["RULE-HARD-GATE-ELIGIBLE", "RULE-SIX-DIMENSION-WEIGHTED-SCORE"],
      ]),
    ),
  };
  const payload = {
    caseId,
    caseVersion: 1 as const,
    stratum: draft.stratum,
    ordinal: ordinal + 1,
    businessFrame: {
      product_requirement: `Synthetic product requirement ${ordinal + 1}`,
      quantity_requirement: `${(ordinal + 1) * 100} synthetic units`,
      target_market: `SYNTHETIC-MARKET-${String((ordinal % 6) + 1).padStart(2, "0")}`,
    },
    softCap: draft.softCap,
    candidates,
    ...(draft.promotionTrigger === undefined
      ? {}
      : { promotionTrigger: draft.promotionTrigger }),
    ...(draft.tieBreakExpectation === undefined
      ? {}
      : {
          tieBreakExpectation: {
            decidingKey: draft.tieBreakExpectation.decidingKey,
            higherPriorityCandidateId:
              candidates[
                draft.tieBreakExpectation.higherPriorityCandidateOrdinal
              ]?.candidateId ?? "MISSING",
            lowerPriorityCandidateId:
              candidates[
                draft.tieBreakExpectation.lowerPriorityCandidateOrdinal
              ]?.candidateId ?? "MISSING",
          },
        }),
    expected,
  };
  return { ...payload, caseSha256: task137Sha256(payload) };
}

function singleAxisDrafts(): readonly CaseDraft[] {
  return TASK137_SYNTHETIC_DIMENSIONS.flatMap((_, dimensionIndex) => {
    const strong = [75, 75, 75, 75, 75, 75];
    strong[dimensionIndex] = 100;
    const mismatch = [100, 100, 100, 100, 100, 100];
    mismatch[dimensionIndex] = 0;
    return [strong, mismatch].map((ratings) => ({
      stratum: "S1_SINGLE_AXIS" as const,
      softCap: 3,
      candidates: [
        { gateState: "ELIGIBLE" as const, ratings: ratingTuple(ratings) },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
        },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([25, 25, 25, 25, 25, 25]),
        },
      ],
    }));
  });
}

function balancedDrafts(): readonly CaseDraft[] {
  return Array.from({ length: 12 }, (_, index) => {
    const repeated = (
      state: Task137SyntheticEvidenceVerification,
    ): readonly Task137SyntheticEvidenceVerification[] =>
      Array.from({ length: 6 }, () => state);
    if (index < 5) {
      const tieCases: readonly CaseDraft[] = [
        {
          stratum: "S2_BALANCED",
          softCap: 3,
          candidates: [
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("INDEPENDENTLY_CORROBORATED"),
            },
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("AUTHORITATIVE_FIELD_VERIFIED"),
            },
          ],
          tieBreakExpectation: {
            decidingKey: "CORROBORATED_REQUIRED_CLAIMS",
            higherPriorityCandidateOrdinal: 0,
            lowerPriorityCandidateOrdinal: 1,
          },
        },
        {
          stratum: "S2_BALANCED",
          softCap: 3,
          candidates: [
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("AUTHORITATIVE_FIELD_VERIFIED"),
            },
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("FETCHED_UNVERIFIED"),
            },
          ],
          tieBreakExpectation: {
            decidingKey: "AUTHORITATIVE_REQUIRED_CLAIMS",
            higherPriorityCandidateOrdinal: 0,
            lowerPriorityCandidateOrdinal: 1,
          },
        },
        {
          stratum: "S2_BALANCED",
          softCap: 3,
          candidates: [
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([0, 0, 0, 0, 0, 0]),
              verification: repeated("INVALIDATED"),
            },
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([0, 0, 0, 0, 0, 0]),
              verification: repeated("MISSING"),
            },
          ],
          tieBreakExpectation: {
            decidingKey: "UNRESOLVED_LIMITATIONS",
            higherPriorityCandidateOrdinal: 0,
            lowerPriorityCandidateOrdinal: 1,
          },
        },
        {
          stratum: "S2_BALANCED",
          softCap: 3,
          candidates: [
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("SUPPLIER_ONLY"),
              completeEvidenceOrdinal: 1,
            },
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("SUPPLIER_ONLY"),
              completeEvidenceOrdinal: 2,
            },
          ],
          tieBreakExpectation: {
            decidingKey: "COMPLETE_EVIDENCE_ORDINAL",
            higherPriorityCandidateOrdinal: 0,
            lowerPriorityCandidateOrdinal: 1,
          },
        },
        {
          stratum: "S2_BALANCED",
          softCap: 3,
          candidates: [
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("FETCHED_UNVERIFIED"),
              completeEvidenceOrdinal: 1,
            },
            {
              gateState: "ELIGIBLE",
              ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
              verification: repeated("FETCHED_UNVERIFIED"),
              completeEvidenceOrdinal: 1,
            },
          ],
          tieBreakExpectation: {
            decidingKey: "IMMUTABLE_CANDIDATE_ID",
            higherPriorityCandidateOrdinal: 0,
            lowerPriorityCandidateOrdinal: 1,
          },
        },
      ];
      return tieCases[index]!;
    }
    const first = [75, 75, 75, 75, 75, 75];
    first[index % 6] = 100;
    first[(index + 1) % 6] = 100;
    const second = [100, 100, 100, 100, 100, 100];
    second[index % 6] = 50;
    second[(index + 1) % 6] = 50;
    return {
      stratum: "S2_BALANCED" as const,
      softCap: 3,
      candidates: [
        { gateState: "ELIGIBLE" as const, ratings: ratingTuple(first) },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple(second),
        },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
        },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([25, 25, 25, 25, 25, 25]),
        },
      ],
    };
  });
}

function hardGateDrafts(): readonly CaseDraft[] {
  return Array.from({ length: 12 }, (_, index) => ({
    stratum: "S3_HARD_GATE" as const,
    softCap: 3,
    candidates: [
      {
        gateState: index % 2 === 0 ? "INELIGIBLE" : "PENDING_REVIEW",
        ratings: ratingTuple([100, 100, 100, 100, 100, 100]),
      },
      {
        gateState: "ELIGIBLE" as const,
        ratings: ratingTuple([100, 100, 100, 75, 75, 75]),
      },
      {
        gateState: "ELIGIBLE" as const,
        ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
      },
      {
        gateState: "INELIGIBLE" as const,
        ratings: ratingTuple([75, 75, 75, 75, 75, 75]),
      },
    ],
  }));
}

function boundaryDrafts(): readonly CaseDraft[] {
  return Array.from({ length: 12 }, (_, index) => {
    const high = TASK137_SYNTHETIC_DIMENSIONS.map(
      (_, dimensionIndex) =>
        TASK137_SYNTHETIC_RATINGS[
          (index + dimensionIndex + 2) % TASK137_SYNTHETIC_RATINGS.length
        ]!,
    );
    const safeHigh = high.map((rating) => (rating < 50 ? 75 : rating));
    return {
      stratum: "S4_BOUNDARY" as const,
      softCap: 2,
      candidates: [
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple(safeHigh),
        },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([25, 25, 25, 25, 25, 25]),
        },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([0, 0, 0, 0, 0, 0]),
        },
      ],
    };
  });
}

function evidenceDrafts(): readonly CaseDraft[] {
  const states = [
    "INDEPENDENTLY_CORROBORATED",
    "AUTHORITATIVE_FIELD_VERIFIED",
    "SUPPLIER_ONLY",
    "MISSING",
    "FETCHED_UNVERIFIED",
    "CONFLICTING",
    "INVALIDATED",
  ] as const;
  return Array.from({ length: 12 }, (_, index) => {
    const verification = TASK137_SYNTHETIC_DIMENSIONS.map(
      (_, dimensionIndex) => states[(index + dimensionIndex) % states.length]!,
    );
    const ratings = verification.map((state) => evidenceCeiling(state));
    return {
      stratum: "S5_EVIDENCE" as const,
      softCap: 2,
      candidates: [
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple(ratings),
          verification,
        },
        {
          gateState: "ELIGIBLE" as const,
          ratings: ratingTuple([0, 0, 0, 0, 0, 0]),
          verification: Array.from({ length: 6 }, () => "INVALIDATED" as const),
        },
        {
          gateState: "PENDING_REVIEW" as const,
          ratings: ratingTuple([50, 50, 50, 50, 50, 50]),
          verification: Array.from({ length: 6 }, () => "CONFLICTING" as const),
        },
      ],
    };
  });
}

function waveScarcityDrafts(): readonly CaseDraft[] {
  const eligibleCounts = [0, 1, 2, 3, 5, 4, 0, 1, 2, 3, 5, 4] as const;
  return eligibleCounts.map((eligibleCount, index) => {
    const candidates: CandidateDraft[] = Array.from(
      { length: Math.max(eligibleCount, 1) + 1 },
      (_, candidateIndex) => ({
        gateState:
          candidateIndex < eligibleCount
            ? ("ELIGIBLE" as const)
            : ("INELIGIBLE" as const),
        ratings: ratingTuple(
          Array.from({ length: 6 }, () =>
            Math.max(
              0,
              100 -
                (index === 8 && candidateIndex < 2 ? 0 : candidateIndex * 25),
            ),
          ),
        ),
      }),
    );
    const softCap = [1, 2, 3][index % 3]!;
    const hasReserve = eligibleCount > softCap;
    return {
      stratum: "S6_WAVE_SCARCITY" as const,
      softCap,
      candidates,
      ...(hasReserve
        ? {
            promotionTrigger: [
              "WITHDRAWAL",
              "RFQ_DEADLINE_MISSED",
              "DEEP_DILIGENCE_HARD_GATE_FAILURE",
              "EVIDENCE_INVALIDATED",
              "LEGAL_OR_COMPLIANCE_RESTRICTION",
              "CAPACITY_OR_DELIVERY_COMMITMENT_FAILED",
            ][index % 6] as Task137SyntheticPromotionTrigger,
          }
        : {}),
    };
  });
}

export function generateTask137SyntheticWeightCorpus(): Task137SyntheticCorpus {
  const drafts = [
    ...singleAxisDrafts(),
    ...balancedDrafts(),
    ...hardGateDrafts(),
    ...boundaryDrafts(),
    ...evidenceDrafts(),
    ...waveScarcityDrafts(),
  ];
  const cases = drafts.map((draft, ordinal) => finalizeCase(draft, ordinal));
  const payload = {
    schemaVersion: TASK137_SYNTHETIC_CORPUS_SCHEMA_VERSION,
    corpusId: TASK137_SYNTHETIC_CORPUS_ID,
    cases,
  };
  return deepFreeze({
    ...payload,
    corpusSha256: task137Sha256(payload),
  }) as Task137SyntheticCorpus;
}
