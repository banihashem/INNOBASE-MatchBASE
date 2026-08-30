import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LIVE_WORKER_FIXTURE_POLICY } from "./fixtures/live-worker-runtime.mjs";
import { canonicalResearchRoutePolicySha256 } from "../../packages/application/dist/index.js";
import {
  admitRunWithinQuota,
  createPool,
  migrateDown,
  migrateUp,
} from "../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const workerPath = fileURLToPath(
  new URL(
    "../../packages/application/dist/combined-worker.js",
    import.meta.url,
  ),
);
const digest = (value) => createHash("sha256").update(value).digest();

async function waitUntil(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for combined-worker state.");
}

async function startWorker(runtime) {
  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_DIGEST_KEY:
        "slice3-combined-worker-digest-key-0000000000000001",
      MATCHBASE_WORKER_HEALTH_PORT: "3011",
      MATCHBASE_SYNTHETIC_WORKER_DELAY_MS: "0",
      MATCHBASE_LIVE_RESEARCH_RUNTIME: runtime,
      MATCHBASE_LIVE_RESEARCH_ENABLED: runtime === "fixture" ? "true" : "false",
      MATCHBASE_LIVE_RESEARCH_TEST_FIXTURE:
        runtime === "fixture" ? "true" : "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  await waitUntil(async () => {
    if (child.exitCode !== null)
      throw new Error(`Combined worker exited early: ${output}`);
    return fetch("http://127.0.0.1:3011/health")
      .then((response) => response.status === 200)
      .catch(() => false);
  });
  return { child, output: () => output };
}

