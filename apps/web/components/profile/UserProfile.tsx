"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseDemoProjectionV1,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseStandardResultProjectionV1,
  parseUserProfileHistoryV1,
  parseUserProfileHistoryV2,
  type ProductTier,
  type UserProfileHistoryV1,
  type UserProfileHistoryV2,
  type UserProfileRunV1,
} from "@matchbase/contracts";
import {
  ConsultantResultView,
  type ConsultantVisibleResult,
} from "../consultant/ConsultantResult";
import { workspaceJson } from "../standard/api";
import styles from "./UserProfile.module.css";

type ProfileHistory = UserProfileHistoryV1 | UserProfileHistoryV2;

type ProfileView =
  | { state: "loading" }
  | { state: "history"; history: ProfileHistory }
  | { state: "result"; result: ConsultantVisibleResult }
  | { state: "error"; message: string };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Draft",
  canonicalised: "Ready to confirm",
  confirmed: "Ready for research",
  closed: "Closed",
  queued: "Queued",
  researching: "Researching",
  scoring: "Evaluating matches",
  complete: "Complete",
  no_responsible_match: "No eligible match",
  failed: "Needs attention",
  failed_retryable: "Retry available",
  cancelled: "Cancelled",
  superseded: "Superseded",
  matched: "Matches found",
  pending: "In progress",
};

const TIER_LABELS: Readonly<Record<ProductTier, string>> = {
  demo: "Demo",
  standard: "Standard",
  consultant: "Consultant",
};

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

export function conciseCategory(summary: string): string {
  const normalized = summary.replace(/\s+/gu, " ").trim();
  const labelled = normalized.match(
    /^(?:product(?:\s+or\s+capability)?\s+need|product_need|requirement)\s*:\s*(.+)$/iu,
  )?.[1];
  const source = labelled ?? normalized;
  const firstSentence = source.split(/[.!?](?:\s|$)/u)[0]?.trim() ?? source;
  const withoutPreamble = firstSentence
    .replace(
      /^(?:procurement\s+request\s+for|request\s+for|procurement\s+of|procure|source|sourcing)\s+/iu,
      "",
    )
    .replace(/^(?:a|an|the)\s+/iu, "");
  const value = withoutPreamble || "Product request";
  return value.length > 88 ? `${value.slice(0, 85).trimEnd()}…` : value;
}

function statusLabel(run: UserProfileRunV1 | undefined, fallback: string) {
  const value = run?.outcome ?? run?.state ?? fallback;
  return STATUS_LABELS[value] ?? value.replaceAll("_", " ");
}

function statusTone(run: UserProfileRunV1 | undefined): string {
  if (run?.outcome === "matched") return styles.success ?? "";
  if (run?.outcome === "failed" || run?.outcome === "no_responsible_match")
    return styles.warning ?? "";
  if (["cancelled", "superseded"].includes(run?.outcome ?? ""))
    return styles.muted ?? "";
  return styles.progress ?? "";
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
      : words[0]?.slice(0, 2) || "MB"
  ).toLocaleUpperCase();
}

export function UserProfile({
  tier,
  displayName,
  email,
  quota,
  onNewRequest,
  newRequestHref,
}: {
  readonly tier: ProductTier;
  readonly displayName: string;
  readonly email?: string | null | undefined;
  readonly quota?:
    | {
        readonly limit: number | null;
        readonly remaining: number | null;
        readonly next_capacity_at: string | null;
      }
    | undefined;
  readonly onNewRequest?: (() => void) | undefined;
  readonly newRequestHref?: string | undefined;
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
        const history =
          response.body !== null &&
          typeof response.body === "object" &&
          "schema_version" in response.body &&
          response.body.schema_version === "user-profile-history.v2"
            ? parseUserProfileHistoryV2(response.body)
            : parseUserProfileHistoryV1(response.body);
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
          if (
            current.history.schema_version === "user-profile-history.v2" &&
            history.schema_version === "user-profile-history.v2"
          )
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
          if (
            current.history.schema_version === "user-profile-history.v1" &&
            history.schema_version === "user-profile-history.v1"
          )
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
          return { state: "history", history };
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
    <ProfileHistory
      history={history}
      tier={tier}
      displayName={displayName}
      email={email}
      quota={quota}
      headingRef={headingRef}
      loadingMore={loadingMore}
      pageError={pageError}
      onNewRequest={onNewRequest}
      newRequestHref={newRequestHref}
      onOpenResult={openResult}
      onLoadMore={(cursor) => void loadHistory(cursor)}
    />
  );
}

