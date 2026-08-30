import type {
  StandardCandidateProjectionV1,
  StandardEvidenceGraphV1,
  StandardEvidenceItemV1,
  StandardEvidencedValueProjectionV1,
  StandardHardConstraintV1,
  StandardResultProjectionV1,
  StandardScarcityAnalysisProjectionV1,
  StandardVerificationStatus,
} from "@matchbase/contracts";
import { STANDARD_DISCLOSURE_PROJECTION_VERSION } from "@matchbase/contracts";
import {
  buildCompleteResultFoundation,
  type CompleteResultFoundationV1,
} from "../complete-result/foundation.js";
import {
  STANDARD_EVIDENCE_VOLATILITY_POLICY,
  type EvidenceVolatilityPolicyV1,
  standardEvidenceReadStatuses,
  validateStandardEvidenceGraph,
} from "../evidence/standard.js";
import { scoreStandardCandidate } from "../scoring/standard.js";
import {
  assertStandardPiiReleaseSafe,
  sanitizeStandardEvidenceGraphForRelease,
  type StandardPiiSecurityEvent,
} from "./standard-privacy.js";

export const STANDARD_SYNTHETIC_WARNING =
  "Synthetic evaluation data only. No live supplier research, restricted-party screening, compliance verification, quotation, or sourcing recommendation has been performed.";
export const STANDARD_ADVISORY_BOUNDARY =
  "This screening output is decision support only and is not professional, legal, compliance, procurement, or investment advice.";
export const STANDARD_SCREENING_NOTICE =
  "Restricted-party screening has not been performed.";

const forbiddenStandardProjectionKeys = new Set([
  "eligible_candidate_ids",
  "deterministic_tie_breaker",
  "failed_constraint_ids",
  "rationale_claim_ids",
  "claims",
  "evidence",
  "source_text",
  "sourceText",
  "provider_id",
  "providerId",
  "model_id",
  "modelId",
  "prompt",
  "tier",
  "eligible_total",
  "considered_total",
  "first_gate_input_count",
  "reserve_candidates",
  "artifacts",
  "pdf",
  "export",
]);

export function findForbiddenStandardProjectionKeys(value: unknown): string[] {
  const findings = new Set<string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(item)) {
      if (forbiddenStandardProjectionKeys.has(key)) findings.add(key);
      visit(nested);
    }
  };
  visit(value);
  return [...findings].sort();
}

export function assertStandardProjectionSafe(value: unknown): void {
  const findings = findForbiddenStandardProjectionKeys(value);
  if (findings.length > 0) {
    throw new Error(
      `Standard projection contains forbidden keys: ${findings.join(", ")}.`,
    );
  }
}

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
  evidenceStatuses: readonly StandardVerificationStatus[],
): StandardVerificationStatus {
  return [stored, ...evidenceStatuses].sort(
    (left, right) => statusPriority(right) - statusPriority(left),
  )[0]!;
}

function projectCitation(
  evidence: StandardEvidenceItemV1,
  status: StandardVerificationStatus,
) {
  const locator =
    "exact_url" in evidence
      ? { exact_url: evidence.exact_url }
      : { fixture_identity: evidence.fixture_identity };
  return {
    evidence_id: evidence.evidence_id,
    ...locator,
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
  };
}

export interface StandardProjectionContext {
  now: Date;
  runBoundCanonicalHardConstraints: readonly StandardHardConstraintV1[];
  allowLegacyEmptyScarcityLedger?: boolean;
  volatilityPolicy?: EvidenceVolatilityPolicyV1;
  onSecurityEvent?: (event: StandardPiiSecurityEvent) => void;
}

