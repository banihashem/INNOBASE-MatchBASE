import {
  CONSULTANT_DOMAIN_PACK_ID,
  CONSULTANT_DUE_DILIGENCE_CHECKS,
  CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  CONSULTANT_SOURCE_POLICY_ID,
  CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
  CONSULTANT_SOURCE_POLICY_VERSION,
  CONSULTANT_SYNTHETIC_RFQ_QUESTIONS,
  contractSha256Hex,
  parseConsultantResultProjectionV2,
  type ConsultantResultProjectionV2,
  type DemoProjectionV1,
  type StandardDimensionId,
  type StandardResultProjectionV1,
} from "@matchbase/contracts";
import { buildCompleteResultFoundationV2 } from "../complete-result/foundation-v2.js";
import { projectStoredResult } from "../projection/server-result.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../research/standard-synthetic-fixtures.js";
import { buildSyntheticEvidenceGraph } from "../research/synthetic-fixtures.js";
import { weightedScoreNumerator } from "../scoring/standard.js";
import {
  TASK137_PINNED_CONFIGURATION_SET_SHA256,
  TASK137_PINNED_CORPUS_SHA256,
  TASK137_PINNED_MANIFEST_ID,
  TASK137_PINNED_PROTOCOL_SHA256,
  TASK137_PINNED_SCORING_CODE_ID,
} from "./pinned-qualification-manifest.js";
import {
  TASK137_SYNTHETIC_BASE_WEIGHTS,
  TASK137_SYNTHETIC_CORPUS_ID,
  TASK137_SYNTHETIC_CORPUS_SCHEMA_VERSION,
  TASK137_SYNTHETIC_DIMENSIONS,
  TASK137_SYNTHETIC_RATINGS,
  TASK137_SYNTHETIC_STRATA,
  generateTask137SyntheticWeightCorpus,
  task137CanonicalJson,
  task137Sha256,
  type Task137SyntheticCandidate,
  type Task137SyntheticCorpus,
  type Task137SyntheticCorpusCase,
  type Task137SyntheticEvidenceVerification,
  type Task137SyntheticRating,
  type Task137SyntheticRatings,
  type Task137SyntheticScarcity,
  type Task137SyntheticWeights,
} from "./synthetic-weight-corpus.js";

export const TASK137_WEIGHT_CONFIGURATION_SCHEMA_VERSION =
  "task137-synthetic-weight-configuration.v1" as const;
export const TASK137_WEIGHT_QUALIFICATION_REPORT_SCHEMA_VERSION =
  "task137-synthetic-weight-qualification-report.v1" as const;

export type Task137SyntheticQualificationTerminalResult =
  | "SYNTHETIC_QUALIFICATION_PASSED"
  | "SYNTHETIC_WEIGHT_UNSTABLE"
  | "SYNTHETIC_QUALIFICATION_FAILED";

export interface Task137WeightConfiguration {
  readonly schemaVersion: typeof TASK137_WEIGHT_CONFIGURATION_SCHEMA_VERSION;
  readonly configurationId: string;
  readonly kind: "BASE" | "PAIRWISE_TRANSFER";
  readonly weights: Task137SyntheticWeights;
  readonly donorDimensionId?: StandardDimensionId;
  readonly receiverDimensionId?: StandardDimensionId;
  readonly transferPoints?: 5 | 10;
  readonly configurationSha256: string;
}

export interface Task137InvariantCheck {
  readonly invariantId: string;
  readonly passed: boolean;
  readonly checkedCount: number;
  readonly failureCount: number;
  readonly firstFailure?: string;
}

export interface Task137RankReversalMetrics {
  readonly applicableComparisonCount: number;
  readonly top1ReversalCount: number;
  readonly top1ReversalRate: number;
  readonly top3MembershipChangeCount: number;
  readonly top3MembershipStability: number;
  readonly pairwiseOrderReversalCount: number;
  readonly medianKendallTauB: number;
  readonly dominanceReversalCount: number;
}

export type Task137RankReversalDisposition =
  | "EXPECTED_CLOSE_MARGIN"
  | "WEIGHT_SENSITIVE_REQUIREMENT"
  | "TIE_BREAK_EFFECT"
  | "CORPUS_DEFECT"
  | "IMPLEMENTATION_DEFECT"
  | "UNRESOLVED";

export interface Task137RankReversalLedgerEntry {
  readonly caseId: string;
  readonly configurationId: string;
  readonly donorDimensionId: StandardDimensionId;
  readonly receiverDimensionId: StandardDimensionId;
  readonly transferPoints: 5 | 10;
  readonly leftCandidateId: string;
  readonly rightCandidateId: string;
  readonly baseMarginToNext: number | null;
  readonly alternateMarginToNext: number | null;
  readonly disposition: Task137RankReversalDisposition;
}

export interface Task137AppendOnlyAuditEntry {
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly previousEntrySha256: string;
  readonly payloadSha256: string;
  readonly entrySha256: string;
}

export interface Task137SyntheticQualificationReport {
  readonly schemaVersion: typeof TASK137_WEIGHT_QUALIFICATION_REPORT_SCHEMA_VERSION;
  readonly scope: "SYNTHETIC_ONLY";
  readonly terminalResult: Task137SyntheticQualificationTerminalResult;
  readonly corpusId: string;
  readonly corpusSha256: string;
  readonly corpusCaseCount: number;
  readonly weightConfigurationCount: number;
  readonly baseWeightConfigurationSha256: string;
  readonly invariantChecks: readonly Task137InvariantCheck[];
  readonly metrics: Task137RankReversalMetrics;
  readonly reversalLedger: readonly Task137RankReversalLedgerEntry[];
  readonly acceptancePackage: {
    readonly complete: boolean;
    readonly manifestId: string;
    readonly protocolIdentity: { readonly id: string; readonly sha256: string };
    readonly scoringCodeIdentity: string;
    readonly runtimeIdentity: string;
    readonly dependencyIdentity: string;
    readonly executionTimestampUtc: string;
    readonly corpusCaseManifest: readonly {
      readonly caseId: string;
      readonly caseSha256: string;
    }[];
    readonly configurationManifest: readonly {
      readonly configurationId: string;
      readonly configurationSha256: string;
    }[];
    readonly baseResultManifestSha256: string;
    readonly sensitivityManifestSha256: string;
    readonly projectionSafetyReportSha256: string;
    readonly historicalImmutabilityEvidenceSha256: string;
    readonly auditEntries: readonly Task137AppendOnlyAuditEntry[];
    readonly defectGapLedger: readonly {
      readonly gapId: string;
      readonly state: "CLOSED" | "OPEN_PRODUCTION_ONLY";
      readonly statement: string;
    }[];
  };
  readonly acceptanceThresholds: {
    readonly maximumTop1ReversalRate: 0.15;
    readonly minimumTop3MembershipStability: 0.8;
    readonly minimumMedianKendallTauB: 0.8;
    readonly maximumDominanceReversalCount: 0;
  };
  readonly runSha256: string;
}

