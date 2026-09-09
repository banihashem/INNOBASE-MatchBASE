import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StopResearchButton } from "./StopResearchButton";
import { WorkflowActivity } from "./WorkflowActivity";
afterEach(() => vi.unstubAllGlobals());
it("L09 stops the exact execution once and waits for server confirmation", async () => {
  let complete!: (value: Response) => void;
  const fetcher = vi.fn(
    (_url: string, _options: RequestInit) =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const onStopped = vi.fn();
  render(
    <StopResearchButton
      runId="run"
      executionId="execution"
      onStopped={onStopped}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop research" }));
  fireEvent.click(screen.getByRole("button", { name: "Stopping research…" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toEqual({
    action: "stop_research",
    run_id: "run",
    execution_id: "execution",
  });
  expect(onStopped).not.toHaveBeenCalled();
  complete(
    Response.json({
      success: true,
      session: { execution_id: "execution", state: "workflow_failed" },
    }),
  );
  await waitFor(() => expect(onStopped).toHaveBeenCalledTimes(1));
});
it("L09 a denied stop does not pretend research stopped", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Execution changed. Reload." }, { status: 409 }),
    ),
  );
  const onStopped = vi.fn();
  render(
    <StopResearchButton runId="run" executionId="old" onStopped={onStopped} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop research" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Execution changed",
  );
  expect(onStopped).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Stop research" })).toBeEnabled();
});
it("L09 user cancellation is distinct from provider failure and retains restart semantics", () => {
  render(
    <WorkflowActivity
      state="workflow_failed"
      progress={{ phase: "user_cancelled" }}
      retryAction="research"
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Stopped by you" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /No new execution starts without a fresh cost estimate and your approval/,
    ),
  ).toBeVisible();
  expect(screen.getByRole("status")).not.toHaveTextContent("Action needed");
});
