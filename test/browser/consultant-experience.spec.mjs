import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GOLDEN_SCENARIO_V3_01 } from "../../packages/contracts/dist/src/index.js";

// MB-UX-DEV-004 L01. Actual browser rendering, synthetic API data only.
// Every API/auth/mutation request is intercepted; unexpected traffic fails closed.
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const executionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sessionIdentity = {
  tier: "consultant",
  user_id: "ui-fixture-user",
  account_id: "ui-fixture-account",
  email: "consultant@example.com",
  display_name: "Browser Test Consultant",
  csrf_token: "synthetic-csrf",
};
const sourceOutput = structuredClone(GOLDEN_SCENARIO_V3_01);
sourceOutput.research_run_id = runId;
sourceOutput.execution_id = executionId;
const costs = {
  currency: "USD",
  recorded_total_usd: 0,
  openrouter_charge_usd: 0,
  byok_upstream_usd: 0,
  preparation_usd: 0,
  research_usd: 0,
  unpriced_calls: 0,
  calls: 0,
  complete: true,
  by_execution: {},
  disclosure:
    "Synthetic browser scenario. No provider calls or billable usage.",
};
const plan = {
  mode: "demonstration",
  depth: "simple",
  round_number: 1,
  title: "Initial supplier research",
  purpose: "Find suppliers from synthetic browser evidence",
  estimated_low_usd: 0,
  estimated_high_usd: 0,
  expires_at: "2099-01-01T00:00:00Z",
  research_models: [],
  synthesis_model: "fixture-projection",
  extraction_model: "fixture-extraction",
  search_engine: "native",
  focus_requirements: [],
  max_calls: 0,
  max_output_tokens_per_call: 12000,
  assumptions: [
    "Synthetic browser scenario; no provider calls.",
    "No following round without a separate approval.",
  ],
};