function buildScarcityAnalysis(
  graph: StandardEvidenceGraphV1,
  hardConstraints: readonly StandardHardConstraintV1[],
  outcome: StandardResultProjectionV1["outcome"],
  allowLegacyEmptyScarcityLedger: boolean,
): StandardScarcityAnalysisProjectionV1 {
  const constraintsById = new Map<string, StandardHardConstraintV1>();
  for (const constraint of hardConstraints) {
    if (
      !constraint.constraint_id ||
      constraintsById.has(constraint.constraint_id)
    )
      throw new Error(
        "Run-bound canonical hard constraints require unique identifiers.",
      );
    constraintsById.set(constraint.constraint_id, constraint);
  }

  const eligible = new Set(graph.eligible_candidate_ids);
  const eliminatedCountByConstraintId = new Map<string, number>();
  let candidatesEliminatedByMandatoryConstraints = 0;
  for (const candidate of graph.candidates) {
    const uniqueFailures = new Set(candidate.failed_constraint_ids);
    if (uniqueFailures.size !== candidate.failed_constraint_ids.length)
      throw new Error(
        "Candidate failed constraint identifiers must be unique.",
      );
    if (candidate.mandatory_constraints_satisfied) {
      if (uniqueFailures.size > 0)
        throw new Error(
          "A mandatory-constraint-satisfied candidate cannot report failures.",
        );
      continue;
    }
    if (eligible.has(candidate.candidate_id) || uniqueFailures.size === 0)
      throw new Error(
        "A mandatory-constraint elimination requires enumerated failures.",
      );
    candidatesEliminatedByMandatoryConstraints += 1;
    for (const constraintId of uniqueFailures) {
      if (!constraintsById.has(constraintId))
        throw new Error(
          "Candidate failure is not bound to the canonical hard constraints.",
        );
      eliminatedCountByConstraintId.set(
        constraintId,
        (eliminatedCountByConstraintId.get(constraintId) ?? 0) + 1,
      );
    }
  }

  const mandatoryGate = graph.gate_evaluations.find(
    (gate) => gate.gate_id === "mandatory_constraints",
  );
  if (
    (mandatoryGate?.eliminated_count ?? 0) !==
      candidatesEliminatedByMandatoryConstraints &&
    !allowLegacyEmptyScarcityLedger
  )
    throw new Error(
      "Mandatory gate count does not match enumerated candidate failures.",
    );

  const targetLabel = (constraint: StandardHardConstraintV1): string => {
    const target = constraint.target;
    if (target.value_state !== "provided") return target.value_state;
    return `${target.value}${target.unit === undefined ? "" : ` ${target.unit}`}`;
  };
  const label = (constraint: StandardHardConstraintV1): string =>
    `${constraint.field_id} ${constraint.operator} ${targetLabel(constraint)}`;
  const reducingConstraints = hardConstraints
    .filter((constraint) =>
      eliminatedCountByConstraintId.has(constraint.constraint_id),
    )
    .map((constraint) => ({
      constraint_id: constraint.constraint_id,
      field_id: constraint.field_id,
      label: label(constraint),
      eliminated_count: eliminatedCountByConstraintId.get(
        constraint.constraint_id,
      )!,
    }));
  const permittedRelaxations = hardConstraints
    .filter(
      (constraint) =>
        eliminatedCountByConstraintId.has(constraint.constraint_id) &&
        constraint.relaxability === "relaxable",
    )
    .map((constraint) => {
      if (constraint.relaxability !== "relaxable")
        throw new Error("Permitted relaxation lost its canonical marker.");
      return {
        constraint_id: constraint.constraint_id,
        field_id: constraint.field_id,
        label: label(constraint),
        direction: constraint.direction,
        tolerance: constraint.tolerance,
      };
    });

  return {
    reducing_constraints: reducingConstraints,
    unmet_mandatory_constraints:
      outcome === "no_responsible_match"
        ? reducingConstraints.map(({ constraint_id, field_id, label }) => ({
            constraint_id,
            field_id,
            label,
          }))
        : [],
    permitted_relaxations: permittedRelaxations,
  };
}

