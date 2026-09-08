import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResearchRoundControl } from "./ResearchRoundControl";
afterEach(() => vi.unstubAllGlobals());
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
