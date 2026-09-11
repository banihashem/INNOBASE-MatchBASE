"use client";
import type { ResearchReview } from "@matchbase/contracts";

function publicSource(value: string): boolean {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** MB-UX-QUALITY-001 L01: leads remain separate from documented supplier results. */
export function ResearchReviewPanel({
  review,
  selectedIds = [],
  onSelect,
  disabled = false,
}: {
  review: ResearchReview;
  selectedIds?: string[];
  onSelect?: ((id: string, selected: boolean) => void) | undefined;
  disabled?: boolean;
}) {
  return (
    <section
      aria-label={`Research review for round ${review.round_number}`}
      className="space-y-4 rounded-lg border border-slate-600 p-4"
    >
      <div>
        <h3 className="text-lg font-semibold">
          Research review · round {review.round_number}
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          Documented suppliers remain in the saved results and PDF. The leads
          below are research records with incomplete evidence or an exclusion
          reason; they are not documented suppliers.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {(
          [
            ["Discovered", review.summary.discovered],
            ["Documented", review.summary.documented],
            ["Needs review", review.summary.needs_review],
            ["Excluded", review.summary.excluded],
          ] as const
        ).map(([label, count]) => (
          <div key={label}>
            <dt className="text-slate-300">{label}</dt>
            <dd className="text-xl font-semibold">{count}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-slate-300">
        New leads this round: {review.changes.new_leads} · Promoted to
        documented suppliers: {review.changes.promoted}
      </p>
      {review.coverage_gaps.length > 0 && (
        <div>
          <h4 className="font-semibold">Unresolved research coverage</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {review.coverage_gaps.map((gap, index) => (
              <li dir="auto" key={index}>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.leads.length === 0 ? (
        <p className="text-sm text-slate-300">
          No incomplete or excluded leads were retained for this round.
        </p>
      ) : (
        <details>
          <summary className="cursor-pointer font-semibold">
            Incomplete research leads · {review.leads.length} ·{" "}
            {onSelect ? "review sources and select focus" : "review sources"}
          </summary>
          <ul className="space-y-3 mt-3">
            {review.leads.map((lead) => (
              <li
                key={lead.lead_id}
                className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h5 className="font-semibold break-words" dir="auto">
                    {lead.name}
                  </h5>
                  <span className="text-sm text-amber-200">
                    {lead.status === "excluded" ? "Excluded" : "Needs review"}
                  </span>
                </div>
                <p className="text-sm" dir="auto">
                  {lead.reason}
                </p>
                {lead.missing_evidence.length > 0 && (
                  <div className="text-sm">
                    <p className="font-semibold">Missing evidence</p>
                    <ul className="list-disc pl-5">
                      {lead.missing_evidence.map((item, index) => (
                        <li key={index} dir="auto">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lead.website_url && publicSource(lead.website_url) && (
                  <a
                    href={lead.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all text-sm text-sky-300 underline"
                  >
                    Company website: {lead.website_url}
                  </a>
                )}
                <div className="text-sm">
                  <p className="font-semibold">Retained sources</p>
                  {lead.source_urls.filter(publicSource).length ? (
                    <ul className="space-y-1">
                      {lead.source_urls
                        .filter(publicSource)
                        .map((url, index) => (
                          <li key={index}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all text-sky-300 underline"
                            >
                              {url}
                            </a>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-slate-300">
                      No usable source link retained.
                    </p>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  First seen: round {lead.first_seen_round} · Last seen: round{" "}
                  {lead.last_seen_round}
                </p>
                {onSelect && (
                  <label className="flex items-center gap-2 py-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={selectedIds.includes(lead.lead_id)}
                      onChange={(event) =>
                        onSelect(lead.lead_id, event.target.checked)
                      }
                      aria-label={`Include ${lead.name} in follow-up focus`}
                    />
                    Include in follow-up focus
                  </label>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
