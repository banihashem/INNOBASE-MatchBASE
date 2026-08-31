import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  assertStandardPiiReleaseSafe,
  sanitizeStandardEvidenceGraphForRelease,
  scoreStandardCandidate,
  standardEvidenceReadStatuses,
} from "@matchbase/ai-evidence/standard";
import {
  projectStoredResult,
  standardEvidenceGraphFromCompleteResultFoundationV2,
  standardEvidenceGraphFromStoredCompleteResult,
} from "@matchbase/ai-evidence";
import type {
  ConsultantLandscapeV1,
  ConsultantExcludedEvidenceV2,
  ConsultantRunHistoryV1,
  ConsultantResultProjectionV1,
  ConsultantResultProjectionV2,
  ConsultantSourceFactV2,
  DemoProjectionV1,
  CompleteResultFoundationV2,
  EvidenceGraphV1,
  StandardCandidateProjectionV1,
  StandardEvidenceGraphV1,
  StandardEvidenceItemV1,
  StandardHardConstraintV1,
  StandardResultProjectionV1,
  StandardVerificationStatus,
  StructuredStandardRequestV1,
} from "@matchbase/contracts";
import {
  CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_VERSION,
  CONSULTANT_DOMAIN_PACK_ID,
  CONSULTANT_DUE_DILIGENCE_CHECKS,
  CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  CONSULTANT_SOURCE_POLICY_ID,
  CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
  CONSULTANT_SOURCE_POLICY_VERSION,
  CONSULTANT_SYNTHETIC_RFQ_QUESTIONS,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
} from "@matchbase/contracts";
import {
  appendAuditEvent,
  inTransaction,
  readConsultantProjectionPolicy,
  type ConnectionPool,
  type TransactionClient,
} from "@matchbase/data";
import { assertConsultantWorkspaceAuthorized } from "./consultant-authorization.js";
import {
  guardFreshRunOutputRead,
  outputRestrictedFault,
} from "./result-output-guard.js";
import {
  assertStoredCompleteResultIntegrity,
  standardDisclosureProjectionRegistryRelease,
  standardReleasedFieldPaths,
} from "./standard-workspace.js";
import { ApplicationFault, type RequestContext } from "./types.js";

export function resolveConsultantLandscape(
  eligibleCount: number,
  softCap: number,
): ConsultantLandscapeV1 {
  if (!Number.isSafeInteger(eligibleCount) || eligibleCount < 0)
    throw new Error(
      "Consultant eligible count must be a non-negative integer.",
    );
  if (!Number.isSafeInteger(softCap) || softCap < 3)
    throw new Error(
      "Consultant result soft cap must be an integer of at least 3.",
    );
  const displayedCount = Math.min(eligibleCount, softCap);
  const truncated = eligibleCount > softCap;
  return {
    eligible_count: eligibleCount,
    displayed_count: displayedCount,
    soft_cap: softCap,
    truncated,
    scarcity_override_applied: eligibleCount === 1 || eligibleCount === 2,
    ...(truncated
      ? {
          truncation_notice: `The eligible landscape was truncated at the configured display cap of ${softCap}.`,
        }
      : {}),
  };
}

export type ConsultantResultRead =
  | {
      readonly projectionTier: "demo";
      readonly body: DemoProjectionV1;
    }
  | {
      readonly projectionTier: "standard";
      readonly body: StandardResultProjectionV1;
    }
  | {
      readonly projectionTier: "consultant";
      readonly body:
        ConsultantResultProjectionV1 | ConsultantResultProjectionV2;
    };

function statusPriority(status: StandardVerificationStatus): number {
  return {
    unknown: 6,
    conflicting: 5,
    stale: 4,
    inferred: 3,
    claimed: 2,
    externally_verified: 1,
  }[status];
}

function projectedStatus(
  stored: StandardVerificationStatus,
  statuses: readonly StandardVerificationStatus[],
): StandardVerificationStatus {
  return [stored, ...statuses].sort(
    (left, right) => statusPriority(right) - statusPriority(left),
  )[0]!;
}

function projectCitation(
  evidence: StandardEvidenceItemV1,
  status: StandardVerificationStatus,
): StandardCandidateProjectionV1["citations"][number] {
  return {
    evidence_id: evidence.evidence_id,
    ...("exact_url" in evidence
      ? { exact_url: evidence.exact_url }
      : { fixture_identity: evidence.fixture_identity }),
    title: evidence.title,
    publisher: evidence.publisher,
    published_or_updated: evidence.published_or_updated,
    accessed_at: evidence.accessed_at,
    source_tier: evidence.source_tier,
    status,
    access_state: evidence.access_state,
    extract: evidence.extract,
    content_sha256: evidence.content_sha256,
    provenance: evidence.provenance,
  } as StandardCandidateProjectionV1["citations"][number];
}

