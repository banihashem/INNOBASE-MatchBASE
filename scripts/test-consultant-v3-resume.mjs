#!/usr/bin/env node
import { resolveScriptTestTargets } from "./lib/database-config.mjs";
import assert from "node:assert/strict";

const { baseUrl: BASE_URL, fetch } = resolveScriptTestTargets();
const GOLDEN_RUN_ID = "00000000-0000-4000-8000-000000000401";
const L04_INVALIDATED_RUN = "d0f8978a-8260-446e-83f6-0f7a3957875e";
const L05_INVALIDATED_RUN = "b4039944-9647-4640-9c7d-b103f3ab2439";

console.log(
  "=== MatchBASE Consultant V3 Workflow Resume & Hydration Test Suite ===",
);

async function getAuthCookie(fixtureRole) {
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
  const sessionCookie = rawCookies
    .map((c) => c?.split(";")[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(
    sessionCookie.includes("matchbase_session="),
    `Must establish valid session cookie for ${fixtureRole}`,
  );
  return sessionCookie;
}

async function runTests() {
  const consultantCookie = await getAuthCookie("consultant");
  console.log("✔ Consultant authenticated session established via simulator");

  // =========================================================================
  // 1. Authorization Controls on Workflow Endpoint
  // =========================================================================
  console.log("\n1. Testing Workflow Authorization Controls...");

  const unauthRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${GOLDEN_RUN_ID}`,
  );
  assert.equal(
    unauthRes.status,
    401,
    "Unauthenticated request must return 401",
  );
  console.log("✔ Unauthenticated request correctly rejected with HTTP 401");

  const standardCookie = await getAuthCookie("standard");
  const standardRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${GOLDEN_RUN_ID}`,
    { headers: { Cookie: standardCookie } },
  );
  assert.equal(
    standardRes.status,
    403,
    "Standard user request must return 403",
  );
  console.log("✔ Standard user request correctly rejected with HTTP 403");

  // =========================================================================
  // 2. Invalidation Gate: Incomplete List & Direct Fetch
  // =========================================================================
  console.log("\n2. Testing Invalidation Handling in Workflow API...");

  // 2a. Incomplete list must strictly exclude invalidated runs
  const listRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?incomplete=true`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(listRes.status, 200, "List incomplete runs must return 200");
  const listData = await listRes.json();
  assert.ok(
    Array.isArray(listData.sessions),
    "Response must contain sessions array",
  );

  const contaminatedFound = listData.sessions.some(
    (s) =>
      s.run_id === L05_INVALIDATED_RUN ||
      s.run_id === L04_INVALIDATED_RUN ||
      s.is_invalidated === true ||
      s.current_state === "invalidated",
  );
  assert.equal(
    contaminatedFound,
    false,
    "Incomplete list MUST NOT contain any invalidated or contaminated runs",
  );
  console.log(
    "✔ Incomplete sessions list strictly excludes all invalidated runs",
  );

  // 2b. Direct fetch of L05 contaminated run must return 410 MB-410-INVALIDATED
  const l05FetchRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${L05_INVALIDATED_RUN}`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(
    l05FetchRes.status,
    410,
    `Direct fetch of contaminated L05 run must return 410, got ${l05FetchRes.status}`,
  );
  const l05FetchData = await l05FetchRes.json();
  assert.equal(
    l05FetchData.code,
    "MB-410-INVALIDATED",
    "Must return error code MB-410-INVALIDATED",
  );
  console.log(
    "✔ Direct fetch of L05 contaminated run correctly returns HTTP 410 MB-410-INVALIDATED",
  );

  // 2c. Direct fetch of L04 invalidated run must return 410 MB-410-INVALIDATED
  const l04FetchRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${L04_INVALIDATED_RUN}`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(
    l04FetchRes.status,
    410,
    `Direct fetch of invalidated L04 run must return 410, got ${l04FetchRes.status}`,
  );
  const l04FetchData = await l04FetchRes.json();
  assert.equal(
    l04FetchData.code,
    "MB-410-INVALIDATED",
    "Must return error code MB-410-INVALIDATED",
  );
  console.log(
    "✔ Direct fetch of L04 invalidated run correctly returns HTTP 410 MB-410-INVALIDATED",
  );

  // =========================================================================
  // 3. In-Progress Run Hydration & Resume (Pre-Execution Workflow)
  // =========================================================================
  console.log("\n3. Testing In-Progress Run Hydration and Resume...");

  // 3a. Create independent draft
  const draftRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({ action: "create_draft" }),
  });
  assert.equal(draftRes.status, 200, "Create draft must return 200");
  const draftData = await draftRes.json();
  const testDraftId = draftData.draft_id;
  assert.ok(testDraftId, "Must receive draft_id");

  // 3b. Submit intake for commercial water heater
  const intakePayload = {
    action: "submit_intake",
    draft_id: testDraftId,
    draft_version: draftData.draft_version,
    product_requirement: "Commercial Electric Storage Water Heater 500L 48kW",
    technical_compliance: "CE PED Directive 2014/68/EU & UAE MoIAT ECAS 10 bar",
    order_profile: "15 units DDP Jebel Ali Free Zone Dubai",
  };
  const submitRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify(intakePayload),
  });
  assert.equal(submitRes.status, 200, "submit_intake must return 200");
  const submitData = await submitRes.json();
  assert.ok(
    submitData.session?.run_id,
    "submit_intake must return session.run_id",
  );
  assert.equal(
    submitData.session.state,
    "prep_step1_awaiting_approval",
    "State must be prep_step1_awaiting_approval",
  );
  const testRunId = submitData.session.run_id;
  console.log(
    `✔ In-progress run created: ${testRunId} (state: ${submitData.session.state})`,
  );

  // 3c. Hydrate in-progress run via run_id (Simulate page refresh / direct link)
  const hydrateRunRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${testRunId}`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(
    hydrateRunRes.status,
    200,
    "Hydrating in-progress run must return 200",
  );
  const hydrateRunData = await hydrateRunRes.json();
  assert.ok(hydrateRunData.session, "Hydrated response must contain session");
  assert.equal(
    hydrateRunData.session.run_id,
    testRunId,
    "Session run_id must match",
  );
  assert.equal(
    hydrateRunData.session.state,
    "prep_step1_awaiting_approval",
    "Session state must be prep_step1_awaiting_approval",
  );
  assert.equal(
    hydrateRunData.session.intake?.product_requirement,
    intakePayload.product_requirement,
    "Hydrated intake must preserve product_requirement",
  );
  assert.ok(
    hydrateRunData.session.step1_interpretation,
    "Hydrated session must contain step1_interpretation",
  );
  assert.ok(hydrateRunData.draft, "Response must contain linked draft");
  assert.equal(
    hydrateRunData.draft.draft_id,
    testDraftId,
    "Linked draft ID must match",
  );
  assert.equal(
    hydrateRunData.draft.current_run_id,
    testRunId,
    "Draft must link to active run_id",
  );
  console.log(
    "✔ In-progress run hydrated successfully with complete intake, step 1, and linked draft",
  );

  // 3d. Hydrate via draft_id (Simulate draft URL resume)
  const hydrateDraftRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?draft_id=${testDraftId}`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(
    hydrateDraftRes.status,
    200,
    "Hydrating via draft_id must return 200",
  );
  const hydrateDraftData = await hydrateDraftRes.json();
  assert.ok(hydrateDraftData.draft, "Hydrated response must contain draft");
  assert.equal(
    hydrateDraftData.draft.current_run_id,
    testRunId,
    "Draft must reference active run_id",
  );
  console.log("✔ Draft hydration correctly resolves linked run_id");

  // 3e. Progress workflow: Approve Step 1
  const step1Res = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "approve_step1",
      run_id: testRunId,
      draft_id: testDraftId,
      approved_interpretation: hydrateRunData.session.step1_interpretation,
    }),
  });
  assert.equal(step1Res.status, 200, "approve_step1 must return 200");
  const step1Data = await step1Res.json();
  assert.equal(
    step1Data.session.state,
    "prep_step2_advisory_ready",
    "State must advance to prep_step2_advisory_ready",
  );
  console.log(
    `✔ Step 1 approved: workflow advanced to ${step1Data.session.state}`,
  );

  // 3f. Hydrate again after Step 1 approval
  const hydrateStep1Res = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${testRunId}`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(
    hydrateStep1Res.status,
    200,
    "Hydrating after step 1 approval must return 200",
  );
  const hydrateStep1Data = await hydrateStep1Res.json();
  assert.equal(
    hydrateStep1Data.session.state,
    "prep_step2_advisory_ready",
    "Hydrated session must reflect advanced state prep_step2_advisory_ready",
  );
  assert.ok(
    hydrateStep1Data.session.step2_advisory,
    "Hydrated session must contain advisory data for step 2",
  );
  console.log(
    "✔ Advanced in-progress state hydrated accurately with Step 2 advisory content",
  );

  // =========================================================================
  // 4. Completed Run Hydration & Resume
  // =========================================================================
  console.log("\n4. Testing Completed Run Hydration...");

  const completedRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?run_id=${GOLDEN_RUN_ID}`,
    { headers: { Cookie: consultantCookie } },
  );
  assert.equal(
    completedRes.status,
    200,
    "Hydrating completed run must return 200",
  );
  const completedData = await completedRes.json();
  assert.ok(completedData.session, "Must return completed session");
  assert.equal(
    completedData.session.run_id,
    GOLDEN_RUN_ID,
    "Completed run_id must match",
  );
  assert.equal(
    completedData.session.state,
    "workflow_complete",
    "Completed session state must be workflow_complete",
  );
  assert.ok(
    completedData.session.output,
    "Completed session must contain output payload",
  );
  assert.ok(
    Array.isArray(completedData.session.output.supplier_candidates),
    "Completed output must have supplier_candidates array",
  );
  console.log(
    `✔ Completed run hydrated with state '${completedData.session.state}' and ${completedData.session.output.supplier_candidates.length} candidate suppliers`,
  );

  console.log(
    "\n=================================================================",
  );
  console.log("✔ ALL CONSULTANT V3 WORKFLOW RESUME & HYDRATION TESTS PASSED");
  console.log(
    "=================================================================",
  );
}

runTests().catch((err) => {
  console.error("\n❌ Test failure:", err);
  process.exit(1);
});
