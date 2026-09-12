import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResearchRoundControl } from "./ResearchRoundControl";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const costs = {
  currency: "USD",
  recorded_total_usd: 0.42,
  openrouter_charge_usd: 0,
  byok_upstream_usd: 0.42,
  preparation_usd: 0.42,
  research_usd: 0,
  unpriced_calls: 1,
  calls: 3,
  complete: false,
  by_execution: {},
  disclosure: "Usage accounting remains pending.",
};
const plan = {
  round_number: 1,
  title: "Initial research",
  purpose: "Find suppliers",
  estimated_low_usd: 0.1,
  estimated_high_usd: 1,
  expires_at: "2099-01-01T00:00:00Z",
  research_models: ["google/gemini", "openai/gpt"],
  synthesis_model: "reasoner",
  extraction_model: "extractor",
  search_engine: "native",
  focus_requirements: [],
  max_calls: 9,
  max_output_tokens_per_call: 12000,
  assumptions: ["No automatic next round"],
};
const researchReview = {
  version: "research-review.v1",
  round_number: 1,
  leads: [
    {
      lead_id: "lead-a",
      name: "Unfinished logistics",
      source_urls: ["https://example.com/services"],
      status: "needs_review",
      reason: "Route not confirmed",
      missing_evidence: ["Aqaba service evidence"],
      first_seen_round: 1,
      last_seen_round: 1,
    },
  ],
  coverage_gaps: ["Destination coverage"],
  summary: { discovered: 4, documented: 3, needs_review: 1, excluded: 0 },
  changes: { new_leads: 1, promoted: 0 },
};
it("MB-UX-QUALITY-001 L07 loads Gemini and DeepSeek before a later-round estimate and again after reopening", async () => {
  const actions: Record<string, unknown>[] = [];
  const catalogRuns: string[] = [];
  const started = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("view=model_choices")) {
        catalogRuns.push(
          new URL(url, "http://localhost").searchParams.get("run_id")!,
        );
        return Response.json({
          choices: [
            { model: "google/gemini-research" },
            { model: "deepseek/research" },
          ],
        });
      }
      if (!options?.body)
        return Response.json({ costs, rounds: [], next_round: 2 });
      const body = JSON.parse(String(options.body));
      actions.push(body);
      return Response.json({
        quote_id: "selected-model-quote",
        choices: [
          { model: "google/gemini-research" },
          { model: "deepseek/research" },
        ],
        plan: { ...plan, round_number: 2 },
      });
    }),
  );
  const props = {
    runId: "run-one",
    workflowState: "workflow_complete",
    onStarted: started,
    onPreview: vi.fn(),
  };
  const view = render(<ResearchRoundControl {...props} />);
  await screen.findByRole("option", { name: "deepseek/research" });
  expect(
    screen.getByRole("option", { name: "google/gemini-research" }),
  ).toBeInTheDocument();
  expect(actions).toHaveLength(0);
  fireEvent.change(screen.getByRole("combobox", { name: "Research model" }), {
    target: { value: "deepseek/research" },
  });
  expect(actions).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /Get cost estimate/ }));
  await screen.findByRole("button", { name: /Approve cost estimate/ });
  expect(actions).toEqual([
    expect.objectContaining({ action: "quote", model: "deepseek/research" }),
  ]);
  view.unmount();
  render(<ResearchRoundControl {...props} />);
  await screen.findByRole("option", { name: "deepseek/research" });
  expect(catalogRuns).toEqual(["run-one", "run-one"]);
  expect(actions).toHaveLength(1);
  expect(started).not.toHaveBeenCalled();
});
it("MB-UX-QUALITY-001 L07 reports catalog loading failure and retries without quoting or dispatching", async () => {
  let catalogAttempts = 0;
  const post = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.body) {
        post();
        throw new Error("Unexpected mutation");
      }
      if (url.includes("view=model_choices")) {
        catalogAttempts++;
        return catalogAttempts === 1
          ? Response.json(
              { error: "sensitive provider detail" },
              { status: 503 },
            )
          : Response.json({ choices: [{ model: "deepseek/research" }] });
      }
      return Response.json({ costs, rounds: [], next_round: 2 });
    }),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="workflow_complete"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  const retry = await screen.findByRole("button", {
    name: "Retry model choices",
  });
  expect(
    screen.queryByText("sensitive provider detail"),
  ).not.toBeInTheDocument();
  fireEvent.click(retry);
  await screen.findByRole("option", { name: "deepseek/research" });
  expect(catalogAttempts).toBe(2);
  expect(post).not.toHaveBeenCalled();
});
it("MB-UX-QUALITY-001 L07 loads model metadata only when later-round selection is available", async () => {
  let nextRound = 1;
  const catalog = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("view=model_choices")) {
        catalog();
        return Response.json({ choices: [] });
      }
      return Response.json({ costs, rounds: [], next_round: nextRound });
    }),
  );
  const props = {
    runId: "run-one",
    workflowState: "prep_step3_prompt_approved",
    onStarted: vi.fn(),
    onPreview: vi.fn(),
  };
  const first = render(<ResearchRoundControl {...props} />);
  await screen.findByRole("radio", { name: /^Default/ });
  expect(catalog).not.toHaveBeenCalled();
  first.unmount();
  nextRound = 6;
  render(<ResearchRoundControl {...props} />);
  await screen.findByText(/Five research rounds have been recorded/);
  expect(catalog).not.toHaveBeenCalled();
});
it("MB-UX-QUALITY-001 L01 saves focus with the quote and invalidates approval on edits without paid calls", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.body)
        return Response.json({
          costs,
          rounds: [],
          next_round: 2,
          research_review: researchReview,
        });
      const body = JSON.parse(String(options.body));
      requests.push(body);
      return Response.json({
        quote_id: "focus-quote",
        choices: [],
        plan: { ...plan, round_number: 2, follow_up: body.follow_up },
      });
    }),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="workflow_complete"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  const question = await screen.findByRole("textbox", {
    name: /Follow-up focus/,
  });
  expect(question).toHaveAttribute("dir", "auto");
  expect(question).toHaveAttribute("maxlength", "4000");
  fireEvent.click(screen.getByText(/Incomplete research leads/));
  fireEvent.change(question, { target: { value: "بررسی مسیر به عقبه" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Include Unfinished/ }));
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /Get cost estimate/ }));
  await screen.findByRole("button", { name: /Approve cost estimate/ });
  expect(requests[0]?.follow_up).toEqual({
    question: "بررسی مسیر به عقبه",
    lead_ids: ["lead-a"],
  });
  expect(screen.getByText(/Approval includes AI planning/)).toBeVisible();
  fireEvent.change(question, { target: { value: "Confirm source dates" } });
  expect(
    screen.queryByRole("button", { name: /Approve cost estimate/ }),
  ).not.toBeInTheDocument();
  expect(requests).toHaveLength(1);
});
it("MB-UX-QUALITY-001 L01 retains review after round five and disables further quotes and selection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        costs,
        rounds: [],
        next_round: 6,
        research_review: { ...researchReview, round_number: 5 },
      }),
    ),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="workflow_complete"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  expect(await screen.findByText("Research review · round 5")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Get cost estimate/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("L03 discloses credit-funded Ultra models before separate cost approval", async () => {
  const actions: string[] = [];
  const started = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.body)
        return Response.json({
          costs,
          rounds: [],
          next_round: 1,
          research_tiers: {
            default: { configured: true, missing_families: [] },
            advanced: { configured: true, missing_families: [] },
            ultra: { configured: true, missing_families: [] },
          },
        });
      const body = JSON.parse(String(options.body));
      actions.push(body.action);
      return Response.json(
        body.action === "quote"
          ? {
              quote_id: "credit-quote",
              choices: [],
              plan: {
                ...plan,
                mode: "live",
                research_tier: "ultra",
                research_models: [
                  "google/gemini",
                  "openai/gpt",
                  "anthropic/claude",
                  "deepseek/model",
                  "x-ai/grok",
                ],
                rates: [
                  { model: "google/gemini", billing_mode: "byok" },
                  { model: "openai/gpt", billing_mode: "byok" },
                  {
                    model: "anthropic/claude",
                    billing_mode: "openrouter_credits",
                  },
                  {
                    model: "deepseek/model",
                    billing_mode: "openrouter_credits",
                  },
                  { model: "x-ai/grok", billing_mode: "openrouter_credits" },
                ],
              },
            }
          : { success: true },
      );
    }),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="prep_step3_prompt_approved"
      onStarted={started}
      onPreview={vi.fn()}
    />,
  );
  const ultra = await screen.findByRole("radio", { name: /^Ultra/ });
  expect(ultra).toBeEnabled();
  fireEvent.click(ultra);
  expect(actions).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /Get cost estimate/ }));
  expect(
    await screen.findByRole("region", {
      name: "Payment sources for this estimate",
    }),
  ).toHaveTextContent(
    "Approving this estimate authorizes OpenRouter credit charges",
  );
  expect(
    screen.getByText("anthropic/claude: OpenRouter credits"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("google/gemini: BYOK · provider account"),
  ).toBeInTheDocument();
  expect(actions).toEqual(["quote"]);
  expect(started).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Approve cost estimate & start round 1",
    }),
  );
  await waitFor(() => expect(started).toHaveBeenCalledOnce());
  expect(actions).toEqual(["quote", "approve"]);
});
it("COST-001 shows known costs and requires separate quote and spend approval", async () => {
  const actions: string[] = [];
  const started = vi.fn();
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.body)
      return Response.json({ costs, rounds: [], next_round: 1 });
    const body = JSON.parse(String(options.body));
    actions.push(body.action);
    return Response.json(
      body.action === "quote"
        ? { quote_id: "quote", plan, choices: [] }
        : { success: true },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="prep_step3_prompt_approved"
      onStarted={started}
      onPreview={vi.fn()}
    />,
  );
  expect(
    await screen.findByText("$0.42", { selector: "strong" }),
  ).toBeInTheDocument();
  expect(actions).toEqual([]);
  expect(screen.getByText(/not counted as free/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Get cost estimate/ }));
  const approve = await screen.findByRole("button", {
    name: "Approve cost estimate & start round 1",
  });
  expect(actions).toEqual(["quote"]);
  expect(started).not.toHaveBeenCalled();
  fireEvent.click(approve);
  await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
  expect(actions).toEqual(["quote", "approve"]);
});
it("COST-001 round three depth selection invalidates an earlier quote", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) =>
      Response.json(
        options?.body
          ? {
              quote_id: "third",
              plan: { ...plan, round_number: 3 },
              choices: [],
            }
          : { costs, rounds: [], next_round: 3 },
      ),
    ),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="workflow_complete"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  await screen.findByRole("combobox", { name: "Research depth" });
  fireEvent.click(screen.getByRole("button", { name: /Get cost estimate/ }));
  await screen.findByRole("button", { name: /Approve cost estimate/ });
  fireEvent.change(screen.getByRole("combobox", { name: "Research depth" }), {
    target: { value: "deep" },
  });
  expect(
    screen.queryByRole("button", { name: /Approve cost estimate/ }),
  ).not.toBeInTheDocument();
});

