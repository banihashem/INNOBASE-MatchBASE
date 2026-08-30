import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { AdminGovernanceQueue } from "./AdminGovernanceQueue";

const runId = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const session = { tier: "admin", admin_sub_roles: ["support"] };
const items = [
  {
    run_id: runId,
    governance_state: "Review Required",
    reason_code: "reason_unavailable",
    raised_at: "2026-08-25T07:00:00.000Z",
    run_state: "escalated",
    human_action_required: true,
    automated_path_blocked: true,
  },
  {
    run_id: "0c367b27-72ef-424a-abf4-d5a7ba51bd3a",
    governance_state: "Escalated to Human",
    reason_code: "hidden-provider-detail",
    raised_at: "2026-08-25T06:00:00.000Z",
    run_state: "escalated",
    human_action_required: true,
    automated_path_blocked: true,
  },
  {
    run_id: "ed11828a-594e-41f9-aede-85fd4beb1ef8",
    governance_state: "Output Restricted",
    reason_code: "reason_unavailable",
    raised_at: "2026-08-25T05:00:00.000Z",
    run_state: "restricted",
    human_action_required: true,
    automated_path_blocked: true,
  },
  {
    run_id: "1b17c0de-e610-45ad-83f6-4efb4817f9b3",
    governance_state: "Evaluation Failed",
    reason_code: "reason_unavailable",
    raised_at: "2026-08-25T04:00:00.000Z",
    run_state: "failed",
    human_action_required: true,
    automated_path_blocked: true,
  },
] as const;

function body(
  pageItems: readonly unknown[] = items,
  nextCursor: string | null = null,
) {
  return {
    items: pageItems,
    page: {
      next_cursor: nextCursor,
      has_more: Boolean(nextCursor),
      limit: 20,
    },
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

function installFetch({
  sessionBody = session,
  sessionStatus = 200,
  runs = async () => response(body()),
}: {
  sessionBody?: unknown;
  sessionStatus?: number;
  runs?: (url: string) => Promise<Response>;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return url === "/api/v1/me"
      ? response(sessionBody, sessionStatus)
      : runs(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test.each(["support", "analyst", "super_admin"])(
  "admits the exact stored Admin + %s read boundary",
  async (role) => {
    installFetch({ sessionBody: { tier: "admin", admin_sub_roles: [role] } });
    render(<AdminGovernanceQueue />);
    expect(
      await screen.findByRole("heading", { name: "Governance queue" }),
    ).toBeVisible();
  },
);

test("admits an allowed stored role even when consultant_manager is also present", async () => {
  installFetch({
    sessionBody: {
      tier: "admin",
      admin_sub_roles: ["support", "consultant_manager"],
    },
  });
  render(<AdminGovernanceQueue />);
  expect(
    await screen.findByRole("heading", { name: "Governance queue" }),
  ).toBeVisible();
});

test.each([
  { tier: "consultant", admin_sub_roles: ["support"] },
  { tier: "admin", admin_sub_roles: ["consultant_manager"] },
  { tier: "admin", admin_sub_roles: ["security_audit"] },
])(
  "denies an unauthorized session without exposing the queue",
  async (sessionBody) => {
    installFetch({ sessionBody });
    render(<AdminGovernanceQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Consultant manager alone does not grant access",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  },
);

test("renders all four exact states, safe reasons, blocking status, native time, and run navigation", async () => {
  installFetch();
  render(<AdminGovernanceQueue />);
  const table = await screen.findByRole("table", {
    name: "Governance state projection for requests and runs",
  });
  for (const state of [
    "Review Required",
    "Escalated to Human",
    "Output Restricted",
    "Evaluation Failed",
  ]) {
    expect(screen.getByText(state, { selector: "span" })).toBeVisible();
  }
  expect(table).toHaveTextContent("Reason unavailable by policy");
  expect(table).toHaveTextContent("Governance reason recorded");
  expect(table).not.toHaveTextContent("hidden-provider-detail");
  expect(table).toHaveTextContent("Blocked");
  expect(table).toHaveTextContent("Required");
  const raised = table.querySelector("time");
  expect(raised).toHaveAttribute("datetime", "2026-08-25T07:00:00.000Z");
  expect(raised).not.toHaveTextContent("2026-08-25T07:00:00.000Z");
  expect(
    screen.getByRole("link", { name: `Open run ${runId}` }),
  ).toHaveAttribute("href", `/runs/${runId}`);
  for (const action of [
    "Re-queue run",
    "Cancel run",
    "Assign reviewer",
    "Clear governance state",
  ]) {
    expect(
      screen.queryByRole("button", { name: action }),
    ).not.toBeInTheDocument();
  }
  expect(
    screen.getByText(
      /Reviewer assignment policy and clear actions are not delivered/u,
    ),
  ).toBeVisible();
});

test("sends only the closed backend filter vocabulary and resets cursor", async () => {
  const fetchMock = installFetch();
  render(<AdminGovernanceQueue />);
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("Governance state"), {
    target: { value: "Output Restricted" },
  });
  fireEvent.change(screen.getByLabelText("Run state"), {
    target: { value: "restricted" },
  });
  fireEvent.change(screen.getByLabelText("Failure class"), {
    target: { value: "timeout" },
  });
  fireEvent.change(screen.getByLabelText("Rows per page"), {
    target: { value: "50" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/runs?limit=50&governance_state=Output+Restricted&run_state=restricted&failure_class=timeout",
      expect.anything(),
    );
  });
});

test("distinguishes empty and filtered-empty states", async () => {
  installFetch({ runs: async () => response(body([])) });
  render(<AdminGovernanceQueue />);
  expect(
    await screen.findByText("No governance runs require operator attention."),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Governance state"), {
    target: { value: "Evaluation Failed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(
    await screen.findByText("No governance runs match the applied filters."),
  ).toBeVisible();
});

test("uses opaque cursors for next and previous page navigation", async () => {
  const urls: string[] = [];
  installFetch({
    runs: async (url) => {
      urls.push(url);
      return response(
        url.includes("cursor=sealed-next")
          ? body([])
          : body(items, "sealed-next"),
      );
    },
  });
  render(<AdminGovernanceQueue />);
  const next = await screen.findByRole("button", { name: "Next page" });
  fireEvent.click(next);
  expect(await screen.findByText("Page 2")).toBeVisible();
  expect(urls.at(-1)).toBe("/api/v1/admin/runs?limit=20&cursor=sealed-next");
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  await waitFor(() => expect(urls.at(-1)).toBe("/api/v1/admin/runs?limit=20"));
});

test("keeps session and queue failures generic and retryable", async () => {
  let sessionCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/v1/me") {
      sessionCalls += 1;
      return sessionCalls === 1
        ? response({ error: { detail: "secret session detail" } }, 503)
        : response(session);
    }
    return response({ error: { detail: "secret queue detail" } }, 403);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AdminGovernanceQueue />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Operator access could not be verified.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  fireEvent.click(screen.getByRole("button", { name: "Retry session check" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The governance queue is not visible to this session.",
  );
  expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  expect(screen.getByRole("button", { name: "Retry queue" })).toBeEnabled();
});

test("has no detectable WCAG A/AA violations in the populated state", async () => {
  installFetch();
  const { container } = render(<AdminGovernanceQueue />);
  await screen.findByRole("table");
  const report = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
    rules: { "color-contrast": { enabled: false } },
  });
  expect(report.violations).toEqual([]);
});
