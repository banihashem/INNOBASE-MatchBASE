import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsultantWorkflowPage from "../../app/consultant/workflow/page";

const firstMessage =
  "Loaded Example A: Brazilian Poultry for Saudi Arabia (Frozen Whole & Cuts)";
const secondMessage =
  "Loaded Example B: Commercial Electric Water Heaters for UAE (500L, 10 Bar)";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(
    {},
    "",
    "/consultant/workflow?draft_id=toast-draft",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/me") {
        return Response.json({
          subject: { account_id: "account-a", user_id: "user-a" },
          tier: "consultant",
        });
      }
      if (init?.method === "POST") {
        return Response.json({ success: true, draft_version: 2 });
      }
      return Response.json({
        draft: {
          draft_id: "toast-draft",
          draft_version: 1,
          draft_data: { industry: "general" },
        },
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openDraft() {
  const page = render(<ConsultantWorkflowPage />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "A: Brazilian Poultry" }),
    ).toBeEnabled(),
  );
  vi.useFakeTimers();
  return page;
}

describe("MB-UX-QUALITY-003 L01 workflow toast lifecycle", () => {
  it("keeps a replacement toast for its own four seconds, then dismisses it", async () => {
    await openDraft();
    fireEvent.click(
      screen.getByRole("button", { name: "A: Brazilian Poultry" }),
    );
    expect(
      screen.getByText(firstMessage).closest('[role="status"]'),
    ).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "B: UAE Water Heaters" }),
    );
    expect(
      screen.getByText(secondMessage).closest('[role="status"]'),
    ).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      screen.getByText(secondMessage).closest('[role="status"]'),
    ).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(
      screen.getByText(secondMessage).closest('[role="status"]'),
    ).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText(secondMessage)).toBeNull();
  });

  it("cancels the pending toast callback when the workflow unmounts", async () => {
    const page = await openDraft();
    fireEvent.click(
      screen.getByRole("button", { name: "A: Brazilian Poultry" }),
    );
    expect(
      screen.getByText(firstMessage).closest('[role="status"]'),
    ).toBeVisible();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    page.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
