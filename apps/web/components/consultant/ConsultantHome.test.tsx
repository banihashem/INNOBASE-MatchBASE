import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
          url.includes("history=true") ? { items } : { drafts: [] },
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
      screen.getByRole("link", { name: "1 In progress or awaiting review" }),
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
    expect(fetcher).toHaveBeenCalledTimes(2);
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