function ProfileHistory({
  history,
  tier,
  displayName,
  email,
  quota,
  headingRef,
  loadingMore,
  pageError,
  onNewRequest,
  newRequestHref,
  onOpenResult,
  onLoadMore,
}: {
  readonly history: ProfileHistory;
  readonly tier: ProductTier;
  readonly displayName: string;
  readonly email?: string | null | undefined;
  readonly quota?:
    | {
        readonly limit: number | null;
        readonly remaining: number | null;
        readonly next_capacity_at: string | null;
      }
    | undefined;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly loadingMore: boolean;
  readonly pageError: string | null;
  readonly onNewRequest?: (() => void) | undefined;
  readonly newRequestHref?: string | undefined;
  readonly onOpenResult: (path: string) => Promise<void>;
  readonly onLoadMore: (cursor: string) => void;
}) {
  const runsByRequest = useMemo(() => {
    const grouped = new Map<string, UserProfileRunV1[]>();
    for (const run of history.runs) {
      const items = grouped.get(run.request_id) ?? [];
      items.push(run);
      grouped.set(run.request_id, items);
    }
    return grouped;
  }, [history.runs]);
  const completeCount = history.runs.filter(
    (run) =>
      run.outcome === "matched" || run.outcome === "no_responsible_match",
  ).length;
  const activeCount = history.runs.filter(
    (run) => run.outcome === "pending",
  ).length;
  const lastActivity = [
    ...history.requests.map((item) => item.updated_at),
    ...history.runs.map((item) => item.updated_at),
  ].sort(
    (left, right) => new Date(right).valueOf() - new Date(left).valueOf(),
  )[0];

  return (
    <section className="standard-section" aria-labelledby="profile-heading">
      <div className={styles.profileHero}>
        <div className={styles.avatar} aria-hidden="true">
          {initials(displayName)}
        </div>
        <div className={styles.identityCopy}>
          <p className="eyebrow">Your MatchBASE profile</p>
          <h1 id="profile-heading" ref={headingRef} tabIndex={-1}>
            <bdi dir="auto">{displayName}</bdi>
          </h1>
          {email ? (
            <p className={styles.email}>
              <span className={styles.verifiedMark} aria-hidden="true">
                ✓
              </span>
              <span className="sr-only">Verified Google email: </span>
              <bdi dir="ltr">{email}</bdi>
            </p>
          ) : (
            <p className={styles.email}>Google identity verified</p>
          )}
        </div>
        {onNewRequest ? (
          <button className="primary-action" onClick={onNewRequest}>
            New search
          </button>
        ) : newRequestHref ? (
          <a className="primary-action" href={newRequestHref}>
            New search
          </a>
        ) : null}
      </div>

      <dl className={styles.metrics} aria-label="Profile summary">
        <div>
          <dt>Requests</dt>
          <dd>{history.requests.length}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{completeCount}</dd>
        </div>
        <div>
          <dt>In progress</dt>
          <dd>{activeCount}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>{TIER_LABELS[tier]}</dd>
        </div>
        <div>
          <dt>Research remaining</dt>
          <dd>
            <span>{quota?.remaining ?? "—"}</span>
            <small className={styles.metricNote}>
              {quota?.limit === null
                ? "Governed capacity"
                : quota?.next_capacity_at
                  ? `Next capacity ${format(quota.next_capacity_at)} UTC`
                  : "Capacity available now"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd className={styles.dateMetric}>
            <span>{lastActivity ? format(lastActivity) : "—"}</span>
            {lastActivity ? (
              <small className={styles.metricNote}>UTC</small>
            ) : null}
          </dd>
        </div>
      </dl>

      <section
        className={styles.historySection}
        aria-labelledby="profile-history-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Search history</p>
            <h2 id="profile-history-heading">Your product requests</h2>
          </div>
          <p>Open a request only when you need its full context or result.</p>
        </div>

        {history.requests.length === 0 ? (
          <div className={styles.empty}>
            <h3>No searches yet</h3>
            <p>Your first product request will appear here.</p>
          </div>
        ) : (
          <ol className={styles.requestList}>
            {history.requests.map((request) => {
              const runs = runsByRequest.get(request.request_id) ?? [];
              const latestRun = runs[0];
              return (
                <li key={request.request_id} className={styles.requestCard}>
                  <div className={styles.requestMain}>
                    <div className={styles.categoryIcon} aria-hidden="true">
                      {("product_group" in request
                        ? request.product_group
                        : conciseCategory(request.canonical_summary)
                      ).slice(0, 1)}
                    </div>
                    <div className={styles.requestCopy}>
                      <p className={styles.itemLabel}>Product / category</p>
                      <h3>
                        <bdi dir="auto">
                          {"product_group" in request
                            ? request.product_group
                            : conciseCategory(request.canonical_summary)}
                        </bdi>
                      </h3>
                      <p className={styles.itemMeta}>
                        Updated{" "}
                        <time dateTime={request.updated_at}>
                          {format(request.updated_at)} UTC
                        </time>
                        <span aria-hidden="true"> · </span>
                        {runs.length} {runs.length === 1 ? "run" : "runs"}
                      </p>
                    </div>
                    <span
                      className={`${styles.statusBadge} ${statusTone(latestRun)}`}
                    >
                      {statusLabel(latestRun, request.lifecycle_state)}
                    </span>
                  </div>

                  <div className={styles.cardActions}>
                    {latestRun?.links.result ? (
                      <button
                        className="primary-action"
                        onClick={() =>
                          void onOpenResult(latestRun.links.result!)
                        }
                      >
                        View result
                      </button>
                    ) : latestRun?.outcome === "failed" ? (
                      <span className={styles.failureText}>
                        No result was generated
                      </span>
                    ) : latestRun?.result_available ? (
                      <span className={styles.restrictedText}>
                        Result is fixed to its submission access
                      </span>
                    ) : null}
                    <details className={styles.details}>
                      <summary>Request details</summary>
                      <div className={styles.detailBody}>
                        <div>
                          <span>Full request summary</span>
                          <p>
                            <bdi dir="auto">{request.canonical_summary}</bdi>
                          </p>
                        </div>
                        <dl className={styles.technicalDetails}>
                          <div>
                            <dt>Request reference</dt>
                            <dd>
                              <code>{request.request_id.slice(0, 8)}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Version</dt>
                            <dd>{request.canonical_request_version}</dd>
                          </div>
                          <div>
                            <dt>Request state</dt>
                            <dd>
                              {STATUS_LABELS[request.lifecycle_state] ??
                                request.lifecycle_state}
                            </dd>
                          </div>
                          <div>
                            <dt>Created</dt>
                            <dd>
                              <time dateTime={request.created_at}>
                                {format(request.created_at)} UTC
                              </time>
                            </dd>
                          </div>
                        </dl>
                        {runs.length > 0 ? (
                          <div>
                            <span>Research activity</span>
                            <ul className={styles.runList}>
                              {runs.map((run) => (
                                <li key={run.run_id}>
                                  <span>{statusLabel(run, run.state)}</span>
                                  <small>
                                    {TIER_LABELS[run.submitted_tier]} ·{" "}
                                    <time dateTime={run.updated_at}>
                                      {format(run.updated_at)} UTC
                                    </time>
                                  </small>
                                  {run.links.result &&
                                  run.run_id !== latestRun?.run_id ? (
                                    <button
                                      className="secondary-action"
                                      onClick={() =>
                                        void onOpenResult(run.links.result!)
                                      }
                                    >
                                      View this result
                                    </button>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {history.page.next_cursor ? (
        <button
          className="secondary-action"
          disabled={loadingMore}
          onClick={() => onLoadMore(history.page.next_cursor!)}
        >
          {loadingMore ? "Loading more history…" : "Load more history"}
        </button>
      ) : null}
      {pageError ? <p role="alert">{pageError}</p> : null}
    </section>
  );
}
