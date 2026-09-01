import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { UserProfile } from "./UserProfile";

afterEach(() => vi.restoreAllMocks());

const history = {
  schema_version: "user-profile-history.v1",
  current_tier: "consultant",
  requests: [
    {
      request_id: "11111111-1111-4111-8111-111111111111",
      canonical_request_version: 1,
      canonical_summary: "Three containers of pistachios routed through Dubai",
      lifecycle_state: "confirmed",
      created_at: "2026-08-31T10:00:00.000Z",
      updated_at: "2026-08-31T10:01:00.000Z",
      run_count: 1,
    },
  ],
  runs: [
    {
      run_id: "22222222-2222-4222-8222-222222222222",
      request_id: "11111111-1111-4111-8111-111111111111",
      canonical_request_version: 1,
      submitted_tier: "demo",
      state: "failed",
      outcome: "failed",
      queued_at: "2026-08-31T10:02:00.000Z",
      updated_at: "2026-08-31T10:03:00.000Z",
      result_available: false,
      result_projection: null,
      links: {
        request: "/api/v1/requests/11111111-1111-4111-8111-111111111111",
        run: "/api/v1/runs/22222222-2222-4222-8222-222222222222",
        result: null,
      },
    },
  ],
  page: { limit: 50, has_more: false, next_cursor: null },
};

test("renders owner canonical and failed-run history", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(history), { status: 200 }),
  );
  render(<UserProfile tier="consultant" displayName="Owner" />);
  expect(
    await screen.findByText(
      "Three containers of pistachios routed through Dubai",
    ),
  ).toBeVisible();
  expect(screen.getByText("failed")).toBeVisible();
  expect(
    screen.getByText("Research failed — no result was generated"),
  ).toBeVisible();
  expect(screen.queryByText("Not available")).not.toBeInTheDocument();
});

test("refuses history whose current entitlement does not match the workspace", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ...history, current_tier: "demo" }), {
      status: 200,
    }),
  );
  render(<UserProfile tier="consultant" displayName="Owner" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "profile history could not be loaded",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
});
