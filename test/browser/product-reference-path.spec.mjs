import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const syntheticNotice = "Synthetic evaluation data — not a sourcing result";
const prohibitedLabels = [
  "Compatibility score",
  "Fit band",
  "Citations",
  "Verification status",
  "Evidence count",
  "Hidden count",
  "Reserve candidate",
  "Download PDF",
  "Export",
];

async function expectAxeClean(page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL || !/:(?:3000|3010)(?:\/|$)/u.test(baseURL),
    "Product UI runs in the dedicated web Playwright project.",
  );
});

function candidate(index) {
  return {
    display_name: `Fixture Works ${index + 1}`,
    country_code: ["DE", "JP", "CA"][index],
    rationale_short: "Meets every stated mandatory synthetic constraint.",
  };
}

async function installReferenceApi(
  page,
  { candidateCount, contradiction = false },
) {
  let signedIn = false;
  let pollCount = 0;
  let currentVersion = 1;

  const authenticate = async (route) => {
    signedIn = true;
    await route.fulfill({ status: 302, headers: { location: "/" }, body: "" });
  };
  await page.route("**/auth/google/start", authenticate);
  await page.route("**/auth/simulator/start", authenticate);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });

    if (url.pathname === "/api/v1/me") {
      if (!signedIn) {
        return json(
          {
            error: {
              detail: "Authentication is required.",
              correlation_id: "correlation-auth-fixture",
            },
          },
          401,
        );
      }
      return json({
        display_name: "Demo Evaluator",
        tier: "demo",
        quota: {
          limit: 3,
          used: 1,
          remaining: 2,
          next_capacity_at: "2026-08-21T09:30:00.000Z",
        },
        execution: { active: 1, capacity: 3 },
        csrf_token: "fixture-csrf-value",
        environment: "test",
        research_mode: {
          id: "synthetic_reference",
          label: "Synthetic reference",
          live_qualified: false,
        },
      });
    }

    if (url.pathname === "/api/v1/requests" && request.method() === "POST") {
      return json({
        request_id: "request-reference",
        canonical_version_id: "canonical-reference-1",
        version: 1,
        canonical_language: "en",
        canonical_text:
          "Source a corrosion-resistant industrial pump for continuous service.",
        source_language_tag: "fa",
        source_language_confidence: 0.99,
        fields: [
          {
            fieldId: "field-product",
            path: "product.need",
            canonicalValue: "Corrosion-resistant industrial pump",
            languageOrigin: "translated",
          },
          {
            fieldId: "field-capacity",
            path: "constraint.capacity",
            canonicalValue: "Continuous service",
            languageOrigin: "translated",
          },
        ],
        match_readiness: contradiction ? "not_ready" : "ready",
        contradictions: contradiction ? ["constraint.location.conflict"] : [],
      });
    }

    if (/\/api\/v1\/requests\/[^/]+\/versions$/u.test(url.pathname)) {
      currentVersion = 2;
      return json({
        request_id: "request-reference",
        canonical_version_id: "canonical-reference-2",
        version: 2,
        canonical_language: "en",
        canonical_text:
          "Source a corrosion-resistant industrial pump for continuous service in Germany.",
        source_language_tag: "fa",
        source_language_confidence: 0.99,
        fields: [
          {
            fieldId: "field-product",
            path: "product.need",
            canonicalValue: "Corrosion-resistant industrial pump",
            languageOrigin: "translated",
          },
        ],
        match_readiness: "ready",
        contradictions: [],
      });
    }

    if (url.pathname.endsWith("/confirmation")) return json({ accepted: true });

    if (url.pathname === "/api/v1/runs" && request.method() === "POST") {
      expect(currentVersion).toBe(contradiction ? 2 : 1);
      return json(
        {
          run_id: "run-reference",
          state: "queued",
          phase_label: "Queued for fixture evaluation",
          terminal: false,
          result_available: false,
          poll_after_ms: 250,
          progress: {
            steps_completed: 0,
            steps_total_planned: 5,
            percent_complete: null,
          },
          links: {
            result: null,
            cancel: "/api/v1/runs/run-reference/cancellation",
          },
        },
        202,
      );
    }

    if (
      url.pathname === "/api/v1/runs/run-reference" &&
      request.method() === "GET"
    ) {
      pollCount += 1;
      return json({
        run_id: "run-reference",
        state: "complete",
        phase_label: "Fixture evaluation complete",
        terminal: true,
        result_available: true,
        poll_after_ms: null,
        progress: {
          steps_completed: 5,
          steps_total_planned: 5,
          percent_complete: 100,
        },
        links: {
          result: "/api/v1/runs/run-reference/result",
          cancel: "/api/v1/runs/run-reference/cancellation",
        },
      });
    }

    if (url.pathname === "/api/v1/runs/run-reference/result") {
      return json({
        schema_version: "demo-projection.v1",
        run_id: "run-reference",
        outcome: candidateCount === 0 ? "no_responsible_match" : "matched",
        scarcity:
          candidateCount === 0
            ? "zero"
            : candidateCount < 3
              ? "limited"
              : "none",
        candidates: Array.from({ length: candidateCount }, (_, index) =>
          candidate(index),
        ),
        unmet_mandatory_constraints:
          candidateCount === 0 ? ["Required synthetic capacity"] : [],
        limitations_notice:
          "Synthetic fixtures do not establish supplier availability, suitability, or verification.",
        projection_version: 1,
      });
    }

    if (url.pathname.endsWith("/cancellation")) {
      return json({ run_id: "run-reference", state: "cancelled" });
    }

    return json({ error: { detail: "Unhandled fixture endpoint." } }, 404);
  });
}

