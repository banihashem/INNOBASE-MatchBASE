import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { GOLDEN_SCENARIO_V3_01 } from "../../packages/contracts/dist/src/index.js";

// MB-UX-DEV-004 L02. Browser UI fixtures only. All APIs, authentication and
// mutations are intercepted, with unexpected requests rejected before dispatch.
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const executionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const workflowUrl = `/consultant/workflow?run_id=${runId}`;
const models = [
  "google/gemini-fixture",
  "openai/gpt-fixture",
  "anthropic/claude-fixture",
  "deepseek/fixture",
  "x-ai/grok-fixture",
];
const costs = {
  currency: "USD",
  recorded_total_usd: 0.25,
  openrouter_charge_usd: 0.05,
  byok_upstream_usd: 0.2,
  preparation_usd: 0.25,
  research_usd: 0,
  unpriced_calls: 0,
  calls: 2,
  complete: true,
  by_execution: {},
  disclosure: "Synthetic cost records for UI qualification; no paid requests.",
};
function makePlan(tier = "default") {
  const lanes = models.slice(0, { default: 2, advanced: 3, ultra: 5 }[tier]);
  return {
    version: "research-round.v1",
    research_tier: tier,
    mode: "live",
    depth: "simple",
    round_number: 1,
    title: "Initial supplier research",
    purpose: "Synthetic browser quotation; no paid execution.",
    estimated_low_usd: lanes.length / 10,
    estimated_high_usd: lanes.length,
    expires_at: "2099-01-01T00:00:00Z",
    research_models: lanes,
    rates: lanes.map((model, index) => ({
      model,
      billing_mode: index < 2 ? "byok" : "openrouter_credits",
    })),
    extraction_model: models[1],
    synthesis_model: models[1],
    search_engine: "native",
    search_engines: Object.fromEntries(
      lanes.map((m) => [m, m.startsWith("deepseek/") ? "exa" : "native"]),
    ),
    focus_requirements: [],
    max_calls: 31,
    max_output_tokens_per_call: 12000,
    assumptions: [
      "Synthetic quote only; no provider calls.",
      "Includes seven-day price search, with thirty-day fallback if needed.",
    ],
    price_research: {
      model: models[0],
      search_engine: "native",
      max_calls: 4,
      preferred_window_days: 7,
      window_days: 30,
    },
  };
}
function price(id, daysOld, amount, provenance = "market_benchmark") {
  return {
    observation_id: id,
    provenance,
    supplier_name:
      provenance === "supplier_listing" ? "Fixture Supplier" : null,
    product_or_service: "Frozen poultry",
    route_or_market: "Saudi Arabia wholesale",
    currency: "USD",
    unit: "kg",
    price_min: amount,
    price_max: amount,
    incoterm: "FOB",
    quantity_basis: "One container",
    source_url: `https://example.com/prices/${id}`,
    source_title: `Dated ${id} evidence`,
    source_published_at: new Date(
      Date.parse("2026-09-09T10:00:00Z") - daysOld * 86400000,
    ).toISOString(),
    retrieved_at: "2026-09-09T10:00:00Z",
    valid_until: null,
    quote: `Frozen poultry ${amount} USD per kg.`,
    date_quote: `Published ${daysOld} days before research.`,
    relevance_note: "Same product and market; benchmark only.",
  };
}
async function intercept(page, options = {}) {
  const actions = [],
    blocked = [];
  let state = options.output
    ? "progressive_reveal_ready"
    : "prep_step3_prompt_approved";
  const output = structuredClone(GOLDEN_SCENARIO_V3_01);
  output.research_run_id = runId;
  output.execution_id = executionId;
  output.supplier_candidates = [];
  output.executive_summary.direct_answer =
    "No supplier profile is ready in this synthetic research. The independently sourced market benchmark remains available below.";
  output.price_research = {
    searched_at: "2026-09-09T10:00:00Z",
    status: "complete",
    searched_windows_days: options.fallback ? [7, 30] : [7],
    observations: options.fallback
      ? [price("month", 14, 7.77)]
      : [price("week", 2, 3.33), price("month", 14, 7.77)],
    limitations: ["Market benchmark, not a named supplier offer."],
  };
  const tiers = Object.fromEntries(
    ["default", "advanced", "ultra"].map((tier) => [
      tier,
      {
        configured: !options.missingByok || tier === "default",
        missing_families:
          tier === "default" ? [] : ["Anthropic", "DeepSeek", "Grok"],
      },
    ]),
  );
  const session = () => ({
    run_id: runId,
    draft_id: draftId,
    draft_version: 1,
    execution_id: executionId,
    mode: "demonstration",
    state,
    revealed_count: 5,
    intake: {
      product_requirement: "Frozen poultry",
      technical_compliance: "Frozen transport",
      order_profile: "Saudi wholesale buyers",
    },
    step1_interpretation: {
      english_translation:
        "We require frozen poultry for Saudi wholesale buyers.",
      product_name: "Frozen poultry",
      product_category: "Food",
      fidelity_validation: {
        valid: true,
        preserved_count: 0,
        omitted_count: 0,
        mutated_count: 0,
      },
    },
    step2_advisory: {
      loop1_trade_lane: "Trade findings",
      loop2_regulatory: "Regulatory findings",
      loop3_supply_structure: "Supplier findings",
      sources: [],
    },
    step3_deep_prompt: {
      prompt_text: "Find suppliers with cited public evidence.",
      is_approved: true,
      discovery_criteria: ["Frozen poultry"],
    },
    ...(options.output ? { output } : {}),
    progress: {
      phase: options.output ? "completed" : "queued",
      loop: 1,
      max_loops: 1,
      updated_at: "2026-09-09T10:00:00Z",
    },
  });
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === "/api/v1/me")
      return reply({
        tier: "consultant",
        display_name: "Research Options Test",
        email: "fixture@example.com",
        csrf_token: "synthetic-csrf",
      });
    if (url.pathname === "/api/v1/consultant/research-rounds") {
      if (req.method() === "GET")
        return reply({
          costs,
          research_tiers: tiers,
          rounds: options.output
            ? [
                {
                  round_id: "round-fixture",
                  round_number: 1,
                  status: "completed",
                  execution_id: executionId,
                  output_available: true,
                  candidate_count: 0,
                  plan: makePlan(),
                },
              ]
            : [],
          next_round: options.output ? 2 : 1,
        });
      const body = req.postDataJSON();
      actions.push(body);
      if (body.action === "quote")
        return reply({
          quote_id: `quote-${body.research_tier}`,
          choices: [],
          plan: makePlan(body.research_tier),
        });
      if (body.action === "approve") {
        state = "research_dispatching";
        return reply({ success: true, processing: true }, 202);
      }
    }
    if (url.pathname === "/api/v1/consultant/workflow") {
      if (req.method() === "GET") return reply({ session: session() });
      const body = req.postDataJSON();
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
    }
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/") ||
      !["GET", "HEAD"].includes(req.method()) ||
      url.origin !==
        new URL(page.url() === "about:blank" ? req.url() : page.url()).origin
    ) {
      blocked.push(`${req.method()} ${url.pathname}`);
      return reply(
        { error: "Unexpected browser-fixture request blocked" },
        403,
      );
    }
    return route.continue();
  });
  return { actions, blocked };
}
async function visualChecks(page, label, testInfo) {
  await expect(page.locator("main")).toHaveCount(1);
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(
    width.page,
    "Document must not overflow horizontally",
  ).toBeLessThanOrEqual(width.viewport + 1);
  // Capture the document at its origin before the accessibility audit changes
  // temporary focus styles; otherwise fixed skip links can appear mid-image.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath(`${label}.png`),
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test("L02 default, advanced and ultra estimates keep approval tied to the selected tier", async ({
  page,
}, testInfo) => {
  const mock = await intercept(page);
  await page.goto(workflowUrl);
  const radios = page.getByRole("group", {
    name: "First-round research coverage",
  });
  await expect(radios).toBeVisible();
  await expect(radios.getByRole("radio", { name: /^Default/ })).toBeChecked();
  for (const [tier, count] of [
    ["default", 2],
    ["advanced", 3],
    ["ultra", 5],
  ]) {
    await radios
      .getByRole("radio", { name: new RegExp(`^${tier}`, "i") })
      .check();
    await page
      .getByRole("button", { name: "Get cost estimate · no research starts" })
      .click();
    await expect(
      page.getByText(new RegExp(`${tier} · ${count} web research models`, "i")),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Approve cost estimate & start round 1",
      }),
    ).toBeEnabled();
    if (tier !== "ultra") {
      await radios
        .getByRole("radio", {
          name: new RegExp(tier === "default" ? "^Advanced" : "^Ultra"),
        })
        .check();
      await expect(
        page.getByRole("button", {
          name: "Approve cost estimate & start round 1",
        }),
      ).toHaveCount(0);
    }
  }
  expect(mock.actions.map((a) => a.action)).toEqual([
    "quote",
    "quote",
    "quote",
  ]);
  const payment = page.getByRole("region", {
    name: "Payment sources for this estimate",
  });
  await expect(payment).toBeVisible();
  await expect(payment).toContainText(
    "Approving this estimate authorizes OpenRouter credit charges",
  );
  await expect(payment).toContainText(
    "anthropic/claude-fixture: OpenRouter credits",
  );
  await expect(payment).toContainText(
    "google/gemini-fixture: BYOK · provider account",
  );
  await visualChecks(page, "three-tier-estimate", testInfo);
  await page
    .getByRole("button", { name: "Approve cost estimate & start round 1" })
    .click();
  await expect
    .poll(() => mock.actions.filter((a) => a.action === "approve").length)
    .toBe(1);
  expect(mock.actions.at(-1)).toMatchObject({
    research_tier: "ultra",
    quote_id: "quote-ultra",
  });
  expect(mock.blocked).toEqual([]);
});

