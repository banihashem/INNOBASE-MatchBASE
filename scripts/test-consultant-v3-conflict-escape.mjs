#!/usr/bin/env node
import { resolveScriptTestTargets } from "./lib/database-config.mjs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const {
  baseUrl: BASE_URL,
  createBrowserContext,
  fetch,
} = resolveScriptTestTargets();

console.log("=== MatchBASE Consultant V3 Conflict Escape & Safety Test ===");

async function getAuthCookie(fixtureRole = "consultant") {
  const r1 = await fetch(
    `${BASE_URL}/auth/simulator/start?fixture=${fixtureRole}`,
    { redirect: "manual" },
  );
  assert.equal(r1.status, 302, "Simulator start must return 302 redirect");
  const callbackUrl = r1.headers.get("location");
  const startCookie = r1.headers.get("set-cookie");

  const r2 = await fetch(`${BASE_URL}${callbackUrl}`, {
    redirect: "manual",
    headers: { cookie: startCookie || "" },
  });
  assert.equal(r2.status, 303, "Simulator callback must return 303 redirect");
  const rawCookies = r2.headers.getSetCookie
    ? r2.headers.getSetCookie()
    : [r2.headers.get("set-cookie")];
  return rawCookies
    .map((c) => c?.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function main() {
  const cookie = await getAuthCookie("consultant");

  // -------------------------------------------------------------
  // Test 1: API Level Concurrency Conflict (HTTP 409)
  // -------------------------------------------------------------
  console.log("\n--- [1] API Concurrency Conflict (MB-409-DRAFT-CONFLICT) ---");
  // 1. Create draft
  const createRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ action: "create_draft" }),
  });
  assert.equal(createRes.status, 200);
  const { draft_id } = await createRes.json();
  assert.ok(draft_id);

  // 2. Tab A saves v1
  const save1 = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id,
      draft_version: 1,
      draft_data: {
        productRequirement: "Tab A edit: 10 units industrial calorifier",
        technicalCompliance: "10 bar",
        orderProfile: "DDP Dubai",
      },
    }),
  });
  assert.equal(save1.status, 200);
  const save1Data = await save1.json();
  assert.equal(save1Data.draft_version, 2);

  // 3. Tab B attempts to save with outdated base version 1
  const conflictRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id,
      draft_version: 1,
      draft_data: {
        productRequirement: "Tab B edit: Local unsaved critical specification",
        technicalCompliance: "Tested at 15 bar",
        orderProfile: "Dubai Industrial City",
      },
    }),
  });
  assert.equal(
    conflictRes.status,
    409,
    "Outdated version must return HTTP 409",
  );
  const conflictData = await conflictRes.json();
  assert.equal(conflictData.code, "MB-409-DRAFT-CONFLICT");
  assert.equal(conflictData.current_version, 2);
  console.log(
    "✔ Server-side optimistic locking correctly triggered HTTP 409 MB-409-DRAFT-CONFLICT",
  );

  // -------------------------------------------------------------
  // Test 2: Atomic Clone Action (clone_draft)
  // -------------------------------------------------------------
  console.log("\n--- [2] Atomic Clone Action (Keep as New Draft) ---");
  const cloneRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "clone_draft",
      draft_data: {
        productRequirement: "Tab B edit: Local unsaved critical specification",
        technicalCompliance: "Tested at 15 bar",
        orderProfile: "Dubai Industrial City",
      },
    }),
  });
  assert.equal(cloneRes.status, 200);
  const cloneData = await cloneRes.json();
  assert.ok(cloneData.draft_id);
  assert.notEqual(
    cloneData.draft_id,
    draft_id,
    "Cloned draft must have a new unique ID",
  );
  assert.equal(cloneData.draft_version, 1, "Cloned draft starts at version 1");
  console.log(
    `✔ Cloned new independent draft atomically: ${cloneData.draft_id}`,
  );

  // -------------------------------------------------------------
  // Test 3: Browser E2E Escape Safety & Non-Destructive Behavior
  // -------------------------------------------------------------
  console.log(
    "\n--- [3] Browser E2E: Escape Key Safety & Local Text Preservation ---",
  );
  const browser = await chromium.launch({ headless: true });
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("PAGE ERROR LOG:", msg.text());
  });
  page.on("pageerror", (err) => console.log("PAGE UNCAUGHT:", err));

  // Set shared authenticated session cookie for Playwright context
  const cookieParts = cookie.split("; ").map((p) => {
    const [name, ...val] = p.split("=");
    return { name, value: val.join("="), url: BASE_URL };
  });
  await context.addCookies(cookieParts);

  // Navigate to workflow with the created draft
  await page.goto(`${BASE_URL}/consultant/workflow?draft_id=${draft_id}`);
  await page.waitForLoadState("networkidle");

  const box1 = page.locator("#input-box-1");
  await box1.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      (document.querySelector("#input-box-1")?.value || "").includes(
        "calorifier",
      ),
    { timeout: 10000 },
  );

  // In background, update the server draft to version 3 to create conflict when page saves
  const bumpRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id,
      draft_version: 2,
      draft_data: {
        productRequirement: "Remote simultaneous update in other tab",
        technicalCompliance: "Remote compliance",
        orderProfile: "Remote order",
      },
    }),
  });
  assert.equal(bumpRes.status, 200, "Background version bump must succeed");

  // Now type local unsaved changes into Box 1, 2, 3 in UI
  await box1.fill(
    "LOCAL UNSAVED: Critical industrial calorifiers with exact specifications",
  );

  const box2 = page.locator("#input-box-2");
  await box2.fill(
    "LOCAL UNSAVED: Minimum 10 bar working pressure, documented thermal insulation",
  );

  const box3 = page.locator("#input-box-3");
  await box3.fill(
    "LOCAL UNSAVED: Delivery to Dubai, authorized UAE distributor",
  );

  console.log("Filled local inputs in UI");

  // Wait for debounced autosave to trigger conflict
  console.log("Waiting for debounced autosave to trigger conflict modal...");
  const conflictModal = page.locator('div[role="alertdialog"]');
  await conflictModal.waitFor({ state: "visible", timeout: 10000 });
  console.log("✔ Conflict modal appeared with role='alertdialog'");

  // Verify modal title and error code
  const title = page.locator("#conflict-dialog-title");
  await assert.match(await title.innerText(), /MB-409-DRAFT-CONFLICT/);

  // Verify local inputs are displayed in full without CSS truncate
  const localSection = conflictModal.locator(
    "p:has-text('LOCAL UNSAVED: Critical industrial')",
  );
  await localSection.waitFor({ state: "visible" });
  const localText = await localSection.innerText();
  assert.ok(
    localText.includes(
      "Critical industrial calorifiers with exact specifications",
    ),
    "Local text must be displayed without truncation",
  );
  console.log("✔ Local unsaved inputs displayed in full without CSS truncate");

  // PRESS ESCAPE KEY
  console.log("Pressing Escape key on conflict modal...");
  await page.keyboard.press("Escape");

  // Verify modal is STILL open (Escape did NOT close it)
  await page.waitForTimeout(500);
  assert.equal(
    await conflictModal.isVisible(),
    true,
    "Conflict modal MUST remain visible after Escape",
  );
  console.log(
    "✔ Conflict modal remained open after pressing Escape (Escape cancellation prevented)",
  );

  // Verify announcement text is displayed
  const announcement = page.locator('div[role="status"]');
  assert.equal(
    await announcement.isVisible(),
    true,
    "Announcement must be visible after Escape",
  );
  const annText = await announcement.innerText();
  assert.ok(
    annText.includes("Explicit choice required"),
    "Announcement must state explicit choice required",
  );
  console.log(`✔ User announcement displayed: "${annText.slice(0, 70)}..."`);

  // Verify local textarea values are STILL intact and NOT overwritten by server
  assert.equal(
    await box1.inputValue(),
    "LOCAL UNSAVED: Critical industrial calorifiers with exact specifications",
    "Box 1 text must NOT be overwritten on Escape",
  );
  console.log("✔ Local textarea contents completely preserved");

  // Resolve conflict: click "Keep my version as a new draft"
  const cloneBtn = conflictModal.locator(
    "button:has-text('Keep my version as a new draft')",
  );
  await cloneBtn.click();

  // Wait for conflict modal to close
  await conflictModal.waitFor({ state: "hidden", timeout: 5000 });
  console.log(
    "✔ Conflict modal dismissed cleanly after selecting 'Keep my version as a new draft'",
  );

  // Verify local text is STILL preserved in the new draft
  assert.equal(
    await box1.inputValue(),
    "LOCAL UNSAVED: Critical industrial calorifiers with exact specifications",
  );
  console.log("✔ Cloned draft active with all local inputs intact");

  await browser.close();

  console.log("\n=======================================================");
  console.log("✔ ALL CONFLICT ESCAPE & SAFETY TESTS PASSED!");
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