function projectAllEligibleCandidates(
  source: StandardEvidenceGraphV1,
  now: Date,
  softCap: number,
  orderedCandidateIds?: readonly string[],
): StandardCandidateProjectionV1[] {
  const graph = sanitizeStandardEvidenceGraphForRelease(source).graph;
  const evidenceById = new Map(
    graph.evidence.map((item) => [item.evidence_id, item]),
  );
  const claimById = new Map(graph.claims.map((item) => [item.claim_id, item]));
  const candidateById = new Map(
    graph.candidates.map((item) => [item.candidate_id, item]),
  );
  const readStatuses = standardEvidenceReadStatuses(graph, now);
  const selected = orderedCandidateIds
    ? orderedCandidateIds.map((candidateId) => {
        if (!graph.eligible_candidate_ids.includes(candidateId))
          throw new Error("Consultant candidate is not eligible.");
        const candidate = candidateById.get(candidateId);
        if (!candidate) throw new Error("Eligible candidate is missing.");
        return {
          candidate,
          score: scoreStandardCandidate(candidate.dimensions),
        };
      })
    : graph.eligible_candidate_ids
        .map((candidateId) => {
          const candidate = candidateById.get(candidateId);
          if (!candidate) throw new Error("Eligible candidate is missing.");
          return {
            candidate,
            score: scoreStandardCandidate(candidate.dimensions),
          };
        })
        .sort(
          (left, right) =>
            right.score.compatibilityScore - left.score.compatibilityScore ||
            left.candidate.deterministic_tie_breaker.localeCompare(
              right.candidate.deterministic_tie_breaker,
              "en",
            ),
        )
        .slice(0, softCap);
  return selected.map(({ candidate, score }) => {
    const citationIds = new Set<string>();
    for (const claimId of candidate.rationale_claim_ids) {
      const claim = claimById.get(claimId);
      if (!claim) throw new Error("Candidate rationale claim is missing.");
      claim.evidence_ids.forEach((id) => citationIds.add(id));
    }
    graph.evidenced_values
      .filter((value) => value.candidate_id === candidate.candidate_id)
      .forEach((value) =>
        value.evidence_ids.forEach((id) => citationIds.add(id)),
      );
    const citations = [...citationIds].map((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      const status = readStatuses.get(evidenceId);
      if (!evidence || !status)
        throw new Error("Candidate citation is missing.");
      return projectCitation(evidence, status);
    });
    const primaryClaim = claimById.get(candidate.rationale_claim_ids[0]!);
    if (!primaryClaim) throw new Error("Candidate rationale claim is missing.");
    const linkExplanation = (item: {
      dimensionId: string;
      explanation: string;
    }) => ({
      dimension_id: item.dimensionId,
      explanation: item.explanation,
      claim_id: primaryClaim.claim_id,
      evidence_ids: [...primaryClaim.evidence_ids],
    });
    const evidencedValues = graph.evidenced_values
      .filter((value) => value.candidate_id === candidate.candidate_id)
      .filter((value) =>
        value.evidence_ids.every((id) => {
          const status = readStatuses.get(id);
          return !["stale", "conflicting", "unknown"].includes(
            status ?? "unknown",
          );
        }),
      );
    const byKind = (kind: (typeof evidencedValues)[number]["kind"]) =>
      evidencedValues
        .filter((value) => value.kind === kind)
        .map((value) => {
          if (value.kind === "organization_contact")
            return {
              kind: value.kind,
              channel_type: value.channel_type,
              value: value.value,
              organization_domain: value.organization_domain,
              ...(value.channel_type === "organization_web"
                ? {
                    organization_web_policy_version:
                      value.organization_web_policy_version,
                    organization_web_purpose: value.organization_web_purpose,
                    organization_web_form: value.organization_web_form,
                  }
                : {}),
              verification_status: value.verification_status,
              evidence_ids: [...value.evidence_ids],
            };
          return {
            kind: value.kind,
            value: value.value,
            verification_status: value.verification_status,
            evidence_ids: [...value.evidence_ids],
          };
        });
    const stale = citations.filter(
      (citation) =>
        citation.status === "stale" || citation.access_state !== "available",
    ).length;
    const candidateProjection = {
      display_name: candidate.display_name,
      country_code: candidate.country_code,
      rationale_extended: candidate.rationale_extended,
      compatibility_score: score.compatibilityScore,
      fit_band: score.fitBand,
      band_ceiling: score.bandCeiling,
      displayed_band: score.displayedBand,
      ...(score.capReason ? { band_ceiling_reason: score.capReason } : {}),
      dimension_scores: structuredClone(candidate.dimensions),
      positive_drivers: score.drivers.map(linkExplanation),
      limiting_gaps: score.gaps.map(linkExplanation),
      citations,
      freshness:
        stale === 0
          ? "current"
          : stale === citations.length
            ? "stale"
            : "mixed",
      verification_status: projectedStatus(
        candidate.verification_status,
        citations.map((citation) => citation.status),
      ),
      evidence_confidence: candidate.evidence_confidence,
      ...(byKind("organization_contact").length
        ? { contact_details: byKind("organization_contact") }
        : {}),
      ...(byKind("plant").length ? { plant_identifiers: byKind("plant") } : {}),
      ...(byKind("approval").length
        ? { approval_identifiers: byKind("approval") }
        : {}),
      ...(byKind("capacity").length
        ? { capacity_figures: byKind("capacity") }
        : {}),
    } as StandardCandidateProjectionV1;
    assertStandardPiiReleaseSafe(candidateProjection);
    return candidateProjection;
  });
}

