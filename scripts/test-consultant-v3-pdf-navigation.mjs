#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

console.log("=== MatchBASE Consultant V3 PDF Navigation & Delivery Suite ===");

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

async function runNavigationTests() {
  const consultantCookie = await getAuthCookie("consultant");
  const standardCookie = await getAuthCookie("standard");
  const runId = "run-v3-golden-01";
  const endpoint = `${BASE_URL}/api/v1/consultant/reports/${runId}/pdf`;

  // 1. Authorization: Unauthenticated (401)
  console.log("\n--- [1] Access Control: Unauthenticated Request ---");
  const unauthRes = await fetch(endpoint);
  assert.equal(
    unauthRes.status,
    401,
    `Unauthenticated must return 401, got ${unauthRes.status}`,
  );
  const unauthJson = await unauthRes.json();
  assert.equal(unauthJson.code, "MB-401-SESSION");
  console.log(
    "✔ Unauthenticated request correctly rejected with HTTP 401 MB-401-SESSION",
  );

  // 2. Authorization: Standard User (403)
  console.log("\n--- [2] Access Control: Standard User Denial ---");
  const standardRes = await fetch(endpoint, {
    headers: { Cookie: standardCookie },
  });
  assert.equal(
    standardRes.status,
    403,
    `Standard user must return 403, got ${standardRes.status}`,
  );
  console.log("✔ Standard tier user correctly rejected with HTTP 403");

  // 3. Authenticated Full GET (200 OK)
  console.log("\n--- [3] Authenticated Full GET (200 OK) ---");
  const getRes = await fetch(endpoint, {
    headers: { Cookie: consultantCookie },
  });
  assert.equal(
    getRes.status,
    200,
    `Full GET must return 200, got ${getRes.status}`,
  );
  assert.equal(getRes.headers.get("content-type"), "application/pdf");
  assert.equal(getRes.headers.get("accept-ranges"), "bytes");
  const totalLength = parseInt(getRes.headers.get("content-length") || "0", 10);
  assert.ok(totalLength > 10240, `PDF size must be > 10KB, got ${totalLength}`);
  const getBytes = Buffer.from(await getRes.arrayBuffer());
  assert.equal(getBytes.length, totalLength);
  assert.equal(getBytes.subarray(0, 5).toString("utf-8"), "%PDF-");
  console.log(
    `✔ Full GET returned 200 OK (${totalLength} bytes, %PDF- header, Accept-Ranges: bytes)`,
  );

  // 4. HEAD Request (200 OK, empty body, complete headers)
  console.log("\n--- [4] Authenticated HEAD Request ---");
  const headRes = await fetch(endpoint, {
    method: "HEAD",
    headers: { Cookie: consultantCookie },
  });
  assert.equal(
    headRes.status,
    200,
    `HEAD must return 200, got ${headRes.status}`,
  );
  assert.equal(headRes.headers.get("content-type"), "application/pdf");
  assert.equal(headRes.headers.get("accept-ranges"), "bytes");
  assert.equal(headRes.headers.get("content-length"), totalLength.toString());
  const headBody = await headRes.text();
  assert.equal(headBody.length, 0, "HEAD response must have zero-length body");
  console.log(
    "✔ HEAD request returned 200 OK with correct headers and empty body",
  );

  // 5. Valid Range Request: bytes=0-
  console.log("\n--- [5] Range Request: bytes=0- ---");
  const range0Res = await fetch(endpoint, {
    headers: { Cookie: consultantCookie, Range: "bytes=0-" },
  });
  assert.equal(
    range0Res.status,
    206,
    `Range bytes=0- must return 206, got ${range0Res.status}`,
  );
  assert.equal(
    range0Res.headers.get("content-range"),
    `bytes 0-${totalLength - 1}/${totalLength}`,
  );
  assert.equal(range0Res.headers.get("content-length"), totalLength.toString());
  const range0Bytes = Buffer.from(await range0Res.arrayBuffer());
  assert.equal(range0Bytes.length, totalLength);
  assert.equal(range0Bytes.subarray(0, 5).toString("utf-8"), "%PDF-");
  console.log(
    "✔ Range bytes=0- returned 206 Partial Content with matching length and byte range",
  );

  // 6. Valid Bounded Range Request: bytes=0-1023
  console.log("\n--- [6] Bounded Range Request: bytes=0-1023 ---");
  const rangeBoundedRes = await fetch(endpoint, {
    headers: { Cookie: consultantCookie, Range: "bytes=0-1023" },
  });
  assert.equal(
    rangeBoundedRes.status,
    206,
    `Bounded range must return 206, got ${rangeBoundedRes.status}`,
  );
  assert.equal(
    rangeBoundedRes.headers.get("content-range"),
    `bytes 0-1023/${totalLength}`,
  );
  assert.equal(rangeBoundedRes.headers.get("content-length"), "1024");
  const boundedBytes = Buffer.from(await rangeBoundedRes.arrayBuffer());
  assert.equal(boundedBytes.length, 1024);
  assert.equal(boundedBytes.subarray(0, 5).toString("utf-8"), "%PDF-");
  console.log(
    "✔ Bounded Range bytes=0-1023 returned 206 Partial Content (1024 bytes)",
  );

  // 7. Malformed and Unsatisfiable Range (416)
  console.log("\n--- [7] Malformed & Unsatisfiable Range (HTTP 416) ---");
  const badRangeRes = await fetch(endpoint, {
    headers: { Cookie: consultantCookie, Range: "bytes=99999999-999999999" },
  });
  assert.equal(
    badRangeRes.status,
    416,
    `Unsatisfiable range must return 416, got ${badRangeRes.status}`,
  );
  assert.equal(
    badRangeRes.headers.get("content-range"),
    `bytes */${totalLength}`,
  );

  const malformedRangeRes = await fetch(endpoint, {
    headers: { Cookie: consultantCookie, Range: "not-bytes=0-100" },
  });
  assert.equal(
    malformedRangeRes.status,
    416,
    `Malformed range must return 416, got ${malformedRangeRes.status}`,
  );
  console.log(
    "✔ Unsatisfiable & malformed Range requests correctly returned HTTP 416 with Content-Range",
  );

  // 8. Golden Suite Coverage: V3-01 through V3-04
  console.log("\n--- [8] Golden Suite Retrieval (V3-01..V3-04) ---");
  const goldenCases = [
    { id: "run-v3-golden-01", name: "V3-01" },
    { id: "run-v3-golden-02", name: "V3-02" },
    { id: "run-v3-golden-03", name: "V3-03" },
    { id: "run-v3-golden-04", name: "V3-04" },
  ];
  const distinctRunIds = new Set();
  for (const gc of goldenCases) {
    const res = await fetch(
      `${BASE_URL}/api/v1/consultant/reports/${gc.id}/pdf`,
      {
        headers: { Cookie: consultantCookie },
      },
    );
    assert.equal(
      res.status,
      200,
      `${gc.name} must return 200, got ${res.status}`,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 10240, `${gc.name} size must be > 10KB`);
    assert.equal(buf.subarray(0, 5).toString("utf-8"), "%PDF-");
    distinctRunIds.add(gc.id);
    console.log(
      `✔ ${gc.name} PDF generated successfully (${buf.length} bytes)`,
    );
  }
  assert.equal(distinctRunIds.size, 4, "Must cover 4 distinct golden runs");

  // 9. Playwright Browser Qualification (5 sequential navigations without 503)
  console.log(
    "\n--- [9] Browser Navigation Qualification (5 Sequential Navigations) ---",
  );
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE_URL}/auth/simulator/start?fixture=consultant`);
  await page.waitForLoadState("networkidle");

  for (let i = 1; i <= 5; i++) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.goto(endpoint, { waitUntil: "commit" }).catch((e) => {
        // Chromium emits download event and aborts document navigation
        assert.ok(
          e.message.includes("Download is starting") ||
            e.message.includes("ERR_ABORTED"),
          `Unexpected navigation error: ${e.message}`,
        );
      }),
    ]);
    assert.ok(
      download,
      `Download must be triggered on navigation attempt ${i}`,
    );
    const suggested = download.suggestedFilename();
    assert.ok(
      suggested.endsWith(".pdf"),
      `Filename must end with .pdf, got ${suggested}`,
    );
    console.log(
      `✔ Navigation attempt ${i}/5 succeeded (Download: ${suggested})`,
    );
  }

  await browser.close();

  console.log("\n=======================================================");
  console.log("✔ ALL CONSULTANT V3 PDF NAVIGATION & DELIVERY TESTS PASSED!");
  console.log("=======================================================\n");
}

runNavigationTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
