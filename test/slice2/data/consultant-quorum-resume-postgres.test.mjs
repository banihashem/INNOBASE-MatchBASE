import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendConsultantWorkflowEvent,
  createPool,
  enqueueConsultantWorkflowJob,
  hashResearchAuthority,
  migrateUp,
  readConsultantProviderRouteRejectionEvents,
  resumeFailedConsultantResearchExecution,
  saveConsultantWorkflowSession,
} from "../../../packages/data/dist/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;

dbTest(
  "MB-UX-QUALITY-001 L15 queues one same-execution quorum resume without extending authority",
  async (t) => {
    const db = createPool({ connectionString: database, max: 4 });
    const identity = Object.fromEntries(
      [
        "account_id",
        "user_profile_id",
        "run_id",
        "execution_id",
        "classification_id",
      ].map((key) => [key, randomUUID()]),
    );
    t.after(async () => {
      try {
        for (const table of [
          "consultant_research_stage",
          "consultant_research_attempt",
          "consultant_provider_call",
          "consultant_workflow_event",
          "consultant_research_round",
          "consultant_workflow_job",
          "consultant_workflow_session",
        ])
          await db.query(`DELETE FROM ${table} WHERE account_id=$1`, [
            identity.account_id,
          ]);
        await db.query("DELETE FROM account WHERE account_id=$1", [
          identity.account_id,
        ]);
      } finally {
        await db.end();
      }
    });
    await migrateUp(db);
    await db.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Quorum resume isolated fixture','active')",
      [identity.account_id],
    );
    await saveConsultantWorkflowSession(db, {
      ...identity,
      session_id: randomUUID(),
      current_state: "workflow_failed",
      last_checkpoint: "workflow_failed",
      original_intake: { product_requirement: "Industrial service" },
      workflow_metadata: {
        mode: "live",
        classification_id: identity.classification_id,
        error: "Provider route rejected",
        retry_action: "research",
      },
    });
    const models = [
      "google/test",
      "openai/test",
      "anthropic/test",
      "deepseek/test",
      "x-ai/test",
    ];
    const plan = {
      version: "research-round.v1",
      round_number: 1,
      research_tier: "ultra",
      research_models: models,
      extraction_model: "openai/test",
      synthesis_model: "openai/test",
      max_calls: 30,
      execution_recovery: {
        version: "durable.v1",
        max_resumes: 2,
        valid_for_ms: 86400000,
      },
    };
    const roundId = randomUUID();
    await db.query(
      `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,approved_at,completed_at)
       VALUES($1,$2,$3,$4,$5,1,$6,'failed',$7,clock_timestamp(),clock_timestamp())`,
      [
        roundId,
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.classification_id,
        JSON.stringify(plan),
        identity.execution_id,
      ],
    );
    const job = await enqueueConsultantWorkflowJob(
      db,
      identity,
      "research",
      "live",
    );
    await db.query(
      `UPDATE consultant_workflow_job SET status='failed',error_code='workflow-execution-failed',completed_at=clock_timestamp()
       WHERE job_id=$1`,
      [job.job_id],
    );
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    let rejectedRequestId;
    for (const [index, model] of models.entries()) {
      const requestId = randomUUID();
      if (index === 2) rejectedRequestId = requestId;
      await db.query(
        `INSERT INTO consultant_research_attempt(request_id,account_id,user_profile_id,run_id,execution_id,classification_id,
         job_id,lease_token,round_id,operation_key,stage_key,phase,model,input_sha256,approval_sha256,outcome,provider_outcome,receipt)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          requestId,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          identity.execution_id,
          identity.classification_id,
          job.job_id,
          randomUUID(),
          roundId,
          `operation-${index}`,
          hashResearchAuthority(`stage-${index}`),
          `discovery_${model.split("/")[0]}`,
          model,
          hashResearchAuthority(`input-${index}`),
          hashResearchAuthority(plan),
          index === 2 ? "failed" : "completed",
          index === 2 ? "rejected" : "received",
          JSON.stringify({ state: index === 2 ? "failed" : "completed" }),
        ],
      );
      if (index === 2) continue;
      const manifest = {
        version: "research-stage.v1",
        stage_kind: `discovery_${model.split("/")[0]}:1:provider_response`,
        qualification: "received_unvalidated",
        operation_key: `operation-${index}`,
        input_sha256: hashResearchAuthority(`input-${index}`),
        policy_sha256: hashResearchAuthority("policy"),
      };
      await db.query(
        `INSERT INTO consultant_research_stage(stage_id,account_id,user_profile_id,run_id,execution_id,classification_id,
         job_id,round_id,manifest_sha256,manifest,result,result_sha256,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          identity.execution_id,
          identity.classification_id,
          job.job_id,
          roundId,
          hashResearchAuthority(manifest),
          JSON.stringify(manifest),
          JSON.stringify({ requested_model: model }),
          hashResearchAuthority({ requested_model: model }),
          expiresAt,
        ],
      );
    }
    await appendConsultantWorkflowEvent(db, identity, "discovery_openai", {
      state: "failed",
      request_id: rejectedRequestId,
      requested_model: "anthropic/test",
      dispatched: true,
      provider_dispatch_rejected: true,
      provider_receipt_received: false,
      provider_http_failure: {
        http_status: 404,
        request_format: "text",
        category: "privacy",
      },
    });
    await appendConsultantWorkflowEvent(db, identity, "discovery_anthropic", {
      state: "failed",
      request_id: rejectedRequestId,
      requested_model: "anthropic/test",
      dispatched: true,
      provider_dispatch_rejected: true,
      provider_receipt_received: false,
      provider_http_failure: { http_status: 404, category: "privacy" },
    });
    assert.equal(
      (await readConsultantProviderRouteRejectionEvents(db, identity)).length,
      0,
    );
    await appendConsultantWorkflowEvent(db, identity, "discovery_anthropic", {
      state: "failed",
      request_id: rejectedRequestId,
      requested_model: "anthropic/test",
      dispatched: true,
      provider_dispatch_rejected: true,
      provider_receipt_received: false,
      provider_http_failure: {
        http_status: 404,
        request_format: "text",
        category: "privacy",
      },
    });
    const retainedEvents = await readConsultantProviderRouteRejectionEvents(
      db,
      identity,
    );
    assert.equal(retainedEvents.length, 1);
    assert.equal(retainedEvents[0].detail.request_id, rejectedRequestId);

    const dryRun = await resumeFailedConsultantResearchExecution(
      db,
      identity.account_id,
      identity.run_id,
      identity.execution_id,
    );
    assert.equal(dryRun.queued, false);
    assert.equal(dryRun.completed_models, 4);
    assert.equal(dryRun.rejected_models, 1);
    assert.equal(dryRun.retained_stages, 4);
    assert.equal(
      (
        await db.query(
          "SELECT status FROM consultant_workflow_job WHERE job_id=$1",
          [job.job_id],
        )
      ).rows[0].status,
      "failed",
    );

    const executed = await resumeFailedConsultantResearchExecution(
      db,
      identity.account_id,
      identity.run_id,
      identity.execution_id,
      true,
    );
    assert.equal(executed.queued, true);
    const state = await db.query(
      `SELECT j.status,j.resume_count,r.status AS round_status,s.current_state,s.workflow_metadata
       FROM consultant_workflow_job j JOIN consultant_research_round r ON r.execution_id=j.execution_id
       JOIN consultant_workflow_session s ON s.account_id=j.account_id AND s.run_id=j.run_id
       WHERE j.job_id=$1`,
      [job.job_id],
    );
    assert.equal(state.rows[0].status, "queued");
    assert.equal(state.rows[0].resume_count, 1);
    assert.equal(state.rows[0].round_status, "approved");
    assert.equal(state.rows[0].current_state, "research_dispatching");
    assert.equal(
      state.rows[0].workflow_metadata.recovery_state,
      "resuming_saved_stages",
    );
    await assert.rejects(
      resumeFailedConsultantResearchExecution(
        db,
        identity.account_id,
        identity.run_id,
        identity.execution_id,
        true,
      ),
      { code: "MB-409-EXECUTION-RESUME" },
    );
  },
);
