import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  assertExecutionFence,
  assertResearchPublicationAuthority,
  claimConsultantWorkflowJob,
  commitResearchStage,
  completeResearchRound,
  createPool,
  enqueueConsultantWorkflowJob,
  failExpiredConsultantWorkflowJobs,
  getExecutionRecoveryState,
  hashResearchAuthority,
  inTransaction,
  loadResearchStage,
  migrateUp,
  recordResearchAttemptReceipt,
  recordResearchIncident,
  readResearchIncidentPacket,
  reserveResearchAttempt,
  saveConsultantWorkflowSession,
  stopConsultantResearch,
} from "../../../packages/data/dist/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;

dbTest(
  "L05 incidents retain four-ID ownership and omit raw errors from the repair packet",
  async (t) => {
    const { pool, identity } = await fixture(t);
    const incident = {
      stage: "research",
      disposition: "incident_required",
      code: "private buyer text: do not retain",
    };
    const first = await recordResearchIncident(pool, identity, incident);
    assert.equal(await recordResearchIncident(pool, identity, incident), first);
    const packet = await readResearchIncidentPacket(pool, identity, first);
    assert.equal(packet.fault_code, "UNCLASSIFIED");
    assert.equal(packet.authority.may_deploy, false);
    assert.equal(packet.authority.model_calls, 0);
    for (const secret of [
      identity.run_id,
      identity.account_id,
      identity.user_profile_id,
      identity.execution_id,
      incident.code,
    ])
      assert.equal(JSON.stringify(packet).includes(secret), false);
    const stored = await pool.query(
      "SELECT * FROM consultant_research_incident WHERE incident_id=$1",
      [first],
    );
    assert.equal(stored.rows[0].occurrences, 2);
    for (const field of [
      "account_id",
      "user_profile_id",
      "run_id",
      "execution_id",
      "classification_id",
    ])
      assert.equal(stored.rows[0][field], identity[field]);
    assert.equal(
      await readResearchIncidentPacket(
        pool,
        { ...identity, user_profile_id: randomUUID() },
        first,
      ),
      null,
    );
    await assert.rejects(
      recordResearchIncident(
        pool,
        { ...identity, classification_id: randomUUID() },
        incident,
      ),
      /ownership/,
    );
    await assert.rejects(
      recordResearchIncident(pool, identity, { ...incident, stage: "prepare" }),
      /ownership/,
    );
  },
);

async function fixture(t, overrides = {}) {
  const pool = createPool({ connectionString: database, max: 8 });
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
    "INSERT INTO account(account_id,display_name,status) VALUES($1,'Execution integrity isolated fixture','active')",
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
    estimated_high_usd: 0.01,
    execution_recovery: {
      version: "durable.v1",
      max_resumes: 2,
      valid_for_ms: 86400000,
    },
    ...overrides,
  };
  const round = await pool.query(
    `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,approved_at)
     VALUES($1,$2,$3,$4,$5,1,$6,'approved',$7,clock_timestamp()) RETURNING approved_at`,
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
  const expires = new Date(
    round.rows[0].approved_at.getTime() + 3600000,
  ).toISOString();
  const approval = hashResearchAuthority(plan);
  return {
    pool,
    identity,
    fence,
    job,
    plan,
    reserve: (changes = {}) => ({
      request_id: randomUUID(),
      operation_key: "fixture-operation",
      stage_key: hashResearchAuthority("fixture-stage"),
      phase: "extraction",
      model: "fixture",
      input_sha256: hashResearchAuthority("fixture-input"),
      approval_sha256: approval,
      reserve_synthesis: false,
      estimated_exposure_usd: null,
      ...changes,
    }),
    manifest: (changes = {}) => ({
      version: "research-stage.v1",
      stage_kind: "extraction",
      qualification: "validated_extraction",
      operation_key: "fixture-operation",
      input_sha256: hashResearchAuthority("fixture-input"),
      policy_sha256: hashResearchAuthority("policy"),
      approval_sha256: approval,
      schema_version: "fixture.v1",
      validator_version: "fixture.v1",
      model_policy_sha256: hashResearchAuthority("model"),
      expires_at: expires,
      ...changes,
    }),
  };
}

async function expire(state) {
  await state.pool.query(
    "UPDATE consultant_workflow_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",
    [state.job.job_id],
  );
}