export function buildConsultantResultProjection(input: {
  readonly completeResult: StandardEvidenceGraphV1;
  readonly projectionAsOf: Date;
  readonly hardConstraints: readonly StandardHardConstraintV1[];
  readonly softCap: number;
  readonly allowLegacyEmptyScarcityLedger?: boolean;
}): ConsultantResultProjectionV1 {
  if (!Number.isSafeInteger(input.softCap) || input.softCap < 3)
    throw new Error(
      "Consultant result soft cap must be an integer of at least 3.",
    );
  const standard = projectStoredResult({
    tier: "standard",
    completeResult: input.completeResult,
    projectionAsOf: input.projectionAsOf.toISOString(),
    runBoundCanonicalHardConstraints: input.hardConstraints,
    allowLegacyEmptyScarcityLedger:
      input.allowLegacyEmptyScarcityLedger ?? false,
  }).body as StandardResultProjectionV1;
  const eligibleCount = input.completeResult.eligible_candidate_ids.length;
  const candidates = projectAllEligibleCandidates(
    input.completeResult,
    input.projectionAsOf,
    input.softCap,
  );
  const landscape = resolveConsultantLandscape(eligibleCount, input.softCap);
  if (candidates.length !== landscape.displayed_count)
    throw new Error("Consultant candidate projection count drifted.");
  const projection: ConsultantResultProjectionV1 = {
    ...standard,
    schema_version: CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
    candidates,
    landscape,
    consultant_source_readiness: {
      state: "limited",
      notice:
        "Candidate evidence is available. RFQ, reserve-candidate, engagement, analyst-authorship and governed report fields are not yet released.",
    },
    projection_version: CONSULTANT_RESULT_PROJECTION_VERSION,
  };
  assertStandardPiiReleaseSafe(projection);
  return parseConsultantResultProjectionV1(projection);
}

export interface ConsultantRankingSignalsV2 {
  readonly compatibilityScore: number;
  readonly corroboratedRequiredClaimCount: number;
  readonly authoritativeRequiredClaimCount: number;
  readonly unresolvedLimitationCount: number;
  readonly completeEvidenceTimestamp: number;
  readonly candidateId: string;
}

export function compareConsultantRankingSignalsV2(
  left: ConsultantRankingSignalsV2,
  right: ConsultantRankingSignalsV2,
): number {
  return (
    right.compatibilityScore - left.compatibilityScore ||
    right.corroboratedRequiredClaimCount -
      left.corroboratedRequiredClaimCount ||
    right.authoritativeRequiredClaimCount -
      left.authoritativeRequiredClaimCount ||
    left.unresolvedLimitationCount - right.unresolvedLimitationCount ||
    left.completeEvidenceTimestamp - right.completeEvidenceTimestamp ||
    left.candidateId.localeCompare(right.candidateId, "en")
  );
}

