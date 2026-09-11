import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  approveResearchQuote,
  claimConsultantWorkflowJob,
  completeResearchRound,
  createPool,
  finishConsultantWorkflowJob,
  getConsultantWorkflowSessionByRunId,
  getResearchRoundForExecution,
  inTransaction,
  listResearchRounds,
  migrateUp,
  saveConsultantWorkflowSession,
  saveResearchQuote,
  stopConsultantResearch,
} from "../../../packages/data/dist/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;

async function fixture(t) {
  const state = {
    pool: createPool({ connectionString: database, max: 6 }),
    identity: {
      account_id: randomUUID(),
      user_profile_id: randomUUID(),
      run_id: randomUUID(),
      execution_id: randomUUID(),
      classification_id: randomUUID(),
    },
  };
  t.after(async () => {
    try {
      for (const table of [
        "consultant_workflow_event",
        "consultant_workflow_job",
        "consultant_workflow_session",
      ])
        await state.pool.query(`DELETE FROM ${table} WHERE account_id=$1`, [
          state.identity.account_id,
        ]);
      await state.pool.query("DELETE FROM account WHERE account_id=$1", [
        state.identity.account_id,
      ]);
    } finally {
      await state.pool.end();
    }
  });
  await migrateUp(state.pool);
  await state.pool.query(
    "INSERT INTO account(account_id,display_name,status) VALUES($1,'QUALITY001 isolated round checkpoint','active')",
    [state.identity.account_id],
  );
  await saveConsultantWorkflowSession(state.pool, {
    ...state.identity,
    session_id: randomUUID(),
    current_state: "prep_step3_prompt_approved",
    original_intake: { product_requirement: "Isolated industrial pumps" },
    approved_request_revision: {
      revision_id: randomUUID(),
      english_translation: "Isolated industrial pumps",
    },
    deep_prompt_revision: {
      is_approved: true,
      prompt_text: "Research isolated industrial pumps",
    },
    workflow_metadata: {
      mode: "demonstration",
      classification_id: state.identity.classification_id,
    },
  });
  const session = await getConsultantWorkflowSessionByRunId(
    state.pool,
    state.identity.account_id,
    state.identity.run_id,
  );
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify([
        session.approved_request_revision,
        session.deep_prompt_revision,
      ]),
    )
    .digest("hex");
  state.plan = (round, parent = null) => ({
    version: "research-round.v1",
    round_number: round,
    parent_round_id: parent,
    depth: "simple",
    title: "Isolated checkpoint",
    purpose: "No provider access",
    focus_requirements: [],
    research_models: [],
    extraction_model: "fixture",
    synthesis_model: "fixture",
    search_engine: "native",
    candidate_limit_per_search: 1,
    max_calls: 0,
    max_input_tokens_per_call: 0,
    max_output_tokens_per_call: 0,
    estimated_low_usd: 0,
    estimated_high_usd: 0,
    rates: [],
    assumptions: [],
    pricing_checked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    request_hash: requestHash,
    mode: "demonstration",
  });
  state.quote = (plan) => saveResearchQuote(state.pool, state.identity, plan);
  state.approve = (quote) =>
    approveResearchQuote(
      state.pool,
      state.identity.account_id,
      state.identity.user_profile_id,
      state.identity.run_id,
      quote,
      requestHash,
    );
  state.snapshot = (executionId, round) => ({
    output: {
      user_profile_id: state.identity.user_profile_id,
      research_run_id: state.identity.run_id,
      execution_id: executionId,
      classification_id: state.identity.classification_id,
      supplier_candidates: [
        {
          supplier_entity_id: `documented-${round}`,
          name: "Documented fixture",
        },
      ],
      research_review: {
        incomplete_leads: [
          { lead_id: `lead-${round}`, missing_fields: ["website"] },
        ],
        research_notes: [{ text: `Round ${round} note` }],
      },
    },
    continuation: {
      collected_responses: [
        JSON.stringify({
          model: "fixture",
          text: "Raw response with NUL \0 and unpaired surrogate \ud800",
        }),
      ],
      roster: Array.from({ length: round }, (_, index) => [
        `entity-${index}`,
        {
          legal_name: `Preserved ${index}`,
          extra_source_fields: { original: true },
        },
      ]),
      evidence: [
        [
          "e1",
          {
            url: "https://example.invalid/source",
            assertions: ["unqualified claim retained"],
          },
        ],
      ],
      retrieved: [
        [
          "https://example.invalid/source",
          { text: "Full retained source contents", http_status: 200 },
        ],
        ["https://example.invalid/unavailable", null],
      ],
      indexed_leads: [
        {
          lead_id: `lead-${round}`,
          candidate: { name: "Incomplete source lead" },
          disposition: "incomplete",
        },
      ],
      native_citations: [
        { url: "https://example.invalid/source", content: "Citation content" },
      ],
      research_notes: [
        { title: "Unresolved", text: "Do not discard incomplete evidence" },
      ],
      focus_analysis: { question: "Verify capacity", source_round: round - 1 },
      remaining_gaps: ["Capacity", "Price"],
      future_extension: { nested: [1, null, false, "preserve"] },
    },
  });
  state.publish = async (approval, snapshot) => {
    const job = await claimConsultantWorkflowJob(
      state.pool,
      approval.job.job_id,
    );
    await inTransaction(state.pool, async (client) => {
      await completeResearchRound(
        client,
        state.identity.account_id,
        approval.execution_id,
        snapshot.output,
        snapshot.continuation,
      );
      const current = await getConsultantWorkflowSessionByRunId(
        client,
        state.identity.account_id,
        state.identity.run_id,
      );
      await saveConsultantWorkflowSession(client, {
        ...current,
        current_state: "progressive_reveal_ready",
        last_checkpoint: "progressive_reveal_ready",
      });
    });
    await finishConsultantWorkflowJob(state.pool, job);
  };
  return state;
}

