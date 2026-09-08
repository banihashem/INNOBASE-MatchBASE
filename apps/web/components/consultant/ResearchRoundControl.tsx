"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  ConsultantResearchOutputV3,
  ResearchCostSummary,
  ResearchDepth,
  ResearchModelRate,
  ResearchRoundPlan,
  ResearchRoundView,
} from "@matchbase/contracts";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
const endpoint = "/api/v1/consultant/research-rounds";
type Overview = {
  costs: ResearchCostSummary;
  rounds: ResearchRoundView[];
  next_round: number;
};
type Quote = {
  quote_id: string;
  plan: ResearchRoundPlan;
  choices: ResearchModelRate[];
};
export function ResearchRoundControl({
  runId,
  workflowState,
  onStarted,
  onPreview,
}: {
  runId: string;
  workflowState: string;
  onStarted: () => void;
  onPreview: (output: ConsultantResearchOutputV3, roundId: string) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [choices, setChoices] = useState<ResearchModelRate[]>([]);
  const [depth, setDepth] = useState<ResearchDepth>("simple");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(
      `${endpoint}?run_id=${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "Cost records are unavailable.");
    if (
      !Array.isArray(data.rounds) ||
      !data.costs ||
      typeof data.next_round !== "number"
    )
      throw new Error(
        "Cost records are unavailable. Research has not started.",
      );
    setOverview(data);
  }, [runId]);
  useEffect(() => {
    let disposed = false;
    const read = () => {
      if (!disposed)
        void refresh().catch((e) => {
          if (!disposed) setError(e.message);
        });
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [refresh, workflowState]);
  async function request(action: "quote" | "approve") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf =
        document.cookie
          .split(";")
          .map((v) => v.trim())
          .find(
            (v) =>
              v.startsWith("__Host-matchbase_csrf=") ||
              v.startsWith("matchbase_csrf="),
          )
          ?.split("=")
          .slice(1)
          .join("=") ?? "";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf),
          "Idempotency-Key": `research-${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(2))).join("-")}`,
        },
        body: JSON.stringify({
          action,
          run_id: runId,
          depth,
          model,
          quote_id: quote?.quote_id,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "This round could not start.");
      if (action === "quote") {
        setQuote(data);
        setChoices(data.choices);
      } else {
        setQuote(null);
        setNotice(
          "Your approved round is queued. No following round will start automatically.",
        );
        onStarted();
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function preview(roundId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${endpoint}?run_id=${encodeURIComponent(runId)}&round_id=${encodeURIComponent(roundId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Saved result unavailable.");
      onPreview(data.output, roundId);
      setNotice(
        "Showing the selected saved round below. Later work does not replace this saved result.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saved result unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const active =
    overview?.rounds.some((r) => r.status === "approved") ||
    [
      "research_dispatching",
      "lane_gemini_running",
      "lane_openai_running",
      "lanes_converged",
      "verification_loop_running",
      "synthesis_running",
    ].includes(workflowState);
  const next = overview?.next_round ?? 1;
  const completed =
    overview?.rounds.filter((r) => r.status === "completed") ?? [];
  const currentRound = completed.length
    ? Math.max(...completed.map((r) => r.round_number))
    : 0;
  const expired = quote
    ? new Date(quote.plan.expires_at).getTime() <= Date.now()
    : false;
  const costs = overview?.costs;
  const button =
    "rounded-md border border-sky-400 bg-sky-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
  return (
    <section
      aria-labelledby="round-cost-heading"
      className="rounded-xl border border-slate-600 bg-slate-900 p-5 space-y-5"
    >
      <div>
        <h2 id="round-cost-heading" className="text-xl font-bold text-white">
          Research rounds &amp; cost
        </h2>
        <p className="text-sm text-slate-300 mt-2">
          Each approval starts one round. Review its saved results before
          deciding whether to spend more.
        </p>
      </div>
      {costs ? (
        <div className="rounded-lg bg-slate-800 p-4 space-y-3">
          <p className="text-slate-200">
            {costs.complete
              ? "Recorded spend to date"
              : "Known spend to date · accounting incomplete"}
            <strong className="block text-3xl text-white mt-1">
              {money(costs.recorded_total_usd)}
            </strong>
          </p>
          <dl className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-slate-400">Section 1 · request entry</dt>
              <dd>$0.00 · no model call</dd>
            </div>
            <div>
              <dt className="text-slate-400">Section 2 · preparation</dt>
              <dd>{money(costs.preparation_usd)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">
                Section 3 · all research attempts
              </dt>
              <dd>{money(costs.research_usd)}</dd>
            </div>
          </dl>
          {costs.unpriced_calls > 0 && (
            <p className="text-amber-200">
              {costs.unpriced_calls} call(s) have missing cost records. They are
              not counted as free.
            </p>
          )}
          <details className="text-xs text-slate-300">
            <summary className="cursor-pointer">
              Cost accounting details
            </summary>
            <p className="mt-2">
              OpenRouter charges: {money(costs.openrouter_charge_usd)} · BYOK
              upstream provider: {money(costs.byok_upstream_usd)}. Failed and
              cancelled attempts are included when usage is reported.
            </p>
            <p className="mt-2">{costs.disclosure}</p>
          </details>
        </div>
      ) : (
        <p role="status">Loading recorded costs…</p>
      )}
      {overview && overview.rounds.some((r) => r.status !== "proposed") && (
        <div>
          <h3 className="font-semibold">Saved rounds and attempts</h3>
          <ul className="divide-y divide-slate-700">
            {overview.rounds
              .filter((r) => r.status !== "proposed")
              .map((r) => (
                <li
                  key={r.round_id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span>
                    Round {r.round_number} · {r.status}{" "}
                    {r.candidate_count !== null
                      ? `· ${r.candidate_count} suppliers`
                      : ""}
                    <small className="block text-slate-400">
                      {r.plan.mode === "demonstration"
                        ? "$0.00 · demonstration"
                        : r.execution_id && costs?.by_execution[r.execution_id]
                          ? `${money(costs.by_execution[r.execution_id]!.recorded_usd)} recorded${costs.by_execution[r.execution_id]!.unpriced_calls ? " · incomplete" : ""}`
                          : "Cost records pending"}
                    </small>
                  </span>
                  {r.output_available && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() => void preview(r.round_id)}
                    >
                      View round {r.round_number} result
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
      {active ? (
        <p role="status" className="text-sky-200">
          An approved round is in progress. Its result will be saved here; any
          previous result remains available.
        </p>
      ) : overview && next <= 5 ? (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">
            {next === 1
              ? "Review the first-round estimate"
              : next <= 3
                ? `Optional round ${next}`
                : `Optional public social research · round ${next}`}
          </h3>
          <p className="text-sm text-slate-300">
            {currentRound >= 3
              ? "The normal research path is complete. Further work is optional and requires a new estimate and your approval."
              : currentRound > 0
                ? "Your result is ready. Continue only if unresolved evidence could change your decision. Existing findings will be reused."
                : "The approved plan is saved. No new research round has started."}
          </p>
          {next >= 2 && (
            <div className="flex flex-wrap gap-4">
              <label className="text-sm">
                Research depth
                <select
                  aria-label="Research depth"
                  className="block rounded bg-slate-800 border border-slate-500 p-2 mt-1"
                  value={depth}
                  onChange={(e) => {
                    setDepth(e.target.value as ResearchDepth);
                    setQuote(null);
                  }}
                >
                  <option value="simple">Simple · lower cost</option>
                  <option value="deep">Thoughtful · deeper analysis</option>
                </select>
              </label>
              <label className="text-sm">
                Model selection
                <select
                  aria-label="Research model"
                  className="block rounded bg-slate-800 border border-slate-500 p-2 mt-1 max-w-full"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setQuote(null);
                  }}
                >
                  <option value="">System recommendation</option>
                  {choices.map((m) => (
                    <option value={m.model} key={m.model}>
                      {m.model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void request("quote")}
          >
            {busy
              ? "Working…"
              : quote
                ? "Refresh estimate"
                : "Get cost estimate · no research starts"}
          </button>
          {quote && (
            <div className="border border-sky-700 rounded-lg p-4 space-y-3">
              <h4 className="font-bold">
                Round {quote.plan.round_number} · {quote.plan.title}
              </h4>
              <p>{quote.plan.purpose}</p>
              <p className="text-xl font-bold text-sky-200">
                Estimated additional cost: {money(quote.plan.estimated_low_usd)}
                –{money(quote.plan.estimated_high_usd)}
              </p>
              <p className="text-xs text-slate-300">
                An estimate, not a guaranteed spending cap. Valid until{" "}
                {new Date(quote.plan.expires_at).toLocaleTimeString()}.
              </p>
              {quote.plan.mode === "demonstration" ? (
                <p className="text-sm text-amber-200">
                  Demonstration: fixed sample data; no provider calls.
                </p>
              ) : (
                <p className="text-sm">
                  Search: {quote.plan.research_models.join(" + ")} ·{" "}
                  {quote.plan.search_engine} web
                  <br />
                  Analysis: {quote.plan.synthesis_model}
                  <br />
                  Extraction: {quote.plan.extraction_model}
                </p>
              )}
              {quote.plan.focus_requirements.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm">
                    Research focus and unresolved evidence
                  </summary>
                  <ul className="list-disc pl-5 text-sm mt-2">
                    {quote.plan.focus_requirements.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details>
                <summary className="cursor-pointer text-sm">
                  Estimate assumptions and call limits
                </summary>
                <p className="text-sm mt-2">
                  Up to {quote.plan.max_calls} model calls; up to{" "}
                  {quote.plan.max_output_tokens_per_call.toLocaleString()}{" "}
                  output tokens per call. Primary web retrieval can add elapsed
                  time.
                </p>
                <ul className="list-disc pl-5 text-xs mt-2">
                  {quote.plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
              <button
                type="button"
                className={button}
                disabled={busy || expired}
                onClick={() => void request("approve")}
              >
                {expired
                  ? "Estimate expired · refresh first"
                  : `Approve cost estimate & start round ${quote.plan.round_number}`}
              </button>
            </div>
          )}
        </div>
      ) : (
        overview && (
          <p className="text-emerald-300">
            All five optional rounds are complete. No more work is scheduled.
          </p>
        )
      )}
      {notice && (
        <p role="status" className="text-sky-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
