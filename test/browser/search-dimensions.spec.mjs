import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  assertDisposableTestDatabase,
  createPool,
  saveConsultantWorkflowSession,
} from "../../packages/data/dist/index.js";

// MB-SEARCH-DIMENSIONS-002 L01. Real HTTP and a guarded disposable database.
// Only a synthetic pre-approval workflow is seeded. No provider or quote action runs.
const databaseUrl = process.env.DATABASE_URL;
assertDisposableTestDatabase({ connectionString: databaseUrl });

test("Consultant saves search dimensions across reload without starting research", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const pool = createPool({ connectionString: databaseUrl, max: 2 });
  const runId = randomUUID();
  const executionId = randomUUID();
  const classificationId = randomUUID();
  let accountId;
  try {
    await page.goto("/auth/simulator/start?fixture=consultant");
    const identityResponse = await page.request.get("/api/v1/me");
    expect(identityResponse.ok()).toBe(true);
    const identity = await identityResponse.json();
    expect(identity.tier).toBe("consultant");
    expect(identity.subject.account_id).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(identity.subject.user_id).toMatch(/^[0-9a-f-]{36}$/iu);
    accountId = identity.subject.account_id;

    await saveConsultantWorkflowSession(pool, {
      session_id: randomUUID(),
      account_id: identity.subject.account_id,
      user_profile_id: identity.subject.user_id,
      run_id: runId,
      execution_id: executionId,
      current_state: "prep_step3_prompt_awaiting_approval",
      original_intake: {
        account_id: identity.subject.account_id,
        user_profile_id: identity.subject.user_id,
        product_requirement:
          "Synthetic ocean freight checklist for UI validation",
        technical_compliance:
          "Verify the supplier and the exact requested scope",
        order_profile:
          "One container; no paid supplier research in this fixture",
      },
      approved_request_revision: {
        revision_id: randomUUID(),
        english_translation:
          "Synthetic ocean freight checklist for UI validation",
        product_name: "Ocean freight forwarding",
        product_category: "Logistics",
        key_specifications: [],
        approved_at: new Date().toISOString(),
      },
      deep_prompt_revision: {
        prompt_text:
          "Synthetic plan for UI validation only; do not start supplier research",
        discovery_criteria: [],
        evidence_thresholds: [],
        target_supplier_count: 20,
        is_approved: false,
      },
      classification: {
        classification_id: classificationId,
        scheme: "CPC",
        code: "67910",
        version: "2.1",
      },
      approvals: [
        {
          step: "step1",
          approved_revision_id: randomUUID(),
          approved_at: new Date().toISOString(),
        },
      ],
      workflow_metadata: {
        mode: "demonstration",
        classification_id: classificationId,
      },
    });

    await page.goto(`/consultant/workflow?run_id=${runId}`);
    await page.getByRole("tab", { name: "Review & prepare" }).click();
    const panel = page.locator(".search-dimensions");
    await expect(
      panel.getByRole("heading", { name: "Search dimensions" }),
    ).toBeVisible();
    await expect(
      panel.getByLabel("Ocean freight and forwarding"),
    ).toBeChecked();
    await panel.getByText("Review dimensions and add priorities").click();
    const backup = panel
      .locator(".search-dimensions-row")
      .filter({ hasText: "Backup routing" });
    await expect(backup.getByRole("checkbox")).toBeChecked();
    await backup.getByRole("checkbox").uncheck();

    const approve = page.getByRole("button", {
      name: /Approve plan & review cost/u,
    });
    await expect(approve).toBeDisabled();
    await panel.getByText("Add a custom dimension").click();
    await panel.getByLabel("Label").fill("دمای حمل");
    await panel
      .getByLabel("Description")
      .fill("Verify transport temperature in the requested scope.");
    await panel.getByLabel("Research profile").selectOption("logistics.ocean");
    await panel
      .getByRole("button", { name: "Add dimension to this request" })
      .click();
    await expect(panel.getByText("دمای حمل")).toBeVisible();
    await expect(approve).toBeDisabled();

    const saveResponse = page.waitForResponse((response) => {
      if (new URL(response.url()).pathname !== "/api/v1/consultant/workflow")
        return false;
      if (response.request().method() !== "POST") return false;
      try {
        return (
          response.request().postDataJSON().action === "save_search_dimensions"
        );
      } catch {
        return false;
      }
    });
    await panel.getByRole("button", { name: "Save dimensions" }).click();
    const savedHttp = await saveResponse;
    expect(savedHttp.ok()).toBe(true);
    const saved = await savedHttp.json();
    const revision = saved.session.search_dimension_revision;
    expect(revision).toMatch(/^[a-f0-9]{64}$/iu);
    expect(
      saved.session.search_dimensions.selections.find(
        (selection) => selection.dimension_id === "logistics.backup_routing",
      ).active,
    ).toBe(false);
    expect(
      saved.session.search_dimensions.custom_definitions.some(
        (definition) => definition.label === "دمای حمل",
      ),
    ).toBe(true);
    await expect(approve).toBeEnabled();

    await page.reload();
    await page.getByRole("tab", { name: "Review & prepare" }).click();
    await panel.getByText("Review dimensions and add priorities").click();
    await expect(
      panel
        .locator(".search-dimensions-row")
        .filter({ hasText: "Backup routing" })
        .getByRole("checkbox"),
    ).not.toBeChecked();
    await expect(panel.getByText("دمای حمل")).toBeVisible();
    await expect(approve).toBeEnabled();

    const csrfCookie = (await page.context().cookies()).find((cookie) =>
      cookie.name.endsWith("matchbase_csrf"),
    );
    expect(csrfCookie).toBeDefined();
    const stale = await page.request.post("/api/v1/consultant/workflow", {
      headers: {
        "X-CSRF-Token": decodeURIComponent(csrfCookie.value),
        "Idempotency-Key": `dimensions-stale-${randomUUID()}`,
        Origin: "http://127.0.0.1:3010",
      },
      data: {
        action: "save_search_dimensions",
        run_id: runId,
        expected_revision: null,
        configuration: saved.session.search_dimensions,
      },
    });
    expect(stale.status()).toBe(409);

    const other = await browser.newContext({
      baseURL: "http://127.0.0.1:3010",
    });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto("/auth/simulator/start?fixture=standard");
      const denied = await otherPage.request.get(
        `/api/v1/consultant/workflow?run_id=${runId}`,
      );
      expect([403, 404]).toContain(denied.status());
    } finally {
      await other.close();
    }

    const axe = await new AxeBuilder({ page })
      .include(".search-dimensions")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      panelRight: document
        .querySelector(".search-dimensions")
        ?.getBoundingClientRect().right,
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
      391,
    );
    expect(overflow.panelRight, JSON.stringify(overflow)).toBeLessThanOrEqual(
      391,
    );
  } finally {
    if (accountId) {
      await pool.query(
        "DELETE FROM consultant_search_dimension_revision WHERE account_id=$1 AND run_id=$2",
        [accountId, runId],
      );
      await pool.query(
        "DELETE FROM consultant_workflow_event WHERE account_id=$1 AND run_id=$2",
        [accountId, runId],
      );
      await pool.query(
        "DELETE FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2",
        [accountId, runId],
      );
      await pool.query(
        "DELETE FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2",
        [accountId, runId],
      );
    }
    await pool.end();
  }
});
