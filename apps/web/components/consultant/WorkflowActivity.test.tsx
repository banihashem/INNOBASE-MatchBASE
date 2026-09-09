import { act, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowActivity } from "./WorkflowActivity";

afterEach(() => vi.useRealTimers());
const started = {
  phase: "discovery_gemini",
  loop: 1,
  started: 1,
  completed: 0,
  failed: 0,
  updated_at: "2026-09-09T10:00:00Z",
};
it("L10 progresses only on server events and exposes parallel and completed work without expanding a panel", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(started.updated_at));
  const openai = { ...started, phase: "discovery_openai" };
  const { rerender } = render(
    <WorkflowActivity
      state="research_dispatching"
      progress={{ phase: "discovery_openai" }}
      activity={[started, openai]}
    />,
  );
  const bar = screen.getByRole("progressbar");
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(
    screen.getByRole("heading", { name: /running in parallel/ }),
  ).toBeVisible();
  expect(screen.getAllByText("In progress")).toHaveLength(2);
  act(() => {
    vi.advanceTimersByTime(120000);
  });
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByText(/0 operation\(s\) completed/)).toBeVisible();
  rerender(
    <WorkflowActivity
      state="lane_openai_running"
      progress={{ phase: "discovery_gemini" }}
      activity={[{ ...started, completed: 1 }, openai]}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "OpenAI · Searching for suppliers" }),
  ).toBeVisible();
  const record = screen.getByLabelText("Recorded execution activity");
  expect(within(record).getByText("Completed")).toBeVisible();
  expect(within(record).getByText("In progress")).toBeVisible();
  expect(within(record).getByText(/1 operation\(s\) completed/)).toBeVisible();
  expect(bar).not.toHaveAttribute("aria-valuenow");
});

it("L10 failures retain completed work, and only a saved result reaches 100 percent", () => {
  const completed = { ...started, completed: 1 };
  const { rerender } = render(
    <WorkflowActivity
      state="workflow_failed"
      progress={{ phase: "failed" }}
      activity={[
        completed,
        { ...started, phase: "discovery_openai", failed: 1 },
      ]}
    />,
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("Completed")).toBeVisible();
  expect(screen.getByText("Stopped")).toBeVisible();
  rerender(
    <WorkflowActivity
      state="progressive_reveal_ready"
      progress={{ phase: "progressive_reveal_ready" }}
      activity={[completed]}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  rerender(
    <WorkflowActivity
      state="progressive_reveal_ready"
      progress={null}
      pdfBusy
      activity={[completed]}
    />,
  );
  expect(
    screen.getByRole("progressbar", { name: "PDF preparation" }),
  ).not.toHaveAttribute("aria-valuenow");
});

it("L10 disconnects pause the activity indicator without declaring server work stopped", () => {
  render(
    <WorkflowActivity
      state="research_dispatching"
      progress={{ phase: "discovery_gemini" }}
      activity={[started]}
      connectionError="Offline"
    />,
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "does not mean the research stopped",
  );
  expect(screen.getByText("Last recorded: in progress")).toBeVisible();
});
