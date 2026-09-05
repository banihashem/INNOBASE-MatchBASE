#!/usr/bin/env node
/**
 * Invalidate corrupt run d0f8978a-8260-446e-83f6-0f7a3957875e
 * Persists audit metadata explaining invalidation reasons per MB-UX-REM-004 directive.
 */
const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

let pg;
try {
  pg = (await import("pg")).default;
} catch {
  pg = (await import("../packages/data/node_modules/pg/lib/index.js")).default;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

const targetRunId = "d0f8978a-8260-446e-83f6-0f7a3957875e";
const invalidationAudit = {
  invalidated_at: new Date().toISOString(),
  invalidation_state: "invalidated",
  detection_activity: "MB-UX-UAT-003 L03",
  remediation_activity: "MB-UX-REM-004",
  invalidation_reasons: [
    "cross-request contamination",
    "product/classification mismatch",
    "poultry claims in water-heater result",
    "orphan evidence references",
    "real entities combined with synthetic facts",
    "false verification status",
    "false hybrid/provider telemetry",
  ],
  audit_verdict: "EVALUATION_FAILED_QUARANTINED",
};

try {
  await client.query("BEGIN");

  console.log(`Quarantining and invalidating run ${targetRunId}...`);

  // 1. Update consultant_workflow_session
  const sessionRes = await client.query(
    `UPDATE consultant_workflow_session
     SET current_state = 'invalidated',
         is_invalidated = true,
         invalidation_reason = 'Audit quarantine: cross-request contamination, poultry claims in water-heater, false verification',
         last_checkpoint = 'invalidated_by_mb_ux_rem_004',
         advisory_output = jsonb_set(
           COALESCE(advisory_output, '{}'::jsonb),
           '{invalidation_audit}',
           $2::jsonb
         ),
         updated_at = NOW()
     WHERE run_id = $1
     RETURNING session_id, current_state;`,
    [targetRunId, JSON.stringify(invalidationAudit)],
  );
  console.log(
    `consultant_workflow_session updated: ${sessionRes.rowCount} row(s)`,
  );

  // Also ensure run 938dbc82-51e8-48d1-8a86-6a384c4396db is marked is_invalidated
  await client.query(
    `UPDATE consultant_workflow_session
     SET is_invalidated = true,
         invalidation_reason = 'Audit quarantine: corrupted research run from previous UAT cycle',
         current_state = 'invalidated'
     WHERE run_id = '938dbc82-51e8-48d1-8a86-6a384c4396db';`,
  );

  // 2. Update consultant_output_v3 if exists
  const outputRes = await client.query(
    `UPDATE consultant_output_v3
     SET research_status = 'failed',
         is_invalidated = true,
         invalidation_reason = 'Audit quarantine: cross-request contamination, poultry claims in water-heater, false verification',
         document_payload = jsonb_set(
           document_payload,
           '{invalidation_audit}',
           $2::jsonb
         )
     WHERE run_id = $1
     RETURNING output_id;`,
    [targetRunId, JSON.stringify(invalidationAudit)],
  );
  console.log(`consultant_output_v3 updated: ${outputRes.rowCount} row(s)`);

  await client.query(
    `UPDATE consultant_output_v3
     SET is_invalidated = true,
         invalidation_reason = 'Audit quarantine: corrupted research run from previous UAT cycle',
         research_status = 'failed'
     WHERE run_id = '938dbc82-51e8-48d1-8a86-6a384c4396db';`,
  );

  // 3. Update research_run if exists
  const runRes = await client.query(
    `UPDATE research_run
     SET state = 'failed'
     WHERE run_id = $1
     RETURNING run_id;`,
    [targetRunId],
  );
  console.log(`research_run updated: ${runRes.rowCount} row(s)`);

  // 4. Update consultant_pdf_report_ledger if exists
  const pdfRes = await client.query(
    `UPDATE consultant_pdf_report_ledger
     SET filename = CASE WHEN filename LIKE 'INVALIDATED_%' THEN filename ELSE 'INVALIDATED_' || filename END
     WHERE run_id = $1
     RETURNING report_id;`,
    [targetRunId],
  );
  console.log(
    `consultant_pdf_report_ledger updated: ${pdfRes.rowCount} row(s)`,
  );

  await client.query("COMMIT");
  console.log("Successfully committed invalidation of run", targetRunId);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed to invalidate run:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