it("DEV-004 does not call a failed attempt a ready result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        costs,
        next_round: 2,
        rounds: [
          {
            round_id: "failed",
            round_number: 1,
            status: "failed",
            candidate_count: null,
            output_available: false,
            plan,
          },
        ],
      }),
    ),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="workflow_failed"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(/previous attempt did not produce a report/),
  ).toBeVisible();
  expect(screen.queryByText(/Your result is ready/)).not.toBeInTheDocument();
});

it("DEV-004 serializes cost polling and resumes when a hidden page becomes visible", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  let complete!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <ResearchRoundControl
      runId="run"
      workflowState="research_dispatching"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    complete(Response.json({ costs, rounds: [], next_round: 1 }));
  });
  hidden = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(
    (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].signal
      ?.aborted,
  ).toBe(true);
  vi.restoreAllMocks();
});

it("DEV-004 clears recovered polling errors without needing a billed action", async () => {
  let healthy = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      healthy
        ? Response.json({ costs, rounds: [], next_round: 1 })
        : Response.json(
            { error: "Cost history connection interrupted" },
            { status: 503 },
          ),
    ),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="research_dispatching"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Cost history connection interrupted",
  );
  healthy = true;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("$0.42", { selector: "strong" })).toBeVisible();
});

it("DEV-004 keeps the spend visible and optional further research secondary after results", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        costs,
        next_round: 2,
        rounds: [
          {
            round_id: "saved",
            round_number: 1,
            status: "completed",
            output_available: true,
            candidate_count: 20,
            plan,
          },
        ],
      }),
    ),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="progressive_reveal_ready"
      hasResults
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  expect(
    await screen.findByText("$0.42", { selector: "strong" }),
  ).toBeVisible();
  const toggle = screen.getByText("Review rounds or research further");
  expect(toggle.closest("details")).not.toHaveAttribute("open");
  expect(
    screen.getByRole("button", { name: /Get cost estimate/ }),
  ).not.toBeVisible();
  fireEvent.click(toggle);
  expect(
    screen.getByRole("button", { name: /Get cost estimate/ }),
  ).toBeVisible();
});

