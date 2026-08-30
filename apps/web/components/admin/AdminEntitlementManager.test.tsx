import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { AdminEntitlementManager } from "./AdminEntitlementManager";

const subjectUserId = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const session = {
  tier: "admin",
  admin_sub_roles: ["super_admin"],
  csrf_token: "fixture-csrf-token",
};
const successBody = {
  action: "grant",
  subject_user_id: subjectUserId,
  entitlement_kind: "tier",
  entitlement_value: "admin",
  expires_at: null,
  changed: true,
  before: { tier: "standard", admin_sub_roles: [] },
  after: { tier: "admin", admin_sub_roles: [] },
  audit_id: "fd8a7a68-3081-4f07-89f7-448c1b9b32f9",
};
const readBody = {
  subject_user_id: subjectUserId,
  current: { tier: "standard", admin_sub_roles: ["analyst"] },
  history: [
    {
      kind: "admin_sub_role",
      value: "analyst",
      effective_from: "2026-08-25T08:00:00.000Z",
      effective_to: null,
      revoked_at: null,
      grant_actor_kind: "user",
      granted_by: "a60b4f90-13f7-42d9-9f09-7f405a026869",
      revoked_by: null,
      justification: "Initial analyst access.",
    },
  ],
};
const axeOptions = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
  rules: { "color-contrast": { enabled: false } },
};

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  mutation: (init: RequestInit) => Promise<Response> = async () =>
    response(successBody),
  read: (init: RequestInit) => Promise<Response> = async () =>
    response(readBody),
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input) === "/api/v1/me") return response(session);
      if (init.method !== "POST") return read(init);
      return mutation(init);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fillAndReview() {
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Current stored entitlements" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Exact value"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Required reason"), {
    target: { value: "Approved role transition." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review exact change" }));
  expect(
    await screen.findByRole("heading", { name: "Review exact change" }),
  ).toBeVisible();
}

function postCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

test("denies the visual write surface without the exact super-admin authority", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({
        tier: "admin",
        admin_sub_roles: ["security_audit"],
        csrf_token: "fixture-csrf-token",
      }),
    ),
  );
  render(<AdminEntitlementManager />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "requires the Admin tier and the exact super_admin sub-role",
  );
  expect(
    screen.queryByRole("button", { name: "Review exact change" }),
  ).not.toBeInTheDocument();
});

test("associates validation errors and focuses the first invalid field", async () => {
  installFetch();
  render(<AdminEntitlementManager />);
  const review = await screen.findByRole("button", {
    name: "Review exact change",
  });
  fireEvent.click(review);
  const subject = screen.getByLabelText("Subject user UUID");
  await waitFor(() => expect(subject).toHaveFocus());
  expect(subject).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("link", {
      name: "Subject user UUID: Enter a valid subject user UUID.",
    }),
  ).toHaveAttribute("href", "#entitlement-subject");
  expect(
    screen.getByRole("link", {
      name: /Required reason: Enter 1–2,000 characters/,
    }),
  ).toHaveAttribute("href", "#entitlement-justification");
  expect(screen.getByLabelText("Required reason")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("requires inline review and restates the exact change immediately before confirmation", async () => {
  installFetch();
  render(<AdminEntitlementManager />);
  await fillAndReview();
  const confirm = screen.getByRole("button", { name: "Confirm exact change" });
  const confirmation = confirm.parentElement?.previousElementSibling;
  expect(confirmation).toHaveTextContent(
    `Grant tier “admin” to subject ${subjectUserId}.`,
  );
  expect(confirmation).toHaveTextContent("Reason: Approved role transition.");
  expect(
    screen.getByRole("link", { name: "Skip to entitlement control" }),
  ).toHaveAttribute("href", "#admin-entitlement-main");
});

test("posts the closed body with CSRF and idempotency headers, then renders audit evidence", async () => {
  const fetchMock = installFetch();
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));

  expect(
    await screen.findByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
  const [, init] = postCalls(fetchMock)[0] ?? [];
  const headers = new Headers(init?.headers);
  expect(headers.get("X-CSRF-Token")).toBe("fixture-csrf-token");
  expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/u);
  expect(JSON.parse(String(init?.body))).toEqual({
    action: "grant",
    subject_user_id: subjectUserId,
    entitlement_kind: "tier",
    entitlement_value: "admin",
    justification: "Approved role transition.",
  });
  expect(screen.getAllByText("standard").length).toBeGreaterThan(0);
  expect(
    screen.getByText("fd8a7a68-3081-4f07-89f7-448c1b9b32f9"),
  ).toBeVisible();
});

