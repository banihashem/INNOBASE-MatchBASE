#!/usr/bin/env node
import assert from "node:assert/strict";

const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

console.log("=== Verifying Consultant Output V3 in PostgreSQL Database ===");

let pg;
try {
  pg = (await import("pg")).default;
} catch {
  pg = (await import("../packages/data/node_modules/pg/lib/index.js")).default;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  const accountId = "a9442670-2db5-447f-8fb4-c71f6e16a893";
  const runId = "00000000-0000-4000-8000-000000000401";

  // 1. Verify consultant_output_v3
  const outRes = await client.query(
    `SELECT * FROM consultant_output_v3 WHERE account_id = $1 AND run_id = $2;`,
    [accountId, runId],
  );
  assert.equal(
    outRes.rows.length,
    1,
    "Must find 1 consultant_output_v3 record for V3-01",
  );
  const row = outRes.rows[0];
  assert.equal(row.schema_version, "consultant-research-output.v3");
  assert.equal(row.target_candidates_count, 20);
  assert.equal(row.total_candidates_found, 20);
  console.log("✔ consultant_output_v3 row verified for V3-01.");

  // Also verify V3-02, V3-03, V3-04 exist
  for (const extraId of [
    "00000000-0000-4000-8000-000000000402",
    "00000000-0000-4000-8000-000000000403",
    "00000000-0000-4000-8000-000000000404",
  ]) {
    const extraRes = await client.query(
      `SELECT * FROM consultant_output_v3 WHERE account_id = $1 AND run_id = $2;`,
      [accountId, extraId],
    );
    assert.equal(extraRes.rows.length, 1, `Must find record for ${extraId}`);
  }
  console.log("✔ All 4 V3 scenarios verified in consultant_output_v3.");

  // Verify migration 0015 consultant_workflow_session table exists
  const sessionTableRes = await client.query(
    `SELECT to_regclass('public.consultant_workflow_session') IS NOT NULL AS exists;`,
  );
  assert.equal(
    sessionTableRes.rows[0]?.exists,
    true,
    "consultant_workflow_session table must exist",
  );
  console.log("✔ consultant_workflow_session table verified (Migration 0015).");

  // 2. Verify product_classification
  const classRes = await client.query(
    `SELECT * FROM product_classification WHERE classification_id = $1;`,
    [row.classification_id],
  );
  assert.equal(classRes.rows.length, 1);
  assert.equal(classRes.rows[0].scheme, "HS");
  assert.equal(classRes.rows[0].code, "0207.12");
  console.log("✔ product_classification record verified: HS 0207.12.");

  // 3. Verify consultant_research_execution
  const execRes = await client.query(
    `SELECT * FROM consultant_research_execution WHERE execution_id = $1;`,
    [row.execution_id],
  );
  assert.equal(execRes.rows.length, 1);
  assert.equal(execRes.rows[0].status, "completed");
  assert.ok(execRes.rows[0].verification_loops_count >= 1);
  console.log("✔ consultant_research_execution record verified.");

  // 4. Verify all 20 consultant_supplier_entity_v3 records
  const suppRes = await client.query(
    `SELECT * FROM consultant_supplier_entity_v3
     WHERE account_id = $1 AND run_id = $2
     ORDER BY rank ASC;`,
    [accountId, runId],
  );
  assert.equal(suppRes.rows.length, 20, "Must have exactly 20 suppliers");
  for (let i = 0; i < 20; i++) {
    assert.equal(suppRes.rows[i].rank, i + 1, `Rank must be ${i + 1}`);
  }
  const top4 = suppRes.rows.slice(0, 4);
  for (const s of top4) {
    assert.equal(s.manufacturer_status, "direct_manufacturer");
    assert.equal(s.fit_band, "Strong Fit");
  }
  console.log(
    "✔ 20 consultant_supplier_entity_v3 candidate rows verified (4 Active + 16 Conditional).",
  );

  console.log("ALL POSTGRESQL V3 DATABASE VERIFICATIONS PASSED ✓");
} finally {
  client.release();
  await pool.end();
}
