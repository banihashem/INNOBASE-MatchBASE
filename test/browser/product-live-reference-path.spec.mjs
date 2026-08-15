import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SOURCE_LANGUAGE_CANARIES } from "../../config/source-language-canaries.mjs";
import { createPool } from "../../packages/data/dist/index.js";
import { scanPostgresForCanaries } from "../../packages/security/dist/index.js";

const syntheticNotice = "Synthetic evaluation data — not a sourcing result";

test("standalone server delivers the product page, static assets, and health API", async ({
  request,
}) => {
  const pageResponse = await request.get("/");
  expect(pageResponse.status()).toBe(200);
  const html = await pageResponse.text();
  expect(html).toContain("MatchBASE");
  const staticAsset = html.match(
    /(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/u,
  )?.[1];
  expect(staticAsset).toBeTruthy();
  expect((await request.get(staticAsset)).status()).toBe(200);

  const health = await request.get("/api/v1/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok" });
});

async function expectAxeClean(page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("requires a signed single-use simulator transaction", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  try {
    const direct = await context.request.get(
      "/auth/simulator/callback?fixture=demo",
      { maxRedirects: 0 },
    );
    expect(direct.status()).toBe(404);

    const start = await context.request.get("/auth/simulator/start", {
      maxRedirects: 0,
    });
    expect(start.status()).toBe(302);
    const location = start.headers().location;
    expect(location).toContain("state=");
    expect(location).toContain("ticket=");
    const tampered = new URL(location, baseURL);
    tampered.searchParams.set("ticket", "tampered-ticket");
    expect(
      (
        await context.request.get(tampered.toString(), { maxRedirects: 0 })
      ).status(),
    ).toBe(404);

    const completed = await context.request.get(location, { maxRedirects: 0 });
    expect(completed.status()).toBe(303);
    const replay = await context.request.get(location, { maxRedirects: 0 });
    expect([403, 404]).toContain(replay.status());
  } finally {
    await context.close();
  }
});

test("enforces anonymous, CSRF, Origin, logout, and session-replay boundaries", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  try {
    for (const endpoint of [
      "/api/v1/me",
      "/api/v1/requests/00000000-0000-4000-8000-000000000099",
      "/api/v1/runs",
      "/api/v1/runs/00000000-0000-4000-8000-000000000099",
      "/api/v1/runs/00000000-0000-4000-8000-000000000099/result",
    ]) {
      const response = await context.request.get(endpoint);
      expect(response.status()).toBe(401);
      expect((await response.json()).code).toBe("MB-401-SESSION");
    }
    expect((await context.request.get("/auth/simulator/start")).status()).toBe(
      200,
    );
    const me = await context.request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    const csrfToken = (await me.json()).csrf_token;
    const unsafeEndpoints = [
      "/api/v1/requests",
      "/api/v1/requests/00000000-0000-4000-8000-000000000099/versions",
      "/api/v1/requests/00000000-0000-4000-8000-000000000099/versions/1/confirmation",
      "/api/v1/runs",
      "/api/v1/runs/00000000-0000-4000-8000-000000000099/cancellation",
      "/auth/logout",
    ];
    for (const [index, endpoint] of unsafeEndpoints.entries()) {
      for (const headers of [
        {
          Origin: "https://attacker.example.test",
          "X-CSRF-Token": csrfToken,
        },
        {
          Origin: "http://127.0.0.1:3010",
          "X-CSRF-Token": "wrong-csrf-token",
        },
      ]) {
        const response = await context.request.post(endpoint, {
          headers: {
            ...headers,
            "Idempotency-Key": `unsafe-matrix-${index}-fixture-key`,
          },
          data: {},
        });
        expect(response.status()).toBe(403);
        expect((await response.json()).code).toBe("MB-403-REQUEST");
      }
    }
    const priorSession = (await context.cookies()).find((item) =>
      item.name.endsWith("matchbase_session"),
    );
    expect(priorSession).toBeTruthy();
    const logout = await context.request.post("/auth/logout", {
      headers: {
        Origin: "http://127.0.0.1:3010",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": "logout-session-replay-fixture",
      },
      data: {},
    });
    expect(logout.status()).toBe(204);
    const replay = await browser.newContext({ baseURL });
    try {
      await replay.addCookies([
        {
          name: priorSession.name,
          value: priorSession.value,
          url: baseURL,
        },
      ]);
      const correlationId = `revoked-session-${Date.now()}`;
      const refusal = await replay.request.get("/api/v1/me", {
        headers: { "MB-Correlation-Id": correlationId },
      });
      expect(refusal.status()).toBe(401);
      expect((await refusal.json()).code).toBe("MB-401-SESSION");
      const pool = createPool({ connectionString: process.env.DATABASE_URL });
      try {
        const audit = await pool.query(
          `SELECT outcome, fields_released, detail
             FROM audit_event
            WHERE request_correlation_id = $1 AND event_type = 'access.denied'`,
          [correlationId],
        );
        expect(audit.rowCount).toBe(1);
        expect(audit.rows[0]).toMatchObject({
          outcome: "deny",
          fields_released: null,
          detail: {
            refusalCode: "MB-401-SESSION",
            resolutionStage: "session",
          },
        });
      } finally {
        await pool.end();
      }
    } finally {
      await replay.close();
    }
  } finally {
    await context.close();
  }
});

