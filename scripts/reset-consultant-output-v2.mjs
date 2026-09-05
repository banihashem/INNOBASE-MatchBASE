console.log(
  "=== Resetting Consultant Deep-Research Output V2 Golden Scenarios ===",
);

// Safety guard: refuse to run against staging or production environments
const env =
  process.env.NODE_ENV ?? process.env.MATCHBASE_ENVIRONMENT ?? "development";
if (env === "production" || env === "staging") {
  console.error(`❌ Reset refused: unsafe environment "${env}".`);
  process.exit(1);
}

const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

// Ensure URL points to local host only
if (
  !databaseUrl.includes("127.0.0.1") &&
  !databaseUrl.includes("localhost") &&
  !databaseUrl.includes("postgres")
) {
  console.error(
    "❌ Reset refused: target database host is not a local synthetic instance.",
  );
  process.exit(1);
}

let pg;
try {
  pg = (await import("pg")).default;
} catch {
  pg = (await import("../packages/data/node_modules/pg/lib/index.js")).default;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

const managedTriggers = [
  {
    table: "consultant_result_projection_policy",
    trigger: "consultant_result_projection_policy_immutable",
  },
  {
    table: "canonical_confirmation",
    trigger: "canonical_confirmation_immutable",
  },
  {
    table: "canonical_request_version",
    trigger: "canonical_request_version_immutable",
  },
  {
    table: "canonicalization_execution_run",
    trigger: "canonicalization_execution_run_immutable",
  },
];

try {
  await client.query("BEGIN");

  console.log("Removing 15 golden scenario test fixtures from database...");

  // Temporarily disable immutable triggers for targeted fixture purge
  for (const item of managedTriggers) {
    await client.query(
      `ALTER TABLE ${item.table} DISABLE TRIGGER ${item.trigger}`,
    );
  }

  // 1. Delete projection policies
  const polRes = await client.query(
    `DELETE FROM consultant_result_projection_policy
      WHERE run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'`,
  );
  console.log(
    `- Deleted ${polRes.rowCount} consultant projection policy rows.`,
  );

  // 2. Delete run results
  const resRes = await client.query(
    `DELETE FROM run_result
      WHERE run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'`,
  );
  console.log(`- Deleted ${resRes.rowCount} run result rows.`);

  // 3. Delete research runs
  const runRes = await client.query(
    `DELETE FROM research_run
      WHERE run_id >= '00000000-0000-4000-8000-000000000301'
        AND run_id <= '00000000-0000-4000-8000-000000000315'`,
  );
  console.log(`- Deleted ${runRes.rowCount} research run rows.`);

  // 4. Delete canonical confirmations
  const confRes = await client.query(
    `DELETE FROM canonical_confirmation
      WHERE canonical_request_version_id >= '00000000-0000-4000-8000-000000000401'
        AND canonical_request_version_id <= '00000000-0000-4000-8000-000000000415'`,
  );
  console.log(`- Deleted ${confRes.rowCount} canonical confirmation rows.`);

  // 5. Delete canonical request versions
  const crvRes = await client.query(
    `DELETE FROM canonical_request_version
      WHERE canonical_request_version_id >= '00000000-0000-4000-8000-000000000401'
        AND canonical_request_version_id <= '00000000-0000-4000-8000-000000000415'`,
  );
  console.log(`- Deleted ${crvRes.rowCount} canonical request version rows.`);

  // 6. Delete sourcing requests
  const reqRes = await client.query(
    `DELETE FROM sourcing_request
      WHERE request_id >= '00000000-0000-4000-8000-000000000101'
        AND request_id <= '00000000-0000-4000-8000-000000000115'`,
  );
  console.log(`- Deleted ${reqRes.rowCount} sourcing request rows.`);

  // 7. Delete canonicalization execution runs
  const canRes = await client.query(
    `DELETE FROM canonicalization_execution_run
      WHERE canonicalization_run_id >= '00000000-0000-4000-8000-000000000201'
        AND canonicalization_run_id <= '00000000-0000-4000-8000-000000000215'`,
  );
  console.log(
    `- Deleted ${canRes.rowCount} canonicalization execution run rows.`,
  );

  // Re-enable immutable triggers
  for (const item of managedTriggers) {
    await client.query(
      `ALTER TABLE ${item.table} ENABLE TRIGGER ${item.trigger}`,
    );
  }

  await client.query("COMMIT");
  console.log(
    "✔ Golden scenarios reset successfully without impacting users or non-fixture data.",
  );
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  // Ensure triggers re-enabled even on failure
  for (const item of managedTriggers) {
    await client
      .query(`ALTER TABLE ${item.table} ENABLE TRIGGER ${item.trigger}`)
      .catch(() => {});
  }
  console.error("❌ Reset failed:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