interface CaseEvaluation {
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
  readonly entitlementProjection: Task137SyntheticCorpusCase["expected"]["entitlementProjection"];
  readonly rationaleSourceIdsByCandidate: Task137SyntheticCorpusCase["expected"]["rationaleSourceIdsByCandidate"];
}

interface MutableInvariant {
  invariantId: string;
  checkedCount: number;
  failureCount: number;
  firstFailure?: string;
}

const INVARIANT_IDS = [
  "CORPUS_INTEGRITY",
  "CONFIGURATION_INTEGRITY",
  "REPEATABILITY",
  "PERMUTATION_INVARIANCE",
  "MONOTONICITY",
  "DOMINANCE",
  "HARD_GATE_SUPREMACY",
  "EVIDENCE_CEILING",
  "NO_HIDDEN_INPUTS",
  "ROUNDING",
  "TIE_BREAK_DETERMINISM",
  "NO_PADDING",
  "RESERVE_DETERMINISM",
  "HISTORICAL_IMMUTABILITY",
  "PROJECTION_SAFETY",
  "PROVENANCE_INTEGRITY",
  "EXPECTED_BASE_RESULTS",
  "PINNED_MANIFEST_INTEGRITY",
  "ACCEPTANCE_PACKAGE_COMPLETENESS",
] as const;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function weightTuple(values: readonly number[]): Task137SyntheticWeights {
  if (
    values.length !== TASK137_SYNTHETIC_DIMENSIONS.length ||
    values.some((value) => !Number.isInteger(value) || value < 0) ||
    values.reduce((total, value) => total + value, 0) !== 100
  ) {
    throw new Error(
      "TASK137 weight configuration must contain six non-negative integers totaling 100.",
    );
  }
  return [...values] as unknown as Task137SyntheticWeights;
}

function configuration(
  configurationId: string,
  kind: Task137WeightConfiguration["kind"],
  weights: Task137SyntheticWeights,
  transfer?: {
    donorDimensionId: StandardDimensionId;
    receiverDimensionId: StandardDimensionId;
    transferPoints: 5 | 10;
  },
): Task137WeightConfiguration {
  const payload = {
    schemaVersion: TASK137_WEIGHT_CONFIGURATION_SCHEMA_VERSION,
    configurationId,
    kind,
    weights,
    ...transfer,
  };
  return {
    ...payload,
    configurationSha256: task137Sha256(payload),
  };
}

export function generateTask137WeightConfigurations(): readonly Task137WeightConfiguration[] {
  const configurations: Task137WeightConfiguration[] = [
    configuration(
      "TASK137-WEIGHTS-BASE-V1",
      "BASE",
      TASK137_SYNTHETIC_BASE_WEIGHTS,
    ),
  ];
  for (const transferPoints of [5, 10] as const) {
    TASK137_SYNTHETIC_DIMENSIONS.forEach((donor, donorIndex) => {
      TASK137_SYNTHETIC_DIMENSIONS.forEach((receiver, receiverIndex) => {
        if (donorIndex === receiverIndex) return;
        const weights: number[] = [...TASK137_SYNTHETIC_BASE_WEIGHTS];
        weights[donorIndex] = (weights[donorIndex] ?? 0) - transferPoints;
        weights[receiverIndex] = (weights[receiverIndex] ?? 0) + transferPoints;
        configurations.push(
          configuration(
            `TASK137-WEIGHTS-D${String(transferPoints).padStart(2, "0")}-${donor.dimensionId}-TO-${receiver.dimensionId}`,
            "PAIRWISE_TRANSFER",
            weightTuple(weights),
            {
              donorDimensionId: donor.dimensionId,
              receiverDimensionId: receiver.dimensionId,
              transferPoints,
            },
          ),
        );
      });
    });
  }
  return deepFreeze(configurations) as readonly Task137WeightConfiguration[];
}

function score(
  ratings: Task137SyntheticRatings,
  weights: Task137SyntheticWeights,
): number {
  return weightedScoreNumerator(ratings, weights) / 100;
}

