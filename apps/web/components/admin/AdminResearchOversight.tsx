"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { conciseCategory } from "../profile/UserProfile";
import styles from "./AdminResearchOversight.module.css";

type Session = {
  tier?: unknown;
  admin_sub_roles?: unknown;
  csrf_token?: unknown;
};
type Item = {
  account_id: string;
  run_id: string;
  request_id: string;
  requester: { user_id: string; display_name: string; email?: string | null };
  product_group?: string;
  request_summary: string;
  tier_at_submission: string;
  research_mode: string;
  state: string;
  queued_at: string;
  updated_at: string;
  outcome: string | null;
  eligible_count: number | null;
  considered_count: number | null;
  result_available: boolean;
};
type Inventory = {
  schema_version: "admin-research-inventory.v1" | "admin-research-inventory.v2";
  items: Item[];
  page: { limit: number; has_more: boolean; next_cursor: string | null };
  privacy_boundary: {
    source_text_released: false;
    email_released: boolean;
    complete_result_released: false;
  };
};

type GenericRecord = Record<string, unknown>;

function asRecord(value: unknown): GenericRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as GenericRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readable(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "Not available";
}

function resultCandidates(result: unknown): GenericRecord[] {
  const root = asRecord(result);
  const document =
    asRecord(root?.complete_result_document) ??
    asRecord(root?.complete_result) ??
    root;
  const candidates = document?.candidates;
  return Array.isArray(candidates)
    ? candidates.flatMap((candidate) => {
        const record = asRecord(candidate);
        return record ? [record] : [];
      })
    : [];
}

