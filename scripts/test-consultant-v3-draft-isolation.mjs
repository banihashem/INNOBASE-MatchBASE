#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "../packages/data/node_modules/pg/lib/index.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

console.log(
  "=== MatchBASE Consultant V3 Draft & Session Isolation Test Suite ===",
);

async function getAuthCookie(fixtureRole) {
  const r1 = await fetch(
    `${BASE_URL}/auth/simulator/start?fixture=${fixtureRole}`,
    {
      redirect: "manual",
    },
  );
  const callbackUrl = r1.headers.get("location");
  const startCookie = r1.headers.get("set-cookie");

  const r2 = await fetch(`${BASE_URL}${callbackUrl}`, {
    redirect: "manual",
    headers: { cookie: startCookie || "" },
  });
  const rawCookies = r2.headers.getSetCookie
    ? r2.headers.getSetCookie()
    : [r2.headers.get("set-cookie")];
  const sessionCookie = rawCookies
    .map((c) => c?.split(";")[0])
    .filter(Boolean)
    .join("; ");
  return sessionCookie;
}

async function runTests() {
  const consultantCookie = await getAuthCookie("consultant");
  const standardCookie = await getAuthCookie("standard");

  console.log("\n1. Testing Server-Side Draft Saving for Consultant...");
  const testDraftId = crypto.randomUUID();
  const testDraftData = {
    productRequirement: "Specialized isolated commercial valves 200mm",
    technicalCompliance: "API 6D and ISO 14313 compliance",
    orderProfile: "50 units initial purchase",
    savedAt: new Date().toISOString(),
  };

  const saveRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "save_draft",
      draft_id: testDraftId,
      draft_data: testDraftData,
    }),
  });
  assert.equal(saveRes.status, 200, "Draft save must return 200");
  const saveJson = await saveRes.json();
  assert.equal(saveJson.success, true);
  console.log(
    `✔ Draft saved successfully on server (Draft ID: ${testDraftId})`,
  );

  console.log("\n2. Testing Server-Side Draft Retrieval...");
  const getDraftRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?active_draft=true`,
    {
      headers: { Cookie: consultantCookie },
    },
  );
  assert.equal(getDraftRes.status, 200, "Draft retrieval must return 200");
  const getDraftJson = await getDraftRes.json();
  assert.ok(getDraftJson.draft, "Must return active draft");
  assert.equal(getDraftJson.draft.draft_id, testDraftId);
  assert.equal(
    getDraftJson.draft.draft_data.productRequirement,
    testDraftData.productRequirement,
  );
  console.log(
    "✔ Active draft retrieved with exact matching 3-box requirement data",
  );

  console.log("\n3. Testing Role Isolation: Standard User Access Blocked...");
  const standardDraftRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?active_draft=true`,
    {
      headers: { Cookie: standardCookie },
    },
  );
  assert.equal(
    standardDraftRes.status,
    403,
    `Standard user must be blocked with HTTP 403, got ${standardDraftRes.status}`,
  );
  console.log(
    "✔ Standard user blocked from reading consultant draft (HTTP 403 Forbidden)",
  );

  console.log("\n4. Testing Atomic 3-Box Intake Snapshot in Database...");
  const submitRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "submit_intake",
      product_requirement: "Frozen whole chicken Grade A 1100g",
      technical_compliance:
        "SFDA foreign slaughterhouse approval, FAMBRAS Halal",
      order_profile: "10 reefer containers monthly, CFR Jeddah",
    }),
  });
  assert.equal(submitRes.status, 200, "Intake submission must succeed");
  const submitJson = await submitRes.json();
  const newRunId = submitJson.session?.run_id || submitJson.run_id;
  assert.ok(newRunId, "Submission must return run_id");

  // Verify in PostgreSQL database
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const snapResult = await client.query(
      `SELECT * FROM consultant_intake_snapshot WHERE run_id = $1`,
      [newRunId],
    );
    assert.equal(
      snapResult.rows.length,
      1,
      "Must have exactly 1 atomic intake snapshot in database",
    );
    const snap = snapResult.rows[0];
    assert.equal(
      snap.product_requirement,
      "Frozen whole chicken Grade A 1100g",
    );
    assert.equal(
      snap.technical_compliance,
      "SFDA foreign slaughterhouse approval, FAMBRAS Halal",
    );
    assert.equal(
      snap.order_profile,
      "10 reefer containers monthly, CFR Jeddah",
    );
    console.log(
      `✔ Database verified: Atomic 3-box intake snapshot stored with run_id ${newRunId}`,
    );
  } finally {
    await client.end();
  }

  console.log("\n5. Testing Draft Abandonment...");
  const abandonRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "abandon_draft",
      draft_id: testDraftId,
    }),
  });
  assert.equal(abandonRes.status, 200, "Abandon draft must return 200");

  const checkAbandonedRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow?active_draft=true`,
    {
      headers: { Cookie: consultantCookie },
    },
  );
  assert.equal(checkAbandonedRes.status, 200);
  const checkAbandonedJson = await checkAbandonedRes.json();
  assert.equal(
    checkAbandonedJson.draft,
    null,
    "Active draft must be null after abandonment",
  );
  console.log("✔ Server draft successfully abandoned and cleared");

  console.log("\n=======================================================");
  console.log("✔ ALL CONSULTANT V3 DRAFT & SESSION ISOLATION TESTS PASSED!");
  console.log("=======================================================");
}

runTests().catch((err) => {
  console.error("❌ Draft isolation test failed:", err);
  process.exit(1);
});
