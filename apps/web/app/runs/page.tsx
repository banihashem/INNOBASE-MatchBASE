"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GOLDEN_SCENARIOS } from "@matchbase/contracts";

interface RunItem {
  run_id: string;
  request_id: string;
  state: string;
  updated_at: string;
  result_available: boolean;
  outcome: string;
}

interface UserSession {
  account_id: string;
  user_id: string;
  display_name: string;
  tier: "demo" | "standard" | "consultant" | "admin";
}

export default function RunsPage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Research Runs | MatchBASE";
  }, []);

  useEffect(() => {
    void fetch("/api/v1/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setSession(null);
          return;
        }
        const data = (await res.json()) as UserSession;
        setSession(data);
      })
      .catch(() => setSession(null))
      .finally(() => setLoadingSession(false));
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoadingRuns(true);
    const endpoint =
      session.tier === "admin" || session.tier === "consultant"
        ? "/api/v1/consultant/runs"
        : "/api/v1/runs";
    void fetch(endpoint, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load run history");
        const data = (await res.json()) as { items?: RunItem[] };
        setRuns(data.items ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Error loading runs");
      })
      .finally(() => setLoadingRuns(false));
  }, [session]);

  if (loadingSession) {
    return (
      <>
        <title>Research Runs | MatchBASE</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main className="main center-panel" id="main-content" aria-busy="true">
          <p role="status">Initializing MatchBASE workspace session…</p>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <title>Research Runs | MatchBASE</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main
          className="main center-panel"
          id="main-content"
          style={{ maxWidth: "680px", margin: "0 auto", padding: "3rem 1rem" }}
        >
          <header style={{ marginBottom: "2rem" }}>
            <p
              className="eyebrow"
              style={{
                textTransform: "uppercase",
                fontWeight: 700,
                color: "var(--text-on-dark-muted, #94a3b8)",
              }}
            >
              MatchBASE Access Boundary
            </p>
            <h1
              style={{
                fontSize: "1.8rem",
                color: "var(--text-on-dark-primary, #f8fafc)",
              }}
            >
              Authentication Required
            </h1>
            <p
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                lineHeight: 1.5,
              }}
            >
              The Research Runs Directory requires an active governed session.
            </p>
          </header>

          <section
            className="surface-light-card"
            style={{
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              padding: "2rem",
              maxWidth: "540px",
              color: "#0f172a",
            }}
          >
            <h2
              style={{
                fontSize: "1.2rem",
                marginTop: 0,
                color: "#0f172a",
                fontWeight: 700,
              }}
            >
              Consultant Sign-In
            </h2>
            <p
              style={{ color: "#334155", fontSize: "0.95rem", lineHeight: 1.5 }}
            >
              Use the local synthetic OIDC simulator to access the Consultant
              tier with full research output privileges.
            </p>
            <div
              style={{
                marginTop: "1.5rem",
                display: "flex",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <a
                href="/auth/simulator/start?fixture=consultant"
                className="primary-action"
                style={{
                  display: "inline-block",
                  background: "#1d4ed8",
                  color: "#ffffff",
                  padding: "10px 20px",
                  borderRadius: "6px",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Sign In as Consultant
              </a>
              <a
                href="/auth/simulator/start?fixture=standard"
                className="secondary-action"
                style={{
                  display: "inline-block",
                  padding: "10px 20px",
                  borderRadius: "6px",
                  textDecoration: "none",
                }}
              >
                Sign In as Standard
              </a>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <title>Research Runs | MatchBASE</title>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        className="main"
        id="main-content"
        tabIndex={-1}
        style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1rem" }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: "1px solid #334155",
            paddingBottom: "1.5rem",
            marginBottom: "2rem",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <p
              className="eyebrow"
              style={{
                textTransform: "uppercase",
                fontWeight: 700,
                color: "var(--text-on-dark-muted, #94a3b8)",
              }}
            >
              Workspace: {session.tier.toUpperCase()}
            </p>
            <h1
              style={{
                margin: "0.25rem 0",
                fontSize: "1.8rem",
                color: "var(--text-on-dark-primary, #f8fafc)",
                fontWeight: 700,
              }}
            >
              Research Run Directory
            </h1>
            <p
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                margin: 0,
                fontSize: "0.95rem",
              }}
            >
              Signed in as <strong>{session.display_name}</strong> &bull;
              MatchBASE Deep Research Engine
            </p>
          </div>
          <div
            style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
          >
            <Link
              href="/"
              className="secondary-action"
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              &larr; Workspace Home
            </Link>
            <a
              href="/auth/simulator/start?fixture=consultant"
              className="secondary-action"
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Re-authenticate
            </a>
          </div>
        </header>

        {/* 15 Golden UAT Scenarios Section */}
        <section style={{ marginBottom: "3rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <h2
              style={{
                fontSize: "1.35rem",
                fontWeight: 700,
                margin: "0 0 0.25rem",
                color: "var(--text-on-dark-primary, #f8fafc)",
              }}
            >
              Qualified Golden Scenarios (V2 UAT Suite)
            </h2>
            <p
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                fontSize: "0.9rem",
                margin: 0,
              }}
            >
              15 deterministic benchmark scenarios seeded directly in PostgreSQL
              for Consultant V2 qualification.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
              gap: "1rem",
            }}
          >
            {GOLDEN_SCENARIOS.map((scenario, index) => {
              const num = String(index + 1).padStart(2, "0");
              const alias = `run-v2-golden-${num}`;
              const isNoMatch = scenario.research_status === "no_strong_match";

              return (
                <article
                  key={scenario.run_id}
                  className="surface-light-card"
                  style={{
                    background: "#ffffff",
                    color: "#0f172a",
                    border: isNoMatch
                      ? "2px solid #fecaca"
                      : "1px solid #cbd5e1",
                    borderRadius: "8px",
                    padding: "1.25rem",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "#1e40af",
                          background: "#eff6ff",
                          padding: "2px 8px",
                          borderRadius: "4px",
                        }}
                      >
                        SC-{num} &bull; {alias}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: isNoMatch ? "#fee2e2" : "#dcfce7",
                          color: isNoMatch ? "#7f1d1d" : "#14532d",
                        }}
                      >
                        {scenario.research_status.toUpperCase()}
                      </span>
                    </div>

                    <h3
                      style={{
                        margin: "0.25rem 0 0.5rem",
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        color: "#0f172a",
                      }}
                    >
                      {scenario.request_snapshot.product_name}
                    </h3>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#334155",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <strong>Scope:</strong>{" "}
                      {scenario.request_snapshot.geographic_scope ?? "Global"}
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#334155",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <span>
                        Type:{" "}
                        <strong style={{ color: "#0f172a" }}>
                          {scenario.request_snapshot.primary_query_type}
                        </strong>
                      </span>
                      <span style={{ margin: "0 0.5rem", color: "#64748b" }}>
                        &bull;
                      </span>
                      <span>
                        Candidates:{" "}
                        <strong style={{ color: "#0f172a" }}>
                          {scenario.supplier_candidates.length}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      borderTop: "1px solid #e2e8f0",
                      paddingTop: "0.75rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <code
                      style={{
                        fontSize: "0.75rem",
                        color: "#475569",
                        fontWeight: 600,
                      }}
                    >
                      ...{scenario.run_id.slice(-12)}
                    </code>
                    <Link
                      href={`/runs/${scenario.run_id}`}
                      className="primary-action"
                      style={{
                        padding: "6px 14px",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        textDecoration: "none",
                        fontWeight: 600,
                        background: "#1d4ed8",
                        color: "#ffffff",
                      }}
                    >
                      View Result &rarr;
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Dynamic Database Runs Section */}
        <section>
          <div style={{ marginBottom: "1rem" }}>
            <h2
              style={{
                fontSize: "1.35rem",
                fontWeight: 700,
                margin: "0 0 0.25rem",
                color: "var(--text-on-dark-primary, #f8fafc)",
              }}
            >
              All Active Database Runs
            </h2>
            <p
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                fontSize: "0.9rem",
                margin: 0,
              }}
            >
              Live records registered in PostgreSQL for this account.
            </p>
          </div>

          {loadingRuns ? (
            <p
              role="status"
              style={{ color: "var(--text-on-dark-secondary, #cbd5e1)" }}
            >
              Loading database runs…
            </p>
          ) : error ? (
            <p role="alert" style={{ color: "#f87171" }}>
              {error}
            </p>
          ) : runs.length === 0 ? (
            <p style={{ color: "var(--text-on-dark-secondary, #cbd5e1)" }}>
              No active runs found in PostgreSQL.
            </p>
          ) : (
            <div
              className="table-responsive-container"
              style={{ overflowX: "auto" }}
            >
              <table
                className="surface-light-card"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  color: "#0f172a",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f1f5f9",
                      textAlign: "left",
                      borderBottom: "2px solid #cbd5e1",
                      color: "#0f172a",
                    }}
                  >
                    <th
                      style={{
                        padding: "10px 14px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Run ID
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      State
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Outcome
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Updated
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "right",
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.run_id}
                      style={{ borderBottom: "1px solid #e2e8f0" }}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <Link
                          href={`/runs/${r.run_id}`}
                          style={{
                            color: "#1d4ed8",
                            fontWeight: 600,
                            textDecoration: "none",
                          }}
                        >
                          <code>{r.run_id}</code>
                        </Link>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            background:
                              r.state === "complete" ? "#dcfce7" : "#f1f5f9",
                            color:
                              r.state === "complete" ? "#14532d" : "#334155",
                          }}
                        >
                          {r.state.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {r.outcome ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          color: "#475569",
                          fontSize: "0.85rem",
                        }}
                      >
                        {new Date(r.updated_at).toLocaleString()}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <Link
                          href={`/runs/${r.run_id}`}
                          style={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            color: "#1d4ed8",
                            textDecoration: "none",
                          }}
                        >
                          Inspect &rarr;
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
