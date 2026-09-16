"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Observation = {
  observation_id: string;
  claim_kind: string;
  claim_text: string;
  eligible_until: string;
  category_match?: "exact" | "related";
  classification?: { scheme?: string; code?: string; label?: string } | null;
  source: { source_url: string; publisher: string; retrieved_at: string };
};
type Result = {
  observations: Observation[];
  current_count: number;
  expired_count: number;
  fresh_discovery_required: true;
};
const date = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "Date unavailable";

export function ProfileEvidenceLibrary() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [status, setStatus] = useState<"current" | "expired" | "all">(
    "current",
  );
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const parameters = new URLSearchParams({ status });
      if (submitted) parameters.set("query", submitted);
      const response = await fetch(
        `/api/v1/consultant/profile-evidence?${parameters}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("Unavailable");
      setResult((await response.json()) as Result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [status, submitted]);
  useEffect(() => void load(), [load]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(query.trim());
  }
  return (
    <section className="cx-panel cx-memory-library">
      <div className="cx-section-heading">
        <div>
          <p className="cx-eyebrow">Private research memory</p>
          <h2>Your saved evidence</h2>
          <p>
            Search evidence retained for this profile. Opening this library does
            not start research or create model cost.
          </p>
        </div>
      </div>
      <form className="cx-profile-actions" onSubmit={submit}>
        <label className="cx-search">
          Search claims, publishers or registry identifiers
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Supplier, route, price or requirement"
          />
        </label>
        <label className="cx-memory-filter">
          Evidence status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="current">Current</option>
            <option value="expired">Needs refresh</option>
            <option value="all">All</option>
          </select>
        </label>
        <button
          className="cx-button-secondary"
          type="submit"
          disabled={loading}
        >
          {loading ? "Searching…" : "Search saved evidence"}
        </button>
      </form>
      {error && (
        <p role="alert">
          Saved evidence could not be loaded. No research or paid model call was
          started.
        </p>
      )}
      {result && !error && (
        <>
          <p role="status" aria-live="polite">
            {result.current_count} current · {result.expired_count} need refresh
            · {result.observations.length} shown
          </p>
          <p className="cx-request-subtitle">
            Saved evidence can guide a new request. New supplier findings still
            require fresh discovery and verification.
          </p>
          {!result.observations.length ? (
            <div className="cx-empty">
              <h3>No matching saved evidence</h3>
              <p>Change the search or status filter. Nothing was deleted.</p>
            </div>
          ) : (
            <ul
              className="cx-research-list cx-compact-list"
              aria-label="Saved private evidence"
            >
              {result.observations.map((item) => (
                <li key={item.observation_id}>
                  <div>
                    <span className="cx-state">{item.claim_kind}</span>
                    <h3 dir="auto">{item.claim_text}</h3>
                    <p>
                      {item.classification?.scheme && item.classification?.code
                        ? `${item.classification.scheme} ${item.classification.code}${item.classification.label ? ` · ${item.classification.label}` : ""}`
                        : "Saved classification"}
                      {item.category_match === "related"
                        ? " · Related category"
                        : ""}
                    </p>
                    <p className="cx-time">
                      Retrieved {date(item.source.retrieved_at)} · Eligible
                      until {date(item.eligible_until)}
                    </p>
                    <a
                      href={item.source.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.source.publisher || "Open evidence source"}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
