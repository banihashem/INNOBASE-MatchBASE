import { expect, test } from "@playwright/test";
import { GOLDEN_SCENARIO_V3_01 } from "../../packages/contracts/dist/src/index.js";

// Real Chrome UI with intercepted APIs: no provider calls or database writes.
test("MB-UX-LIVE-001 L01: accepted asynchronous stages keep polling with retry_action present", async ({
  page,
}) => {
  const actions = [];
  let stage = "step1";
  let prepareReads = 0;
  let researchReads = 0;
  let releaseResearch;
  const researchGate = new Promise((resolve) => {
    releaseResearch = resolve;
  });
  const base = {
    run_id: "ui-async-run",
    mode: "demonstration",
    intake: {},
    step1_interpretation: {
      english_translation: "Approved industrial pump",
      fidelity_validation: { valid: true },
    },
  };
  const preparation = {
    step2_advisory: {
      loop1_trade_lane: "Trade source findings",
      loop2_regulatory: "Regulatory source findings",
      loop3_supply_structure: "Supplier source findings",
      sources: [],
    },
    step3_deep_prompt: {
      prompt_text: "Prepared industrial pump research prompt",
    },
  };
  const progress = (phase, loop, max_loops, message) => ({
    phase,
    loop,
    max_loops,
    message,
    updated_at: "2026-09-07T10:00:00Z",
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/me")
      return route.fulfill({
        json: {
          tier: "consultant",
          user_id: "ui-test-user",
          account_id: "ui-test-account",
        },
      });
    if (url.pathname !== "/api/v1/consultant/workflow")
      return route.fulfill({
        status: 403,
        json: { error: "UI test blocks external actions" },
      });
    if (request.method() === "GET") {
      if (stage === "step1")
        return route.fulfill({
          json: {
            session: {
              ...base,
              state: "prep_step1_awaiting_approval",
              retry_action: null,
            },
          },
        });
      if (stage === "prepare") {
        prepareReads += 1;
        if (prepareReads === 1)
          return route.fulfill({
            json: {
              session: {
                ...base,
                state: "prep_step2_advisory_generating",
                retry_action: "prepare",
                progress: progress("advisory", 1, 3, "Advisory loop underway"),
              },
            },
          });
        return route.fulfill({
          json: {
            session: {
              ...base,
              ...preparation,
              state: "prep_step3_prompt_awaiting_approval",
              retry_action: null,
              progress: progress(
                "prepared",
                3,
                3,
                "Three advisory loops finished",
              ),
            },
          },
        });
      }
      researchReads += 1;
      if (researchReads === 1)
        return route.fulfill({
          json: {
            session: {
              ...base,
              ...preparation,
              state: "research_dispatching",
              retry_action: "research",
              progress: progress(
                "verification",
                1,
                15,
                "Verification loop underway",
              ),
            },
          },
        });
      await researchGate;
      return route.fulfill({
        json: {
          session: {
            ...base,
            ...preparation,
            state: "progressive_reveal_ready",
            retry_action: null,
            progress: progress("complete", 5, 15, "Verified results ready"),
            output: GOLDEN_SCENARIO_V3_01,
            revealed_count: 5,
          },
        },
      });
    }
    const body = request.postDataJSON();
    actions.push(body);
    if (body.action === "validate_step1_fidelity")
      return route.fulfill({
        json: { success: true, fidelity: { valid: true } },
      });
    if (body.action === "approve_step1") {
      stage = "prepare";
      return route.fulfill({
        status: 202,
        json: {
          success: true,
          processing: true,
          session: {
            ...base,
            state: "prep_step2_advisory_generating",
            retry_action: "prepare",
            progress: progress("queued", 0, 3, "Preparation queued"),
          },
        },
      });
    }
    if (body.action === "approve_step3") {
      expect(body.edited_prompt).toBe("Human edited research prompt");
      return route.fulfill({
        json: {
          success: true,
          session: {
            ...base,
            ...preparation,
            state: "prep_step3_prompt_approved",
            retry_action: null,
          },
        },
      });
    }
    if (body.action === "execute_research") {
      stage = "research";
      return route.fulfill({
        status: 202,
        json: {
          success: true,
          processing: true,
          session: {
            ...base,
            ...preparation,
            state: "research_dispatching",
            retry_action: "research",
            progress: progress("queued", 0, 15, "Research queued"),
          },
        },
      });
    }
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected UI test action" },
    });
  });
  await page.goto("/consultant/workflow?run_id=ui-async-run");
  await page
    .getByRole("button", { name: "Approve Interpretation & Proceed" })
    .click();
  await expect(
    page.getByText("Advisory loop underway", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry failed/ })).toHaveCount(
    0,
  );
  const prompt = page.getByLabel("Editable Synthesized Research Prompt");
  await expect(prompt).toHaveValue(preparation.step3_deep_prompt.prompt_text);
  expect(prepareReads).toBe(2);
  expect(
    actions.filter((body) => body.action === "execute_research"),
  ).toHaveLength(0);
  for (const finding of [
    "Trade source findings",
    "Regulatory source findings",
    "Supplier source findings",
  ])
    await expect(page.getByText(finding, { exact: true })).toBeVisible();
  await prompt.fill("Human edited research prompt");
  await page
    .getByRole("button", { name: /Approve Prompt & Start Research/ })
    .click();
  await expect(
    page.getByText("Verification loop underway", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Showing 5 of 20/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Retry failed/ })).toHaveCount(
    0,
  );
  releaseResearch();
  await expect(page.getByText(/Showing 5 of 20/)).toBeVisible();
  expect(researchReads).toBe(2);
  expect(
    actions.filter((body) => body.action === "execute_research"),
  ).toHaveLength(1);
});

