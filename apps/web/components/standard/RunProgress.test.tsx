import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RunProgress } from "./RunProgress";

const session = {
  display_name: "Standard Evaluator",
  tier: "standard" as const,
  quota: { limit: 5, used: 1, remaining: 4, next_capacity_at: null },
  execution: { active: 1, capacity: 3 },
  research_mode: {
    id: "synthetic_reference" as const,
    label: "Synthetic reference" as const,
    live_qualified: false,
  },
  csrf_token: "fixture-csrf-value",
  environment: "test" as const,
};

function run(state: "queued" | "running", progress: number) {
  return {
    schema_version: "standard-run-projection.v1",
    synthetic_warning: "Synthetic evaluation data — not a sourcing result",
    projection_version: 5,
    run_id: "run-1",
    request_id: "request-1",
    canonical_request_version: 1,
    phase: state,
    phase_label: state === "queued" ? "Queued" : "Applying constraints",
    progress,
    started_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:01.000Z",
    limitations_notice: "Synthetic limitations apply.",
    links: { request: "/requests/request-1", run: "/runs/run-1" },
    state,
    terminal: false,
    result_available: false,
    outcome: "pending",
    scarcity: "pending",
    poll_after_ms: 1_000,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("mounts an empty status, pauses polling, and refreshes one state announcement", async () => {
  vi.useFakeTimers();
  let resolveFirst: ((response: Response) => void) | undefined;
  const responses = [run("running", 40), run("running", 70)];
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockImplementation(
      async () =>
        new Response(JSON.stringify(responses.shift() ?? run("running", 70)), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "MB-Poll-After-Ms": "1000",
          },
        }),
    );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <RunProgress
      session={session}
      runId="run-1"
      onResult={vi.fn()}
      onTerminal={vi.fn()}
      onAnnouncement={vi.fn()}
    />,
  );

  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");

  await act(async () => {
    resolveFirst?.(
      new Response(JSON.stringify(run("queued", 0)), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "MB-Poll-After-Ms": "1000",
        },
      }),
    );
    await Promise.resolve();
  });
  expect(screen.getByRole("status")).toHaveTextContent("Queued.");
  expect(screen.getByRole("status")).not.toHaveTextContent("0% complete");
  expect(screen.getByRole("status").closest("section")).not.toHaveAttribute(
    "aria-busy",
  );

  fireEvent.click(screen.getByRole("button", { name: "Pause updates" }));
  expect(
    screen.getByRole("button", { name: "Resume updates" }),
  ).toHaveAttribute("aria-pressed", "true");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent("Applying constraints.");
  expect(screen.getByRole("status")).not.toHaveTextContent("40% complete");

  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(fetchMock).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("status")).toHaveTextContent("Applying constraints.");
});

test("discards an in-flight Standard poll when updates are paused", async () => {
  let resolvePoll: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolvePoll = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <RunProgress
      session={session}
      runId="run-1"
      onResult={vi.fn()}
      onTerminal={vi.fn()}
      onAnnouncement={vi.fn()}
    />,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Pause updates" }));

  await act(async () => {
    resolvePoll?.(
      new Response(JSON.stringify(run("running", 40)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await Promise.resolve();
  });

  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(
    screen.getByRole("heading", { name: "Queued for bounded execution" }),
  ).toBeVisible();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("announces a terminal Standard failure as a blocking alert", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...run("running", 80),
            state: "failed",
            phase: "failed",
            phase_label: "Failed",
            terminal: true,
            result_available: false,
            outcome: "failed",
            scarcity: "not_applicable",
            poll_after_ms: undefined,
            limitations_notice: "No result was disclosed.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );

  render(
    <RunProgress
      session={session}
      runId="run-1"
      onResult={vi.fn()}
      onTerminal={vi.fn()}
      onAnnouncement={vi.fn()}
    />,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Research failed. No result was disclosed.",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Failed.");
});

test("treats a terminal result disclosure failure as blocking", async () => {
  const onTerminal = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...run("running", 100),
          state: "completed",
          phase: "completed",
          phase_label: "Complete",
          terminal: true,
          result_available: true,
          outcome: "matched",
          scarcity: "none",
          poll_after_ms: undefined,
          links: {
            request: "/requests/request-1",
            run: "/runs/run-1",
            result: "/runs/run-1/result",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { detail: "The result projection was refused." },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <RunProgress
      session={session}
      runId="run-1"
      onResult={vi.fn()}
      onTerminal={onTerminal}
      onAnnouncement={vi.fn()}
    />,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The result projection was refused.",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const returnButton = screen.getByRole("button", {
    name: "Return to requests",
  });
  returnButton.focus();
  fireEvent.keyDown(returnButton, { key: "Enter" });
  fireEvent.click(returnButton);
  expect(onTerminal).toHaveBeenCalledTimes(1);
});

test("moves a Super-admin terminal Consultant result to the profile without down-projecting it", async () => {
  const onTerminal = vi.fn();
  const onAnnouncement = vi.fn();
  const fetchMock = vi.fn(async () =>
    Response.json({
      ...run("running", 100),
      state: "complete",
      phase: "completed",
      phase_label: "Complete",
      terminal: true,
      result_available: true,
      outcome: "matched",
      scarcity: "none",
      poll_after_ms: undefined,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <RunProgress
      session={{
        ...session,
        tier: "admin",
        research_mode: {
          id: "qualified_live_research",
          label: "Qualified live research",
          live_qualified: true,
        },
      }}
      runId="run-1"
      onResult={vi.fn()}
      onTerminal={onTerminal}
      onAnnouncement={onAnnouncement}
      deferResultToProfile
    />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onAnnouncement).toHaveBeenCalledWith(
    expect.stringMatching(/Consultant result/iu),
  );
});
