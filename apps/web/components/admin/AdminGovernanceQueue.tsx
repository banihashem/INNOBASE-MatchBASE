"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./AdminGovernanceQueue.module.css";

const GOVERNANCE_STATES = [
  "Review Required",
  "Escalated to Human",
  "Output Restricted",
  "Evaluation Failed",
] as const;
const RUN_STATES = [
  "queued",
  "researching",
  "escalated",
  "restricted",
  "scoring",
  "cancelling",
  "failed_retryable",
  "complete",
  "no_responsible_match",
  "failed",
  "cancelled",
  "superseded",
] as const;
const FAILURE_CLASSES = [
  "provider_unavailable",
  "canonicalization_failed",
  "evidence_subsystem_unavailable",
  "timeout",
] as const;
const ALLOWED_ROLES = ["support", "analyst", "super_admin"] as const;

type GovernanceState = (typeof GOVERNANCE_STATES)[number];
type RunState = (typeof RUN_STATES)[number];
type FailureClass = (typeof FAILURE_CLASSES)[number];

interface SessionProjection {
  readonly tier?: unknown;
  readonly admin_sub_roles?: unknown;
}

interface RunItem {
  readonly run_id: string;
  readonly governance_state: GovernanceState;
  readonly reason_code: string;
  readonly trigger_rule_id?: string;
  readonly raised_at: string;
  readonly run_state: RunState;
  readonly human_action_required: boolean;
  readonly automated_path_blocked: boolean;
}

interface RunsPage {
  readonly items: readonly RunItem[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

interface Filters {
  readonly governance_state: "" | GovernanceState;
  readonly run_state: "" | RunState;
  readonly failure_class: "" | FailureClass;
  readonly limit: "20" | "50" | "100";
}

const INITIAL_FILTERS: Filters = {
  governance_state: "",
  run_state: "",
  failure_class: "",
  limit: "20",
};

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf())
    ? "Timestamp unavailable"
    : TIMESTAMP_FORMATTER.format(timestamp);
}

function safeReason(reasonCode: string): string {
  return reasonCode === "reason_unavailable"
    ? "Reason unavailable by policy"
    : "Governance reason recorded";
}

function queryString(filters: Filters, cursor: string | null): string {
  const query = new URLSearchParams({ limit: filters.limit });
  if (filters.governance_state)
    query.set("governance_state", filters.governance_state);
  if (filters.run_state) query.set("run_state", filters.run_state);
  if (filters.failure_class) query.set("failure_class", filters.failure_class);
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}

function isAuthorizedSession(session: SessionProjection): boolean {
  const roles = Array.isArray(session.admin_sub_roles)
    ? session.admin_sub_roles.filter(
        (role): role is string => typeof role === "string",
      )
    : [];
  return (
    session.tier === "admin" &&
    roles.some((role) =>
      ALLOWED_ROLES.some((allowedRole) => allowedRole === role),
    )
  );
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(response.status === 403 ? "forbidden" : "unavailable");
  }
  return (await response.json()) as T;
}

function StateBadge({ state }: { readonly state: GovernanceState }) {
  const className = {
    "Review Required": styles.reviewBadge,
    "Escalated to Human": styles.escalatedBadge,
    "Output Restricted": styles.restrictedBadge,
    "Evaluation Failed": styles.failedBadge,
  }[state];
  return <span className={`${styles.badge} ${className}`}>{state}</span>;
}