it("DEV004 L02 binds coverage to its estimate and invalidates approval when coverage changes", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.body)
        return Response.json({ costs, rounds: [], next_round: 1 });
      const body = JSON.parse(String(options.body));
      requests.push(body);
      return Response.json({
        quote_id: "tier-quote",
        plan: {
          ...plan,
          research_tier: body.research_tier,
          research_models:
            body.research_tier === "ultra"
              ? [
                  "google/gemini",
                  "openai/gpt",
                  "anthropic/claude",
                  "deepseek/model",
                  "x-ai/grok",
                ]
              : plan.research_models,
        },
        choices: [],
      });
    }),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="prep_step3_prompt_approved"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  expect(await screen.findByRole("radio", { name: /^Default/ })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: /^Ultra/ }));
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /Get cost estimate/ }));
  await screen.findByRole("button", {
    name: "Approve cost estimate & start round 1",
  });
  expect(requests[0]?.research_tier).toBe("ultra");
  expect(screen.getByText(/Ultra · 5 web research models/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /^Advanced/ }));
  expect(
    screen.queryByRole("button", {
      name: "Approve cost estimate & start round 1",
    }),
  ).not.toBeInTheDocument();
  expect(requests).toHaveLength(1);
});

it("DEV004 L02 exposes missing provider setup before selecting unavailable coverage", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        costs,
        rounds: [],
        next_round: 1,
        research_tiers: {
          default: { configured: true, missing_families: [] },
          advanced: {
            configured: false,
            missing_families: ["Anthropic, DeepSeek or Grok"],
          },
          ultra: {
            configured: false,
            missing_families: ["Anthropic", "DeepSeek", "Grok"],
          },
        },
      }),
    ),
  );
  render(
    <ResearchRoundControl
      runId="run"
      workflowState="prep_step3_prompt_approved"
      onStarted={vi.fn()}
      onPreview={vi.fn()}
    />,
  );
  expect(await screen.findByRole("radio", { name: /^Default/ })).toBeEnabled();
  expect(screen.getByRole("radio", { name: /^Ultra/ })).toBeDisabled();
  expect(screen.getByRole("radio", { name: /^Advanced/ })).toBeDisabled();
  expect(screen.getAllByText(/Setup required:/)).toHaveLength(2);
});
