import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import {
  applyWcagTextSpacing,
  expectAccessibleState,
  expectAxeClean,
  overflowingElements,
} from "./accessibility-matrix.mjs";

const PERSON_RELEASE_CANARIES = [
  "Jane Mary Smith",
  "John Q. Public",
  "Jean Claude Van Damme",
  "علی رضا حسینی",
  "السيد أحمد محمد علي",
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function canonicalScenario(canonical) {
  const material = {
    selector_version: "canonical-registry.v1",
    domain_pack: canonical.domain_pack,
    fields: canonical.fields,
    hard_constraints: canonical.hard_constraints.map(
      ({ constraint_id: _constraintId, ...constraint }) => constraint,
    ),
    exclusions: canonical.exclusions,
    conditional_requirements: canonical.conditional_requirements,
    contradictions: canonical.contradictions,
  };
  const scenarios = ["zero", "one", "two", "three", "many"];
  const selector = createHash("sha256")
    .update(stableJson(material))
    .digest()[0];
  return scenarios[selector % scenarios.length];
}

async function addSyntheticHardConstraints(page) {
  await page.getByRole("button", { name: "Add hard constraint" }).click();
  await page.getByRole("button", { name: "Add hard constraint" }).click();
  const firstConstraint = page.getByRole("group", {
    name: "Hard constraint 1",
  });
  await firstConstraint
    .getByLabel("Constraint field")
    .selectOption({ label: "Quality certification" });
  await firstConstraint.getByLabel("Required value").fill("ISO_9001");
  const secondConstraint = page.getByRole("group", {
    name: "Hard constraint 2",
  });
  await secondConstraint
    .getByLabel("Constraint field")
    .selectOption({ label: "Incoterm" });
  await secondConstraint.getByLabel("Required value").fill("EXW");
  await secondConstraint.getByLabel("Relaxability").selectOption("relaxable");
  await secondConstraint.getByLabel("Tolerance", { exact: true }).fill("200");
  await secondConstraint
    .getByLabel("Direction")
    .selectOption("lower_is_acceptable");
}

async function createScenarioRequest(
  page,
  sourceText,
  expectedScenario,
  phase = expectedScenario,
) {
  let canonical;
  for (let notAskedCount = 0; notAskedCount <= 36; notAskedCount += 1) {
    const lifecycleResponses = [];
    const lifecycleFailures = [];
    const recordResponse = (response) => {
      const url = new URL(response.url());
      if (url.origin === "http://127.0.0.1:3010")
        lifecycleResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
    };
    const recordFailure = (request) => {
      lifecycleFailures.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        failure: request.failure()?.errorText ?? "unknown",
      });
    };
    page.on("response", recordResponse);
    page.on("requestfailed", recordFailure);
    const newRequest = page.getByRole("button", {
      name: "New structured request",
    });
    const sourceLanguage = page.getByLabel("Source language");
    try {
      await newRequest.press("Enter");
      const intakeHeading = page.getByRole("heading", {
        level: 1,
        name: "Define the sourcing request",
      });
      await expect(intakeHeading).toBeFocused();
      await expect(
        sourceLanguage,
        `${phase}: source-language control did not become visible`,
      ).toBeVisible({ timeout: 20_000 });
    } catch (cause) {
      const state = await page.evaluate(() => ({
        url: window.location.href,
        heading: document.querySelector("main h1")?.textContent?.trim(),
        sourceLanguageCount: document.querySelectorAll(
          "#standard-source-language",
        ).length,
        newRequestCount: [...document.querySelectorAll("button")].filter(
          (button) => button.textContent?.trim() === "New structured request",
        ).length,
        body: document.body.innerText.slice(0, 1_200),
      }));
      throw new Error(
        `${phase}: intake lifecycle failed ${JSON.stringify({ state, responses: lifecycleResponses.slice(-24), failures: lifecycleFailures.slice(-12) })}`,
        { cause },
      );
    } finally {
      page.off("response", recordResponse);
      page.off("requestfailed", recordFailure);
    }
    await sourceLanguage.selectOption("en");
    await page
      .getByLabel("Source-language input")
      .fill(`${sourceText} pattern-${notAskedCount}`);
    const resolutionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/domain-packs/resolution",
    );
    await page
      .getByRole("button", { name: "Resolve product category" })
      .click();
    const resolved = await resolutionResponse;
    const resolvedText = await resolved.text();
    expect(resolved.ok(), resolvedText).toBe(true);
    await expect(page.getByText(/product specification/u)).toBeVisible();
    await page.locator("details.standard-disclosure").evaluateAll((nodes) => {
      for (const node of nodes) node.open = true;
    });
    const stateControls = page.locator('select[id^="state-"]');
    expect(await stateControls.count()).toBeGreaterThanOrEqual(32);
    for (let index = 0; index < (await stateControls.count()); index += 1) {
      await stateControls
        .nth(index)
        .selectOption(
          index < notAskedCount ? "not_asked" : "explicitly_unknown",
        );
    }
    await addSyntheticHardConstraints(page);
    const canonicalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/requests",
    );
    await page
      .getByRole("button", { name: "Prepare canonical English" })
      .click();
    const response = await canonicalResponse;
    const responseText = await response.text();
    expect(response.ok(), responseText).toBe(true);
    canonical = JSON.parse(responseText);
    if (canonicalScenario(canonical) === expectedScenario) break;
    await page.getByRole("button", { name: "Requests" }).click();
    canonical = undefined;
  }
  expect(
    canonical,
    `No canonical ${expectedScenario} scenario was found.`,
  ).toBeTruthy();
  await expect(
    page.getByRole("heading", {
      name: "Confirm the canonical English request",
    }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Confirm and start synthetic research" })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Run progress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause updates" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeVisible();
  const progressFill = page.locator(".standard-progress span");
  const reducedTransition = await progressFill.evaluate(
    (element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration) * 1_000,
  );
  expect(reducedTransition).toBeLessThanOrEqual(0.01);
  await expect(page.getByText("Standard result", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function installStandardAccessibilityApi(page) {
  let resultReady = false;
  const session = {
    display_name: "Standard Matrix Evaluator",
    tier: "standard",
    quota: { limit: 5, used: 1, remaining: 4, next_capacity_at: null },
    execution: { active: 1, capacity: 3 },
    research_mode: {
      id: "synthetic_reference",
      label: "Synthetic reference",
      live_qualified: false,
    },
    csrf_token: "matrix-csrf-token",
    environment: "test",
  };
  const canonical = {
    schema_version: "structured-standard-request.v1",
    request_id: "10000000-0000-4000-8000-000000000010",
    canonical_version_id: "10000000-0000-4000-8000-000000000011",
    version: 1,
    source_language: "fa",
    canonical_language: "en",
    domain_pack: {
      registry_version: "registry.v1",
      pack_version: "pack.v1",
      category_id: "synthetic_industrial_components",
    },
    fields: [
      {
        field_id: "component_material",
        macro_parameter: "product_specification",
        typed_value: { value_state: "explicitly_unknown" },
        translated: true,
        confidence: 0.86,
      },
    ],
    hard_constraints: [],
    exclusions: [],
    conditional_requirements: [],
    contradictions: [],
    readiness: "partially_ready",
    created_at: "2026-08-25T00:00:00.000Z",
  };
  const queuedRun = {
    schema_version: "standard-run-projection.v1",
    synthetic_warning: "Synthetic evaluation data — not a sourcing result",
    projection_version: 5,
    run_id: "run-matrix",
    request_id: canonical.request_id,
    canonical_request_version: 1,
    phase: "queued",
    phase_label: "Queued for matrix evaluation",
    progress: 0,
    started_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:01.000Z",
    limitations_notice: "Synthetic limitations apply.",
    links: { request: "/requests/matrix", run: "/runs/matrix" },
    state: "queued",
    terminal: false,
    result_available: false,
    outcome: "pending",
    scarcity: "pending",
    poll_after_ms: 60_000,
  };
  const result = {
    schema_version: "standard-result-projection.v1",
    run_id: "run-matrix",
    outcome: "no_responsible_match",
    scarcity: "zero",
    projection_version: 5,
    synthetic_warning: "Synthetic evaluation data — not a sourcing result",
    gate_eliminations: [],
    scarcity_analysis: {
      reducing_constraints: [],
      unmet_mandatory_constraints: [
        {
          constraint_id: "constraint-matrix",
          field_id: "component_material",
          label: "Required synthetic material",
        },
      ],
      permitted_relaxations: [],
    },
    limitations: {
      unknown_count: 1,
      not_asked_count: 0,
      affected_low_confidence_dimensions: [],
      evidence_states: [],
      restricted_party_screening_notice:
        "No restricted-party screening was performed.",
      advisory_boundary: "Independent verification remains required.",
    },
    candidates: [],
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });

    if (url.pathname === "/api/v1/me") return json(session);
    if (url.pathname === "/api/v1/requests" && request.method() === "GET")
      return json({
        schema_version: "standard-request-history.v1",
        items: [],
        next_cursor: null,
        synthetic_warning: "Synthetic evaluation data — not a sourcing result",
      });
    if (url.pathname === "/api/v1/runs" && request.method() === "GET")
      return json({
        schema_version: "standard-run-history.v1",
        items: [],
        next_cursor: null,
        synthetic_warning: "Synthetic evaluation data — not a sourcing result",
      });
    if (url.pathname === "/api/v1/domain-packs/resolution")
      return json({
        schema_version: "domain-pack-resolution.v1",
        resolver_version: "matrix-resolver.v1",
        category_id: "synthetic_industrial_components",
        confidence: 1,
        confidence_threshold: 0.8,
        activation_state: "confirmed",
        registry_version: "registry.v1",
        pack_version: "pack.v1",
        activation_token: "matrix-activation-token",
        synthetic: true,
      });
    if (url.pathname === "/api/v1/domain-packs/synthetic_industrial_components")
      return json({
        schema_version: "domain-pack.v1",
        registry_version: "registry.v1",
        pack_version: "pack.v1",
        category_id: "synthetic_industrial_components",
        category_label: "Synthetic Industrial Components",
        macro_parameters: [
          "product_specification",
          "supplier_producer_profile",
          "trade_structure_commercial_execution",
        ],
        core_fields: [
          {
            field_id: "component_material",
            macro_parameter: "product_specification",
            label: "Component material",
            description: "Required synthetic material family.",
            kind: "text",
            requirement: "required",
            allowed_units: [],
            allowed_values: [],
          },
        ],
        domain_fields: [],
        synthetic: true,
      });
    if (url.pathname === "/api/v1/requests" && request.method() === "POST")
      return json(canonical, 201);
    if (url.pathname.endsWith("/confirmation")) return json({ version: 1 });
    if (url.pathname === "/api/v1/runs" && request.method() === "POST")
      return json({ run_id: "run-matrix" }, 202);
    if (
      url.pathname === "/api/v1/runs/run-matrix" &&
      request.method() === "GET"
    ) {
      return resultReady
        ? json({
            ...queuedRun,
            phase: "complete",
            phase_label: "Matrix evaluation complete",
            progress: 100,
            terminal: true,
            result_available: true,
            outcome: "no_responsible_match",
            scarcity: "zero",
            poll_after_ms: 0,
          })
        : json(queuedRun, 200, { "MB-Poll-After-Ms": "60000" });
    }
    if (url.pathname === "/api/v1/runs/run-matrix/result") return json(result);
    return json(
      { error: { detail: "Unhandled matrix fixture endpoint." } },
      404,
    );
  });
  return () => {
    resultReady = true;
  };
}

test("audits the route-injected Standard screen and state accessibility matrix", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const releaseResult = await installStandardAccessibilityApi(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No structured requests yet")).toBeVisible();
  await expectAccessibleState(page, "Standard empty request history", {
    responsive: true,
  });

  await page.getByRole("button", { name: "Help" }).click();
  await expect(
    page.getByRole("heading", {
      name: "How this synthetic workspace behaves",
    }),
  ).toBeVisible();
  await expectAccessibleState(page, "Standard help", { responsive: true });

  await page.getByRole("button", { name: "Requests" }).click();
  await page.getByRole("button", { name: "New structured request" }).click();
  await expect(
    page.getByRole("heading", { name: "Define the sourcing request" }),
  ).toBeVisible();
  await expectAccessibleState(page, "Standard empty intake", {
    responsive: true,
  });

  await page.getByRole("button", { name: "Resolve product category" }).click();
  await expect(page.locator(".error-summary[role='alert']")).toContainText(
    "Enter the transient sourcing requirement first.",
  );
  await expectAccessibleState(page, "Standard intake validation error", {
    responsive: true,
  });

  await page.getByLabel("Source language").selectOption("fa");
  await page
    .getByLabel("Source-language input")
    .fill("Synthetic industrial component fixture");
  await page.getByRole("button", { name: "Resolve product category" }).click();
  await expect(page.getByText(/product specification/u)).toBeVisible();
  await page
    .locator('select[id="state-component_material"]')
    .selectOption("explicitly_unknown");
  await expectAccessibleState(page, "Standard resolved structured intake", {
    responsive: true,
  });

  await page.getByRole("button", { name: "Prepare canonical English" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Confirm the canonical English request",
    }),
  ).toBeVisible();
  await expectAccessibleState(page, "Standard canonical review", {
    responsive: true,
  });

  await page
    .getByRole("button", { name: "Confirm and start synthetic research" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Queued for matrix evaluation" }),
  ).toBeVisible();
  await expectAccessibleState(page, "Standard queued progress", {
    responsive: true,
  });

  releaseResult();
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(
    page.getByRole("heading", { name: "No responsible match" }),
  ).toBeVisible();
  await expectAccessibleState(page, "Standard zero-match result", {
    responsive: true,
  });
});

test("completes the signed Standard workspace through the real HTTP, PostgreSQL, and worker path", async ({
  page,
  context,
}) => {
  test.setTimeout(40_000);
  const serverErrors = [];
  const transientSource = `Industrial component model MX900 private-${randomUUID()}`;
  page.on("response", (response) => {
    if (response.status() >= 500)
      serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/auth/simulator/start?fixture=standard");
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tier-badge")).toHaveText("Standard");
  await expect(
    page.getByText("Synthetic reference", { exact: true }),
  ).toBeVisible();
  const modeResponse = await page.request.get("/api/v1/me");
  expect(modeResponse.status()).toBe(200);
  const modeBody = await modeResponse.json();
  expect(modeBody.research_mode).toEqual({
    id: "synthetic_reference",
    label: "Synthetic reference",
    live_qualified: false,
  });
  expect(JSON.stringify(modeBody)).not.toMatch(
    /gemini|openrouter|providerId|modelId/iu,
  );
  await page.getByRole("button", { name: "New structured request" }).click();
  await page.getByLabel("Source language").selectOption("en");
  await page.getByLabel("Source-language input").fill(transientSource);
  await page.getByRole("button", { name: "Resolve product category" }).click();
  await expect(page.getByText(/product specification/u)).toBeVisible();

  await page.locator("details.standard-disclosure").evaluateAll((nodes) => {
    for (const node of nodes) node.open = true;
  });
  const stateControls = page.locator('select[id^="state-"]');
  expect(await stateControls.count()).toBeGreaterThanOrEqual(32);
  for (let index = 0; index < (await stateControls.count()); index += 1) {
    await stateControls.nth(index).selectOption("explicitly_unknown");
  }
  await addSyntheticHardConstraints(page);
  const canonicalResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/requests",
  );
  await page.getByRole("button", { name: "Prepare canonical English" }).click();
  const preparedResponse = await canonicalResponse;
  const preparedText = await preparedResponse.text();
  expect(preparedResponse.ok(), preparedText).toBe(true);
  await expect(
    page.getByRole("heading", {
      name: "Confirm the canonical English request",
    }),
  ).toBeVisible();
  await expect(page.getByText(/partially ready/u)).toBeVisible();
  const resultResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.status() === 200 &&
      response.request().method() === "GET" &&
      /\/api\/v1\/runs\/[^/]+\/result$/u.test(path)
    );
  });
  await page
    .getByRole("button", { name: "Confirm and start synthetic research" })
    .click();
  await expect(page.getByText("Standard result", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText("Synthetic evaluation data — not a sourcing result"),
  ).toBeVisible();
  const releasedResponse = await resultResponse;
  const releasedBody = await releasedResponse.text();
  const visibleBody = await page.locator("body").innerText();
  const browserState = JSON.stringify(await context.storageState());
  for (const canary of PERSON_RELEASE_CANARIES) {
    expect(releasedBody).not.toContain(canary);
    expect(visibleBody).not.toContain(canary);
    expect(browserState).not.toContain(canary);
  }
  await expect(
    page.getByText(/not probabilities or guarantees/u),
  ).toBeVisible();
  if (
    await page
      .getByRole("heading", { name: "No responsible match" })
      .isVisible()
  ) {
    await expect(
      page.getByText(/No padding or speculative candidate/u),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("heading", { name: "Responsible candidate comparison" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Six-dimension candidate comparison" }),
    ).toBeVisible();
  }
  await expectAxeClean(page, "Standard real-path result");
  await expect(page.getByText(transientSource, { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  expect(await overflowingElements(page)).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await applyWcagTextSpacing(page);
  expect(await overflowingElements(page)).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  expect(await overflowingElements(page)).toEqual([]);
  await expect(
    page.getByText("Standard result", { exact: true }),
  ).toBeVisible();
  expect(serverErrors).toEqual([]);

  const replayContext = await context
    .browser()
    .newContext({ baseURL: "http://127.0.0.1:3010" });
  const start = await replayContext.request.get(
    "/auth/simulator/start?fixture=standard",
    { maxRedirects: 0 },
  );
  expect(start.status()).toBe(302);
  const callback = start.headers().location;
  expect(callback).toContain("fixture=standard");
  expect(
    (await replayContext.request.get(callback, { maxRedirects: 0 })).status(),
  ).toBe(303);
  expect(
    (await replayContext.request.get(callback, { maxRedirects: 0 })).status(),
  ).toBe(404);
  await replayContext.close();
});

test("reconstructs history and renders deterministic no-match and scarcity paths accessibly", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const serverErrors = [];
  page.on("response", (response) => {
    if (response.status() >= 500)
      serverErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/auth/simulator/start?fixture=standard");
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();

  const longSource = `Industrial component model MX900 ${"bounded synthetic requirement ".repeat(80)}${randomUUID()}`;
  await createScenarioRequest(page, longSource, "zero", "zero-match phase");
  await expect(
    page.getByRole("heading", { name: "No responsible match" }),
  ).toBeVisible();
  await expect(page.locator(".scarcity-summary")).toContainText(
    "No candidate met the mandatory constraints for this request.",
  );
  await expect(
    page.getByRole("heading", {
      name: "Which mandatory constraints could not be met",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What you could relax" }),
  ).toBeVisible();
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  await expect(
    page.getByText(/No padding or speculative candidate/u),
  ).toBeVisible();
  const zeroText = await page.locator("body").innerText();
  for (const prohibited of [
    "No suppliers exist",
    "no results",
    "search failed",
    "empty",
  ])
    expect(zeroText.toLowerCase()).not.toContain(prohibited.toLowerCase());
  await expect(page.locator("body")).not.toContainText(longSource);
  await page.getByRole("button", { name: "Return to requests" }).click();
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Product request history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Research runs" }),
  ).toBeVisible();

  await createScenarioRequest(
    page,
    `Industrial component model MX900 scarcity-${randomUUID()}`,
    "two",
    "scarcity phase",
  );
  await expect(
    page.getByRole("heading", { name: "Responsible candidate comparison" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "2 candidates met all mandatory constraints. Fewer than three met them, so fewer than three are shown.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Which constraints reduced the set" }),
  ).toBeVisible();
  await expect(page.locator("article.candidate-card")).toHaveCount(2);
  const evidenceSummary = page.getByText(/Evidence and citations/u).first();
  await evidenceSummary.focus();
  await page.keyboard.press("Enter");
  await expect(evidenceSummary).toBeFocused();
  await expect(
    page.getByText(/Repository fixture \d+ supports/u).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Return to requests" }).click();
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  await createScenarioRequest(
    page,
    `Industrial component model MX900 single-${randomUUID()}`,
    "one",
    "single-candidate phase",
  );
  await expect(
    page.getByText(
      "1 candidate met all mandatory constraints. Fewer than three met them, so fewer than three are shown.",
    ),
  ).toBeVisible();
  await expect(page.locator("article.candidate-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Which constraints reduced the set" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.dir = "rtl";
  });
  await applyWcagTextSpacing(page);
  expect(await overflowingElements(page)).toEqual([]);
  await expectAxeClean(page, "Standard single-candidate history result");
  expect(serverErrors).toEqual([]);
});