test("persists a sanitized denial before refusing a resolved subject without entitlement", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let revokedGrantIds = [];
  try {
    expect((await context.request.get("/auth/simulator/start")).status()).toBe(
      200,
    );
    const identity = await pool.query(
      `SELECT account_id, user_id FROM app_user
        WHERE google_sub LIKE 'simulator-demo-subject-v1:%'
        ORDER BY created_at DESC LIMIT 1`,
    );
    expect(identity.rowCount).toBe(1);
    const { account_id: accountId, user_id: userId } = identity.rows[0];
    const revoked = await pool.query(
      `UPDATE entitlement_grant SET revoked_at = clock_timestamp(), revoked_by_user_id = $2
        WHERE account_id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING grant_id`,
      [accountId, userId],
    );
    revokedGrantIds = revoked.rows.map((row) => row.grant_id);
    const correlationId = `missing-entitlement-${Date.now()}`;
    const refusal = await context.request.get("/api/v1/me", {
      headers: { "MB-Correlation-Id": correlationId },
    });
    expect(refusal.status()).toBe(403);
    expect(await refusal.json()).toEqual({
      type: "about:matchbase/errors/tier-not-entitled",
      title: "Forbidden",
      status: 403,
      code: "MB-403-TIER",
      detail: "Not entitled.",
      correlation_id: correlationId,
      retryable: false,
      errors: [],
    });
    const audit = await pool.query(
      `SELECT account_id, actor_user_id, actor_tier, outcome, fields_released, detail
         FROM audit_event
        WHERE request_correlation_id = $1 AND event_type = 'access.denied'`,
      [correlationId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]).toMatchObject({
      account_id: accountId,
      actor_user_id: userId,
      actor_tier: null,
      outcome: "deny",
      fields_released: null,
      detail: {
        refusalCode: "MB-403-TIER",
        resolutionStage: "entitlement",
      },
    });
  } finally {
    if (revokedGrantIds.length > 0) {
      await pool.query(
        "UPDATE entitlement_grant SET revoked_at = NULL, revoked_by_user_id = NULL WHERE grant_id = ANY($1::uuid[])",
        [revokedGrantIds],
      );
    }
    await pool.end();
    await context.close();
  }
});

