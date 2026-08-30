import type { EvidenceItemV1 } from "@matchbase/contracts";

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

/**
 * Binds provider-authored evidence references to the server-owned fetch record.
 * Display title and publisher text are intentionally outside this trust check.
 */
export function assertLiveEvidenceSourceBindings(
  evidenceItems: readonly EvidenceItemV1[],
  sourceRecords: readonly LiveSourceBindingRecord[],
): void {
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
}
