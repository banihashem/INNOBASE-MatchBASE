import type {
  PublicSocialCheckV3,
  ResearchRoundPlan,
} from "@matchbase/contracts";
import type { DualLaneExecutionResult } from "./dual-lane-orchestrator.js";
import { safePublicEvidenceUrl } from "./openrouter-model-policy.js";
import { requiresPublicSocialReview } from "./progressive-research-policy.js";

function socialUrl(value: string): string | null {
  const safe = safePublicEvidenceUrl(value);
  return safe &&
    /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|youtube\.com|x\.com|twitter\.com|tiktok\.com)$/.test(
      new URL(safe).hostname,
    )
    ? safe
    : null;
}
const validDate = (value: string | undefined | null): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

/** MB-UX-QUALITY-001 L11: source association and this-round retrieval are separate evidence requirements. */
export function buildPublicSocialChecks(
  plan: Pick<ResearchRoundPlan, "round_number" | "research_strategy">,
  result: Pick<
    DualLaneExecutionResult,
    | "candidates"
    | "claims"
    | "evidence_sources"
    | "checkpoints"
    | "continuation"
  >,
  recordedAt: string,
): PublicSocialCheckV3[] {
  if (!requiresPublicSocialReview(plan)) return [];
  const observations = new Map<
    string,
    {
      status: "reviewed" | "access_limited";
      at: string;
      limitation: string;
    }
  >();
  for (const event of result.checkpoints) {
    if (
      event.phase !== "source_retrieval" ||
      event.state !== "completed" ||
      !validDate(event.started_at) ||
      !validDate(event.completed_at) ||
      Date.parse(event.completed_at) < Date.parse(event.started_at)
    )
      continue;
    const succeeded =
      !event.error && /^[a-f0-9]{64}$/i.test(event.content_sha256 ?? "");
    if (!succeeded && !event.error) continue;
    // An unsuccessful original-page attempt cannot attest to an unvisited redirect.
    for (const value of succeeded
      ? event.evidence_urls
      : event.evidence_urls.slice(0, 1)) {
      const url = socialUrl(value);
      if (
        !url ||
        Date.parse(observations.get(url)?.at ?? "1970-01-01") >
          Date.parse(event.completed_at)
      )
        continue;
      observations.set(url, {
        status: succeeded ? "reviewed" : "access_limited",
        at: event.completed_at,
        limitation: succeeded
          ? "Original source content was retrieved in this round. This does not independently establish corporate profile ownership or verify every claim."
          : "The original page could not be retrieved in this round. Earlier evidence remains retained; current page content is not confirmed.",
      });
    }
  }
  for (const method of result.continuation?.method_reviews ?? []) {
    if (
      method.method !== "public_social" ||
      method.round_number !== plan.round_number ||
      !validDate(method.searched_at)
    )
      continue;
    for (const source of method.sources) {
      const url = socialUrl(source.url);
      if (!url || observations.has(url)) continue;
      const currentRetrieval =
        source.access === "retrieved" &&
        validDate(source.retrieved_at) &&
        Date.parse(source.retrieved_at) >= Date.parse(method.searched_at);
      if (source.access === "retrieved" && !currentRetrieval) continue;
      observations.set(url, {
        status: currentRetrieval ? "reviewed" : "access_limited",
        at: currentRetrieval ? source.retrieved_at! : method.searched_at,
        limitation: currentRetrieval
          ? "The current-round public-source search records original content retrieval. Source-to-company association does not establish profile ownership or verify every claim."
          : source.access === "provider_citation_only"
            ? "Only a current search-provider citation is available; the original page was not retrieved. This does not establish that access was blocked."
            : "The current public-source search records limited access. Original page content and corporate profile ownership are not confirmed.",
      });
    }
  }
  const sourceUrls = new Map(
    result.evidence_sources.map((source) => [
      source.evidence_id,
      source.source_url,
    ]),
  );
  const checks: PublicSocialCheckV3[] = [];
  for (const supplier of result.candidates) {
    const evidenceIds = new Set([
      ...supplier.identity_evidence_ids,
      ...result.claims
        .filter(
          (claim) => claim.supplier_entity_id === supplier.supplier_entity_id,
        )
        .flatMap((claim) => claim.evidence_ids),
    ]);
    const urls = [
      ...new Set(
        [...evidenceIds].flatMap((id) => {
          const source = sourceUrls.get(id);
          const url = source && socialUrl(source);
          return url ? [url] : [];
        }),
      ),
    ];
    for (const url of urls) {
      const observed = observations.get(url);
      checks.push({
        supplier_name: supplier.legal_name,
        profile_url: url,
        status: observed?.status ?? "not_executed",
        ownership_basis:
          "Associated with the supplier through accepted claim evidence; corporate profile ownership is not independently established.",
        checked_at: observed?.at ?? recordedAt,
        limitation:
          observed?.limitation ??
          "Previously retained supplier-linked evidence is available, but no original-page review is recorded for this URL in this round. This timestamp records the review status, not a new source retrieval.",
      });
    }
    if (!urls.length)
      checks.push({
        supplier_name: supplier.legal_name,
        profile_url: null,
        status: "not_executed",
        ownership_basis:
          "No accepted supplier-linked public social source was available for this review.",
        checked_at: recordedAt,
        limitation:
          "Method-search references may be available separately. Query scope does not prove a source belongs to this company. This does not mean the company lacks social profiles; missing profiles do not reduce supplier eligibility.",
      });
  }
  return checks;
}
