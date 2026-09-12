import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
it("MB-UX-QUALITY-001 L09 shows server-confirmed model recovery without promoting raw provider errors", () => {
  const recoveryMessage =
    "Continuing this step with openai/gpt, the approved alternative to google/gemini. No extra round starts.";
  const progress = {
    phase: "verification_selected",
    loop: 3,
    recovery_attempt: 2,
    max_recovery_attempts: 3,
    recovery_scheduled: true,
    recovery_message: recoveryMessage,
    message: "MB-502 raw provider exception belongs in support only",
  };
  const { rerender } = render(
    <WorkflowActivity state="verification_loop_running" progress={progress} />,
  );
  expect(screen.getByText(recoveryMessage)).toBeVisible();
  expect(screen.getByText(/Research step recovery/)).toHaveTextContent(
    "Attempt 2 of 3",
  );
  expect(
    screen.getByText(/Previous round results and selected leads/),
  ).toHaveTextContent("approved round allowance");
  for (const status of screen.getAllByRole("status"))
    expect(status).not.toHaveTextContent("MB-502");
  expect(screen.getByLabelText("Current operation")).not.toHaveTextContent(
    "MB-502",
  );
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  rerender(
    <WorkflowActivity
      state="verification_loop_running"
      progress={progress}
      connectionError="Disconnected"
    />,
  );
  expect(screen.queryByText(recoveryMessage)).toBeNull();
  expect(screen.queryByText(/Research step recovery/)).toBeNull();
  rerender(<WorkflowActivity state="workflow_failed" progress={progress} />);
  expect(screen.queryByText(recoveryMessage)).toBeNull();
  expect(screen.queryByText(/Research step recovery/)).toBeNull();
});

it("MB-UX-QUALITY-001 L05 shows bounded focus recovery with retained prior results", () => {
  const { rerender } = render(
    <WorkflowActivity
      state="lane_gemini_running"
      progress={{
        phase: "research_focus_analysis",
        loop: 2,
        max_loops: 2,
        recovery_attempt: 2,
        max_recovery_attempts: 3,
      }}
    />,
  );
  expect(screen.getByText(/Focus analysis recovery/)).toHaveTextContent(
    "Attempt 2 of 3",
  );
  expect(
    screen.getByText(/Previous round results and selected leads/),
  ).toHaveTextContent("approved round allowance");
  expect(
    screen.queryByText(/Completed topics are retained/),
  ).not.toBeInTheDocument();
  rerender(
    <WorkflowActivity
      state="progressive_reveal_ready"
      progress={{
        phase: "completed",
        recovery_attempt: 2,
        max_recovery_attempts: 3,
      }}
    />,
  );
  expect(screen.queryByText(/Focus analysis recovery/)).not.toBeInTheDocument();
});

it("MB-UX-QUALITY-001 L04 shows recorded preparation recovery without claiming supplier research or completion", () => {
  const { rerender } = render(
    <WorkflowActivity
      state="prep_step2_advisory_generating"
      progress={{
        phase: "step2_advisory_validation",
        loop: 1,
        max_loops: 3,
        recovery_attempt: 2,
        max_recovery_attempts: 3,
        message: "MB-502 provider detail belongs in support only",
      }}
      activity={[
        { ...started, phase: "step2_advisory", started: 2, failed: 1 },
        { ...started, phase: "step2_advisory_validation" },
      ]}
    />,
  );
  expect(
    screen.getByRole("heading", {
      name: "Preparing and checking your request",
    }),
  ).toBeVisible();
  expect(screen.getByText(/Automatic recovery · Attempt 2 of 3/)).toBeVisible();
  expect(screen.getByText(/Completed topics are retained/)).toHaveTextContent(
    "may be charged",
  );
  expect(screen.getByText("Preparation in progress")).toBeVisible();
  expect(
    screen.queryByText("Research steps are running in parallel"),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByLabelText("Current operation")).not.toHaveTextContent(
    "MB-502",
  );
  rerender(
    <WorkflowActivity
      state="prep_step3_prompt_awaiting_approval"
      progress={{
        phase: "step3_prompt_validation",
        recovery_attempt: 2,
        max_recovery_attempts: 3,
      }}
      activity={[
        {
          ...started,
          phase: "step2_advisory",
          started: 2,
          failed: 1,
          completed: 1,
        },
        { ...started, phase: "step3_prompt_validation", completed: 1 },
      ]}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Review research plan" }),
  ).toBeVisible();
  expect(screen.queryByText(/Automatic recovery/)).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText(/Research waits for your approval/)).toBeVisible();
});

