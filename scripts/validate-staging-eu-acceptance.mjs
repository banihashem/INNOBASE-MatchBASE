import { createHash } from "node:crypto";
import { chromium } from "playwright";

const option = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1])
    throw new Error(`${name} is required.`);
  return process.argv[index + 1];
};
const origin = new URL(option("--origin"));
const directServiceUrl = new URL(option("--direct-service-url"));
const candidateReadyAt = new Date(option("--candidate-ready-at"));
const candidateRevision = option("--candidate-revision");
const cdpEndpoint = process.env.MATCHBASE_EVIDENCE_CDP_ENDPOINT;
const googleEmail = process.env.MATCHBASE_EVIDENCE_GOOGLE_EMAIL;
if (
  origin.protocol !== "https:" ||
  directServiceUrl.protocol !== "https:" ||
  origin.origin === directServiceUrl.origin
)
  throw new Error(
    "Closed distinct HTTPS canary and service origins are required.",
  );
if (!Number.isFinite(candidateReadyAt.valueOf()) || !candidateRevision)
  throw new Error("Candidate readiness identity is invalid.");
if (
  !cdpEndpoint ||
  !/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/u.test(cdpEndpoint)
)
  throw new Error(
    "A loopback-only CDP endpoint is required for genuine Google OAuth transport.",
  );
if (!googleEmail || !/^[^\s@]+@[^\s@]+$/u.test(googleEmail))
  throw new Error("An exact non-secret Google test identity is required.");

const cycleStartedAt = new Date();
if (cycleStartedAt <= candidateReadyAt)
  throw new Error("Acceptance cycle did not begin after candidate readiness.");
const browser = await chromium.connectOverCDP(cdpEndpoint);
const context = browser.contexts()[0];
if (!context) throw new Error("No interactive browser context is connected.");
await context.clearCookies({ domain: origin.hostname });
const page = await context.newPage();
const observed = [];
page.on("response", (response) => {
  if (response.url().startsWith(origin.origin))
    observed.push({
      url: response.url(),
      status: response.status(),
      at: new Date().toISOString(),
    });
});