dbTest(
  "MB-UX-QUALITY-001 L01 reopens complete immutable checkpoints with all identities through round five",
  async (t) => {
    const state = await fixture(t);
    const staleFirstQuote = await state.quote(state.plan(1));
    const saved = [];
    let parent = null;
    for (let round = 1; round <= 5; round++) {
      const quote = await state.quote(state.plan(round, parent));
      const approval = await state.approve(quote);
      const snapshot = state.snapshot(approval.execution_id, round);
      await state.publish(approval, snapshot);
      saved.push({ quote, approval, snapshot });
      await state.pool.end();
      state.pool = createPool({ connectionString: database, max: 6 });
      for (const previous of saved) {
        const record = await getResearchRoundForExecution(
          state.pool,
          state.identity.account_id,
          previous.approval.execution_id,
        );
        assert.equal(record.status, "completed");
        assert.equal(record.account_id, state.identity.account_id);
        assert.equal(record.user_profile_id, state.identity.user_profile_id);
        assert.equal(record.run_id, state.identity.run_id);
        assert.equal(
          record.classification_id,
          state.identity.classification_id,
        );
        assert.deepEqual(record.output, previous.snapshot.output);
        assert.deepEqual(record.continuation, previous.snapshot.continuation);
      }
      const record = await getResearchRoundForExecution(
        state.pool,
        state.identity.account_id,
        approval.execution_id,
      );
      assert.equal(record.plan.parent_round_id, parent);
      await assert.rejects(
        completeResearchRound(
          state.pool,
          state.identity.account_id,
          approval.execution_id,
          { ...snapshot.output, replaced: true },
          {},
        ),
        { code: "MB-409-ROUND-APPROVAL" },
      );
      parent = quote;
    }
    assert.equal(
      (await state.approve(parent)).replayed,
      true,
      "completed approval remains idempotent",
    );
    await assert.rejects(state.quote(state.plan(6, parent)), {
      code: "MB-409-ROUND-LIMIT",
    });
    await assert.rejects(state.approve(staleFirstQuote), {
      code: "MB-409-ROUND-LIMIT",
    });
    assert.equal(
      (
        await state.pool.query(
          "SELECT count(*)::int AS count FROM consultant_workflow_job WHERE account_id=$1 AND status IN ('queued','running')",
          [state.identity.account_id],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await listResearchRounds(
          state.pool,
          randomUUID(),
          state.identity.run_id,
        )
      ).length,
      0,
    );
  },
);

dbTest(
  "MB-UX-QUALITY-001 L01 rejects forged quote/output lineage and invalid round numbers before publication",
  async (t) => {
    const state = await fixture(t);
    for (const field of [
      "account_id",
      "user_profile_id",
      "run_id",
      "classification_id",
    ])
      await assert.rejects(
        saveResearchQuote(
          state.pool,
          { ...state.identity, [field]: randomUUID() },
          state.plan(1),
        ),
        { code: "MB-404-ROUND" },
      );
    for (const number of [0, 6, 1.5, NaN])
      await assert.rejects(state.quote(state.plan(number)), {
        code: "MB-409-ROUND-LIMIT",
      });
    const forged = await state.quote(state.plan(1));
    await state.pool.query(
      "UPDATE consultant_research_round SET user_profile_id=$2 WHERE round_id=$1",
      [forged, randomUUID()],
    );
    await assert.rejects(state.approve(forged), { code: "MB-404-ROUND" });
    const invalidPlan = await state.quote(state.plan(1));
    await state.pool.query(
      "UPDATE consultant_research_round SET plan=jsonb_set(plan,'{round_number}','6') WHERE round_id=$1",
      [invalidPlan],
    );
    await assert.rejects(state.approve(invalidPlan), {
      code: "MB-409-ROUND-LIMIT",
    });
    const quote = await state.quote(state.plan(1));
    const approval = await state.approve(quote);
    const snapshot = state.snapshot(approval.execution_id, 1);
    for (const field of [
      "account_id",
      "user_profile_id",
      "research_run_id",
      "execution_id",
      "classification_id",
    ])
      await assert.rejects(
        completeResearchRound(
          state.pool,
          state.identity.account_id,
          approval.execution_id,
          { ...snapshot.output, [field]: randomUUID() },
          snapshot.continuation,
        ),
        { code: "MB-409-ROUND-APPROVAL" },
      );
    await assert.rejects(
      completeResearchRound(
        state.pool,
        state.identity.account_id,
        approval.execution_id,
        snapshot.output,
        [],
      ),
      { code: "MB-409-ROUND-APPROVAL" },
    );
    assert.equal(
      (
        await getResearchRoundForExecution(
          state.pool,
          state.identity.account_id,
          approval.execution_id,
        )
      ).output,
      null,
    );
    await state.publish(approval, snapshot);
  },
);

dbTest(
  "MB-UX-QUALITY-001 L01 rolls back the whole round checkpoint and fences cancellation",
  async (t) => {
    const state = await fixture(t);
    const approval = await state.approve(await state.quote(state.plan(1)));
    const snapshot = state.snapshot(approval.execution_id, 1);
    await assert.rejects(
      inTransaction(state.pool, async (client) => {
        await completeResearchRound(
          client,
          state.identity.account_id,
          approval.execution_id,
          snapshot.output,
          snapshot.continuation,
        );
        await client.query("SELECT 1 / 0");
      }),
      { code: "22012" },
    );
    let record = await getResearchRoundForExecution(
      state.pool,
      state.identity.account_id,
      approval.execution_id,
    );
    assert.equal(record.status, "approved");
    assert.equal(record.output, null);
    assert.equal(record.continuation, null);
    assert.equal(
      await stopConsultantResearch(
        state.pool,
        state.identity.account_id,
        state.identity.run_id,
        approval.execution_id,
      ),
      "stopped",
    );
    await assert.rejects(
      completeResearchRound(
        state.pool,
        state.identity.account_id,
        approval.execution_id,
        snapshot.output,
        snapshot.continuation,
      ),
      { code: "execution-lease-lost" },
    );
    record = (
      await listResearchRounds(
        state.pool,
        state.identity.account_id,
        state.identity.run_id,
      )
    ).find((row) => row.execution_id === approval.execution_id);
    assert.equal(record.status, "cancelled");
    assert.equal(record.output, null);
  },
);

dbTest(
  "MB-UX-QUALITY-001 L01 serializes competing approvals, stale parents and publication versus stop",
  async (t) => {
    const state = await fixture(t);
    const first = await state.quote(state.plan(1));
    const replay = await Promise.all([
      state.approve(first),
      state.approve(first),
    ]);
    assert.equal(replay[0].execution_id, replay[1].execution_id);
    assert.notEqual(replay[0].replayed, replay[1].replayed);
    await state.publish(replay[0], state.snapshot(replay[0].execution_id, 1));
    const quotes = await Promise.all([
      state.quote(state.plan(2, first)),
      state.quote(state.plan(2, first)),
    ]);
    const results = await Promise.allSettled(quotes.map(state.approve));
    assert.equal(
      results.filter((item) => item.status === "fulfilled").length,
      1,
    );
    const winner = results.find((item) => item.status === "fulfilled").value;
    const loser = quotes.find((quote) => quote !== winner.round_id);
    const snapshot = state.snapshot(winner.execution_id, 2);
    const job = await claimConsultantWorkflowJob(state.pool, winner.job.job_id);
    let stopping;
    await inTransaction(state.pool, async (client) => {
      await completeResearchRound(
        client,
        state.identity.account_id,
        winner.execution_id,
        snapshot.output,
        snapshot.continuation,
      );
      stopping = stopConsultantResearch(
        state.pool,
        state.identity.account_id,
        state.identity.run_id,
        winner.execution_id,
      );
      const current = await getConsultantWorkflowSessionByRunId(
        client,
        state.identity.account_id,
        state.identity.run_id,
      );
      await saveConsultantWorkflowSession(client, {
        ...current,
        current_state: "progressive_reveal_ready",
        last_checkpoint: "progressive_reveal_ready",
      });
    });
    assert.equal(await stopping, "not_running");
    await finishConsultantWorkflowJob(state.pool, job);
    await assert.rejects(state.approve(loser), {
      code: "MB-409-ROUND-APPROVAL",
    });
    assert.deepEqual(
      (
        await getResearchRoundForExecution(
          state.pool,
          state.identity.account_id,
          winner.execution_id,
        )
      ).continuation,
      snapshot.continuation,
    );
  },
);
