import type { ResearchReview } from "@matchbase/contracts";

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Original source language remains in storage; report projection never invents a translation. */
const english = (value: string): string =>
  /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value)
    ? "Original-language detail retained in saved research; English interpretation unavailable."
    : value;
const text = (value: string): string => escapeHtml(english(value));
const list = (values: string[]): string =>
  values.length
    ? `<ul>${values.map((value) => `<li>${text(value)}</li>`).join("")}</ul>`
    : "<p>None recorded.</p>";
const sourceLink = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return "<span>Source link unavailable.</span>";
    return `<a href="${escapeHtml(parsed.href)}">${text(parsed.href)}</a>`;
  } catch {
    return "<span>Source link unavailable.</span>";
  }
};

/** MB-UX-QUALITY-001 L11: cited hypotheses and collected references never become assessed supplier facts. */
export function renderResearchReview(review: ResearchReview): string {
  const insights = [
    ...new Map(
      [
        ...(review.evidence_memory?.relationships ?? []),
        ...(review.focus_analysis?.insights ?? []),
      ].map((insight) => [insight.insight_id, insight]),
    ).values(),
  ];
  const entities = new Map([
    ...review.leads.map((lead) => [lead.lead_id, lead.name] as const),
    ...(review.evidence_memory?.entities ?? []).map(
      (entity) => [entity.lead_id, entity.name] as const,
    ),
  ]);
  const hypotheses = insights.length
    ? insights
        .map(
          (insight) =>
            `<article><h3>${text(insight.next_question)}</h3><p><b>Research hypothesis - verification required.</b> ${text(insight.statement)}</p><p>Related research records: ${text(insight.lead_ids.map((id) => entities.get(id) ?? "Saved research record").join("; "))}</p><p>Sources behind this question:</p><ul>${insight.source_urls.map((url) => `<li>${sourceLink(url)}</li>`).join("")}</ul></article>`,
        )
        .join("")
    : "<p>No source-backed research hypotheses were retained.</p>";
  const methods = (review.method_reviews ?? [])
    .map(
      (method) =>
        `<article><h3>${method.method === "public_social" ? "Public corporate and social sources" : "Country and institutional sources"} - round ${method.round_number}</h3><p>${method.status === "references_found" ? `${method.sources.length} collected reference(s).` : method.status === "no_cited_sources" ? "No cited sources collected." : "Research incomplete."} Search recorded: ${escapeHtml(method.searched_at)}.</p><h3>Coverage limits</h3>${list(method.limitations)}${method.sources.map((source) => `<div class="source"><h3>${text(source.title)}</h3><p>${sourceLink(source.url)}</p><p>${source.access === "retrieved" ? "Source content retrieved - claims still need assessment." : source.access === "provider_citation_only" ? "Search-provider citation only - full content not retrieved." : "Access limited - source content not confirmed."} Retrieved at: ${escapeHtml(source.retrieved_at ?? "Not recorded")}. Retrieval time is not the publication or record date.</p><p>${text(source.excerpt)}</p></div>`).join("")}</article>`,
    )
    .join("");
  const leads = review.leads
    .map(
      (lead) =>
        `<article><h3>${text(lead.name)}</h3><p>${lead.status === "excluded" ? "Excluded" : "Needs review"}: ${text(lead.reason)}</p><p>First seen: round ${lead.first_seen_round}. Last seen: round ${lead.last_seen_round}.</p><h3>Missing evidence</h3>${list(lead.missing_evidence)}<p>Retained sources:</p><ul>${lead.source_urls.map((url) => `<li>${sourceLink(url)}</li>`).join("")}</ul></article>`,
    )
    .join("");
  return `<p>Round ${review.round_number} saved review. Discovered: ${review.summary.discovered}; documented suppliers: ${review.summary.documented}; needs review: ${review.summary.needs_review}; excluded: ${review.summary.excluded}.</p><p>Changes in this round: ${review.changes.new_leads} new leads; ${review.changes.promoted} promoted to documented suppliers. Additional research may reveal contradictions or access limits; these counts do not measure a guaranteed quality improvement.</p><h2>Research questions from connected findings</h2><p>These are research hypotheses to verify, not established company, ownership or capability facts. They guide the next approved research round alongside the buyer's focus. Shared or repeated sources may not be independent evidence.</p>${hypotheses}<h2>Public and institutional research sources</h2><p>A collected reference is not necessarily a confirmed corporate profile or official company record. Check entity identity, issuer, jurisdiction, date and what each source supports. Aggregate trade statistics provide market context and do not establish a supplier's shipments. Missing records do not establish ineligibility.</p>${methods || "<p>No dedicated method review was retained with this historical result.</p>"}<h2>Unresolved research coverage</h2>${list([...new Set([...review.coverage_gaps, ...(review.evidence_memory?.limitations ?? [])])])}<h2>Incomplete and excluded research leads</h2><p>These research records are separate from documented supplier dossiers. Their evidence is incomplete or an exclusion reason remains recorded.</p>${leads || "<p>No incomplete or excluded leads were retained.</p>"}`;
}
