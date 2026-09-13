"use client";
import type { ResearchReview } from "@matchbase/contracts";

function publicSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
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
  const insights = [
    ...new Map(
      [
        ...(review.evidence_memory?.relationships ?? []),
        ...(review.focus_analysis?.insights ?? []),
      ].map((insight) => [insight.insight_id, insight]),
    ).values(),
  ];
  const entityNames = new Map([
    ...review.leads.map((lead) => [lead.lead_id, lead.name] as const),
    ...(review.evidence_memory?.entities ?? []).map(
      (entity) => [entity.lead_id, entity.name] as const,
    ),
  ]);
  const coverageLimits = [
    ...new Set([
      ...review.coverage_gaps,
      ...(review.evidence_memory?.limitations ?? []),
    ]),
  ];
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
      {insights.length > 0 && (
        <section
          aria-label="Research questions from connected findings"
          className="space-y-3"
        >
          <h4 className="font-semibold">
            Research questions from connected findings
          </h4>
          <p className="text-sm text-slate-300">
            These are research hypotheses to verify, not established company,
            ownership or capability facts. The next approved round can
            investigate them alongside your focus. Shared or repeated sources
            may not be independent evidence.
          </p>
          <ol className="space-y-3">
            {insights.map((insight) => (
              <li
                key={insight.insight_id}
                className="rounded border border-slate-700 bg-slate-800 p-3 space-y-2 text-sm"
              >
                <p className="text-amber-200">
                  Research hypothesis · verification required
                </p>
                <h5 className="font-semibold" dir="auto">
                  {insight.next_question}
                </h5>
                <p dir="auto">{insight.statement}</p>
                <p className="text-slate-300">
                  Related research records:{" "}
                  {insight.lead_ids
                    .map((id) => entityNames.get(id) ?? "Saved research record")
                    .join("; ")}
                </p>
                <p className="font-semibold">Sources behind this question</p>
                <ul className="space-y-1">
                  {insight.source_urls.filter(publicSource).map((url) => (
                    <li key={url}>
                      <a
                        className="break-all text-sky-300 underline"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!!review.method_reviews?.length && (
        <section
          aria-label="Public and institutional research sources"
          className="space-y-3"
        >
          <h4 className="font-semibold">
            Public and institutional research sources
          </h4>
          <p className="text-sm text-slate-300">
            A collected reference is not necessarily a confirmed corporate
            profile or official company record. Check the entity, issuer,
            jurisdiction, date and what the source actually supports. Missing
            records do not establish that a company is ineligible.
          </p>
          {review.method_reviews.map((method, index) => (
            <details
              key={`${method.method}-${method.round_number}-${index}`}
              className="rounded border border-slate-700 p-3"
            >
              <summary className="cursor-pointer font-semibold">
                {method.method === "public_social"
                  ? "Public corporate and social sources"
                  : "Country and institutional sources"}
                {" · Round "}
                {method.round_number}
                {" · "}
                {method.status === "references_found"
                  ? `${method.sources.length} collected reference(s)`
                  : method.status === "no_cited_sources"
                    ? "No cited sources collected"
                    : "Research incomplete"}
              </summary>
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-slate-300">
                  Search recorded: {method.searched_at}
                </p>
                {method.limitations.length > 0 && (
                  <div>
                    <p className="font-semibold">Coverage limits</p>
                    <ul className="list-disc pl-5">
                      {method.limitations.map((limit, i) => (
                        <li dir="auto" key={i}>
                          {limit}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {method.sources.map((source, i) => (
                  <article
                    key={`${source.url}-${i}`}
                    className="border-t border-slate-700 pt-3 space-y-1"
                  >
                    <h5 className="font-semibold break-words" dir="auto">
                      {source.title}
                    </h5>
                    {publicSource(source.url) && (
                      <a
                        className="block break-all text-sky-300 underline"
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.url}
                      </a>
                    )}
                    <p className="text-amber-200">
                      {source.access === "retrieved"
                        ? "Source content retrieved · claims still need assessment"
                        : source.access === "provider_citation_only"
                          ? "Search-provider citation only · full content not retrieved"
                          : "Access limited · source content not confirmed"}
                    </p>
                    <p>
                      Retrieved at: {source.retrieved_at ?? "Not recorded"}.
                      Retrieval time is not the publication or record date.
                    </p>
                    {source.excerpt && (
                      <p className="whitespace-pre-wrap break-words" dir="auto">
                        {source.excerpt}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}
      {coverageLimits.length > 0 && (
        <div>
          <h4 className="font-semibold">Unresolved research coverage</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {coverageLimits.map((gap, index) => (
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