async function stopWorker(worker) {
  if (worker.child.exitCode !== null) return;
  worker.child.kill("SIGTERM");
  await Promise.race([
    once(worker.child, "exit"),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Worker shutdown timed out: ${worker.output()}`)),
        5_000,
      ),
    ),
  ]);
}

postgresTest(
  "real combined worker keeps blocked live queued and dispatches injected qualified live beside Demo and Standard synthetic",
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
        `INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at)
         VALUES($1,$2,'{}',$3,clock_timestamp())`,
        [modelPolicyId, version, digest("worker-model")],
      );
      await pool.query(
        `INSERT INTO scoring_config_version(scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref)
         VALUES($1,$2,'{}','{}',$3,clock_timestamp(),'po','sme','worker')`,
        [scoringConfigId, version, digest("worker-scoring")],
      );
      const seed = async (tier, label, researchMode) => {
        const accountId = randomUUID();
        const userId = randomUUID();
        const grantorId = randomUUID();
        const requestId = randomUUID();
        const canonicalizationId = randomUUID();
        const canonicalId = randomUUID();
        await pool.query(
          "INSERT INTO account(account_id,display_name,status) VALUES($1,$2,'active')",
          [accountId, label],
        );
        await pool.query(
          `INSERT INTO app_user(user_id,account_id,google_sub,status)
           VALUES($1,$2,$3,'active'),($4,$2,$5,'active')`,
          [
            userId,
            accountId,
            `${label}-${userId}`,
            grantorId,
            `${label}-grantor`,
          ],
        );
        await pool.query(
          `INSERT INTO entitlement_grant(grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from)
           VALUES($1,$2,$3,$4,'user',$5,'combined worker fixture',clock_timestamp()-interval '1 hour')`,
          [randomUUID(), accountId, userId, tier, grantorId],
        );
        await pool.query(
          `INSERT INTO canonicalization_execution_run(canonicalization_run_id,account_id,user_id,subject_request_id,request_correlation_id,started_at)
           VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
          [canonicalizationId, accountId, userId, requestId, randomUUID()],
        );
        await pool.query(
          `INSERT INTO sourcing_request(request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state)
           VALUES($1,$2,$3,$4,'confirmed')`,
          [requestId, accountId, userId, canonicalizationId],
        );
        await pool.query(
          `INSERT INTO canonical_request_version(canonical_request_version_id,request_id,account_id,version,canonical_document,match_readiness,created_by_user_id)
           VALUES($1,$2,$3,1,$4::jsonb,'ready',$5)`,
          [
            canonicalId,
            requestId,
            accountId,
            JSON.stringify({
              schema_version: "combined-worker-canonical.v1",
              canonical_text: `Identify qualified industrial suppliers for ${label}.`,
            }),
            userId,
          ],
        );
        await pool.query(
          `INSERT INTO canonical_confirmation(confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at)
           VALUES($1,$2,$3,$4,true,clock_timestamp())`,
          [randomUUID(), canonicalId, accountId, userId],
        );
        const admission = await admitRunWithinQuota(pool, {
          accountId,
          userId,
          canonicalRequestVersionId: canonicalId,
          idempotencyKeyHash: digest(`idempotency:${label}`),
          requestHash: digest(`request:${label}`),
          modelPolicyVersionId: modelPolicyId,
          scoringConfigVersionId: scoringConfigId,
          correlationId: randomUUID(),
          deploymentId: "slice3-combined-worker-process-test",
        });
        assert.equal(admission.disposition, "accepted");
        await pool.query(
          "UPDATE research_run SET research_mode=$3 WHERE account_id=$1 AND run_id=$2",
          [accountId, admission.runId, researchMode],
        );
        return { accountId, userId, runId: admission.runId };
      };
      const demo = await seed("demo", "demo synthetic", "synthetic_reference");
      const standard = await seed(
        "standard",
        "standard synthetic",
        "synthetic_reference",
      );
      const live = await seed(
        "standard",
        "standard qualified live",
        "qualified_live_research",
      );

      worker = await startWorker("environment");
      await waitUntil(async () => {
        const states = await pool.query(
          "SELECT run_id,state FROM research_run WHERE run_id IN ($1,$2)",
          [demo.runId, standard.runId],
        );
        return states.rows.every((row) =>
          ["complete", "no_responsible_match"].includes(row.state),
        );
      });
      assert.equal(
        (
          await pool.query("SELECT state FROM research_run WHERE run_id=$1", [
            live.runId,
          ])
        ).rows[0].state,
        "queued",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM live_research_terminal WHERE run_id=$1",
            [live.runId],
          )
        ).rows[0].count,
        0,
      );
      await stopWorker(worker);
      worker = undefined;

      const policyId = randomUUID();
      await pool.query(
        `INSERT INTO research_route_policy(research_route_policy_id,schema_version,policy_version,environment,activation_state,official_evidence,qualification_budget,content_sha256)
         VALUES($1,'research-route-policy.v1',$2,'test','qualified','["fixture-a","fixture-b"]','{"max_calls":2,"max_cost_usd":1}',$3)`,
        [
          policyId,
          LIVE_WORKER_FIXTURE_POLICY.policyVersion,
          Buffer.from(
            canonicalResearchRoutePolicySha256(LIVE_WORKER_FIXTURE_POLICY),
            "hex",
          ),
        ],
      );
      const providerRouteId = randomUUID();
      await pool.query(
        `INSERT INTO provider_route(provider_route_id,route_id,capability,provider,model_id,environment,route_kind,data_handling_posture,timeout_ms,max_attempts,retry_policy,config_version,enabled)
         VALUES($1,$2,'CAP-STRUCTURED-GENERATION','gemini_direct','gemini-2.5-flash','test','real_data','paid_no_training',1000,1,'{}',$3,true)`,
        [
          providerRouteId,
          LIVE_WORKER_FIXTURE_POLICY.routes[0].routeId,
          LIVE_WORKER_FIXTURE_POLICY.policyVersion,
        ],
      );
      await pool.query(
        `INSERT INTO provider_route_capability(provider_route_id,capability)
         VALUES($1,'CAP-SEARCH'),($1,'CAP-STRUCTURED-GENERATION')`,
        [providerRouteId],
      );
      const fallbackProviderRouteId = randomUUID();
      await pool.query(
        `INSERT INTO provider_route(provider_route_id,route_id,capability,provider,model_id,environment,route_kind,data_handling_posture,timeout_ms,max_attempts,retry_policy,config_version,enabled)
         VALUES($1,$2,'CAP-STRUCTURED-GENERATION','openrouter','google/gemini-2.5-flash','test','real_data','paid_no_training',1000,1,'{}',$3,true)`,
        [
          fallbackProviderRouteId,
          LIVE_WORKER_FIXTURE_POLICY.routes[1].routeId,
          LIVE_WORKER_FIXTURE_POLICY.policyVersion,
        ],
      );
      await pool.query(
        `INSERT INTO provider_route_capability(provider_route_id,capability)
         VALUES($1,'CAP-STRUCTURED-GENERATION')`,
        [fallbackProviderRouteId],
      );
      worker = await startWorker("fixture");
      await waitUntil(async () =>
        ["complete", "no_responsible_match"].includes(
          (
            await pool.query("SELECT state FROM research_run WHERE run_id=$1", [
              live.runId,
            ])
          ).rows[0].state,
        ),
      );
      const liveCounts = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM provider_call WHERE run_id=$1) provider_calls,
           (SELECT count(*)::int FROM search_attempt WHERE run_id=$1) searches,
           (SELECT count(*)::int FROM fetch_attempt WHERE run_id=$1) fetches,
           (SELECT count(*)::int FROM source_document WHERE run_id=$1) sources,
           (SELECT count(*)::int FROM cost_event WHERE run_id=$1) costs,
           (SELECT count(*)::int FROM live_research_terminal WHERE run_id=$1) terminals`,
        [live.runId],
      );
      assert.deepEqual(liveCounts.rows[0], {
        provider_calls: 2,
        searches: 1,
        fetches: 1,
        sources: 1,
        costs: 2,
        terminals: 1,
      });
      const capabilities = await pool.query(
        "SELECT capability FROM capability_attempt WHERE run_id=$1 ORDER BY capability",
        [live.runId],
      );
      assert.deepEqual(
        capabilities.rows.map((row) => row.capability),
        ["CAP-SEARCH", "CAP-STRUCTURED-GENERATION"],
      );
    } finally {
      if (worker) await stopWorker(worker).catch(() => undefined);
      await migrateDown(pool).catch(() => undefined);
      await pool.end();
    }
  },
);