it("MB-UX-QUALITY-001 L04 never invents an attempt counter when recovery metadata is absent or invalid", () => {
  const { rerender } = render(
    <WorkflowActivity
      state="prep_step2_advisory_generating"
      progress={{ phase: "step2_advisory", loop: 1 }}
    />,
  );
  expect(screen.queryByText(/Automatic recovery/)).not.toBeInTheDocument();
  rerender(
    <WorkflowActivity
      state="prep_step2_advisory_generating"
      progress={{
        phase: "step2_advisory",
        loop: 1,
        recovery_attempt: 7,
        max_recovery_attempts: 3,
      }}
    />,
  );
  expect(screen.queryByText(/Automatic recovery/)).not.toBeInTheDocument();
});
it("MB-UX-QUALITY-001 L03 retains the approval gate after recorded correction recovery", () => {
  render(
    <WorkflowActivity
      state="prep_step1_awaiting_approval"
      progress={{ phase: "step1_correction", updated_at: started.updated_at }}
      activity={[
        {
          ...started,
          phase: "step1_correction",
          started: 2,
          failed: 1,
          completed: 1,
        },
      ]}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Review English interpretation" }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Review English interpretation",
  );
  expect(
    screen.getByText("Drafting the English correction"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText("Research stopped")).not.toBeInTheDocument();
});
it("MB-UX-QUALITY-001 L03 distinguishes completed model attempts from an exhausted correction check", () => {
  const { rerender } = render(
    <WorkflowActivity
      state="prep_step1_awaiting_approval"
      progress={null}
      activity={[
        { ...started, phase: "step1_correction", started: 3, completed: 3 },
        { ...started, phase: "step1_correction_validation", failed: 1 },
      ]}
    />,
  );
  const review = screen
    .getByText("Checking correction requirements")
    .closest("li")!;
  expect(within(review).getByText("Incomplete")).toBeVisible();
  expect(within(review).queryByText("Completed")).not.toBeInTheDocument();
  expect(screen.queryByText(/1 completed · 0 started/)).not.toBeInTheDocument();
  rerender(
    <WorkflowActivity
      state="prep_step1_awaiting_approval"
      progress={null}
      activity={[
        { ...started, phase: "step1_correction", started: 2, completed: 2 },
        { ...started, phase: "step1_correction_validation", completed: 1 },
      ]}
    />,
  );
  expect(
    within(
      screen.getByText("Checking correction requirements").closest("li")!,
    ).getByText("Completed"),
  ).toBeVisible();
  expect(screen.getByText("1 completed · 1 started")).toBeVisible();
});

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

it("L15 an in-place retry remains active with readable status and retains the server message in support details", () => {
  render(
    <WorkflowActivity
      state="lane_openai_running"
      progress={{
        phase: "discovery_openai_extraction_batch",
        message: "Retrying supplier detail extraction. Attempt 2 of 3.",
      }}
      activity={[
        {
          ...started,
          phase: "discovery_openai_extraction_batch",
          started: 2,
          failed: 1,
          completed: 0,
        },
      ]}
    />,
  );
  expect(screen.getByText("Retry in progress")).toBeVisible();
  expect(screen.getByLabelText("Current operation")).toHaveTextContent(
    "OpenAI · Extracting supplier details",
  );
  expect(screen.queryByText("Stopped")).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});

it("DEV-004 keeps raw checkpoints out of live announcements and main progress copy", () => {
  render(
    <WorkflowActivity
      state="research_dispatching"
      progress={{
        phase: "discovery_openai",
        message: "MB-502 trace 123 extraction_batch started",
      }}
      activity={[{ ...started, phase: "discovery_openai" }]}
    />,
  );
  expect(screen.getByLabelText("Current operation")).not.toHaveTextContent(
    "MB-502",
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("MB-502");
  const checkpoint = screen.getByText(
    "MB-502 trace 123 extraction_batch started",
  );
  expect(checkpoint.closest("details")).not.toHaveAttribute("open");
});

it("DEV-004 legacy advisory-ready waits for plan approval without presenting active research", () => {
  render(
    <WorkflowActivity
      state="prep_step2_advisory_ready"
      progress={{ phase: "preparation", updated_at: started.updated_at }}
      activity={[{ ...started, phase: "preparation" }]}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Review research plan" }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Review research plan");
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText(/Research waits for your approval/)).toBeVisible();
  expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  expect(screen.queryByText(/No new stage update/)).not.toBeInTheDocument();
});

it("DEV-004 completed research history is secondary while active work remains visible", () => {
  const completed = { ...started, completed: 1 };
  const { rerender } = render(
    <WorkflowActivity
      state="progressive_reveal_ready"
      progress={{ phase: "progressive_reveal_ready" }}
      activity={[completed]}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Your research results are ready" }),
  ).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  const summary = screen.getByText("View completed research steps");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Completed")).not.toBeVisible();
  fireEvent.click(summary);
  expect(screen.getByText("Completed")).toBeVisible();
  rerender(
    <WorkflowActivity
      state="lane_openai_running"
      progress={{ phase: "discovery_openai" }}
      activity={[completed, { ...started, phase: "discovery_openai" }]}
    />,
  );
  expect(
    screen.queryByText("View completed research steps"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Completed")).toBeVisible();
  expect(screen.getByText("In progress")).toBeVisible();
});
