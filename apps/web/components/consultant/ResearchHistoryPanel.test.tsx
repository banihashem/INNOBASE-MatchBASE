import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResearchHistoryPanel } from "./ResearchHistoryPanel";
const runId = "00000000-0000-4000-8000-000000000001";
const nextId = "00000000-0000-4000-8000-000000000002";
const fixture = {
  history: {
    generation: 0,
    runs: [
      {
        run_id: runId,
        renewal_ordinal: 0,
        created_at: "2026-09-01T00:00:00Z",
        state: "workflow_complete",
      },
    ],
    costs: { recorded_total_usd: 3.5, unpriced_calls: 1, complete: false },
    can_renew: true,
  },
  memory: {
    eligible_count: 1,
    needs_refresh_count: 2,
    fresh_discovery_required: true,
    observations: [
      {
        observation_id: "observation",
        claim_text: "Supplier publishes a product catalogue.",
        source_url: "https://supplier.example/catalogue",
        published_at: null,
        retrieved_at: "2026-09-16T00:00:00Z",
        eligibility: "eligible",
      },
    ],
  },
};
const reply = (value: unknown, ok = true) => ({ ok, json: async () => value });
afterEach(() => vi.unstubAllGlobals());
async function openPanel() {
  const detail = screen
    .getByText("Research history & saved evidence")
    .closest("details")!;
  act(() => {
    detail.open = true;
    fireEvent(detail, new Event("toggle"));
  });
  await screen.findByText("Evidence available for this request");
}
it("inspects memory only on demand and separates source publication from retrieval date", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply(fixture));
  vi.stubGlobal("fetch", fetcher);
  render(<ResearchHistoryPanel runId={runId} />);
  expect(fetcher).not.toHaveBeenCalled();
  await openPanel();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Source date: Date not established/)).toBeVisible();
  expect(screen.getByText(/Known total across this history/)).toBeVisible();
  expect(screen.getByText(/1 call\(s\) still have incomplete/)).toBeVisible();
  expect(screen.getByRole("link", { name: "View source" })).toHaveAttribute(
    "href",
    "https://supplier.example/catalogue",
  );
  expect(
    screen.getByText(/New research still searches for additional suppliers/),
  ).toBeVisible();
});
it("creates one linked renewal only by explicit action and keeps its retry identity", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (options?.method !== "POST") return reply(fixture);
    bodies.push(JSON.parse(String(options.body)));
    return bodies.length === 1
      ? reply({ error: "SQL private diagnostic" }, false)
      : reply({ success: true, run_id: nextId, requires_cost_approval: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const onRenewed = vi.fn();
  render(<ResearchHistoryPanel runId={runId} onRenewed={onRenewed} />);
  await openPanel();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh this research" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).not.toHaveTextContent("SQL");
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  await waitFor(() =>
    expect(
      screen.queryByText(/Checking your saved research/),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh this research" }),
  );
  await waitFor(() => expect(onRenewed).toHaveBeenCalledWith(nextId));
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual({
    ...bodies[1],
    action: "renew",
    run_id: runId,
    expected_generation: 0,
  });
  expect(bodies[0]!.idempotency_key).toMatch(/^[a-f0-9-]{36}$/);
  expect(
    fetcher.mock.calls.every(([url]) =>
      String(url).startsWith("/api/v1/consultant/research-history"),
    ),
  ).toBe(true);
});
it("does not allow renewal while research is active", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(fixture)));
  render(<ResearchHistoryPanel runId={runId} active />);
  await openPanel();
  expect(
    screen.getByRole("button", { name: "Refresh this research" }),
  ).toBeDisabled();
});
it("refuses script URLs in stored evidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      reply({
        ...fixture,
        memory: {
          ...fixture.memory,
          observations: [
            {
              ...fixture.memory.observations[0],
              source_url: "javascript:alert(1)",
            },
          ],
        },
      }),
    ),
  );
  render(<ResearchHistoryPanel runId={runId} />);
  await openPanel();
  expect(
    screen.queryByRole("link", { name: "View source" }),
  ).not.toBeInTheDocument();
});
