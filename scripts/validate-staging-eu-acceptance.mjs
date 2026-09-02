import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";

const EXACT_AGRICULTURAL_REQUEST =
  "Procurement request for three containers of high-quality Iranian Ahmad Aghaei pistachios. The shipment must be routed via Dubai for distribution in the African market. The supplier should have at least one container currently available in stock.";
const MAX_INTERACTIVE_P95_MS = 5_000;
const LATENCY_SAMPLE_COUNT = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

const unwrap = (value) => value?.data ?? value;
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const percentile95 = (samples) => {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
};
const requireJson = async (response, label) => {
  const body = await response.json().catch(() => null);
  if (!response.ok())
    throw new Error(`${label} returned HTTP ${response.status()}.`);
  return unwrap(body);
};

async function fillProvidedField(page, field) {
  await page.locator(`#state-${field.id}`).selectOption("provided");
  await page
    .getByLabel(`${field.label} value`, { exact: true })
    .fill(field.value);
  if (field.unit)
    await page
      .getByLabel(`${field.label} unit`, { exact: true })
      .selectOption(field.unit);
  if (field.raw)
    await page
      .getByLabel(`${field.label} raw expression`, { exact: true })
      .fill(field.raw);
}

async function assertResponsivePage(page, path, heading) {
  await page.goto(new URL(path, origin).href, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: heading }).waitFor({
    timeout: 60_000,
  });
  const modes = [
    { width: 390, height: 844, fontSize: "100%", direction: "ltr" },
    { width: 1_440, height: 900, fontSize: "100%", direction: "ltr" },
    { width: 320, height: 844, fontSize: "200%", direction: "rtl" },
  ];
  const checks = [];
  for (const mode of modes) {
    await page.setViewportSize({ width: mode.width, height: mode.height });
    const result = await page.evaluate(({ fontSize, direction }) => {
      document.documentElement.style.fontSize = fontSize;
      document.documentElement.dir = direction;
      const offenders = [...document.querySelectorAll("body *")]
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
            if (
              ["auto", "scroll"].includes(getComputedStyle(ancestor).overflowX)
            )
              return false;
          }
          return true;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          class_name: String(element.className).slice(0, 120),
          left: Math.round(element.getBoundingClientRect().left),
          right: Math.round(element.getBoundingClientRect().right),
        }));
      return {
        viewport_width: document.documentElement.clientWidth,
        document_width: document.documentElement.scrollWidth,
        offender_count: offenders.length,
        offenders,
      };
    }, mode);
    if (
      result.document_width > result.viewport_width + 1 ||
      result.offender_count !== 0
    )
      throw new Error(
        `Responsive acceptance failed for ${path} at ${mode.width}px: ${JSON.stringify(result.offenders)}.`,
      );
    checks.push({ path, ...mode, ...result });
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
    document.documentElement.dir = "";
  });
  return checks;
}

