import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomUUID } from "node:crypto";

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
    hard_constraints: canonical.hard_constraints,
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

async function overflowingElements(page) {
  return page.locator("body *").evaluateAll((elements) =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
      ? []
      : elements
          .filter((element) => {
            const rectangle = element.getBoundingClientRect();
            if (
              rectangle.right <= document.documentElement.clientWidth + 0.5 &&
              rectangle.left >= -0.5
            )
              return false;
            for (
              let ancestor = element.parentElement;
              ancestor && ancestor !== document.body;
              ancestor = ancestor.parentElement
            ) {
              const overflow = getComputedStyle(ancestor).overflowX;
              if (["auto", "scroll", "hidden", "clip"].includes(overflow))
                return false;
            }
            return true;
          })
          .slice(0, 12)
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            text: element.textContent?.trim().slice(0, 80),
            bounds: element.getBoundingClientRect().toJSON(),
          })),
  );
}

async function createScenarioRequest(
  page,
  sourceText,
  expectedScenario,
  phase = expectedScenario,
) {
  let canonical;
  for (let notAskedCount = 0; notAskedCount <= 12; notAskedCount += 1) {
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
      await expect(page.locator("h1.sr-only")).toHaveText(
        "Standard workspace: intake",
      );
      await expect(page.locator("h1.sr-only")).toBeFocused();
      await expect(
        sourceLanguage,
        `${phase}: source-language control did not become visible`,
      ).toBeVisible({ timeout: 20_000 });
    } catch (cause) {
      const state = await page.evaluate(() => ({
        url: window.location.href,
        screen: document.querySelector("h1.sr-only")?.textContent?.trim(),
        heading: document.querySelector("main h1:not(.sr-only), main h2")
          ?.textContent,
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
    await page
      .getByRole("button", { name: "Resolve product category" })
      .click();
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
    const canonicalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/requests",
    );
    await page
      .getByRole("button", { name: "Prepare canonical English" })
      .click();
    canonical = await (await canonicalResponse).json();
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
  await page.getByRole("button", { name: "Prepare canonical English" }).click();
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
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.getByText(transientSource, { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflowingElements(page)).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
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
  await expect(
    page.getByText(/No padding or speculative candidate/u),
  ).toBeVisible();
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
    page.getByRole("region", { name: "Request history table" }),
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
    page.getByText("Limited responsible candidate availability."),
  ).toBeVisible();
  await expect(page.locator("article.candidate-card")).toHaveCount(2);
  const evidenceSummary = page.getByText(/Evidence and citations/u).first();
  await evidenceSummary.focus();
  await page.keyboard.press("Enter");
  await expect(evidenceSummary).toBeFocused();
  await expect(
    page.getByText(/Repository fixture \d+ supports/u).first(),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.dir = "rtl";
  });
  expect(await overflowingElements(page)).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(serverErrors).toEqual([]);
});