function buildStandardResultProjection(
  graph: StandardEvidenceGraphV1,
  context: StandardProjectionContext,
): StandardResultProjectionV1 {
  validateStandardEvidenceGraph(graph);
  const evidenceById = new Map(
    graph.evidence.map((item) => [item.evidence_id, item]),
  );
  const claimById = new Map(
    graph.claims.map((claim) => [claim.claim_id, claim]),
  );
  const candidateById = new Map(
    graph.candidates.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const readStatuses = standardEvidenceReadStatuses(
    graph,
    context.now,
    context.volatilityPolicy ?? STANDARD_EVIDENCE_VOLATILITY_POLICY,
  );

  const ranked = graph.eligible_candidate_ids
    .map((candidateId) => {
      const candidate = candidateById.get(candidateId);
      if (!candidate) throw new Error("Eligible candidate is missing.");
      return { candidate, score: scoreStandardCandidate(candidate.dimensions) };
    })
    .sort(
      (left, right) =>
        right.score.compatibilityScore - left.score.compatibilityScore ||
        left.candidate.deterministic_tie_breaker.localeCompare(
          right.candidate.deterministic_tie_breaker,
          "en",
        ),
    )
    .slice(0, 3);

  const candidates: StandardCandidateProjectionV1[] = ranked.map(
    ({ candidate, score }) => {
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
      if (!primaryClaim)
        throw new Error("Candidate rationale claim is missing.");
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
            return (
              status !== "stale" &&
              status !== "conflicting" &&
              status !== "unknown"
            );
          }),
        )
        .map((value): StandardEvidencedValueProjectionV1 => {
          if (
            value.kind === "organization_contact" &&
            value.channel_type === "organization_web"
          )
            return {
              kind: value.kind,
              channel_type: value.channel_type,
              value: value.value,
              organization_domain: value.organization_domain,
              organization_web_policy_version:
                value.organization_web_policy_version,
              organization_web_purpose: value.organization_web_purpose,
              organization_web_form: value.organization_web_form,
              verification_status: value.verification_status,
              evidence_ids: [...value.evidence_ids],
            };
          if (value.kind === "organization_contact")
            return {
              kind: value.kind,
              channel_type: value.channel_type,
              value: value.value,
              organization_domain: value.organization_domain,
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
      const byKind = (kind: (typeof evidencedValues)[number]["kind"]) =>
        evidencedValues.filter((value) => value.kind === kind);
      const contactDetails = byKind("organization_contact");
      const plantIdentifiers = byKind("plant");
      const approvalIdentifiers = byKind("approval");
      const capacityFigures = byKind("capacity");
      const staleCitations = citations.filter(
        (citation) =>
          citation.status === "stale" ||
          citation.access_state === "blocked" ||
          citation.access_state === "unreachable",
      ).length;
      const freshness =
        staleCitations === 0
          ? "current"
          : staleCitations === citations.length
            ? "stale"
            : "mixed";
      return {
        display_name: candidate.display_name,
        country_code: candidate.country_code,
        rationale_extended: candidate.rationale_extended,
        compatibility_score: score.compatibilityScore,
        fit_band: score.fitBand,
        band_ceiling: score.bandCeiling,
        displayed_band: score.displayedBand,
        ...(score.capReason === undefined
          ? {}
          : { band_ceiling_reason: score.capReason }),
        dimension_scores: structuredClone(candidate.dimensions),
        positive_drivers: score.drivers.map(linkExplanation),
        limiting_gaps: score.gaps.map(linkExplanation),
        citations,
        freshness,
        verification_status: projectedStatus(
          candidate.verification_status,
          citations.map((citation) => citation.status),
        ),
        evidence_confidence: candidate.evidence_confidence,
        ...(contactDetails.length === 0
          ? {}
          : { contact_details: contactDetails }),
        ...(plantIdentifiers.length === 0
          ? {}
          : { plant_identifiers: plantIdentifiers }),
        ...(approvalIdentifiers.length === 0
          ? {}
          : { approval_identifiers: approvalIdentifiers }),
        ...(capacityFigures.length === 0
          ? {}
          : { capacity_figures: capacityFigures }),
      };
    },
  );

  const outcome = candidates.length === 0 ? "no_responsible_match" : "matched";
  const scarcity =
    candidates.length === 0
      ? "zero"
      : candidates.length < 3
        ? "limited"
        : "none";
  const evidenceStates = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.citations.map((item) => item.status),
      ),
    ),
  ].sort((left, right) => statusPriority(right) - statusPriority(left));
  const affectedLowConfidenceDimensions = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.dimension_scores
          .filter((dimension) => dimension.confidence === "low")
          .map((dimension) => dimension.dimension_id),
      ),
    ),
  ];
  const capApplies = candidates.some(
    (candidate) => candidate.fit_band !== candidate.displayed_band,
  );
  const projection: StandardResultProjectionV1 = {
    schema_version: "standard-result-projection.v1",
    run_id: graph.run_id,
    outcome,
    scarcity,
    candidates,
    gate_eliminations: graph.gate_evaluations.map((gate) => ({
      gate_id: gate.gate_id,
      label: gate.label,
      eliminated_count: gate.eliminated_count,
    })),
    scarcity_analysis: buildScarcityAnalysis(
      graph,
      context.runBoundCanonicalHardConstraints,
      outcome,
      context.allowLegacyEmptyScarcityLedger ?? false,
    ),
    limitations: {
      unknown_count: graph.unknown_count,
      not_asked_count: graph.not_asked_count,
      affected_low_confidence_dimensions: affectedLowConfidenceDimensions,
      evidence_states: evidenceStates,
      ...(capApplies
        ? {
            cap_notice:
              "One or more displayed bands are capped because at least two critical dimension scores are 45 or lower.",
          }
        : {}),
      restricted_party_screening_notice: STANDARD_SCREENING_NOTICE,
      advisory_boundary: STANDARD_ADVISORY_BOUNDARY,
    },
    synthetic_warning: STANDARD_SYNTHETIC_WARNING,
    projection_version: STANDARD_DISCLOSURE_PROJECTION_VERSION,
  };
  assertStandardProjectionEvidenceLinks(projection, graph);
  assertStandardProjectionSafe(projection);
  return projection;
}

