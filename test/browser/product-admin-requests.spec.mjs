import { expect, test } from "@playwright/test";
import { expectAccessibleState } from "./accessibility-matrix.mjs";

const runId = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const session = { tier: "admin", admin_sub_roles: ["support"] };
const fourStates = [
  ["Review Required", "escalated", true, true],
  ["Escalated to Human", "escalated", true, true],
  ["Output Restricted", "restricted", true, true],
  ["Evaluation Failed", "failed", true, true],
].map(
  (
    [
      governance_state,
      run_state,
      human_action_required,
      automated_path_blocked,
    ],
    index,
  ) => ({
    run_id: index === 0 ? runId : `00000000-0000-4000-8000-00000000000${index}`,
    governance_state,
    reason_code: index === 1 ? "hidden-sensitive-detail" : "reason_unavailable",
    raised_at: `2026-08-25T0${7 - index}:00:00.000Z`,
    run_state,
    human_action_required,
    automated_path_blocked,
  }),
);

function body(items = fourStates, nextCursor = null) {
  return {
    items,
    page: { next_cursor: nextCursor, has_more: Boolean(nextCursor), limit: 20 },
  };
}

function json(route, value, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

async function routeSession(page, value = session, status = 200) {
  await page.route("**/api/v1/me", (route) => json(route, value, status));
}

async function openQueue(page) {
  await page.goto("/admin/requests");
  await expect(page).toHaveTitle("Requests and runs — MatchBASE Admin");
  await expect(
    page.getByRole("heading", { name: "Governance queue" }),
  ).toBeVisible();
}

test("loading state remains perceivable and reflows", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/me", async (route) => {
    await gate;
    await json(route, session);
  });
  await page.goto("/admin/requests");
  await expect(
    page.getByRole("heading", { name: "Verifying operator access" }),
  ).toBeVisible();
  await expectAccessibleState(page, "Admin governance session loading", {
    responsive: true,
  });
  release();
});

test("populated state exposes all exact states, safe status, and keyboard navigation", async ({
  page,
}) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/runs**", (route) => json(route, body()));
  await openQueue(page);
  for (const state of [
    "Review Required",
    "Escalated to Human",
    "Output Restricted",
    "Evaluation Failed",
  ]) {
    await expect(
      page.getByRole("table").getByText(state, { exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("table")).toContainText(
    "Reason unavailable by policy",
  );
  await expect(page.getByRole("table")).toContainText(
    "Governance reason recorded",
  );
  await expect(page.getByRole("table")).not.toContainText(
    "hidden-sensitive-detail",
  );
  await expect(page.getByRole("table").locator("time").first()).toHaveAttribute(
    "datetime",
    "2026-08-25T07:00:00.000Z",
  );
  const openRun = page.getByRole("link", { name: `Open run ${runId}` });
  await expect(openRun).toHaveAttribute("href", `/runs/${runId}`);
  await openRun.focus();
  await expect(openRun).toBeFocused();
  await expectAccessibleState(page, "Admin governance populated", {
    responsive: true,
  });
});

test("empty state is explicit and reflows", async ({ page }) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/runs**", (route) => json(route, body([])));
  await openQueue(page);
  await expect(
    page.getByText("No governance runs require operator attention."),
  ).toBeVisible();
  await expectAccessibleState(page, "Admin governance empty", {
    responsive: true,
  });
});

test("filtered-empty state uses only closed filters and keyboard submission", async ({
  page,
}) => {
  let requestedUrl = "";
  await routeSession(page);
  await page.route("**/api/v1/admin/runs**", (route) => {
    requestedUrl = route.request().url();
    return json(route, body([]));
  });
  await openQueue(page);
  await page.getByLabel("Governance state").selectOption("Output Restricted");
  await page.getByLabel("Run state").selectOption("restricted");
  await page.getByLabel("Failure class").selectOption("timeout");
  await page.getByLabel("Rows per page").selectOption("50");
  const apply = page.getByRole("button", { name: "Apply filters" });
  await apply.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("No governance runs match the applied filters."),
  ).toBeVisible();
  expect(requestedUrl).toContain("limit=50");
  expect(requestedUrl).toContain("governance_state=Output+Restricted");
  expect(requestedUrl).toContain("run_state=restricted");
  expect(requestedUrl).toContain("failure_class=timeout");
  await expectAccessibleState(page, "Admin governance filtered empty", {
    responsive: true,
  });
});

