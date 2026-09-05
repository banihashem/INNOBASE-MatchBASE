#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "../packages/data/node_modules/pg/lib/index.js";
import {
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
  GOLDEN_SCENARIO_V3_03,
  GOLDEN_SCENARIO_V3_04,
  assertConsultantOutputV3Integrity,
} from "../packages/contracts/dist/src/index.js";

const BASE_URL = process.env.MATCHBASE_BASE_URL || "http://localhost:3000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

console.log("=== MatchBASE Consultant V3 Golden Suite Verification ===");

// 1. Contract & Invariant Integrity Check
console.log("\n--- [Step 1] In-Memory Contract & Integrity Validation ---");
assertConsultantOutputV3Integrity(GOLDEN_SCENARIO_V3_01);
console.log(
  "✔ Golden Scenario V3-01 passed integrity validation (20 candidates, 100% lineage)",
);

assertConsultantOutputV3Integrity(GOLDEN_SCENARIO_V3_02);
console.log(
  "✔ Golden Scenario V3-02 passed integrity validation (3 truthful candidates, 100% lineage)",
);

assertConsultantOutputV3Integrity(GOLDEN_SCENARIO_V3_03);
console.log(
  "✔ Golden Scenario V3-03 passed integrity validation (0 candidates, no_strong_match)",
);

assertConsultantOutputV3Integrity(GOLDEN_SCENARIO_V3_04);
console.log(
  "✔ Golden Scenario V3-04 passed integrity validation (4 candidates, partial lane)",
);

// 2. Database State Verification
console.log("\n--- [Step 2] PostgreSQL Database Verification ---");
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  const dbScenarios = [
    {
      id: "00000000-0000-4000-8000-000000000401",
      expectedCount: 20,
      status: "complete",
    },
    {
      id: "00000000-0000-4000-8000-000000000402",
      expectedCount: 3,
      status: "complete",
    },
    {
      id: "00000000-0000-4000-8000-000000000403",
      expectedCount: 0,
      status: "no_strong_match",
    },
    {
      id: "00000000-0000-4000-8000-000000000404",
      expectedCount: 4,
      status: "partial",
    },
  ];

  for (const scen of dbScenarios) {
    const res = await client.query(
      "SELECT document_payload, research_status, total_candidates_found FROM consultant_output_v3 WHERE run_id = $1",
      [scen.id],
    );
    assert.equal(res.rows.length, 1, `DB must contain scenario ${scen.id}`);
    const payload = res.rows[0].document_payload;
    assert.equal(payload.schema_version, "consultant-research-output.v3");
    assert.equal(payload.research_status, scen.status);
    assert.equal(res.rows[0].total_candidates_found, scen.expectedCount);
    console.log(
      `✔ DB row verified: ${scen.id} (${res.rows[0].total_candidates_found} candidates, ${scen.status})`,
    );
  }

  // Check invalidated run 938
  const run938 = await client.query(
    "SELECT research_status FROM consultant_output_v3 WHERE run_id = '938dbc82-51e8-48d1-8a86-6a384c4396db'",
  );
  if (run938.rows.length > 0) {
    assert.equal(run938.rows[0].research_status, "failed");
    console.log(
      "✔ Historical corrupt run 938 is marked 'failed' and invalidated",
    );
  }
} finally {
  await client.end();
}

// 3. Live Server Endpoint Verification
console.log(
  "\n--- [Step 3] Live HTTP API Endpoints & Aliases Verification ---",
);

// Authenticate via simulator
const r1 = await fetch(`${BASE_URL}/auth/simulator/start?fixture=consultant`, {
  redirect: "manual",
});
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
const sessionCookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
assert.ok(
  sessionCookie.includes("matchbase_session="),
  "Must establish valid session cookie",
);
console.log("✔ Consultant authenticated session established via simulator");

// Test Result Endpoints
const testCases = [
  { id: "run-v3-golden-01", expectedCount: 20 },
  { id: "00000000-0000-4000-8000-000000000401", expectedCount: 20 },
  { id: "run-v3-golden-02", expectedCount: 3 },
  { id: "00000000-0000-4000-8000-000000000402", expectedCount: 3 },
  { id: "run-v3-golden-03", expectedCount: 0 },
  { id: "00000000-0000-4000-8000-000000000403", expectedCount: 0 },
  { id: "run-v3-golden-04", expectedCount: 4 },
  { id: "00000000-0000-4000-8000-000000000404", expectedCount: 4 },
];

for (const tc of testCases) {
  const res = await fetch(`${BASE_URL}/api/v1/runs/${tc.id}/result`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 200, `/api/v1/runs/${tc.id}/result must return 200`);
  const data = await res.json();
  assert.equal(data.schema_version, "consultant-research-output.v3");
  assert.equal(data.supplier_candidates.length, tc.expectedCount);
  console.log(
    `✔ HTTP 200 OK: /api/v1/runs/${tc.id}/result (${tc.expectedCount} candidates)`,
  );
}

// 4. Live PDF Report Generation & Verification
console.log("\n--- [Step 4] Live PDF Report Generation Verification ---");
const pdfCases = [
  { id: "run-v3-golden-01", filenamePart: "Poultry" },
  { id: "run-v3-golden-02", filenamePart: "Water_Heater" },
  { id: "run-v3-golden-03", filenamePart: "Zero_Match" },
  { id: "run-v3-golden-04", filenamePart: "Reverse_Osmosis" },
];

for (const pc of pdfCases) {
  const res = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/${pc.id}/pdf`,
    {
      headers: { cookie: sessionCookie },
    },
  );
  assert.equal(
    res.status,
    200,
    `/api/v1/consultant/reports/${pc.id}/pdf must return 200`,
  );
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const disposition = res.headers.get("content-disposition") || "";
  assert.ok(
    disposition.toLowerCase().includes(pc.filenamePart.toLowerCase()),
    `Content-Disposition '${disposition}' must contain '${pc.filenamePart}'`,
  );
  const buf = await res.arrayBuffer();
  assert.ok(
    buf.byteLength > 50000,
    `PDF must be valid size (>50KB, got ${buf.byteLength})`,
  );
  console.log(
    `✔ PDF Generated OK: ${pc.id} (${buf.byteLength} bytes, ${disposition})`,
  );
}

console.log("\n=======================================================");
console.log("✔ ALL CONSULTANT V3 GOLDEN SUITE VERIFICATIONS PASSED!");
console.log("=======================================================\n");
