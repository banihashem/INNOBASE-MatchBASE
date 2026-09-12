"use client";
import { useCallback, useEffect, useState } from "react";
import { ResearchReviewPanel } from "./ResearchReviewPanel";
import type {
  ConsultantResearchOutputV3,
  ResearchCostSummary,
  ResearchDepth,
  ResearchTier,
  ResearchModelRate,
  ResearchRoundPlan,
  ResearchRoundView,
  ResearchReview,
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
  research_review?: ResearchReview | null;
  research_tiers?: Record<
    ResearchTier,
    { configured: boolean; missing_families: string[] }
  >;
};
type Quote = {
  quote_id: string;
  plan: ResearchRoundPlan;
  choices: ResearchModelRate[];
};
export function ResearchRoundControl({
  runId,
  workflowState,
  hasResults = false,
  onStarted,
  onPreview,
}: {
  runId: string;
  workflowState: string;
  hasResults?: boolean;
  onStarted: () => void;
  onPreview: (output: ConsultantResearchOutputV3, roundId: string) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [choices, setChoices] = useState<ResearchModelRate[]>([]);
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [choicesError, setChoicesError] = useState("");
  const [choicesRetry, setChoicesRetry] = useState(0);
  const [depth, setDepth] = useState<ResearchDepth>("simple");
  const [researchTier, setResearchTier] = useState<ResearchTier>("default");
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [historicalReview, setHistoricalReview] = useState<{
    roundId: string;
    review: ResearchReview | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const visibleError = error || loadError;
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setQuestion("");
    setLeadIds([]);
    setQuote(null);
    setHistoricalReview(null);
    setChoices([]);
    setModel("");
  }, [runId]);
  const modelChoicesEnabled =
    Boolean(overview) && overview!.next_round >= 2 && overview!.next_round <= 5;
  useEffect(() => {
    if (!modelChoicesEnabled) return;
    const controller = new AbortController();
    setChoicesLoading(true);
    setChoicesError("");
    void (async () => {
      try {
        const response = await fetch(
          `${endpoint}?run_id=${encodeURIComponent(runId)}&view=model_choices`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.choices))
          throw new Error(
            "Model choices could not be loaded. Retry to check current access and pricing.",
          );
        if (!controller.signal.aborted) setChoices(data.choices);
      } catch {
        if (!controller.signal.aborted)
          setChoicesError(
            "Model choices could not be loaded. Retry to check current access and pricing.",
          );
      } finally {
        if (!controller.signal.aborted) setChoicesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [runId, modelChoicesEnabled, choicesRetry]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `${endpoint}?run_id=${encodeURIComponent(runId)}`,
        { cache: "no-store", ...(signal ? { signal } : {}) },
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
      if (!signal?.aborted) {
        setOverview(data);
        setLoadError("");
      }
    },
    [runId],
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let reading = false;
    const read = async () => {
      clearTimeout(timer);
      if (controller.signal.aborted || reading) return;
      if (!document.hidden) {
        reading = true;
        try {
          await refresh(controller.signal);
        } catch (e) {
          if (!controller.signal.aborted)
            setLoadError(
              e instanceof Error ? e.message : "Cost records unavailable.",
            );
        } finally {
          reading = false;
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(
          () => void read(),
          /running|dispatching|verif|synthesi/.test(workflowState)
            ? 5000
            : 30000,
        );
    };
    const visible = () => {
      if (!document.hidden) void read();
    };
    void read();
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
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
          research_tier: researchTier,
          model,
          quote_id: quote?.quote_id,
          ...(action === "quote" && (overview?.next_round ?? 1) >= 2
            ? { follow_up: { question, lead_ids: leadIds } }
            : {}),
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
        setQuestion("");
        setLeadIds([]);
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
      setHistoricalReview({
        roundId,
        review: data.output.research_review ?? null,
      });
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
  const modelFallbacks = Object.entries(
    quote?.plan.model_fallbacks ?? {},
  ).filter(([, alternatives]) => alternatives.length > 0);
  const costs = overview?.costs;
  const review = historicalReview
    ? historicalReview.review
    : overview?.research_review;
  const selectLead = (id: string, selected: boolean) => {
    setLeadIds((ids) =>
      selected ? [...new Set([...ids, id])] : ids.filter((item) => item !== id),
    );
    setQuote(null);
  };
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
        <p role="status">
          {visibleError
            ? "Recorded costs are currently unavailable."
            : "Loading recorded costs…"}
        </p>
      )}
      {(review || historicalReview || (hasResults && overview)) && (
        <div className="space-y-3">
          {historicalReview && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <p>Showing the research review saved with the selected result.</p>
              <button
                type="button"
                className={button}
                onClick={() => setHistoricalReview(null)}
              >
                Show latest review for follow-up
              </button>
            </div>
          )}
          {review ? (
            <ResearchReviewPanel
              review={review}
              selectedIds={leadIds}
              disabled={busy}
              onSelect={
                !historicalReview && next >= 2 && next <= 5 && !active
                  ? selectLead
                  : undefined
              }
            />
          ) : (
            <p className="text-sm text-slate-300">
              This saved result predates research-lead records. Its documented
              suppliers and PDF remain available; missing lead records do not
              mean no other companies were researched.
            </p>
          )}
        </div>
      )}
      <details open={!hasResults || active} className="research-round-options">
        <summary className="cursor-pointer font-semibold">
          {hasResults
            ? "Review rounds or research further"
            : "Plan this research round"}
        </summary>
        <div className="space-y-5 mt-4">
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
                        Round {r.round_number} ·{" "}
                        {r.plan.recovery_source_execution_id
                          ? "Recovered saved evidence"
                          : r.status}{" "}
                        {r.candidate_count !== null
                          ? `· ${r.candidate_count} suppliers`
                          : ""}
                        <small className="block text-slate-400">
                          {r.plan.recovery_source_execution_id
                            ? "$0.00 · local recovery, no provider calls"
                            : r.plan.mode === "demonstration"
                              ? "$0.00 · demonstration"
                              : r.execution_id &&
                                  costs?.by_execution[r.execution_id]
                                ? `${money(costs.by_execution[r.execution_id]!.recorded_usd)} recorded${costs.by_execution[r.execution_id]!.unpriced_calls ? " · incomplete" : ""}`
                                : "Cost records pending"}
                        </small>
                        {r.plan.follow_up && (
                          <span className="mt-2 block text-slate-300">
                            <span className="font-semibold">
                              Approved follow-up focus:{" "}
                            </span>
                            <span
                              dir="auto"
                              className="whitespace-pre-wrap break-words"
                            >
                              {r.plan.follow_up.question ||
                                "Resolve selected evidence gaps"}
                            </span>
                            <span className="block">
                              {r.plan.follow_up.lead_ids.length} selected
                              lead(s)
                            </span>
                          </span>
                        )}
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
              An approved round is in progress. Its result will be saved here;
              any previous result remains available.
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
                  : overview.rounds.some((round) => round.status !== "proposed")
                    ? overview.rounds.some((round) => round.output_available)
                      ? "Your saved findings are available. Continue only if unresolved evidence could change your decision. Existing findings will be reused."
                      : "The previous attempt did not produce a report. Review the new estimate before starting another attempt."
                    : "The approved plan is saved. No new research round has started."}
              </p>
              {next === 1 && (
                <fieldset disabled={busy} className="space-y-3">
                  <legend className="font-semibold">
                    First-round research coverage
                  </legend>
                  <p className="text-sm text-slate-300">
                    Choose how many independent AI models search the web. Review
                    the selected models and total estimate before approving.
                    More models add perspectives and cost; they do not guarantee
                    more matches.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["default", "Default", "2 models", "Gemini + GPT"],
                        [
                          "advanced",
                          "Advanced",
                          "3 models",
                          "Gemini + GPT + one of Claude, DeepSeek or Grok",
                        ],
                        [
                          "ultra",
                          "Ultra",
                          "5 models",
                          "Gemini + GPT + Claude + DeepSeek + Grok",
                        ],
                      ] as const
                    ).map(([value, title, count, description]) => (
                      <label
                        key={value}
                        className={`block cursor-pointer rounded-lg border p-4 ${researchTier === value ? "border-teal-300 bg-teal-950" : "border-slate-600 bg-slate-800"}`}
                      >
                        <span className="flex items-center gap-2 font-semibold">
                          <input
                            type="radio"
                            name="research-coverage"
                            value={value}
                            disabled={
                              overview.research_tiers?.[value]?.configured ===
                              false
                            }
                            checked={researchTier === value}
                            onChange={() => {
                              setResearchTier(value);
                              setQuote(null);
                              setError("");
                            }}
                          />
                          {title}
                        </span>
                        <span className="block mt-2 text-sm font-semibold">
                          {count}
                        </span>
                        <span className="block mt-1 text-sm text-slate-300">
                          {description}
                        </span>
                        {overview.research_tiers?.[value]?.configured ===
                          false && (
                          <span className="block mt-2 text-sm text-amber-200">
                            Setup required:{" "}
                            {overview.research_tiers[
                              value
                            ].missing_families.join(", ")}
                            . No research will start for this option until its
                            provider access is configured.
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <p className="text-sm text-slate-300">
                    Every option includes recent-price research: first the last
                    7 days, then the last 30 days if needed. Market benchmarks
                    are labeled separately from supplier quotes. Missing current
                    evidence is reported.
                  </p>
                  {researchTier !== "default" && (
                    <p className="text-sm text-slate-300">
                      Existing provider keys remain in use. Additional models
                      without a configured provider key can use OpenRouter
                      credits. The estimate identifies the payment source for
                      each model before you approve.
                    </p>
                  )}
                </fieldset>
              )}
              {next >= 2 && (
                <fieldset disabled={busy} className="space-y-4">
                  <legend className="font-semibold">
                    Focus for round {next}
                  </legend>
                  <label className="block text-sm" htmlFor="research-follow-up">
                    Follow-up focus or question · any language
                  </label>
                  <textarea
                    id="research-follow-up"
                    dir="auto"
                    maxLength={4000}
                    rows={4}
                    value={question}
                    aria-describedby="research-follow-up-help"
                    className="w-full rounded border border-slate-500 bg-slate-800 p-3 text-sm"
                    onChange={(event) => {
                      setQuestion(event.target.value);
                      setQuote(null);
                    }}
                  />
                  <p
                    id="research-follow-up-help"
                    className="text-sm text-slate-300"
                  >
                    {question.length}/4,000 characters · {leadIds.length}{" "}
                    selected lead(s) from the latest completed round. Select
                    relevant leads in the latest review above. Leaving this
                    blank uses unresolved evidence from your saved research.
                  </p>
                  <p className="text-sm text-slate-300">
                    Editing and selecting leads makes no paid AI or research
                    calls. Your approved estimate includes AI planning to turn
                    this focus into a research plan, followed by focused web
                    research within this round’s quoted allowance.
                  </p>
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
                        <option value="deep">
                          Thoughtful · deeper analysis
                        </option>
                      </select>
                    </label>
                    <label className="text-sm">
                      Model selection
                      <select
                        aria-label="Research model"
                        aria-describedby="research-model-help"
                        disabled={choicesLoading}
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
                  <div
                    id="research-model-help"
                    className="text-sm text-slate-300"
                  >
                    {choicesLoading ? (
                      <p role="status">Checking model access and pricing…</p>
                    ) : choicesError ? (
                      <div>
                        <p role="status">{choicesError}</p>
                        <button
                          type="button"
                          className="mt-2 underline underline-offset-4"
                          onClick={() => setChoicesRetry((value) => value + 1)}
                        >
                          Retry model choices
                        </button>
                      </div>
                    ) : (
                      <p>
                        {choices.length
                          ? "Models that support research and structured analysis are listed. Your estimate rechecks access and pricing before approval."
                          : "No eligible model choices are currently listed. The cost estimate will check whether a system recommendation is available."}{" "}
                        Loading or selecting a model does not start research.
                      </p>
                    )}
                  </div>
                </fieldset>
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
                  {quote.plan.follow_up && (
                    <div className="rounded bg-slate-800 p-3 text-sm space-y-2">
                      <p className="font-semibold">
                        Focus saved with this estimate
                      </p>
                      <p dir="auto" className="whitespace-pre-wrap break-words">
                        {quote.plan.follow_up.question ||
                          "Resolve selected evidence gaps"}
                      </p>
                      <p>
                        {quote.plan.follow_up.lead_ids.length} selected lead(s)
                      </p>
                      <p>
                        Approval includes AI planning, then focused research.
                        Editing the focus requires a new estimate.
                      </p>
                    </div>
                  )}
                  {quote.plan.round_number === 1 && (
                    <p className="text-sm font-semibold">
                      {quote.plan.research_tier === "ultra"
                        ? "Ultra"
                        : quote.plan.research_tier === "advanced"
                          ? "Advanced"
                          : "Default"}
                      {" · "}
                      {quote.plan.research_models.length} web research models
                    </p>
                  )}
                  <p className="text-xl font-bold text-sky-200">
                    Estimated additional cost:{" "}
                    {money(quote.plan.estimated_low_usd)}–
                    {money(quote.plan.estimated_high_usd)}
                  </p>
                  <p className="text-xs text-slate-300">
                    An estimate, not a guaranteed spending cap. Valid until{" "}
                    {new Date(quote.plan.expires_at).toLocaleTimeString()}.
                  </p>
                  {quote.plan.mode === "live" && modelFallbacks.length > 0 && (
                    <section
                      aria-label="Model recovery included in this estimate"
                      className="rounded-lg border border-sky-700 bg-sky-950/30 p-3 text-sm space-y-2"
                    >
                      <h5 className="font-semibold">
                        Automatic model recovery included
                      </h5>
                      <p>
                        If a technical failure interrupts a step, this round may
                        continue with the named alternative below. Content
                        refusals and access or payment restrictions do not
                        trigger a model switch.
                      </p>
                      <ul className="space-y-1 break-words">
                        {modelFallbacks.map(([primary, alternatives]) => (
                          <li key={primary}>
                            Primary: {primary} · Alternative:{" "}
                            {alternatives.join(", ")}
                          </li>
                        ))}
                      </ul>
                      <p>
                        The alternative uses the same billing mode (BYOK or
                        OpenRouter credits) as its primary model. BYOK models
                        use their own configured provider keys. Recovery calls
                        are already included in this estimate and the round’s
                        call allowance; they are recorded in your costs. No
                        extra round starts automatically.
                      </p>
                      {quote.plan.automatic_recovery_attempts &&
                        quote.plan.recovery_call_reserve && (
                          <p>
                            Up to {quote.plan.automatic_recovery_attempts} total
                            attempts per step, including the first attempt.
                            Recovery shares a reserve of{" "}
                            {quote.plan.recovery_call_reserve} additional calls
                            across this round.
                          </p>
                        )}
                    </section>
                  )}
                  {quote.plan.mode !== "demonstration" &&
                    quote.plan.rates?.some(
                      (rate) => rate.billing_mode === "openrouter_credits",
                    ) && (
                      <section
                        aria-label="Payment sources for this estimate"
                        className="rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-sm"
                      >
                        <p className="font-semibold">
                          Includes OpenRouter credit usage
                        </p>
                        <p className="mt-1">
                          Approving this estimate authorizes OpenRouter credit
                          charges for the models listed below. Models marked
                          BYOK continue to use your configured provider keys.
                          These charges are included in the total estimate.
                        </p>
                        <ul className="mt-2 space-y-1 break-words">
                          {quote.plan.rates.map((rate) => (
                            <li key={rate.model}>
                              {rate.model}:{" "}
                              {rate.billing_mode === "openrouter_credits"
                                ? "OpenRouter credits"
                                : "BYOK · provider account"}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  {quote.plan.mode === "demonstration" ? (
                    <p className="text-sm text-amber-200">
                      Demonstration: fixed sample data; no provider calls.
                    </p>
                  ) : (
                    <details className="text-sm">
                      <summary className="cursor-pointer">
                        Selected models and search method
                      </summary>
                      <p className="mt-2">
                        Search:{" "}
                        {quote.plan.research_models
                          .map(
                            (m) =>
                              `${m} (${quote.plan.search_engines?.[m] ?? quote.plan.search_engine})`,
                          )
                          .join(" + ")}
                        <br />
                        Analysis: {quote.plan.synthesis_model}
                        <br />
                        Extraction: {quote.plan.extraction_model}
                      </p>
                    </details>
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
                      output tokens per call. Primary web retrieval can add
                      elapsed time.
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
                Five research rounds have been recorded. No further round is
                scheduled.
              </p>
            )
          )}
        </div>
      </details>
      {notice && (
        <p role="status" className="text-sky-200">
          {notice}
        </p>
      )}
      {visibleError && (
        <div className="text-amber-200 space-y-2">
          <p role="alert">
            {/MB-\d|execution.?id|HTTP \d|SQL|provider/i.test(visibleError)
              ? "This action could not be completed. Your saved research is retained. Check the current progress before trying again."
              : visibleError}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer">Support details</summary>
            <p className="break-words mt-2">{visibleError}</p>
          </details>
        </div>
      )}
    </section>
  );
}
