"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseDemoProjectionV1,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseConsultantRunHistoryV1,
  parseStandardResultProjectionV1,
} from "@matchbase/contracts";
import { UserProfile } from "../profile/UserProfile";
import {
  type WorkspaceSession,
  userFacingSessionName,
} from "../standard/types";
import { workspaceJson } from "../standard/api";
import {
  ConsultantResultView,
  type ConsultantVisibleResult,
} from "./ConsultantResult";

type RunItem = {
  run_id: string;
  request_id: string;
  state: string;
  updated_at: string;
  result_available: boolean;
  outcome: string;
};

type ViewState =
  | { state: "loading" }
  | { state: "runs"; items: RunItem[] }
  | { state: "profile" }
  | { state: "result"; result: ConsultantVisibleResult }
  | { state: "error"; message: string };

export function ConsultantWorkspace({
  initialSession,
  workspaceBadge = "Consultant",
  initialView = "runs",
}: {
  initialSession: WorkspaceSession;
  workspaceBadge?: string;
  initialView?: "runs" | "profile";
}) {
  const [view, setView] = useState<ViewState>(
    initialView === "profile" ? { state: "profile" } : { state: "loading" },
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moveFocusAfterLoad = useRef(false);

  const loadRuns = useCallback(async (moveFocus = false) => {
    moveFocusAfterLoad.current = moveFocus;
    setView({ state: "loading" });
    try {
      const response = await workspaceJson<unknown>("/api/v1/consultant/runs");
      const history = parseConsultantRunHistoryV1(response.body);
      setView({ state: "runs", items: [...history.items] });
    } catch {
      setView({
        state: "error",
        message: "The run history could not be loaded.",
      });
    }
  }, []);

  useEffect(() => {
    if (initialView === "runs") void loadRuns();
  }, [initialView, loadRuns]);
  useEffect(() => {
    if (view.state === "loading" || !moveFocusAfterLoad.current) return;
    moveFocusAfterLoad.current = false;
    headingRef.current?.focus();
  }, [view]);

  async function openResult(runId: string) {
    moveFocusAfterLoad.current = true;
    setView({ state: "loading" });
    try {
      const resultPath =
        initialSession.tier === "admin"
          ? `/api/v1/consultant/runs/${encodeURIComponent(runId)}/result`
          : `/api/v1/runs/${encodeURIComponent(runId)}/result`;
      const response = await workspaceJson<unknown>(resultPath);
      const body = response.body;
      if (
        body === null ||
        typeof body !== "object" ||
        !("schema_version" in body)
      )
        throw new Error("Consultant result schema is invalid.");
      const result = (() => {
        switch (body.schema_version) {
          case "consultant-result-projection.v1":
            return parseConsultantResultProjectionV1(body);
          case "consultant-result-projection.v2":
            return parseConsultantResultProjectionV2(body);
          case "standard-result-projection.v1":
            return parseStandardResultProjectionV1(body);
          case "demo-projection.v1":
            return parseDemoProjectionV1(body);
          default:
            throw new Error("Consultant result schema is unsupported.");
        }
      })();
      setView({ state: "result", result });
    } catch {
      setView({ state: "error", message: "The result could not be loaded." });
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header standard-header">
        <a className="brand" href="/" aria-label="MatchBASE home">
          <span className="brand-mark">M</span>
          <span>MatchBASE</span>
        </a>
        <nav aria-label="Primary navigation">
          <button
            className={
              view.state === "runs" ? "nav-button active" : "nav-button"
            }
            onClick={() => void loadRuns(true)}
          >
            Runs
          </button>
          <button
            className={
              view.state === "profile" ? "nav-button active" : "nav-button"
            }
            onClick={() => setView({ state: "profile" })}
          >
            Profile
          </button>
        </nav>
        <div className="identity">
          <span>
            <bdi dir="auto">{userFacingSessionName(initialSession)}</bdi>
          </span>
          <span className="tier-badge">{workspaceBadge}</span>
        </div>
      </header>
      <main className="main standard-main" id="main-content">
        {view.state === "loading" ? (
          <p role="status">Loading Consultant workspace…</p>
        ) : null}
        {view.state === "error" ? (
          <section className="standard-section">
            <h1 ref={headingRef} tabIndex={-1}>
              Consultant workspace unavailable
            </h1>
            <div className="error-summary" role="alert">
              {view.message}
            </div>
            <button
              className="primary-action"
              onClick={() => void loadRuns(true)}
            >
              Retry
            </button>
          </section>
        ) : null}
        {view.state === "profile" ? (
          <UserProfile
            tier="consultant"
            displayName={userFacingSessionName(initialSession)}
            email={initialSession.email}
            quota={initialSession.quota}
            newRequestHref={
              initialSession.tier === "admin" ? "/admin/product" : undefined
            }
          />
        ) : null}
        {view.state === "runs" ? (
          <section
            className="standard-section"
            aria-labelledby="consultant-runs-heading"
          >
            <p className="eyebrow">Consultant workspace</p>
            <h1 id="consultant-runs-heading" ref={headingRef} tabIndex={-1}>
              Your sourcing runs
            </h1>
            <p className="lede">
              Result depth is locked to the tier recorded when each run was
              submitted.
            </p>
            {view.items.length === 0 ? (
              <p role="status">No sourcing runs are available.</p>
            ) : (
              <div
                className="standard-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Consultant run history"
              >
                <table className="standard-table">
                  <caption>Owned runs and result availability</caption>
                  <thead>
                    <tr>
                      <th scope="col">Run</th>
                      <th scope="col">State</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.items.map((item) => (
                      <tr key={item.run_id}>
                        <th scope="row">
                          <code>{item.run_id.slice(0, 8)}</code>
                        </th>
                        <td>{item.state.replaceAll("_", " ")}</td>
                        <td>
                          <time dateTime={item.updated_at}>
                            {new Intl.DateTimeFormat("en-GB", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "UTC",
                            }).format(new Date(item.updated_at))}
                          </time>
                        </td>
                        <td>
                          {item.result_available ? (
                            <button
                              className="secondary-action"
                              onClick={() => void openResult(item.run_id)}
                            >
                              Open result
                            </button>
                          ) : item.outcome === "failed" ? (
                            "Research failed — no result was generated"
                          ) : (
                            "Result not available"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
        {view.state === "result" ? (
          <ConsultantResultView
            result={view.result}
            headingRef={headingRef}
            onBack={() => void loadRuns(true)}
          />
        ) : null}
      </main>
      <footer>
        <span>Consultant result workspace</span>
        <span>Governed disclosure only</span>
      </footer>
    </>
  );
}