export function AdminGovernanceQueue() {
  const [sessionState, setSessionState] = useState<
    "loading" | "allowed" | "denied" | "error"
  >("loading");
  const [draftFilters, setDraftFilters] = useState<Filters>(INITIAL_FILTERS);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [backCursors, setBackCursors] = useState<readonly (string | null)[]>(
    [],
  );
  const [sessionReload, setSessionReload] = useState(0);
  const [readReload, setReadReload] = useState(0);
  const [readState, setReadState] = useState<
    "idle" | "loading" | "success" | "forbidden" | "error"
  >("idle");
  const [result, setResult] = useState<RunsPage | null>(null);
  const [liveStatus, setLiveStatus] = useState("Verifying operator access.");
  const sessionGeneration = useRef(0);
  const readGeneration = useRef(0);

  useEffect(() => {
    const generation = ++sessionGeneration.current;
    setSessionState("loading");
    setLiveStatus("Verifying operator access.");
    void requestJson<SessionProjection>("/api/v1/me")
      .then((session) => {
        if (generation !== sessionGeneration.current) return;
        if (!isAuthorizedSession(session)) {
          setSessionState("denied");
          setLiveStatus("Access denied.");
          return;
        }
        setSessionState("allowed");
        setLiveStatus("Operator access verified.");
      })
      .catch(() => {
        if (generation !== sessionGeneration.current) return;
        setSessionState("error");
        setLiveStatus("Operator access verification failed.");
      });
  }, [sessionReload]);

  useEffect(() => {
    if (sessionState !== "allowed") return;
    const generation = ++readGeneration.current;
    setReadState("loading");
    setResult(null);
    setLiveStatus(
      activeCursor
        ? "Loading another result page."
        : "Loading governance runs.",
    );
    void requestJson<RunsPage>(
      `/api/v1/admin/runs?${queryString(filters, activeCursor)}`,
    )
      .then((body) => {
        if (generation !== readGeneration.current) return;
        setResult(body);
        setReadState("success");
        setLiveStatus(
          body.items.length === 0
            ? "No governance runs match this view."
            : `${body.items.length} governance runs loaded.`,
        );
      })
      .catch((error: unknown) => {
        if (generation !== readGeneration.current) return;
        setReadState(
          error instanceof Error && error.message === "forbidden"
            ? "forbidden"
            : "error",
        );
        setLiveStatus("Governance runs could not be loaded.");
      });
  }, [activeCursor, filters, readReload, sessionState]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBackCursors([]);
    setActiveCursor(null);
    setFilters(draftFilters);
    if (
      filters.governance_state === draftFilters.governance_state &&
      filters.run_state === draftFilters.run_state &&
      filters.failure_class === draftFilters.failure_class &&
      filters.limit === draftFilters.limit
    ) {
      setReadReload((value) => value + 1);
    }
  }

  function clearFilters() {
    setDraftFilters(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
    setBackCursors([]);
    setActiveCursor(null);
    setReadReload((value) => value + 1);
  }

  function nextPage() {
    if (!result?.page.next_cursor) return;
    setBackCursors((current) => [...current, activeCursor]);
    setActiveCursor(result.page.next_cursor);
  }

  function previousPage() {
    const previous = backCursors.at(-1);
    if (previous === undefined) return;
    setBackCursors((current) => current.slice(0, -1));
    setActiveCursor(previous);
  }

  const hasFilters = Boolean(
    filters.governance_state || filters.run_state || filters.failure_class,
  );

  return (
    <>
      <a className={styles.skipLink} href="#governance-queue-main">
        Skip to governance queue
      </a>
      <main className={styles.shell} id="governance-queue-main" tabIndex={-1}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>MatchBASE · Admin</p>
          <h1>Requests and runs</h1>
          <p className={styles.lede}>
            Read-only governance states and their operational blocking status.
          </p>
          <p className={styles.scopeNote}>
            Reviewer assignment policy and clear actions are not delivered. This
            surface has no mutation control and states no review SLA.
          </p>
        </header>

        <p className={styles.srOnly} aria-live="polite">
          {liveStatus}
        </p>

        {sessionState === "loading" ? (
          <section
            className={styles.panel}
            aria-labelledby="access-loading-title"
          >
            <h2 id="access-loading-title">Verifying operator access</h2>
            <p>Checking the current stored role boundary…</p>
          </section>
        ) : null}

        {sessionState === "denied" ? (
          <section
            className={styles.panel}
            aria-labelledby="access-denied-title"
          >
            <h2 id="access-denied-title">Access unavailable</h2>
            <p role="alert">
              This view requires the Admin tier with Support, Analyst, or
              Super-admin access. Consultant manager alone does not grant
              access.
            </p>
          </section>
        ) : null}

        {sessionState === "error" ? (
          <section
            className={styles.panel}
            aria-labelledby="session-error-title"
          >
            <h2 id="session-error-title">Session check unavailable</h2>
            <p role="alert">Operator access could not be verified.</p>
            <button
              className={styles.button}
              type="button"
              onClick={() => setSessionReload((value) => value + 1)}
            >
              Retry session check
            </button>
          </section>
        ) : null}

        {sessionState === "allowed" ? (
          <>
            <section className={styles.panel} aria-labelledby="filters-title">
              <h2 id="filters-title">Queue filters</h2>
              <form className={styles.filters} onSubmit={applyFilters}>
                <div className={styles.field}>
                  <label htmlFor="governance-state">Governance state</label>
                  <select
                    id="governance-state"
                    value={draftFilters.governance_state}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        governance_state: event.target
                          .value as Filters["governance_state"],
                      }))
                    }
                  >
                    <option value="">All governance states</option>
                    {GOVERNANCE_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="run-state">Run state</label>
                  <select
                    id="run-state"
                    value={draftFilters.run_state}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        run_state: event.target.value as Filters["run_state"],
                      }))
                    }
                  >
                    <option value="">All run states</option>
                    {RUN_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="failure-class">Failure class</label>
                  <select
                    id="failure-class"
                    value={draftFilters.failure_class}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        failure_class: event.target
                          .value as Filters["failure_class"],
                      }))
                    }
                  >
                    <option value="">All failure classes</option>
                    {FAILURE_CLASSES.map((failureClass) => (
                      <option key={failureClass} value={failureClass}>
                        {failureClass}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="page-limit">Rows per page</label>
                  <select
                    id="page-limit"
                    value={draftFilters.limit}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        limit: event.target.value as Filters["limit"],
                      }))
                    }
                  >
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
                <div className={styles.actions}>
                  <button className={styles.button} type="submit">
                    Apply filters
                  </button>
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    type="button"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </div>
              </form>
            </section>

            {readState === "loading" ? (
              <section
                className={styles.panel}
                aria-labelledby="runs-loading-title"
              >
                <h2 id="runs-loading-title">Loading governance runs</h2>
                <p>
                  {activeCursor
                    ? "Loading the requested page…"
                    : "Loading the current queue…"}
                </p>
              </section>
            ) : null}

            {readState === "forbidden" ? (
              <section
                className={styles.panel}
                aria-labelledby="runs-denied-title"
              >
                <h2 id="runs-denied-title">Queue unavailable</h2>
                <p role="alert">
                  The governance queue is not visible to this session.
                </p>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => setReadReload((value) => value + 1)}
                >
                  Retry queue
                </button>
              </section>
            ) : null}

            {readState === "error" ? (
              <section
                className={styles.panel}
                aria-labelledby="runs-error-title"
              >
                <h2 id="runs-error-title">Queue read unavailable</h2>
                <p role="alert">Governance runs could not be loaded.</p>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => setReadReload((value) => value + 1)}
                >
                  Retry queue
                </button>
              </section>
            ) : null}

            {readState === "success" && result ? (
              <section className={styles.panel} aria-labelledby="runs-title">
                <div className={styles.resultHeading}>
                  <h2 id="runs-title">Governance queue</h2>
                  <p>{result.items.length} records on this page</p>
                </div>
                {result.items.length === 0 ? (
                  <p className={styles.empty}>
                    {hasFilters
                      ? "No governance runs match the applied filters."
                      : "No governance runs require operator attention."}
                  </p>
                ) : (
                  <div className={styles.tableScroll} tabIndex={0}>
                    <table className={styles.table}>
                      <caption>
                        Governance state projection for requests and runs
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">State</th>
                          <th scope="col">Run</th>
                          <th scope="col">Reason</th>
                          <th scope="col">Raised</th>
                          <th scope="col">Run state</th>
                          <th scope="col">Automated path</th>
                          <th scope="col">Human action</th>
                          <th scope="col">Navigation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.items.map((item) => (
                          <tr
                            key={`${item.run_id}:${item.governance_state}:${item.raised_at}`}
                          >
                            <th scope="row">
                              <StateBadge state={item.governance_state} />
                            </th>
                            <td>
                              <bdi dir="auto">{item.run_id}</bdi>
                            </td>
                            <td>{safeReason(item.reason_code)}</td>
                            <td>
                              <time dateTime={item.raised_at}>
                                {formatTimestamp(item.raised_at)}
                              </time>
                            </td>
                            <td>{item.run_state}</td>
                            <td>
                              {item.automated_path_blocked ? "Blocked" : "Open"}
                            </td>
                            <td>
                              {item.human_action_required
                                ? "Required"
                                : "Not required"}
                            </td>
                            <td>
                              <a
                                className={styles.runLink}
                                href={`/runs/${encodeURIComponent(item.run_id)}`}
                              >
                                Open run{" "}
                                <span className={styles.srOnly}>
                                  {item.run_id}
                                </span>
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <nav
                  className={styles.pagination}
                  aria-label="Governance queue pages"
                >
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    type="button"
                    disabled={backCursors.length === 0}
                    onClick={previousPage}
                  >
                    Previous page
                  </button>
                  <span>Page {backCursors.length + 1}</span>
                  <button
                    className={styles.button}
                    type="button"
                    disabled={!result.page.has_more || !result.page.next_cursor}
                    onClick={nextPage}
                  >
                    Next page
                  </button>
                </nav>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
