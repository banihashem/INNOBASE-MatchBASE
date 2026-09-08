import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  saveResearchQuote,
  approveResearchQuote,
  createPool,
  saveConsultantWorkflowSession,
  getConsultantWorkflowSessionByRunId,
  enqueueConsultantWorkflowJob,
  claimConsultantWorkflowJob,
  renewConsultantWorkflowJobLease,
  stopConsultantResearch,
  lockActiveConsultantExecution,
  appendConsultantWorkflowEvent,
  inTransaction,
} from "../../../packages/data/dist/index.js";
import {
  getOrRestoreWorkflowSession,
  queueConsultantWorkflowStep,
} from "../../../packages/application/dist/consultant-v3-service.js";

const databaseUrl = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
(databaseUrl ? test : test.skip)(
  "MB-UX-LIVE-001 L09 real cancellation, ownership, retention and publication fencing",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 5 });
    const accountId = randomUUID();
    const identity = {
      account_id: accountId,
      user_profile_id: randomUUID(),
      run_id: randomUUID(),
      execution_id: randomUUID(),
      classification_id: randomUUID(),
    };
    const original = {
      ...identity,
      session_id: randomUUID(),
      current_state: "research_dispatching",
      original_intake: { product_requirement: "Test pumps" },
      approvals: [{ approved: true }],
      approved_request_revision: {
        revision_id: randomUUID(),
        english_translation: "Test pumps",
      },
      deep_prompt_revision: {
        is_approved: true,
        prompt_text: "Test pump research",
      },
      workflow_metadata: {
        mode: "demonstration",
        classification_id: identity.classification_id,
        progress: { loop: 4 },
      },
    };
    const read = () =>
      getConsultantWorkflowSessionByRunId(pool, accountId, identity.run_id);
    const stop = (executionId = identity.execution_id) =>
      stopConsultantResearch(pool, accountId, identity.run_id, executionId);
    try {
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'L09 isolated cancellation regression','active')",
        [accountId],
      );
      await saveConsultantWorkflowSession(pool, original);
      await appendConsultantWorkflowEvent(pool, identity, "verification", {
        loop: 4,
        findings: ["Saved observation"],
      });
      const queued = await enqueueConsultantWorkflowJob(
        pool,
        identity,
        "research",
        "demonstration",
      );
      assert.equal(
        await stopConsultantResearch(
          pool,
          randomUUID(),
          identity.run_id,
          identity.execution_id,
        ),
        "not_found",
      );
      assert.equal(await stop(randomUUID()), "stale");
      const outcomes = await Promise.all([stop(), stop()]);
      assert.deepEqual(outcomes.sort(), ["already_stopped", "stopped"]);
      assert.equal(await claimConsultantWorkflowJob(pool, queued.job_id), null);
      const stopped = await read();
      assert.equal(stopped.last_checkpoint, "user_cancelled");
      assert.deepEqual(stopped.approvals, original.approvals);
      assert.deepEqual(stopped.original_intake, original.original_intake);
      assert.equal(stopped.workflow_metadata.progress.loop, 4);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM consultant_workflow_event WHERE account_id=$1",
            [accountId],
          )
        ).rows[0].n,
        2,
      );
      await saveConsultantWorkflowSession(pool, {
        ...original,
        last_checkpoint: "late_checkpoint",
      });
      assert.equal((await read()).last_checkpoint, "user_cancelled");
      await assert.rejects(
        inTransaction(pool, (client) =>
          lockActiveConsultantExecution(
            client,
            accountId,
            identity.run_id,
            identity.execution_id,
          ),
        ),
        { code: "execution-lease-lost" },
      );

      const prepared = await getOrRestoreWorkflowSession(
        pool,
        accountId,
        identity.run_id,
      );
      await assert.rejects(
        queueConsultantWorkflowStep(pool, identity.run_id, "research", true),
        { code: "MB-409-ROUND-APPROVAL" },
      );
      const app = await import("../../../packages/application/dist/index.js");
      const { plan } = await app.buildResearchRoundPlan({
        round_number: 1,
        depth: "simple",
        parent_round_id: null,
        request_hash: app.researchRequestHash(prepared),
        focus_requirements: [],
        mode: "demonstration",
      });
      const quoteId = await saveResearchQuote(pool, prepared, plan);
      const { job: retry } = await approveResearchQuote(
        pool,
        accountId,
        identity.user_profile_id,
        identity.run_id,
        quoteId,
        plan.request_hash,
      );
      const next = await read();
      assert.notEqual(next.execution_id, identity.execution_id);
      assert.equal(
        next.last_checkpoint,
        "queued",
        "explicit restart clears the cancellation checkpoint",
      );
      await inTransaction(pool, (client) =>
        lockActiveConsultantExecution(
          client,
          accountId,
          identity.run_id,
          next.execution_id,
        ),
      );
      const running = await claimConsultantWorkflowJob(pool, retry.job_id);
      assert.ok(await renewConsultantWorkflowJobLease(pool, running));
      assert.equal(await stop(), "stale", "an old tab cannot cancel the retry");
      await saveConsultantWorkflowSession(pool, original);
      assert.equal(
        (await read()).execution_id,
        next.execution_id,
        "late cancelled writes cannot restore an old execution",
      );
      assert.equal(await stop(next.execution_id), "stopped");
      assert.equal(await renewConsultantWorkflowJobLease(pool, running), false);

      // Publication wins the session lock: cancellation must preserve the ready result.
      const final = {
        ...original,
        execution_id: randomUUID(),
        last_checkpoint: "synthesis",
      };
      await saveConsultantWorkflowSession(pool, final);
      await enqueueConsultantWorkflowJob(
        pool,
        final,
        "research",
        "demonstration",
      );
      const publisher = await pool.connect();
      let cancellation;
      try {
        await publisher.query("BEGIN");
        await lockActiveConsultantExecution(
          publisher,
          accountId,
          identity.run_id,
          final.execution_id,
        );
        cancellation = stop(final.execution_id);
        await saveConsultantWorkflowSession(publisher, {
          ...final,
          current_state: "progressive_reveal_ready",
          last_checkpoint: "progressive_reveal_ready",
        });
        await publisher.query("COMMIT");
      } finally {
        await publisher.query("ROLLBACK");
        publisher.release();
      }
      assert.equal(await cancellation, "not_running");
      assert.equal((await read()).current_state, "progressive_reveal_ready");
      await pool.query(
        "UPDATE consultant_workflow_job SET status='completed' WHERE account_id=$1",
        [accountId],
      );
      const preparing = {
        ...original,
        execution_id: randomUUID(),
        current_state: "prep_step2_advisory_generating",
      };
      await saveConsultantWorkflowSession(pool, preparing);
      await enqueueConsultantWorkflowJob(
        pool,
        preparing,
        "prepare",
        "demonstration",
      );
      assert.equal(
        await stop(preparing.execution_id),
        "not_running",
        "Section 3 stop cannot cancel preparation",
      );
    } finally {
      for (const table of [
        "consultant_workflow_event",
        "consultant_workflow_job",
        "consultant_workflow_session",
      ])
        await pool.query(`DELETE FROM ${table} WHERE account_id=$1`, [
          accountId,
        ]);
      await pool.query("DELETE FROM account WHERE account_id=$1", [accountId]);
      await pool.end();
    }
  },
);