for (const scenario of [
  {
    name: "mobile zero-match",
    viewport: { width: 390, height: 844 },
    count: 0,
  },
  {
    name: "desktop three-result",
    viewport: { width: 1440, height: 900 },
    count: 3,
  },
  {
    name: "desktop limited-scarcity",
    viewport: { width: 1024, height: 768 },
    count: 1,
  },
]) {
  test(`completes the signed-out multilingual reference path at ${scenario.name}`, async ({
    page,
  }) => {
    const errors = [];
    const unauthorizedResponses = [];
    page.on("response", (response) => {
      if (response.status() === 401) {
        unauthorizedResponses.push(new URL(response.url()).pathname);
      }
    });
    page.on("console", (message) => {
      const text = message.text();
      const expectedSignedOutProbe =
        message.type() === "error" &&
        text ===
          "Failed to load resource: the server responded with a status of 401 (Unauthorized)";
      if (message.type() === "error" && !expectedSignedOutProbe) {
        errors.push(text);
      }
    });
    await page.setViewportSize(scenario.viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installReferenceApi(page, {
      candidateCount: scenario.count,
      contradiction: scenario.count === 3,
    });

    await page.goto("/");
    await expect(page.getByText(syntheticNotice)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Define an industrial sourcing need",
    );
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    expect(
      await page
        .locator(".skip-link")
        .evaluate((element) => getComputedStyle(element).outlineStyle),
    ).not.toBe("none");
    await expectAxeClean(page);

    await page.getByRole("link", { name: "Continue with Google" }).click();
    await expect(
      page.getByRole("heading", { name: "Frame the request" }),
    ).toBeFocused();
    await expect(page.getByText("2 of 3")).toBeVisible();
    await expect(page.getByText(syntheticNotice)).toBeVisible();
    await expectAxeClean(page);

    const sourceFixture = String.fromCodePoint(
      0x067e,
      0x0645,
      0x067e,
      0x0020,
      0x0636,
      0x062f,
      0x0020,
      0x062e,
      0x0648,
      0x0631,
      0x0646,
      0x062f,
      0x06af,
      0x06cc,
    );
    await page.getByLabel("What must be sourced?").fill(sourceFixture);
    await page
      .getByLabel("What conditions cannot be compromised?")
      .fill("Continuous operation and corrosion resistance");
    await page
      .getByRole("checkbox", {
        name: "This information is unknown or not applicable",
      })
      .check();
    await page
      .getByRole("button", { name: "Continue to English confirmation" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Confirm the normalized request" }),
    ).toBeFocused();
    await expect(page.getByText(sourceFixture)).toHaveCount(0);
    await expect(page.getByText("Translated").first()).toBeVisible();
    await expectAxeClean(page);

    if (scenario.count === 3) {
      await expect(
        page.getByRole("heading", { name: "Contradictions block research" }),
      ).toBeVisible();
      await expectAxeClean(page);
      await page
        .getByLabel("English canonical form")
        .fill(
          "Source a corrosion-resistant industrial pump for continuous service in Germany.",
        );
      await page
        .getByRole("button", { name: "Create corrected version" })
        .click();
      await expect(
        page.getByText("English canonical request · Version 2"),
      ).toBeVisible();
    }

    await page
      .getByRole("button", { name: "Confirm and start research" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Research in progress" }),
    ).toBeFocused();
    await expect(page.getByRole("status")).toContainText(
      "Queued for fixture evaluation",
    );
    await expect(page.getByText(syntheticNotice)).toBeVisible();
    await expectAxeClean(page);

    const expectedHeading =
      scenario.count === 0
        ? "No responsible match"
        : "Eligible candidate summary";
    await expect(
      page.getByRole("heading", { name: expectedHeading }),
    ).toBeFocused();
    await expect(page.locator(".candidate-grid > li")).toHaveCount(
      scenario.count,
    );
    if (scenario.count === 0) {
      await expect(
        page.getByText(
          "No candidate met every mandatory constraint in this synthetic evaluation.",
        ),
      ).toBeVisible();
      await expect(page.getByText(/no suppliers exist/i)).toHaveCount(0);
    } else if (scenario.count < 3) {
      await expect(page.getByRole("status")).toContainText(/fewer than three/i);
    }
    for (const label of prohibitedLabels) {
      await expect(page.getByText(label, { exact: false })).toHaveCount(0);
    }
    await expectAxeClean(page);

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(Math.max(overflow.body, overflow.document)).toBeLessThanOrEqual(
      overflow.viewport,
    );
    expect(unauthorizedResponses.length).toBeGreaterThan(0);
    expect(new Set(unauthorizedResponses)).toEqual(new Set(["/api/v1/me"]));
    expect(errors).toEqual([]);
  });
}

test("announces cancellation and restores focus to the terminal heading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installReferenceApi(page, { candidateCount: 1 });
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page
    .getByLabel("What must be sourced?")
    .fill("Synthetic fixture product");
  await page
    .getByLabel("What conditions cannot be compromised?")
    .fill("Synthetic fixture constraint");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue to English confirmation" })
    .click();
  await page
    .getByRole("button", { name: "Confirm and start research" })
    .click();
  await page.getByRole("button", { name: "Cancel research" }).click();
  await expect(
    page.getByRole("heading", { name: "Research cancelled" }),
  ).toBeFocused();
  await expect(page.getByRole("status")).toContainText(
    "No result was disclosed",
  );
  await expect(page.getByText(syntheticNotice)).toBeVisible();
  await expectAxeClean(page);
});

test("exposes accessible loading and network-error states", async ({
  page,
}) => {
  await installReferenceApi(page, { candidateCount: 1 });
  await page.route("**/api/v1/requests", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          detail: "Synthetic network failure.",
          correlation_id: "network-error-fixture",
          retryable: true,
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByLabel("What must be sourced?").fill("Synthetic product");
  await page
    .getByLabel("What conditions cannot be compromised?")
    .fill("Synthetic constraint");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Continue to English confirmation" })
    .click({ noWaitAfter: true });
  await expect(
    page.getByRole("button", { name: "Creating English canonical form…" }),
  ).toBeDisabled();
  await expectAxeClean(page);
  await expect(page.locator(".error-summary")).toContainText(
    "Synthetic network failure.",
  );
  await expect(page.locator(".error-summary")).toBeFocused();
  await expectAxeClean(page);
});

test("completes the reference path using keyboard controls only", async ({
  page,
}) => {
  await installReferenceApi(page, { candidateCount: 1 });
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Frame the request" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("What must be sourced?")).toBeFocused();
  await page.keyboard.type("Keyboard synthetic product");
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("What conditions cannot be compromised?"),
  ).toBeFocused();
  await page.keyboard.type("Keyboard synthetic constraint");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("What would improve the fit?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Continue to English confirmation" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Confirm the normalized request" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Confirm and start research" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Eligible candidate summary" }),
  ).toBeFocused();
  await expectAxeClean(page);
});
