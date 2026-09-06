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

  // 1. Upsert consultant_workflow_session for targetRunId
  const sessionRes = await client.query(
    `INSERT INTO consultant_workflow_session (
       session_id, account_id, run_id, user_profile_id, current_state,
       original_intake, approvals, is_invalidated, invalidation_reason,
       last_checkpoint, advisory_output, updated_at
     ) VALUES (
       $1,
       'a9442670-2db5-447f-8fb4-c71f6e16a893',
       $1,
       '2efd403d-823e-4b3f-9fe8-fe3f800c460e',
       'invalidated',
       '{}'::jsonb,
       '[]'::jsonb,
       true,
       'Audit quarantine: cross-request contamination, poultry claims in water-heater, false verification',
       'invalidated_by_mb_ux_rem_004',
       jsonb_build_object('invalidation_audit', $2::jsonb),
       NOW()
     ) ON CONFLICT (account_id, run_id) DO UPDATE
     SET current_state = 'invalidated',
         is_invalidated = true,
         invalidation_reason = EXCLUDED.invalidation_reason,
         last_checkpoint = EXCLUDED.last_checkpoint,
         advisory_output = jsonb_set(
           COALESCE(consultant_workflow_session.advisory_output, '{}'::jsonb),
           '{invalidation_audit}',
           $2::jsonb
         ),
         updated_at = NOW()
     RETURNING session_id, current_state;`,
    [targetRunId, JSON.stringify(invalidationAudit)],
  );
  console.log(
    `consultant_workflow_session upserted for targetRunId: ${sessionRes.rowCount} row(s)`,
  );

  // Also ensure run 938dbc82-51e8-48d1-8a86-6a384c4396db is marked is_invalidated
  await client.query(
    `UPDATE consultant_workflow_session
     SET is_invalidated = true,
         invalidation_reason = 'Audit quarantine: corrupted research run from previous UAT cycle',
         current_state = 'invalidated'
     WHERE run_id = '938dbc82-51e8-48d1-8a86-6a384c4396db';`,
  );

  // Phase H: Invalidate user-created overclaiming run 9fc5885f-8e5b-43cb-bdc7-7e0b87c854e6
  const userRunId = "9fc5885f-8e5b-43cb-bdc7-7e0b87c854e6";
  const userRunAudit = {
    invalidated_at: new Date().toISOString(),
    invalidation_state: "superseded",
    detection_activity: "MB-UX-UAT-003 L04",
    remediation_activity: "MB-UX-REM-004 L02",
    invalidation_reasons: [
      "overclaiming synthetic fixture semantics",
      "synthetic candidate presented with external verification claims",
      "revoked PDF and JSON artifact eligibility per MB-UX-REM-004 L02 Phase H",
    ],
    audit_verdict: "EVALUATION_FAILED_SUPERSEDED",
  };

  await client.query(
    `INSERT INTO consultant_workflow_session (
       session_id, account_id, run_id, user_profile_id, current_state,
       original_intake, approvals, is_invalidated, invalidation_reason,
       last_checkpoint, advisory_output, updated_at
     ) VALUES (
       $1,
       'a9442670-2db5-447f-8fb4-c71f6e16a893',
       $1,
       '2efd403d-823e-4b3f-9fe8-fe3f800c460e',
       'invalidated',
       '{}'::jsonb,
       '[]'::jsonb,
       true,
       'Audit quarantine: overclaiming synthetic fixture semantics per MB-UX-REM-004 L02 Phase H',
       'superseded_by_mb_ux_rem_004_l02',
       jsonb_build_object('invalidation_audit', $2::jsonb),
       NOW()
     ) ON CONFLICT (account_id, run_id) DO UPDATE
     SET current_state = 'invalidated',
         is_invalidated = true,
         invalidation_reason = EXCLUDED.invalidation_reason,
         last_checkpoint = EXCLUDED.last_checkpoint,
         advisory_output = jsonb_set(
           COALESCE(consultant_workflow_session.advisory_output, '{}'::jsonb),
           '{invalidation_audit}',
           $2::jsonb
         ),
         updated_at = NOW();`,
    [userRunId, JSON.stringify(userRunAudit)],
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

  await client.query(
    `UPDATE consultant_output_v3
     SET is_invalidated = true,
         invalidation_reason = 'Audit quarantine: overclaiming synthetic fixture semantics per MB-UX-REM-004 L02 Phase H',
         research_status = 'failed',
         document_payload = jsonb_set(
           document_payload,
           '{invalidation_audit}',
           $2::jsonb
         )
     WHERE run_id = $1;`,
    [userRunId, JSON.stringify(userRunAudit)],
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

  await client.query(
    `UPDATE research_run
     SET state = 'failed'
     WHERE run_id = '9fc5885f-8e5b-43cb-bdc7-7e0b87c854e6';`,
  );

  // 4. Update consultant_pdf_report_ledger if exists
  const pdfRes = await client.query(
    `UPDATE consultant_pdf_report_ledger
     SET filename = CASE WHEN filename LIKE 'INVALIDATED_%' THEN filename ELSE 'INVALIDATED_' || filename END
     WHERE run_id = $1 OR run_id = '9fc5885f-8e5b-43cb-bdc7-7e0b87c854e6'
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
