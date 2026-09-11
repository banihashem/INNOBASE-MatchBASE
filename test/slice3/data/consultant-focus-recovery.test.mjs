import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendConsultantWorkflowEvent,
  createPool,
  enqueueConsultantWorkflowJob,
  migrateUp,
  recordConsultantProviderCall,
  recoverApprovedFocusStage,
  saveConsultantWorkflowSession,
  summarizeResearchExecutionAllowance,
} from "../../../packages/data/dist/index.js";
import { parseFocusRecoveryArguments } from "../../../scripts/recover-consultant-focus-stage.mjs";

const event = (request_id, detail = {}, phase = "research_focus_analysis") => ({
  phase,
  detail: { request_id, model: "openai/test-model", ...detail },
});
test("L05 execution allowance counts unique dispatches including interrupted and unknown accounting", () => {
  const counts = summarizeResearchExecutionAllowance([
    event("a", { state: "started", dispatched: true }),
    event("a", { state: "failed", dispatched: true }),
    event("b", { state: "started", dispatched: true }),
    event("c", { state: "failed" }),
    event("d", { state: "failed", dispatched: false }),
    event(
      "e",
      { dispatched: false, provider_generation_id: "retained-generation" },
      "synthesis",
    ),
    event("http", { model: "http-primary-source", dispatched: true }),
  ]);
  assert.equal(counts.consumed_provider_calls, 4);
  assert.equal(counts.consumed_focus_attempts, 3);
  assert.deepEqual(counts.consumed_request_ids, ["a", "b", "c", "e"]);
  assert.throws(
    () =>
      summarizeResearchExecutionAllowance([
        event("a"),
        event("a", {}, "synthesis"),
      ]),
    { code: "MB-409-ROUND-ALLOWANCE" },
  );
});

