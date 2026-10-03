import type { SearchDimensionAssessment } from "@matchbase/contracts";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
// Use the same report-only language boundary as the saved research review.
const english = (value: string): string =>
  /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(
    value.replace(/[\u03a9\u03bc]/gu, ""),
  )
    ? "Original-language detail retained; English interpretation unavailable."
    : value;
const text = (value: unknown): string =>
  escapeHtml(
    english(typeof value === "string" ? value : JSON.stringify(value)),
  );
function sourceLink(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "Source unavailable";
    return `<a href="${escapeHtml(url.href)}">${text(url.hostname)}</a>`;
  } catch {
    return "Source unavailable";
  }
}

/** Render the persisted assessments verbatim; PDF presentation never recalculates supplier fit. */
export function renderSearchDimensionAssessment(
  assessment: SearchDimensionAssessment,
): string {
  return `<h2>Selected search dimensions</h2><p>Dimension disposition: ${text(assessment.eligibility.replaceAll("_", " "))}. Grounded: ${text(assessment.coverage.grounded)} of ${text(assessment.coverage.active)} active dimensions. Research-only observations do not establish fit. Arbitrary dimension-labelled claims remain unassessed until their meaning and scope are verified; retained claims appear in the claim-level evidence table.</p><table><thead><tr><th>Dimension / scope</th><th>Requested / observed</th><th>Status / evidence</th></tr></thead><tbody>${assessment.dimensions.map((row) => `<tr><td>${text(row.label)}<br><small>${text(row.severity)}; lot ${text(row.scope.lot_id)}; subject ${text(row.scope.subject_id)}</small></td><td>${row.expected === undefined ? "Research question" : `Requested: ${text(row.expected)}`}<br>${row.observed_values.length ? row.observed_values.map((value) => text(value)).join("; ") : "No admitted observation"}${row.unit ? ` ${text(row.unit)}` : ""}</td><td>${text(row.outcome)} / ${text(row.execution_status)}<br>${text(row.reason)}<br>${row.source_refs.map(sourceLink).join("; ") || "No admitted source"}</td></tr>`).join("")}</tbody></table><p class="muted">Pinned plan: ${text(assessment.plan_hash)}. Evaluated: ${text(assessment.evaluated_at)}. Existing supplier scores and rankings are unchanged by this coverage table.</p>`;
}