export interface PreparedStandardRelease {
  projection: StandardResultProjectionV1;
  persistence_graph: StandardEvidenceGraphV1;
  persistence_foundation: CompleteResultFoundationV1;
  security_events: StandardPiiSecurityEvent[];
}

export function prepareStandardCompleteResultForPersistence(
  graph: StandardEvidenceGraphV1,
  context: StandardProjectionContext,
): PreparedStandardRelease {
  validateStandardEvidenceGraph(graph);
  const prepared = sanitizeStandardEvidenceGraphForRelease(graph);
  const projection = buildStandardResultProjection(prepared.graph, context);
  assertStandardPiiReleaseSafe(projection);
  prepared.security_events.forEach((event) => context.onSecurityEvent?.(event));
  return {
    projection,
    persistence_graph: prepared.graph,
    persistence_foundation: buildCompleteResultFoundation(prepared.graph),
    security_events: prepared.security_events,
  };
}

export function buildStandardProjection(
  graph: StandardEvidenceGraphV1,
  context: StandardProjectionContext,
): StandardResultProjectionV1 {
  return prepareStandardCompleteResultForPersistence(graph, context).projection;
}

export function assertStandardProjectionEvidenceLinks(
  projection: StandardResultProjectionV1,
  graph: StandardEvidenceGraphV1,
): void {
  const claims = new Map(graph.claims.map((claim) => [claim.claim_id, claim]));
  for (const candidate of projection.candidates) {
    const hidden = graph.candidates.find(
      (item) =>
        item.display_name === candidate.display_name &&
        item.country_code === candidate.country_code,
    );
    if (!hidden) throw new Error("Projected candidate lacks hidden lineage.");
    const citationIds = new Set(
      candidate.citations.map((citation) => citation.evidence_id),
    );
    for (const item of [
      ...candidate.positive_drivers,
      ...candidate.limiting_gaps,
    ]) {
      const claim = claims.get(item.claim_id);
      if (
        !claim ||
        claim.candidate_id !== hidden.candidate_id ||
        item.evidence_ids.length === 0 ||
        !item.evidence_ids.every(
          (id) => claim.evidence_ids.includes(id) && citationIds.has(id),
        )
      ) {
        throw new Error(
          "Projected driver or gap has dangling evidence lineage.",
        );
      }
    }
    for (const value of [
      ...(candidate.contact_details ?? []),
      ...(candidate.plant_identifiers ?? []),
      ...(candidate.approval_identifiers ?? []),
      ...(candidate.capacity_figures ?? []),
    ]) {
      if (
        value.evidence_ids.length === 0 ||
        !value.evidence_ids.every((id) => citationIds.has(id))
      ) {
        throw new Error(
          "Projected commercial value has dangling evidence lineage.",
        );
      }
    }
  }
}
