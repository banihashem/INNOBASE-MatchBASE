"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseDemoProjectionV1,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseStandardResultProjectionV1,
  parseUserProfileHistoryV1,
  type ProductTier,
  type UserProfileHistoryV1,
} from "@matchbase/contracts";
import {
  ConsultantResultView,
  type ConsultantVisibleResult,
} from "../consultant/ConsultantResult";
import { workspaceJson } from "../standard/api";

type ProfileView =
  | { state: "loading" }
  | { state: "history"; history: UserProfileHistoryV1 }
  | { state: "result"; result: ConsultantVisibleResult }
  | { state: "error"; message: string };

function parseVisibleResult(value: unknown): ConsultantVisibleResult {
  if (
    value === null ||
    typeof value !== "object" ||
    !("schema_version" in value)
  )
    throw new Error("Result projection is invalid.");
  switch (value.schema_version) {
    case "demo-projection.v1":
      return parseDemoProjectionV1(value);
    case "standard-result-projection.v1":
      return parseStandardResultProjectionV1(value);
    case "consultant-result-projection.v1":
      return parseConsultantResultProjectionV1(value);
    case "consultant-result-projection.v2":
      return parseConsultantResultProjectionV2(value);
    default:
      throw new Error("Result projection is unsupported.");
  }
}

function format(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function UserProfile({
  tier,
  displayName,
  onNewRequest,
}: {
  readonly tier: ProductTier;
  readonly displayName: string;
  readonly onNewRequest?: () => void;
}) {
  const [view, setView] = useState<ProfileView>({ state: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadHistory = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setView({ state: "loading" });
      setPageError(null);
      try {
        const query = cursor
          ? `?${new URLSearchParams({ cursor }).toString()}`
          : "";
        const response = await workspaceJson<unknown>(
          `/api/v1/profile/history${query}`,
        );
        const history = parseUserProfileHistoryV1(response.body);
        if (history.current_tier !== tier)
          throw new Error("Profile entitlement drifted.");
        setView((current) => {
          if (!cursor || current.state !== "history")
            return { state: "history", history };
          const requestIds = new Set(
            current.history.requests.map((item) => item.request_id),
          );
          const runIds = new Set(
            current.history.runs.map((item) => item.run_id),
          );
          return {
            state: "history",
            history: {
              ...history,
              requests: [
                ...current.history.requests,
                ...history.requests.filter(
                  (item) => !requestIds.has(item.request_id),
                ),
              ],
              runs: [
                ...current.history.runs,
                ...history.runs.filter((item) => !runIds.has(item.run_id)),
              ],
            },
          };
        });
      } catch {
        if (!cursor)
          setView({
            state: "error",
            message: "Your profile history could not be loaded.",
          });
        else setPageError("More profile history could not be loaded.");
      } finally {
        setLoadingMore(false);
      }
    },
    [tier],
  );

  useEffect(() => void loadHistory(), [loadHistory]);

  useEffect(() => {
    if (view.state !== "loading") headingRef.current?.focus();
  }, [view.state]);

  async function openResult(path: string) {
    setView({ state: "loading" });
    try {
      const response = await workspaceJson<unknown>(path);
      setView({ state: "result", result: parseVisibleResult(response.body) });
    } catch {
      setView({
        state: "error",
        message: "The entitled result projection could not be loaded.",
      });
    }
  }

  if (view.state === "loading")
    return <p role="status">Loading your profile…</p>;
  if (view.state === "error")
    return (
      <section
        className="standard-section"
        aria-labelledby="profile-error-heading"
      >
        <h1 id="profile-error-heading" ref={headingRef} tabIndex={-1}>
          Profile unavailable
        </h1>
        <div className="error-summary" role="alert">
          {view.message}
        </div>
        <button className="secondary-action" onClick={() => void loadHistory()}>
          Retry
        </button>
      </section>
    );
  if (view.state === "result")
    return (
      <ConsultantResultView
        result={view.result}
        headingRef={headingRef}
        onBack={() => void loadHistory()}
      />
    );

  const { history } = view;
  return (
    <section className="standard-section" aria-labelledby="profile-heading">
      <div className="standard-title-row">
        <div>
          <p className="eyebrow">Signed-in profile · {tier}</p>
          <h1 id="profile-heading" ref={headingRef} tabIndex={-1}>
            <bdi dir="auto">{displayName}</bdi>
          </h1>
          <p className="lede">
            Canonical requests, execution states and legally entitled historical
            result projections.
          </p>
        </div>
        {onNewRequest ? (
          <button className="primary-action" onClick={onNewRequest}>
            New request
          </button>
        ) : null}
      </div>

      <section aria-labelledby="profile-requests-heading">
        <h2 id="profile-requests-heading">Canonical requests</h2>
        {history.requests.length === 0 ? (
          <p>No canonical requests are recorded.</p>
        ) : (
          <div
            className="standard-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Canonical request history"
          >
            <table className="standard-table">
              <caption>Your owner-scoped canonical request history</caption>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Canonical summary</th>
                  <th scope="col">Version</th>
                  <th scope="col">State</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {history.requests.map((request) => (
                  <tr key={request.request_id}>
                    <th scope="row">
                      <code>{request.request_id.slice(0, 8)}</code>
                    </th>
                    <td>
                      <bdi dir="auto">{request.canonical_summary}</bdi>
                    </td>
                    <td>{request.canonical_request_version}</td>
                    <td>{request.lifecycle_state}</td>
                    <td>
                      <time dateTime={request.updated_at}>
                        {format(request.updated_at)} UTC
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="profile-runs-heading">
        <h2 id="profile-runs-heading">Research runs and results</h2>
        {history.runs.length === 0 ? (
          <p>No research runs are recorded.</p>
        ) : (
          <div
            className="standard-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Research run history"
          >
            <table className="standard-table">
              <caption>
                Submission-bound projections remain fixed after entitlement
                changes
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Submitted tier</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.runs.map((run) => (
                  <tr key={run.run_id}>
                    <th scope="row">
                      <code>{run.run_id.slice(0, 8)}</code>
                    </th>
                    <td>{run.submitted_tier}</td>
                    <td>{run.outcome.replaceAll("_", " ")}</td>
                    <td>
                      <time dateTime={run.updated_at}>
                        {format(run.updated_at)} UTC
                      </time>
                    </td>
                    <td>
                      {run.links.result ? (
                        <button
                          className="secondary-action"
                          onClick={() => void openResult(run.links.result!)}
                        >
                          Open {run.result_projection} result
                        </button>
                      ) : run.outcome === "failed" ? (
                        "Research failed — no result was generated"
                      ) : run.result_available ? (
                        "Not entitled at this tier"
                      ) : (
                        "Not available"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {history.page.next_cursor ? (
        <button
          className="secondary-action"
          disabled={loadingMore}
          onClick={() => void loadHistory(history.page.next_cursor!)}
        >
          {loadingMore ? "Loading more history…" : "Load more history"}
        </button>
      ) : null}
      {pageError ? <p role="alert">{pageError}</p> : null}
    </section>
  );
}