function rankEligibleCandidatesV2(source: StandardEvidenceGraphV1) {
  const graph = sanitizeStandardEvidenceGraphForRelease(source).graph;
  const candidateById = new Map(
    graph.candidates.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const evidenceById = new Map(
    graph.evidence.map((evidence) => [evidence.evidence_id, evidence]),
  );
  return graph.eligible_candidate_ids
    .map((candidateId) => {
      const candidate = candidateById.get(candidateId);
      if (!candidate) throw new Error("Eligible candidate is missing.");
      if (
        !candidate.mandatory_constraints_satisfied ||
        candidate.failed_constraint_ids.length !== 0
      )
        throw new Error(
          "A failed hard-gate candidate cannot enter Consultant ranking.",
        );
      const claims = graph.claims.filter(
        (claim) => claim.candidate_id === candidateId,
      );
      const corroboratedRequiredClaimCount = claims.filter(
        (claim) =>
          claim.corroboration.required &&
          claim.corroboration.status === "satisfied" &&
          claim.corroboration.independent_evidence_ids.length > 0,
      ).length;
      const authoritativeRequiredClaimCount = claims.filter(
        (claim) =>
          claim.decision_bearing &&
          claim.verification_status === "externally_verified" &&
          claim.evidence_ids.some((evidenceId) => {
            const evidence = evidenceById.get(evidenceId);
            return (
              evidence?.verification_disposition === "accepted" &&
              ["primary", "official_secondary"].includes(evidence.source_tier)
            );
          }),
      ).length;
      const unresolvedLimitationCount = claims.filter(
        (claim) =>
          claim.decision_bearing &&
          (claim.verification_status !== "externally_verified" ||
            (claim.corroboration.required &&
              claim.corroboration.status !== "satisfied")),
      ).length;
      const evidenceTimes = claims
        .flatMap((claim) => claim.evidence_ids)
        .map((evidenceId) => evidenceById.get(evidenceId)?.accessed_at)
        .filter((value): value is string => value !== undefined)
        .map((value) => new Date(value).getTime());
      const completeEvidenceTimestamp = evidenceTimes.length
        ? Math.max(...evidenceTimes)
        : Number.MAX_SAFE_INTEGER;
      return {
        candidate,
        score: scoreStandardCandidate(candidate.dimensions),
        corroboratedRequiredClaimCount,
        authoritativeRequiredClaimCount,
        unresolvedLimitationCount,
        completeEvidenceTimestamp,
      };
    })
    .sort((left, right) =>
      compareConsultantRankingSignalsV2(
        {
          compatibilityScore: left.score.compatibilityScore,
          corroboratedRequiredClaimCount: left.corroboratedRequiredClaimCount,
          authoritativeRequiredClaimCount: left.authoritativeRequiredClaimCount,
          unresolvedLimitationCount: left.unresolvedLimitationCount,
          completeEvidenceTimestamp: left.completeEvidenceTimestamp,
          candidateId: left.candidate.candidate_id,
        },
        {
          compatibilityScore: right.score.compatibilityScore,
          corroboratedRequiredClaimCount: right.corroboratedRequiredClaimCount,
          authoritativeRequiredClaimCount:
            right.authoritativeRequiredClaimCount,
          unresolvedLimitationCount: right.unresolvedLimitationCount,
          completeEvidenceTimestamp: right.completeEvidenceTimestamp,
          candidateId: right.candidate.candidate_id,
        },
      ),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function buildConsultantResultProjectionV2(input: {
  readonly completeResult: StandardEvidenceGraphV1;
  readonly projectionAsOf: Date;
  readonly hardConstraints: readonly StandardHardConstraintV1[];
  readonly softCap: number;
  readonly configurationRelease: {
    readonly configId: string;
    readonly configVersion: string;
    readonly contentSha256: string;
    readonly boundAt: Date;
    readonly effectiveReleaseAt: Date;
  };
  readonly allowLegacyEmptyScarcityLedger?: boolean;
}): ConsultantResultProjectionV2 {
  if (!Number.isSafeInteger(input.softCap) || input.softCap < 3)
    throw new Error(
      "Consultant result soft cap must be an integer of at least 3.",
    );
  const ranked = rankEligibleCandidatesV2(input.completeResult);
  const standard = projectStoredResult({
    tier: "standard",
    completeResult: input.completeResult,
    projectionAsOf: input.projectionAsOf.toISOString(),
    runBoundCanonicalHardConstraints: input.hardConstraints,
    allowLegacyEmptyScarcityLedger:
      input.allowLegacyEmptyScarcityLedger ?? false,
  }).body as StandardResultProjectionV1;
  const landscape = resolveConsultantLandscape(ranked.length, input.softCap);
  const displayed = ranked.slice(0, landscape.displayed_count);
  const candidates = projectAllEligibleCandidates(
    input.completeResult,
    input.projectionAsOf,
    input.softCap,
    displayed.map((entry) => entry.candidate.candidate_id),
  );
  if (candidates.length !== landscape.displayed_count)
    throw new Error("Consultant candidate projection count drifted.");
  const graph = sanitizeStandardEvidenceGraphForRelease(
    input.completeResult,
  ).graph;
  const rankedReference = (entry: (typeof ranked)[number]) => ({
    candidate_id: entry.candidate.candidate_id,
    rank: entry.rank,
    display_name: entry.candidate.display_name,
    country_code: entry.candidate.country_code,
    projection_index:
      entry.rank <= landscape.displayed_count ? entry.rank - 1 : null,
    evidence_ids: [
      ...new Set(
        graph.claims
          .filter(
            (claim) => claim.candidate_id === entry.candidate.candidate_id,
          )
          .flatMap((claim) => claim.evidence_ids),
      ),
    ],
  });
  const eligibleRanking = ranked.map(rankedReference);
  const readStatuses = standardEvidenceReadStatuses(
    graph,
    input.projectionAsOf,
  );
  const sourceFacts: ConsultantSourceFactV2[] = graph.evidence.map(
    (evidence) => {
      const common = {
        ...projectCitation(
          evidence,
          readStatuses.get(evidence.evidence_id) ??
            evidence.verification_status,
        ),
        accessed_at: new Date(evidence.accessed_at).toISOString(),
        ...("exact_url" in evidence
          ? { publisher_domain: new URL(evidence.exact_url).hostname }
          : {}),
      };
      return (
        evidence.verification_disposition === "excluded"
          ? {
              ...common,
              verification_disposition: "excluded" as const,
              exclusion_reason: evidence.exclusion_reason,
            }
          : {
              ...common,
              verification_disposition: "accepted" as const,
            }
      ) as ConsultantSourceFactV2;
    },
  );
  const excludedEvidence = sourceFacts.filter(
    (fact): fact is ConsultantExcludedEvidenceV2 =>
      fact.verification_disposition === "excluded",
  );
  const selectedInitialCandidates = eligibleRanking.slice(
    0,
    Math.min(3, landscape.displayed_count),
  );
  const waveInstanceId = hash(
    [
      graph.run_id,
      CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      input.configurationRelease.contentSha256,
      "RFQ_WAVE_INITIAL",
      "1",
      selectedInitialCandidates
        .map((candidate) => candidate.candidate_id)
        .join(","),
    ].join("|"),
  ).toString("hex");
  const auditEventId = hash(
    `${waveInstanceId}|${input.configurationRelease.boundAt.toISOString()}|SYNTHETIC_WAVE_SNAPSHOT_PROJECTED`,
  ).toString("hex");
  const projection: ConsultantResultProjectionV2 = {
    ...standard,
    schema_version: CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
    candidates,
    landscape,
    source_policy: {
      policy_id: CONSULTANT_SOURCE_POLICY_ID,
      policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
      content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      domain_pack_id: CONSULTANT_DOMAIN_PACK_ID,
      mode: "agent_researched_synthetic_qualification",
      production_state: "blocked_pending_attributable_sme_validation",
    },
    configuration_release: {
      config_id: input.configurationRelease.configId,
      config_version: input.configurationRelease.configVersion,
      content_sha256: input.configurationRelease.contentSha256,
      bound_at: input.configurationRelease.boundAt.toISOString(),
      effective_release_at:
        input.configurationRelease.effectiveReleaseAt.toISOString(),
      soft_cap: input.softCap,
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
        response_state: "not_collected" as const,
      }),
    ),
    wave_recommendations: [
      {
        wave_id: "RFQ_WAVE_INITIAL",
        action:
          displayed.length === 0
            ? "no_eligible_candidates"
            : "prepare_synthetic_rfq",
        selection_rule: "first_min_initial_wave_size_displayed",
        candidates: selectedInitialCandidates,
      },
    ],
    eligible_ranking: eligibleRanking,
    rfq_execution_snapshot: {
      state: "synthetic_planning_only",
      contact_state: "not_contacted",
      response_state: "not_collected",
      qualified_response_count: 0,
      expansion_model: {
        initial_wave_size: 3,
        subsequent_wave_size: 2,
        expansion_threshold: 3,
        effective_expansion_threshold: Math.min(3, landscape.displayed_count),
      },
      wave_id: "RFQ_WAVE_INITIAL",
      wave_sequence: 1,
      wave_instance_id: waveInstanceId,
      selected_candidates: selectedInitialCandidates,
      remaining_displayed_queue: eligibleRanking.slice(
        selectedInitialCandidates.length,
        landscape.displayed_count,
      ),
      stop_state:
        landscape.displayed_count === 0
          ? "exhausted_displayed_queue"
          : "awaiting_synthetic_checkpoint",
      next_reserve_promotion: {
        state:
          ranked.length > landscape.displayed_count ? "available" : "exhausted",
        candidate:
          ranked.length > landscape.displayed_count
            ? {
                ...eligibleRanking[landscape.displayed_count]!,
                eligibility_basis: "eligible_candidate_ids_only",
                promotion_state: "next_ranked_eligible",
              }
            : null,
        promotion_mode: "one_next_ranked_eligible_only",
      },
      audit_identity: {
        event_type: "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED",
        event_id: auditEventId,
        actor_type: "agent",
        actor_id: "matchbase_agent_research_and_implementation_team",
        occurred_at: input.configurationRelease.boundAt.toISOString(),
        policy_id: CONSULTANT_SOURCE_POLICY_ID,
        policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
        policy_content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
        config_id: input.configurationRelease.configId,
        config_version: input.configurationRelease.configVersion,
        config_content_sha256: input.configurationRelease.contentSha256,
      },
    },
    reserve_candidates: ranked
      .slice(landscape.displayed_count)
      .map((entry) => ({
        ...rankedReference(entry),
        eligibility_basis: "eligible_candidate_ids_only" as const,
        promotion_state: "next_ranked_eligible" as const,
      })),
    due_diligence_checklist: CONSULTANT_DUE_DILIGENCE_CHECKS.map(
      ([checkId, label], index) => ({
        order: index + 1,
        check_id: checkId,
        label,
        state: "not_executed" as const,
        required_before_production: true as const,
      }),
    ),
    source_facts: sourceFacts,
    excluded_evidence: excludedEvidence,
    full_limitations: {
      qualification_scope: "synthetic_only",
      human_consultant_authorship: "not_claimed",
      production_sme_validation: "not_claimed",
      production_release: "blocked",
      restricted_party_clearance: "not_claimed",
      due_diligence_completeness: "not_executed",
      notices: [
        "This result is an agent-researched synthetic qualification output, not a real supplier recommendation.",
        "No human Consultant authorship or attributable professional approval is claimed.",
        "The six production scoring weights and enabled domain pack do not have attributable SME validation.",
        "No sanctions, debarment, customs, export-control, legal, or supplier-capability clearance is claimed.",
        "The due-diligence checklist has not been executed and initial diligence would not be exhaustive.",
      ],
    },
    projection_version: CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  };
  assertStandardPiiReleaseSafe(projection);
  return parseConsultantResultProjectionV2(projection);
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertLegacyDemoResultIntegrity(
  document: unknown,
  storedSha256: unknown,
  expectedRunId: string,
): asserts document is EvidenceGraphV1 {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    (document as { runId?: unknown }).runId !== expectedRunId
  )
    throw new Error("Stored Demo result identity is invalid.");
  if (!Buffer.isBuffer(storedSha256) || storedSha256.length !== 32)
    throw new Error("Stored Demo result integrity digest is invalid.");
  const expected = hash(JSON.stringify(document));
  if (!timingSafeEqual(storedSha256, expected))
    throw new Error("Stored Demo result integrity check failed.");
}

async function projectionVersionId(
  client: TransactionClient,
  version: number,
  definition: string,
  expectedHash = hash(definition),
): Promise<string> {
  await client.query(
    `INSERT INTO projection_version
       (projection_version_id,version,definition,content_sha256,released_at)
     VALUES($1,$2,$3::jsonb,$4,clock_timestamp())
     ON CONFLICT (version) DO NOTHING`,
    [randomUUID(), version, definition, expectedHash],
  );
  const selected = await client.query<{
    projection_version_id: string;
    definition: unknown;
    content_sha256: Buffer;
  }>(
    `SELECT projection_version_id,definition,content_sha256
       FROM projection_version WHERE version=$1`,
    [version],
  );
  const row = selected.rows[0];
  if (
    !row ||
    canonicalJson(row.definition) !== canonicalJson(JSON.parse(definition)) ||
    !Buffer.isBuffer(row.content_sha256) ||
    row.content_sha256.length !== expectedHash.length ||
    !timingSafeEqual(row.content_sha256, expectedHash)
  )
    throw new Error("Projection version definition drifted.");
  return row.projection_version_id;
}

export class ConsultantResultApplication {
  constructor(private readonly pool: ConnectionPool) {}

  async listRuns(context: RequestContext): Promise<ConsultantRunHistoryV1> {
    await assertConsultantWorkspaceAuthorized(
      this.pool,
      context,
      "run.history",
    );
    return inTransaction(this.pool, async (client) => {
      const selected = await client.query<{
        run_id: string;
        request_id: string;
        state: string;
        queued_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        result_document_available: boolean;
      }>(
        `SELECT rr.run_id,v.request_id,rr.state,rr.queued_at,rr.started_at,rr.completed_at,
                (rs.complete_result_document IS NOT NULL) AS result_document_available
           FROM research_run rr
           JOIN canonical_request_version v
             ON v.account_id=rr.account_id
            AND v.canonical_request_version_id=rr.canonical_request_version_id
           LEFT JOIN run_result rs
             ON rs.account_id=rr.account_id AND rs.run_id=rr.run_id
          WHERE rr.account_id=$1 AND rr.requested_by_user_id=$2
          ORDER BY rr.queued_at DESC,rr.run_id DESC`,
        [context.accountId, context.userId],
      );
      const items: ConsultantRunHistoryV1["items"] = selected.rows.map(
        (row) => {
          const completed = ["complete", "no_responsible_match"].includes(
            row.state,
          );
          const resultAvailable = completed && row.result_document_available;
          const state: ConsultantRunHistoryV1["items"][number]["state"] =
            completed
              ? "completed"
              : ["failed", "cancelled", "superseded"].includes(row.state)
                ? (row.state as "failed" | "cancelled" | "superseded")
                : row.state === "queued"
                  ? "queued"
                  : "running";
          const outcome: ConsultantRunHistoryV1["items"][number]["outcome"] =
            state === "completed"
              ? row.state === "no_responsible_match"
                ? "no_responsible_match"
                : "matched"
              : state === "failed" ||
                  state === "cancelled" ||
                  state === "superseded"
                ? state
                : "pending";
          return {
            run_id: row.run_id,
            request_id: row.request_id,
            state,
            updated_at: (
              row.completed_at ??
              row.started_at ??
              row.queued_at
            ).toISOString(),
            result_available: resultAvailable,
            outcome,
          };
        },
      );
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "consultant.run_history.projected",
        resourceKind: "run_history",
        resourceId: context.userId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: {
          itemCount: items.length,
          ownerScoped: true,
          disclosureCommittedBeforeResponse: true,
        },
      });
      return {
        schema_version: "consultant-run-history.v1",
        items,
      };
    });
  }

  async getResult(
    context: RequestContext,
    runId: string,
  ): Promise<ConsultantResultRead> {
    await assertConsultantWorkspaceAuthorized(this.pool, context, "run.result");
    const guarded = await inTransaction(this.pool, async (client) => {
      const guard = await guardFreshRunOutputRead(
        client,
        context,
        runId,
        "run.result",
      );
      if (guard.kind !== "allowed") return guard;
      const selected = await client.query<{
        tier_at_submission: "demo" | "standard" | "consultant";
        research_mode: "synthetic_reference" | "qualified_live_research";
        complete_result_document: unknown;
        result_sha256: Buffer;
        canonical_document:
          StructuredStandardRequestV1 | Record<string, unknown>;
        scarcity_outcome: "scarcity" | "no_responsible_match" | null;
        unmet_constraints: unknown;
        permitted_relaxations: unknown;
        projection_as_of: Date;
      }>(
        `SELECT rr.tier_at_submission,rr.research_mode,rs.complete_result_document,
                rs.result_sha256,v.canonical_document,
                sa.outcome AS scarcity_outcome,sa.unmet_constraints,sa.permitted_relaxations,
                transaction_timestamp() AS projection_as_of
           FROM research_run rr
           JOIN canonical_request_version v
             ON v.account_id=rr.account_id
            AND v.canonical_request_version_id=rr.canonical_request_version_id
           LEFT JOIN run_result rs
             ON rs.account_id=rr.account_id AND rs.run_id=rr.run_id
           LEFT JOIN scarcity_analysis sa
             ON sa.account_id=rr.account_id AND sa.run_id=rr.run_id
          WHERE rr.run_id=$1 AND rr.account_id=$2 AND rr.requested_by_user_id=$3`,
        [runId, context.accountId, context.userId],
      );
      const row = selected.rows[0];
      if (!row) return { kind: "not_visible" as const };
      if (
        !row.complete_result_document ||
        !["complete", "no_responsible_match"].includes(guard.state)
      )
        throw new ApplicationFault(
          409,
          "run-not-complete",
          "MB-409-RUN",
          "Run result is not available.",
          true,
        );
      const legacyEmptyScarcityLedger =
        row.scarcity_outcome !== null &&
        Array.isArray(row.unmet_constraints) &&
        row.unmet_constraints.length === 0 &&
        Array.isArray(row.permitted_relaxations) &&
        row.permitted_relaxations.length === 0;
      let result: ConsultantResultRead;
      let fields: string[];
      let itemCount: number;
      let projectionVersion: number;
      if (row.tier_at_submission === "demo") {
        if (
          (row.complete_result_document as Record<string, unknown>)
            .schema_version === "complete-result-foundation.v2"
        )
          assertStoredCompleteResultIntegrity(
            row.complete_result_document,
            row.result_sha256,
            runId,
          );
        else
          assertLegacyDemoResultIntegrity(
            row.complete_result_document,
            row.result_sha256,
            runId,
          );
        const canonical = row.canonical_document as Record<string, unknown>;
        const oldFields = Array.isArray(canonical.fields)
          ? canonical.fields
          : [];
        const projected = projectStoredResult({
          tier: "demo",
          completeResult: row.complete_result_document as
            EvidenceGraphV1 | CompleteResultFoundationV2,
          runBoundMandatoryConstraints: oldFields.flatMap((field) => {
            if (
              !field ||
              typeof field !== "object" ||
              !("fieldId" in field) ||
              field.fieldId !== "mandatory_constraints" ||
              !("valueState" in field) ||
              field.valueState !== "provided" ||
              !("canonicalValue" in field) ||
              typeof field.canonicalValue !== "string"
            )
              return [];
            return [field.canonicalValue];
          }),
          researchMode: row.research_mode,
        });
        result = { projectionTier: "demo", body: projected.body };
        fields = [...projected.metadata.fieldsReleased];
        itemCount = projected.metadata.itemCount;
        projectionVersion = projected.metadata.projectionVersion;
      } else if (row.tier_at_submission === "standard") {
        assertStoredCompleteResultIntegrity(
          row.complete_result_document,
          row.result_sha256,
          runId,
        );
        const graph =
          (row.complete_result_document as Record<string, unknown>)
            .schema_version === "complete-result-foundation.v2"
            ? standardEvidenceGraphFromCompleteResultFoundationV2(
                row.complete_result_document as CompleteResultFoundationV2,
              )
            : standardEvidenceGraphFromStoredCompleteResult(
                row.complete_result_document,
              );
        const projected = projectStoredResult({
          tier: "standard",
          completeResult: graph,
          projectionAsOf: row.projection_as_of.toISOString(),
          runBoundCanonicalHardConstraints: (
            row.canonical_document as StructuredStandardRequestV1
          ).hard_constraints,
          allowLegacyEmptyScarcityLedger: legacyEmptyScarcityLedger,
        });
        result = {
          projectionTier: "standard",
          body: projected.body as StandardResultProjectionV1,
        };
        fields = [...projected.metadata.fieldsReleased];
        itemCount = projected.metadata.itemCount;
        projectionVersion = projected.metadata.projectionVersion;
      } else {
        assertStoredCompleteResultIntegrity(
          row.complete_result_document,
          row.result_sha256,
          runId,
        );
        const graph =
          (row.complete_result_document as Record<string, unknown>)
            .schema_version === "complete-result-foundation.v2"
            ? standardEvidenceGraphFromCompleteResultFoundationV2(
                row.complete_result_document as CompleteResultFoundationV2,
              )
            : standardEvidenceGraphFromStoredCompleteResult(
                row.complete_result_document,
              );
        const policy = await readConsultantProjectionPolicy(client, {
          accountId: context.accountId,
          runId,
        });
        const body = buildConsultantResultProjectionV2({
          completeResult: graph,
          projectionAsOf: row.projection_as_of,
          hardConstraints: (
            row.canonical_document as StructuredStandardRequestV1
          ).hard_constraints,
          softCap: policy.softCap,
          configurationRelease: {
            configId: policy.configId,
            configVersion: policy.configVersion,
            contentSha256: policy.configContentSha256.toString("hex"),
            boundAt: policy.boundAt,
            effectiveReleaseAt: policy.effectiveReleaseAt,
          },
          allowLegacyEmptyScarcityLedger: legacyEmptyScarcityLedger,
        });
        result = { projectionTier: "consultant", body };
        fields = standardReleasedFieldPaths(
          body as unknown as Record<string, unknown>,
        );
        itemCount = body.landscape.displayed_count;
        projectionVersion = body.projection_version;
        await appendAuditEvent(client, {
          accountId: context.accountId,
          actorUserId: context.userId,
          actorTier: context.tier,
          eventType: "result.projection_policy_applied",
          resourceKind: "research_run",
          resourceId: runId,
          outcome: "allow",
          correlationId: context.correlationId,
          deploymentId: context.deploymentId,
          detail: {
            configId: policy.configId,
            configVersion: policy.configVersion,
            configContentSha256: policy.configContentSha256.toString("hex"),
            boundAt: policy.boundAt.toISOString(),
            effectiveReleaseAt: policy.effectiveReleaseAt.toISOString(),
            policyId: body.source_policy.policy_id,
            policyVersion: body.source_policy.policy_version,
            policyContentSha256: body.source_policy.content_sha256,
            rfqWaveId: body.rfq_execution_snapshot.wave_id,
            rfqWaveSequence: body.rfq_execution_snapshot.wave_sequence,
            rfqWaveInstanceId: body.rfq_execution_snapshot.wave_instance_id,
            rfqAuditEventId:
              body.rfq_execution_snapshot.audit_identity.event_id,
            softCap: policy.softCap,
            eligibleCount: body.landscape.eligible_count,
            displayedCount: body.landscape.displayed_count,
            truncated: body.landscape.truncated,
            scarcityOverrideApplied: body.landscape.scarcity_override_applied,
          },
        });
      }
      const release =
        result.projectionTier === "standard"
          ? standardDisclosureProjectionRegistryRelease()
          : result.projectionTier === "demo"
            ? {
                definition: canonicalJson({
                  allowlist: "demo-projection.v1",
                  tier: "demo",
                }),
                contentSha256: hash("demo-projection.v1"),
              }
            : {
                definition: canonicalJson({
                  allowlist: result.body.schema_version,
                  tier: "consultant",
                }),
                contentSha256: hash(
                  canonicalJson({
                    allowlist: result.body.schema_version,
                    tier: "consultant",
                  }),
                ),
              };
      const versionId = await projectionVersionId(
        client,
        projectionVersion,
        release.definition,
        release.contentSha256,
      );
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "result.projected",
        resourceKind: "research_run",
        resourceId: runId,
        outcome: "allow",
        projectionVersionId: versionId,
        fieldsReleased: fields,
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: {
          projectionVersion,
          projectionTier: result.projectionTier,
          tierAtSubmission: row.tier_at_submission,
        },
      });
      await client.query(
        `INSERT INTO projection_serving
           (projection_serving_id,account_id,subject_user_id,tier,resource_kind,
            resource_id,projection_version_id,fields_released,item_count,
            served_at,request_correlation_id)
         VALUES($1,$2,$3,$4,'research_run',$5,$6,$7,$8,clock_timestamp(),$9)`,
        [
          randomUUID(),
          context.accountId,
          context.userId,
          context.tier,
          runId,
          versionId,
          fields,
          itemCount,
          context.correlationId,
        ],
      );
      return { kind: "allowed" as const, result };
    });
    if (guarded.kind === "output_restricted") throw outputRestrictedFault();
    if (guarded.kind === "not_visible")
      throw new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-RESOURCE",
        "Resource is not visible.",
      );
    return guarded.result;
  }
}
