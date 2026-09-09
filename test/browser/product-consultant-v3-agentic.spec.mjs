import { expect, test } from "@playwright/test";
import { expectAxeClean } from "./accessibility-matrix.mjs";

test.describe("Consultant-Tier Agentic Research Workflow (MB-UX-DEV-003)", () => {
  test("Complete 3-section workflow: Intake, 3 Preparation Gates, Progressive Revelation & Dossier", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/consultant/workflow");

    // 1. Verify Page Header
    await expect(page.locator("h1")).toContainText(
      "Sourcing Intelligence & Deep Supplier Discovery",
    );

    // 2. Test Section 1: Helper Popovers
    const helpBtn1 = page.locator("#help-btn-1");
    await expect(helpBtn1).toHaveAttribute("aria-expanded", "false");
    await helpBtn1.click();
    await expect(helpBtn1).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator("text=Specify precise product type"),
    ).toBeVisible();

    // 3. Submit Intake
    const submitIntakeBtn = page.locator(
      "button:has-text('Submit Intake & Proceed')",
    );
    await expect(submitIntakeBtn).toBeVisible();
    await submitIntakeBtn.click();

    // 4. Verify Section 2: Step 1 English Interpretation Gate
    await expect(
      page.locator("h3:has-text('English Interpretation')"),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=HS 0207.12")).toBeVisible();

    const approveStep1Btn = page.locator(
      "button:has-text('Approve Interpretation & Proceed')",
    );
    await expect(approveStep1Btn).toBeVisible();
    await approveStep1Btn.click();

    // 5. Verify Step 2 (Advisory Context) and Step 3 (Deep Prompt Gate)
    await expect(
      page.locator("h3:has-text('3-Loop Advisory Context')"),
    ).toBeVisible();
    await expect(
      page.locator("text=Loop 1: Trade Lane Dynamics"),
    ).toBeVisible();
    await expect(page.locator("text=Loop 2: Regulatory & SFDA")).toBeVisible();

    const launchResearchBtn = page.locator(
      "button:has-text('Approve Prompt & Launch Dual-Lane Research')",
    );
    await expect(launchResearchBtn).toBeVisible();
    await launchResearchBtn.click();

    // 6. Verify Section 3: Verified Supplier Candidates (Top 5 initial)
    await expect(
      page.locator("h2:has-text('Section 3: Verified Supplier Candidates')"),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.locator("text=Showing 5 of 20 verified candidate profiles"),
    ).toBeVisible();

    // Verify Active SFDA Direct Route badges vs Conditional
    await expect(
      page.locator("text=SFDA Active Direct Route").first(),
    ).toBeVisible();

    // 7. Test Progressive Revelation (+5 more candidates)
    const revealBtn = page.locator(
      "button:has-text('Reveal 5 More Candidates')",
    );
    await expect(revealBtn).toBeVisible();
    await revealBtn.click();
    await expect(
      page.locator("text=Showing 10 of 20 verified candidate profiles"),
    ).toBeVisible();

    // 8. Test Supplier Dossier Modal
    const viewDossierBtn = page
      .locator("button:has-text('View Full Dossier')")
      .first();
    await viewDossierBtn.click();

    const modal = page.locator("div[role='dialog']");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#dossier-modal-title")).toBeVisible();
    await expect(
      modal.locator("text=6-Dimension Compatibility Assessment"),
    ).toBeVisible();
    await expect(
      modal.locator("text=Verified Commercial Contacts"),
    ).toBeVisible();

    // Close modal via Escape
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();

    // 9. Test JSON Export notification
    const exportJsonBtn = page.locator(
      "button:has-text('Export Structured JSON')",
    );
    await exportJsonBtn.click();
    await expect(page.locator("text=Structured JSON exported")).toBeVisible();

    // 10. Run Accessibility Audit on Desktop
    await expectAxeClean(page);
  });

  test("Accessibility across Tablet (768px), Mobile (390px), and Narrow (320px)", async ({
    page,
  }) => {
    // 768px Tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/consultant/workflow");
    await expect(page.locator("h1")).toBeVisible();
    await expectAxeClean(page);

    // 390px Mobile (iPhone 14)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/consultant/workflow");
    await expect(page.locator("h1")).toBeVisible();
    await expectAxeClean(page);

    // 320px Narrow Mobile
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/consultant/workflow");
    await expect(page.locator("h1")).toBeVisible();
    await expectAxeClean(page);
  });
});
