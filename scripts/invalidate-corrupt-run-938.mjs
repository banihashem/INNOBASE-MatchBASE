#!/usr/bin/env node
/**
 * Invalidate corrupt run 938dbc82-51e8-48d1-8a86-6a384c4396db
 * Persists audit metadata explaining invalidation reason.
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

const targetRunId = "938dbc82-51e8-48d1-8a86-6a384c4396db";
const invalidationAudit = {
  invalidated_at: new Date().toISOString(),
  invalidation_state: "invalidated",
  invalidation_reasons: [
    "request-lineage mismatch (CFR approved request displayed as CIF in final supplier result)",
    "unsupported verification claims (100% claim-to-evidence lineage and 20 verified candidates claimed on deterministic fixture)",
    "orphan evidence references (61 orphan evidence references, 20 missing distinct evidence IDs)",
    "fabricated contact and domain fields (generated domains and export@ emails for ranks 6-20)",
    "score-governance violations (candidates with failed mandatory SFDA approval assigned scores above 60 and Strong Fit)",
    "misleading research mode (deterministic fixture represented as completed hybrid dual-provider web research)",
    "misleading PDF claims (ready for immediate PO issuance claimed without evidence lineage)",
  ],
  remediation_activity: "MB-UX-REM-003",
  audit_verdict: "EVALUATION_FAILED_QUARANTINED",
};

try {
  await client.query("BEGIN");

  console.log(`Checking run ${targetRunId}...`);

  // 1. Update consultant_workflow_session
  const sessionRes = await client.query(
    `UPDATE consultant_workflow_session
     SET current_state = 'invalidated',
         last_checkpoint = 'invalidated_by_mb_ux_rem_003',
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

  // 2. Update consultant_output_v3 if exists
  const outputRes = await client.query(
    `UPDATE consultant_output_v3
     SET research_status = 'failed',
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
     SET filename = 'INVALIDATED_' || filename
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
