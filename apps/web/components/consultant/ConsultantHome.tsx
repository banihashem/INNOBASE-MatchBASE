"use client";
import { useEffect, useState } from "react";
import type { WorkspaceSession } from "../standard/types";
import { ConsultantWorkspace } from "./ConsultantWorkspace";
import { ConsultantShell } from "./ConsultantShell";
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
const href = (item: Research) =>
  `/consultant/workflow?run_id=${encodeURIComponent(item.run_id)}`;
const needsApproval = (item: Research) =>
  !item.stopped_by_user &&
  [
    "prep_step1_awaiting_approval",
    "prep_step2_advisory_ready",
    "prep_step3_prompt_awaiting_approval",
    "prep_step3_prompt_approved",
  ].includes(item.state);
const isWorking = (item: Research) =>
  !item.stopped_by_user &&
  [
    "intake_submitted",
    "prep_step1_interpreting",
    "prep_step1_approved",
    "prep_step2_advisory_generating",
    "prep_step3_prompt_synthesizing",
    "research_dispatching",
    "lane_gemini_running",
    "lane_openai_running",
    "lanes_converged",
    "verification_loop_running",
    "synthesis_running",
    "pdf_generating",
  ].includes(item.state);
const researchStatus = (item: Research) => {
  if (item.stopped_by_user) return "Stopped by you";
  if (
    item.state === "workflow_failed" ||
    item.state === "invalidated" ||
    isWorking(item) ||
    needsApproval(item)
  )
    return workflowLabel(item.state);
  if (item.result_available) return "Results ready";
  return "Open to review status";
};
const priority = (item: Research) =>
  isWorking(item)
    ? 0
    : needsApproval(item)
      ? 1
      : item.state === "workflow_failed"
        ? 2
        : 3;
const dateLabel = (date: string) =>
  Number.isFinite(Date.parse(date))
    ? new Date(date).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Date unavailable";