test("queue 403 is generic, retryable, and reflows", async ({ page }) => {
  await routeSession(page);
  await page.route("**/api/v1/admin/runs**", (route) =>
    json(
      route,
      { error: { detail: "secret cross-account governance content" } },
      403,
    ),
  );
  await page.goto("/admin/requests");
  const alert = page.locator("main [role=alert]");
  await expect(alert).toHaveText(
    "The governance queue is not visible to this session.",
  );
  await expect(alert).not.toContainText("secret");
  const retry = page.getByRole("button", { name: "Retry queue" });
  await retry.focus();
  await expect(retry).toBeFocused();
  await expectAccessibleState(page, "Admin governance 403", {
    responsive: true,
  });
});

test("session error is generic, keyboard-retryable, and reflows", async ({
  page,
}) => {
  await page.route("**/api/v1/me", (route) =>
    json(route, { error: { detail: "secret identity-provider detail" } }, 503),
  );
  await page.route("**/api/v1/admin/runs**", (route) => json(route, body([])));
  await page.goto("/admin/requests");
  const alert = page.locator("main [role=alert]");
  await expect(alert).toHaveText("Operator access could not be verified.");
  await expect(alert).not.toContainText("secret");
  await expectAccessibleState(page, "Admin governance session error", {
    responsive: true,
  });
  await page.unroute("**/api/v1/me");
  await routeSession(page);
  const retry = page.getByRole("button", { name: "Retry session check" });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("No governance runs require operator attention."),
  ).toBeVisible();
});

test("fetch error exposes an operable retry and no backend detail", async ({
  page,
}) => {
  let calls = 0;
  await routeSession(page);
  await page.route("**/api/v1/admin/runs**", (route) => {
    calls += 1;
    return calls === 1
      ? json(route, { error: { detail: "secret provider stack" } }, 503)
      : json(route, body());
  });
  await page.goto("/admin/requests");
  const alert = page.locator("main [role=alert]");
  await expect(alert).toHaveText("Governance runs could not be loaded.");
  await expect(alert).not.toContainText("secret");
  await expectAccessibleState(page, "Admin governance fetch error", {
    responsive: true,
  });
  await page.getByRole("button", { name: "Retry queue" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("cursor pagination exposes loading, next, and previous states without decoding the cursor", async ({
  page,
}) => {
  let releaseSecond;
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const urls = [];
  await routeSession(page);
  await page.route("**/api/v1/admin/runs**", async (route) => {
    const url = route.request().url();
    urls.push(url);
    if (url.includes("cursor=sealed-next")) {
      await secondGate;
      return json(route, body([]));
    }
    return json(route, body(fourStates, "sealed-next"));
  });
  await openQueue(page);
  const next = page.getByRole("button", { name: "Next page" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Loading governance runs" }),
  ).toBeVisible();
  await expect(page.getByText("Loading the requested page…")).toBeVisible();
  await expectAccessibleState(page, "Admin governance cursor loading", {
    responsive: true,
  });
  releaseSecond();
  await expect(page.getByText("Page 2")).toBeVisible();
  expect(urls.at(-1)).toContain("cursor=sealed-next");
  const previous = page.getByRole("button", { name: "Previous page" });
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Page 1")).toBeVisible();
  await expectAccessibleState(page, "Admin governance previous page", {
    responsive: true,
  });
});

test("consultant-manager role denial has no queue surface", async ({
  page,
}) => {
  await routeSession(page, {
    tier: "admin",
    admin_sub_roles: ["consultant_manager"],
  });
  await page.goto("/admin/requests");
  await expect(page.locator("main [role=alert]")).toContainText(
    "Consultant manager alone does not grant access.",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  await expectAccessibleState(page, "Admin governance role denied", {
    responsive: true,
  });
});