test("completes the real simulator, HTTP, PostgreSQL, worker, and Demo result path", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const failures = [];
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(response.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText(syntheticNotice)).toBeVisible();
  await expect(
    page.getByText("Synthetic reference", { exact: true }),
  ).toBeVisible();
  await expectAxeClean(page);

  await page.getByRole("link", { name: "Continue with Google" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:3010/");
  await expect(
    page.getByRole("heading", { name: "Frame the request" }),
  ).toBeFocused();
  await expect(page.getByText("3 of 3")).toBeVisible();
  await expectAxeClean(page);
  const meResponse = await page.request.get("/api/v1/me");
  expect(meResponse.status()).toBe(200);
  const meBody = await meResponse.json();
  expect(meBody.research_mode).toEqual({
    id: "synthetic_reference",
    label: "Synthetic reference",
    live_qualified: false,
  });
  expect(JSON.stringify(meBody)).not.toMatch(
    /gemini|openrouter|providerId|modelId/iu,
  );
  expect(meBody.quota).toMatchObject({ limit: 3, used: 0, remaining: 3 });
  const csrfToken = meBody.csrf_token;
  const unsafeHeaders = (idempotencyKey) => ({
    Origin: "http://127.0.0.1:3010",
    "X-CSRF-Token": csrfToken,
    "Idempotency-Key": idempotencyKey,
  });
  const privacyPool = createPool({
    connectionString: process.env.DATABASE_URL,
  });
  let visibleRequestId;
  try {
    for (const [index, canary] of SOURCE_LANGUAGE_CANARIES.entries()) {
      const sourceWithProtectedSpans = `${canary} MX900 HS-CODE 45 kg`;
      const response = await page.request.post("/api/v1/requests", {
        headers: unsafeHeaders(`http-canary-${index}-${Date.now()}-key`),
        data: {
          source_text: sourceWithProtectedSpans,
          presented_fields: [
            "need",
            "mandatory_constraints",
            "preferences_context",
          ],
          unknown_fields: ["preferences_context"],
        },
      });
      expect(response.status()).toBe(201);
      const canonical = await response.json();
      visibleRequestId ??= canonical.request_id;
      expect(
        canonical.protected_spans.map((span) => [
          span.category,
          span.canonicalValue,
        ]),
      ).toEqual([
        ["model", "MX900"],
        ["code_enum", "HS-CODE"],
        ["quantity_unit", "45 kg"],
      ]);
      for (const value of ["MX900", "HS-CODE", "45 kg"])
        expect(canonical.canonical_text.split(value)).toHaveLength(2);
      expect(canonical.canonical_text).not.toContain(sourceWithProtectedSpans);
      await expect(
        scanPostgresForCanaries(privacyPool, SOURCE_LANGUAGE_CANARIES),
      ).resolves.toMatchObject({ tables: expect.any(Number) });
    }
  } finally {
    await privacyPool.end();
  }
  expect(visibleRequestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  for (const [index, body] of [
    { request_id: 7, version: 1 },
    { request_id: "malformed", version: 1 },
    { request_id: "00000000-0000-4000-8000-000000000099", version: 1 },
  ].entries()) {
    const refusal = await page.request.post("/api/v1/runs", {
      headers: unsafeHeaders(`run-body-refusal-${index}-${Date.now()}`),
      data: body,
    });
    expect(refusal.status()).toBe(403);
    expect((await refusal.json()).code).toBe("MB-403-RESOURCE");
  }
  for (const [index, data] of [
    {
      canonical_text: 42,
      fields: [],
      readiness: "ready",
    },
    {
      canonical_text: "Valid English canonical text",
      readiness: "ready",
      fields: [
        {
          fieldId: "need",
          path: "product.need",
          valueState: "provided",
          languageOrigin: "entered_in_english",
          canonicalValue: { nested: "not a string" },
        },
      ],
    },
    {
      canonical_text: "Valid English canonical text",
      readiness: "ready",
      fields: [],
      unexpected: true,
    },
  ].entries()) {
    const refusal = await page.request.post(
      `/api/v1/requests/${visibleRequestId}/versions`,
      {
        headers: unsafeHeaders(`closed-dto-${index}-${Date.now()}-key`),
        data,
      },
    );
    expect(refusal.status()).toBe(422);
    expect((await refusal.json()).code).toBe("MB-422-SCHEMA");
  }
  const invisibleIds = ["deadbeef", "00000000-0000-4000-8000-000000000099"];
  for (const invisibleId of invisibleIds) {
    for (const endpoint of [
      `/api/v1/requests/${invisibleId}`,
      `/api/v1/runs/${invisibleId}`,
      `/api/v1/runs/${invisibleId}/result`,
    ]) {
      const refusal = await page.request.get(endpoint);
      expect(refusal.status()).toBe(403);
      expect((await refusal.json()).code).toBe("MB-403-RESOURCE");
    }
    const cancellation = await page.request.post(
      `/api/v1/runs/${invisibleId}/cancellation`,
      {
        headers: {
          Origin: "http://127.0.0.1:3010",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": `invisible-${invisibleId}-refusal`,
        },
        data: {},
      },
    );
    expect(cancellation.status()).toBe(403);
    expect((await cancellation.json()).code).toBe("MB-403-RESOURCE");
    for (const endpoint of [
      `/api/v1/requests/${invisibleId}/versions`,
      `/api/v1/requests/${invisibleId}/versions/1/confirmation`,
    ]) {
      const refusal = await page.request.post(endpoint, {
        headers: {
          Origin: "http://127.0.0.1:3010",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": `invisible-version-${invisibleId}-key`,
        },
        data: {},
      });
      expect(refusal.status()).toBe(403);
      expect((await refusal.json()).code).toBe("MB-403-RESOURCE");
    }
  }

  const sourceFixture = SOURCE_LANGUAGE_CANARIES[1];
  await page.getByLabel("What must be sourced?").fill(sourceFixture);
  await page
    .getByLabel("What conditions cannot be compromised?")
    .fill("Continuous operation and corrosion resistance");
  await page.getByRole("checkbox").check();
  const requestResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/requests" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Continue to English confirmation" })
    .click();
  expect((await requestResponse).status()).toBe(201);
  const postUiScanPool = createPool({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await expect(
      scanPostgresForCanaries(postUiScanPool, SOURCE_LANGUAGE_CANARIES),
    ).resolves.toMatchObject({ tables: expect.any(Number) });
  } finally {
    await postUiScanPool.end();
  }
  await expect(
    page.getByRole("heading", { name: "Confirm the normalized request" }),
  ).toBeFocused();
  await expect(page.getByText(sourceFixture)).toHaveCount(0);
  await expectAxeClean(page);

  const runResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/runs" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirm and start research" })
    .focus();
  await page.keyboard.press("Enter");
  expect((await runResponse).status()).toBe(202);
  await expect(
    page.getByRole("heading", { name: "Research in progress" }),
  ).toBeFocused();
  const reducedMotion = await page
    .locator(".indeterminate")
    .evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      const duration = style.animationDuration;
      return {
        durationMs: duration.endsWith("ms")
          ? Number.parseFloat(duration)
          : Number.parseFloat(duration) * 1000,
        iterations: style.animationIterationCount,
      };
    });
  expect(reducedMotion.durationMs).toBeLessThanOrEqual(0.01);
  expect(reducedMotion.iterations).toBe("1");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const normalMotion = await page
    .locator(".indeterminate")
    .evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      const duration = style.animationDuration;
      return {
        durationMs: duration.endsWith("ms")
          ? Number.parseFloat(duration)
          : Number.parseFloat(duration) * 1000,
        iterations: style.animationIterationCount,
      };
    });
  expect(normalMotion.durationMs).toBeGreaterThan(0.01);
  expect(normalMotion.iterations).toBe("infinite");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectAxeClean(page);

  await expect(
    page.getByRole("heading", { name: "Eligible candidate summary" }),
  ).toBeFocused({ timeout: 15_000 });
  await expect(page.locator(".candidate-grid > li")).toHaveCount(3);
  await expectAxeClean(page);
  const overflow = await page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  );
  expect(overflow).toBeLessThanOrEqual(390);
  expect(failures).toEqual([]);
});

test("cancels an actual queued run with keyboard and preserves terminal focus", async ({
  page,
}) => {
  test.setTimeout(35_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/auth/simulator/start");
  await expect(
    page.getByRole("heading", { name: "Frame the request" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "Research in progress" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel research" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Research cancelled" }),
  ).toBeFocused();
  await expect(page.getByRole("status")).toContainText(
    "No result was disclosed",
  );
  await expectAxeClean(page);
});