test("L02 missing BYOK families stay disabled with clear setup explanations", async ({
  page,
}, testInfo) => {
  const mock = await intercept(page, { missingByok: true });
  await page.goto(workflowUrl);
  await expect(page.getByRole("radio", { name: /^Default/ })).toBeEnabled();
  await expect(page.getByRole("radio", { name: /^Advanced/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /^Ultra/ })).toBeDisabled();
  await expect(page.getByText(/Setup required:/).first()).toBeVisible();
  await visualChecks(page, "missing-byok", testInfo);
  expect(mock.actions).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test("L02 seven-day benchmarks remain visible with zero suppliers and do not become quotes", async ({
  page,
}, testInfo) => {
  const mock = await intercept(page, { output: true });
  await page.goto(workflowUrl);
  const recent = page.getByLabel("Recent price research");
  await expect(recent).toBeVisible();
  await expect(recent).toContainText("Under 7 days at search time");
  await expect(recent).toContainText(
    "Market benchmark · not a supplier quotation",
  );
  await expect(recent).toContainText("3.33");
  await expect(recent).not.toContainText("7.77");
  await expect(
    page.getByText("Showing 0 of 0 assessed candidate profiles."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /View supplier details/ }),
  ).toHaveCount(0);
  await visualChecks(page, "recent-market-zero-suppliers", testInfo);
  expect(mock.actions).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test("L02 mobile thirty-day fallback and keyboard tier navigation are usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await intercept(page, { output: true, fallback: true });
  await page.goto(workflowUrl);
  const recent = page.getByLabel("Recent price research");
  await expect(recent).toContainText("7 days → 30 days");
  await expect(recent).toContainText("Under 30 days at search time");
  await expect(recent).toContainText("7.77");
  await visualChecks(page, "mobile-month-price", testInfo);
  expect(mock.blocked).toEqual([]);
});

test("L02 mobile tier controls support keyboard choice without starting research", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await intercept(page);
  await page.goto(workflowUrl);
  const first = page.getByRole("radio", { name: /^Default/ });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /^Advanced/ })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /^Ultra/ })).toBeChecked();
  await visualChecks(page, "mobile-tier-keyboard", testInfo);
  expect(mock.actions).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