async function mockExperience(page, options = {}) {
  let signedIn = options.signedIn ?? true;
  let state = options.state ?? "prep_step1_awaiting_approval";
  let revealed = 5;
  let version = 1;
  let preparationReads = 0;
  let translation =
    "We require frozen poultry for wholesale buyers in Saudi Arabia.";
  let prompt =
    "Research poultry suppliers and cite their public business evidence.";
  let savedIntake = {
    product_requirement: "Frozen poultry",
    technical_compliance: "Export documentation and frozen transport",
    order_profile: "Wholesale buyers in Saudi Arabia",
  };
  const actions = [];
  const unexpected = [];
  const progress = () => ({
    phase:
      state === "workflow_failed"
        ? "user_cancelled"
        : state === "progressive_reveal_ready"
          ? "completed"
          : state === "prep_step2_advisory_generating"
            ? "advisory"
            : "discovery_openai",
    loop: 1,
    max_loops: state === "prep_step2_advisory_generating" ? 3 : 1,
    message:
      state === "prep_step2_advisory_generating"
        ? "Preparing the advisory brief from saved requirements."
        : "Reviewing cited supplier evidence.",
    updated_at: "2026-09-09T10:05:00Z",
  });
  const current = () => ({
    run_id: runId,
    draft_id: draftId,
    draft_version: version,
    execution_id: executionId,
    mode: "demonstration",
    state,
    intake: savedIntake,
    revealed_count: revealed,
    retry_action:
      state === "prep_step2_advisory_generating"
        ? "prepare"
        : /running|dispatching|failed/.test(state)
          ? "research"
          : null,
    step1_interpretation: {
      english_translation: translation,
      fidelity_validation: {
        valid: true,
        preserved_count: 0,
        omitted_count: 0,
        mutated_count: 0,
      },
      product_name: "Frozen poultry",
      product_category: "Food",
    },
    ...(state !== "prep_step1_awaiting_approval"
      ? {
          step2_advisory: {
            loop1_trade_lane: "Trade source findings for the approved request.",
            loop2_regulatory:
              "Regulatory source findings for the approved request.",
            loop3_supply_structure:
              "Supplier source findings for the approved request.",
            sources: [],
          },
        }
      : {}),
    ...(![
      "prep_step1_awaiting_approval",
      "prep_step2_advisory_generating",
    ].includes(state)
      ? {
          step3_deep_prompt: {
            prompt_text: prompt,
            is_approved: state !== "prep_step3_prompt_awaiting_approval",
            discovery_criteria: ["Frozen poultry"],
          },
        }
      : {}),
    ...(state === "progressive_reveal_ready" ? { output: sourceOutput } : {}),
    ...(state === "workflow_failed"
      ? { error: "Research stopped by your request." }
      : {}),
    progress: progress(),
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname.startsWith("/auth/")) {
      if (url.pathname === "/auth/logout") {
        signedIn = false;
        actions.push({ action: "logout" });
        return reply({ success: true });
      }
      signedIn = true;
      return route.fulfill({ status: 302, headers: { location: "/" } });
    }
    if (url.pathname === "/api/v1/me")
      return signedIn
        ? reply({ ...sessionIdentity, tier: options.tier ?? "consultant" })
        : reply({ error: "Not signed in" }, 401);
    if (
      url.pathname.startsWith("/api/v1/consultant/reports/") &&
      url.pathname.endsWith("/pdf") &&
      request.method() === "GET"
    ) {
      actions.push({
        action: "download_pdf",
        execution_id: url.searchParams.get("execution_id"),
      });
      return route.fulfill({
        contentType: "application/pdf",
        headers: {
          "content-disposition":
            'attachment; filename="Synthetic_Consultant_Report.pdf"',
        },
        body: "%PDF-1.4\n% Synthetic download fixture; UI transport test only.\n%%EOF\n",
      });
    }
    if (url.pathname === "/api/v1/consultant/research-rounds") {
      if (request.method() === "GET")
        return reply({
          costs,
          rounds:
            state === "progressive_reveal_ready"
              ? [
                  {
                    round_id: "round-ui",
                    round_number: 1,
                    status: "completed",
                    execution_id: executionId,
                    output_available: true,
                    candidate_count: 20,
                    plan,
                  },
                ]
              : [],
          next_round: state === "progressive_reveal_ready" ? 2 : 1,
        });
      const body = request.postDataJSON();
      actions.push({ ...body, endpoint: "rounds" });
      if (body.action === "quote")
        return reply({ quote_id: "quote-ui", choices: [], plan });
      if (body.action === "approve") {
        state = "lane_openai_running";
        return reply({ success: true, processing: true }, 202);
      }
    }
    if (url.pathname === "/api/v1/consultant/workflow") {
      if (request.method() === "GET") {
        if (url.searchParams.has("history"))
          return options.historyError
            ? reply({ error: "Fixture history unavailable" }, 503)
            : reply({
                items: options.emptyHistory
                  ? []
                  : [
                      {
                        run_id: runId,
                        title: "Synthetic poultry sourcing request",
                        state,
                        mode: "demonstration",
                        updated_at: "2026-09-09T10:00:00Z",
                        result_available: state === "progressive_reveal_ready",
                      },
                    ],
              });
        if (url.searchParams.has("active_draft"))
          return reply({
            drafts: [
              {
                draft_id: draftId,
                updated_at: "2026-09-09T09:00:00Z",
                draft_data: {
                  productRequirement: "Synthetic saved poultry draft",
                },
              },
            ],
          });
        if (url.searchParams.has("incomplete")) return reply({ items: [] });
        if (url.searchParams.has("draft_id") && !url.searchParams.has("run_id"))
          return reply({
            draft_id: draftId,
            draft_version: version,
            draft_data: {
              productRequirement: savedIntake.product_requirement,
              technicalCompliance: savedIntake.technical_compliance,
              orderProfile: savedIntake.order_profile,
            },
          });
        if (
          state === "prep_step2_advisory_generating" &&
          ++preparationReads > 1
        )
          state = "prep_step3_prompt_awaiting_approval";
        return reply({ session: current() });
      }
      const body = request.postDataJSON();
      actions.push(body);
      if (body.action === "create_draft")
        return reply({
          success: true,
          draft_id: draftId,
          draft_version: version,
        });
      if (body.action === "save_draft")
        return reply({ success: true, draft_version: ++version });
      if (body.action === "submit_intake") {
        savedIntake = {
          product_requirement: body.product_requirement,
          technical_compliance: body.technical_compliance,
          order_profile: body.order_profile,
        };
        state = "prep_step1_awaiting_approval";
        return reply({ success: true, session: current() });
      }
      if (body.action === "validate_step1_fidelity")
        return reply({
          success: true,
          fidelity: {
            valid: true,
            preserved_count: 0,
            omitted_count: 0,
            mutated_count: 0,
          },
        });
      if (body.action === "approve_step1") {
        translation = body.edited_translation;
        state = "prep_step2_advisory_generating";
        return reply(
          { success: true, processing: true, session: current() },
          202,
        );
      }
      if (body.action === "approve_step3") {
        prompt = body.edited_prompt;
        state = "prep_step3_prompt_approved";
        return reply({ success: true, session: current() });
      }
      if (body.action === "reveal_more") {
        revealed = Math.min(20, revealed + 5);
        return reply({
          success: true,
          revealed_count: revealed,
          session: current(),
        });
      }
      if (body.action === "stop_research") {
        state = "workflow_failed";
        return reply({ success: true, session: current() });
      }
    }
    if (
      url.pathname.startsWith("/api/") ||
      !["GET", "HEAD"].includes(request.method()) ||
      url.origin !==
        new URL(page.url() === "about:blank" ? request.url() : page.url())
          .origin
    ) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      return reply(
        { error: "Synthetic browser test blocked unexpected request" },
        403,
      );
    }
    return route.continue();
  });
  return {
    actions,
    unexpected,
    complete() {
      state = "progressive_reveal_ready";
    },
    setState(value) {
      state = value;
    },
  };
}

