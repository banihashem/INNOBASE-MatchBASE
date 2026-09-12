#!/usr/bin/env node
import { resolveScriptTestTargets } from "./lib/database-config.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  preflightConsultantPdfRenderer,
  ConsultantPdfRendererUnavailableError,
} from "../packages/reporting/dist/src/index.js";

const { baseUrl: BASE_URL, fetch } = resolveScriptTestTargets();

console.log(
  "=== MatchBASE Consultant V3 PDF Runtime Reliability Test Suite ===",
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
  // 1. Preflight Health Check
  console.log("\n--- [Step 1] Preflight Health Check ---");
  const isHealthy = await preflightConsultantPdfRenderer();
  assert.ok(isHealthy, "Preflight check for ConsultantPdfRenderer must pass");
  console.log("✔ ConsultantPdfRenderer preflight check passed successfully");

  // 2. Unauthenticated Access Control Check
  console.log("\n--- [Step 2] Unauthenticated & Unauthorized Checks ---");
  const unauthRes = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/run-v3-golden-01/pdf`,
  );
  assert.equal(
    unauthRes.status,
    401,
    `Unauthenticated request must return 401, got ${unauthRes.status}`,
  );
  const unauthBody = await unauthRes.json();
  assert.equal(unauthBody.code, "MB-401-SESSION");
  console.log(
    "✔ Unauthenticated request correctly rejected with HTTP 401 MB-401-SESSION",
  );

  // Standard user access control
  const standardCookie = await getAuthCookie("standard");
  const standardRes = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/run-v3-golden-01/pdf`,
    {
      headers: { Cookie: standardCookie },
    },
  );
  assert.equal(
    standardRes.status,
    403,
    `Standard user must be rejected with 403, got ${standardRes.status}`,
  );
  const standardBody = await standardRes.json();
  assert.ok(
    standardBody.code === "MB-403-TIER" ||
      standardBody.code === "MB-403-FORBIDDEN",
    `Error code must be MB-403-TIER or MB-403-FORBIDDEN, got '${standardBody.code}'`,
  );
  console.log(
    `✔ Standard user request correctly rejected with HTTP 403 ${standardBody.code}`,
  );

  // 3. Authorized Consultant PDF Retrieval Across Golden Suite (V3-01..V3-04)
  console.log(
    "\n--- [Step 3] Authorized Consultant PDF Retrieval Across V3-01..V3-04 ---",
  );
  const consultantCookie = await getAuthCookie("consultant");

  const goldenCases = [
    { id: "run-v3-golden-01", name: "V3-01 (Poultry)" },
    { id: "run-v3-golden-02", name: "V3-02 (Water Heater)" },
    { id: "run-v3-golden-03", name: "V3-03 (Zero Match)" },
    { id: "run-v3-golden-04", name: "V3-04 (Reverse Osmosis)" },
  ];

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
      `Authorized PDF request for ${gc.id} must return 200, got ${res.status}`,
    );

    // Verify Headers
    const contentType = res.headers.get("content-type");
    assert.equal(
      contentType,
      "application/pdf",
      `Content-Type must be application/pdf, got ${contentType}`,
    );

    const disposition = res.headers.get("content-disposition") || "";
    assert.ok(
      disposition.includes("attachment; filename="),
      `Content-Disposition must specify attachment filename, got '${disposition}'`,
    );

    const cacheControl = res.headers.get("cache-control") || "";
    assert.ok(
      cacheControl.includes("private") && cacheControl.includes("no-store"),
      `Cache-Control must contain private, no-store, got '${cacheControl}'`,
    );

    const pragma = res.headers.get("pragma") || "";
    assert.equal(pragma, "no-cache", "Pragma header must be no-cache");

    const contentTypeOptions = res.headers.get("x-content-type-options") || "";
    assert.equal(
      contentTypeOptions,
      "nosniff",
      "X-Content-Type-Options must be nosniff",
    );

    // Verify Binary Body
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(
      buf.length > 10240,
      `PDF size must be > 10KB, got ${buf.length} bytes`,
    );
    const magic = buf.subarray(0, 5).toString("utf-8");
    assert.equal(
      magic,
      "%PDF-",
      `File must start with %PDF- header, got '${magic}'`,
    );

    console.log(
      `✔ ${gc.name}: 200 OK (${buf.length} bytes, signature ${magic}, filename in disposition)`,
    );
  }

  // 4. Verify Private Artifact Disk Cache
  console.log("\n--- [Step 4] Private Artifact Disk Cache Verification ---");
  const cacheDirCandidates = [
    path.resolve(
      "C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/.artifacts/consultant-pdf",
    ),
    path.resolve(process.cwd(), ".artifacts/consultant-pdf"),
    path.resolve(process.cwd(), "apps/web/.artifacts/consultant-pdf"),
    path.resolve(process.cwd(), "../.artifacts/consultant-pdf"),
  ];
  let foundCachedFiles = 0;
  for (const dir of cacheDirCandidates) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"));
      if (files.length > 0) {
        foundCachedFiles = files.length;
        console.log(
          `✔ Found ${files.length} cached PDF artifact(s) in '${dir}'`,
        );
        break;
      }
    }
  }
  assert.ok(
    foundCachedFiles > 0,
    "At least one cached PDF artifact must exist in .artifacts/consultant-pdf",
  );

  // 5. Verify Error Contract Definition
  console.log(
    "\n--- [Step 5] Renderer Unavailable Error Contract Verification ---",
  );
  const err = new ConsultantPdfRendererUnavailableError(
    "Consultant PDF renderer is currently unavailable. Please retry shortly.",
  );
  assert.equal(err.code, "MB-503-PDF-RENDERER-UNAVAILABLE");
  assert.equal(err.status, 503);
  console.log(
    `✔ ConsultantPdfRendererUnavailableError contract verified: code='${err.code}', status=${err.status}`,
  );

  console.log("\n=======================================================");
  console.log("✔ ALL CONSULTANT V3 PDF RUNTIME RELIABILITY TESTS PASSED!");
  console.log("=======================================================\n");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