test("requires and restates the exact RFC3339 expiry for a Consultant grant", async () => {
  const expiresAt = "2099-12-31T23:59:59Z";
  const consultantSuccess = {
    ...successBody,
    entitlement_value: "consultant",
    expires_at: expiresAt,
    after: {
      tier: "consultant",
      admin_sub_roles: [],
      tier_expires_at: expiresAt,
    },
  };
  const fetchMock = installFetch(async () => response(consultantSuccess));
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  await screen.findByRole("heading", { name: "Current stored entitlements" });
  fireEvent.change(screen.getByLabelText("Exact value"), {
    target: { value: "consultant" },
  });
  const expiry = screen.getByLabelText("Consultant expiry (RFC3339)");
  fireEvent.change(screen.getByLabelText("Required reason"), {
    target: { value: "Approved bounded Consultant access." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review exact change" }));
  await waitFor(() => expect(expiry).toHaveFocus());
  expect(expiry).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("link", {
      name: /Consultant expiry: Enter a valid RFC3339 timestamp/,
    }),
  ).toHaveAttribute("href", "#entitlement-expiry");

  fireEvent.change(expiry, { target: { value: "2099-02-30T23:59:59Z" } });
  fireEvent.click(screen.getByRole("button", { name: "Review exact change" }));
  await waitFor(() => expect(expiry).toHaveFocus());
  expect(expiry).toHaveAttribute("aria-invalid", "true");

  fireEvent.change(expiry, { target: { value: expiresAt } });
  fireEvent.click(screen.getByRole("button", { name: "Review exact change" }));
  expect(
    await screen.findByRole("heading", { name: "Review exact change" }),
  ).toBeVisible();
  expect(screen.getAllByText(expiresAt)).toHaveLength(2);
  expect(screen.getByText(/Expires exactly at/)).toHaveTextContent(expiresAt);
  expect(
    document.querySelector(`time[datetime="${expiresAt}"]`),
  ).toHaveTextContent("31 Dec 2099, 23:59:59 UTC");

  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  expect(
    await screen.findByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
  const [, init] = postCalls(fetchMock)[0] ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({
    action: "grant",
    subject_user_id: subjectUserId,
    entitlement_kind: "tier",
    entitlement_value: "consultant",
    justification: "Approved bounded Consultant access.",
    expires_at: expiresAt,
  });
  expect(screen.getByText("Requested expiry:").parentElement).toHaveTextContent(
    "31 Dec 2099, 23:59:59 UTC",
  );
});

test("renders a generic 403 without disclosing server subject detail", async () => {
  installFetch(async () =>
    response(
      {
        error: {
          detail: "The subject is not visible.",
          correlation_id: "correlation-403",
        },
      },
      403,
    ),
  );
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "The server refused this entitlement change.",
  );
  expect(alert).not.toHaveTextContent("subject is not visible");
  expect(alert).toHaveTextContent("correlation-403");
});

test("shows a 422 detail without leaving review", async () => {
  installFetch(async () =>
    response({ error: { detail: "Admin tier is required first." } }, 422),
  );
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Admin tier is required first.",
  );
  expect(
    screen.getByRole("heading", { name: "Review exact change" }),
  ).toBeVisible();
});

test("retries a 503 with the same idempotency key for the unchanged reviewed request", async () => {
  let attempt = 0;
  const mutation = vi.fn(async () => {
    attempt += 1;
    return attempt === 1
      ? response({ error: { detail: "Audit storage unavailable." } }, 503)
      : response(successBody);
  });
  const fetchMock = installFetch(mutation);
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Audit storage unavailable.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry exact change" }));
  expect(
    await screen.findByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
  const firstHeaders = new Headers(postCalls(fetchMock)[0]?.[1]?.headers);
  const retryHeaders = new Headers(postCalls(fetchMock)[1]?.[1]?.headers);
  expect(retryHeaders.get("Idempotency-Key")).toBe(
    firstHeaders.get("Idempotency-Key"),
  );
});

test("invalidates the idempotency key after returning to edit and reviewing changed input", async () => {
  let attempt = 0;
  const fetchMock = installFetch(async () => {
    attempt += 1;
    return attempt === 1
      ? response({ error: { detail: "Audit storage unavailable." } }, 503)
      : response(successBody);
  });
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
  fireEvent.change(screen.getByLabelText("Required reason"), {
    target: { value: "Updated approval reason." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review exact change" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm exact change" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
  const firstHeaders = new Headers(postCalls(fetchMock)[0]?.[1]?.headers);
  const editedHeaders = new Headers(postCalls(fetchMock)[1]?.[1]?.headers);
  expect(editedHeaders.get("Idempotency-Key")).not.toBe(
    firstHeaders.get("Idempotency-Key"),
  );
});

test("surfaces a network failure and keeps an operable retry control", async () => {
  installFetch(async () => {
    throw new TypeError("Network connection failed.");
  });
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Network connection failed.",
  );
  expect(
    screen.getByRole("button", { name: "Retry exact change" }),
  ).toBeEnabled();
});

test("blocks review until current entitlements and history are loaded", async () => {
  installFetch();
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.change(screen.getByLabelText("Required reason"), {
    target: { value: "Approved role transition." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review exact change" }));
  const load = screen.getByRole("button", {
    name: "Load current and history",
  });
  await waitFor(() => expect(load).toHaveFocus());
  expect(
    screen.getByRole("link", {
      name: /Subject state: Load current entitlements and history before review/,
    }),
  ).toHaveAttribute("href", "#entitlement-load");
  expect(
    screen.queryByRole("button", { name: "Confirm exact change" }),
  ).not.toBeInTheDocument();
});

test("renders the current snapshot and the real entitlement history table", async () => {
  installFetch();
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Current stored entitlements" }),
  ).toBeVisible();
  const table = screen.getByRole("table", {
    name: `Entitlement history for subject ${subjectUserId}`,
  });
  expect(table).toHaveTextContent("admin_sub_role");
  expect(table).toHaveTextContent("Initial analyst access.");
  expect(table).toHaveTextContent("25 Aug 2026, 08:00:00 UTC");
  expect(table).not.toHaveTextContent("2026-08-25T08:00:00.000Z");
  expect(table.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-08-25T08:00:00.000Z",
  );
  expect(screen.getByText("analyst", { selector: "dd" })).toBeVisible();
});

test("attributes a system grant explicitly instead of rendering a blank actor", async () => {
  installFetch(
    async () => response(successBody),
    async () =>
      response({
        ...readBody,
        history: [
          {
            ...readBody.history[0],
            kind: "tier",
            value: "demo",
            grant_actor_kind: "system",
            granted_by: null,
          },
        ],
      }),
  );
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("System");
  expect(table.querySelector("tbody td:nth-child(6)")).toHaveTextContent(
    "System",
  );
});

test("renders a generic read 403 without backend subject detail", async () => {
  installFetch(
    async () => response(successBody),
    async () =>
      response(
        {
          error: {
            detail: "The subject is not visible.",
            correlation_id: "read-correlation-403",
          },
        },
        403,
      ),
  );
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "The server refused access to this entitlement subject.",
  );
  expect(alert).not.toHaveTextContent("subject is not visible");
  expect(alert).toHaveTextContent("read-correlation-403");
});

test("retries a failed 503 read and recovers the current history", async () => {
  let attempt = 0;
  installFetch(
    async () => response(successBody),
    async () => {
      attempt += 1;
      return attempt === 1
        ? response({ error: { detail: "Read store unavailable." } }, 503)
        : response(readBody);
    },
  );
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Read store unavailable.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry current and history" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Current stored entitlements" }),
  ).toBeVisible();
});

test("surfaces a network read failure with an operable retry", async () => {
  installFetch(
    async () => response(successBody),
    async () => {
      throw new TypeError("History network failed.");
    },
  );
  render(<AdminEntitlementManager />);
  fireEvent.change(await screen.findByLabelText("Subject user UUID"), {
    target: { value: subjectUserId },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load current and history" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "History network failed.",
  );
  expect(
    screen.getByRole("button", { name: "Retry current and history" }),
  ).toBeEnabled();
});

test("refreshes the current snapshot and history after a successful mutation", async () => {
  let readAttempt = 0;
  const read = vi.fn(async () => {
    readAttempt += 1;
    return response(
      readAttempt === 1
        ? readBody
        : {
            ...readBody,
            current: { tier: "admin", admin_sub_roles: ["product"] },
            history: [
              ...readBody.history,
              {
                ...readBody.history[0],
                kind: "tier",
                value: "admin",
                effective_from: "2026-08-25T09:00:00.000Z",
                justification: "Post-change grant.",
              },
            ],
          },
    );
  });
  installFetch(async () => response(successBody), read);
  render(<AdminEntitlementManager />);
  await fillAndReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exact change" }));
  expect(await screen.findByText("Post-change grant.")).toBeVisible();
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.getByText("product", { selector: "dd" })).toBeVisible();
});

test("has no automated WCAG A/AA violations in the authorized edit state", async () => {
  installFetch();
  const { container } = render(<AdminEntitlementManager />);
  expect(
    await screen.findByRole("button", { name: "Review exact change" }),
  ).toBeVisible();
  expect(
    screen.getByText(/Budget controls, suspension, and restoration/),
  ).toBeVisible();
  expect((await axe.run(container, axeOptions)).violations).toEqual([]);
});
