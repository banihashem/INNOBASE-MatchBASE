"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  parseConsultantResearchOutputV2,
  parseConsultantResearchOutputV3,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseStandardResultProjectionV1,
  parseDemoProjectionV1,
} from "@matchbase/contracts";
import {
  ConsultantResultView,
  type ConsultantVisibleResult,
} from "../../../components/consultant/ConsultantResult";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const GOLDEN_ALIAS_MAP: Record<string, string> = {
  "run-v3-golden-01": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-02": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-03": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-04": "00000000-0000-4000-8000-000000000404",
  "run-v3-golden-1": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-2": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-3": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-4": "00000000-0000-4000-8000-000000000404",
  "run-v2-golden-01": "00000000-0000-4000-8000-000000000301",
  "run-v2-golden-02": "00000000-0000-4000-8000-000000000302",
  "run-v2-golden-03": "00000000-0000-4000-8000-000000000303",
  "run-v2-golden-04": "00000000-0000-4000-8000-000000000304",
  "run-v2-golden-05": "00000000-0000-4000-8000-000000000305",
  "run-v2-golden-06": "00000000-0000-4000-8000-000000000306",
  "run-v2-golden-07": "00000000-0000-4000-8000-000000000307",
  "run-v2-golden-08": "00000000-0000-4000-8000-000000000308",
  "run-v2-golden-09": "00000000-0000-4000-8000-000000000309",
  "run-v2-golden-10": "00000000-0000-4000-8000-000000000310",
  "run-v2-golden-11": "00000000-0000-4000-8000-000000000311",
  "run-v2-golden-12": "00000000-0000-4000-8000-000000000312",
  "run-v2-golden-13": "00000000-0000-4000-8000-000000000313",
  "run-v2-golden-14": "00000000-0000-4000-8000-000000000314",
  "run-v2-golden-15": "00000000-0000-4000-8000-000000000315",
  "run-v2-golden-1": "00000000-0000-4000-8000-000000000301",
  "run-v2-golden-2": "00000000-0000-4000-8000-000000000302",
  "run-v2-golden-3": "00000000-0000-4000-8000-000000000303",
  "run-v2-golden-4": "00000000-0000-4000-8000-000000000304",
  "run-v2-golden-5": "00000000-0000-4000-8000-000000000305",
  "run-v2-golden-6": "00000000-0000-4000-8000-000000000306",
  "run-v2-golden-7": "00000000-0000-4000-8000-000000000307",
  "run-v2-golden-8": "00000000-0000-4000-8000-000000000308",
  "run-v2-golden-9": "00000000-0000-4000-8000-000000000309",
};

type ViewStatus =
  | { state: "loading" }
  | { state: "unauthenticated" }
  | { state: "forbidden"; message: string }
  | { state: "not_found"; message: string }
  | { state: "error"; message: string }
  | { state: "success"; result: ConsultantVisibleResult };