async function completeGoogleOauth(page) {
  const deadline = Date.now() + 180_000;
  let exactAccountSelected = false;
  while (Date.now() < deadline) {
    const current = new URL(page.url());
    if (current.origin === origin.origin && current.pathname === "/") return;
    if (current.hostname !== "accounts.google.com")
      throw new Error("Google OAuth left the closed Google/Canary origin set.");
    if (!exactAccountSelected) {
      const exactAccount = page
        .locator(`[data-identifier="${googleEmail}"]`)
        .first();
      if (await exactAccount.isVisible().catch(() => false)) {
        await exactAccount.click();
        exactAccountSelected = true;
        await page.waitForTimeout(500);
        continue;
      }
    }
    const consent = page
      .getByRole("button", { name: /^(?:Continue|Allow)$/u })
      .last();
    if (await consent.isVisible().catch(() => false)) {
      await consent.click();
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    "The exact pre-authenticated Google acceptance identity did not complete OAuth.",
  );
}

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
  await completeGoogleOauth(page);
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
  const me = await requireJson(meResponse, "OAuth identity read");
  if (
    typeof me?.email !== "string" ||
    me.email.toLocaleLowerCase("en") !== googleEmail.toLocaleLowerCase("en") ||
    typeof me.user_display_name !== "string" ||
    !me.user_display_name.trim() ||
    me.user_display_name.trim().toLocaleLowerCase("en") === "google user" ||
    me.tier !== "admin" ||
    !Array.isArray(me.admin_sub_roles) ||
    !me.admin_sub_roles.includes("super_admin") ||
    typeof me.csrf_token !== "string" ||
    !UUID_PATTERN.test(me.subject?.user_id ?? "")
  )
    throw new Error(
      "OAuth identity is not the exact stored Super-admin acceptance subject.",
    );

  await page.goto(new URL("/admin/product", origin).href, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "New structured request" })
    .waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "New structured request" }).click();
  await page
    .getByLabel("Source-language input")
    .fill(EXACT_AGRICULTURAL_REQUEST);
  const initialResolutionPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).origin === origin.origin &&
      new URL(response.url()).pathname === "/api/v1/domain-packs/resolution" &&
      response.request().method() === "POST",
    { timeout: 180_000 },
  );
  await page.getByRole("button", { name: "Resolve product category" }).click();
  let resolution = await requireJson(
    await initialResolutionPromise,
    "Agricultural category resolution",
  );
  if (resolution.activation_state === "confirmation_required") {
    const confirmCategory = page.getByRole("button", {
      name: "Confirm category",
    });
    await confirmCategory.waitFor({ timeout: 60_000 });
    const confirmedResolutionPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).origin === origin.origin &&
        new URL(response.url()).pathname ===
          "/api/v1/domain-packs/resolution" &&
        response.request().method() === "POST",
      { timeout: 180_000 },
    );
    await confirmCategory.click();
    resolution = await requireJson(
      await confirmedResolutionPromise,
      "Confirmed agricultural category resolution",
    );
  }
  if (
    resolution.activation_state !== "confirmed" ||
    resolution.category_id !== "food_agricultural_commodities"
  )
    throw new Error(
      "The exact agricultural request did not resolve to the governed agricultural domain pack.",
    );
  await page.locator("#state-commodity_variety").waitFor({ timeout: 60_000 });
  await page.locator("details.standard-disclosure").evaluateAll((details) => {
    for (const detail of details) detail.open = true;
  });
  const providedFields = [
    {
      id: "FLD-CORE-PS-01",
      label: "product_category",
      value: "Pistachios",
    },
    {
      id: "FLD-CORE-PS-03",
      label: "product_name_raw",
      value: "High-quality Iranian Ahmad Aghaei pistachios",
    },
    {
      id: "FLD-CORE-SP-03",
      label: "producer_vs_intermediary",
      value: "Producer or export supplier",
    },
    {
      id: "FLD-CORE-TR-01",
      label: "demand_volume",
      value: "3",
      raw: "three containers",
    },
    {
      id: "FLD-CORE-TR-02",
      label: "destination_market",
      value: "African market",
    },
    {
      id: "FLD-CORE-TR-09",
      label: "relaxable_constraints",
      value: "No explicitly relaxable constraints",
    },
    {
      id: "FLD-CORE-TR-10",
      label: "non_relaxable_constraints",
      value: "Shipment must be routed via Dubai",
    },
    { id: "commodity_variety", label: "Variety", value: "Ahmad Aghaei" },
    {
      id: "commodity_grade",
      label: "Grade and quality",
      value: "High quality",
    },
    { id: "commodity_origin", label: "Origin", value: "Iranian origin" },
    {
      id: "container_quantity",
      label: "Container quantity",
      value: "3",
      unit: "container",
    },
    { id: "routing_via", label: "Required route", value: "Dubai" },
    {
      id: "distribution_destination",
      label: "Destination market",
      value: "African market",
    },
    {
      id: "current_stock",
      label: "Current stock",
      value: "1",
      unit: "container",
      raw: "currently available in stock",
    },
  ];
  for (const field of providedFields) await fillProvidedField(page, field);
  await page.getByRole("button", { name: "Add hard constraint" }).click();
  const routingConstraint = page.getByRole("group", {
    name: "Hard constraint 1",
  });
  await routingConstraint
    .getByLabel("Constraint field")
    .selectOption({ label: "Required route" });
  await routingConstraint.getByLabel("Required value").fill("Dubai");
  await routingConstraint
    .getByLabel("Relaxability")
    .selectOption("non_relaxable");
  const canonicalResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).origin === origin.origin &&
      new URL(response.url()).pathname === "/api/v1/requests" &&
      response.request().method() === "POST",
    { timeout: 180_000 },
  );
  await page.getByRole("button", { name: "Prepare canonical English" }).click();
  const canonical = await requireJson(
    await canonicalResponsePromise,
    "Agricultural canonical request",
  );
  await page
    .getByRole("heading", { name: "Confirm the canonical English request" })
    .waitFor({ timeout: 180_000 });
  const canonicalObservedAt = new Date();
  const routingHardConstraints = (canonical.hard_constraints ?? []).filter(
    (constraint) => constraint.field_id === "routing_via",
  );
  const currentStockFields = (canonical.fields ?? []).filter(
    (field) => field.field_id === "current_stock",
  );
  if (
    (await page.getByText(/Readiness:\s*ready/iu).count()) !== 1 ||
    canonicalObservedAt <= candidateReadyAt ||
    canonical.domain_pack?.category_id !== "food_agricultural_commodities" ||
    routingHardConstraints.length !== 1 ||
    routingHardConstraints[0].relaxability !== "non_relaxable" ||
    routingHardConstraints[0].target?.value !== "Dubai" ||
    currentStockFields.length !== 1 ||
    currentStockFields[0].typed_value?.value_state !== "provided" ||
    currentStockFields[0].typed_value?.value !== "1" ||
    (canonical.hard_constraints ?? []).some(
      (constraint) => constraint.field_id === "current_stock",
    )
  )
    throw new Error(
      "The exact agricultural canonical request is absent, stale, or misclassifies its mandatory route and stock preference.",
    );

  const runResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).origin === origin.origin &&
      new URL(response.url()).pathname === "/api/v1/runs" &&
      response.request().method() === "POST",
    { timeout: 180_000 },
  );
  await page
    .getByRole("button", {
      name: "Confirm and start qualified live research",
    })
    .click();
  const runResponse = await runResponsePromise;
  const runPayload = await requireJson(runResponse, "Fresh run creation");
  const runId = runPayload?.run_id;
  if (!UUID_PATTERN.test(runId ?? ""))
    throw new Error("Fresh run identity is invalid.");
  const runCreatedAt = new Date();
  if (runCreatedAt <= candidateReadyAt)
    throw new Error("Fresh run predates candidate readiness.");

  let terminalRun;
  const terminalDeadline = Date.now() + 900_000;
  while (Date.now() < terminalDeadline) {
    const statusResponse = await page.request.get(
      new URL(`/api/v1/runs/${runId}`, origin).href,
    );
    terminalRun = await requireJson(statusResponse, "Fresh run status");
    if (terminalRun.terminal) break;
    await sleep(
      Math.max(
        1_000,
        Math.min(Number(terminalRun.poll_after_ms) || 2_000, 10_000),
      ),
    );
  }
  if (
    !terminalRun?.terminal ||
    !terminalRun.result_available ||
    terminalRun.state !== "completed" ||
    !["matched", "no_responsible_match"].includes(terminalRun.outcome)
  )
    throw new Error(
      "The exact agricultural run did not reach a result-bearing terminal state.",
    );

  let profile;
  let profileRun;
  const profileDeadline = Date.now() + 180_000;
  while (Date.now() < profileDeadline) {
    const profileResponse = await page.request.get(
      new URL("/api/v1/profile/history", origin).href,
    );
    profile = await requireJson(profileResponse, "Owner profile history");
    profileRun = profile?.runs?.find((item) => item.run_id === runId);
    if (profileRun?.links?.result) break;
    await sleep(5_000);
  }
  const profileRequest = profile?.requests?.find(
    (item) => item.request_id === profileRun?.request_id,
  );
  if (
    profile?.current_tier !== "consultant" ||
    !profileRun?.links?.result ||
    profileRun.result_projection !== "consultant" ||
    !profileRequest ||
    !/Ahmad Aghaei pistachios/iu.test(profileRequest.canonical_summary ?? "")
  )
    throw new Error(
      "The owner profile does not expose the fresh immutable Consultant agricultural result.",
    );

  const resultApi = await page.request.get(
    new URL(profileRun.links.result, origin).href,
  );
  const result = await requireJson(resultApi, "Fresh Consultant result");
  const resultObservedAt = new Date();
  if (
    result.run_id !== runId ||
    resultObservedAt <= runCreatedAt ||
    ![
      "consultant-result-projection.v1",
      "consultant-result-projection.v2",
    ].includes(result.schema_version) ||
    !result.landscape ||
    !Number.isSafeInteger(result.landscape.eligible_count) ||
    !Number.isSafeInteger(result.landscape.displayed_count) ||
    result.landscape.eligible_count < result.landscape.displayed_count ||
    (terminalRun.outcome === "matched" &&
      result.landscape.eligible_count < 1) ||
    (terminalRun.outcome === "no_responsible_match" &&
      result.landscape.eligible_count !== 0)
  )
    throw new Error("Result contract is not bound to the fresh run.");

  const reportRequestResponse = await page.request.post(
    new URL(`/api/v1/runs/${runId}/artifacts`, origin).href,
    {
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": me.csrf_token,
        "Idempotency-Key": `eu-canary-acceptance-pdf-${runId}`,
      },
    },
  );
  const reportRequest = await requireJson(
    reportRequestResponse,
    "Fresh Consultant PDF request",
  );
  if (
    reportRequest.run_id !== runId ||
    !UUID_PATTERN.test(reportRequest.job_id ?? "") ||
    !UUID_PATTERN.test(reportRequest.artifact_version_id ?? "") ||
    !Number.isSafeInteger(reportRequest.version) ||
    reportRequest.version < 1 ||
    reportRequest.state !== "queued"
  )
    throw new Error("Fresh Consultant PDF request acknowledgement is invalid.");

  let reportStatus = reportRequest;
  const reportDeadline = Date.now() + 900_000;
  while (Date.now() < reportDeadline) {
    const reportStatusResponse = await page.request.get(
      new URL(`/api/v1/runs/${runId}/artifacts/${reportRequest.job_id}`, origin)
        .href,
    );
    reportStatus = await requireJson(
      reportStatusResponse,
      "Fresh Consultant PDF status",
    );
    if (
      reportStatus.run_id !== runId ||
      reportStatus.job_id !== reportRequest.job_id ||
      reportStatus.artifact_version_id !== reportRequest.artifact_version_id ||
      reportStatus.version !== reportRequest.version
    )
      throw new Error("Fresh Consultant PDF status identity drifted.");
    if (reportStatus.state === "completed") break;
    if (reportStatus.state === "failed")
      throw new Error("Fresh Consultant PDF generation failed.");
    if (!["queued", "claimed"].includes(reportStatus.state))
      throw new Error("Fresh Consultant PDF status is invalid.");
    await sleep(1_000);
  }
  if (reportStatus.state !== "completed")
    throw new Error("Fresh Consultant PDF generation timed out.");

  const artifactDeadline = Date.now() + 180_000;
  while (Date.now() < artifactDeadline) {
    const profileResponse = await page.request.get(
      new URL("/api/v1/profile/history", origin).href,
    );
    profile = await requireJson(profileResponse, "Owner profile PDF grant");
    profileRun = profile?.runs?.find((item) => item.run_id === runId);
    if (profileRun?.artifact_download) break;
    await sleep(5_000);
  }
  if (
    profileRun?.artifact_download?.run_id !== runId ||
    profileRun.artifact_download.artifact_version_id !==
      reportRequest.artifact_version_id ||
    profileRun.artifact_download.version !== reportRequest.version ||
    !profileRun.artifact_download.href
  )
    throw new Error(
      "The owner profile does not expose the fresh run-bound Consultant PDF.",
    );

  const purpose =
    "Governed EU Canary acceptance: verify the fresh owner-bound run is present in Super-admin inventory.";
  const inventoryQuery = new URLSearchParams({
    limit: "20",
    scope: "own",
    subject_user_id: me.subject.user_id,
    identity: googleEmail,
    purpose,
  });
  const inventoryResponse = await page.request.get(
    new URL(`/api/v1/admin/research?${inventoryQuery}`, origin).href,
  );
  const inventory = await requireJson(
    inventoryResponse,
    "Super-admin research inventory",
  );
  const inventoryRun = inventory?.items?.find((item) => item.run_id === runId);
  if (
    !inventoryRun ||
    inventoryRun.requester?.user_id !== me.subject.user_id ||
    inventoryRun.requester?.email?.toLocaleLowerCase("en") !==
      googleEmail.toLocaleLowerCase("en") ||
    !inventoryRun.result_available ||
    !/Ahmad Aghaei pistachios/iu.test(
      `${inventoryRun.product_group ?? ""} ${inventoryRun.request_summary ?? ""}`,
    ) ||
    inventory?.privacy_boundary?.source_text_released !== false ||
    inventory?.privacy_boundary?.complete_result_released !== false
  )
    throw new Error(
      "Super-admin inventory did not expose the bounded fresh run identity without releasing source text or complete result bytes.",
    );

  await page.goto(new URL("/admin/profile", origin).href, {
    waitUntil: "domcontentloaded",
  });
  const verifiedDisplayName = me.user_display_name.trim();
  await page
    .getByRole("heading", { name: verifiedDisplayName })
    .waitFor({ timeout: 60_000 });
  await page
    .getByText(googleEmail, { exact: true })
    .waitFor({ timeout: 60_000 });
  const pdfLink = page
    .locator(
      `a[data-matchbase-artifact-run-id="${runId}"][data-matchbase-artifact-version-id][data-matchbase-artifact-version]`,
    )
    .filter({ hasText: /PDF|report|download/i })
    .first();
  if ((await pdfLink.count()) !== 1)
    throw new Error(
      "The fresh profile result exposes no uniquely run-bound PDF grant.",
    );
  const pdfResponsePromise = page.waitForResponse(
    (response) =>
      response.url().startsWith(origin.origin) &&
      /\/api\/v1\/artifacts\/[0-9a-f-]{36}\/download$/u.test(
        new URL(response.url()).pathname,
      ),
    { timeout: 180_000 },
  );
  await pdfLink.click();
  const pdfResponse = await pdfResponsePromise;
  const pdfBytes = await pdfResponse.body();
  if (
    pdfResponse.status() !== 200 ||
    pdfBytes.length < 1_024 ||
    pdfBytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new Error("Fresh run PDF failed byte-level verification.");
  const grantId = /\/artifacts\/([0-9a-f-]{36})\/download$/u.exec(
    new URL(pdfResponse.url()).pathname,
  )?.[1];
  if (!grantId || grantId !== profileRun.artifact_download.grant_id)
    throw new Error(
      "PDF grant identity is absent or differs from the profile.",
    );

  const responsiveChecks = [
    ...(await assertResponsivePage(
      page,
      "/admin/profile",
      verifiedDisplayName,
    )),
    ...(await assertResponsivePage(
      page,
      "/admin/research",
      "All research runs",
    )),
  ];

  await page.setViewportSize({ width: 1_440, height: 900 });
  const latencySamples = [];
  for (let index = 0; index < LATENCY_SAMPLE_COUNT; index += 1) {
    for (const path of ["/api/v1/health", "/api/v1/me"]) {
      const startedAt = performance.now();
      const response = await page.request.get(new URL(path, origin).href);
      await requireJson(response, `Latency probe ${path}`);
      latencySamples.push({
        path,
        elapsed_ms: Number((performance.now() - startedAt).toFixed(3)),
      });
    }
  }
  const latencyP95Ms = percentile95(
    latencySamples.map((sample) => sample.elapsed_ms),
  );
  if (!Number.isFinite(latencyP95Ms) || latencyP95Ms > MAX_INTERACTIVE_P95_MS)
    throw new Error(
      `Canary interactive latency p95 ${latencyP95Ms}ms exceeds ${MAX_INTERACTIVE_P95_MS}ms.`,
    );

  const denied = await fetch(new URL("/api/v1/health", directServiceUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
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
        profile_admin: "PASS",
        origin_denial: "PASS",
        responsive_browser: "PASS",
        latency: "PASS",
      },
      request_contract: {
        id: "approved-ahmad-aghaei-pistachio-request.v1",
        source_sha256: createHash("sha256")
          .update(EXACT_AGRICULTURAL_REQUEST)
          .digest("hex"),
        domain_pack_category_id: "food_agricultural_commodities",
        mandatory_constraint_field_ids: ["routing_via"],
        preference_field_ids: ["current_stock"],
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
      oauth_subject_user_id: me.subject.user_id,
      profile: {
        schema_version: profile.schema_version,
        current_tier: profile.current_tier,
        request_id: profileRun.request_id,
        run_id: profileRun.run_id,
        result_projection: profileRun.result_projection,
      },
      admin_inventory: {
        schema_version: inventory.schema_version,
        run_id: inventoryRun.run_id,
        requester_user_id: inventoryRun.requester.user_id,
        source_text_released: inventory.privacy_boundary.source_text_released,
        complete_result_released:
          inventory.privacy_boundary.complete_result_released,
      },
      responsive_checks: responsiveChecks,
      latency: {
        sample_count: latencySamples.length,
        interactive_p95_ms: latencyP95Ms,
        maximum_interactive_p95_ms: MAX_INTERACTIVE_P95_MS,
        samples: latencySamples,
      },
      public_canary_origin: origin.origin,
      direct_cloud_run_origin: directServiceUrl.origin,
    }),
  );
} finally {
  await page.close();
}
