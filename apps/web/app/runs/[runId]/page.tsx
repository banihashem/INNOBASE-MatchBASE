"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  parseConsultantResearchOutputV2,
  parseConsultantResultProjectionV1,
  parseConsultantResultProjectionV2,
  parseStandardResultProjectionV1,
  parseDemoProjectionV1,
} from "@matchbase/contracts";
import {
  ConsultantResultView,
  type ConsultantVisibleResult,
} from "../../../components/consultant/ConsultantResult";

const GOLDEN_ALIAS_MAP: Record<string, string> = {
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

  useEffect(() => {
    let active = true;

    async function fetchResult() {
      try {
        const response = await fetch(
          `/api/v1/runs/${encodeURIComponent(resolvedRunId)}/result`,
          { cache: "no-store" },
        );

        if (!active) return;

        if (response.status === 401) {
          setViewStatus({ state: "unauthenticated" });
          return;
        }

        if (response.status === 403) {
          setViewStatus({
            state: "forbidden",
            message:
              "You do not have authorization to view this research run or tenant partition.",
          });
          return;
        }

        if (response.status === 404) {
          setViewStatus({
            state: "not_found",
            message: `Research run "${runId}" could not be found in active database state.`,
          });
          return;
        }

        if (!response.ok) {
          setViewStatus({
            state: "error",
            message: `Failed to load result (HTTP ${response.status}).`,
          });
          return;
        }

        const body = (await response.json()) as Record<string, unknown>;
        if (!body || typeof body !== "object" || !("schema_version" in body)) {
          setViewStatus({
            state: "error",
            message: "Malformed result projection body.",
          });
          return;
        }

        const parsed: ConsultantVisibleResult = (() => {
          switch (body.schema_version) {
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

        setViewStatus({ state: "success", result: parsed });
      } catch (err: unknown) {
        if (!active) return;
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
      <main className="main center-panel" id="main-content" aria-busy="true">
        <p role="status">Loading research run result ({runId})…</p>
      </main>
    );
  }

  if (viewStatus.state === "unauthenticated") {
    return (
      <main className="main center-panel" id="main-content">
        <header style={{ marginBottom: "2rem" }}>
          <p className="eyebrow">Sign-in required</p>
          <h1>Access Restricted</h1>
          <p className="lede">
            You must be signed in with Consultant entitlements to inspect run{" "}
            {runId}.
          </p>
        </header>
        <div style={{ display: "flex", gap: "1rem" }}>
          <a
            href="/auth/simulator/start?fixture=consultant"
            className="primary-action"
            style={{
              background: "#2563eb",
              color: "#ffffff",
              padding: "10px 20px",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Sign In as Consultant
          </a>
          <Link
            href="/runs"
            className="secondary-action"
            style={{
              padding: "10px 20px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Back to Runs
          </Link>
        </div>
      </main>
    );
  }

  if (viewStatus.state === "forbidden") {
    return (
      <main className="main center-panel" id="main-content">
        <header style={{ marginBottom: "2rem" }}>
          <p className="eyebrow" style={{ color: "#b91c1c" }}>
            HTTP 403 Forbidden
          </p>
          <h1>Authorization Denied</h1>
          <p className="lede" role="alert">
            {viewStatus.message}
          </p>
        </header>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Link
            href="/runs"
            className="primary-action"
            style={{
              background: "#2563eb",
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
    );
  }

  if (viewStatus.state === "not_found") {
    return (
      <main className="main center-panel" id="main-content">
        <header style={{ marginBottom: "2rem" }}>
          <p className="eyebrow" style={{ color: "#d97706" }}>
            HTTP 404 Not Found
          </p>
          <h1>Run Not Found</h1>
          <p className="lede" role="alert">
            {viewStatus.message}
          </p>
        </header>
        <Link
          href="/runs"
          className="primary-action"
          style={{
            background: "#2563eb",
            color: "#ffffff",
            padding: "10px 20px",
            borderRadius: "6px",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          &larr; Return to Run Directory
        </Link>
      </main>
    );
  }

  if (viewStatus.state === "error") {
    return (
      <main className="main center-panel" id="main-content">
        <header style={{ marginBottom: "2rem" }}>
          <p className="eyebrow" style={{ color: "#dc2626" }}>
            Error
          </p>
          <h1>Failed to Load Result</h1>
          <p className="lede" role="alert">
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
    );
  }

  return (
    <ConsultantResultView
      result={viewStatus.result}
      onBack={() => {
        window.location.href = "/runs";
      }}
    />
  );
}