try {
  await page.goto(new URL("/auth/google/start", origin).href, {
    waitUntil: "domcontentloaded",
  });
  if (new URL(page.url()).hostname === "accounts.google.com") {
    const account = page.locator(`[data-identifier="${googleEmail}"]`).first();
    if ((await account.count()) === 1) await account.click();
    const consent = page
      .getByRole("button", { name: /Continue|Allow/u })
      .last();
    if ((await consent.count()) === 1) await consent.click();
  }
  await page.waitForURL(
    (url) => url.origin === origin.origin && url.pathname === "/",
    { timeout: 180_000 },
  );
  const callback = observed.find(
    (item) => new URL(item.url).pathname === "/auth/google/callback",
  );
  if (
    !callback ||
    !new URL(callback.url).searchParams.get("code") ||
    !new URL(callback.url).searchParams.get("state") ||
    callback.status >= 400
  )
    throw new Error(
      "A complete Google OAuth callback round-trip was not observed.",
    );
  const callbackStateSha256 = createHash("sha256")
    .update(new URL(callback.url).searchParams.get("state"))
    .digest("hex");
  const cookies = await context.cookies(origin.origin);
  const sessionCookie = cookies.find((item) =>
    item.name.endsWith("matchbase_session"),
  );
  const csrfCookie = cookies.find((item) =>
    item.name.endsWith("matchbase_csrf"),
  );
  if (!sessionCookie || !csrfCookie)
    throw new Error(
      "OAuth did not issue a new MatchBASE session and CSRF pair.",
    );
  const meResponse = await page.request.get(new URL("/api/v1/me", origin).href);
  const meEnvelope = meResponse.ok() ? await meResponse.json() : null;
  const me = meEnvelope?.data ?? meEnvelope;
  if (typeof me?.email !== "string" || !me.email.includes("@"))
    throw new Error("OAuth identity is incomplete.");

  const runResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).origin === origin.origin &&
      new URL(response.url()).pathname === "/api/v1/runs" &&
      response.request().method() === "POST",
    { timeout: 180_000 },
  );
  await page
    .getByLabel("What must be sourced?")
    .fill(
      "Synthetic acceptance: industrial component model MX900 for evaluation only.",
    );
  await page
    .getByLabel("What conditions cannot be compromised?")
    .fill(
      "Synthetic-only data; alloy construction; quantity 45; no real-user data.",
    );
  await page
    .getByLabel("What would improve the fit?")
    .fill(
      "Use the controlled qualification pipeline under the configured cost cap.",
    );
  await page
    .getByRole("button", { name: "Continue to English confirmation" })
    .click();
  await page
    .getByRole("heading", { name: "Confirm the normalized request" })
    .waitFor({ timeout: 180_000 });
  const canonicalObservedAt = new Date();
  await page.getByRole("button", { name: /Confirm and start/u }).click();
  const runResponse = await runResponsePromise;
  const runPayload =
    runResponse.status() === 202 ? await runResponse.json() : {};
  const runId = runPayload.data?.run_id ?? runPayload.run_id;
  if (!/^[0-9a-f-]{36}$/u.test(runId ?? ""))
    throw new Error("Fresh run identity is invalid.");
  const runCreatedAt = new Date();
  if (
    canonicalObservedAt <= candidateReadyAt ||
    runCreatedAt <= candidateReadyAt
  )
    throw new Error(
      "Fresh canonical request or run predates candidate readiness.",
    );

  await page
    .getByRole("heading", {
      name: /Eligible candidate summary|No responsible match/u,
    })
    .waitFor({ timeout: 900_000 });
  const resultObservedAt = new Date();
  const resultResponse = [...observed]
    .reverse()
    .find(
      (item) =>
        new URL(item.url).pathname === `/api/v1/runs/${runId}/result` &&
        item.status === 200,
    );
  if (!resultResponse || new Date(resultResponse.at) <= runCreatedAt)
    throw new Error("Terminal result for the fresh run was not observed.");
  const resultApi = await page.request.get(
    new URL(`/api/v1/runs/${runId}/result`, origin).href,
  );
  const resultEnvelope = await resultApi.json();
  const result = resultEnvelope.data ?? resultEnvelope;
  if (result.run_id !== runId)
    throw new Error("Result contract is not bound to the fresh run.");

  await page.getByRole("button", { name: /profile/i }).click();
  const pdfLink = page
    .locator(
      `a[data-matchbase-artifact-run-id="${runId}"][data-matchbase-artifact-version-id][data-matchbase-artifact-version]`,
    )
    .filter({ hasText: /PDF|report|download/i })
    .first();
  if ((await pdfLink.count()) !== 1)
    throw new Error(
      "The fresh result exposes no uniquely run-bound PDF grant.",
    );
  const pdfResponsePromise = page.waitForResponse(
    (response) =>
      response.url().startsWith(origin.origin) &&
      /\/api\/v1\/artifacts\/[0-9a-f-]{36}\/download$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await pdfLink.click();
  const pdfResponse = await pdfResponsePromise;
  const pdfBytes = await pdfResponse.body();
  if (
    pdfResponse.status() !== 200 ||
    pdfBytes.length < 1024 ||
    pdfBytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new Error("Fresh run PDF failed byte-level verification.");
  const grantId = /\/artifacts\/([0-9a-f-]{36})\/download$/u.exec(
    new URL(pdfResponse.url()).pathname,
  )?.[1];
  if (!grantId) throw new Error("PDF grant identity is absent.");
  const denied = await fetch(new URL("/api/v1/health", directServiceUrl), {
    redirect: "manual",
  });
  if (![401, 403, 404].includes(denied.status))
    throw new Error("Direct Cloud Run origin was not denied.");
  process.stdout.write(
    JSON.stringify({
      schema_version: "matchbase-eu-staging-acceptance.v2",
      acceptance: {
        oauth: "PASS",
        complete_research: "PASS",
        pdf: "PASS",
        origin_denial: "PASS",
      },
      candidate_revision: candidateRevision,
      candidate_ready_at: candidateReadyAt.toISOString(),
      cycle_started_at: cycleStartedAt.toISOString(),
      oauth_callback_at: callback.at,
      oauth_state_sha256: callbackStateSha256,
      canonical_observed_at: canonicalObservedAt.toISOString(),
      run_created_at: runCreatedAt.toISOString(),
      result_observed_at: resultObservedAt.toISOString(),
      run_id: runId,
      result_schema_version: result.schema_version,
      result_sha256: createHash("sha256")
        .update(JSON.stringify(result))
        .digest("hex"),
      artifact_grant_id: grantId,
      artifact_sha256: createHash("sha256").update(pdfBytes).digest("hex"),
      artifact_byte_size: pdfBytes.length,
      oauth_subject_user_id: me.subject?.user_id,
      public_canary_origin: origin.origin,
      direct_cloud_run_origin: directServiceUrl.origin,
    }),
  );
} finally {
  await page.close();
}
