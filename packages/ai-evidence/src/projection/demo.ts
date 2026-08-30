import type { DemoProjectionV1, EvidenceGraphV1 } from "@matchbase/contracts";
import { validateEvidenceGraph } from "../evidence/integrity.js";

const restrictedKeys = new Set([
  "compatibility_score",
  "compatibilityScore",
  "fit_band",
  "fitBand",
  "band_ceiling",
  "bandCeiling",
  "displayed_band",
  "displayedBand",
  "dimension_scores",
  "dimensionScores",
  "citations",
  "verification_status",
  "verificationStatus",
  "evidence_items",
  "evidence",
  "counts",
  "candidates_discovered",
  "reserve_candidates",
  "artifacts",
  "pdf",
]);

export function findRestrictedProjectionKeys(value: unknown): string[] {
  const findings = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      if (restrictedKeys.has(key)) findings.add(key);
      visit(nested);
    }
  };
  visit(value);
  return [...findings].sort();
}

export function assertDemoProjectionSafe(value: unknown): void {
  const findings = findRestrictedProjectionKeys(value);
  if (findings.length > 0) {
    throw new Error(
      `Demo projection contains restricted keys: ${findings.join(", ")}.`,
    );
  }
}

export function buildDemoProjection(
  graph: EvidenceGraphV1,
  runBoundMandatoryConstraints: readonly string[],
): Omit<DemoProjectionV1, "limitations_notice"> {
  validateEvidenceGraph(graph);
  const mandatoryConstraints = [
    ...new Set(
      runBoundMandatoryConstraints.map((constraint) => constraint.trim()),
    ),
  ];
  if (mandatoryConstraints.some((constraint) => constraint.length === 0))
    throw new Error("Run-bound mandatory constraints must be non-empty.");
  const byId = new Map(
    graph.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const eligible = graph.eligibleCandidateIds.map((id) => {
    const candidate = byId.get(id);
    if (!candidate)
      throw new Error("Eligible candidate is missing from the graph.");
    return candidate;
  });
  const candidates = eligible.slice(0, 3).map((candidate) => ({
    display_name: candidate.displayName,
    country_code: candidate.countryCode,
    rationale_short: candidate.rationaleShort,
  }));
  const outcome = candidates.length === 0 ? "no_responsible_match" : "matched";
  const scarcity =
    candidates.length === 0
      ? "zero"
      : candidates.length < 3
        ? "limited"
        : "none";
  if (outcome === "no_responsible_match" && mandatoryConstraints.length === 0)
    throw new Error(
      "A Demo no-match projection requires run-bound mandatory constraints.",
    );
  return {
    schema_version: "demo-projection.v1",
    run_id: graph.runId,
    outcome,
    scarcity,
    candidates,
    unmet_mandatory_constraints:
      outcome === "no_responsible_match" ? mandatoryConstraints : [],
    projection_version: 1,
  };
}