dbTest(
  "final publication rejects an expired approval even with a current execution lease",
  async (t) => {
    const s = await fixture(t);
    await s.pool.query(
      `UPDATE consultant_research_round SET approved_at=clock_timestamp()-interval '25 hours' WHERE account_id=$1`,
      [s.identity.account_id],
    );
    await assert.rejects(
      inTransaction(s.pool, async (client) => {
        await assertResearchPublicationAuthority(
          client,
          s.identity,
          s.fence,
          hashResearchAuthority(s.plan),
        );
        await completeResearchRound(
          client,
          s.identity.account_id,
          s.identity.execution_id,
          {
            ...s.identity,
            research_run_id: s.identity.run_id,
            supplier_candidates: [],
          },
          {},
        );
      }),
      { code: "MB-409-EXECUTION-AUTHORITY" },
    );
    const row = await s.pool.query(
      `SELECT status,output FROM consultant_research_round WHERE account_id=$1`,
      [s.identity.account_id],
    );
    assert.equal(row.rows[0].status, "approved");
    assert.equal(row.rows[0].output, null);
  },
);

dbTest(
  "final publication rejects an approval changed after the final stage",
  async (t) => {
    const s = await fixture(t);
    await s.pool.query(
      `UPDATE consultant_research_round SET plan=plan || '{"max_calls":9}'::jsonb WHERE account_id=$1`,
      [s.identity.account_id],
    );
    await assert.rejects(
      inTransaction(s.pool, (client) =>
        assertResearchPublicationAuthority(
          client,
          s.identity,
          s.fence,
          hashResearchAuthority(s.plan),
        ),
      ),
      { code: "MB-409-EXECUTION-AUTHORITY" },
    );
  },
);

dbTest(
  "same-process replay is blocked until an explicit provider receipt establishes the outcome",
  async (t) => {
    const s = await fixture(t);
    const first = s.reserve();
    await reserveResearchAttempt(s.pool, s.identity, s.fence, first);
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()),
      { code: "MB-409-EXECUTION-AMBIGUOUS" },
    );
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: first.request_id,
      state: "failed",
      dispatched: true,
      provider_generation_id: "untrusted-generation-does-not-prove-response",
      cost_reported: true,
      cost_usd: 0,
    });
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()),
      { code: "MB-409-EXECUTION-AMBIGUOUS" },
    );
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: first.request_id,
      state: "failed",
      dispatched: true,
      provider_receipt_received: true,
    });
    const second = s.reserve();
    assert.equal(
      (await reserveResearchAttempt(s.pool, s.identity, s.fence, second))
        .reserved,
      true,
    );
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: second.request_id,
      state: "failed",
      dispatched: true,
      provider_dispatch_rejected: true,
    });
    assert.equal(
      (await reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()))
        .reserved,
      true,
    );
  },
);

dbTest(
  "a shorter approved execution window is not extended to the default day",
  async (t) => {
    const s = await fixture(t, {
      execution_recovery: {
        version: "durable.v1",
        max_resumes: 2,
        valid_for_ms: 1000,
      },
    });
    await s.pool.query(
      "UPDATE consultant_research_round SET approved_at=clock_timestamp()-interval '2 seconds' WHERE execution_id=$1",
      [s.identity.execution_id],
    );
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()),
      { code: "MB-409-EXECUTION-AUTHORITY" },
    );
  },
);

test("authority hashing survives JSONB property ordering but preserves array order", () => {
  assert.equal(
    hashResearchAuthority({ z: 1, a: { c: 2, b: 3 } }),
    hashResearchAuthority({ a: { b: 3, c: 2 }, z: 1 }),
  );
  assert.notEqual(hashResearchAuthority([1, 2]), hashResearchAuthority([2, 1]));
});

dbTest(
  "competing workers atomically consume one approved call and do not reinterpret cost estimate as cap",
  async (t) => {
    const s = await fixture(t, { max_calls: 1 });
    const responses = await Promise.allSettled(
      [1, 2].map(() =>
        reserveResearchAttempt(
          s.pool,
          s.identity,
          s.fence,
          s.reserve({ estimated_exposure_usd: 100 }),
        ),
      ),
    );
    assert.equal(responses.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      responses.find((x) => x.status === "rejected").reason.code,
      "MB-409-ROUND-ALLOWANCE",
    );
    const retained = await getExecutionRecoveryState(s.pool, s.identity);
    assert.equal(retained.attempt_count, 1);
    assert.equal(Number(retained.estimated_exposure_usd), 100);
    assert.equal(retained.unknown_cost_attempts, 1);
  },
);

dbTest(
  "attempt identifiers replay admission without authorizing duplicate dispatch",
  async (t) => {
    const s = await fixture(t);
    const reservation = s.reserve();
    assert.equal(
      (await reserveResearchAttempt(s.pool, s.identity, s.fence, reservation))
        .reserved,
      true,
    );
    assert.equal(
      (await reserveResearchAttempt(s.pool, s.identity, s.fence, reservation))
        .reserved,
      false,
    );
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, {
        ...reservation,
        input_sha256: hashResearchAuthority("changed"),
      }),
      { code: "MB-409-EXECUTION-ATTEMPT" },
    );
  },
);

