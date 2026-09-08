import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createPool,
  migrateUp,
  saveConsultantWorkflowSession,
  saveResearchQuote,
  approveResearchQuote,
  listResearchRounds,
  completeResearchRound,
  recordConsultantProviderCall,
  readConsultantCostEvents,
  stopConsultantResearch,
} from "../../../packages/data/dist/index.js";
import {
  buildResearchRoundPlan,
  researchRequestHash,
  getOrRestoreWorkflowSession,
  summarizeResearchCosts,
} from "../../../packages/application/dist/index.js";
const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
(database ? test : test.skip)(
  "MB-UX-COST-001 atomic consent, immutable rounds, stale quotes and late usage",
  async () => {
    const pool = createPool({ connectionString: database, max: 6 });
    const identity = {
      account_id: randomUUID(),
      user_profile_id: randomUUID(),
      run_id: randomUUID(),
      execution_id: randomUUID(),
      classification_id: randomUUID(),
    };
    try {
      await migrateUp(pool);
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Isolated progressive-round regression','active')",
        [identity.account_id],
      );
      await saveConsultantWorkflowSession(pool, {
        ...identity,
        session_id: randomUUID(),
        current_state: "prep_step3_prompt_approved",
        original_intake: { product_requirement: "Pumps" },
        approved_request_revision: {
          revision_id: randomUUID(),
          english_translation: "Pumps",
        },
        deep_prompt_revision: { is_approved: true, prompt_text: "Find pumps" },
        workflow_metadata: {
          mode: "demonstration",
          classification_id: identity.classification_id,
        },
      });
      const session = await getOrRestoreWorkflowSession(
        pool,
        identity.account_id,
        identity.run_id,
      );
      const hash = researchRequestHash(session);
      const { plan } = await buildResearchRoundPlan({
        round_number: 1,
        depth: "simple",
        parent_round_id: null,
        request_hash: hash,
        focus_requirements: [],
        mode: "demonstration",
      });
      const stale = await saveResearchQuote(pool, identity, {
        ...plan,
        expires_at: "2000-01-01T00:00:00Z",
      });
      await assert.rejects(
        approveResearchQuote(
          pool,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          stale,
          hash,
        ),
        { code: "MB-409-ROUND-APPROVAL" },
      );
      const quote = await saveResearchQuote(pool, identity, plan);
      await assert.rejects(
        approveResearchQuote(
          pool,
          identity.account_id,
          randomUUID(),
          identity.run_id,
          quote,
          hash,
        ),
        { status: 404 },
      );
      await assert.rejects(
        approveResearchQuote(
          pool,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          quote,
          "changed",
        ),
        { code: "MB-409-ROUND-APPROVAL" },
      );
      const approve = (id) =>
        approveResearchQuote(
          pool,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          id,
          hash,
        );
      const [a, b] = await Promise.all([approve(quote), approve(quote)]);
      assert.equal(a.execution_id, b.execution_id);
      assert.equal(a.job.job_id, b.job.job_id);
      assert.ok(a.replayed !== b.replayed);
      const output = { supplier_candidates: [], marker: "immutable round one" };
      await completeResearchRound(
        pool,
        identity.account_id,
        a.execution_id,
        output,
        { remaining_gaps: ["Supplier price"] },
      );
      await pool.query(
        "UPDATE consultant_workflow_job SET status='completed',completed_at=clock_timestamp() WHERE job_id=$1",
        [a.job.job_id],
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM consultant_workflow_job WHERE account_id=$1 AND status IN ('queued','running')",
            [identity.account_id],
          )
        ).rows[0].n,
        0,
        "completion must not enqueue round two",
      );
      const { plan: next } = await buildResearchRoundPlan({
        round_number: 2,
        depth: "deep",
        parent_round_id: quote,
        request_hash: hash,
        focus_requirements: ["Supplier price"],
        mode: "demonstration",
      });
      const [q2, q3] = await Promise.all([
        saveResearchQuote(pool, identity, next),
        saveResearchQuote(pool, identity, next),
      ]);
      const attempts = await Promise.allSettled([approve(q2), approve(q3)]);
      assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
      const running = attempts.find((x) => x.status === "fulfilled").value;
      assert.equal(
        await stopConsultantResearch(
          pool,
          identity.account_id,
          identity.run_id,
          running.execution_id,
        ),
        "stopped",
      );
      const roundViews = await listResearchRounds(
        pool,
        identity.account_id,
        identity.run_id,
      );
      assert.deepEqual(
        roundViews.find((r) => r.round_id === quote).output,
        output,
      );
      assert.equal(
        roundViews.find((r) => r.execution_id === running.execution_id).status,
        "cancelled",
      );
      const late = {
        request_id: randomUUID(),
        model: "fixture",
        phase: "verification",
        state: "completed",
        provider_generation_id: "isolated-generation",
        is_byok: true,
        cost_reported: true,
        cost_usd: 0,
        upstream_inference_cost: 0.42,
      };
      await recordConsultantProviderCall(
        pool,
        { ...identity, execution_id: running.execution_id },
        late,
      );
      await recordConsultantProviderCall(
        pool,
        { ...identity, execution_id: running.execution_id },
        {
          ...late,
          state: "started",
          cost_usd: 0,
          upstream_inference_cost: null,
        },
      );
      const costs = summarizeResearchCosts(
        await readConsultantCostEvents(
          pool,
          identity.account_id,
          identity.run_id,
        ),
      );
      assert.equal(costs.recorded_total_usd, 0.42);
      assert.equal(costs.calls, 1);
    } finally {
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
      await pool.end();
    }
  },
);