test("MB-UX-LIVE-001 L01: Save & New waits for the latest three-box snapshot", async ({
  page,
}) => {
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const saves = [];
  let created = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/me")
      return route.fulfill({
        json: {
          tier: "consultant",
          user_id: "ui-test-user",
          account_id: "ui-test-account",
        },
      });
    if (url.pathname !== "/api/v1/consultant/workflow")
      return route.fulfill({
        status: 403,
        json: { error: "UI test blocks external actions" },
      });
    const body = request.postDataJSON();
    if (body.action === "create_draft")
      return route.fulfill({
        json: {
          success: true,
          draft_id: `ui-draft-${++created}`,
          draft_version: 1,
        },
      });
    if (body.action === "save_draft") {
      saves.push(body);
      if (saves.length === 1) await firstGate;
      if (saves.length === 2) await secondGate;
      return route.fulfill({
        json: { success: true, draft_version: body.expected_version + 1 },
      });
    }
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected UI test action" },
    });
  });
  await page.goto("/consultant/workflow?mode=new");
  await expect(page).toHaveURL(/draft_id=ui-draft-1/);
  const product = page.getByLabel("Product Requirement", { exact: true });
  const technical = page.getByLabel("Technical, Quality & Trade Requirements", {
    exact: true,
  });
  const order = page.getByLabel("Order & Supplier Profile", { exact: true });
  await product.fill("Product initial");
  await technical.fill("Technical initial");
  await order.fill("Order initial");
  await expect.poll(() => saves.length).toBe(1);
  await product.fill("Product latest");
  await technical.fill("Technical latest");
  await order.fill("Order latest");
  await page.getByRole("button", { name: "+ New Consultant Research" }).click();
  await expect(
    page.getByRole("button", { name: "Stay & Continue Editing" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Save & Start New" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Save Unsaved Changes?" }),
  ).toBeVisible();
  await expect(product).toBeDisabled();
  await expect(technical).toBeDisabled();
  await expect(order).toBeDisabled();
  expect(created).toBe(1);
  releaseFirst();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1]).toMatchObject({
    draft_id: "ui-draft-1",
    expected_version: 2,
    draft_data: {
      productRequirement: "Product latest",
      technicalCompliance: "Technical latest",
      orderProfile: "Order latest",
    },
  });
  expect(created).toBe(1);
  releaseSecond();
  await expect(page).toHaveURL(/draft_id=ui-draft-2/);
  await expect(product).toHaveValue("");
  await expect(technical).toHaveValue("");
  await expect(order).toHaveValue("");
});