test("L05 operator CLI defaults to dry-run and requires an explicit reviewed snapshot to execute", () => {
  const args = [
    "account-id",
    "user-profile-id",
    "run-id",
    "execution-id",
    "classification-id",
    "round-id",
  ].flatMap((key) => [`--${key}`, randomUUID()]);
  assert.equal(parseFocusRecoveryArguments(args).options.execute, false);
  assert.throws(
    () => parseFocusRecoveryArguments([...args, "--execute"]),
    /Usage/,
  );
  assert.throws(
    () => parseFocusRecoveryArguments([...args, "--snapshot-hash", "wrong"]),
    /Usage/,
  );
  assert.throws(
    () => parseFocusRecoveryArguments([...args, "--execute", "--execute"]),
    /Usage/,
  );
  assert.throws(
    () => parseFocusRecoveryArguments([...args, "--allow-over-budget"]),
    /Usage/,
  );
  assert.equal(
    parseFocusRecoveryArguments([
      ...args,
      "--execute",
      "--snapshot-hash",
      "a".repeat(64),
    ]).options.execute,
    true,
  );
});

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;
async function fixture(t) {
  const db = createPool({ connectionString: database, max: 5 });
  const identity = Object.fromEntries(
    [
      "account_id",
      "user_profile_id",
      "run_id",
      "execution_id",
      "classification_id",
      "round_id",
    ].map((key) => [key, randomUUID()]),
  );
  t.after(async () => {
    try {
      await db.query(
        "DELETE FROM consultant_workflow_event WHERE account_id=$1",
        [identity.account_id],
      );
      await db.query(
        "DELETE FROM consultant_workflow_job WHERE account_id=$1",
        [identity.account_id],
      );
      await db.query(
        "DELETE FROM consultant_workflow_session WHERE account_id=$1",
        [identity.account_id],
      );
      await db.query("DELETE FROM account WHERE account_id=$1", [
        identity.account_id,
      ]);
    } finally {
      await db.end();
    }
  });
  await migrateUp(db);
  await db.query(
    "INSERT INTO account(account_id,display_name,status) VALUES($1,'Isolated focus recovery regression','active')",
    [identity.account_id],
  );
  await saveConsultantWorkflowSession(db, {
    ...identity,
    session_id: randomUUID(),
    current_state: "workflow_failed",
    original_intake: { product_requirement: "Industrial pumps" },
    approved_request_revision: {
      revision_id: randomUUID(),
      english_translation: "Industrial pumps",
    },
    deep_prompt_revision: {
      is_approved: true,
      prompt_text: "Find industrial pumps",
    },
    approvals: [
      { step: "step1", approved_revision_id: randomUUID() },
      { step: "step3", approved_revision_id: randomUUID() },
    ],
    last_checkpoint: "workflow_failed",
    workflow_metadata: {
      mode: "live",
      classification_id: identity.classification_id,
      error: "Saved output limit",
      retry_action: "research",
    },
  });
  const session = (
    await db.query(
      "SELECT * FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2",
      [identity.account_id, identity.run_id],
    )
  ).rows[0];
  const sourceHash = createHash("sha256")
    .update(
      JSON.stringify([
        session.approved_request_revision,
        session.deep_prompt_revision,
      ]),
    )
    .digest("hex");
  const parentId = randomUUID();
  const plan = {
    version: "research-round.v1",
    round_number: 2,
    depth: "deep",
    mode: "live",
    focus_analysis_required: true,
    research_models: ["openai/test-model"],
    extraction_model: "openai/test-model",
    synthesis_model: "openai/test-model",
    automatic_recovery_attempts: 3,
    max_calls: 24,
    max_output_tokens_per_call: 20000,
    request_hash: sourceHash,
    parent_round_id: parentId,
    rates: [
      { model: "openai/test-model", provider: "openai", billing_mode: "byok" },
    ],
  };
  await db.query(
    `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,approved_at,completed_at,output,continuation)
    VALUES($1,$2,$3,$4,$5,1,$6,'completed',$7,clock_timestamp(),clock_timestamp(),$8,$9)`,
    [
      parentId,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.classification_id,
      JSON.stringify({ ...plan, round_number: 1, parent_round_id: null }),
      randomUUID(),
      JSON.stringify({ supplier_candidates: [{ name: "Saved supplier" }] }),
      JSON.stringify({
        indexed_leads: [],
        roster: [],
        evidence: [],
        retrieved: [],
      }),
    ],
  );
  await db.query(
    `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,approved_at,completed_at)
    VALUES($1,$2,$3,$4,$5,2,$6,'failed',$7,clock_timestamp(),clock_timestamp())`,
    [
      identity.round_id,
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
  const fail = async () => {
    await db.query(
      "UPDATE consultant_workflow_job SET status='failed',error_code='workflow-execution-failed',completed_at=clock_timestamp() WHERE job_id=$1",
      [job.job_id],
    );
    await db.query(
      "UPDATE consultant_workflow_session SET current_state='workflow_failed',last_checkpoint='workflow_failed' WHERE account_id=$1",
      [identity.account_id],
    );
    await db.query(
      "UPDATE consultant_research_round SET status='failed',completed_at=clock_timestamp() WHERE round_id=$1",
      [identity.round_id],
    );
    const call = {
      request_id: randomUUID(),
      phase: "research_focus_analysis",
      model: "openai/test-model",
      state: "failed",
      dispatched: true,
      output_tokens: 5000,
      error: "MB-422-LIVE-OUTPUT-LIMIT",
    };
    await recordConsultantProviderCall(db, identity, call);
    await appendConsultantWorkflowEvent(db, identity, call.phase, call);
    await appendConsultantWorkflowEvent(db, identity, "failed", {
      stage: "research",
      code: "MB-422-LIVE-OUTPUT-LIMIT",
    });
  };
  await fail();
  const snapshot = async () => {
    const records = {};
    for (const table of [
      "consultant_workflow_session",
      "consultant_research_round",
      "consultant_workflow_job",
      "consultant_workflow_event",
      "consultant_provider_call",
    ])
      records[table] = (
        await db.query(
          `SELECT row_to_json(t) AS record FROM ${table} t WHERE account_id=$1 ORDER BY row_to_json(t)::text`,
          [identity.account_id],
        )
      ).rows;
    return records;
  };
  return { db, identity, parentId, job, fail, snapshot };
}

dbTest(
  "L05 reviewed focus recovery requeues exactly one same-execution job and preserves approval, source and old failure",
  async (t) => {
    const f = await fixture(t);
    const before = await f.snapshot();
    const review = await recoverApprovedFocusStage(f.db, f.identity);
    assert.equal(review.executed, false);
    assert.equal(review.remaining_provider_calls, 23);
    assert.equal(review.remaining_focus_attempts, 2);
    assert.deepEqual(
      await f.snapshot(),
      before,
      "dry-run performs no mutation",
    );
    const raced = await Promise.allSettled(
      [1, 2].map(() =>
        recoverApprovedFocusStage(f.db, f.identity, {
          execute: true,
          expected_snapshot_hash: review.snapshot_hash,
        }),
      ),
    );
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(raced.filter((r) => r.status === "rejected").length, 1);
    const after = await f.snapshot();
    const session = after.consultant_workflow_session[0].record;
    const original = before.consultant_workflow_session[0].record;
    for (const field of [
      "original_intake",
      "approved_request_revision",
      "deep_prompt_revision",
      "approvals",
      "execution_id",
      "classification",
    ])
      assert.deepEqual(session[field], original[field]);
    const round = after.consultant_research_round
      .map((r) => r.record)
      .find((r) => r.round_id === f.identity.round_id);
    const oldRound = before.consultant_research_round
      .map((r) => r.record)
      .find((r) => r.round_id === f.identity.round_id);
    assert.equal(round.status, "approved");
    for (const field of ["plan", "approved_at", "execution_id"])
      assert.deepEqual(round[field], oldRound[field]);
    const parent = (rows) =>
      rows.consultant_research_round.find(
        (r) => r.record.round_id === f.parentId,
      );
    assert.deepEqual(parent(after), parent(before));
    assert.deepEqual(
      after.consultant_provider_call,
      before.consultant_provider_call,
    );
    const savedEvents = new Map(
      after.consultant_workflow_event.map((r) => [r.record.event_id, r.record]),
    );
    for (const event of before.consultant_workflow_event)
      assert.deepEqual(savedEvents.get(event.record.event_id), event.record);
    const recovery = after.consultant_workflow_event.find(
      (r) => r.record.phase === "research_focus_recovery",
    ).record;
    assert.deepEqual(
      recovery.detail.previous_job,
      before.consultant_workflow_job[0].record,
    );
    for (const field of [
      "user_profile_id",
      "run_id",
      "execution_id",
      "classification_id",
    ])
      assert.equal(recovery[field], f.identity[field]);
    assert.equal(after.consultant_workflow_job.length, 1);
    assert.equal(after.consultant_workflow_job[0].record.job_id, f.job.job_id);
    assert.equal(after.consultant_workflow_job[0].record.status, "queued");
  },
);

dbTest(
  "L05 historical focus attempts cannot reset through repeated operator resumes",
  async (t) => {
    const f = await fixture(t);
    for (const consumed of [1, 2]) {
      const review = await recoverApprovedFocusStage(f.db, f.identity);
      assert.equal(review.consumed_focus_attempts, consumed);
      await recoverApprovedFocusStage(f.db, f.identity, {
        execute: true,
        expected_snapshot_hash: review.snapshot_hash,
      });
      await f.fail();
    }
    await assert.rejects(
      recoverApprovedFocusStage(f.db, f.identity),
      /no safely reusable/,
    );
  },
);

const blocked = [
  [
    "changed approved source",
    (f) =>
      f.db.query(
        'UPDATE consultant_workflow_session SET deep_prompt_revision=deep_prompt_revision || \'{"prompt_text":"changed"}\'::jsonb WHERE account_id=$1',
        [f.identity.account_id],
      ),
  ],
  [
    "user cancellation",
    (f) =>
      f.db.query(
        "UPDATE consultant_workflow_job SET error_code='user-cancelled' WHERE job_id=$1",
        [f.job.job_id],
      ),
  ],
  [
    "active job",
    (f) =>
      f.db.query(
        "UPDATE consultant_workflow_job SET status='running' WHERE job_id=$1",
        [f.job.job_id],
      ),
  ],
  [
    "wrong retained provider owner",
    (f) =>
      f.db.query(
        "UPDATE consultant_provider_call SET user_profile_id=$2 WHERE account_id=$1",
        [f.identity.account_id, randomUUID()],
      ),
  ],
  [
    "downstream provider dispatch",
    (f) =>
      recordConsultantProviderCall(f.db, f.identity, {
        ...event(
          randomUUID(),
          { dispatched: true, state: "failed" },
          "focused_research",
        ).detail,
        phase: "focused_research",
      }),
  ],
  [
    "unresolved started call",
    (f) =>
      recordConsultantProviderCall(f.db, f.identity, {
        ...event(randomUUID(), { dispatched: true, state: "started" }).detail,
        phase: "research_focus_analysis",
      }),
  ],
  [
    "parent checkpoint unavailable",
    (f) =>
      f.db.query(
        "UPDATE consultant_research_round SET continuation=NULL WHERE round_id=$1",
        [f.parentId],
      ),
  ],
  [
    "later proposed quote",
    (f) =>
      f.db.query(
        "INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan) SELECT $2,account_id,user_profile_id,run_id,classification_id,round_number,plan FROM consultant_research_round WHERE round_id=$1",
        [f.identity.round_id, randomUUID()],
      ),
  ],
  [
    "already retained output",
    (f) =>
      f.db.query(
        "UPDATE consultant_research_round SET output='{}'::jsonb WHERE round_id=$1",
        [f.identity.round_id],
      ),
  ],
];
for (const [label, mutate] of blocked)
  dbTest(`L05 focus recovery refuses ${label} without mutation`, async (t) => {
    const f = await fixture(t);
    await mutate(f);
    const before = await f.snapshot();
    await assert.rejects(recoverApprovedFocusStage(f.db, f.identity), {
      code: "MB-409-FOCUS-RECOVERY",
    });
    assert.deepEqual(await f.snapshot(), before);
  });

dbTest(
  "L05 recovery requires reviewed immutable parent content and exact ownership",
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      recoverApprovedFocusStage(f.db, {
        ...f.identity,
        user_profile_id: randomUUID(),
      }),
      { code: "MB-409-FOCUS-RECOVERY" },
    );
    const review = await recoverApprovedFocusStage(f.db, f.identity);
    await f.db.query(
      "UPDATE consultant_research_round SET continuation=continuation || '{\"changed\":true}'::jsonb WHERE round_id=$1",
      [f.parentId],
    );
    const before = await f.snapshot();
    await assert.rejects(
      recoverApprovedFocusStage(f.db, f.identity, {
        execute: true,
        expected_snapshot_hash: review.snapshot_hash,
      }),
      /snapshot changed/,
    );
    assert.deepEqual(await f.snapshot(), before);
  },
);