function formatQueryType(raw: string): string {
  return raw
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function RunResultPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const resolvedRunId = GOLDEN_ALIAS_MAP[runId] ?? runId;
  const [viewStatus, setViewStatus] = useState<ViewStatus>({
    state: "loading",
  });

  const pageTitle = (() => {
    switch (viewStatus.state) {
      case "loading":
        return "Loading Research Run | MatchBASE";
      case "unauthenticated":
        return "Sign In Required | MatchBASE";
      case "forbidden":
        return "Access Denied | MatchBASE";
      case "not_found":
        return "Result Not Found | MatchBASE";
      case "error":
        return "Error | MatchBASE";
      case "success":
        if (
          "request_snapshot" in viewStatus.result &&
          viewStatus.result.request_snapshot
        ) {
          const product = viewStatus.result.request_snapshot.product_name;
          const queryType = formatQueryType(
            viewStatus.result.request_snapshot.primary_query_type,
          );
          if (viewStatus.result.research_status === "no_strong_match") {
            return `No Strong Match — ${product} | MatchBASE`;
          }
          return `${product} — ${queryType} | MatchBASE`;
        }
        return "Research Run Result | MatchBASE";
    }
  })();

  useEffect(() => {
    document.title = pageTitle;
    const timer = setTimeout(() => {
      document.title = pageTitle;
    }, 100);
    return () => clearTimeout(timer);
  }, [pageTitle]);

  useEffect(() => {
    let active = true;

    async function fetchResult() {
      try {
        // Fast-fail invalid friendly aliases (e.g. run-v2-golden-99 or run-v3-golden-99) as Not Found (404)
        if (
          (runId.startsWith("run-v2-golden-") ||
            runId.startsWith("run-v3-golden-")) &&
          !(runId in GOLDEN_ALIAS_MAP)
        ) {
          if (!active) return;
          document.title = "Result Not Found | MatchBASE";
          setViewStatus({
            state: "not_found",
            message: `Research run "${runId}" could not be found in active database state.`,
          });
          return;
        }

        // Fast-fail non-UUID, non-alias strings as Not Found (404)
        if (!UUID_PATTERN.test(resolvedRunId)) {
          if (!active) return;
          document.title = "Result Not Found | MatchBASE";
          setViewStatus({
            state: "not_found",
            message: `Research run "${runId}" could not be found in active database state.`,
          });
          return;
        }

        // Check user session
        let userTier = "anonymous";
        try {
          const meRes = await fetch("/api/v1/me", { cache: "no-store" });
          if (meRes.ok) {
            const meData = (await meRes.json()) as { tier?: string };
            userTier = meData.tier ?? "anonymous";
          }
        } catch {
          // Keep anonymous
        }

        if (!active) return;

        if (userTier === "anonymous") {
          document.title = "Sign In Required | MatchBASE";
          setViewStatus({ state: "unauthenticated" });
          return;
        }

        // Fetch result
        const response = await fetch(
          `/api/v1/runs/${encodeURIComponent(resolvedRunId)}/result`,
          { cache: "no-store" },
        );

        if (!active) return;

        if (response.status === 401) {
          document.title = "Sign In Required | MatchBASE";
          setViewStatus({ state: "unauthenticated" });
          return;
        }

        if (response.status === 403) {
          // If the user has Consultant/Admin tier, a 403 from the backend is the neutral resource-not-visible
          // response (nonexistent run or wrong tenant partition). Map it to 404 Result Not Found!
          if (userTier === "consultant" || userTier === "admin") {
            document.title = "Result Not Found | MatchBASE";
            setViewStatus({
              state: "not_found",
              message: `Research run "${runId}" could not be found in active database state.`,
            });
            return;
          }

          // Otherwise, the user genuinely lacks Consultant capability
          document.title = "Access Denied | MatchBASE";
          setViewStatus({
            state: "forbidden",
            message:
              "You do not have authorization to view Consultant-tier research runs. Please sign in with an authorized account.",
          });
          return;
        }

        if (response.status === 404) {
          document.title = "Result Not Found | MatchBASE";
          setViewStatus({
            state: "not_found",
            message: `Research run "${runId}" could not be found in active database state.`,
          });
          return;
        }

        if (!response.ok) {
          document.title = "Error | MatchBASE";
          setViewStatus({
            state: "error",
            message: `Failed to load result (HTTP ${response.status}).`,
          });
          return;
        }

        const body = (await response.json()) as Record<string, unknown>;
        if (!body || typeof body !== "object" || !("schema_version" in body)) {
          document.title = "Error | MatchBASE";
          setViewStatus({
            state: "error",
            message: "Malformed result projection body.",
          });
          return;
        }

        const parsed: ConsultantVisibleResult = (() => {
          switch (body.schema_version) {
            case "consultant-research-output.v3":
              return parseConsultantResearchOutputV3(body);
            case "consultant-research-output.v2":
              return parseConsultantResearchOutputV2(body);
            case "consultant-result-projection.v1":
              return parseConsultantResultProjectionV1(body);
            case "consultant-result-projection.v2":
              return parseConsultantResultProjectionV2(body);
            case "standard-result-projection.v1":
              return parseStandardResultProjectionV1(body);
            case "demo-projection.v1":
              return parseDemoProjectionV1(body);
            default:
              throw new Error(
                `Unsupported schema version: ${String(body.schema_version)}`,
              );
          }
        })();

        // Set contextual dynamic page title
        if ("request_snapshot" in parsed && parsed.request_snapshot) {
          const product = parsed.request_snapshot.product_name;
          const queryType = formatQueryType(
            parsed.request_snapshot.primary_query_type,
          );
          if (parsed.research_status === "no_strong_match") {
            document.title = `No Strong Match — ${product} | MatchBASE`;
          } else {
            document.title = `${product} — ${queryType} | MatchBASE`;
          }
        } else {
          document.title = `Research Run Result | MatchBASE`;
        }

        setViewStatus({ state: "success", result: parsed });
      } catch (err: unknown) {
        if (!active) return;
        document.title = "Error | MatchBASE";
        setViewStatus({
          state: "error",
          message:
            err instanceof Error ? err.message : "Unexpected result error.",
        });
      }
    }

    void fetchResult();

    return () => {
      active = false;
    };
  }, [resolvedRunId, runId]);

  if (viewStatus.state === "loading") {
    return (
      <>
        <title>{pageTitle}</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main
          className="main center-panel"
          id="main-content"
          tabIndex={-1}
          aria-busy="true"
        >
          <p
            role="status"
            style={{ color: "var(--text-on-dark-secondary, #cbd5e1)" }}
          >
            Loading research run result ({runId})…
          </p>
        </main>
      </>
    );
  }

  if (viewStatus.state === "unauthenticated") {
    return (
      <>
        <title>{pageTitle}</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main
          className="main center-panel"
          id="main-content"
          tabIndex={-1}
          style={{ maxWidth: "680px", margin: "0 auto", padding: "3rem 1rem" }}
        >
          <header style={{ marginBottom: "2rem" }}>
            <p
              className="eyebrow"
              style={{
                color: "var(--text-on-dark-muted, #94a3b8)",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Sign-In Required
            </p>
            <h1
              style={{
                color: "var(--text-on-dark-primary, #f8fafc)",
                fontSize: "1.8rem",
                fontWeight: 700,
              }}
            >
              Access Restricted
            </h1>
            <p
              className="lede"
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                lineHeight: 1.5,
              }}
            >
              You must be signed in to view research runs.
            </p>
          </header>

          <section
            className="surface-light-card"
            style={{
              padding: "1.5rem",
              borderRadius: "8px",
              marginBottom: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                marginTop: 0,
                marginBottom: "0.75rem",
              }}
            >
              Session Sign-In Options
            </h2>
            <div
              style={{
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

          <div style={{ marginTop: "1.5rem" }}>
            <Link
              href="/runs"
              className="secondary-action"
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Back to Runs
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (viewStatus.state === "forbidden") {
    return (
      <>
        <title>{pageTitle}</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main
          className="main center-panel"
          id="main-content"
          tabIndex={-1}
          style={{ maxWidth: "680px", margin: "0 auto", padding: "3rem 1rem" }}
        >
          <header style={{ marginBottom: "2rem" }}>
            <p
              className="eyebrow"
              style={{
                color: "#f87171",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              HTTP 403 Forbidden
            </p>
            <h1
              style={{
                color: "var(--text-on-dark-primary, #f8fafc)",
                fontSize: "1.8rem",
                fontWeight: 700,
              }}
            >
              Access Denied
            </h1>
            <p
              className="lede"
              role="alert"
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                lineHeight: 1.5,
              }}
            >
              {viewStatus.message}
            </p>
          </header>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Link
              href="/runs"
              className="primary-action"
              style={{
                background: "#1d4ed8",
                color: "#ffffff",
                padding: "10px 20px",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              &larr; Return to Run Directory
            </Link>
            <a
              href="/auth/simulator/start?fixture=consultant"
              className="secondary-action"
              style={{
                padding: "10px 20px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Switch to Consultant Session
            </a>
          </div>
        </main>
      </>
    );
  }

  if (viewStatus.state === "not_found") {
    return (
      <>
        <title>{pageTitle}</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main
          className="main center-panel"
          id="main-content"
          tabIndex={-1}
          style={{ maxWidth: "680px", margin: "0 auto", padding: "3rem 1rem" }}
        >
          <header style={{ marginBottom: "2rem" }}>
            <p
              className="eyebrow"
              style={{
                color: "#fbbf24",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              HTTP 404 Not Found
            </p>
            <h1
              style={{
                color: "var(--text-on-dark-primary, #f8fafc)",
                fontSize: "1.8rem",
                fontWeight: 700,
              }}
            >
              Result Not Found
            </h1>
            <p
              className="lede"
              role="alert"
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                lineHeight: 1.5,
              }}
            >
              {viewStatus.message}
            </p>
          </header>
          <Link
            href="/runs"
            className="secondary-action"
            style={{
              padding: "10px 20px",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            &larr; Return to Run Directory
          </Link>
        </main>
      </>
    );
  }

  if (viewStatus.state === "error") {
    return (
      <>
        <title>{pageTitle}</title>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <main
          className="main center-panel"
          id="main-content"
          tabIndex={-1}
          style={{ maxWidth: "680px", margin: "0 auto", padding: "3rem 1rem" }}
        >
          <header style={{ marginBottom: "2rem" }}>
            <p
              className="eyebrow"
              style={{
                color: "#f87171",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              System Notice
            </p>
            <h1
              style={{
                color: "var(--text-on-dark-primary, #f8fafc)",
                fontSize: "1.8rem",
                fontWeight: 700,
              }}
            >
              Failed to Load Result
            </h1>
            <p
              className="lede"
              role="alert"
              style={{
                color: "var(--text-on-dark-secondary, #cbd5e1)",
                lineHeight: 1.5,
              }}
            >
              {viewStatus.message}
            </p>
          </header>
          <Link
            href="/runs"
            className="secondary-action"
            style={{
              padding: "10px 20px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            &larr; Return to Run Directory
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <title>{pageTitle}</title>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div id="main-content" tabIndex={-1}>
        <ConsultantResultView
          result={viewStatus.result}
          onBack={() => {
            window.location.href = "/runs";
          }}
        />
      </div>
    </>
  );
}
