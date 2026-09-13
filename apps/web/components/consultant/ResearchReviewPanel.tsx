"use client";
import { useId, useRef, useState } from "react";
import type { ResearchReview } from "@matchbase/contracts";

const PAGE_SIZE = 5;
const QUESTION_PAGE_SIZE = 3;
const controlClass =
  "min-h-11 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-50";
const disclosureClass =
  "cursor-pointer break-words rounded py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";

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

/** MB-UX-SIMPLIFY-001 L01: review retained leads without obscuring supplier results. */
export function ResearchReviewPanel({
  review,
  selectedIds = [],
  onSelect,
  onSelectMany,
  onUseQuestion,
  disabled = false,
}: {
  review: ResearchReview;
  selectedIds?: string[];
  onSelect?: ((id: string, selected: boolean) => void) | undefined;
  onSelectMany?: ((ids: string[], selected: boolean) => void) | undefined;
  onUseQuestion?: ((question: string) => void) | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [questionPage, setQuestionPage] = useState(0);
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
  const selected = new Set(selectedIds);
  const selectedCount = review.leads.filter((lead) =>
    selected.has(lead.lead_id),
  ).length;
  const searchTerms = search
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const filteredLeads = review.leads.filter((lead) => {
    if (filter === "selected" && !selected.has(lead.lead_id)) return false;
    if (filter === "needs_review" && lead.status !== "needs_review")
      return false;
    if (filter === "excluded" && lead.status !== "excluded") return false;
    const searchable = [
      lead.name,
      lead.reason,
      lead.website_url ?? "",
      ...lead.missing_evidence,
      ...lead.source_urls,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchTerms.every((term) => searchable.includes(term));
  });
  const lastPage = Math.max(0, Math.ceil(filteredLeads.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleLeads = filteredLeads.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const visibleSelectedCount = visibleLeads.filter((lead) =>
    selected.has(lead.lead_id),
  ).length;
  const canSelect = Boolean(onSelect || onSelectMany);
  const currentQuestionPage = Math.min(
    questionPage,
    Math.max(0, Math.ceil(insights.length / QUESTION_PAGE_SIZE) - 1),
  );
  const visibleInsights = insights.slice(
    currentQuestionPage * QUESTION_PAGE_SIZE,
    (currentQuestionPage + 1) * QUESTION_PAGE_SIZE,
  );
  function selectVisible(nextSelected: boolean) {
    const ids = visibleLeads
      .filter((lead) => selected.has(lead.lead_id) !== nextSelected)
      .map((lead) => lead.lead_id);
    if (disabled || !ids.length) return;
    if (onSelectMany) onSelectMany(ids, nextSelected);
    else ids.forEach((leadId) => onSelect?.(leadId, nextSelected));
  }
  function resetFilters() {
    setSearch("");
    setFilter("all");
    setPage(0);
    searchInput.current?.focus();
  }
  return (
    <section
      aria-label={`Research review for round ${review.round_number}`}
      className="min-w-0 space-y-4 rounded-lg border border-slate-600 p-4"
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
        <details className="border-t border-slate-700">
          <summary className={disclosureClass}>
            <h4 className="inline">
              Research questions from connected findings · {insights.length}
            </h4>
          </summary>
          <section
            aria-label="Research questions from connected findings"
            className="space-y-3 pb-3"
          >
            <p className="text-sm text-slate-300">
              These are research hypotheses to verify, not established company,
              ownership or capability facts. The next approved round can
              investigate them alongside your focus. Shared or repeated sources
              may not be independent evidence.
            </p>
            <ol className="space-y-3">
              {visibleInsights.map((insight) => (
                <li
                  key={insight.insight_id}
                  className="rounded border border-slate-700 bg-slate-800 p-3 space-y-2 text-sm"
                >
                  <p className="text-amber-200">
                    Research hypothesis · verification required
                  </p>
                  <details>
                    <summary className={disclosureClass} dir="auto">
                      {insight.next_question}
                    </summary>
                    <p dir="auto">{insight.statement}</p>
                    <p className="text-slate-300">
                      Related research records:{" "}
                      {insight.lead_ids
                        .map(
                          (id) =>
                            entityNames.get(id) ?? "Saved research record",
                        )
                        .join("; ")}
                    </p>
                    <p className="font-semibold">
                      Sources behind this question
                    </p>
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
                  </details>
                  {onUseQuestion &&
                    insight.source_urls.some(publicSource) &&
                    insight.next_question.trim() && (
                      <button
                        type="button"
                        className={controlClass}
                        disabled={disabled}
                        onClick={() => onUseQuestion(insight.next_question)}
                        aria-label={`Use research question: ${insight.next_question}`}
                      >
                        Use this question
                      </button>
                    )}
                </li>
              ))}
            </ol>
            {insights.length > QUESTION_PAGE_SIZE && (
              <nav
                aria-label="Research question pages"
                className="flex flex-wrap items-center gap-3"
              >
                <button
                  type="button"
                  className={controlClass}
                  disabled={currentQuestionPage === 0}
                  onClick={() => setQuestionPage(currentQuestionPage - 1)}
                >
                  Previous questions
                </button>
                <span className="text-sm text-slate-300" role="status">
                  Questions {currentQuestionPage * QUESTION_PAGE_SIZE + 1}–
                  {Math.min(
                    (currentQuestionPage + 1) * QUESTION_PAGE_SIZE,
                    insights.length,
                  )}{" "}
                  of {insights.length}
                </span>
                <button
                  type="button"
                  className={controlClass}
                  disabled={
                    (currentQuestionPage + 1) * QUESTION_PAGE_SIZE >=
                    insights.length
                  }
                  onClick={() => setQuestionPage(currentQuestionPage + 1)}
                >
                  Next questions
                </button>
              </nav>
            )}
          </section>
        </details>
      )}
      {!!review.method_reviews?.length && (
        <details className="border-t border-slate-700">
          <summary className={disclosureClass}>
            <h4 className="inline">
              Public and institutional research sources ·{" "}
              {review.method_reviews.length} reviews
              {review.method_reviews.some(
                (method) => method.status !== "references_found",
              )
                ? " · Gaps remain"
                : " · Claims need assessment"}
            </h4>
          </summary>
          <section
            aria-label="Public and institutional research sources"
            className="space-y-3 pb-3"
          >
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
                <summary className={disclosureClass}>
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
                        <p
                          className="whitespace-pre-wrap break-words"
                          dir="auto"
                        >
                          {source.excerpt}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </details>
            ))}
          </section>
        </details>
      )}
      {coverageLimits.length > 0 && (
        <details className="border-t border-slate-700">
          <summary className={disclosureClass}>
            <h4 className="inline">
              Unresolved research coverage · {coverageLimits.length} limitations
            </h4>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {coverageLimits.map((gap, index) => (
              <li dir="auto" key={index}>
                {gap}
              </li>
            ))}
          </ul>
        </details>
      )}
      {review.leads.length === 0 ? (
        <p className="text-sm text-slate-300">
          No incomplete or excluded leads were retained for this round.
        </p>
      ) : (
        <details className="border-t border-slate-700">
          <summary className={disclosureClass}>
            <h4 className="inline">
              Incomplete research leads · {review.leads.length} ·{" "}
              {canSelect
                ? `${selectedCount} selected for follow-up`
                : "review sources"}
            </h4>
          </summary>
          <div className="space-y-3 py-3">
            <p className="text-sm text-slate-300">
              Search by company, website or evidence gap. Selecting a lead adds
              it to your next research focus; it does not verify the company or
              start research.
            </p>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label htmlFor={`${id}-search`} className="space-y-1 text-sm">
                <span className="block font-semibold">
                  Search incomplete leads
                </span>
                <input
                  ref={searchInput}
                  id={`${id}-search`}
                  type="search"
                  className={`${controlClass} w-full`}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Company, website or missing evidence"
                />
              </label>
              <label htmlFor={`${id}-filter`} className="space-y-1 text-sm">
                <span className="block font-semibold">Filter leads</span>
                <select
                  id={`${id}-filter`}
                  className={`${controlClass} w-full`}
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">
                    All incomplete leads ({review.leads.length})
                  </option>
                  <option value="needs_review">
                    Needs review (
                    {
                      review.leads.filter(
                        (lead) => lead.status === "needs_review",
                      ).length
                    }
                    )
                  </option>
                  <option value="excluded">
                    Excluded (
                    {
                      review.leads.filter((lead) => lead.status === "excluded")
                        .length
                    }
                    )
                  </option>
                  {canSelect && (
                    <option value="selected">
                      Selected only ({selectedCount})
                    </option>
                  )}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm text-slate-300">
                {filteredLeads.length
                  ? `Showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filteredLeads.length)} of ${filteredLeads.length} matching leads`
                  : "No leads match these filters"}
                {canSelect
                  ? ` · ${selectedCount} selected · ${selectedCount - visibleSelectedCount} outside this page`
                  : ""}
              </p>
              {(search || filter !== "all") && (
                <button
                  type="button"
                  className={controlClass}
                  onClick={resetFilters}
                >
                  Reset filters
                </button>
              )}
            </div>
            {canSelect && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={controlClass}
                  disabled={
                    disabled ||
                    !visibleLeads.length ||
                    visibleSelectedCount === visibleLeads.length
                  }
                  onClick={() => selectVisible(true)}
                >
                  Select visible leads
                </button>
                <button
                  type="button"
                  className={controlClass}
                  disabled={disabled || visibleSelectedCount === 0}
                  onClick={() => selectVisible(false)}
                >
                  Clear visible selection
                </button>
              </div>
            )}
            {filteredLeads.length === 0 && (
              <p className="rounded bg-slate-800 p-3 text-sm">
                {filter === "selected" && selectedCount === 0
                  ? "No leads are selected. Choose All incomplete leads to review and select them."
                  : "Try another company name or evidence term, or reset the filters. Your selections are retained."}
              </p>
            )}
            <ul className="space-y-3 mt-3">
              {visibleLeads.map((lead) => (
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
                  <p className="break-words text-sm" dir="auto">
                    {lead.reason}
                  </p>
                  {canSelect && (
                    <label className="flex min-h-11 items-center gap-2 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-sky-400"
                        disabled={disabled}
                        checked={selected.has(lead.lead_id)}
                        onChange={(event) =>
                          onSelect
                            ? onSelect(lead.lead_id, event.target.checked)
                            : onSelectMany?.(
                                [lead.lead_id],
                                event.target.checked,
                              )
                        }
                        aria-label={`Include ${lead.name} in follow-up focus`}
                      />
                      Include in follow-up focus
                    </label>
                  )}
                  <details className="text-sm">
                    <summary className={disclosureClass}>
                      Evidence and missing information ·{" "}
                      {lead.missing_evidence.length} gaps ·{" "}
                      {lead.source_urls.filter(publicSource).length} source
                      links
                    </summary>
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
                      First seen: round {lead.first_seen_round} · Last seen:
                      round {lead.last_seen_round}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
            {filteredLeads.length > PAGE_SIZE && (
              <nav
                aria-label="Incomplete lead pages"
                className="flex flex-wrap items-center gap-3"
              >
                <button
                  type="button"
                  className={controlClass}
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous leads
                </button>
                <span className="text-sm text-slate-300">
                  Page {currentPage + 1} of {lastPage + 1}
                </span>
                <button
                  type="button"
                  className={controlClass}
                  disabled={currentPage === lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next leads
                </button>
              </nav>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
