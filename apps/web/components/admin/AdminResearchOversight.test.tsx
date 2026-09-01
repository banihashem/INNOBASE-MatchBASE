import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { AdminResearchOversight } from "./AdminResearchOversight";

afterEach(() => vi.unstubAllGlobals());

const axeOptions = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
  rules: { "color-contrast": { enabled: false } },
};

test("shows bounded tenant research and requires a purpose for full result access", async () => {
  const runId = "00000000-0000-4000-8000-000000000001";
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me")
        return Response.json({
          tier: "admin",
          admin_sub_roles: ["super_admin"],
          csrf_token: "test-csrf",
        });
      if (url.startsWith("/api/v1/admin/research?"))
        return Response.json({
          schema_version: "admin-research-inventory.v1",
          items: [
            {
              account_id: "00000000-0000-4000-8000-000000000004",
              run_id: runId,
              request_id: "00000000-0000-4000-8000-000000000002",
              requester: {
                user_id: "00000000-0000-4000-8000-000000000003",
                display_name: "Test user",
              },
              request_summary: "product_need: Industrial pump",
              tier_at_submission: "consultant",
              research_mode: "qualified_live_research",
              state: "complete",
              queued_at: "2026-08-31T10:00:00.000Z",
              updated_at: "2026-08-31T10:05:00.000Z",
              outcome: "matched",
              eligible_count: 2,
              considered_count: 8,
              result_available: true,
            },
          ],
          page: { limit: 20, has_more: false, next_cursor: null },
          privacy_boundary: {
            source_text_released: false,
            email_released: false,
            complete_result_released: false,
          },
        });
      if (url === "/api/v1/admin/unprojected-result") {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-CSRF-Token")).toBe("test-csrf");
        expect(headers.get("Idempotency-Key")).toMatch(/^admin-result-/u);
        return Response.json({ run_id: runId, outcome: "matched" });
      }
      return new Response(null, { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<AdminResearchOversight />);

  expect(
    await screen.findByRole("heading", { name: "All user research" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Inventory purpose"), {
    target: { value: "Investigate system-wide research operations" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByText("Test user")).toBeVisible();
  expect(screen.queryByText(/@/u)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open complete result" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /operational purpose/iu,
  );
  fireEvent.change(screen.getByLabelText("Operational justification"), {
    target: {
      value: "Investigate a failed customer-visible result projection",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open complete result" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/unprojected-result",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByText(/Audited complete result/iu)).toBeVisible();
  expect((await axe.run(document, axeOptions)).violations).toEqual([]);
});

test("fails closed for Admin without stored Super-admin projection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ tier: "admin", admin_sub_roles: ["support"] }),
    ),
  );
  render(<AdminResearchOversight />);
  expect(
    await screen.findByRole("heading", {
      name: "Research inventory unavailable",
    }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(/Super-admin/iu);
});

test("labels a terminal failed run without releasing a raw provider reason", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me")
        return Response.json({
          tier: "admin",
          admin_sub_roles: ["super_admin"],
          csrf_token: "test-csrf",
        });
      return Response.json({
        schema_version: "admin-research-inventory.v1",
        items: [
          {
            account_id: "00000000-0000-4000-8000-000000000004",
            run_id: "00000000-0000-4000-8000-000000000001",
            request_id: "00000000-0000-4000-8000-000000000002",
            requester: {
              user_id: "00000000-0000-4000-8000-000000000003",
              display_name: "Test user",
            },
            request_summary: "product_need: Industrial pump",
            tier_at_submission: "consultant",
            research_mode: "qualified_live_research",
            state: "failed",
            queued_at: "2026-09-01T01:00:00.000Z",
            updated_at: "2026-09-01T01:01:00.000Z",
            outcome: "failed",
            eligible_count: null,
            considered_count: null,
            result_available: false,
          },
        ],
        page: { limit: 20, has_more: false, next_cursor: null },
        privacy_boundary: {
          source_text_released: false,
          email_released: false,
          complete_result_released: false,
        },
      });
    }),
  );
  render(<AdminResearchOversight />);
  await screen.findByRole("heading", { name: "All user research" });
  fireEvent.change(screen.getByLabelText("Inventory purpose"), {
    target: { value: "Inspect terminal failed research" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(
    await screen.findByText("Research failed — no result was generated"),
  ).toBeVisible();
  expect(
    screen.queryByText(/source_discovery_failed/iu),
  ).not.toBeInTheDocument();
});