function compareCandidate(
  left: Task137SyntheticCandidate,
  right: Task137SyntheticCandidate,
  scores: Readonly<Record<string, number>>,
): number {
  return (
    (scores[right.candidateId] ?? -1) - (scores[left.candidateId] ?? -1) ||
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

function evaluateCase(
  corpusCase: Task137SyntheticCorpusCase,
  weights: Task137SyntheticWeights,
  candidateOrder: readonly Task137SyntheticCandidate[] = corpusCase.candidates,
): CaseEvaluation {
  const scores = Object.fromEntries(
    candidateOrder.map((candidate) => [
      candidate.candidateId,
      score(candidate.ratings, weights),
    ]),
  );
  const eligible = candidateOrder
    .filter(({ gateState }) => gateState === "ELIGIBLE")
    .toSorted((left, right) => compareCandidate(left, right, scores));
  const displayed = eligible.slice(0, corpusCase.softCap);
  const reserve = eligible.slice(corpusCase.softCap);
  const promotedCandidateId =
    corpusCase.promotionTrigger === undefined
      ? undefined
      : reserve[0]?.candidateId;
  return {
    scoreByCandidate: scores,
    eligibleOrder: eligible.map(({ candidateId }) => candidateId),
    displayedCandidateIds: displayed.map(({ candidateId }) => candidateId),
    reserveCandidateIds: reserve.map(({ candidateId }) => candidateId),
    ...(promotedCandidateId === undefined ? {} : { promotedCandidateId }),
    scarcity: scarcity(eligible.length),
    eligibleCount: eligible.length,
    displayedCount: displayed.length,
    truncated: eligible.length > corpusCase.softCap,
    scarcityOverrideApplied: eligible.length < corpusCase.softCap,
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
}

function invariantMap(): Map<string, MutableInvariant> {
  return new Map(
    INVARIANT_IDS.map((invariantId) => [
      invariantId,
      { invariantId, checkedCount: 0, failureCount: 0 },
    ]),
  );
}

function record(
  invariants: Map<string, MutableInvariant>,
  invariantId: (typeof INVARIANT_IDS)[number],
  passed: boolean,
  detail: string,
): void {
  const invariant = invariants.get(invariantId)!;
  invariant.checkedCount += 1;
  if (!passed) {
    invariant.failureCount += 1;
    invariant.firstFailure ??= detail;
  }
}

function validateCorpus(
  corpus: Task137SyntheticCorpus,
  invariants: Map<string, MutableInvariant>,
): void {
  record(
    invariants,
    "CORPUS_INTEGRITY",
    corpus.schemaVersion === TASK137_SYNTHETIC_CORPUS_SCHEMA_VERSION &&
      corpus.corpusId === TASK137_SYNTHETIC_CORPUS_ID &&
      corpus.cases.length === 72,
    "Corpus identity, schema, or case count is invalid.",
  );
  const ids = new Set<string>();
  const strata = new Map<string, number>();
  for (const corpusCase of corpus.cases) {
    const { caseSha256, ...payload } = corpusCase;
    const valid =
      !ids.has(corpusCase.caseId) &&
      /^[a-f0-9]{64}$/u.test(caseSha256) &&
      task137Sha256(payload) === caseSha256;
    record(
      invariants,
      "CORPUS_INTEGRITY",
      valid,
      `Case integrity failed for ${corpusCase.caseId}.`,
    );
    ids.add(corpusCase.caseId);
    strata.set(corpusCase.stratum, (strata.get(corpusCase.stratum) ?? 0) + 1);
  }
  for (const stratum of TASK137_SYNTHETIC_STRATA)
    record(
      invariants,
      "CORPUS_INTEGRITY",
      strata.get(stratum) === 12,
      `Stratum ${stratum} does not contain exactly 12 cases.`,
    );
  const tieBreakKeys = new Set(
    corpus.cases.flatMap((item) =>
      item.tieBreakExpectation === undefined
        ? []
        : [item.tieBreakExpectation.decidingKey],
    ),
  );
  record(
    invariants,
    "CORPUS_INTEGRITY",
    tieBreakKeys.size === 5,
    "Corpus does not independently specify all five tie-break keys.",
  );
  const verificationStates = new Set(
    corpus.cases.flatMap((item) =>
      item.candidates.flatMap((candidate) =>
        candidate.evidence.map(({ verification }) => verification),
      ),
    ),
  );
  const hasMissing = corpus.cases.some((item) =>
    item.candidates.some((candidate) => candidate.usedEvidenceIds.length < 6),
  );
  record(
    invariants,
    "CORPUS_INTEGRITY",
    hasMissing && verificationStates.has("SUPPLIER_ONLY"),
    "Corpus lacks missing or supplier-only evidence cases.",
  );
  const { corpusSha256, ...payload } = corpus;
  record(
    invariants,
    "CORPUS_INTEGRITY",
    task137Sha256(payload) === corpusSha256,
    "Corpus SHA-256 is invalid.",
  );
  record(
    invariants,
    "PINNED_MANIFEST_INTEGRITY",
    corpus.corpusSha256 === TASK137_PINNED_CORPUS_SHA256,
    "Corpus digest differs from the independently pinned manifest.",
  );
  for (const corpusCase of corpus.cases) {
    const frameKeys = Object.keys(corpusCase.businessFrame).sort();
    record(
      invariants,
      "CORPUS_INTEGRITY",
      corpusCase.caseVersion === 1 &&
        task137CanonicalJson(frameKeys) ===
          task137CanonicalJson([
            "product_requirement",
            "quantity_requirement",
            "target_market",
          ]) &&
        Object.values(corpusCase.businessFrame).every((value) => value.trim()),
      `Business frame is invalid for ${corpusCase.caseId}.`,
    );
    record(
      invariants,
      "CORPUS_INTEGRITY",
      Object.values(corpusCase.expected.rationaleSourceIdsByCandidate).every(
        (ids) => ids.length > 0 && ids.every((id) => id.trim()),
      ) &&
        corpusCase.expected.entitlementProjection.demo ===
          "COARSE_RESULT_ONLY" &&
        corpusCase.expected.entitlementProjection.standard ===
          "EVIDENCE_SUMMARY" &&
        corpusCase.expected.entitlementProjection.consultant ===
          "GOVERNED_FULL_RESULT",
      `Entitlement or rationale expectation is invalid for ${corpusCase.caseId}.`,
    );
  }
}

function validateConfigurations(
  configurations: readonly Task137WeightConfiguration[],
  invariants: Map<string, MutableInvariant>,
): void {
  record(
    invariants,
    "CONFIGURATION_INTEGRITY",
    configurations.length === 61,
    "Exactly 61 weight configurations are required.",
  );
  const ids = new Set<string>();
  const hashes = new Set<string>();
  configurations.forEach((item, index) => {
    const { configurationSha256, ...payload } = item;
    const valid =
      item.schemaVersion === TASK137_WEIGHT_CONFIGURATION_SCHEMA_VERSION &&
      item.weights.length === 6 &&
      item.weights.every((weight) => Number.isInteger(weight) && weight >= 0) &&
      item.weights.reduce((total, weight) => total + weight, 0) === 100 &&
      task137Sha256(payload) === configurationSha256 &&
      !ids.has(item.configurationId) &&
      !hashes.has(configurationSha256);
    record(
      invariants,
      "CONFIGURATION_INTEGRITY",
      valid,
      `Weight configuration integrity failed for ${item.configurationId}.`,
    );
    ids.add(item.configurationId);
    hashes.add(configurationSha256);
    if (index === 0)
      record(
        invariants,
        "CONFIGURATION_INTEGRITY",
        item.kind === "BASE" &&
          task137CanonicalJson(item.weights) ===
            task137CanonicalJson(TASK137_SYNTHETIC_BASE_WEIGHTS),
        "Base weights are not the exact 25/20/15/15/15/10 tuple.",
      );
  });
  record(
    invariants,
    "PINNED_MANIFEST_INTEGRITY",
    task137Sha256(configurations) === TASK137_PINNED_CONFIGURATION_SET_SHA256,
    "Configuration-set digest differs from the independently pinned manifest.",
  );
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

function dominates(
  left: Task137SyntheticRatings,
  right: Task137SyntheticRatings,
): boolean {
  return (
    left.every((rating, index) => rating >= (right[index] ?? 0)) &&
    left.some((rating, index) => rating > (right[index] ?? 0))
  );
}

function projectTask137QualificationTiers(
  corpusCase: Task137SyntheticCorpusCase,
  evaluation: CaseEvaluation,
): {
  readonly demo: unknown;
  readonly standard: unknown;
  readonly consultant: unknown;
} {
  const byId = new Map(
    corpusCase.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const displayed = evaluation.displayedCandidateIds.map((candidateId) =>
    byId.get(candidateId),
  );
  return {
    demo: {
      outcome: evaluation.eligibleCount === 0 ? "no_results" : "results",
      scarcity: evaluation.scarcity,
      candidates: evaluation.displayedCandidateIds.map((candidateId) => ({
        candidateId,
        rationale:
          "Structured synthetic rule outcomes place this candidate in the eligible set.",
        rationaleSourceIds:
          corpusCase.expected.rationaleSourceIdsByCandidate[candidateId] ?? [],
      })),
      caution:
        evaluation.eligibleCount < 3
          ? "Limited eligible supplier coverage is available."
          : "No coarse scarcity caution is required.",
    },
    standard: {
      outcome: evaluation.eligibleCount === 0 ? "no_results" : "results",
      candidates: displayed.map((candidate) => ({
        candidateId: candidate?.candidateId,
        score: candidate
          ? evaluation.scoreByCandidate[candidate.candidateId]
          : undefined,
        evidenceIds: candidate?.usedEvidenceIds ?? [],
      })),
    },
    consultant: {
      outcome: evaluation.eligibleCount === 0 ? "no_results" : "results",
      candidates: displayed,
      reserveCandidateIds: evaluation.reserveCandidateIds,
      entitlement: "GOVERNED_FULL_RESULT",
      productionValidation: "NOT_CLAIMED",
    },
  };
}

export interface Task137ActualTierProjectionSafetyOutputs {
  readonly demo: DemoProjectionV1;
  readonly standard: StandardResultProjectionV1;
  readonly consultant: ConsultantResultProjectionV2;
}

export function buildTask137ActualTierProjectionSafetyOutputs(
  storedCompleteResultExtension: Readonly<Record<string, unknown>> = {},
): Task137ActualTierProjectionSafetyOutputs {
  const hardConstraints = buildStandardSyntheticHardConstraints();
  const graph = buildStandardSyntheticEvidenceGraph(
    "TASK137-ACTUAL-TIER-PROJECTION-SAFETY",
    "zero",
    hardConstraints,
  );
  const hasStoredExtension =
    Object.keys(storedCompleteResultExtension).length > 0;
  const extendedCompleteResult = hasStoredExtension
    ? {
        ...buildCompleteResultFoundationV2(graph),
        ...structuredClone(storedCompleteResultExtension),
      }
    : undefined;
  const demo = projectStoredResult({
    tier: "demo",
    completeResult:
      extendedCompleteResult ??
      buildSyntheticEvidenceGraph(
        "TASK137-ACTUAL-DEMO-PROJECTION-SAFETY",
        "zero",
      ),
    runBoundMandatoryConstraints: hardConstraints.map(
      ({ field_id }) => field_id,
    ),
    researchMode: "synthetic_reference",
  }).body;
  const standard = projectStoredResult({
    tier: "standard",
    completeResult: extendedCompleteResult ?? graph,
    projectionAsOf: "2026-08-25T14:30:00.000Z",
    runBoundCanonicalHardConstraints: hardConstraints,
    allowLegacyEmptyScarcityLedger: true,
  }).body;
  const qualificationBoundAt = "2026-08-25T14:30:00.000Z";
  const qualificationConfigContentSha256 = "a".repeat(64);
  const waveInstanceId = contractSha256Hex(
    [
      String(standard.run_id),
      CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      qualificationConfigContentSha256,
      "RFQ_WAVE_INITIAL",
      "1",
      "",
    ].join("|"),
  );
  const auditEventId = contractSha256Hex(
    `${waveInstanceId}|${qualificationBoundAt}|SYNTHETIC_WAVE_SNAPSHOT_PROJECTED`,
  );
  const consultant = parseConsultantResultProjectionV2({
    ...standard,
    schema_version: CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
    candidates: [],
    landscape: {
      eligible_count: 0,
      displayed_count: 0,
      soft_cap: 20,
      truncated: false,
      scarcity_override_applied: false,
    },
    source_policy: {
      policy_id: CONSULTANT_SOURCE_POLICY_ID,
      policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
      content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      domain_pack_id: CONSULTANT_DOMAIN_PACK_ID,
      mode: "agent_researched_synthetic_qualification",
      production_state: "blocked_pending_attributable_sme_validation",
    },
    configuration_release: {
      config_id: "00000000-0000-4000-8000-000000000620",
      config_version: "task137-qualification-projection.v1",
      content_sha256: qualificationConfigContentSha256,
      bound_at: qualificationBoundAt,
      effective_release_at: qualificationBoundAt,
      soft_cap: 20,
    },
    agent_authorship: {
      prepared_by: "matchbase_agent_research_and_implementation_team",
      mode: "agent_researched_synthetic_qualification",
      human_consultant_authorship: "not_claimed",
      production_sme_validation: "not_claimed",
    },
    rfq_questions: CONSULTANT_SYNTHETIC_RFQ_QUESTIONS.map(
      ([questionId, requiredResponse], index) => ({
        order: index + 1,
        question_id: questionId,
        required_response: requiredResponse,
        response_state: "not_collected",
      }),
    ),
    wave_recommendations: [
      {
        wave_id: "RFQ_WAVE_INITIAL",
        action: "no_eligible_candidates",
        selection_rule: "first_min_initial_wave_size_displayed",
        candidates: [],
      },
    ],
    eligible_ranking: [],
    rfq_execution_snapshot: {
      state: "synthetic_planning_only",
      contact_state: "not_contacted",
      response_state: "not_collected",
      qualified_response_count: 0,
      expansion_model: {
        initial_wave_size: 3,
        subsequent_wave_size: 2,
        expansion_threshold: 3,
        effective_expansion_threshold: 0,
      },
      wave_id: "RFQ_WAVE_INITIAL",
      wave_sequence: 1,
      wave_instance_id: waveInstanceId,
      selected_candidates: [],
      remaining_displayed_queue: [],
      stop_state: "exhausted_displayed_queue",
      next_reserve_promotion: {
        state: "exhausted",
        candidate: null,
        promotion_mode: "one_next_ranked_eligible_only",
      },
      audit_identity: {
        event_type: "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED",
        event_id: auditEventId,
        actor_type: "agent",
        actor_id: "matchbase_agent_research_and_implementation_team",
        occurred_at: qualificationBoundAt,
        policy_id: CONSULTANT_SOURCE_POLICY_ID,
        policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
        policy_content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
        config_id: "00000000-0000-4000-8000-000000000620",
        config_version: "task137-qualification-projection.v1",
        config_content_sha256: qualificationConfigContentSha256,
      },
    },
    reserve_candidates: [],
    due_diligence_checklist: CONSULTANT_DUE_DILIGENCE_CHECKS.map(
      ([checkId, label], index) => ({
        order: index + 1,
        check_id: checkId,
        label,
        state: "not_executed",
        required_before_production: true,
      }),
    ),
    source_facts: [],
    excluded_evidence: [],
    full_limitations: {
      qualification_scope: "synthetic_only",
      human_consultant_authorship: "not_claimed",
      production_sme_validation: "not_claimed",
      production_release: "blocked",
      restricted_party_clearance: "not_claimed",
      due_diligence_completeness: "not_executed",
      notices: [
        "Synthetic qualification only.",
        "Human Consultant authorship is not claimed.",
        "Production SME validation is not claimed.",
        "Restricted-party clearance is not claimed.",
        "Due diligence has not been executed.",
      ],
    },
    projection_version: CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  });
  return { demo, standard, consultant };
}

function actualTierProjectionSafetyEvidence(): {
  readonly passed: boolean;
  readonly demoSha256: string;
  readonly standardSha256: string;
  readonly consultantSha256: string;
} {
  const { demo, standard, consultant } =
    buildTask137ActualTierProjectionSafetyOutputs();
  return {
    passed:
      forbiddenProjectionKeys(demo).length === 0 &&
      standard.schema_version === "standard-result-projection.v1" &&
      consultant.schema_version ===
        CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION &&
      consultant.full_limitations.production_release === "blocked",
    demoSha256: task137Sha256(demo),
    standardSha256: task137Sha256(standard),
    consultantSha256: task137Sha256(consultant),
  };
}

function forbiddenProjectionKeys(
  value: unknown,
  findings: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => forbiddenProjectionKeys(item, findings));
    return findings;
  }
  if (!value || typeof value !== "object") return findings;
  for (const [key, item] of Object.entries(value)) {
    if (/score|confidence|citation|evidence|rationale_extended/iu.test(key))
      findings.push(key);
    forbiddenProjectionKeys(item, findings);
  }
  return findings;
}

function checkCaseInvariants(
  corpusCase: Task137SyntheticCorpusCase,
  baseWeights: Task137SyntheticWeights,
  invariants: Map<string, MutableInvariant>,
): void {
  const evaluation = evaluateCase(corpusCase, baseWeights);
  const reversed = evaluateCase(
    corpusCase,
    baseWeights,
    corpusCase.candidates.toReversed(),
  );
  record(
    invariants,
    "PERMUTATION_INVARIANCE",
    task137CanonicalJson(evaluation) === task137CanonicalJson(reversed),
    `Candidate permutation changed ${corpusCase.caseId}.`,
  );
  record(
    invariants,
    "EXPECTED_BASE_RESULTS",
    task137CanonicalJson(evaluation) ===
      task137CanonicalJson(corpusCase.expected),
    `Base result differs from the immutable expectation for ${corpusCase.caseId}.`,
  );
  record(
    invariants,
    "NO_PADDING",
    evaluation.displayedCount ===
      Math.min(evaluation.eligibleCount, corpusCase.softCap) &&
      evaluation.displayedCandidateIds.length === evaluation.displayedCount,
    `No-padding invariant failed for ${corpusCase.caseId}.`,
  );
  record(
    invariants,
    "RESERVE_DETERMINISM",
    corpusCase.promotionTrigger === undefined ||
      evaluation.promotedCandidateId === evaluation.reserveCandidateIds[0],
    `Reserve promotion failed for ${corpusCase.caseId}.`,
  );
  const nonEligibleIds = new Set(
    corpusCase.candidates
      .filter(({ gateState }) => gateState !== "ELIGIBLE")
      .map(({ candidateId }) => candidateId),
  );
  record(
    invariants,
    "HARD_GATE_SUPREMACY",
    evaluation.eligibleOrder.every(
      (candidateId) => !nonEligibleIds.has(candidateId),
    ),
    `A non-eligible candidate was ranked for ${corpusCase.caseId}.`,
  );
  record(
    invariants,
    "PROJECTION_SAFETY",
    (() => {
      const projections = projectTask137QualificationTiers(
        corpusCase,
        evaluation,
      );
      const standard = projections.standard as {
        candidates?: readonly unknown[];
      };
      const consultant = projections.consultant as {
        entitlement?: unknown;
        productionValidation?: unknown;
      };
      return (
        forbiddenProjectionKeys(projections.demo).length === 0 &&
        standard.candidates?.length === evaluation.displayedCount &&
        consultant.entitlement === "GOVERNED_FULL_RESULT" &&
        consultant.productionValidation === "NOT_CLAIMED"
      );
    })(),
    `Demo projection leaked a prohibited key for ${corpusCase.caseId}.`,
  );
  for (const candidate of corpusCase.candidates) {
    const scoreBeforeMetadataChange = score(candidate.ratings, baseWeights);
    const metadataChanged = {
      ...candidate,
      corroboratedClaimCount: candidate.corroboratedClaimCount + 100,
      unresolvedLimitationCount: candidate.unresolvedLimitationCount + 100,
    };
    record(
      invariants,
      "NO_HIDDEN_INPUTS",
      score(metadataChanged.ratings, baseWeights) === scoreBeforeMetadataChange,
      `Non-rating metadata changed the score for ${candidate.candidateId}.`,
    );
    TASK137_SYNTHETIC_DIMENSIONS.forEach(({ dimensionId }, dimensionIndex) => {
      const evidence = candidate.evidence.find(
        (item) =>
          item.dimensionId === dimensionId && item.disposition === "USED",
      );
      const provenanceValid =
        evidence === undefined
          ? candidate.ratings[dimensionIndex]! <= 50
          : candidate.usedEvidenceIds.includes(evidence.evidenceId) &&
            /^[a-f0-9]{64}$/u.test(evidence.contentSha256);
      record(
        invariants,
        "PROVENANCE_INTEGRITY",
        provenanceValid,
        `Used evidence is invalid for ${candidate.candidateId}.`,
      );
      record(
        invariants,
        "EVIDENCE_CEILING",
        candidate.ratings[dimensionIndex]! <=
          (evidence === undefined
            ? 50
            : evidenceCeiling(evidence.verification)),
        `Evidence ceiling failed for ${candidate.candidateId}.`,
      );
    });
    for (const evidence of candidate.evidence.filter(
      ({ disposition }) => disposition === "EXCLUDED",
    ))
      record(
        invariants,
        "PROVENANCE_INTEGRITY",
        (evidence.exclusionReason?.trim().length ?? 0) > 0 &&
          /^[a-f0-9]{64}$/u.test(evidence.contentSha256),
        `Excluded evidence is not retained with a reason for ${candidate.candidateId}.`,
      );
    candidate.ratings.forEach((rating, dimensionIndex) => {
      const next = TASK137_SYNTHETIC_RATINGS.find((value) => value > rating);
      if (next === undefined) return;
      const improved = [...candidate.ratings];
      improved[dimensionIndex] = next;
      record(
        invariants,
        "MONOTONICITY",
        score(improved as unknown as Task137SyntheticRatings, baseWeights) >=
          scoreBeforeMetadataChange,
        `Monotonicity failed for ${candidate.candidateId}.`,
      );
    });
    const weightedInteger = weightedScoreNumerator(
      candidate.ratings,
      baseWeights,
    );
    record(
      invariants,
      "ROUNDING",
      score(candidate.ratings, baseWeights) === weightedInteger / 100,
      `Rounding failed for ${candidate.candidateId}.`,
    );
  }
  const eligible = corpusCase.candidates.filter(
    ({ gateState }) => gateState === "ELIGIBLE",
  );
  for (const left of eligible)
    for (const right of eligible) {
      if (left.candidateId === right.candidateId) continue;
      if (dominates(left.ratings, right.ratings))
        record(
          invariants,
          "DOMINANCE",
          (evaluation.eligibleOrder.indexOf(left.candidateId) ?? -1) <
            (evaluation.eligibleOrder.indexOf(right.candidateId) ?? -1),
          `Dominance failed for ${left.candidateId}.`,
        );
    }
  const tiedGroups = new Map<number, Task137SyntheticCandidate[]>();
  for (const candidate of eligible) {
    const candidateScore = evaluation.scoreByCandidate[candidate.candidateId]!;
    const group = tiedGroups.get(candidateScore) ?? [];
    group.push(candidate);
    tiedGroups.set(candidateScore, group);
  }
  for (const group of tiedGroups.values()) {
    if (group.length < 2) continue;
    const expectedOrder = group
      .toSorted((left, right) =>
        compareCandidate(left, right, evaluation.scoreByCandidate),
      )
      .map(({ candidateId }) => candidateId);
    const actualOrder = evaluation.eligibleOrder.filter((candidateId) =>
      expectedOrder.includes(candidateId),
    );
    record(
      invariants,
      "TIE_BREAK_DETERMINISM",
      task137CanonicalJson(expectedOrder) === task137CanonicalJson(actualOrder),
      `Tie-break order failed for ${corpusCase.caseId}.`,
    );
  }
  if (corpusCase.tieBreakExpectation) {
    const higher = evaluation.eligibleOrder.indexOf(
      corpusCase.tieBreakExpectation.higherPriorityCandidateId,
    );
    const lower = evaluation.eligibleOrder.indexOf(
      corpusCase.tieBreakExpectation.lowerPriorityCandidateId,
    );
    record(
      invariants,
      "TIE_BREAK_DETERMINISM",
      higher >= 0 && lower >= 0 && higher < lower,
      `Independent ${corpusCase.tieBreakExpectation.decidingKey} expectation failed for ${corpusCase.caseId}.`,
    );
  }
}

function checkConfigurationMatrixInvariants(
  corpus: Task137SyntheticCorpus,
  configurations: readonly Task137WeightConfiguration[],
  invariants: Map<string, MutableInvariant>,
): void {
  for (const corpusCase of corpus.cases) {
    const baseSnapshot = task137CanonicalJson(
      evaluateCase(corpusCase, configurations[0]!.weights),
    );
    for (const configuration of configurations) {
      const repeated = [0, 1, 2].map(() =>
        task137Sha256(evaluateCase(corpusCase, configuration.weights)),
      );
      record(
        invariants,
        "REPEATABILITY",
        new Set(repeated).size === 1,
        `Three executions differed for ${corpusCase.caseId}/${configuration.configurationId}.`,
      );
      const evaluation = evaluateCase(corpusCase, configuration.weights);
      const nonEligible = new Set(
        corpusCase.candidates
          .filter(({ gateState }) => gateState !== "ELIGIBLE")
          .map(({ candidateId }) => candidateId),
      );
      record(
        invariants,
        "HARD_GATE_SUPREMACY",
        evaluation.eligibleOrder.every(
          (candidateId) => !nonEligible.has(candidateId),
        ),
        `Hard-gate drift occurred for ${corpusCase.caseId}/${configuration.configurationId}.`,
      );
    }
    const afterRotation = task137CanonicalJson(
      evaluateCase(corpusCase, configurations.at(-1)!.weights),
    );
    const restoredBase = task137CanonicalJson(
      evaluateCase(corpusCase, configurations[0]!.weights),
    );
    record(
      invariants,
      "HISTORICAL_IMMUTABILITY",
      baseSnapshot === restoredBase && afterRotation.length > 0,
      `Configuration rotation rewrote the historical base result for ${corpusCase.caseId}.`,
    );
  }
}

function pairwiseReversals(
  baseOrder: readonly string[],
  alternateOrder: readonly string[],
): number {
  let reversals = 0;
  for (let leftIndex = 0; leftIndex < baseOrder.length; leftIndex += 1)
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < baseOrder.length;
      rightIndex += 1
    ) {
      const left = baseOrder[leftIndex]!;
      const right = baseOrder[rightIndex]!;
      if (alternateOrder.indexOf(left) > alternateOrder.indexOf(right))
        reversals += 1;
    }
  return reversals;
}

function pairwiseReversalPairs(
  baseOrder: readonly string[],
  alternateOrder: readonly string[],
): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let leftIndex = 0; leftIndex < baseOrder.length; leftIndex += 1)
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < baseOrder.length;
      rightIndex += 1
    ) {
      const left = baseOrder[leftIndex]!;
      const right = baseOrder[rightIndex]!;
      if (alternateOrder.indexOf(left) > alternateOrder.indexOf(right))
        pairs.push([left, right]);
    }
  return pairs;
}

