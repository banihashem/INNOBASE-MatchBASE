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
