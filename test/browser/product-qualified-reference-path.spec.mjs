import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createPool } from "../../packages/data/dist/index.js";
import {
  createLiveWorkerFixture,
  LIVE_WORKER_FIXTURE_POLICY,
  seedLiveWorkerFixture,
} from "../slice3/fixtures/live-worker-runtime.mjs";

const qualifiedBaseUrl = "http://127.0.0.1:3012";
const standaloneRoot = resolve("apps/web/.next/standalone/apps/web");
const serverPath = join(standaloneRoot, "server.js");

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${qualifiedBaseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Qualified-live test server did not become ready.");
}

async function expectResponsive(page, width, mode) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > innerWidth ||
          element.scrollWidth > element.clientWidth,
      )
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
  }));
  expect(
    Math.max(dimensions.body, dimensions.document),
    JSON.stringify({ mode, offenders: dimensions.offenders }),
  ).toBeLessThanOrEqual(width);
}

test("injected qualified-live API, worker, and UI remain truthful and accessible", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "matchbase-live-ui-"));
  const policyPath = join(directory, "qualified-policy.json");
  await writeFile(
    policyPath,
    `${JSON.stringify(LIVE_WORKER_FIXTURE_POLICY)}\n`,
    "utf8",
  );
  const credential = () => randomBytes(24).toString("base64url");
  const server = spawn(process.execPath, [serverPath], {
    cwd: standaloneRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: "3012",
      DATABASE_URL: process.env.DATABASE_URL,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_OIDC_SIMULATOR: "true",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_ORIGIN: qualifiedBaseUrl,
      MATCHBASE_DEPLOYMENT_ID: `qualified-ui-${Date.now()}`,
      MATCHBASE_DIGEST_KEY: randomBytes(32).toString("base64url"),
      MATCHBASE_LIVE_RESEARCH_ENABLED: "true",
      MATCHBASE_TEST_LIVE_POLICY_PATH: policyPath,
      MATCHBASE_GEMINI_API_KEY: credential(),
      MATCHBASE_OPENROUTER_API_KEY: credential(),
    },
  });
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  const context = await browser.newContext({ baseURL: qualifiedBaseUrl });
  const page = await context.newPage();
  try {
    await seedLiveWorkerFixture(pool);
    await waitForServer();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/auth/simulator/start");

    await expect(
      page.getByText(
        "Qualified live research — external evidence is fetched and verified for this run",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic evaluation data — not a sourcing result"),
    ).toHaveCount(0);
    const me = await page.request.get("/api/v1/me");
    const meBody = await me.json();
    expect(meBody).toMatchObject({
      research_mode: {
        id: "qualified_live_research",
        label: "Qualified live research",
        live_qualified: true,
      },
    });
    expect(JSON.stringify(meBody)).not.toMatch(
      /gemini|openrouter|provider|model|credential/iu,
    );

    await page
      .getByLabel("What must be sourced?")
      .fill("Source a verified industrial pump");
    await page
      .getByLabel("What conditions cannot be compromised?")
      .fill("Continuous duty and corrosion resistance");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Continue to English confirmation" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Confirm the normalized request" }),
    ).toBeFocused();

    const runResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/runs" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: "Confirm and start qualified live research",
      })
      .focus();
    await page.keyboard.press("Enter");
    const accepted = await (await runResponse).json();
    expect(accepted.research_mode).toEqual({
      id: "qualified_live_research",
      label: "Qualified live research",
      live_qualified: true,
    });
    expect(JSON.stringify(accepted)).not.toMatch(
      /gemini|openrouter|provider|model|credential/iu,
    );
    const attemptedOverride = await page.request.post("/api/v1/runs", {
      headers: {
        Origin: qualifiedBaseUrl,
        "X-CSRF-Token": meBody.csrf_token,
        "Idempotency-Key": `mode-override-${Date.now()}`,
      },
      data: {
        request_id: accepted.request_id,
        version: accepted.canonical_request_version,
        research_mode: "synthetic_reference",
      },
    });
    expect(attemptedOverride.status()).toBe(422);
    expect((await attemptedOverride.json()).code).toBe("MB-422-SCHEMA");
    const persisted = await pool.query(
      "SELECT research_mode FROM research_run WHERE run_id=$1",
      [accepted.run_id],
    );
    expect(persisted.rows).toEqual([
      { research_mode: "qualified_live_research" },
    ]);

    const dispatcher = await createLiveWorkerFixture(pool);
    expect(
      await dispatcher.dispatchNext(new AbortController().signal, 3),
    ).toContain(accepted.run_id);
    await expect(
      page.getByRole("heading", { name: "No responsible match" }),
    ).toBeFocused({ timeout: 15_000 });
    await expect(
      page.getByText(/Qualified live research used server-approved routes/iu),
    ).toBeVisible();
    await expect(
      page.getByText(/Synthetic evaluation data only/iu),
    ).toHaveCount(0);
    const disclosedText = (
      await page.locator("body").innerText()
    ).toLowerCase();
    for (const restrictedCanary of [
      "raw_provider_payload",
      "provider_topology",
      "served_provider_id",
      "served_model_id",
      "fallback_position",
      "prompt_tokens",
      "completion_tokens",
      "tool_calls",
    ]) {
      expect(disclosedText).not.toContain(restrictedCanary);
    }

    for (const mode of [
      { width: 390, fontSize: "100%", direction: "ltr" },
      { width: 1440, fontSize: "100%", direction: "ltr" },
      { width: 390, fontSize: "200%", direction: "ltr" },
      { width: 390, fontSize: "200%", direction: "rtl" },
    ]) {
      await page.setViewportSize({ width: mode.width, height: 900 });
      await page.evaluate(({ fontSize, direction }) => {
        document.documentElement.style.fontSize = fontSize;
        document.documentElement.dir = direction;
      }, mode);
      await expectResponsive(page, mode.width, mode);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  } finally {
    await context.close();
    await pool.end();
    if (server.exitCode === null) {
      const exited = new Promise((resolveExit) =>
        server.once("exit", resolveExit),
      );
      server.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