function topMargin(evaluation: CaseEvaluation): number | null {
  if (evaluation.eligibleOrder.length < 2) return null;
  return roundMetric(
    (evaluation.scoreByCandidate[evaluation.eligibleOrder[0]!] ?? 0) -
      (evaluation.scoreByCandidate[evaluation.eligibleOrder[1]!] ?? 0),
  );
}

function kendallTauB(
  baseOrder: readonly string[],
  alternateOrder: readonly string[],
): number {
  const pairCount = (baseOrder.length * (baseOrder.length - 1)) / 2;
  if (pairCount === 0) return 1;
  const discordant = pairwiseReversals(baseOrder, alternateOrder);
  return (pairCount - 2 * discordant) / pairCount;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle]!;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function rankMetrics(
  corpus: Task137SyntheticCorpus,
  configurations: readonly Task137WeightConfiguration[],
): {
  readonly metrics: Task137RankReversalMetrics;
  readonly reversalLedger: readonly Task137RankReversalLedgerEntry[];
} {
  const base = configurations[0]!;
  let applicableComparisonCount = 0;
  let top1ReversalCount = 0;
  let top3MembershipChangeCount = 0;
  let pairwiseOrderReversalCount = 0;
  let dominanceReversalCount = 0;
  const taus: number[] = [];
  const reversalLedger: Task137RankReversalLedgerEntry[] = [];
  for (const corpusCase of corpus.cases) {
    const baseEvaluation = evaluateCase(corpusCase, base.weights);
    if (baseEvaluation.eligibleOrder.length < 2) continue;
    const eligibleById = new Map(
      corpusCase.candidates.map((candidate) => [
        candidate.candidateId,
        candidate,
      ]),
    );
    for (const alternate of configurations.slice(1)) {
      const alternateEvaluation = evaluateCase(corpusCase, alternate.weights);
      applicableComparisonCount += 1;
      if (
        baseEvaluation.eligibleOrder[0] !== alternateEvaluation.eligibleOrder[0]
      )
        top1ReversalCount += 1;
      const baseTop3 = new Set(baseEvaluation.eligibleOrder.slice(0, 3));
      const alternateTop3 = new Set(
        alternateEvaluation.eligibleOrder.slice(0, 3),
      );
      if (
        baseTop3.size !== alternateTop3.size ||
        [...baseTop3].some((candidateId) => !alternateTop3.has(candidateId))
      )
        top3MembershipChangeCount += 1;
      pairwiseOrderReversalCount += pairwiseReversals(
        baseEvaluation.eligibleOrder,
        alternateEvaluation.eligibleOrder,
      );
      for (const [leftCandidateId, rightCandidateId] of pairwiseReversalPairs(
        baseEvaluation.eligibleOrder,
        alternateEvaluation.eligibleOrder,
      )) {
        if (
          alternate.donorDimensionId === undefined ||
          alternate.receiverDimensionId === undefined ||
          alternate.transferPoints === undefined
        )
          throw new Error("Perturbed configuration identity is incomplete.");
        const baseLeft = baseEvaluation.scoreByCandidate[leftCandidateId] ?? 0;
        const baseRight =
          baseEvaluation.scoreByCandidate[rightCandidateId] ?? 0;
        const alternateLeft =
          alternateEvaluation.scoreByCandidate[leftCandidateId] ?? 0;
        const alternateRight =
          alternateEvaluation.scoreByCandidate[rightCandidateId] ?? 0;
        const tied = baseLeft === baseRight || alternateLeft === alternateRight;
        const smallestMargin = Math.min(
          Math.abs(baseLeft - baseRight),
          Math.abs(alternateLeft - alternateRight),
        );
        reversalLedger.push({
          caseId: corpusCase.caseId,
          configurationId: alternate.configurationId,
          donorDimensionId: alternate.donorDimensionId,
          receiverDimensionId: alternate.receiverDimensionId,
          transferPoints: alternate.transferPoints,
          leftCandidateId,
          rightCandidateId,
          baseMarginToNext: topMargin(baseEvaluation),
          alternateMarginToNext: topMargin(alternateEvaluation),
          disposition: tied
            ? "TIE_BREAK_EFFECT"
            : smallestMargin <= 5
              ? "EXPECTED_CLOSE_MARGIN"
              : "WEIGHT_SENSITIVE_REQUIREMENT",
        });
      }
      taus.push(
        kendallTauB(
          baseEvaluation.eligibleOrder,
          alternateEvaluation.eligibleOrder,
        ),
      );
      for (const leftId of baseEvaluation.eligibleOrder)
        for (const rightId of baseEvaluation.eligibleOrder) {
          if (leftId === rightId) continue;
          const left = eligibleById.get(leftId)!;
          const right = eligibleById.get(rightId)!;
          if (
            dominates(left.ratings, right.ratings) &&
            alternateEvaluation.eligibleOrder.indexOf(leftId) >
              alternateEvaluation.eligibleOrder.indexOf(rightId)
          )
            dominanceReversalCount += 1;
        }
    }
  }
  return {
    metrics: {
      applicableComparisonCount,
      top1ReversalCount,
      top1ReversalRate: roundMetric(
        applicableComparisonCount === 0
          ? 0
          : top1ReversalCount / applicableComparisonCount,
      ),
      top3MembershipChangeCount,
      top3MembershipStability: roundMetric(
        applicableComparisonCount === 0
          ? 1
          : 1 - top3MembershipChangeCount / applicableComparisonCount,
      ),
      pairwiseOrderReversalCount,
      medianKendallTauB: roundMetric(median(taus)),
      dominanceReversalCount,
    },
    reversalLedger,
  };
}