dbTest(
  "stage retry allowance survives a new process and replacement lease",
  async (t) => {
    const s = await fixture(t, { automatic_recovery_attempts: 1 });
    const reservation = s.reserve();
    await reserveResearchAttempt(s.pool, s.identity, s.fence, reservation);
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: reservation.request_id,
      state: "completed",
      dispatched: true,
      cost_reported: true,
      cost_usd: 0.5,
    });
    await expire(s);
    await failExpiredConsultantWorkflowJobs(s.pool);
    const replacement = await claimConsultantWorkflowJob(s.pool, s.job.job_id);
    assert.ok(replacement);
    const fence = {
      job_id: replacement.job_id,
      lease_token: replacement.lease_token,
    };
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, fence, s.reserve()),
      { code: "MB-409-STAGE-ALLOWANCE" },
    );
    await assert.rejects(
      inTransaction(s.pool, (client) =>
        assertExecutionFence(client, s.identity, s.fence),
      ),
      { code: "execution-lease-lost" },
    );
  },
);

dbTest(
  "pre-dispatch started event cannot release an admission reservation",
  async (t) => {
    const s = await fixture(t, { max_calls: 1 });
    const request = s.reserve();
    await reserveResearchAttempt(s.pool, s.identity, s.fence, request);
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: request.request_id,
      state: "started",
      dispatched: false,
    });
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()),
      { code: "MB-409-ROUND-ALLOWANCE" },
    );
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: request.request_id,
      state: "failed",
      dispatched: false,
    });
    assert.equal(
      (await reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()))
        .reserved,
      true,
    );
  },
);

dbTest(
  "late receipt retains cost after cancellation without granting publication",
  async (t) => {
    const s = await fixture(t);
    const request = s.reserve();
    await reserveResearchAttempt(s.pool, s.identity, s.fence, request);
    await stopConsultantResearch(
      s.pool,
      s.identity.account_id,
      s.identity.run_id,
      s.identity.execution_id,
    );
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: request.request_id,
      state: "completed",
      dispatched: true,
      cost_reported: true,
      cost_usd: 1.25,
    });
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: request.request_id,
      state: "started",
      dispatched: false,
    });
    const state = await getExecutionRecoveryState(s.pool, s.identity);
    assert.equal(Number(state.confirmed_cost_usd), 1.25);
    assert.equal(state.unreceipted_attempts, 0);
    await assert.rejects(
      commitResearchStage(s.pool, s.identity, s.fence, s.manifest(), {
        source: "retained-only",
      }),
      { code: "execution-lease-lost" },
    );
  },
);

dbTest(
  "immutable full stage result is scoped to identity, input, method and expiry",
  async (t) => {
    const s = await fixture(t);
    const manifest = s.manifest();
    const result = {
      parsed: { supplier: "Fixture", findings: [1, 2] },
      raw: { text: "full source", citations: ["https://example.invalid"] },
    };
    await commitResearchStage(s.pool, s.identity, s.fence, manifest, result);
    await commitResearchStage(s.pool, s.identity, s.fence, manifest, result);
    assert.deepEqual(
      (await loadResearchStage(s.pool, s.identity, s.fence, manifest)).result,
      result,
    );
    assert.equal(
      await loadResearchStage(
        s.pool,
        s.identity,
        s.fence,
        s.manifest({ validator_version: "fixture.v2" }),
      ),
      null,
    );
    assert.equal(
      await loadResearchStage(
        s.pool,
        s.identity,
        s.fence,
        s.manifest({ input_sha256: hashResearchAuthority("new") }),
      ),
      null,
    );
    await assert.rejects(
      commitResearchStage(s.pool, s.identity, s.fence, manifest, {
        overwritten: true,
      }),
      { code: "MB-409-EXECUTION-MANIFEST" },
    );
    await assert.rejects(
      loadResearchStage(
        s.pool,
        { ...s.identity, user_profile_id: randomUUID() },
        s.fence,
        manifest,
      ),
      { code: "execution-lease-lost" },
    );
    await assert.rejects(
      s.pool.query(
        "UPDATE consultant_research_stage SET result='{}' WHERE account_id=$1",
        [s.identity.account_id],
      ),
      /immutable/,
    );
  },
);

dbTest(
  "transport receipt remains explicitly unvalidated and expiry cannot extend approval",
  async (t) => {
    const s = await fixture(t);
    const manifest = s.manifest({ qualification: "received_unvalidated" });
    await commitResearchStage(s.pool, s.identity, s.fence, manifest, {
      text: "untrusted transport",
    });
    assert.equal(
      (await loadResearchStage(s.pool, s.identity, s.fence, manifest)).manifest
        .qualification,
      "received_unvalidated",
    );
    await assert.rejects(
      commitResearchStage(
        s.pool,
        s.identity,
        s.fence,
        s.manifest({
          expires_at: new Date(Date.now() + 48 * 3600000).toISOString(),
        }),
        {},
      ),
      { code: "MB-409-EXECUTION-MANIFEST" },
    );
    await assert.rejects(
      commitResearchStage(
        s.pool,
        s.identity,
        s.fence,
        s.manifest({ expires_at: new Date(Date.now() - 1000).toISOString() }),
        {},
      ),
      { code: "MB-409-EXECUTION-MANIFEST" },
    );
  },
);