async function saveViewScreenshot(page, label) {
  const visuals = join(
    process.env.MATCHBASE_BROWSER_OUTPUT_DIR ??
      join(tmpdir(), "MatchBASE-DEV004-browser"),
    "visuals",
  );
  await mkdir(visuals, { recursive: true });
  await page.screenshot({
    path: join(
      visuals,
      `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
    ),
    fullPage: !label.includes("dossier"),
  });
}

async function checkIntakeHelp(page) {
  for (const number of [1, 2, 3]) {
    const button = page.locator(`#help-btn-${number}`);
    await expect(button).toHaveText("Help & Guidance");
    const box = await button.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(
      box.scrollWidth,
      `Help ${number} label must fit within its button`,
    ).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(
      box.scrollHeight,
      `Help ${number} label must fit its button height`,
    ).toBeLessThanOrEqual(box.clientHeight + 1);
  }
  await page.locator("#help-btn-1").click();
  await expect(page.locator("#help-btn-1")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("#help-popover-1")).toBeVisible();
  await expect(page.locator("#help-popover-1")).toContainText(
    "Describe the exact product",
  );
  await page.locator("#help-btn-1").click();
  await expect(page.locator("#help-popover-1")).toHaveCount(0);
}

async function checkView(page, label) {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await saveViewScreenshot(page, label);
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect
    .soft(overflow.content, `${label}: document must not overflow the viewport`)
    .toBeLessThanOrEqual(overflow.width + 1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect
    .soft(
      results.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
      `${label}: WCAG A/AA automated checks`,
    )
    .toEqual([]);
}

test("DEV-004 L01 signed-out entry, Consultant dashboard, profile and saved-request resume", async ({
  page,
}) => {
  const mock = await mockExperience(page, { signedIn: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Find suppliers",
  );
  await expect(
    page.getByRole("link", { name: /Try demo|Standard workspace|Admin/i }),
  ).toHaveCount(0);
  await checkView(page, "signed-out entry");
  await page
    .getByRole("link", { name: /Sign in as Consultant|Continue with Google/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your sourcing dashboard" }),
  ).toBeVisible();
  await checkView(page, "dashboard");
  await page
    .getByRole("navigation", { name: "Consultant navigation" })
    .getByRole("link", { name: "Profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your profile" }),
  ).toBeVisible();
  await expect(
    page.getByText("consultant@example.com", { exact: true }),
  ).toBeVisible();
  await checkView(page, "profile");
  await page
    .getByRole("navigation", { name: "Consultant navigation" })
    .getByRole("link", { name: "Research", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your research", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /^Open (saved )?research$/, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`run_id=${runId}`));
  await expect(
    page.getByLabel("Editable English Interpretation"),
  ).toBeVisible();
  expect(
    mock.actions.filter((item) => /approve|execute/.test(item.action)),
  ).toEqual([]);
  await page.goto("/?view=profile");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: /Sign in as Consultant|Continue with Google/,
    }),
  ).toBeVisible();
  expect(mock.actions.filter((item) => item.action === "logout")).toHaveLength(
    1,
  );
  expect(mock.unexpected).toEqual([]);
});

test("DEV-004 L01 three-box request through explicit approvals, progress, 20 suppliers and PDF", async ({
  page,
}) => {
  const mock = await mockExperience(page);
  await page.goto("/consultant/workflow?mode=new");
  await page
    .getByLabel("Product Requirement", { exact: true })
    .fill("Frozen poultry for wholesale buyers");
  await page
    .getByLabel("Technical, Quality & Trade Requirements", { exact: true })
    .fill("Export documentation and frozen transport");
  await page
    .getByLabel("Order & Supplier Profile", { exact: true })
    .fill("Wholesale buyers in Saudi Arabia");
  await checkIntakeHelp(page);
  await checkView(page, "three-box request");
  await page.getByRole("button", { name: /Continue to review/ }).click();
  const interpretation = page.getByLabel("Editable English Interpretation");
  await expect(interpretation).toBeVisible();
  await interpretation.fill(
    "Approved English poultry requirements, edited by the buyer.",
  );
  await expect(
    page.getByRole("button", {
      name: "Approve interpretation & continue",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    mock.actions.filter((item) => item.action === "approve_step1"),
  ).toHaveLength(0);
  await checkView(page, "interpretation review");
  await page
    .getByRole("button", {
      name: "Approve interpretation & continue",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Advisory research · Round 1 of 3",
      exact: true,
    }),
  ).toBeVisible();
  const researchPlan = page.getByLabel("Editable research plan");
  await expect(researchPlan).toBeVisible();
  for (const text of [
    "Trade source findings for the approved request.",
    "Regulatory source findings for the approved request.",
    "Supplier source findings for the approved request.",
  ])
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  await researchPlan.fill("Buyer-approved supplier research plan.");
  await page
    .getByRole("button", { name: /Approve plan & review cost/ })
    .click();
  await expect(
    page.getByText("Recorded spend to date", { exact: false }),
  ).toBeVisible();
  expect(
    mock.actions.filter((item) => item.endpoint === "rounds"),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Get cost estimate · no research starts" })
    .click();
  await expect(page.getByText(/Estimated additional cost:/)).toBeVisible();
  expect(mock.actions.filter((item) => item.action === "approve")).toHaveLength(
    0,
  );
  await checkView(page, "explicit cost approval");
  await page
    .getByRole("button", { name: "Approve cost estimate & start round 1" })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop research", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Showing 5 of 20/)).toHaveCount(0);
  await checkView(page, "active research");
  mock.complete();
  await expect(page.getByText(/Showing 5 of 20/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop research", exact: true }),
  ).toHaveCount(0);
  await checkView(page, "supplier results");
  const details = page
    .getByRole("button", { name: /View supplier details/ })
    .first();
  await details.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await saveViewScreenshot(page, "desktop supplier dossier");
  await expect(dialog.getByRole("heading").first()).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(details).toBeFocused();
  for (const count of [10, 15, 20]) {
    await page.getByRole("button", { name: /Show next suppliers/ }).click();
    await expect(
      page.getByText(new RegExp(`Showing ${count} of 20`)),
    ).toBeVisible();
  }
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Full PDF Report", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Synthetic_Consultant_Report.pdf");
  await download.delete();
  expect(mock.actions.filter((item) => item.action === "approve")).toHaveLength(
    1,
  );
  expect(
    mock.actions.find((item) => item.action === "approve_step1")
      .edited_translation,
  ).toBe("Approved English poultry requirements, edited by the buyer.");
  expect(
    mock.actions.find((item) => item.action === "approve_step3").edited_prompt,
  ).toBe("Buyer-approved supplier research plan.");
  expect(
    mock.actions.find((item) => item.action === "download_pdf").execution_id,
  ).toBe(executionId);
  expect(mock.unexpected).toEqual([]);
});

test("DEV-004 L01 mobile dashboard, saved reports and supplier dossier have no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await mockExperience(page, {
    state: "progressive_reveal_ready",
  });
  for (const [url, heading] of [
    ["/?view=home", "Your sourcing dashboard"],
    ["/?view=history", "Your research"],
    ["/?view=reports", "Supplier reports"],
    ["/?view=profile", "Your profile"],
  ]) {
    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await checkView(page, `mobile ${heading}`);
  }
  await page.goto("/consultant/workflow?mode=new");
  await expect(
    page.getByLabel("Product Requirement", { exact: true }),
  ).toBeVisible();
  await checkIntakeHelp(page);
  await checkView(page, "mobile three-box request");
  mock.setState("prep_step1_awaiting_approval");
  await page.goto(`/consultant/workflow?run_id=${runId}`);
  await expect(
    page.getByLabel("Editable English Interpretation"),
  ).toBeVisible();
  await checkView(page, "mobile interpretation review");
  mock.setState("prep_step3_prompt_awaiting_approval");
  await page.goto(`/consultant/workflow?run_id=${runId}`);
  await expect(page.getByLabel("Editable research plan")).toBeVisible();
  await checkView(page, "mobile advisory and research plan");
  mock.setState("progressive_reveal_ready");
  await page.goto(`/consultant/workflow?run_id=${runId}`);
  await expect(page.getByText(/Showing 5 of 20/)).toBeVisible();
  await checkView(page, "mobile supplier shortlist");
  await page
    .getByRole("button", { name: /View supplier details/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await saveViewScreenshot(page, "mobile supplier dossier");
  const geometry = await page.getByRole("dialog").boundingBox();
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.x + geometry.width).toBeLessThanOrEqual(391);
  const closeButton = page.getByRole("button", {
    name: "Close modal",
    exact: true,
  });
  const closeBox = await closeButton.boundingBox();
  const closeIconBox = await closeButton.locator("svg").boundingBox();
  expect(
    closeBox.width,
    "Mobile dossier close target must not shrink",
  ).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  expect(
    closeIconBox.width,
    "Mobile close icon must remain visible",
  ).toBeGreaterThanOrEqual(20);
  const modalAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    modalAxe.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
  await closeButton.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

test("DEV-004 L01 stopping research retains review and never silently starts another round", async ({
  page,
}) => {
  const mock = await mockExperience(page, { state: "lane_openai_running" });
  await page.goto(`/consultant/workflow?run_id=${runId}`);
  await page
    .getByRole("button", { name: "Stop research", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Stopped by you", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Review a new research estimate",
      exact: true,
    }),
  ).toBeVisible();
  await checkView(page, "cancelled research");
  expect(mock.actions.map((item) => item.action)).toEqual(["stop_research"]);
  expect(mock.unexpected).toEqual([]);
});

test("DEV-004 L01 failed history is not shown as empty and recovers after retry", async ({
  page,
}) => {
  const options = { historyError: true, emptyHistory: true };
  const mock = await mockExperience(page, options);
  await page.goto("/?view=history");
  await expect(
    page.getByRole("alert").filter({ hasText: "Research history" }),
  ).toContainText("Research history could not be refreshed");
  await expect(
    page.getByRole("heading", {
      name: "Start your first research",
      exact: true,
    }),
  ).toHaveCount(0);
  await checkView(page, "history unavailable");
  options.historyError = false;
  await page
    .getByRole("button", { name: "Retry loading history", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Start your first research",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Research history" }),
  ).toHaveCount(0);
  await checkView(page, "empty saved history");
  expect(mock.unexpected).toEqual([]);
});

test("DEV-004 L01 other tiers see Consultant access requirement without entering the workspace", async ({
  page,
}) => {
  const mock = await mockExperience(page, { tier: "standard" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Consultant access required",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Consultant navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Try demo|Standard workspace|Admin/i }),
  ).toHaveCount(0);
  await checkView(page, "Consultant access required");
  expect(mock.actions).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});
