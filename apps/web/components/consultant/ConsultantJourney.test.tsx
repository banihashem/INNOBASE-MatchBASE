import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsultantHome } from "./ConsultantHome";
import { WorkflowActivity } from "./WorkflowActivity";
import type { WorkspaceSession } from "../standard/types";
const session = {
  tier: "consultant",
  display_name: "Buyer",
  email: "buyer@example.invalid",
} as WorkspaceSession;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});
describe("L07 Consultant journey", () => {
  it("names the live translation stage and keeps preparation failure separate from research", () => {
    const { rerender } = render(
      <WorkflowActivity
        state="prep_step1_interpreting"
        progress={{ phase: "step1_translation", loop: 1, max_loops: 1 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Interpreting and structuring your request in English",
    );
    expect(screen.getByText(/Keep this page open/)).toBeInTheDocument();
    rerender(
      <WorkflowActivity
        state="workflow_failed"
        progress={null}
        retryAction="prepare"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Preparation stopped" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "new research execution",
    );
  });

  it("surfaces a stopped saved request, ready report and unsubmitted draft from Home without dispatching work", async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.method).toBeUndefined();
      return new Response(
        JSON.stringify(
          url.includes("history=true")
            ? {
                items: [
                  {
                    run_id: "failed-run",
                    title: "Freight Thailand to Nigeria",
                    state: "workflow_failed",
                    mode: "live",
                    updated_at: "2026-09-07T17:19:02Z",
                    result_available: false,
                  },
                  {
                    run_id: "ready-run",
                    title: "Pumps",
                    state: "workflow_complete",
                    mode: "demonstration",
                    updated_at: "2026-09-06T10:00:00Z",
                    result_available: true,
                  },
                ],
              }
            : {
                drafts: [
                  {
                    draft_id: "unsubmitted",
                    updated_at: "2026-09-07T10:00:00Z",
                    draft_data: { productRequirement: "Valves" },
                  },
                  {
                    draft_id: "linked",
                    current_run_id: "failed-run",
                    updated_at: "2026-09-07T10:00:00Z",
                  },
                ],
              },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ConsultantHome session={session} />);
    expect(
      await screen.findByRole("link", { name: "Open saved research" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=failed-run");
    expect(
      screen.getByRole("link", { name: "View results & PDF" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=ready-run");
    expect(
      screen.getAllByRole("link", { name: "Continue draft" }),
    ).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Pumps" },
    });
    expect(
      screen.queryByRole("link", { name: "Open research" }),
    ).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("distinguishes a history retrieval failure from an empty history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    render(<ConsultantHome session={session} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Saved requests have not been deleted",
    );
    expect(
      screen.queryByText(/No research has been submitted/),
    ).not.toBeInTheDocument();
  });
  it("shows terminal failure over pending parallel work and identifies the failed round", () => {
    render(
      <WorkflowActivity
        state="workflow_failed"
        progress={{ phase: "failed", loop: 2, max_loops: 15 }}
        activity={[
          {
            phase: "discovery_gemini",
            loop: 1,
            started: 1,
            completed: 1,
            failed: 0,
            updated_at: "2026-09-07T10:00:00Z",
          },
          {
            phase: "discovery_openai",
            loop: 1,
            started: 1,
            completed: 0,
            failed: 0,
            updated_at: "2026-09-07T10:00:00Z",
          },
          {
            phase: "verification_extraction_index",
            loop: 2,
            started: 1,
            completed: 0,
            failed: 1,
            updated_at: "2026-09-07T10:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/No research is running/)).toBeInTheDocument();
    expect(screen.getByText(/Stopped at:/)).toHaveTextContent(
      "Verification round 2",
    );
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });
  it("does not invent progress when checkpoints are quiet or the connection fails", async () => {
    render(
      <WorkflowActivity
        state="verification_loop_running"
        progress={{
          phase: "verification",
          loop: 2,
          updated_at: "2020-01-01T00:00:00Z",
        }}
        connectionError="Network error"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "does not mean the research stopped",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Verification round 2",
      ),
    );
  });
});
