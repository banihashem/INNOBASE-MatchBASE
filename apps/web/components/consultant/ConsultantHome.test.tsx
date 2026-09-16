import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsultantHome } from "./ConsultantHome";
import type { WorkspaceSession } from "../standard/types";

const session = {
  tier: "consultant",
  display_name: "Buyer workspace",
  user_display_name: "Alex Buyer",
  email: "buyer@example.invalid",
  csrf_token: "test-csrf",
} as WorkspaceSession;
const record = (run_id: string, state: string, extra = {}) => ({
  run_id,
  state,
  title: `Request ${run_id}`,
  updated_at: "2026-09-09T10:00:00Z",
  result_available: false,
  mode: "live",
  ...extra,
});
function mockHistory(items: ReturnType<typeof record>[] = []) {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("profile-evidence")
            ? {
                observations: [],
                current_count: 0,
                expired_count: 0,
                fresh_discovery_required: true,
              }
            : url.includes("history=true")
              ? { items }
              : { drafts: [] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});
describe("MB-UX-DEV-004 L01 Consultant workspace scenarios", () => {
  it("prioritizes the newest awaiting request over older retained advisory-ready sessions", async () => {
    mockHistory([
      record("old-advisory", "prep_step2_advisory_ready", {
        updated_at: "2026-09-07T10:00:00Z",
      }),
      record("latest-approval", "prep_step1_awaiting_approval", {
        updated_at: "2026-09-09T10:00:00Z",
      }),
    ]);
    render(<ConsultantHome session={session} />);
    expect(
      await screen.findByRole("link", { name: "Open saved research" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=latest-approval");
    expect(screen.getByText(/Your next approval is ready/)).toBeInTheDocument();
    expect(screen.queryByText(/Research is running/)).not.toBeInTheDocument();
  });
  it("treats the newest advisory-ready session as an approval to review", async () => {
    mockHistory([
      record("older-approval", "prep_step1_awaiting_approval", {
        updated_at: "2026-09-07T10:00:00Z",
      }),
      record("latest-advisory", "prep_step2_advisory_ready", {
        updated_at: "2026-09-09T10:00:00Z",
      }),
    ]);
    render(<ConsultantHome session={session} />);
    expect(
      await screen.findByRole("link", { name: "Open saved research" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=latest-advisory");
    expect(screen.getByText(/Your next approval is ready/)).toBeInTheDocument();
    expect(screen.queryByText(/Research is running/)).not.toBeInTheDocument();
  });
  it("does not count unknown or user-stopped states as active research", async () => {
    mockHistory([
      record("unknown", "unrecognized_state"),
      record("cancelled", "verification_loop_running", {
        stopped_by_user: true,
      }),
      record("approval", "prep_step1_awaiting_approval"),
    ]);
    render(<ConsultantHome session={session} />);
    expect(
      await screen.findByRole("link", { name: "Open saved research" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=approval");
    expect(
      screen.getByRole("button", { name: "Review needed 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "In progress 0" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Open to review status")).toBeInTheDocument();
    expect(screen.getByText("Stopped by you")).toBeInTheDocument();
  });
  it("prioritizes running research with retained results over a newer stopped request", async () => {
    mockHistory([
      record("stopped-id", "workflow_failed", {
        updated_at: "2026-09-09T12:00:00Z",
      }),
      record("running-id", "verification_loop_running", {
        result_available: true,
      }),
    ]);
    render(<ConsultantHome session={session} />);
    expect(
      await screen.findByRole("link", { name: "Open saved research" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=running-id");
    expect(
      screen.getByRole("heading", { name: "Verifying suppliers" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ref /)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("finds a request outside the five dashboard rows and avoids claiming a failed load is empty", async () => {
    mockHistory(
      Array.from({ length: 7 }, (_, i) =>
        record(`id-${i}`, "workflow_complete", {
          title: i === 6 ? "Special pumps" : `Valves ${i}`,
          result_available: true,
        }),
      ),
    );
    render(<ConsultantHome session={session} />);
    await screen.findByText("Valves 0");
    expect(screen.queryByText("Special pumps")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Special" },
    });
    expect(screen.getByText("Special pumps")).toBeInTheDocument();
  });
  it("loads profile summaries once and sends the session protection headers when signing out", async () => {
    vi.useFakeTimers();
    const fetcher = mockHistory();
    render(<ConsultantHome session={session} initialView="profile" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Alex Buyer")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockImplementationOnce(
      async () => new Response("", { status: 503 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      "/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": "test-csrf",
          "idempotency-key": expect.any(String),
        },
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session is still open",
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
  it("pauses while the page is hidden and refreshes on return without overlapping requests", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    const fetcher = mockHistory();
    render(<ConsultantHome session={session} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45000);
    });
    expect(fetcher).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retains loaded rows after a refresh failure and restores them through an explicit retry", async () => {
    const fetcher = mockHistory([
      record("saved-id", "workflow_complete", {
        title: "Stored supplier research",
        result_available: true,
      }),
    ]);
    render(<ConsultantHome session={session} />);
    await screen.findByText("Stored supplier research");
    fetcher.mockImplementation(async () => new Response("", { status: 503 }));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Previously loaded records remain below",
    );
    expect(screen.getByText("Stored supplier research")).toBeInTheDocument();
    fetcher.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("history=true")
              ? {
                  items: [
                    record("saved-id", "workflow_complete", {
                      title: "Stored supplier research",
                      result_available: true,
                    }),
                  ],
                }
              : { drafts: [] },
          ),
        ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading history" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});

describe("MB-UX-SIMPLIFY-001 L01 finding and returning to saved work", () => {
  it("filters retained results after a later failure without presenting the failed round as complete", async () => {
    mockHistory([
      record("partial", "workflow_failed", {
        title: "Saved pumps",
        result_available: true,
      }),
      record("empty-failure", "workflow_failed", { title: "Stopped valves" }),
      record("awaiting", "prep_step1_awaiting_approval"),
      record("working", "verification_loop_running", {
        result_available: true,
      }),
      record("ready", "workflow_complete", { result_available: true }),
    ]);
    render(<ConsultantHome session={session} />);
    await screen.findByRole("button", { name: "All requests 5" });
    fireEvent.click(screen.getByRole("button", { name: "With results 3" }));
    const list = within(screen.getByRole("list", { name: "Saved research" }));
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(
      list.getByText("Saved results · Latest round stopped"),
    ).toBeInTheDocument();
    expect(list.queryByText("Stopped valves")).not.toBeInTheDocument();
    expect(list.getByText("Saved pumps").closest("li")).toHaveTextContent(
      "View results & PDF",
    );
    expect(
      screen.getByRole("button", { name: "With results 3" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Review needed 3" }));
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(list.getByText("Saved pumps")).toBeInTheDocument();
    expect(list.getByText("Stopped valves")).toBeInTheDocument();
    expect(list.queryByText("Request working")).not.toBeInTheDocument();
  });

  it("keeps status totals stable during search and clears the query and filter together", async () => {
    const fetcher = mockHistory([
      record("pumps", "workflow_complete", {
        title: "Industrial pumps",
        result_available: true,
      }),
      record("valves", "workflow_complete", {
        title: "Control valves",
        result_available: true,
      }),
      record("awaiting", "prep_step1_awaiting_approval", {
        title: "New motors",
      }),
    ]);
    render(<ConsultantHome session={session} />);
    await screen.findByText("Industrial pumps");
    fireEvent.click(screen.getByRole("button", { name: "With results 2" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "  PUMPS  industrial " },
    });
    const list = within(screen.getByRole("list", { name: "Saved research" }));
    expect(list.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "With results 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All requests 3" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "unmatched" },
    });
    expect(
      screen.getByRole("heading", { name: "No matching requests" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "All requests 3" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(list.getAllByRole("listitem")).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("searches the complete request text and reveals additional rows without leaving the workspace", async () => {
    const completeTitle = `${"Detailed buying requirements ".repeat(12)}Distinctive final specification`;
    mockHistory(
      Array.from({ length: 7 }, (_, i) =>
        record(`id-${i}`, "workflow_complete", {
          title: i === 6 ? completeTitle : `Request ${i}`,
          result_available: true,
        }),
      ),
    );
    render(<ConsultantHome session={session} />);
    await screen.findByRole("button", { name: "Show all 7 saved requests" });
    expect(
      within(screen.getByRole("list", { name: "Saved research" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(5);
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 7 saved requests" }),
    );
    expect(
      within(screen.getByRole("list", { name: "Saved research" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(7);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "final specification" },
    });
    expect(
      screen.getByRole("heading", { name: completeTitle }),
    ).toHaveAttribute("title", completeTitle);
    expect(
      screen.getByRole("link", { name: "View results & PDF" }),
    ).toHaveAttribute("href", "/consultant/workflow?run_id=id-6");
  });

  it("finds an older draft by its full text and keeps submitted drafts out of the draft list", async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("history=true")
              ? {
                  items: [
                    record("submitted", "workflow_complete", {
                      title: "Pumps",
                      result_available: true,
                    }),
                  ],
                }
              : {
                  drafts: [
                    {
                      draft_id: "linked",
                      current_run_id: "submitted",
                      updated_at: "2026-09-10T10:00:00Z",
                      draft_data: { productRequirement: "Linked request" },
                    },
                    ...Array.from({ length: 7 }, (_, i) => ({
                      draft_id: `draft-${i}`,
                      updated_at: `2026-09-0${9 - i}T10:00:00Z`,
                      draft_data: {
                        productRequirement:
                          i === 6
                            ? "Special nitrogen equipment"
                            : `Draft valves ${i}`,
                      },
                    })),
                  ],
                },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<ConsultantHome session={session} />);
    await screen.findByRole("button", { name: "Drafts 7" });
    expect(
      screen.queryByText("Special nitrogen equipment"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nitrogen" },
    });
    expect(screen.getByText("Special nitrogen equipment")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue draft" }),
    ).toHaveAttribute("href", "/consultant/workflow?draft_id=draft-6");
    fireEvent.click(screen.getByRole("button", { name: "Drafts 7" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 matching draft");
    expect(screen.queryByText("Linked request")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No matching requests" }),
    ).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("makes a saved draft the primary next action and keeps research guidance collapsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes("history=true")
                ? { items: [] }
                : {
                    drafts: [
                      {
                        draft_id: "draft-one",
                        updated_at: "2026-09-09T10:00:00Z",
                        draft_data: {
                          productRequirement: "Unsubmitted valves",
                        },
                      },
                    ],
                  },
            ),
          ),
      ),
    );
    render(<ConsultantHome session={session} />);
    const resume = await screen.findByRole("link", {
      name: "Open saved draft",
    });
    expect(resume).toHaveClass("cx-button-primary");
    expect(screen.getByRole("link", { name: "+ New research" })).toHaveClass(
      "cx-button-secondary",
    );
    expect(document.querySelectorAll("a.cx-button-primary")).toHaveLength(1);
    expect(
      screen.getByText("How Consultant research works").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });

  it("does not show zero counts or empty findings while saved work is still loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<ConsultantHome session={session} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your saved research",
    );
    expect(
      screen.getByRole("button", { name: "All requests Not loaded" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "Start your first research" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No unsubmitted drafts."),
    ).not.toBeInTheDocument();
  });
});