const conciseTitle = (title?: string) => {
  const text = title?.replace(/\s+/g, " ").trim() || "Saved sourcing request";
  return text.length > 190 ? `${text.slice(0, 187)}…` : text;
};

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
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
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
    if (view === "archive") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let attemptedInitialLoad = false;
    const isHidden = () => document.visibilityState === "hidden";
    async function refresh() {
      if (refreshing || controller.signal.aborted || isHidden()) return;
      refreshing = true;
      attemptedInitialLoad = true;
      clearTimeout(timer);
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
      } finally {
        refreshing = false;
        if (!controller.signal.aborted && view !== "profile" && !isHidden())
          timer = setTimeout(refresh, 15000);
      }
    }
    const onVisibility = () => {
      clearTimeout(timer);
      if (!isHidden() && (view !== "profile" || !attemptedInitialLoad))
        void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reload, view]);
  const reports = items.filter((item) => item.result_available);
  const active = items.filter((item) => isWorking(item) || needsApproval(item));
  const latest = [...items]
    .filter(
      (item) =>
        isWorking(item) ||
        needsApproval(item) ||
        (!item.result_available && item.state === "workflow_failed"),
    )
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        Date.parse(b.updated_at) - Date.parse(a.updated_at),
    )[0];
  const filtered = (view === "reports" ? reports : items).filter((item) =>
    `${item.title} ${item.run_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const list = view === "home" && !search ? filtered.slice(0, 5) : filtered;
  const name =
    [session.user_display_name, session.display_name]
      .find(
        (value) =>
          value?.trim() && value.trim().toLowerCase() !== "google user",
      )
      ?.trim() || "Consultant account";
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": session.csrf_token,
          "idempotency-key": `signout-${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(2))).join("-")}`,
        },
      });
      if (!response.ok) throw new Error("Sign out unavailable");
      window.location.assign("/");
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  }
  if (view === "archive")
    return (
      <>
        <div className="consultant-experience cx-archive-bar">
          <div className="cx-page-heading">
            <div>
              <p className="cx-eyebrow">Saved records</p>
              <h2>Earlier report formats</h2>
              <p>
                These records are separate from your current research history.
              </p>
            </div>
            <a className="cx-button-secondary" href="/?view=reports">
              Back to reports
            </a>
          </div>
        </div>
        <ConsultantWorkspace initialSession={session} />
      </>
    );
  return (
    <ConsultantShell active={view}>
      <section className="cx-page-heading">
        <div>
          <p className="cx-eyebrow">Consultant workspace</p>
          <h1>
            {view === "profile"
              ? "Your profile"
              : view === "reports"
                ? "Supplier reports"
                : view === "history"
                  ? "Your research"
                  : "Your sourcing dashboard"}
          </h1>
          <p>
            {view === "home"
              ? "Continue your work, review supplier findings or start with a new buying requirement."
              : view === "profile"
                ? "Your sign-in identity and saved research workspace."
                : view === "reports"
                  ? "Open your findings, compare suppliers and download the report from each research."
                  : "Return to saved requests, review approvals and follow research in progress."}
          </p>
        </div>
        {view !== "profile" && (
          <a className="cx-button-primary" href="/consultant/workflow?mode=new">
            + New research
          </a>
        )}
      </section>
      {error && (
        <div role="alert" className="cx-notice">
          Research history could not be refreshed.{" "}
          {loaded
            ? "Previously loaded records remain below."
            : "Saved requests have not been deleted."}{" "}
          <button
            className="cx-button-secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry loading history
          </button>
        </div>
      )}
      {!loaded && !error && (
        <p className="cx-loading" role="status">
          Loading your saved research and drafts…
        </p>
      )}
      {view === "profile" ? (
        <div className="cx-profile-grid">
          <section className="cx-panel">
            <div className="cx-identity">
              <span className="cx-avatar" aria-hidden="true">
                {Array.from(name)[0]?.toUpperCase()}
              </span>
              <div>
                <p className="cx-eyebrow">Signed in</p>
                <h2 dir="auto">{name}</h2>
              </div>
            </div>
            <dl className="cx-definition">
              <div>
                <dt>Email</dt>
                <dd>{session.email || "Not provided by sign-in"}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{session.display_name || "Consultant workspace"}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>Consultant</dd>
              </div>
            </dl>
            <p>
              Your name and email come from your sign-in account. They cannot be
              edited here.
            </p>
            <div className="cx-profile-actions">
              <button
                className="cx-button-secondary"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
              <p>
                Signing out keeps saved requests and reports. Research already
                running on the server can continue.
              </p>
              {signOutError && (
                <p role="alert">
                  Sign out did not complete. Your session is still open. Try
                  again.
                </p>
              )}
            </div>
          </section>
          <section className="cx-panel">
            <h2>Your saved work</h2>
            <p>
              Activity in the latest 100 research records for this workspace.
            </p>
            <dl className="cx-definition">
              <div>
                <dt>Research</dt>
                <dd>
                  {loaded ? items.length : "Unavailable until history loads"}
                </dd>
              </div>
              <div>
                <dt>In progress or awaiting review</dt>
                <dd>
                  {loaded ? active.length : "Unavailable until history loads"}
                </dd>
              </div>
              <div>
                <dt>With results</dt>
                <dd>
                  {loaded ? reports.length : "Unavailable until history loads"}
                </dd>
              </div>
            </dl>
            <a href="/?view=history">Open your research</a>
            <div className="cx-profile-actions">
              <h2>Research and cost control</h2>
              <p>
                Each additional research round needs your cost approval. Actual
                usage and available evidence are shown inside the request.
              </p>
              <a href="/?view=reports">Browse supplier reports</a>
            </div>
          </section>
        </div>
      ) : (
        <>
          {view === "home" && loaded && (
            <div className="cx-stats" aria-label="Saved work overview">
              <a href="/?view=history" className="cx-stat">
                <strong>{active.length}</strong> In progress or awaiting review
              </a>
              <a href="/?view=reports" className="cx-stat">
                <strong>{reports.length}</strong> Research with results
              </a>
              <a href="/?view=history#saved-drafts" className="cx-stat">
                <strong>{drafts.length}</strong> Unsubmitted drafts
              </a>
            </div>
          )}
          {view === "home" && latest && (
            <section className="cx-panel cx-resume">
              <div>
                <p className="cx-eyebrow">Continue where you left off</p>
                <h2>{workflowLabel(latest.state, latest.stopped_by_user)}</h2>
                <p dir="auto" className="cx-snippet">
                  {conciseTitle(latest.title)}
                </p>
                <p className="cx-time">
                  Updated {dateLabel(latest.updated_at)}
                </p>
                <p>
                  {latest.state === "workflow_failed"
                    ? "Your request is saved. Open it to review the stopped stage and available recovery options."
                    : isWorking(latest)
                      ? "Research is running. Open the request to follow its progress; this will not start another search."
                      : "Your next approval is ready. Review it before any further work starts."}
                </p>
              </div>
              <a className="cx-button-primary" href={href(latest)}>
                Open saved research
              </a>
            </section>
          )}
          {view === "home" && (
            <section
              className="cx-journey"
              aria-label="How Consultant research works"
            >
              {[
                [
                  "01",
                  "Describe your needs",
                  "Add the product or service, requirements and order details in any language.",
                ],
                [
                  "02",
                  "Review the plan",
                  "Check the English interpretation, advice and editable research plan.",
                ],
                [
                  "03",
                  "Research and decide",
                  "Approve a round and its cost, then review supplier evidence, prices and PDF.",
                ],
              ].map(([n, title, copy]) => (
                <article key={n}>
                  <span>STEP {n}</span>
                  <h2>{title}</h2>
                  <p>{copy}</p>
                </article>
              ))}
            </section>
          )}
          <section className="cx-panel">
            <div className="cx-section-heading">
              <div>
                <h2>
                  {view === "reports"
                    ? "Ready to review and download"
                    : view === "home"
                      ? "Recent research"
                      : "Saved research"}
                </h2>
                <p>
                  {view === "home"
                    ? "Your latest requests and results"
                    : "Showing the latest 100 saved research records"}
                </p>
              </div>
              <label className="cx-search">
                Find a request
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search your research"
                />
              </label>
            </div>
            {loaded && !list.length && (
              <div className="cx-empty">
                <h3>
                  {search
                    ? "No matching requests"
                    : view === "reports"
                      ? "Your reports will appear here"
                      : "Start your first research"}
                </h3>
                <p>
                  {search
                    ? "Try another product or a shorter search term."
                    : view === "reports"
                      ? "No report is ready yet. Open your research to review its progress."
                      : "No research has been submitted yet. Describe what you need or continue a saved draft."}
                </p>
                {view === "reports" && !search && (
                  <a href="/?view=history">Open your research</a>
                )}
              </div>
            )}
            <ul className="cx-research-list">
              {list.map((item) => (
                <li key={item.run_id}>
                  <div>
                    <span
                      className={`cx-state ${item.state === "workflow_failed" ? "is-stopped" : ""}`}
                    >
                      {researchStatus(item)}
                    </span>
                    {item.mode === "demonstration" && (
                      <span className="cx-mode">Demonstration data</span>
                    )}
                    <h3 dir="auto" className="cx-snippet">
                      {conciseTitle(item.title)}
                    </h3>
                    <p className="cx-time">
                      Updated {dateLabel(item.updated_at)}
                    </p>
                  </div>
                  <a className="cx-button-secondary" href={href(item)}>
                    {item.result_available
                      ? "View results & PDF"
                      : "Open research"}
                  </a>
                </li>
              ))}
            </ul>
            {view === "home" && items.length > 5 && !search && (
              <a href="/?view=history">View all saved research →</a>
            )}
          </section>
          {view !== "reports" && (
            <section id="saved-drafts" className="cx-panel">
              <div className="cx-section-heading">
                <div>
                  <h2>Saved drafts</h2>
                  <p>Editing a draft does not start research or use a model.</p>
                </div>
                {view === "home" && drafts.length > 5 && (
                  <a href="/?view=history#saved-drafts">
                    View all saved drafts
                  </a>
                )}
              </div>
              {loaded && !drafts.length && <p>No unsubmitted drafts.</p>}
              <ul className="cx-research-list">
                {(view === "home" ? drafts.slice(0, 5) : drafts).map(
                  (draft) => (
                    <li key={draft.draft_id}>
                      <div>
                        <h3 dir="auto" className="cx-snippet">
                          {conciseTitle(
                            draft.draft_data?.productRequirement ||
                              "Untitled draft",
                          )}
                        </h3>
                        <p className="cx-time">
                          Saved {dateLabel(draft.updated_at)}
                        </p>
                      </div>
                      <a
                        className="cx-button-secondary"
                        href={`/consultant/workflow?draft_id=${encodeURIComponent(draft.draft_id)}`}
                      >
                        Continue draft
                      </a>
                    </li>
                  ),
                )}
              </ul>
              {view === "history" && drafts.length >= 20 && (
                <p>The latest 20 unsubmitted drafts are shown.</p>
              )}
            </section>
          )}
        </>
      )}
      <footer className="cx-footer">
        <p>
          Requests, approvals and supplier findings stay together. Further
          research is always your choice.
        </p>
        <a href="/?view=archive">Earlier report formats</a>
      </footer>
    </ConsultantShell>
  );
}
