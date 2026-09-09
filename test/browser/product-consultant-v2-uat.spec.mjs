import { expect, test } from "@playwright/test";
import { GOLDEN_SCENARIOS } from "../../packages/contracts/dist/src/index.js";
import { expectAxeClean } from "./accessibility-matrix.mjs";

function setupConsultantMocks(page) {
  return Promise.all([
    page.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          account_id: "a9442670-2db5-447f-8fb4-c71f6e16a893",
          user_id: "2efd403d-823e-4b3f-9fe8-fe3f800c460e",
          display_name: "Synthetic Consultant",
          tier: "consultant",
          quota: { limit: 20, used: 1, remaining: 19, next_capacity_at: null },
          execution: { active: 0, capacity: 3 },
          research_mode: {
            id: "synthetic_reference",
            label: "Synthetic reference",
            live_qualified: false,
          },
          csrf_token: "consultant-browser-csrf",
          environment: "test",
        }),
      }),
    ),
    page.route("**/api/v1/runs", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "consultant-run-history.v1",
          items: GOLDEN_SCENARIOS.map((s) => ({
            run_id: s.run_id,
            request_id: `req-${s.run_id.slice(-4)}`,
            state: "complete",
            updated_at: s.generated_at,
            result_available: true,
            outcome:
              s.research_status === "no_strong_match"
                ? "no_responsible_match"
                : "candidates",
          })),
        }),
      }),
    ),
    ...GOLDEN_SCENARIOS.map((scenario) =>
      page.route(`**/api/v1/runs/${scenario.run_id}/result`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(scenario),
        }),
      ),
    ),
    page.route(
      "**/api/v1/runs/00000000-0000-4000-8000-000000000999/result",
      (route) =>
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            fault: "run-not-found",
            message: "Run not found.",
          }),
        }),
    ),
    page.route(
      "**/api/v1/runs/00000000-0000-4000-8000-000000000888/result",
      (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            fault: "resource-not-visible",
            message: "Resource not visible.",
          }),
        }),
    ),
  ]);
}

test.describe("Consultant Deep-Research Output V2 Qualification Suite", () => {
  test.beforeEach(async ({ page }) => {
    await setupConsultantMocks(page);
  });

  test("SC-01 through SC-15: All 15 Golden Scenarios load and render key domain criteria", async ({
    page,
  }) => {
    for (const scenario of GOLDEN_SCENARIOS) {
      await page.goto(`/runs/${scenario.run_id}`);
      await expect(
        page.getByText(scenario.request_snapshot.product_name).first(),
      ).toBeVisible();
      if (scenario.research_status === "no_strong_match") {
        await expect(
          page.getByText("No Responsible Match Identified"),
        ).toBeVisible();
      } else if (scenario.supplier_candidates.length > 0) {
        await expect(
          page.getByText(scenario.supplier_candidates[0].legal_name).first(),
        ).toBeVisible();
      }
    }
  });

  test("Canonical Alias Resolution: run-v2-golden-01 resolves to SC-01", async ({
    page,
  }) => {
    await page.goto("/runs/run-v2-golden-01");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();
    await expect(page.getByText("BRF S.A.").first()).toBeVisible();
  });

  test("Responsive Viewport Qualifications: 390px, 768px, 1280px", async ({
    page,
  }) => {
    // 1. Mobile viewport (390 x 844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();
    await expect(page.getByText("Return to runs").first()).toBeVisible();
    await expect(
      page.getByText("Technical Details & Data Export"),
    ).toBeVisible();

    // 2. Tablet viewport (768 x 1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();

    // 3. Desktop viewport (1280 x 800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();
  });

  test("Error states: 404 Not Found and 403 Forbidden handling", async ({
    page,
  }) => {
    // 404 Not Found
    await page.goto("/runs/00000000-0000-4000-8000-000000000999");
    await expect(page.getByText("HTTP 404 Not Found")).toBeVisible();
    await expect(page.getByText("Return to Run Directory")).toBeVisible();

    // 403 Forbidden: For non-consultant users, backend 403 renders Access Denied
    await page.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          account_id: "standard-user-account",
          user_id: "standard-user-id",
          display_name: "Standard Tier User",
          tier: "standard",
          quota: { limit: 5, used: 1, remaining: 4, next_capacity_at: null },
          execution: { active: 0, capacity: 1 },
          research_mode: {
            id: "synthetic_reference",
            label: "Synthetic reference",
            live_qualified: false,
          },
          csrf_token: "standard-csrf",
          environment: "test",
        }),
      }),
    );
    await page.goto("/runs/00000000-0000-4000-8000-000000000888");
    await expect(page.getByText("HTTP 403 Forbidden")).toBeVisible();
    await expect(page.getByText("Switch to Consultant Session")).toBeVisible();
  });

  test("Accessibility: Axe WCAG clean on consultant result view", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();
    await expectAxeClean(page, "Consultant Research Output V2 (SC-01)");
  });
});
