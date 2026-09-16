import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  claimConsultantWorkflowJob,
  createPool,
  enqueueConsultantWorkflowJob,
  getResearchRoundForExecution,
  hashResearchAuthority,
  migrateUp,
  saveConsultantWorkflowSession,
} from "../../../packages/data/dist/index.js";
import { createDurableResearchContext } from "../../../packages/application/dist/consultant-execution-context.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;

dbTest(
  "durable application binding preserves complete stage results and privately binds dispatch authority",
  async (t) => {
    const pool = createPool({ connectionString: database, max: 4 });
    const identity = Object.fromEntries(
      [
        "account_id",
        "user_profile_id",
        "run_id",
        "execution_id",
        "classification_id",
      ].map((k) => [k, randomUUID()]),
    );
    t.after(async () => {
      try {
        for (const table of [
          "consultant_workflow_event",
          "consultant_workflow_job",
          "consultant_workflow_session",
        ])
          await pool.query(`DELETE FROM ${table} WHERE account_id=$1`, [
            identity.account_id,
          ]);
        await pool.query("DELETE FROM account WHERE account_id=$1", [
          identity.account_id,
        ]);
      } finally {
        await pool.end();
      }
    });
    await migrateUp(pool);
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Isolated durable binding','active')",
      [identity.account_id],
    );
    await saveConsultantWorkflowSession(pool, {
      ...identity,
      session_id: randomUUID(),
      current_state: "research_dispatching",
      original_intake: {},
      workflow_metadata: { classification_id: identity.classification_id },
    });
    const plan = {
      max_calls: 8,
      automatic_recovery_attempts: 3,
      rates: [],
      research_models: ["fixture"],
      extraction_model: "fixture",
      synthesis_model: "fixture",
      execution_recovery: {
        version: "durable.v1",
        max_resumes: 2,
        valid_for_ms: 86400000,
      },
    };
    await pool.query(
      `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,approved_at)
    VALUES($1,$2,$3,$4,$5,1,$6,'approved',$7,clock_timestamp())`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.classification_id,
        JSON.stringify(plan),
        identity.execution_id,
      ],
    );
    const queued = await enqueueConsultantWorkflowJob(
      pool,
      identity,
      "research",
      "live",
    );
    const job = await claimConsultantWorkflowJob(pool, queued.job_id);
    const fence = { job_id: job.job_id, lease_token: job.lease_token };
    const round = await getResearchRoundForExecution(
      pool,
      identity.account_id,
      identity.execution_id,
    );
    const context = createDurableResearchContext(pool, identity, fence, round);
    const manifest = {
      version: "research-stage.v1",
      stage_kind: "fixture",
      qualification: "validated_extraction",
      operation_key: "fixture",
      input_sha256: hashResearchAuthority("input"),
      policy_sha256: hashResearchAuthority("policy"),
    };
    const fullResult = {
      result: {
        text: "complete receipt",
        citations: [{ url: "https://example.invalid", content: "full source" }],
      },
      parsed: { supplier: "fixture" },
    };
    await context.stage_store.commit(manifest, fullResult);
    assert.deepEqual(await context.stage_store.load(manifest), {
      manifest,
      result: fullResult,
    });
    const restarted = createDurableResearchContext(
      pool,
      identity,
      fence,
      round,
    );
    assert.deepEqual(await restarted.stage_store.load(manifest), {
      manifest,
      result: fullResult,
    });
    const wrongProfile = createDurableResearchContext(
      pool,
      { ...identity, user_profile_id: randomUUID() },
      fence,
      round,
    );
    await assert.rejects(wrongProfile.stage_store.load(manifest), {
      code: "execution-lease-lost",
    });
    const admission = {
      request_id: randomUUID(),
      operation_key: "fixture-request",
      stage_key: hashResearchAuthority("stage"),
      phase: "fixture",
      effective_request_sha256: hashResearchAuthority("effective-request"),
      request_input_bytes: 128,
      max_output_tokens: 64,
      is_synthesis: false,
    };
    await context.admit_call({ model: "fixture" }, false, admission);
    await assert.rejects(
      context.admit_call({ model: "fixture" }, false, admission),
      { code: "MB-409-EXECUTION-ATTEMPT" },
    );
    const rows = await pool.query(
      "SELECT * FROM consultant_research_attempt WHERE request_id=$1",
      [admission.request_id],
    );
    for (const key of Object.keys(identity))
      assert.equal(rows.rows[0][key], identity[key]);
    assert.equal(rows.rows[0].estimated_exposure_usd, null);
  },
);
