"use client";
import { useEffect, useState } from "react";
import type { WorkspaceSession } from "../standard/types";
import { userFacingSessionName } from "../standard/types";
import { ConsultantWorkspace } from "./ConsultantWorkspace";
import { workflowLabel } from "./workflow-status";

type Research = {
  run_id: string;
  state: string;
  title: string;
  updated_at: string;
  mode: string;
  result_available: boolean;
  stopped_by_user?: boolean;
};
type Draft = {
  draft_id: string;
  current_run_id?: string | null;
  updated_at: string;
  draft_data?: { productRequirement?: string };
};
type HomeView = "home" | "history" | "reports" | "profile" | "archive";
export function ConsultantHome({
  session,
  initialView = "home",
}: {
  session: WorkspaceSession;
  initialView?: HomeView;
}) {
  const [view, setView] = useState<HomeView>(initialView);
  const [items, setItems] = useState<Research[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (
      ["home", "history", "reports", "profile", "archive"].includes(
        requested || "",
      )
    )
      setView(requested as HomeView);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const responses = await Promise.all(
          ["history=true", "active_draft=true"].map((query) =>
            fetch(`/api/v1/consultant/workflow?${query}`, {
              cache: "no-store",
              signal: controller.signal,
            }),
          ),
        );
        if (responses.some((response) => !response.ok))
          throw new Error("History unavailable");
        const [history, saved] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (controller.signal.aborted) return;
        setItems(history.items || []);
        setDrafts(
          (saved.drafts || []).filter((draft: Draft) => !draft.current_run_id),
        );
        setError(false);
        setLoaded(true);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 15000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [reload]);
  const unfinished = items.filter((item) => !item.result_available);
  const reports = items.filter((item) => item.result_available);
  const latest = unfinished[0];
  const list = (
    view === "reports" ? reports : view === "home" ? items.slice(0, 5) : items
  ).filter((item) =>
    `${item.title} ${item.run_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const href = (item: Research) =>
    `/consultant/workflow?run_id=${encodeURIComponent(item.run_id)}`;
  if (view === "archive")
    return (
      <>
        <div className="consultant-archive-link">
          <a href="/">← Consultant Home</a>
          <p>
            Earlier report formats · Separate from your current research history
          </p>
        </div>
        <ConsultantWorkspace initialSession={session} />
      </>
    );
  return (
    <div className="consultant-home">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="consultant-home-header">
        <a href="/" className="consultant-wordmark">
          MatchBASE <span>Consultant</span>
        </a>
        <nav aria-label="Consultant navigation">
          {(
            [
              ["home", "Home"],
              ["history", "Research history"],
              ["reports", "Reports"],
              ["profile", "Profile"],
            ] as const
          ).map(([key, label]) => (
            <a
              key={key}
              href={`/?view=${key}`}
              aria-current={view === key ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main id="main-content" className="consultant-home-main">
        <section className="consultant-hero">
          <p className="activity-kicker">Your sourcing workspace</p>
          <h1>
            {view === "profile"
              ? "Your Consultant profile"
              : view === "reports"
                ? "Supplier reports"
                : view === "history"
                  ? "Your research history"
                  : "From buying requirements to supplier evidence"}
          </h1>
          <p>
            {view === "home"
              ? "Describe what you need in any language. Review the research plan, then explore ranked suppliers, source evidence and a downloadable report."
              : "Your saved requests, approvals and results remain linked to the same research."}
          </p>
          <div className="consultant-actions">
            <a
              className="consultant-primary"
              href="/consultant/workflow?mode=new"
            >
              Start a new research
            </a>
            <a className="consultant-secondary" href="/?view=history">
              Find a saved request
            </a>
          </div>
        </section>
        {error && (
          <div role="alert" className="activity-warning">
            Research history could not be refreshed.{" "}
            {loaded
              ? "Previously loaded records remain below."
              : "Saved requests have not been deleted."}{" "}
            <button onClick={() => setReload((value) => value + 1)}>
              Retry loading history
            </button>
          </div>
        )}
        {!loaded && !error && (
          <p role="status">Loading your saved research and drafts…</p>
        )}
        {view === "profile" ? (
          <section className="consultant-card">
            <h2>{userFacingSessionName(session)}</h2>
            <dl className="consultant-profile">
              <dt>Email</dt>
              <dd>{session.email || "Not available"}</dd>
              <dt>Access</dt>
              <dd>Consultant</dd>
              <dt>Current research records</dt>
              <dd>{loaded ? items.length : "Loading"}</dd>
              <dt>Available reports</dt>
              <dd>{loaded ? reports.length : "Loading"}</dd>
            </dl>
            <p>
              Research usage and availability are checked by the server when you
              submit a request.
            </p>
            <a href="/?view=archive">Open earlier report formats</a>
          </section>
        ) : (
          <>
            {view === "home" && latest && (
              <section className="consultant-resume consultant-card">
                <div>
                  <p className="activity-kicker">Continue where you left off</p>
                  <h2>{workflowLabel(latest.state, latest.stopped_by_user)}</h2>
                  <p dir="auto" className="consultant-snippet">
                    {latest.title || "Saved sourcing request"}
                  </p>
                  <p className="activity-time">
                    Updated {new Date(latest.updated_at).toLocaleString()} · Ref{" "}
                    {latest.run_id.slice(-8)}
                  </p>
                  {latest.state === "workflow_failed" && (
                    <p>
                      The previous execution stopped. Open the request to see
                      the failed stage and recovery action.
                    </p>
                  )}
                </div>
                <a className="consultant-primary" href={href(latest)}>
                  Open saved research
                </a>
              </section>
            )}
            {view === "home" && (
              <section
                className="consultant-journey"
                aria-label="How Consultant research works"
              >
                {[
                  [
                    "01",
                    "Describe",
                    "Product or service, technical requirements, order and supplier profile.",
                  ],
                  [
                    "02",
                    "Review",
                    "Approve the English interpretation and the editable research plan.",
                  ],
                  [
                    "03",
                    "Research",
                    "Follow both search paths and 5–15 rounds of source verification.",
                  ],
                  [
                    "04",
                    "Decide",
                    "Review up to 20 suppliers, open full dossiers and download PDF.",
                  ],
                ].map(([n, title, copy]) => (
                  <article className="consultant-card" key={n}>
                    <span>{n}</span>
                    <h2>{title}</h2>
                    <p>{copy}</p>
                  </article>
                ))}
              </section>
            )}
            <section className="consultant-card">
              <div className="consultant-section-heading">
                <h2>
                  {view === "reports"
                    ? "Ready to review and download"
                    : view === "home"
                      ? "Recent research"
                      : "Saved research · Latest 100"}
                </h2>
                <label>
                  Find by request or reference
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search your research"
                  />
                </label>
              </div>
              {loaded && !list.length && (
                <p>
                  {search
                    ? "No saved research matches your search."
                    : view === "reports"
                      ? "No report is ready yet. Track your research in Research history."
                      : "No research has been submitted yet. Start with a new request or a saved draft."}
                </p>
              )}
              <ul className="consultant-research-list">
                {list.map((item) => (
                  <li key={item.run_id}>
                    <div>
                      <p
                        className={`consultant-state ${item.state === "workflow_failed" ? "is-stopped" : ""}`}
                      >
                        {item.result_available
                          ? "Results ready"
                          : workflowLabel(
                              item.state,
                              item.stopped_by_user,
                            )}{" "}
                        ·{" "}
                        {item.mode === "live"
                          ? "Live research"
                          : item.mode === "demonstration"
                            ? "Demonstration"
                            : "Mode not recorded"}
                      </p>
                      <h3 dir="auto">
                        {item.title || "Saved sourcing request"}
                      </h3>
                      <p className="activity-time">
                        {new Date(item.updated_at).toLocaleString()} · Ref{" "}
                        {item.run_id.slice(-8)}
                      </p>
                    </div>
                    <a className="consultant-secondary" href={href(item)}>
                      {item.result_available
                        ? "View results & PDF"
                        : "Open research"}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {view !== "reports" && (
              <section className="consultant-card">
                <h2>Saved drafts · Latest 20</h2>
                {view === "home" && drafts.length > 5 && (
                  <a href="/?view=history" className="consultant-secondary">
                    View all saved drafts
                  </a>
                )}
                <p>
                  Drafts have not started research. Editing a draft does not use
                  a model.
                </p>
                {loaded && !drafts.length && <p>No unsubmitted drafts.</p>}
                <ul className="consultant-research-list">
                  {(view === "home" ? drafts.slice(0, 5) : drafts).map(
                    (draft) => (
                      <li key={draft.draft_id}>
                        <div>
                          <h3 dir="auto">
                            {draft.draft_data?.productRequirement ||
                              "Untitled draft"}
                          </h3>
                          <p className="activity-time">
                            {new Date(draft.updated_at).toLocaleString()}
                          </p>
                        </div>
                        <a
                          className="consultant-secondary"
                          href={`/consultant/workflow?draft_id=${encodeURIComponent(draft.draft_id)}`}
                        >
                          Continue draft
                        </a>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            )}
            <footer className="consultant-home-footer">
              <a href="/?view=archive">Earlier report formats</a>
              <span>
                Supplier details and PDF downloads are available inside each
                completed research.
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
