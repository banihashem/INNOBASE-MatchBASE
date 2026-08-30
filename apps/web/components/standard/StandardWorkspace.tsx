"use client";

import { useRef, useState } from "react";
import type { StandardRequestVersionSummaryV1 } from "@matchbase/contracts";
import { CanonicalReview } from "./CanonicalReview";
import { RequestHistory } from "./RequestHistory";
import { RunProgress } from "./RunProgress";
import { StandardResult } from "./StandardResult";
import { StructuredIntake } from "./StructuredIntake";
import { SyntheticNotice } from "./SyntheticNotice";
import { workspaceJson } from "./api";
import type {
  StandardResultProjectionV1,
  StandardRequestDetailV1,
  StandardScreen,
  StructuredStandardRequestV1,
  WorkspaceSession,
} from "./types";

export function StandardWorkspace({
  initialSession,
}: {
  initialSession: WorkspaceSession;
}) {
  const [session, setSession] = useState(initialSession);
  const [screen, setScreen] = useState<StandardScreen>("requests");
  const [canonical, setCanonical] =
    useState<StructuredStandardRequestV1 | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<StandardResultProjectionV1 | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = useState("");
  const [versionHistory, setVersionHistory] = useState<
    StandardRequestVersionSummaryV1[]
  >([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  function transition(next: StandardScreen, moveFocus = true) {
    setScreen(next);
    if (moveFocus)
      requestAnimationFrame(() =>
        mainRef.current?.querySelector("h1")?.focus(),
      );
  }

  async function refreshSession() {
    const response = await workspaceJson<WorkspaceSession>("/api/v1/me");
    setSession(response.body);
  }

  async function reopenRequest(requestId: string) {
    setWorkspaceError(null);
    try {
      const response = await workspaceJson<StandardRequestDetailV1>(
        `/api/v1/requests/${encodeURIComponent(requestId)}`,
      );
      setCanonical(response.body.canonical);
      setVersionHistory(response.body.version_history);
      transition("canonical");
    } catch (reason) {
      setWorkspaceError(
        reason instanceof Error
          ? reason.message
          : "The request could not be reopened.",
      );
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SyntheticNotice modeLabel={session.research_mode.label} />
      <header className="site-header standard-header">
        <a className="brand" href="/" aria-label="MatchBASE home">
          <span className="brand-mark">M</span>
          <span>MatchBASE</span>
        </a>
        <nav aria-label="Primary navigation">
          <button
            className={
              screen === "requests" ? "nav-button active" : "nav-button"
            }
            onClick={() => transition("requests")}
          >
            Requests
          </button>
          <button
            className={screen === "help" ? "nav-button active" : "nav-button"}
            onClick={() => transition("help")}
          >
            Help
          </button>
        </nav>
        <div className="identity">
          <span>
            <bdi dir="auto">{session.display_name}</bdi>
          </span>
          <span className="tier-badge">Standard</span>
        </div>
      </header>
      <main className="main standard-main" id="main-content" ref={mainRef}>
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {workspaceAnnouncement}
        </p>
        <div className="standard-quota" aria-label="Weekly research capacity">
          <span>
            <strong>{session.quota.remaining ?? 0}</strong> of{" "}
            {session.quota.limit ?? 5} research runs remaining ·{" "}
            {session.quota.used} used
          </span>
          <span>
            {session.execution.active} of {session.execution.capacity} global
            execution slots active
          </span>
          <span>
            Next capacity:{" "}
            {session.quota.next_capacity_at ? (
              <time dateTime={session.quota.next_capacity_at}>
                {new Date(session.quota.next_capacity_at).toISOString()}
              </time>
            ) : (
              "available now"
            )}
          </span>
        </div>
        {workspaceError ? (
          <div className="error-summary" role="alert">
            {workspaceError}
          </div>
        ) : null}
        {screen === "requests" ? (
          <RequestHistory
            onNewRequest={() => transition("intake")}
            onOpenRequest={(id) => void reopenRequest(id)}
            onOpenRun={(id) => {
              setRunId(id);
              transition("running");
            }}
          />
        ) : null}
        {screen === "intake" ? (
          <StructuredIntake
            session={session}
            onCanonical={(value) => {
              setCanonical(value);
              setVersionHistory([]);
              transition("canonical");
            }}
            onCancel={() => transition("requests")}
          />
        ) : null}
        {screen === "canonical" && canonical ? (
          <CanonicalReview
            session={session}
            request={canonical}
            versionHistory={versionHistory}
            onRun={(id) => {
              setRunId(id);
              transition("running");
            }}
            onBack={() => transition("intake")}
          />
        ) : null}
        {screen === "running" && runId ? (
          <RunProgress
            session={session}
            runId={runId}
            onResult={(value) => {
              setResult(value);
              void refreshSession();
              transition("result", false);
            }}
            onTerminal={() => {
              void refreshSession();
              transition("requests");
            }}
            onAnnouncement={setWorkspaceAnnouncement}
          />
        ) : null}
        {screen === "result" && result ? (
          <StandardResult
            result={result}
            onBack={() => transition("requests")}
            headingRef={headingRef}
          />
        ) : null}
        {screen === "help" ? (
          <section className="standard-section">
            <p className="eyebrow">Help</p>
            <h1 tabIndex={-1}>How this synthetic workspace behaves</h1>
            <p>
              Canonical English is confirmed before research. Scores are
              deterministic compatibility measures, not probabilities or
              guarantees.
            </p>
            <p>
              No live provider, web research, attachment, export, PDF, share,
              re-score or re-research feature is enabled.
            </p>
          </section>
        ) : null}
      </main>
      <footer>
        <span>Standard structured request workspace</span>
        <span>Local/test synthetic routes only</span>
      </footer>
    </>
  );
}