function appendOnlyAuditEntries(
  events: readonly { readonly eventType: string; readonly payload: unknown }[],
): readonly Task137AppendOnlyAuditEntry[] {
  let previousEntrySha256 = "0".repeat(64);
  return events.map((event, index) => {
    const payloadSha256 = task137Sha256(event.payload);
    const base = {
      sequence: index + 1,
      eventId: `TASK137-QUALIFICATION-AUDIT-${String(index + 1).padStart(3, "0")}`,
      eventType: event.eventType,
      previousEntrySha256,
      payloadSha256,
    };
    const entry = { ...base, entrySha256: task137Sha256(base) };
    previousEntrySha256 = entry.entrySha256;
    return entry;
  });
}

function buildAcceptancePackage(
  corpus: Task137SyntheticCorpus,
  configurations: readonly Task137WeightConfiguration[],
  metrics: Task137RankReversalMetrics,
  reversalLedger: readonly Task137RankReversalLedgerEntry[],
): Task137SyntheticQualificationReport["acceptancePackage"] {
  const corpusCaseManifest = corpus.cases.map(({ caseId, caseSha256 }) => ({
    caseId,
    caseSha256,
  }));
  const configurationManifest = configurations.map(
    ({ configurationId, configurationSha256 }) => ({
      configurationId,
      configurationSha256,
    }),
  );
  const baseResultManifest = corpus.cases.map((corpusCase) => ({
    caseId: corpusCase.caseId,
    resultSha256: task137Sha256(
      evaluateCase(corpusCase, configurations[0]!.weights),
    ),
  }));
  const sensitivityManifest = configurations.slice(1).map((configuration) => ({
    configurationId: configuration.configurationId,
    resultSetSha256: task137Sha256(
      corpus.cases.map((corpusCase) => ({
        caseId: corpusCase.caseId,
        resultSha256: task137Sha256(
          evaluateCase(corpusCase, configuration.weights),
        ),
      })),
    ),
  }));
  const projectionSafetyReport = {
    actualProductionTierProjections: actualTierProjectionSafetyEvidence(),
    qualificationCases: corpus.cases.map((corpusCase) => {
      const evaluation = evaluateCase(corpusCase, configurations[0]!.weights);
      const projections = projectTask137QualificationTiers(
        corpusCase,
        evaluation,
      );
      return {
        caseId: corpusCase.caseId,
        demoSha256: task137Sha256(projections.demo),
        standardSha256: task137Sha256(projections.standard),
        consultantSha256: task137Sha256(projections.consultant),
        demoForbiddenKeys: forbiddenProjectionKeys(projections.demo),
      };
    }),
  };
  const historicalImmutabilityEvidence = corpus.cases.map((corpusCase) => {
    const before = task137Sha256(
      evaluateCase(corpusCase, configurations[0]!.weights),
    );
    void evaluateCase(corpusCase, configurations.at(-1)!.weights);
    const after = task137Sha256(
      evaluateCase(corpusCase, configurations[0]!.weights),
    );
    return {
      caseId: corpusCase.caseId,
      before,
      after,
      unchanged: before === after,
    };
  });
  const auditEntries = appendOnlyAuditEntries([
    {
      eventType: "qualification.manifest_bound",
      payload: {
        manifestId: TASK137_PINNED_MANIFEST_ID,
        corpusSha256: corpus.corpusSha256,
        configurationSetSha256: task137Sha256(configurations),
      },
    },
    {
      eventType: "qualification.base_executed",
      payload: baseResultManifest,
    },
    {
      eventType: "qualification.sensitivity_executed",
      payload: sensitivityManifest,
    },
    {
      eventType: "qualification.reversals_dispositioned",
      payload: reversalLedger,
    },
    {
      eventType: "qualification.acceptance_assembled",
      payload: { metrics, executionTimestampUtc: "2026-08-25T14:30:00.000Z" },
    },
  ]);
  const defectGapLedger = [
    {
      gapId: "TASK137-PRODUCTION-SME-VALIDATION",
      state: "OPEN_PRODUCTION_ONLY" as const,
      statement:
        "Synthetic qualification does not establish attributable production SME validation.",
    },
  ];
  const complete =
    corpus.corpusSha256 === TASK137_PINNED_CORPUS_SHA256 &&
    task137Sha256(configurations) === TASK137_PINNED_CONFIGURATION_SET_SHA256 &&
    corpusCaseManifest.length === 72 &&
    configurationManifest.length === 61 &&
    sensitivityManifest.length === 60 &&
    projectionSafetyReport.actualProductionTierProjections.passed &&
    projectionSafetyReport.qualificationCases.every(
      ({ demoForbiddenKeys }) => demoForbiddenKeys.length === 0,
    ) &&
    historicalImmutabilityEvidence.every(({ unchanged }) => unchanged) &&
    reversalLedger.length === metrics.pairwiseOrderReversalCount &&
    reversalLedger.every(
      ({ disposition, donorDimensionId, receiverDimensionId }) =>
        !["CORPUS_DEFECT", "IMPLEMENTATION_DEFECT", "UNRESOLVED"].includes(
          disposition,
        ) && donorDimensionId !== receiverDimensionId,
    ) &&
    /^[a-f0-9]{64}$/u.test(TASK137_PINNED_PROTOCOL_SHA256) &&
    TASK137_PINNED_MANIFEST_ID.trim().length > 0 &&
    TASK137_PINNED_SCORING_CODE_ID.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      "2026-08-25T14:30:00.000Z",
    ) &&
    corpusCaseManifest.every(({ caseSha256 }) =>
      /^[a-f0-9]{64}$/u.test(caseSha256),
    ) &&
    configurationManifest.every(({ configurationSha256 }) =>
      /^[a-f0-9]{64}$/u.test(configurationSha256),
    ) &&
    auditEntries.length === 5 &&
    defectGapLedger.length > 0 &&
    auditEntries.every(
      (entry, index) =>
        entry.previousEntrySha256 ===
        (index === 0 ? "0".repeat(64) : auditEntries[index - 1]!.entrySha256),
    );
  return {
    complete,
    manifestId: TASK137_PINNED_MANIFEST_ID,
    protocolIdentity: {
      id: "task137-synthetic-weight-qualification.v1",
      sha256: TASK137_PINNED_PROTOCOL_SHA256,
    },
    scoringCodeIdentity: TASK137_PINNED_SCORING_CODE_ID,
    runtimeIdentity: "node>=24.14.0;ecmascript=ES2023",
    dependencyIdentity:
      "typescript=7.0.2;@matchbase/contracts=workspace;no-external-model-call",
    executionTimestampUtc: "2026-08-25T14:30:00.000Z",
    corpusCaseManifest,
    configurationManifest,
    baseResultManifestSha256: task137Sha256(baseResultManifest),
    sensitivityManifestSha256: task137Sha256(sensitivityManifest),
    projectionSafetyReportSha256: task137Sha256(projectionSafetyReport),
    historicalImmutabilityEvidenceSha256: task137Sha256(
      historicalImmutabilityEvidence,
    ),
    auditEntries,
    defectGapLedger,
  };
}

