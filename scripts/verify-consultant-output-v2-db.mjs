import { parseConsultantResearchOutputV2 } from "../packages/contracts/dist/src/index.js";
import { standardCompleteResultDocumentSha256 } from "../packages/application/dist/index.js";

console.log(
  "=== Verifying Consultant Deep-Research Output V2 PostgreSQL Persistence ===",
);

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

const expectedAccountId = "a9442670-2db5-447f-8fb4-c71f6e16a893";

try {
  // 1. Verify research_run table
  const runsRes = await client.query(
    `SELECT run_id, account_id, tier_at_submission, state
       FROM research_run
      WHERE run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'
      ORDER BY run_id ASC`,
  );

  if (runsRes.rows.length !== 15) {
    throw new Error(
      `Verification failed: expected exactly 15 golden research_run rows, found ${runsRes.rows.length}.`,
    );
  }
  console.log(`✔ Found exactly 15 golden research_run records.`);

  for (const row of runsRes.rows) {
    if (row.tier_at_submission !== "consultant") {
      throw new Error(
        `Run ${row.run_id} has tier "${row.tier_at_submission}", expected "consultant".`,
      );
    }
    if (row.account_id !== expectedAccountId) {
      throw new Error(
        `Run ${row.run_id} is owned by account ${row.account_id}, expected ${expectedAccountId}.`,
      );
    }
  }
  console.log(
    `✔ All 15 runs have tier_at_submission = 'consultant' and correct account ownership.`,
  );

  // 2. Verify run_result table
  const resultsRes = await client.query(
    `SELECT run_id, account_id, outcome, complete_result_document, result_sha256
       FROM run_result
      WHERE run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'
      ORDER BY run_id ASC`,
  );

  if (resultsRes.rows.length !== 15) {
    throw new Error(
      `Verification failed: expected exactly 15 run_result rows, found ${resultsRes.rows.length}.`,
    );
  }
  console.log(`✔ Found exactly 15 run_result records.`);

  for (const row of resultsRes.rows) {
    const doc = row.complete_result_document;
    if (!doc || typeof doc !== "object") {
      throw new Error(`Run ${row.run_id} has null or invalid document body.`);
    }

    if (doc.schema_version !== "consultant-research-output.v2") {
      throw new Error(
        `Run ${row.run_id} has schema_version "${doc.schema_version}", expected "consultant-research-output.v2".`,
      );
    }

    // Verify contract parsing
    const parsed = parseConsultantResearchOutputV2(doc);
    if (!parsed) {
      throw new Error(`Run ${row.run_id} failed runtime contract parsing.`);
    }

    // Verify SHA-256 integrity digest
    const computedDigest = standardCompleteResultDocumentSha256(doc);
    if (!row.result_sha256 || !computedDigest.equals(row.result_sha256)) {
      throw new Error(
        `Run ${row.run_id} SHA-256 digest mismatch! Computed: ${computedDigest.toString("hex")}, Stored: ${row.result_sha256?.toString("hex")}`,
      );
    }
  }
  console.log(
    `✔ All 15 run_result records strictly parse as consultant-research-output.v2 with matching SHA-256 digests.`,
  );

  // 3. Verify consultant_result_projection_policy table
  const policyRes = await client.query(
    `SELECT run_id, account_id, config_version, soft_cap
       FROM consultant_result_projection_policy
      WHERE run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'
      ORDER BY run_id ASC`,
  );

  if (policyRes.rows.length !== 15) {
    throw new Error(
      `Verification failed: expected exactly 15 consultant_result_projection_policy rows, found ${policyRes.rows.length}.`,
    );
  }
  console.log(`✔ Found exactly 15 consultant projection policy records.`);

  console.log(
    "\n==================================================================",
  );
  console.log(
    "✔ ALL 15 CONSULTANT V2 GOLDEN SCENARIOS EMPIRICALLY VERIFIED IN POSTGRESQL.",
  );
  console.log(
    "==================================================================\n",
  );
} catch (err) {
  console.error("❌ Verification failed:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
