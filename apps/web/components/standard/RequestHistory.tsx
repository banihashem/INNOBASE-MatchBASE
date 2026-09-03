import { useEffect, useState } from "react";
import { workspaceJson } from "./api";
import type { StandardRequestHistoryV1, StandardRunHistoryV1 } from "./types";

type Props = {
  onNewRequest: () => void;
  onOpenRequest: (requestId: string) => void;
  onOpenRun: (runId: string) => void;
  qualifiedLive?: boolean;
};

function conciseRequestLabel(summary: string): string {
  const need = summary
    .replace(/^(?:need|fld-core-ps-01|product_category)\s*:\s*/iu, "")
    .split(/[.;]/u, 1)[0]
    ?.replace(
      /^(?:(?:procurement\s+)?request\s+for|procurement\s+of|we\s+(?:require|need))\s*/iu,
      "",
    )
    .replace(
      /^(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:containers?|units?|pieces?|lots?|shipments?)\s+of\s+/iu,
      "",
    )
    .split(
      /\s+(?:for\s+(?:delivery|distribution|use|water\s+transfer)|with\s+|which\s+|that\s+|must\s+|should\s+)/iu,
      1,
    )[0]
    ?.trim();
  if (!need) return "Product request";
  const words = need.split(/\s+/u);
  const bounded = words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : need;
  return bounded.length > 80 ? `${bounded.slice(0, 77).trimEnd()}…` : bounded;
}

export function RequestHistory({
  onNewRequest,
  onOpenRequest,
  onOpenRun,
  qualifiedLive = false,
}: Props) {
  const [requests, setRequests] = useState<StandardRequestHistoryV1 | null>(
    null,
  );
  const [runs, setRuns] = useState<StandardRunHistoryV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  async function load(requestCursor?: string, runCursor?: string) {
    setError(null);
    try {
      const [requestPage, runPage] = await Promise.all([
        workspaceJson<StandardRequestHistoryV1>(
          `/api/v1/requests?filter=${encodeURIComponent(filter)}${requestCursor ? `&cursor=${encodeURIComponent(requestCursor)}` : ""}`,
        ),
        workspaceJson<StandardRunHistoryV1>(
          `/api/v1/runs?filter=${encodeURIComponent(filter)}${runCursor ? `&cursor=${encodeURIComponent(runCursor)}` : ""}`,
        ),
      ]);
      setRequests((current) => ({
        ...requestPage.body,
        items: requestCursor
          ? [...(current?.items ?? []), ...requestPage.body.items]
          : requestPage.body.items,
      }));
      setRuns((current) => ({
        ...runPage.body,
        items: runCursor
          ? [...(current?.items ?? []), ...runPage.body.items]
          : runPage.body.items,
      }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "History is unavailable.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  return (
    <section className="standard-section" aria-labelledby="requests-heading">
      <div className="standard-title-row">
        <div>
          <p className="eyebrow">Durable workspace</p>
          <h1 id="requests-heading" tabIndex={-1}>
            Requests
          </h1>
        </div>
        <button className="primary-action" onClick={onNewRequest}>
          New structured request
        </button>
      </div>
      <label className="standard-filter">
        Outcome filter
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All records</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="superseded">Superseded</option>
          <option value="scarce">Scarce or no responsible match</option>
        </select>
      </label>
      {error ? (
        <div className="error-summary" role="alert">
          {error}
        </div>
      ) : null}
      {!requests || !runs ? <p role="status">Loading server history…</p> : null}
      {requests?.items.length === 0 ? (
        <div className="standard-empty">
          <h2>No structured requests yet</h2>
          <p>
            {qualifiedLive
              ? "Create a request to begin qualified live research."
              : "Create a request to begin a synthetic Standard evaluation."}
          </p>
          <button
            className="primary-action"
            onClick={onNewRequest}
            style={{ marginTop: "1.25rem" }}
          >
            Start new structured request
          </button>
        </div>
      ) : null}
      {requests && requests.items.length > 0 ? (
        <ul
          className="standard-history-list"
          aria-label="Product request history"
        >
          {requests.items.map((item) => (
            <li key={item.request_id}>
              <button
                className="standard-history-card"
                onClick={() => onOpenRequest(item.request_id)}
              >
                <span>
                  <strong>
                    <bdi dir="auto">
                      {conciseRequestLabel(item.canonical_summary)}
                    </bdi>
                  </strong>
                  <small>
                    {item.latest_run_outcome.replaceAll("_", " ")} ·{" "}
                    {item.version_count} canonical version
                    {item.version_count === 1 ? "" : "s"}
                  </small>
                </span>
                <time dateTime={item.updated_at}>
                  {new Date(item.updated_at).toLocaleString()}
                </time>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {requests?.next_cursor ? (
        <button
          className="secondary-action"
          onClick={() => void load(requests.next_cursor)}
        >
          Load more requests
        </button>
      ) : null}

      <section aria-labelledby="research-runs-heading">
        <h2 id="research-runs-heading">Research runs</h2>
        {runs?.items.length === 0 ? <p>No runs are recorded.</p> : null}
        {runs && runs.items.length > 0 ? (
          <ul className="standard-history-list">
            {runs.items.map((run) => (
              <li key={run.run_id}>
                <button
                  className="standard-history-card"
                  onClick={() => onOpenRun(run.run_id)}
                >
                  <span>
                    <strong>
                      <bdi dir="auto">
                        {conciseRequestLabel(
                          requests?.items.find(
                            (request) => request.request_id === run.request_id,
                          )?.canonical_summary ?? "Product request",
                        )}
                      </bdi>
                    </strong>
                    <small>
                      {run.phase_label} · {run.outcome.replaceAll("_", " ")} ·{" "}
                      {run.scarcity.replaceAll("_", " ")}
                    </small>
                  </span>
                  <time dateTime={run.updated_at}>
                    {new Date(run.updated_at).toLocaleString()}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {runs?.next_cursor ? (
          <button
            className="secondary-action"
            onClick={() => void load(undefined, runs.next_cursor)}
          >
            Load more runs
          </button>
        ) : null}
      </section>
    </section>
  );
}
