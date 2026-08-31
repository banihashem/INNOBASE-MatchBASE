import type { EvidenceGraphV1, EvidenceItemV1 } from "@matchbase/contracts";

export interface LiveSourceBindingRecord {
  readonly evidenceId: string;
  readonly canonicalUrl: string;
  readonly publisherDomain: string;
  readonly retrievedAt: string;
  readonly contentSha256: string;
  readonly boundedExcerpt: string;
}

const bindingFailure = (): Error =>
  new Error("Live evidence output is not exactly bound to a fetched source.");

function publisherDomainFromCanonicalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== "" ||
      parsed.href !== value ||
      !parsed.hostname
    )
      return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

function validatedSourceMap(
  sourceRecords: readonly LiveSourceBindingRecord[],
): Map<string, LiveSourceBindingRecord> {
  const sourceByEvidenceId = new Map<string, LiveSourceBindingRecord>();
  for (const source of sourceRecords) {
    if (!source.evidenceId || sourceByEvidenceId.has(source.evidenceId))
      throw bindingFailure();
    const derivedDomain = publisherDomainFromCanonicalUrl(source.canonicalUrl);
    if (
      derivedDomain === null ||
      source.publisherDomain !== derivedDomain ||
      !source.retrievedAt ||
      !/^[a-f0-9]{64}$/u.test(source.contentSha256) ||
      !source.boundedExcerpt
    )
      throw bindingFailure();
    sourceByEvidenceId.set(source.evidenceId, source);
  }
  return sourceByEvidenceId;
}

/**
 * Replaces provider-authored source facts with the complete server-owned fetch
 * ledger. Evidence use is derived only from claim lineage; fetched but unused
 * sources are retained with a deterministic exclusion reason.
 */
export function bindServerOwnedLiveEvidenceGraph(
  value: unknown,
  sourceRecords: readonly LiveSourceBindingRecord[],
  identity: Readonly<{ runId: string; capturedAt: string }>,
): EvidenceGraphV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw bindingFailure();
  const graph = value as Record<string, unknown>;
  const claims = Array.isArray(graph.claims) ? graph.claims : [];
  const usedEvidenceIds = new Set<string>();
  for (const claim of claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) continue;
    const evidenceIds = (claim as Record<string, unknown>).evidenceIds;
    if (!Array.isArray(evidenceIds)) continue;
    for (const evidenceId of evidenceIds) {
      if (typeof evidenceId === "string") usedEvidenceIds.add(evidenceId);
    }
  }
  const sources = validatedSourceMap(sourceRecords);
  const evidence: EvidenceItemV1[] = [...sources.values()].map((source) => {
    const accepted = usedEvidenceIds.has(source.evidenceId);
    return {
      evidenceId: source.evidenceId,
      sourceKind: "external_url",
      url: source.canonicalUrl,
      title: "",
      publisher: "",
      publisherDomain: source.publisherDomain,
      retrievedAt: source.retrievedAt,
      contentSha256: source.contentSha256,
      extract: source.boundedExcerpt,
      verificationDisposition: accepted ? "accepted" : "excluded",
      exclusionReason: accepted
        ? ""
        : claims.length === 0
          ? "insufficient_mandatory_constraint_support"
          : "not_used_in_candidate_rationale",
    };
  });
  return {
    ...graph,
    schemaVersion: "evidence-graph.v1",
    runId: identity.runId,
    gateEvaluationCompletedAt: identity.capturedAt,
    evidence,
  } as unknown as EvidenceGraphV1;
}

/**
 * Binds provider-authored evidence references to the server-owned fetch record.
 * Display title and publisher text are intentionally outside this trust check.
 */
export function assertLiveEvidenceSourceBindings(
  evidenceItems: readonly EvidenceItemV1[],
  sourceRecords: readonly LiveSourceBindingRecord[],
): void {
  const sourceByEvidenceId = validatedSourceMap(sourceRecords);

  const seenEvidenceIds = new Set<string>();
  for (const evidence of evidenceItems) {
    const source = sourceByEvidenceId.get(evidence.evidenceId);
    if (
      !evidence.evidenceId ||
      seenEvidenceIds.has(evidence.evidenceId) ||
      evidence.sourceKind !== "external_url" ||
      !source ||
      evidence.url !== source.canonicalUrl ||
      evidence.publisherDomain !== source.publisherDomain ||
      evidence.retrievedAt !== source.retrievedAt ||
      evidence.contentSha256 !== source.contentSha256 ||
      evidence.extract !== source.boundedExcerpt
    )
      throw bindingFailure();
    seenEvidenceIds.add(evidence.evidenceId);
  }
  if (seenEvidenceIds.size !== sourceByEvidenceId.size) throw bindingFailure();
}