function CompleteResultSummary({
  result,
  runId,
}: {
  readonly result: unknown;
  readonly runId: string;
}) {
  const root = asRecord(result);
  const document =
    asRecord(root?.complete_result_document) ??
    asRecord(root?.complete_result) ??
    root;
  const candidates = resultCandidates(result);
  const outcome = text(document?.outcome) ?? text(root?.outcome);
  const eligible =
    typeof document?.eligible_count === "number"
      ? document.eligible_count
      : candidates.length;
  const limitations =
    text(document?.limitations_text) ?? text(root?.limitations_text);
  const evidenceCount = Array.isArray(document?.evidence)
    ? document.evidence.length
    : 0;
  return (
    <section
      className={styles.result}
      aria-labelledby="complete-result-heading"
    >
      <div className={styles.resultHeading}>
        <div>
          <p className={styles.eyebrow}>Audited disclosure</p>
          <h3 id="complete-result-heading">Complete result</h3>
          <p>Run {runId.slice(0, 8)}</p>
        </div>
        <span className={styles.resultOutcome}>{readable(outcome)}</span>
      </div>
      <dl className={styles.resultMetrics}>
        <div>
          <dt>Eligible candidates</dt>
          <dd>{eligible}</dd>
        </div>
        <div>
          <dt>Displayed candidates</dt>
          <dd>{candidates.length}</dd>
        </div>
        <div>
          <dt>Evidence records</dt>
          <dd>{evidenceCount}</dd>
        </div>
      </dl>
      {candidates.length > 0 ? (
        <ol className={styles.candidateList}>
          {candidates.map((candidate, index) => {
            const name =
              text(candidate.display_name) ??
              text(candidate.displayName) ??
              `Candidate ${index + 1}`;
            const rationale =
              text(candidate.rationale_short) ??
              text(candidate.rationale_extended);
            const country =
              text(candidate.country_or_region) ??
              text(candidate.country) ??
              text(candidate.country_code);
            const score =
              typeof candidate.compatibility_score === "number"
                ? candidate.compatibility_score
                : null;
            return (
              <li key={`${name}-${index}`}>
                <div className={styles.candidateHeading}>
                  <div>
                    <span>#{index + 1}</span>
                    <h4>
                      <bdi dir="auto">{name}</bdi>
                    </h4>
                  </div>
                  {score !== null ? (
                    <strong>{score} compatibility</strong>
                  ) : null}
                </div>
                {country ? <p>{country}</p> : null}
                {rationale ? (
                  <p>
                    <bdi dir="auto">{rationale}</bdi>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p>No eligible candidate is recorded in this result.</p>
      )}
      {limitations ? (
        <details className={styles.resultLimitations}>
          <summary>Limitations and cautions</summary>
          <p>
            <bdi dir="auto">{limitations}</bdi>
          </p>
        </details>
      ) : null}
    </section>
  );
}

function authorized(session: Session): boolean {
  return (
    session.tier === "admin" &&
    Array.isArray(session.admin_sub_roles) &&
    session.admin_sub_roles.includes("super_admin")
  );
}

async function json<T>(
  url: string,
  init?: RequestInit,
  csrfToken?: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { detail?: string };
  };
  if (!response.ok)
    throw new Error(
      body.error?.detail ?? "The operation could not be completed.",
    );
  return body;
}

export function AdminResearchOversight() {
  const [access, setAccess] = useState<
    "loading" | "allowed" | "denied" | "error"
  >("loading");
  const [scope, setScope] = useState<"all" | "own">("all");
  const [identity, setIdentity] = useState("");
  const [state, setState] = useState("");
  const [inventoryPurpose, setInventoryPurpose] = useState("");
  const [applied, setApplied] = useState({
    scope: "all" as "all" | "own",
    identity: "",
    state: "",
    purpose: "",
  });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [back, setBack] = useState<(string | null)[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState(
    "Verifying operator access.",
  );

  useEffect(() => {
    void json<Session>("/api/v1/me")
      .then((session) => {
        const allowed = authorized(session);
        if (allowed && typeof session.csrf_token !== "string")
          throw new Error();
        setCsrfToken(allowed ? (session.csrf_token as string) : null);
        setAccess(allowed ? "allowed" : "denied");
        setAnnouncement(
          allowed ? "Super-admin access verified." : "Access denied.",
        );
      })
      .catch(() => {
        setAccess("error");
        setAnnouncement("Authority verification failed.");
      });
  }, []);

  const load = useCallback(async () => {
    if (access !== "allowed" || !applied.purpose) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const query = new URLSearchParams({
      limit: "20",
      scope: applied.scope,
      purpose: applied.purpose,
    });
    if (applied.identity) query.set("identity", applied.identity);
    if (applied.state) query.set("state", applied.state);
    if (cursor) query.set("cursor", cursor);
    try {
      const body = await json<Inventory>(`/api/v1/admin/research?${query}`);
      setInventory(body);
      setAnnouncement(`${body.items.length} research records loaded.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Inventory unavailable.",
      );
      setAnnouncement("Research inventory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [access, applied, cursor]);

  useEffect(() => void load(), [load]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inventoryPurpose.trim()) {
      setError(
        "A specific operational purpose is required for inventory access.",
      );
      return;
    }
    setBack([]);
    setCursor(null);
    setApplied({
      scope,
      identity: identity.trim(),
      state,
      purpose: inventoryPurpose.trim(),
    });
  }

  async function openCompleteResult(runId: string) {
    if (!justification.trim()) {
      setError(
        "A specific operational purpose is required before complete-result access.",
      );
      return;
    }
    setSelectedRun(runId);
    setResult(null);
    setError(null);
    try {
      const body = await json<unknown>(
        "/api/v1/admin/unprojected-result",
        {
          method: "POST",
          headers: { "Idempotency-Key": `admin-result-${crypto.randomUUID()}` },
          body: JSON.stringify({
            run_id: runId,
            justification: justification.trim(),
          }),
        },
        csrfToken ?? undefined,
      );
      setResult(body);
      setAnnouncement("Complete result disclosed and audited.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Result unavailable.",
      );
    }
  }

  if (access !== "allowed")
    return (
      <main className={styles.shell} id="main-content">
        <section className={styles.panel}>
          <h1>
            {access === "loading"
              ? "Verifying Super-admin authority"
              : "Research inventory unavailable"}
          </h1>
          {access === "denied" ? (
            <p role="alert">An active stored Super-admin grant is required.</p>
          ) : null}
          {access === "error" ? (
            <p role="alert">Stored authority could not be verified.</p>
          ) : null}
        </section>
      </main>
    );

  return (
    <main className={styles.shell} id="main-content">
      <header className={styles.header}>
        <p className={styles.eyebrow}>MatchBASE · Super-admin</p>
        <h1>All research runs</h1>
        <p className={styles.lede}>
          System-wide request summaries, run status and result availability.
          Every read is authorized from stored grants and purpose-audited.
        </p>
        <p className={styles.boundary}>
          Source text, evidence and complete result documents are excluded from
          the inventory. Verified account name and email identify the requester.
          Complete-result access requires a written operational purpose and
          creates a disclosure audit.
        </p>
        <p>
          <a href="/">Return to Admin operations</a>
        </p>
      </header>
      <p className={styles.srOnly} aria-live="polite">
        {announcement}
      </p>
      <section className={styles.panel} aria-labelledby="filters-heading">
        <h2 id="filters-heading">Inventory filters</h2>
        <form className={styles.filters} onSubmit={apply}>
          <label className={styles.field}>
            Scope
            <select
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as "all" | "own")
              }
            >
              <option value="all">All users</option>
              <option value="own">My runs</option>
            </select>
          </label>
          <label className={styles.field}>
            User name or verified email
            <input
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              placeholder="Optional name or email"
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            Run state
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">All states</option>
              {[
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
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Inventory purpose
            <input
              value={inventoryPurpose}
              onChange={(event) => setInventoryPurpose(event.target.value)}
              maxLength={500}
            />
          </label>
          <button className={styles.button} type="submit">
            Apply filters
          </button>
        </form>
      </section>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <section className={styles.panel} aria-labelledby="inventory-heading">
        <h2 id="inventory-heading">Research inventory</h2>
        {loading ? <p role="status">Loading research records…</p> : null}
        {!loading && inventory?.items.length === 0 ? (
          <p>No research records match this view.</p>
        ) : null}
        {!loading && inventory && inventory.items.length > 0 ? (
          <ol className={styles.inventoryList} aria-label="All research runs">
            {inventory.items.map((item) => (
              <li key={item.run_id} className={styles.researchCard}>
                <div className={styles.cardSummary}>
                  <div className={styles.userIdentity}>
                    <span className={styles.avatar} aria-hidden="true">
                      {item.requester.display_name
                        .trim()
                        .slice(0, 1)
                        .toUpperCase() || "U"}
                    </span>
                    <div>
                      <strong>
                        <bdi dir="auto">{item.requester.display_name}</bdi>
                      </strong>
                      {item.requester.email ? (
                        <small>
                          <bdi dir="ltr">{item.requester.email}</bdi>
                        </small>
                      ) : (
                        <small>Verified account</small>
                      )}
                    </div>
                  </div>
                  <div className={styles.productSummary}>
                    <span>Product / category</span>
                    <h3>
                      <bdi dir="auto">
                        {item.product_group ||
                          conciseCategory(item.request_summary)}
                      </bdi>
                    </h3>
                    <small>
                      Updated{" "}
                      <time dateTime={item.updated_at}>
                        {new Date(item.updated_at).toLocaleString()}
                      </time>
                    </small>
                  </div>
                  <div className={styles.cardStatus}>
                    <span className={styles.status}>
                      {readable(item.outcome ?? item.state)}
                    </span>
                    <small>{readable(item.tier_at_submission)} access</small>
                  </div>
                </div>
                <div className={styles.cardActions}>
                  {item.result_available ? (
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => void openCompleteResult(item.run_id)}
                      aria-pressed={
                        selectedRun === item.run_id && result !== null
                      }
                    >
                      Open complete result
                    </button>
                  ) : item.outcome === "failed" ? (
                    <span className={styles.failure}>
                      Research failed — no result was generated
                    </span>
                  ) : (
                    <span>{readable(item.outcome)}</span>
                  )}
                  <details className={styles.details}>
                    <summary>View request details</summary>
                    <div className={styles.detailGrid}>
                      <div className={styles.fullSummary}>
                        <span>Request summary</span>
                        <p>
                          <bdi dir="auto">{item.request_summary}</bdi>
                        </p>
                      </div>
                      <dl>
                        <div>
                          <dt>Run</dt>
                          <dd>
                            <code>{item.run_id.slice(0, 8)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>User</dt>
                          <dd>
                            <code>{item.requester.user_id.slice(0, 8)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Mode</dt>
                          <dd>{readable(item.research_mode)}</dd>
                        </div>
                        <div>
                          <dt>Candidates</dt>
                          <dd>
                            {item.eligible_count ?? 0} eligible /{" "}
                            {item.considered_count ?? 0} considered
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        <nav
          className={styles.pagination}
          aria-label="Research inventory pages"
        >
          <button
            className={styles.button}
            type="button"
            disabled={back.length === 0}
            onClick={() => {
              const previous = back.at(-1);
              if (previous !== undefined) {
                setBack((value) => value.slice(0, -1));
                setCursor(previous);
              }
            }}
          >
            Previous page
          </button>
          <span>Page {back.length + 1}</span>
          <button
            className={styles.button}
            type="button"
            disabled={!inventory?.page.next_cursor}
            onClick={() => {
              if (inventory?.page.next_cursor) {
                setBack((value) => [...value, cursor]);
                setCursor(inventory.page.next_cursor);
              }
            }}
          >
            Next page
          </button>
        </nav>
      </section>
      <section className={styles.panel} aria-labelledby="purpose-heading">
        <h2 id="purpose-heading">Complete-result purpose</h2>
        <label className={styles.field}>
          Operational justification
          <textarea
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            rows={3}
            maxLength={2000}
          />
        </label>
        {selectedRun && result ? (
          <CompleteResultSummary result={result} runId={selectedRun} />
        ) : null}
      </section>
    </main>
  );
}
