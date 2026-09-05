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
    page.route("**/api/v1/consultant/runs", (route) =>
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

test.describe("MB-UX-REM-001 Remediation Verification Suite (F01 - F08)", () => {
  test.beforeEach(async ({ page }) => {
    await setupConsultantMocks(page);
  });

  test("F01: Contrast & Styling - WCAG 2.2 AA zero violations on Runs Directory and Run Detail", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Check Runs Directory page
    await page.goto("/runs");
    await expect(page.getByText("Research Run Directory")).toBeVisible();
    await expectAxeClean(page, "Runs Directory (/runs)");

    // 2. Check Run Detail page (SC-01)
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();
    await expectAxeClean(page, "Run Detail SC-01 (/runs/301)");

    // 3. Check No-Match Run Detail page (SC-10)
    await page.goto("/runs/00000000-0000-4000-8000-000000000310");
    await expect(
      page.getByText("No Responsible Match Identified"),
    ).toBeVisible();
    await expectAxeClean(page, "Run Detail SC-10 No-Match (/runs/310)");
  });

  test("F02: Internal ticket badge elimination - No MB-UX- or backlog badges visible", async ({
    page,
  }) => {
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();

    const pageContent = await page.content();
    expect(pageContent).not.toContain("MB-UX-BACKLOG-001");
    expect(pageContent).not.toContain("REPORT EXPORT DEFERRED");
    expect(pageContent).not.toContain("V2 REPORT EXPORT DEFERRED");
  });

  test("F03: Data export placement & disclosure - Collapsible section with truthfulness disclosure", async ({
    page,
  }) => {
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");

    // Top bar should not have a prominent "Download JSON"
    const topBar = page.locator(".consultant-v2-container > div").first();
    await expect(topBar.getByText("Download JSON")).toHaveCount(0);

    // Collapsible details element exists
    const details = page.getByText("Technical Details & Data Export");
    await expect(details).toBeVisible();

    // Click details to open
    await details.click();
    await expect(
      page.getByRole("button", { name: "Export structured data (JSON)" }),
    ).toBeVisible();
    await expect(
      page.getByText("Demonstration dataset — not live market evidence"),
    ).toBeVisible();
  });

  test("F04: Route semantics - Invalid aliases and missing runs map to 404, non-consultant maps to 403", async ({
    page,
  }) => {
    // 1. Invalid alias run-v2-golden-99 -> 404
    await page.goto("/runs/run-v2-golden-99");
    await expect(page.getByText("HTTP 404 Not Found")).toBeVisible();
    await expect(page.getByText("Result Not Found")).toBeVisible();
    await expect(page).toHaveTitle("Result Not Found | MatchBASE");

    // 2. Non-existent UUID -> 404
    await page.goto("/runs/00000000-0000-4000-8000-000000000999");
    await expect(page.getByText("HTTP 404 Not Found")).toBeVisible();
    await expect(page.getByText("Result Not Found")).toBeVisible();
    await expect(page).toHaveTitle("Result Not Found | MatchBASE");

    // 3. Standard non-consultant tier -> 403 Access Denied
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
    await expect(page.getByText("Access Denied")).toBeVisible();
    await expect(page).toHaveTitle("Access Denied | MatchBASE");
  });

  test("F05: Dynamic contextual page titles across all routes and states", async ({
    page,
  }) => {
    // 1. Directory page
    await page.goto("/runs");
    await expect(page).toHaveTitle("Research Runs | MatchBASE");

    // 2. SC-01 run detail
    await page.goto("/runs/run-v2-golden-01");
    await expect(page).toHaveTitle(
      "Frozen Whole Chicken Grade A — Sourcing | MatchBASE",
    );

    // 3. SC-10 no-match run detail
    await page.goto("/runs/00000000-0000-4000-8000-000000000310");
    await expect(page).toHaveTitle(/No Strong Match/);

    // 4. 404 page
    await page.goto("/runs/run-v2-golden-99");
    await expect(page).toHaveTitle("Result Not Found | MatchBASE");
  });

  test("F06: First-focus skip link functionality for keyboard accessibility", async ({
    page,
  }) => {
    await page.goto("/runs/run-v2-golden-01");

    // Tab into the page: the skip link should be the first focused element
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tagName: el?.tagName,
        text: el?.textContent,
        href: el?.getAttribute("href"),
      };
    });

    expect(focused.text).toBe("Skip to main content");
    expect(focused.href).toBe("#main-content");
  });

  test("F07: Viewport reflow without horizontal overflow across 1280px, 768px, 390px, 320px", async ({
    page,
  }) => {
    const viewports = [
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/runs/00000000-0000-4000-8000-000000000301");
      await expect(
        page.getByText("Frozen Whole Chicken Grade A"),
      ).toBeVisible();

      // Check document body reflow: scrollWidth must equal clientWidth / innerWidth
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);
    }
  });

  test("F08: Insufficient Evidence truthfulness disclosure and card labeling", async ({
    page,
  }) => {
    // SC-11 has research_status === "insufficient_evidence"
    await page.goto("/runs/00000000-0000-4000-8000-000000000311");

    // Notice banner
    await expect(page.getByText("Market coverage: Insufficient")).toBeVisible();
    await expect(
      page.getByText(
        "This candidate is supported by strong evidence, but the available market coverage is too limited",
      ),
    ).toBeVisible();

    // Status badge
    await expect(
      page.getByText("RESEARCH COVERAGE: INSUFFICIENT"),
    ).toBeVisible();

    // Candidate card label
    await expect(page.getByText("Candidate Evidence").first()).toBeVisible();
  });
});
