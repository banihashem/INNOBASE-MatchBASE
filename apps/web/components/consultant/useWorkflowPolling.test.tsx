import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkflowPolling } from "./useWorkflowPolling";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("L10 keeps polling an approved new round while the server retains a prior output", async () => {
  vi.useFakeTimers();
  const previous = { execution_id: "round-one" };
  const latest = { execution_id: "round-two" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        session: {
          state: "research_dispatching",
          execution_id: "round-two",
          output: previous,
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        session: {
          state: "synthesis_running",
          execution_id: "round-two",
          output: previous,
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        session: {
          state: "progressive_reveal_ready",
          execution_id: "round-two",
          output: latest,
          revealed_count: 5,
        },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const callbacks = {
    acceptProgress: vi.fn(),
    setOutput: vi.fn(),
    setRevealedCount: vi.fn(),
    setConnectionError: vi.fn(),
  };
  renderHook(() =>
    useWorkflowPolling({
      runId: "run",
      workflowState: "research_dispatching",
      ...callbacks,
    }),
  );
  await act(async () => {});
  expect(callbacks.setOutput).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(callbacks.acceptProgress).toHaveBeenCalledTimes(2);
  expect(callbacks.setOutput).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(callbacks.setOutput).toHaveBeenCalledExactlyOnceWith(latest);
  expect(callbacks.setRevealedCount).toHaveBeenCalledWith(5);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("L10 retains completed findings when a later execution stops and does not promote them as its result", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        session: {
          state: "workflow_failed",
          execution_id: "new",
          output: { execution_id: "old" },
        },
      }),
    ),
  );
  const callbacks = {
    acceptProgress: vi.fn(),
    setOutput: vi.fn(),
    setRevealedCount: vi.fn(),
    setConnectionError: vi.fn(),
  };
  renderHook(() =>
    useWorkflowPolling({
      runId: "run",
      workflowState: "research_dispatching",
      ...callbacks,
    }),
  );
  await act(async () => {});
  expect(callbacks.acceptProgress).toHaveBeenCalledWith(
    expect.objectContaining({ state: "workflow_failed" }),
  );
  expect(callbacks.setOutput).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
