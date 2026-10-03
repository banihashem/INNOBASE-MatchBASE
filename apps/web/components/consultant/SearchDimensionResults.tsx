"use client";
import { useState } from "react";
import type {
  SearchDimensionAssessment,
  SearchDimensionPlan,
  ClaimV3,
} from "@matchbase/contracts";

function sourceHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Use the persisted assessment in every view; never infer fit from the display. */
export function SearchDimensionResults({
  assessment,
  claims = [],
}: {
  assessment?: SearchDimensionAssessment | undefined;
  claims?: readonly ClaimV3[];
}) {
  const [query, setQuery] = useState("");
  if (!assessment) return null;
  const rows = assessment.dimensions.filter((row) =>
    row.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details className="rounded-lg border border-slate-600 bg-slate-900/40 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">
        Search dimension evidence · {assessment.coverage.grounded} of{" "}
        {assessment.coverage.active} with admitted observations
      </summary>
      <p className="my-3 text-slate-300">
        This table uses the saved round. A research question can have evidence
        while its fit remains unknown. Unassessed criteria require review; the
        supplier score is a separate measure.
      </p>
      <label className="block">
        Find a dimension
        <input
          className="mt-1 mb-3 w-full rounded border border-slate-500 bg-slate-950 p-2 text-white"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul
        className="max-h-96 space-y-3 overflow-auto pr-2"
        aria-label="Saved dimension assessments"
      >
        {rows.map((row) => {
          const clues = claims.filter(
            (claim) =>
              claim.supplier_entity_id === assessment.entity_id &&
              claim.field_path === `search_dimensions.${row.dimension_id}`,
          );
          return (
            <li
              key={row.selection_id}
              className="rounded border border-slate-600 p-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{row.label}</strong>
                <span>{row.outcome.replaceAll("_", " ")}</span>
              </div>
              <p className="text-xs text-slate-400">
                {row.severity} · {row.kind.replaceAll("_", " ")} ·{" "}
                {row.applicability} ·{" "}
                {row.execution_status.replaceAll("_", " ")}
              </p>
              <p className="mt-2">
                Requested:{" "}
                {row.expected === undefined
                  ? "Research question"
                  : JSON.stringify(row.expected)}
                {row.unit ? ` ${row.unit}` : ""}
              </p>
              <p>
                Observed:{" "}
                {row.observed_values.length
                  ? row.observed_values
                      .map((value) =>
                        typeof value === "string"
                          ? value
                          : JSON.stringify(value),
                      )
                      .join("; ")
                  : "No admitted observation"}
              </p>
              <p className="text-xs text-slate-400">{row.reason}</p>
              <p className="text-xs">
                Scope: {row.scope.lot_id} / {row.scope.subject_id}
              </p>
              <div className="mt-1 flex flex-wrap gap-3">
                {row.source_refs.map((source) => {
                  const href = sourceHref(source);
                  return href ? (
                    <a
                      key={source}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 underline"
                    >
                      {new URL(href).hostname}
                    </a>
                  ) : null;
                })}
              </div>
              {clues.length > 0 && (
                <details className="mt-2">
                  <summary>
                    Collected source claims requiring semantic review (
                    {clues.length})
                  </summary>
                  <p className="text-xs text-slate-400">
                    These literal source claims do not yet establish this
                    criterion's meaning or exact scope.
                  </p>
                  <ul>
                    {clues.map((claim) => (
                      <li key={claim.claim_id} className="mt-1">
                        {claim.claim_text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {!rows.length && <p>No selected dimension matches this filter.</p>}
      <p className="mt-2 text-xs text-slate-400">
        Evidence assessed at{" "}
        {new Date(assessment.evaluated_at).toLocaleString()}. Undetermined
        applicability: {assessment.coverage.undetermined}.
      </p>
    </details>
  );
}

export function SearchDimensionPlanSummary({
  plan,
}: {
  plan?: SearchDimensionPlan | undefined;
}) {
  if (!plan) return null;
  const active = plan.dimensions.filter((entry) => entry.selection.active);
  return (
    <div className="rounded-lg border border-slate-600 p-3 text-sm">
      <strong>Approved search scope</strong>
      <p>
        {active.length} active dimensions ·{" "}
        {plan.profiles.map((profile) => profile.label).join("; ")}
      </p>
      <p className="mt-1 text-slate-400">
        Each profile guides research. It does not establish an official industry
        classification or supplier capability.
      </p>
    </div>
  );
}