dbTest(
  "changed approval or expired lease rejects attempts and stage publication",
  async (t) => {
    const s = await fixture(t);
    await assert.rejects(
      reserveResearchAttempt(
        s.pool,
        s.identity,
        s.fence,
        s.reserve({ approval_sha256: hashResearchAuthority("changed") }),
      ),
      { code: "MB-409-EXECUTION-AUTHORITY" },
    );
    await expire(s);
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()),
      { code: "execution-lease-lost" },
    );
    await assert.rejects(
      commitResearchStage(s.pool, s.identity, s.fence, s.manifest(), {}),
      { code: "execution-lease-lost" },
    );
  },
);

dbTest(
  "safe recovery retains successful stage and stops at the persisted resume ceiling",
  async (t) => {
    const s = await fixture(t);
    await commitResearchStage(s.pool, s.identity, s.fence, s.manifest(), {
      retained: "complete",
    });
    for (let i = 1; i <= 2; i++) {
      await expire(s);
      await failExpiredConsultantWorkflowJobs(s.pool);
      const job = await claimConsultantWorkflowJob(s.pool, s.job.job_id);
      assert.equal(job.resume_count, i);
      s.fence = { job_id: job.job_id, lease_token: job.lease_token };
      assert.deepEqual(
        (await loadResearchStage(s.pool, s.identity, s.fence, s.manifest()))
          .result,
        { retained: "complete" },
      );
    }
    await expire(s);
    await failExpiredConsultantWorkflowJobs(s.pool);
    assert.equal(await claimConsultantWorkflowJob(s.pool, s.job.job_id), null);
  },
);

dbTest(
  "ambiguous provider dispatch prevents automatic replay and preserves exposure",
  async (t) => {
    const s = await fixture(t);
    await reserveResearchAttempt(
      s.pool,
      s.identity,
      s.fence,
      s.reserve({ estimated_exposure_usd: 0.35 }),
    );
    await expire(s);
    await failExpiredConsultantWorkflowJobs(s.pool);
    assert.equal(await claimConsultantWorkflowJob(s.pool, s.job.job_id), null);
    const state = await getExecutionRecoveryState(s.pool, s.identity);
    assert.equal(state.unreceipted_attempts, 1);
    assert.equal(Number(state.estimated_exposure_usd), 0.35);
  },
);

dbTest(
  "legacy approval cannot opt into automatic recovery by worker restart",
  async (t) => {
    const s = await fixture(t, { execution_recovery: undefined });
    await expire(s);
    await failExpiredConsultantWorkflowJobs(s.pool);
    assert.equal(await claimConsultantWorkflowJob(s.pool, s.job.job_id), null);
  },
);

dbTest(
  "a reported zero charge does not make a failed external operation safe to replay",
  async (t) => {
    const s = await fixture(t);
    const request = s.reserve();
    await reserveResearchAttempt(s.pool, s.identity, s.fence, request);
    await recordResearchAttemptReceipt(s.pool, s.identity, {
      request_id: request.request_id,
      state: "failed",
      dispatched: true,
      cost_reported: true,
      cost_usd: 0,
    });
    await expire(s);
    await failExpiredConsultantWorkflowJobs(s.pool);
    assert.equal(await claimConsultantWorkflowJob(s.pool, s.job.job_id), null);
    const state = await getExecutionRecoveryState(s.pool, s.identity);
    assert.equal(state.unreceipted_attempts, 1);
    assert.equal(state.blocked_replay_attempts, 1);
    assert.equal(state.unknown_cost_attempts, 0);
  },
);

dbTest(
  "legacy dispatched accounting remains charged against atomic allowance",
  async (t) => {
    const s = await fixture(t, { max_calls: 1 });
    await s.pool.query(
      `INSERT INTO consultant_provider_call(request_id,account_id,user_profile_id,run_id,execution_id,classification_id,phase,detail)
    VALUES($1,$2,$3,$4,$5,$6,'legacy','{"state":"completed","dispatched":true}')`,
      [
        randomUUID(),
        s.identity.account_id,
        s.identity.user_profile_id,
        s.identity.run_id,
        s.identity.execution_id,
        s.identity.classification_id,
      ],
    );
    await assert.rejects(
      reserveResearchAttempt(s.pool, s.identity, s.fence, s.reserve()),
      { code: "MB-409-ROUND-ALLOWANCE" },
    );
  },
);
