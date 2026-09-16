"use client";
import { useEffect, useRef, useState } from "react";

// MB-ARCH-IMPLEMENT-001 L02: history inspection never starts paid research.
const endpoint = "/api/v1/consultant/research-history";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
type HistoryView = {
  history: {
    generation: number;
    runs: {
      run_id: string;
      renewal_ordinal: number;
      created_at: string;
      state: string;
    }[];
    costs: {
      recorded_total_usd: number;
      unpriced_calls: number;
      complete: boolean;
    };
    can_renew: boolean;
    renewal_block_reason?: string;
  };
  memory: {
    eligible_count: number;
    needs_refresh_count: number;
    observations: {
      observation_id: string;
      claim_text: string;
      source_url: string;
      published_at: string | null;
      retrieved_at: string;
      eligibility: string;
    }[];
    fresh_discovery_required: true;
  };
};
function requestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function dateLabel(value: string | null) {
  if (!value) return "Date not established";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date)
    : "Date not established";
}
function publicSource(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function ResearchHistoryPanel({
  runId,
  active = false,
  onRenewed,
}: {
  runId: string;
  active?: boolean;
  onRenewed?: (runId: string) => void;
}) {
  const [view, setView] = useState<HistoryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const key = useRef<string | null>(null);
  const requestPending = useRef(false);
  const renewalPending = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  async function inspect() {
    if (requestPending.current) return;
    requestPending.current = true;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${endpoint}?run_id=${encodeURIComponent(runId)}`,
        { signal: current.signal, cache: "no-store" },
      );
      const data = await response.json();
      if (
        !response.ok ||
        !Number.isInteger(data.history?.generation) ||
        !Array.isArray(data.history?.runs) ||
        !data.history?.costs ||
        !Array.isArray(data.memory?.observations)
      )
        throw new Error("unavailable");
      if (!current.signal.aborted) setView(data);
    } catch {
      if (!current.signal.aborted)
        setError(
          "Research history could not be loaded. Your saved results remain available.",
        );
    } finally {
      requestPending.current = false;
      if (!current.signal.aborted) setLoading(false);
    }
  }
  async function renew() {
    if (!view?.history.can_renew || active || renewalPending.current) return;
    renewalPending.current = true;
    setRenewing(true);
    setError("");
    try {
      key.current ??= requestKey();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renew",
          run_id: runId,
          expected_generation: view.history.generation,
          idempotency_key: key.current,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true || !uuid.test(data.run_id))
        throw new Error("unavailable");
      if (onRenewed) onRenewed(data.run_id);
      else
        window.location.assign(
          `/consultant/workflow?run_id=${encodeURIComponent(data.run_id)}`,
        );
    } catch {
      setError(
        "The renewal could not be opened. No research has started. Refresh history before trying again.",
      );
    } finally {
      renewalPending.current = false;
      setRenewing(false);
    }
  }
  return (
    <details
      className="rounded-xl border border-slate-600 bg-slate-900 p-4 text-slate-200"
      onToggle={(event) => {
        if (event.currentTarget.open && !view) void inspect();
      }}
    >
      <summary className="cursor-pointer font-semibold text-sky-200">
        Research history &amp; saved evidence
      </summary>
      <div className="mt-4 space-y-5">
        {loading && (
          <p role="status">Checking your saved research and evidence dates…</p>
        )}
        {view && (
          <>
            <section aria-label="Your saved evidence" className="space-y-2">
              <h3 className="font-semibold text-white">
                Evidence available for this request
              </h3>
              <p>
                {view.memory.eligible_count} saved observation(s) are eligible
                for consideration. {view.memory.needs_refresh_count} require a
                fresh check.
              </p>
              <p className="text-sm text-slate-300">
                Only your own research is used here. Source dates and relevance
                are checked again. New research still searches for additional
                suppliers; remembered findings do not establish their fit.
                Reusable memory grows as new research completes.
              </p>
              {view.memory.observations.length > 0 && (
                <ul className="space-y-3">
                  {view.memory.observations.map((item) => (
                    <li
                      key={item.observation_id}
                      className="rounded-md border border-slate-700 p-3"
                    >
                      <p className="break-words">{item.claim_text}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        Source date: {dateLabel(item.published_at)} · Retrieved:{" "}
                        {dateLabel(item.retrieved_at)}
                      </p>
                      {publicSource(item.source_url) && (
                        <a
                          href={publicSource(item.source_url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-sky-300 underline"
                        >
                          View source
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Linked research history" className="space-y-2">
              <h3 className="font-semibold text-white">
                This request over time
              </h3>
              <p>
                {view.history.costs.complete
                  ? "Recorded total across this history"
                  : "Known total across this history · accounting incomplete"}
                :{" "}
                <strong>
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 4,
                  }).format(view.history.costs.recorded_total_usd)}
                </strong>
              </p>
              {view.history.costs.unpriced_calls > 0 && (
                <p className="text-sm text-amber-200">
                  {view.history.costs.unpriced_calls} call(s) still have
                  incomplete cost records.
                </p>
              )}
              <ol className="space-y-2">
                {view.history.runs
                  .filter((run) => uuid.test(run.run_id))
                  .map((run) => (
                    <li key={run.run_id}>
                      <a
                        href={`/consultant/workflow?run_id=${encodeURIComponent(run.run_id)}`}
                        className="text-sky-300 underline"
                        aria-current={run.run_id === runId ? "page" : undefined}
                      >
                        {run.renewal_ordinal === 0
                          ? "Original research"
                          : `Renewal ${run.renewal_ordinal}`}{" "}
                        · {dateLabel(run.created_at)}
                      </a>
                      {run.run_id === runId && (
                        <span className="ml-2 text-sm">Current view</span>
                      )}
                    </li>
                  ))}
              </ol>
              <p className="text-sm text-slate-300">
                Refresh this request when current evidence is needed. The
                original reports remain in this history. You review a new cost
                estimate before research starts.
              </p>
              <button
                type="button"
                className="rounded-md border border-sky-400 bg-sky-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
                disabled={!view.history.can_renew || active || renewing}
                onClick={() => void renew()}
              >
                {renewing ? "Opening renewal…" : "Refresh this research"}
              </button>
              {!view.history.can_renew && (
                <p className="text-sm text-slate-300">
                  {view.history.renewal_block_reason ||
                    "Renewal is not available for this request yet."}
                </p>
              )}
            </section>
          </>
        )}
        {error && (
          <p role="alert" className="text-amber-200">
            {error}
          </p>
        )}
        <button
          type="button"
          className="text-sm text-sky-300 underline disabled:opacity-50"
          disabled={loading || renewing}
          onClick={() => void inspect()}
        >
          Refresh history
        </button>
      </div>
    </details>
  );
}
