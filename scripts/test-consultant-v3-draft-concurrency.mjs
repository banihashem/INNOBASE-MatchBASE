#!/usr/bin/env node
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

console.log(
  "=== MatchBASE Consultant V3 Draft Concurrency & 422 Coherence Test Suite ===",
);

async function getAuthCookie(fixtureRole) {
  const r1 = await fetch(
    `${BASE_URL}/auth/simulator/start?fixture=${fixtureRole}`,
    {
      redirect: "manual",
    },
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
  // 1. Independent Tab Drafts (Tab A vs Tab B)
  // =========================================================================
  console.log("\n1. Testing Multi-Tab Draft Independence (Tab A vs Tab B)...");

  // Tab A creates a new draft
  const draftARes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({ action: "create_draft" }),
  });
  assert.equal(draftARes.status, 200, "Tab A create_draft must return 200");
  const draftAData = await draftARes.json();
  assert.ok(draftAData.draft_id, "Tab A must receive a unique draft_id");
  assert.equal(draftAData.draft_version, 1, "Tab A initial version must be 1");
  console.log(
    `✔ Tab A initialized independent draft: ${draftAData.draft_id} (v${draftAData.draft_version})`,
  );

  // Tab B creates a new draft in parallel under same consultant session
  const draftBRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({ action: "create_draft" }),
  });
  assert.equal(draftBRes.status, 200, "Tab B create_draft must return 200");
  const draftBData = await draftBRes.json();
  assert.ok(draftBData.draft_id, "Tab B must receive a unique draft_id");
  assert.equal(draftBData.draft_version, 1, "Tab B initial version must be 1");
  assert.notEqual(
    draftAData.draft_id,
    draftBData.draft_id,
    "Tab A and Tab B drafts MUST have distinct draft_ids",
  );
  console.log(
    `✔ Tab B initialized independent draft: ${draftBData.draft_id} (v${draftBData.draft_version})`,
  );
  console.log(
    "✔ Tab A and Tab B possess completely isolated draft IDs (zero collision)",
  );

  // =========================================================================
  // 2. Draft Auto-Save with Version Progression
  // =========================================================================
  console.log("\n2. Testing Draft Persistence & Content Isolation...");

  // Save Tab A content
  const saveARes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id: draftAData.draft_id,
      expected_version: 1,
      draft_data: {
        product_requirement: "Tab A: Commercial Electric Water Heater 500L",
        technical_compliance: "CE PED & UAE MoIAT 10 bar rating",
        order_profile: "10 units DDP Dubai",
      },
    }),
  });
  assert.equal(saveARes.status, 200, "Tab A save_draft must return 200");
  const saveAData = await saveARes.json();
  assert.equal(saveAData.draft_version, 2, "Tab A version must increment to 2");
  console.log(
    "✔ Tab A saved draft with expected_version: 1 -> progressed to v2",
  );

  // Save Tab B content (different topic)
  const saveBRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id: draftBData.draft_id,
      expected_version: 1,
      draft_data: {
        product_requirement: "Tab B: Frozen Whole Chicken Grade A",
        technical_compliance:
          "SFDA foreign establishment accreditation & Halal",
        order_profile: "27 MT container CIF Jeddah",
      },
    }),
  });
  assert.equal(saveBRes.status, 200, "Tab B save_draft must return 200");
  const saveBData = await saveBRes.json();
  assert.equal(saveBData.draft_version, 2, "Tab B version must increment to 2");
  console.log(
    "✔ Tab B saved draft with expected_version: 1 -> progressed to v2",
  );

  // Verify Tab A content is unaltered by Tab B's save
  const fetchARes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?draft_id=${draftAData.draft_id}`,
    {
      headers: { Cookie: consultantCookie },
    },
  );
  assert.equal(fetchARes.status, 200, "Fetching Tab A draft must return 200");
  const fetchedA = await fetchARes.json();
  assert.equal(
    fetchedA.draft?.draft_data?.product_requirement,
    "Tab A: Commercial Electric Water Heater 500L",
    "Tab A content must NOT be overwritten by Tab B",
  );
  assert.equal(
    fetchedA.draft?.draft_version,
    2,
    "Tab A draft_version must be 2",
  );
  console.log(
    "✔ Tab A content successfully verified in database (uncontaminated by Tab B)",
  );

  // Verify Tab B content is unaltered
  const fetchBRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?draft_id=${draftBData.draft_id}`,
    {
      headers: { Cookie: consultantCookie },
    },
  );
  assert.equal(fetchBRes.status, 200, "Fetching Tab B draft must return 200");
  const fetchedB = await fetchBRes.json();
  assert.equal(
    fetchedB.draft?.draft_data?.product_requirement,
    "Tab B: Frozen Whole Chicken Grade A",
    "Tab B content must be intact",
  );
  assert.equal(
    fetchedB.draft?.draft_version,
    2,
    "Tab B draft_version must be 2",
  );
  console.log(
    "✔ Tab B content successfully verified in database (independent snapshot)",
  );

  // =========================================================================
  // 3. Optimistic Concurrency Conflict (409 MB-409-DRAFT-CONFLICT)
  // =========================================================================
  console.log(
    "\n3. Testing Optimistic Concurrency Conflict Detection (409)...",
  );

  // Attempt to save Tab A draft with stale expected_version: 1 (current is 2)
  const staleConflictRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: consultantCookie,
      },
      body: JSON.stringify({
        action: "save_draft",
        draft_id: draftAData.draft_id,
        expected_version: 1, // Stale! Current is 2
        draft_data: {
          product_requirement: "Tab A Stale Edit Attempt",
        },
      }),
    },
  );
  assert.equal(
    staleConflictRes.status,
    409,
    `Stale save must return 409 Conflict, got ${staleConflictRes.status}`,
  );
  const conflictPayload = await staleConflictRes.json();
  assert.equal(
    conflictPayload.error?.code,
    "MB-409-DRAFT-CONFLICT",
    "Error code must be MB-409-DRAFT-CONFLICT",
  );
  assert.equal(
    conflictPayload.error?.current_version,
    2,
    "Conflict current_version must be 2",
  );
  assert.equal(
    conflictPayload.error?.submitted_version,
    1,
    "Conflict submitted_version must be 1",
  );
  assert.equal(
    conflictPayload.error?.recoverable,
    true,
    "Conflict must be marked recoverable",
  );
  console.log(
    "✔ Stale draft save correctly rejected with HTTP 409 MB-409-DRAFT-CONFLICT",
  );
  console.log(
    `  Current Version: ${conflictPayload.error.current_version}, Submitted: ${conflictPayload.error.submitted_version}`,
  );

  // =========================================================================
  // 4. Semantic Coherence Intake Failure (422 MB-422-COHERENCE)
  // =========================================================================
  console.log("\n4. Testing Semantic Coherence Conflict Validation (422)...");

  // Submit cross-domain contaminated intake:
  // Box 1: Industrial 500L water heater
  // Box 2: Halal poultry slaughter / SFDA poultry establishment requirements
  // Box 3: 10 units DDP Dubai
  const contaminatedIntakeRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: consultantCookie,
      },
      body: JSON.stringify({
        action: "submit_intake",
        product_requirement:
          "Industrial 500L commercial electric water heater, 10 bar working pressure, max 85cm outer diameter",
        technical_compliance:
          "Halal poultry slaughter requirements according to GSO 993 standards and active SFDA foreign poultry establishment listing",
        order_profile: "10 units DDP Dubai on-site delivery",
      }),
    },
  );

  assert.equal(
    contaminatedIntakeRes.status,
    422,
    `Cross-domain intake must return HTTP 422 Unprocessable Entity, got ${contaminatedIntakeRes.status}`,
  );
  const coherencePayload = await contaminatedIntakeRes.json();
  assert.equal(
    coherencePayload.error?.code,
    "MB-422-COHERENCE",
    "Error code must be MB-422-COHERENCE",
  );
  assert.ok(
    Array.isArray(coherencePayload.error?.conflicts),
    "Response must contain structured conflicts array",
  );
  assert.ok(
    coherencePayload.error.conflicts.length > 0,
    "Conflicts array must contain at least 1 conflict item",
  );
  assert.equal(
    coherencePayload.error?.recoverable,
    true,
    "Coherence error must be marked recoverable for inline UI correction",
  );
  console.log(
    "✔ Contaminated intake correctly rejected with HTTP 422 MB-422-COHERENCE",
  );
  console.log(
    `  Detected conflicts: ${JSON.stringify(coherencePayload.error.conflicts)}`,
  );
  console.log(
    "  No unhandled exception, no React crash loop, recoverable=true",
  );

  // =========================================================================
  // 5. Atomic Clone Draft Action & Zero Secondary Conflict (N03)
  // =========================================================================
  console.log(
    "\n5. Testing Atomic clone_draft Action & Zero Secondary Conflict Loop...",
  );

  // Tab A creates a draft and advances version to 2
  const sharedDraftRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({ action: "create_draft" }),
  });
  const sharedDraftData = await sharedDraftRes.json();
  const sharedDraftId = sharedDraftData.draft_id;

  // Save version 1 -> advances to version 2 on server
  await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id: sharedDraftId,
      draft_version: 1,
      expected_version: 1,
      draft_data: { test: "initial version" },
    }),
  });

  // Stale client tries to save version 1 -> gets 409 conflict
  const conflictSaveRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: consultantCookie,
      },
      body: JSON.stringify({
        action: "save_draft",
        draft_id: sharedDraftId,
        draft_version: 1,
        expected_version: 1,
        draft_data: { test: "conflicting client edit" },
      }),
    },
  );
  assert.equal(
    conflictSaveRes.status,
    409,
    "Must return 409 on version mismatch",
  );
  const conflictData = await conflictSaveRes.json();
  assert.equal(conflictData.error?.code, "MB-409-DRAFT-CONFLICT");

  // Client chooses "Keep my version as a new draft" -> invokes clone_draft
  const cloneRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "clone_draft",
      draft_data: { test: "conflicting client edit" },
    }),
  });
  assert.equal(cloneRes.status, 200, "clone_draft must return HTTP 200 OK");
  const cloneData = await cloneRes.json();
  assert.ok(cloneData.success, "clone_draft must succeed");
  assert.ok(cloneData.draft_id, "clone_draft must return new draft_id");
  assert.notEqual(
    cloneData.draft_id,
    sharedDraftId,
    "Cloned draft_id must be distinct from original",
  );
  assert.equal(
    cloneData.draft_version,
    1,
    "Cloned draft starting version must be 1",
  );

  // Subsequent save on cloned draft succeeds without any 409 conflict
  const subsequentSaveRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: consultantCookie,
      },
      body: JSON.stringify({
        action: "save_draft",
        draft_id: cloneData.draft_id,
        draft_version: 1,
        expected_version: 1,
        draft_data: { test: "subsequent client edit on cloned draft" },
      }),
    },
  );
  assert.equal(
    subsequentSaveRes.status,
    200,
    `Subsequent save on cloned draft must return 200 without secondary conflict, got ${subsequentSaveRes.status}`,
  );
  const subsequentData = await subsequentSaveRes.json();
  assert.equal(
    subsequentData.draft_version,
    2,
    "Subsequent save advances version to 2",
  );
  console.log(
    "✔ Atomic clone_draft creates independent draft with starting version 1",
  );
  console.log(
    "✔ Zero secondary 409 conflict loops on subsequent autosave/edit",
  );

  console.log("\n=======================================================");
  console.log("✔ ALL DRAFT CONCURRENCY & COHERENCE TESTS PASSED!");
  console.log("=======================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
