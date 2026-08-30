import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { expectAccessibleState } from "./accessibility-matrix.mjs";

const subjectUserId = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const sessionBody = {
  tier: "admin",
  admin_sub_roles: ["super_admin"],
  csrf_token: "browser-admin-csrf-token",
};
const entitlementReadBody = {
  subject_user_id: subjectUserId,
  current: {
    tier: "standard",
    admin_sub_roles: [],
    tier_expires_at: null,
  },
  history: [
    {
      kind: "tier",
      value: "standard",
      effective_from: "2026-08-25T07:00:00.000Z",
      effective_to: null,
      revoked_at: null,
      grant_actor_kind: "user",
      granted_by: "448cb2e7-dbc9-45f6-8eeb-4e78f027cf84",
      revoked_by: null,
      justification: "Approved browser acceptance fixture",
    },
  ],
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function routeSession(page, body = sessionBody, status = 200) {
  await page.route("**/api/v1/me", (route) => json(route, body, status));
}

async function openAuthorizedSurface(page) {
  await page.goto("/admin/entitlements");
  await expect(page).toHaveTitle("Entitlements — MatchBASE Admin");
  await expect(
    page.getByRole("heading", { name: "Admin entitlement change" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review exact change" }),
  ).toBeVisible();
}

async function loadSubject(page) {
  await page.getByLabel("Subject user UUID").fill(subjectUserId);
  await page.getByRole("button", { name: "Load current and history" }).click();
  await expect(
    page.getByRole("heading", { name: "Current stored entitlements" }),
  ).toBeVisible();
}

async function enterReview(page) {
  await loadSubject(page);
  await page.getByLabel("Exact value").selectOption("admin");
  await page
    .getByLabel("Required reason")
    .fill("Approved browser acceptance change");
  await page.getByRole("button", { name: "Review exact change" }).click();
  await expect(
    page.getByRole("heading", { name: "Review exact change" }),
  ).toBeVisible();
}

test("Admin entitlement current/history and two-step mutation are keyboard operable", async ({
  page,
}) => {
  let readCount = 0;
  let postedBody;
  let postedHeaders;
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      readCount += 1;
      await json(route, {
        ...entitlementReadBody,
        current: {
          tier: readCount === 1 ? "standard" : "admin",
          admin_sub_roles: [],
        },
        history: [
          {
            ...entitlementReadBody.history[0],
            value: readCount === 1 ? "standard" : "admin",
          },
        ],
      });
      return;
    }
    postedBody = request.postDataJSON();
    postedHeaders = request.headers();
    await json(route, {
      action: "grant",
      subject_user_id: subjectUserId,
      entitlement_kind: "tier",
      entitlement_value: "admin",
      changed: true,
      before: { tier: "standard", admin_sub_roles: [] },
      after: { tier: "admin", admin_sub_roles: [] },
      audit_id: randomUUID(),
    });
  });

  await openAuthorizedSurface(page);
  await expectAccessibleState(page, "Admin entitlement edit", {
    responsive: true,
  });

  await page.getByLabel("Subject user UUID").fill(subjectUserId);
  await page.getByRole("button", { name: "Load current and history" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Current stored entitlement")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("standard");

  await page.getByLabel("Exact value").selectOption("admin");
  await page
    .getByLabel("Required reason")
    .fill("Approved browser acceptance change");
  await page.getByRole("button", { name: "Review exact change" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Review exact change" }),
  ).toBeVisible();
  await expect(page.getByText(/Grant tier “admin” to subject/u)).toContainText(
    subjectUserId,
  );
  await expect(page.getByText(/Reason:/u)).toContainText(
    "Approved browser acceptance change",
  );
  await expectAccessibleState(page, "Admin entitlement review", {
    responsive: true,
  });

  await page.getByRole("button", { name: "Confirm exact change" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("admin");
  expect(readCount).toBe(2);
  expect(postedBody).toEqual({
    action: "grant",
    subject_user_id: subjectUserId,
    entitlement_kind: "tier",
    entitlement_value: "admin",
    justification: "Approved browser acceptance change",
  });
  expect(postedHeaders["x-csrf-token"]).toBe("browser-admin-csrf-token");
  expect(postedHeaders["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
  await expectAccessibleState(page, "Admin entitlement success", {
    responsive: true,
  });
});

test("Consultant expiry validation, exact review and refreshed evidence are keyboard operable", async ({
  page,
}) => {
  const expiresAt = "2099-12-31T23:59:59Z";
  let readCount = 0;
  let postedBody;
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      readCount += 1;
      await json(
        route,
        readCount === 1
          ? entitlementReadBody
          : {
              ...entitlementReadBody,
              current: {
                tier: "consultant",
                admin_sub_roles: [],
                tier_expires_at: expiresAt,
              },
              history: [
                {
                  ...entitlementReadBody.history[0],
                  value: "consultant",
                  effective_to: expiresAt,
                },
              ],
            },
      );
      return;
    }
    postedBody = request.postDataJSON();
    await json(route, {
      action: "grant",
      subject_user_id: subjectUserId,
      entitlement_kind: "tier",
      entitlement_value: "consultant",
      expires_at: expiresAt,
      changed: true,
      before: {
        tier: "standard",
        admin_sub_roles: [],
        tier_expires_at: null,
      },
      after: {
        tier: "consultant",
        admin_sub_roles: [],
        tier_expires_at: expiresAt,
      },
      audit_id: randomUUID(),
    });
  });

  await openAuthorizedSurface(page);
  await loadSubject(page);
  await page.getByLabel("Exact value").selectOption("consultant");
  const expiry = page.getByLabel("Consultant expiry (RFC3339)");
  await expect(expiry).toBeVisible();
  await page
    .getByLabel("Required reason")
    .fill("Approved bounded browser Consultant access");
  await page.getByRole("button", { name: "Review exact change" }).focus();
  await page.keyboard.press("Enter");
  await expect(expiry).toBeFocused();
  await expect(expiry).toHaveAttribute("aria-invalid", "true");
  await expectAccessibleState(page, "Consultant expiry validation", {
    responsive: true,
  });

  await expiry.fill(expiresAt);
  await page.getByRole("button", { name: "Review exact change" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Review exact change" }),
  ).toBeVisible();
  await expect(page.getByText(/Expires exactly at/u)).toContainText(expiresAt);
  await expect(
    page.locator(`time[datetime="${expiresAt}"]`).first(),
  ).toContainText("31 Dec 2099, 23:59:59 UTC");
  await expectAccessibleState(page, "Consultant expiry review", {
    responsive: true,
  });

  await page.getByRole("button", { name: "Confirm exact change" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
  expect(postedBody).toEqual({
    action: "grant",
    subject_user_id: subjectUserId,
    entitlement_kind: "tier",
    entitlement_value: "consultant",
    justification: "Approved bounded browser Consultant access",
    expires_at: expiresAt,
  });
  await expect(page.getByText("Tier expiry").last()).toBeVisible();
  expect(
    await page.locator(`time[datetime="${expiresAt}"]`).count(),
  ).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("table")).toContainText(
    "31 Dec 2099, 23:59:59 UTC",
  );
  await expectAccessibleState(page, "Consultant expiry success", {
    responsive: true,
  });
});

test("session-denied state is inaccessible to non-super-admin actors", async ({
  page,
}) => {
  await routeSession(page, {
    tier: "admin",
    admin_sub_roles: ["security_audit"],
    csrf_token: "browser-admin-csrf-token",
  });
  await page.goto("/admin/entitlements");
  const alert = page.locator("main [role=alert]");
  await expect(alert).toContainText(
    "requires the Admin tier and the exact super_admin sub-role",
  );
  await expect(
    page.getByRole("button", { name: "Review exact change" }),
  ).toHaveCount(0);
  await expectAccessibleState(page, "Admin entitlement session denied", {
    responsive: true,
  });
});

test("session-error state exposes an operable retry without the write surface", async ({
  page,
}) => {
  await routeSession(
    page,
    {
      error: {
        detail: "Administrator session unavailable.",
        correlation_id: "session-correlation-503",
      },
    },
    503,
  );
  await page.goto("/admin/entitlements");
  const alert = page.locator("main [role=alert]");
  await expect(alert).toContainText("Administrator session unavailable.");
  await expect(
    page.getByRole("button", { name: "Retry session check" }),
  ).toBeEnabled();
  await expectAccessibleState(page, "Admin entitlement session error", {
    responsive: true,
  });
});

test("current/history loading state remains accessible and reflows", async ({
  page,
}) => {
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", async (route) => {
    await readGate;
    await json(route, entitlementReadBody);
  });
  await openAuthorizedSurface(page);
  await page.getByLabel("Subject user UUID").fill(subjectUserId);
  await page.getByRole("button", { name: "Load current and history" }).click();
  await expect(
    page.getByText("Loading current entitlements and history…", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Loading current and history…" }),
  ).toBeDisabled();
  await expectAccessibleState(page, "Admin entitlement history loading", {
    responsive: true,
  });
  releaseRead();
  await expect(
    page.getByRole("heading", { name: "Current stored entitlements" }),
  ).toBeVisible();
});

test("read-error state preserves a generic 403 boundary and retry", async ({
  page,
}) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", (route) =>
    json(
      route,
      {
        error: {
          detail: "Secret cross-account subject detail.",
          correlation_id: "read-correlation-403",
        },
      },
      403,
    ),
  );
  await openAuthorizedSurface(page);
  await page.getByLabel("Subject user UUID").fill(subjectUserId);
  await page.getByRole("button", { name: "Load current and history" }).click();
  const alert = page.locator("main [role=alert]");
  await expect(alert).toContainText(
    "The server refused access to this entitlement subject.",
  );
  await expect(alert).not.toContainText("Secret cross-account subject detail.");
  await expect(alert).toContainText("read-correlation-403");
  await expect(
    page.getByRole("button", { name: "Retry current and history" }),
  ).toBeEnabled();
  await expectAccessibleState(page, "Admin entitlement history read error", {
    responsive: true,
  });
});

test("empty-history state is explicit, accessible, and reflows", async ({
  page,
}) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", (route) =>
    json(route, {
      ...entitlementReadBody,
      current: { tier: null, admin_sub_roles: [] },
      history: [],
    }),
  );
  await openAuthorizedSurface(page);
  await loadSubject(page);
  await expect(page.getByRole("table")).toContainText(
    "No entitlement history is stored.",
  );
  await expectAccessibleState(page, "Admin entitlement empty history", {
    responsive: true,
  });
});

test("mutation-submitting state disables duplicate submission and remains accessible", async ({
  page,
}) => {
  let releaseMutation;
  const mutationGate = new Promise((resolve) => {
    releaseMutation = resolve;
  });
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, entitlementReadBody);
      return;
    }
    await mutationGate;
    await json(route, {
      action: "grant",
      subject_user_id: subjectUserId,
      entitlement_kind: "tier",
      entitlement_value: "admin",
      changed: true,
      before: entitlementReadBody.current,
      after: { tier: "admin", admin_sub_roles: [] },
      audit_id: randomUUID(),
    });
  });
  await openAuthorizedSurface(page);
  await enterReview(page);
  await page.getByRole("button", { name: "Confirm exact change" }).click();
  await expect(
    page.getByText("Submitting and waiting for durable audit…", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm exact change" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Back to edit" }),
  ).toBeDisabled();
  await expectAccessibleState(page, "Admin entitlement mutation submitting", {
    responsive: true,
  });
  releaseMutation();
  await expect(
    page.getByRole("heading", { name: "Entitlement change recorded" }),
  ).toBeVisible();
});

