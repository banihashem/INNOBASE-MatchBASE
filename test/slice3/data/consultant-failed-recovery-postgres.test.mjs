import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dropDrainedRecoveryDatabase } from "../support/recovery-database-cleanup.mjs";
import {
  createPool,
  migrateUp,
  saveConsultantWorkflowSession,
  saveConsultantOutputV3,
  enqueueConsultantWorkflowJob,
  recoverFailedResearchRound,
} from "../../../packages/data/dist/index.js";
import {
  GOLDEN_SCENARIO_V3_01,
  createApprovedRequestSnapshotV3,
} from "../../../packages/contracts/dist/src/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
(database ? test : test.skip)(
  "MB-UX-LIVE-001 L15 failed batch recovery preserves history, lineage and atomic zero-cost publication",
  async () => {
    const databaseName = `matchbase_recovery_${randomUUID().replaceAll("-", "")}`;
    assert.match(databaseName, /^matchbase_recovery_[a-f0-9]{32}$/);
    const admin = createPool({ connectionString: database, max: 1 });
    let pool;
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const isolated = new URL(database);
      isolated.pathname = `/${databaseName}`;
      pool = createPool({ connectionString: isolated.href, max: 5 });
      await migrateUp(pool);
      const identity = {
        account_id: randomUUID(),
        user_profile_id: randomUUID(),
        run_id: randomUUID(),
        execution_id: randomUUID(),
        classification_id: randomUUID(),
      };
      const source = structuredClone(GOLDEN_SCENARIO_V3_01);
      Object.assign(source, {
        research_run_id: identity.run_id,
        execution_id: identity.execution_id,
        user_profile_id: identity.user_profile_id,
        classification_id: identity.classification_id,
        supplier_candidates: [],
        total_candidates_found: 0,
        research_status: "insufficient_evidence",
      });
      source.primary_classification.classification_id =
        identity.classification_id;
      source.approved_request_snapshot = createApprovedRequestSnapshotV3({
        revision_id: randomUUID(),
        approved_translation: "Find poultry suppliers.",
        product_name: "Poultry",
        product_category: "Food",
        approved_at: "2026-09-09T10:00:00Z",
      });
      const sourceRoundId = randomUUID();
      const continuation = { retained_sources: ["Evidence already collected"] };
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'L15 isolated recovery test','active')",
        [identity.account_id],
      );
      await saveConsultantWorkflowSession(pool, {
        ...identity,
        session_id: randomUUID(),
        current_state: "workflow_failed",
        classification: source.primary_classification,
        approved_request_revision: {
          canonical_snapshot: source.approved_request_snapshot,
        },
        original_intake: { product_requirement: "Retained test request" },
        approvals: [{ approved: true }],
        workflow_metadata: {
          classification_id: identity.classification_id,
          mode: "demonstration",
        },
      });
      await saveConsultantOutputV3(pool, {
        account_id: identity.account_id,
        output: source,
      });
      await pool.query(
        `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,output,continuation)
         VALUES($1,$2,$3,$4,$5,1,$6,'failed',$7,$8,$9)`,
        [
          sourceRoundId,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          identity.classification_id,
          JSON.stringify({ round_number: 1, estimated_high_usd: 5 }),
          identity.execution_id,
          null,
          null,
        ],
      );
      const readSource = async () =>
        (
          await pool.query(
            "SELECT * FROM consultant_research_round WHERE round_id=$1",
            [sourceRoundId],
          )
        ).rows[0];
      const beforeSource = await readSource();
      const readSession = async () =>
        (
          await pool.query(
            "SELECT * FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2",
            [identity.account_id, identity.run_id],
          )
        ).rows[0];
      const beforeSession = await readSession();
      let buildCalls = 0;
      function build(saved, executionId) {
        buildCalls++;
        assert.equal(saved.output, null);
        assert.equal(saved.continuation, null);
        const output = structuredClone(source);
        output.execution_id = executionId;
        output.supplier_candidates = structuredClone(
          GOLDEN_SCENARIO_V3_01.supplier_candidates.slice(0, 1),
        );
        output.total_candidates_found = 1;
        output.research_status = "partial";
        Object.assign(output.telemetry, {
          total_cost_usd: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
        });
        return { output, continuation: { ...continuation, recovered: true } };
      }
      const recover = (
        builder = build,
        accountId = identity.account_id,
        executionId = identity.execution_id,
      ) =>
        recoverFailedResearchRound(
          pool,
          accountId,
          identity.run_id,
          executionId,
          builder,
        );
      const ineligible = /not eligible for local evidence recovery/;
      await assert.rejects(recover(build, randomUUID()), ineligible);
      await assert.rejects(
        recover(build, identity.account_id, randomUUID()),
        ineligible,
      );
      assert.equal(
        buildCalls,
        0,
        "ownership and stale checks precede processing",
      );
      const job = await enqueueConsultantWorkflowJob(
        pool,
        identity,
        "research",
        "demonstration",
      );
      await assert.rejects(recover(), ineligible);
      assert.equal(buildCalls, 0, "active jobs prevent recovery");
      await pool.query("DELETE FROM consultant_workflow_job WHERE job_id=$1", [
        job.job_id,
      ]);
      await pool.query(
        "UPDATE consultant_workflow_session SET is_invalidated=true WHERE run_id=$1",
        [identity.run_id],
      );
      await assert.rejects(recover(), ineligible);
      await pool.query(
        "UPDATE consultant_workflow_session SET is_invalidated=false WHERE run_id=$1",
        [identity.run_id],
      );
      for (const mutate of [
        (o) => {
          o.execution_id = randomUUID();
        },
        (o) => {
          o.research_run_id = randomUUID();
        },
        (o) => {
          o.user_profile_id = randomUUID();
        },
        (o) => {
          o.classification_id = randomUUID();
        },
        (o) => {
          o.primary_classification.classification_id = randomUUID();
        },
        (o) => {
          o.telemetry.total_cost_usd = 1;
        },
        (o) => {
          o.supplier_candidates = [];
        },
      ]) {
        await assert.rejects(
          recover((saved, executionId) => {
            const value = build(saved, executionId);
            mutate(value.output);
            return value;
          }),
          ineligible,
        );
      }
      // Fail at the last write, after the replacement document/suppliers were saved.
      await pool.query(`CREATE FUNCTION reject_recovery_event() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'isolated final-write failure'; END $$`);
      await pool.query(`CREATE TRIGGER reject_recovery_event BEFORE INSERT ON consultant_workflow_event
        FOR EACH ROW EXECUTE FUNCTION reject_recovery_event()`);
      await assert.rejects(recover(), /isolated final-write failure/);
      await pool.query(
        "DROP TRIGGER reject_recovery_event ON consultant_workflow_event",
      );
      await pool.query("DROP FUNCTION reject_recovery_event()");
      assert.deepEqual(await readSource(), beforeSource);
      assert.deepEqual(await readSession(), beforeSession);
      assert.deepEqual(
        (
          await pool.query(
            "SELECT document_payload FROM consultant_output_v3 WHERE run_id=$1",
            [identity.run_id],
          )
        ).rows[0].document_payload,
        source,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM consultant_research_round",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM consultant_research_execution",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM consultant_supplier_entity_v3",
          )
        ).rows[0].n,
        0,
      );
      buildCalls = 0;
      const results = await Promise.all([recover(), recover()]);
      assert.equal(buildCalls, 1, "session lock serializes concurrent retries");
      assert.equal(results[0].execution_id, results[1].execution_id);
      assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
      const result = results.find((r) => !r.replayed);
      assert.notEqual(result.execution_id, identity.execution_id);
      assert.deepEqual(
        await readSource(),
        beforeSource,
        "paid round and continuation are immutable",
      );
      const after = await readSession();
      assert.equal(after.execution_id, result.execution_id);
      assert.equal(after.current_state, "progressive_reveal_ready");
      assert.deepEqual(after.original_intake, beforeSession.original_intake);
      assert.deepEqual(after.approvals, beforeSession.approvals);
      const round = (
        await pool.query(
          "SELECT * FROM consultant_research_round WHERE execution_id=$1",
          [result.execution_id],
        )
      ).rows[0];
      assert.equal(
        round.approved_at,
        null,
        "local reprocessing must not invent cost approval",
      );
      assert.equal(
        round.plan.recovery_source_execution_id,
        identity.execution_id,
      );
      assert.equal(round.plan.parent_round_id, sourceRoundId);
      assert.equal(round.plan.max_calls, 0);
      assert.equal(round.plan.estimated_high_usd, 0);
      assert.deepEqual(round.plan.research_models, []);
      const execution = (
        await pool.query(
          "SELECT * FROM consultant_research_execution WHERE execution_id=$1",
          [result.execution_id],
        )
      ).rows[0];
      const document = (
        await pool.query("SELECT * FROM consultant_output_v3 WHERE run_id=$1", [
          identity.run_id,
        ])
      ).rows[0];
      const event = (
        await pool.query(
          "SELECT * FROM consultant_workflow_event WHERE execution_id=$1",
          [result.execution_id],
        )
      ).rows[0];
      for (const record of [round, execution, document, event]) {
        assert.equal(record.account_id, identity.account_id);
        assert.equal(record.user_profile_id, identity.user_profile_id);
        assert.equal(record.run_id, identity.run_id);
        assert.equal(record.classification_id, identity.classification_id);
        assert.equal(record.execution_id, result.execution_id);
      }
      assert.equal(Number(execution.total_cost_usd), 0);
      assert.equal(execution.total_input_tokens, 0);
      assert.equal(execution.total_output_tokens, 0);
      assert.equal(event.detail.live_api_invoked, false);
      assert.deepEqual(document.document_payload, result.output);
      for (const table of [
        "consultant_workflow_job",
        "consultant_provider_call",
      ])
        assert.equal(
          (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]
            .n,
          0,
        );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM consultant_workflow_event",
          )
        ).rows[0].n,
        1,
      );
    } finally {
      try {
        await pool?.end();
        if (created) await dropDrainedRecoveryDatabase(admin, databaseName);
      } finally {
        await admin.end();
      }
    }
  },
);
