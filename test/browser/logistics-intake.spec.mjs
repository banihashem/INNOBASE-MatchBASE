import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  narrativeSourceUnits,
  validateNarrativeMapping,
  GOLDEN_SCENARIO_V3_01,
  createSearchDimensionConfiguration,
  compileSearchDimensionPlan,
  createSearchDimensionCoverage,
} from "../../packages/contracts/dist/src/index.js";

const draftId = "e0000000-0000-4000-8000-000000000001";
const runId = "e0000000-0000-4000-8000-000000000002";
const narrative =
  "دو کانتینر 20 فوت؛ Qingdao → either Tincan OR Lekki، 20.5 tonnes net per container; direct preferred, switch B/L required. No inland delivery.";
async function fixture(page, options = {}) {
  let data = {},
    version = 1,
    operation = null;
  const actions = [],
    unexpected = [];
  const output = structuredClone(GOLDEN_SCENARIO_V3_01);
  output.primary_classification.label = "Freight forwarding services";
  output.executive_summary.research_coverage_status = "partial";
  const plan = compileSearchDimensionPlan(
    createSearchDimensionConfiguration({ profile_ids: ["logistics.ocean"] }),
    {
      owner_scope: {
        account_id: "fixture-account",
        user_profile_id: output.user_profile_id,
      },
      primary_classification_id: output.classification_id,
      original_buyer_intent: narrative,
    },
  );
  output.search_dimension_plan = plan;
  output.search_dimension_assessments = output.supplier_candidates.map(
    (supplier) =>
      createSearchDimensionCoverage(plan, {
        trace: output,
        entity_id: supplier.supplier_entity_id,
        now: "2026-10-06T00:00:00Z",
      }),
  );
  const draft = () => ({
    draft_id: draftId,
    draft_version: version,
    draft_data: data,
    status: "active",
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (url.pathname === "/api/v1/me")
      return reply({
        tier: "consultant",
        subject: { user_id: "fixture-profile", account_id: "fixture-account" },
        csrf_token: "synthetic",
      });
    if (url.pathname === "/api/v1/consultant/workflow") {
      if (request.method() === "GET") {
        if (url.searchParams.has("draft_id")) return reply({ draft: draft() });
        if (url.searchParams.has("run_id"))
          return reply({
            session: {
              run_id: runId,
              state: "workflow_complete",
              output,
              revealed_count: 5,
              step3_deep_prompt: { is_approved: true },
            },
            draft: {
              ...draft(),
              draft_data: {
                industry: "logistics",
                originalNarrative: narrative,
              },
            },
          });
        return reply({ items: [] });
      }
      const body = request.postDataJSON();
      actions.push(body);
      if (body.action === "create_draft")
        return reply({
          success: true,
          draft_id: draftId,
          draft_version: version,
        });
      if (body.action === "save_draft") {
        data = body.draft_data;
        return reply({
          success: true,
          draft_id: draftId,
          draft_version: ++version,
        });
      }
      if (body.action === "read_narrative")
        return reply({ success: true, operation });
      if (body.action === "submit_narrative") {
        if (options.gate) await options.gate;
        const proposal = validateNarrativeMapping(data.originalNarrative, {
          assignments: narrativeSourceUnits(data.originalNarrative).map(
            (unit) => ({
              unit_id: unit.id,
              boxes:
                unit.id === 0
                  ? ["productRequirement", "orderProfile"]
                  : ["technicalCompliance"],
            }),
          ),
        });
        operation = {
          operation_id: "fixture-operation",
          narrative: data.originalNarrative,
          status: options.failure ? "failed" : "completed",
          proposal: options.failure ? null : proposal,
          receipts: {},
          error: options.failure
            ? "Synthetic conversion failure. Review fields manually; no automatic retry."
            : null,
          cost_summary: { recorded_total_usd: 0.02, calls: 1, complete: false },
        };
        return reply({ success: true, operation });
      }
      if (body.action === "submit_intake")
        return reply({
          success: true,
          session: {
            run_id: runId,
            state: "prep_step1_awaiting_approval",
            intake: {
              product_requirement: body.product_requirement,
              technical_compliance: body.technical_compliance,
              order_profile: body.order_profile,
            },
            step1_interpretation: {
              english_translation: narrative,
              fidelity_validation: {
                valid: true,
                preserved_count: 0,
                omitted_count: 0,
                mutated_count: 0,
                unresolved_conflict_count: 0,
                omitted_items: [],
                mutated_items: [],
              },
            },
          },
        });
    }
    if (url.pathname.includes("research-rounds"))
      return reply({
        rounds: [],
        costs: {
          recorded_total_usd: 0,
          preparation_usd: 0,
          research_usd: 0,
          calls: 0,
          unpriced_calls: 0,
          complete: false,
          by_execution: {},
        },
      });
    unexpected.push(`${request.method()} ${url.pathname}`);
    return reply({ error: "Unexpected fixture request" }, 400);
  });
  return { actions, unexpected };
}
async function accessible(page) {
  const violations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test("Logistics multilingual Submit preserves direction and qualifiers through editable fields and reload", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto("/consultant/workflow?mode=new");
  await expect(page.getByLabel("Industry", { exact: true })).toBeEnabled();
  await expect(page.locator("#workflow-panel-1")).toBeHidden();
  await page.getByLabel("Industry", { exact: true }).selectOption("logistics");
  const input = page.getByLabel(
    "Describe your logistics request in any language",
  );
  await input.fill(narrative);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByLabel("Product Requirement", { exact: true }),
  ).toHaveValue(narrativeSourceUnits(narrative)[0].text);
  await expect(
    page.getByLabel("Technical, Quality & Trade Requirements", { exact: true }),
  ).toHaveValue("No inland delivery.");
  await expect(
    page.getByText("Complete preparation cost is unknown.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        mock.actions.filter((action) => action.action === "save_draft").at(-1)
          ?.draft_data.productRequirement,
    )
    .toContain("Qingdao");
  await page.reload();
  await expect(input).toHaveValue(narrative);
  await expect(
    page.getByLabel("Order & Supplier Profile", { exact: true }),
  ).toHaveValue(narrativeSourceUnits(narrative)[0].text);
  await page
    .getByText("Original source and sentence assignments", { exact: true })
    .click();
  await accessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await accessible(page);
  await page.getByRole("button", { name: /Continue to review/ }).click();
  await expect(
    page.getByLabel("Editable English Interpretation"),
  ).toBeVisible();
  expect(
    mock.actions.filter((action) => action.action === "submit_narrative"),
  ).toHaveLength(1);
  expect(
    mock.actions.some((action) => /approve|execute/.test(action.action)),
  ).toBe(false);
  expect(mock.unexpected).toEqual([]);
});
test("Logistics conversion failure retains source, exposes manual fields and never retries on reload", async ({
  page,
}) => {
  const mock = await fixture(page, { failure: true });
  await page.goto("/consultant/workflow?mode=new");
  await page.getByLabel("Industry", { exact: true }).selectOption("logistics");
  await page
    .getByLabel("Describe your logistics request in any language")
    .fill(narrative);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic conversion failure" }),
  ).toContainText("Synthetic conversion failure");
  await page.getByRole("button", { name: "Review fields manually" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Product Requirement", { exact: true }),
  ).toHaveValue(narrative);
  await expect
    .poll(
      () =>
        mock.actions.filter((action) => action.action === "save_draft").at(-1)
          ?.draft_data.productRequirement,
    )
    .toBe(narrative);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Submit", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Technical, Quality & Trade Requirements", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Order & Supplier Profile", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: /Continue to review/ }).click();
  await expect(
    page.getByLabel("Editable English Interpretation"),
  ).toBeVisible();
  expect(
    mock.actions.filter((action) => action.action === "submit_narrative"),
  ).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
});
test("Logistics saved dashboard keeps unknown criteria, partial coverage and modal evidence accessible", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto(`/consultant/workflow?run_id=${runId}`);
  await page.getByRole("tab", { name: "Research & results" }).click();
  await expect(
    page.getByRole("heading", { name: "Logistics decision dashboard" }),
  ).toBeVisible();
  await expect(page.getByText(/^Research coverage: partial/)).toBeVisible();
  await expect(page.getByText("Capacity & MOQ:")).toHaveCount(0);
  await page
    .getByText("Logistics evidence and RFQ gaps", { exact: true })
    .first()
    .click();
  await expect(page.getByText(/No admitted observation/).first()).toBeVisible();
  await accessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await accessible(page);
  await page
    .getByRole("button", { name: /View supplier details/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});
