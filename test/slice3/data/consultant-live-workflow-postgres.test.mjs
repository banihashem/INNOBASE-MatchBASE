import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createPool,
  migrateUp,
  createConsultantDraftSession,
  saveConsultantDraftSession,
  getConsultantDraftSessionById,
  saveConsultantWorkflowSession,
  getConsultantWorkflowSessionByRunId,
  enqueueConsultantWorkflowJob,
  claimConsultantWorkflowJob,
  failExpiredConsultantWorkflowJobs,
  appendConsultantWorkflowEvent,
  renewConsultantWorkflowJobLease,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

postgresTest(
  "MB-UX-LIVE-001 L01 atomic drafts, durable job leases and four-ID history",
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
    try {
      await migrateUp(pool);
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'MB-UX-LIVE-001 isolated test','active')",
        [accountId],
      );
      const draft = await createConsultantDraftSession(
        pool,
        accountId,
        identity.user_profile_id,
      );
      const write = (text) =>
        saveConsultantDraftSession(
          pool,
          {
            ...draft,
            account_id: accountId,
            user_profile_id: identity.user_profile_id,
            tier: "consultant",
            status: "active",
            draft_data: { productRequirement: text },
          },
          1,
        );
      const writes = await Promise.allSettled([
        write("Buyer A edit"),
        write("Buyer B edit"),
      ]);
      assert.equal(
        writes.filter((x) => x.status === "fulfilled").length,
        1,
        "exactly one concurrent save wins",
      );
      assert.equal(
        writes.find((x) => x.status === "rejected").reason.code,
        "MB-409-DRAFT-CONFLICT",
      );
      const saved = await getConsultantDraftSessionById(
        pool,
        accountId,
        identity.user_profile_id,
        draft.draft_id,
      );
      assert.equal(saved.draft_version, 2);
      assert.ok(
        ["Buyer A edit", "Buyer B edit"].includes(
          saved.draft_data.productRequirement,
        ),
      );
      await assert.rejects(
        saveConsultantDraftSession(
          pool,
          { ...saved, user_profile_id: randomUUID() },
          2,
        ),
        { code: "MB-403-FORBIDDEN" },
      );
      await saveConsultantDraftSession(
        pool,
        { ...saved, status: "submitted" },
        2,
      );
      await assert.rejects(
        saveConsultantDraftSession(pool, { ...saved, status: "active" }, 3),
        { code: "MB-409-DRAFT-CONFLICT" },
      );

      await saveConsultantWorkflowSession(pool, {
        ...identity,
        session_id: randomUUID(),
        current_state: "research_dispatching",
        original_intake: {},
        workflow_metadata: {
          mode: "live",
          revealed_count: 5,
          classification_id: identity.classification_id,
        },
      });
      const queued = await Promise.all([
        enqueueConsultantWorkflowJob(pool, identity, "research", "live"),
        enqueueConsultantWorkflowJob(pool, identity, "research", "live"),
      ]);
      assert.equal(
        queued[0].job_id,
        queued[1].job_id,
        "repeated submissions reuse the job",
      );
      const claimed = await Promise.all([
        claimConsultantWorkflowJob(pool, queued[0].job_id),
        claimConsultantWorkflowJob(pool, queued[0].job_id),
      ]);
      assert.equal(
        claimed.filter(Boolean).length,
        1,
        "only one worker can make provider calls",
      );
      await appendConsultantWorkflowEvent(pool, identity, "verification", {
        loop: 1,
        state: "completed",
        evidence_urls: ["https://example.com/product"],
      });
      const events = await pool.query(
        "SELECT * FROM consultant_workflow_event WHERE execution_id=$1",
        [identity.execution_id],
      );
      for (const key of [
        "user_profile_id",
        "run_id",
        "execution_id",
        "classification_id",
      ])
        assert.equal(events.rows[0][key], identity[key]);
      await pool.query(
        "UPDATE consultant_workflow_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",
        [queued[0].job_id],
      );
      await failExpiredConsultantWorkflowJobs(pool);
      const interrupted = await getConsultantWorkflowSessionByRunId(
        pool,
        accountId,
        identity.run_id,
      );
      assert.equal(interrupted.current_state, "workflow_failed");
      assert.equal(interrupted.workflow_metadata.retry_action, "research");
      assert.equal(interrupted.workflow_metadata.revealed_count, 5);
      assert.equal(
        await claimConsultantWorkflowJob(pool, queued[0].job_id),
        null,
        "interruption never silently repeats paid calls",
      );
      assert.equal(
        await getConsultantWorkflowSessionByRunId(
          pool,
          randomUUID(),
          identity.run_id,
        ),
        null,
      );
      const retry = await enqueueConsultantWorkflowJob(
        pool,
        { ...identity, execution_id: randomUUID() },
        "research",
        "live",
      );
      assert.notEqual(retry.execution_id, identity.execution_id);
      const attempts = await pool.query(
        "SELECT status FROM consultant_workflow_job WHERE account_id=$1 ORDER BY created_at",
        [accountId],
      );
      assert.deepEqual(
        attempts.rows.map((x) => x.status),
        ["failed", "queued"],
      );

      const preparedIdentity = {
        ...identity,
        run_id: randomUUID(),
        execution_id: randomUUID(),
      };
      const preparedRecord = {
        ...preparedIdentity,
        session_id: randomUUID(),
        current_state: "prep_step2_advisory_generating",
        original_intake: {},
      };
      await saveConsultantWorkflowSession(pool, preparedRecord);
      const prepareJob = await enqueueConsultantWorkflowJob(
        pool,
        preparedIdentity,
        "prepare",
        "live",
      );
      await claimConsultantWorkflowJob(pool, prepareJob.job_id);
      await saveConsultantWorkflowSession(pool, {
        ...preparedRecord,
        current_state: "prep_step3_prompt_awaiting_approval",
        deep_prompt_revision: { prompt_text: "Saved final research prompt" },
      });
      await pool.query(
        "UPDATE consultant_workflow_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",
        [prepareJob.job_id],
      );
      await failExpiredConsultantWorkflowJobs(pool);
      assert.equal(
        (
          await getConsultantWorkflowSessionByRunId(
            pool,
            accountId,
            preparedIdentity.run_id,
          )
        ).current_state,
        "prep_step3_prompt_awaiting_approval",
        "a durable completed preparation survives a crash before job acknowledgment",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM consultant_workflow_job WHERE job_id=$1",
            [prepareJob.job_id],
          )
        ).rows[0].status,
        "completed",
      );

      const invalidatedIdentity = {
        ...identity,
        run_id: randomUUID(),
        execution_id: randomUUID(),
      };
      const original = {
        ...invalidatedIdentity,
        session_id: randomUUID(),
        current_state: "research_dispatching",
        original_intake: {},
      };
      await saveConsultantWorkflowSession(pool, original);
      const invalidJob = await enqueueConsultantWorkflowJob(
        pool,
        invalidatedIdentity,
        "research",
        "live",
      );
      const invalidClaim = await claimConsultantWorkflowJob(
        pool,
        invalidJob.job_id,
      );
      await saveConsultantWorkflowSession(pool, {
        ...original,
        current_state: "invalidated",
        is_invalidated: true,
        invalidation_reason: "User invalidated during research",
      });
      await saveConsultantWorkflowSession(pool, {
        ...original,
        current_state: "verification_loop_running",
      });
      const invalidated = await getConsultantWorkflowSessionByRunId(
        pool,
        accountId,
        invalidatedIdentity.run_id,
      );
      assert.equal(invalidated.is_invalidated, true);
      assert.equal(invalidated.current_state, "invalidated");
      assert.equal(
        await renewConsultantWorkflowJobLease(pool, invalidClaim),
        false,
        "invalidation fences subsequent provider checkpoints",
      );

      const app = await import("../../../packages/application/dist/index.js");
      const full = await app.submitConsultantIntake(
        {
          user_profile_id: identity.user_profile_id,
          account_id: accountId,
          product_requirement: "Brazil frozen whole chicken poultry",
          technical_compliance: "Halal certification",
          order_profile: "Delivery to Saudi Arabia",
        },
        pool,
        { mode: "demonstration" },
      );
      await app.approveInterpretationStep(full.run_id, undefined, pool);
      await app.approveDeepPromptStep(full.run_id, undefined, pool);
      const completeJob = await enqueueConsultantWorkflowJob(
        pool,
        full,
        "research",
        "demonstration",
      );
      await claimConsultantWorkflowJob(pool, completeJob.job_id);
      const output = await app.executeConsultantWorkflowResearch(
        pool,
        full.run_id,
      );
      assert.equal(output.supplier_candidates.length, 20);
      const supplierRows = await pool.query(
        "SELECT count(*)::integer AS n FROM consultant_supplier_entity_v3 WHERE account_id=$1 AND run_id=$2",
        [accountId, full.run_id],
      );
      assert.equal(
        supplierRows.rows[0].n,
        20,
        "all dossiers are stored before only five are revealed",
      );
      const restored = await app.getOrRestoreWorkflowSession(
        pool,
        accountId,
        full.run_id,
      );
      assert.equal(restored.revealed_count, 5);
      assert.equal(restored.classification_id, full.classification_id);
      assert.equal(
        restored.approved_request_revision.canonical_snapshot.content_hash,
        full.approved_request_revision.canonical_snapshot.content_hash,
      );
      await app.revealMoreCandidates(full.run_id, 100, pool);
      assert.equal(
        (await app.getOrRestoreWorkflowSession(pool, accountId, full.run_id))
          .revealed_count,
        10,
        "each reveal grants exactly five even with an oversized increment",
      );
      await pool.query(
        "UPDATE consultant_workflow_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",
        [completeJob.job_id],
      );
      await failExpiredConsultantWorkflowJobs(pool);
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM consultant_workflow_job WHERE job_id=$1",
            [completeJob.job_id],
          )
        ).rows[0].status,
        "completed",
      );
      assert.equal(
        (await app.getOrRestoreWorkflowSession(pool, accountId, full.run_id))
          .state,
        "progressive_reveal_ready",
        "a committed result cannot become failed when its worker crashes before acknowledgment",
      );
    } finally {
      for (const table of [
        "consultant_workflow_event",
        "consultant_workflow_job",
        "consultant_workflow_session",
        "consultant_draft_session",
        "consultant_intake_snapshot",
        "consultant_supplier_entity_v3",
        "consultant_output_v3",
        "consultant_research_execution",
        "product_classification",
      ]) {
        await pool.query(`DELETE FROM ${table} WHERE account_id=$1`, [
          accountId,
        ]);
      }
      await pool.query("DELETE FROM account WHERE account_id=$1", [accountId]);
      await pool.end();
    }
  },
);