test("mutation 403 state suppresses backend subject detail and keeps retry operable", async ({
  page,
}) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", (route) => {
    if (route.request().method() === "GET")
      return json(route, entitlementReadBody);
    return json(
      route,
      {
        error: {
          detail: "Secret mutation authorization detail.",
          correlation_id: "mutation-correlation-403",
        },
      },
      403,
    );
  });
  await openAuthorizedSurface(page);
  await enterReview(page);
  await page.getByRole("button", { name: "Confirm exact change" }).click();
  const alert = page.locator("main [role=alert]");
  await expect(alert).toContainText(
    "The server refused this entitlement change.",
  );
  await expect(alert).not.toContainText(
    "Secret mutation authorization detail.",
  );
  await expect(alert).toContainText("mutation-correlation-403");
  await expect(
    page.getByRole("button", { name: "Retry exact change" }),
  ).toBeEnabled();
  await expectAccessibleState(page, "Admin entitlement mutation 403", {
    responsive: true,
  });
});

test("mutation 503 state exposes durable-audit failure and keeps retry operable", async ({
  page,
}) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/entitlements**", (route) => {
    if (route.request().method() === "GET")
      return json(route, entitlementReadBody);
    return json(
      route,
      {
        error: {
          detail: "Audit storage unavailable.",
          correlation_id: "mutation-correlation-503",
        },
      },
      503,
    );
  });
  await openAuthorizedSurface(page);
  await enterReview(page);
  await page.getByRole("button", { name: "Confirm exact change" }).click();
  const alert = page.locator("main [role=alert]");
  await expect(alert).toContainText("Audit storage unavailable.");
  await expect(alert).toContainText("mutation-correlation-503");
  await expect(
    page.getByRole("button", { name: "Retry exact change" }),
  ).toBeEnabled();
  await expectAccessibleState(page, "Admin entitlement mutation 503", {
    responsive: true,
  });
});
