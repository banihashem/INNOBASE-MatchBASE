import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { StandardWorkspaceApplication } from "../../../packages/application/dist/index.js";
import {
  admitRunWithinQuota,
  createPool,
  migrateDown,
  migrateDownLatest,
  migrateUp,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const privacyKey = "slice2-combined-worker-test-key-00000000000000000001";
const workerPath = fileURLToPath(
  new URL(
    "../../../packages/application/dist/combined-synthetic-worker.js",
    import.meta.url,
  ),
);

function digest(value) {
  return createHash("sha256").update(value).digest();
}

async function waitUntil(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the combined worker condition.");
}

async function startWorker(delayMs) {
  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_DIGEST_KEY: privacyKey,
      MATCHBASE_WORKER_HEALTH_PORT: "3011",
      MATCHBASE_SYNTHETIC_WORKER_DELAY_MS: String(delayMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (value) => {
    output += value.toString();
  });
  child.stderr.on("data", (value) => {
    output += value.toString();
  });
  await waitUntil(async () => {
    if (child.exitCode !== null)
      throw new Error(`Combined worker exited early: ${output}`);
    return fetch("http://127.0.0.1:3011/health")
      .then((response) => response.status === 200)
      .catch(() => false);
  });
  return { child, output: () => output };
}

async function dropFailureProbe(pool) {
  await pool.query(
    "DROP TRIGGER IF EXISTS slice2_fail_provider_call_once ON provider_call",
  );
  await pool.query("DROP FUNCTION IF EXISTS slice2_fail_provider_call_once() ");
  await pool.query("DROP TABLE IF EXISTS slice2_worker_failure_probe");
}

async function stopWorker(worker) {
  if (worker.child.exitCode !== null) return;
  worker.child.kill("SIGTERM");
  await Promise.race([
    once(worker.child, "exit"),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Combined worker did not stop: ${worker.output()}`)),
        5_000,
      ),
    ),
  ]);
}

async function seedTier(pool, tier, config) {
  const accountId = randomUUID();
  const userId = randomUUID();
  const grantorId = randomUUID();
  await pool.query(
    "INSERT INTO account(account_id,display_name,status) VALUES($1,$2,'active')",
    [accountId, `${tier} mixed worker account`],
  );
  await pool.query(
    "INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status) VALUES($1,$2,$3,true,'active'),($4,$2,$5,true,'active')",
    [
      userId,
      accountId,
      `${tier}-${userId}`,
      grantorId,
      `${tier}-grantor-${grantorId}`,
    ],
  );
  await pool.query(
    "INSERT INTO entitlement_grant(grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from) VALUES($1,$2,$3,$4,'user',$5,'mixed worker test',clock_timestamp())",
    [randomUUID(), accountId, userId, tier, grantorId],
  );
  const runIds = [];
  for (let index = 0; index < 3; index += 1) {
    const requestId = randomUUID();
    const canonicalizationRunId = randomUUID();
    const canonicalId = randomUUID();
    await pool.query(
      "INSERT INTO canonicalization_execution_run(canonicalization_run_id,account_id,user_id,subject_request_id,request_correlation_id,started_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())",
      [canonicalizationRunId, accountId, userId, requestId, randomUUID()],
    );
    await pool.query(
      "INSERT INTO sourcing_request(request_id,account_id,created_by_user_id,canonicalization_run_id,current_version,lifecycle_state) VALUES($1,$2,$3,$4,1,'confirmed')",
      [requestId, accountId, userId, canonicalizationRunId],
    );
    await pool.query(
      "INSERT INTO canonical_request_version(canonical_request_version_id,request_id,account_id,version,canonical_document,match_readiness,created_by_user_id) VALUES($1,$2,$3,1,$4::jsonb,'ready',$5)",
      [
        canonicalId,
        requestId,
        accountId,
        JSON.stringify({
          schema_version: "mixed-worker-canonical.v1",
          tier,
          fixture_index: index,
        }),
        userId,
      ],
    );
    await pool.query(
      "INSERT INTO canonical_confirmation(confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at) VALUES($1,$2,$3,$4,true,clock_timestamp())",
      [randomUUID(), canonicalId, accountId, userId],
    );
    const admission = await admitRunWithinQuota(pool, {
      accountId,
      userId,
      canonicalRequestVersionId: canonicalId,
      idempotencyKeyHash: digest(`${tier}-mixed-key-${index}`),
      requestHash: digest(`${tier}-mixed-request-${index}`),
      modelPolicyVersionId: config.modelPolicyId,
      scoringConfigVersionId: config.scoringConfigId,
      correlationId: randomUUID(),
      deploymentId: "slice2-combined-worker-test",
    });
    assert.equal(admission.disposition, "accepted");
    runIds.push(admission.runId);
  }
  return { accountId, userId, runIds };
}

postgresTest(
  "combined worker dispatches six mixed Demo and Standard runs with restart, cancellation, expiry recovery, and exact ledgers",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 12 });
    let worker;
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const modelPolicyId = randomUUID();
      const scoringConfigId = randomUUID();
      const version = Math.floor(Math.random() * 1_000_000_000) + 1;
      await pool.query(
        "INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at) VALUES($1,$2,'{}'::jsonb,$3,clock_timestamp())",
        [modelPolicyId, version, digest("mixed-model")],
      );
      await pool.query(
        "INSERT INTO scoring_config_version(scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref) VALUES($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'po','sme','mixed')",
        [scoringConfigId, version, digest("mixed-scoring")],
      );
      const demo = await seedTier(pool, "demo", {
        modelPolicyId,
        scoringConfigId,
      });
      const standard = await seedTier(pool, "standard", {
        modelPolicyId,
        scoringConfigId,
      });
      const standardContext = {
        accountId: standard.accountId,
        userId: standard.userId,
        tier: "standard",
        adminSubRoles: [],
        correlationId: randomUUID(),
        deploymentId: "slice2-combined-worker-test",
      };
      const standardApplication = new StandardWorkspaceApplication({
        pool,
        privacyKey,
      });
      await standardApplication.cancelRun(standardContext, standard.runIds[2]);

      await pool.query(
        "UPDATE execution_lease SET run_id=$1,account_id=$2,owner_token_hash=$3,acquired_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE slot_no=1",
        [demo.runIds[0], demo.accountId, digest("expired-owner")],
      );

      await dropFailureProbe(pool);
      await pool.query(
        "CREATE TABLE slice2_worker_failure_probe(run_id uuid PRIMARY KEY)",
      );
      await pool.query("INSERT INTO slice2_worker_failure_probe VALUES($1)", [
        standard.runIds[0],
      ]);
      await pool.query(`CREATE FUNCTION slice2_fail_provider_call_once() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM slice2_worker_failure_probe WHERE run_id=NEW.run_id) THEN
            RAISE EXCEPTION 'slice2 deterministic retry probe';
          END IF;
          RETURN NEW;
        END $$`);
      await pool.query(
        "CREATE TRIGGER slice2_fail_provider_call_once BEFORE INSERT ON provider_call FOR EACH ROW EXECUTE FUNCTION slice2_fail_provider_call_once()",
      );

      worker = await startWorker(1_500);
      await stopWorker(worker);
      worker = undefined;
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM research_run WHERE state='queued'",
          )
        ).rows[0].count,
        5,
      );

      worker = await startWorker(250);
      let maximumActiveLeases = 0;
      try {
        await waitUntil(async () => {
          const leased = await pool.query(
            "SELECT count(*)::int AS count FROM execution_lease WHERE run_id IS NOT NULL AND released_at IS NULL AND expires_at>clock_timestamp()",
          );
          maximumActiveLeases = Math.max(
            maximumActiveLeases,
            leased.rows[0].count,
          );
          const retried = await pool.query(
            "SELECT state FROM research_run WHERE run_id=$1",
            [standard.runIds[0]],
          );
          return retried.rows[0]?.state === "failed_retryable";
        });
        await pool.query("DELETE FROM slice2_worker_failure_probe");
        await waitUntil(async () => {
          const leased = await pool.query(
            "SELECT count(*)::int AS count FROM execution_lease WHERE run_id IS NOT NULL AND released_at IS NULL AND expires_at>clock_timestamp()",
          );
          maximumActiveLeases = Math.max(
            maximumActiveLeases,
            leased.rows[0].count,
          );
          const terminal = await pool.query(
            "SELECT count(*)::int AS count FROM research_run WHERE state IN ('complete','no_responsible_match','failed','cancelled')",
          );
          return terminal.rows[0].count === 6;
        }, 20_000);
      } catch (error) {
        const state = await pool.query(
          "SELECT state,count(*)::int AS count FROM research_run GROUP BY state ORDER BY state",
        );
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} states=${JSON.stringify(state.rows)} worker=${worker.output()}`,
        );
      }
      await stopWorker(worker);
      worker = undefined;

      assert.equal(maximumActiveLeases, 3);
      const states = await pool.query(
        "SELECT state,count(*)::int AS count FROM research_run GROUP BY state ORDER BY state",
      );
      assert.equal(
        states.rows.reduce((sum, row) => sum + row.count, 0),
        6,
      );
      assert.equal(
        states.rows.find((row) => row.state === "cancelled")?.count,
        1,
      );
      const truth = await pool.query(`SELECT
      (SELECT count(*) FROM run_result)::int AS results,
      (SELECT count(*) FROM capability_attempt)::int AS attempts,
      (SELECT count(*) FROM provider_call)::int AS calls,
      (SELECT count(*) FROM cost_event)::int AS costs,
      (SELECT count(*) FROM quota_ledger WHERE entry_kind='charge')::int AS charges,
      (SELECT count(*) FROM quota_ledger WHERE entry_kind='compensation')::int AS compensations,
      (SELECT count(*) FROM execution_lease WHERE run_id IS NOT NULL AND released_at IS NULL)::int AS retained_leases,
      (SELECT count(*) FROM (SELECT run_id FROM run_result GROUP BY run_id HAVING count(*)>1) duplicates)::int AS duplicate_results`);
      assert.deepEqual(truth.rows[0], {
        results: 5,
        attempts: 5,
        calls: 5,
        costs: 5,
        charges: 6,
        compensations: 0,
        retained_leases: 0,
        duplicate_results: 0,
      });
      const routes = await pool.query(
        "SELECT model_id,count(*)::int AS count FROM capability_attempt GROUP BY model_id ORDER BY model_id",
      );
      assert.ok(
        routes.rows.some((row) => row.model_id === "fixture-research-v1"),
      );
      assert.ok(
        routes.rows.some((row) => row.model_id === "standard-fixture-v1"),
      );
    } finally {
      if (worker) await stopWorker(worker).catch(() => undefined);
      await dropFailureProbe(pool).catch(() => undefined);
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "combined worker remains unready when the Slice 2 schema is unavailable",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 4 });
    let worker;
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      await migrateDownLatest(pool);
      const child = spawn(process.execPath, [workerPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          MATCHBASE_ENVIRONMENT: "test",
          MATCHBASE_SYNTHETIC_FIXTURE: "true",
          MATCHBASE_DIGEST_KEY: privacyKey,
          MATCHBASE_WORKER_HEALTH_PORT: "3011",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (value) => {
        output += value.toString();
      });
      child.stderr.on("data", (value) => {
        output += value.toString();
      });
      worker = { child, output: () => output };
      let snapshot;
      await waitUntil(async () => {
        if (child.exitCode !== null)
          throw new Error(`Combined worker exited early: ${output}`);
        try {
          const response = await fetch("http://127.0.0.1:3011/health");
          if (response.status !== 503) return false;
          snapshot = await response.json();
          return snapshot.reason === "schema_not_ready";
        } catch {
          return false;
        }
      });
      assert.deepEqual(snapshot, {
        status: "not_ready",
        reason: "schema_not_ready",
      });
    } finally {
      if (worker) await stopWorker(worker);
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);