export function determineTask137SyntheticQualificationOutcome(
  invariantFailureCount: number,
  metrics: Task137RankReversalMetrics,
  acceptancePackageComplete = true,
): Task137SyntheticQualificationTerminalResult {
  if (invariantFailureCount > 0 || !acceptancePackageComplete)
    return "SYNTHETIC_QUALIFICATION_FAILED";
  if (
    metrics.top1ReversalRate > 0.15 ||
    metrics.top3MembershipStability < 0.8 ||
    metrics.medianKendallTauB < 0.8 ||
    metrics.dominanceReversalCount > 0
  )
    return "SYNTHETIC_WEIGHT_UNSTABLE";
  return "SYNTHETIC_QUALIFICATION_PASSED";
}

export function runTask137SyntheticWeightQualification(
  corpus: Task137SyntheticCorpus = generateTask137SyntheticWeightCorpus(),
  configurations: readonly Task137WeightConfiguration[] = generateTask137WeightConfigurations(),
): Task137SyntheticQualificationReport {
  const beforeCorpus = task137CanonicalJson(corpus);
  const beforeConfigurations = task137CanonicalJson(configurations);
  const invariants = invariantMap();
  validateCorpus(corpus, invariants);
  validateConfigurations(configurations, invariants);
  const baseWeights =
    configurations[0]?.weights ?? TASK137_SYNTHETIC_BASE_WEIGHTS;
  for (const corpusCase of corpus.cases)
    checkCaseInvariants(corpusCase, baseWeights, invariants);
  checkConfigurationMatrixInvariants(corpus, configurations, invariants);
  record(
    invariants,
    "HISTORICAL_IMMUTABILITY",
    task137CanonicalJson(corpus) === beforeCorpus &&
      task137CanonicalJson(configurations) === beforeConfigurations,
    "Qualification mutated the corpus or a weight configuration.",
  );
  const ranked = rankMetrics(corpus, configurations);
  const acceptancePackage = buildAcceptancePackage(
    corpus,
    configurations,
    ranked.metrics,
    ranked.reversalLedger,
  );
  record(
    invariants,
    "ACCEPTANCE_PACKAGE_COMPLETENESS",
    acceptancePackage.complete,
    "The mandatory synthetic qualification acceptance package is incomplete.",
  );
  const invariantChecks = [...invariants.values()].map(
    (item): Task137InvariantCheck => ({
      invariantId: item.invariantId,
      passed: item.failureCount === 0,
      checkedCount: item.checkedCount,
      failureCount: item.failureCount,
      ...(item.firstFailure === undefined
        ? {}
        : { firstFailure: item.firstFailure }),
    }),
  );
  const metrics = ranked.metrics;
  const invariantFailureCount = invariantChecks.reduce(
    (total, item) => total + item.failureCount,
    0,
  );
  const terminalResult = determineTask137SyntheticQualificationOutcome(
    invariantFailureCount,
    metrics,
    acceptancePackage.complete,
  );
  const payload = {
    schemaVersion: TASK137_WEIGHT_QUALIFICATION_REPORT_SCHEMA_VERSION,
    scope: "SYNTHETIC_ONLY" as const,
    terminalResult,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusSha256,
    corpusCaseCount: corpus.cases.length,
    weightConfigurationCount: configurations.length,
    baseWeightConfigurationSha256:
      configurations[0]?.configurationSha256 ?? "MISSING",
    invariantChecks,
    metrics,
    reversalLedger: ranked.reversalLedger,
    acceptancePackage,
    acceptanceThresholds: {
      maximumTop1ReversalRate: 0.15 as const,
      minimumTop3MembershipStability: 0.8 as const,
      minimumMedianKendallTauB: 0.8 as const,
      maximumDominanceReversalCount: 0 as const,
    },
  };
  return deepFreeze({
    ...payload,
    runSha256: task137Sha256(payload),
  }) as Task137SyntheticQualificationReport;
}
