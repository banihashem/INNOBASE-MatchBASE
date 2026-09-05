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
    // 1. SC-01: Frozen Whole Chicken Grade A (Brazil to Saudi Arabia)
    await page.goto("/runs/00000000-0000-4000-8000-000000000301");
    await expect(page.getByText("Frozen Whole Chicken Grade A")).toBeVisible();
    await expect(page.getByText("BRF S.A.").first()).toBeVisible();
    await expect(page.getByText("Download JSON")).toBeVisible();
    await expect(page.getByText("V2 REPORT EXPORT DEFERRED")).toBeVisible();

    // 2. SC-02: Corrugated Packaging
    await page.goto("/runs/00000000-0000-4000-8000-000000000302");
    await expect(
      page.getByText("Heavy-Duty Corrugated Shipping Boxes"),
    ).toBeVisible();

    // 3. SC-03: Automotive Wiring Harness
    await page.goto("/runs/00000000-0000-4000-8000-000000000303");
    await expect(
      page.getByText("High-Voltage Automotive Wiring Harness Assembly"),
    ).toBeVisible();

    // 4. SC-04: API Pharmaceutical
    await page.goto("/runs/00000000-0000-4000-8000-000000000304");
    await expect(
      page.getByText("Amoxicillin Trihydrate Compacted Powder (USP/EP)"),
    ).toBeVisible();

    // 5. SC-05: Subsea Valves (NO STRONG MATCH State)
    await page.goto("/runs/00000000-0000-4000-8000-000000000305");
    await expect(
      page.getByText("No Responsible Match Identified"),
    ).toBeVisible();
    await expect(page.getByText("STATUS: NO STRONG MATCH")).toBeVisible();

    // 6. SC-06: Specialty Chemical Formulation
    await page.goto("/runs/00000000-0000-4000-8000-000000000306");
    await expect(
      page.getByText("Fluoropolymer Dispersions for Extreme Temp Gaskets"),
    ).toBeVisible();

    // 7. SC-07: Decoupled compatibility score vs evidence confidence
    await page.goto("/runs/00000000-0000-4000-8000-000000000307");
    await expect(
      page.getByText("Precision Planetary Gearboxes for Robotics"),
    ).toBeVisible();
    // Verify both score >= 80 and LOW evidence confidence badge are truthfully displayed
    await expect(page.getByText("LOW", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("High Technical Fit with Low Evidence Confidence").first(),
    ).toBeVisible();

    // 8. SC-08: Multi-Tier Sourcing
    await page.goto("/runs/00000000-0000-4000-8000-000000000308");
    await expect(
      page.getByText("Lithium Iron Phosphate (LFP) Prismatic Battery Cells"),
    ).toBeVisible();

    // 9. SC-09: Fast-Turn Prototype
    await page.goto("/runs/00000000-0000-4000-8000-000000000309");
    await expect(
      page.getByText("5-Axis CNC Precision Prototype Machining (7-Day Turn)"),
    ).toBeVisible();

    // 10. SC-10: Aerospace Ceramic (NO STRONG MATCH State)
    await page.goto("/runs/00000000-0000-4000-8000-000000000310");
    await expect(
      page.getByText("No Responsible Match Identified"),
    ).toBeVisible();

    // 11. SC-11: Cold-Chain Logistics
    await page.goto("/runs/00000000-0000-4000-8000-000000000311");
    await expect(
      page.getByText(
        "Validated -70C Ultra-Cold Chain Global Biologics Shipping",
      ),
    ).toBeVisible();

    // 12. SC-12: Organic Fair-Trade Coffee
    await page.goto("/runs/00000000-0000-4000-8000-000000000312");
    await expect(
      page.getByText("Organic Fair-Trade Green Arabica Coffee Beans Grade 1"),
    ).toBeVisible();

    // 13. SC-13: Precision Optical Sensors
    await page.goto("/runs/00000000-0000-4000-8000-000000000313");
    await expect(
      page.getByText("Laser Collimator Lens Assemblies for LiDAR Systems"),
    ).toBeVisible();

    // 14. SC-14: Recycled PCR Pellets
    await page.goto("/runs/00000000-0000-4000-8000-000000000314");
    await expect(
      page.getByText(
        "Post-Consumer Recycled High-Density Polyethylene (rHDPE) Food-Grade",
      ),
    ).toBeVisible();

    // 15. SC-15: Custom Silicon ASIC Packaging
    await page.goto("/runs/00000000-0000-4000-8000-000000000315");
    await expect(
      page.getByText(
        "Advanced Flip-Chip BGA Packaging and Final Test Services",
      ),
    ).toBeVisible();
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
    await expect(page.getByText("Download JSON")).toBeVisible();

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

    // 403 Forbidden
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
