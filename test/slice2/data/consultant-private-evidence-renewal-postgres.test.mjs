import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  applyPrivateEvidenceTombstones,
  approveResearchQuote,
  assertEvidenceUseManifest,
  assertLogicalRequestFence,
  assertLogicalRequestRunFence,
  assertQuotedPrivateMemoryAuthority,
  assertResearchOutputRights,
  assertResearchPublicationAuthority,
  assertCompletedResearchPublicationAuthority,
  assertRetainedParentAuthority,
  capturePrivateResearchEvidence,
  claimConsultantWorkflowJob,
  commitResearchStage,
  completeResearchRound,
  createEvidenceUseManifest,
  createLinkedResearchRenewal,
  createPool,
  finishConsultantWorkflowJob,
  getLogicalResearchHistory,
  hashResearchAuthority,
  inTransaction,
  invalidatePrivateEvidenceObservation,
  listInvalidEvidenceDerivatives,
  listConsultantResearchSummaries,
  listConsultantWorkflowSessions,
  loadResearchStage,
  migrateUp,
  privateEntityResolution,
  purgeWithdrawnPrivateEvidenceSource,
  readPrivateNegativeChecks,
  registerEvidenceDerivative,
  reserveResearchAttempt,
  retainResearchParentDependency,
  retrievePrivateEvidence,
  saveConsultantWorkflowSession,
  saveProductClassification,
  searchPrivateEvidenceProfile,
  savePrivateNegativeCheck,
  saveResearchQuote,
  validatePrivateEvidenceSelection,
  withdrawPrivateEvidenceSource,
} from "../../../packages/data/dist/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

dbTest("official CPC and ISIC service classifications persist", async (t) => {
  const s = await fixture(t);
  for (const [scheme, code, label] of [
    ["CPC", "67910", "Freight transport agency services"],
    ["ISIC", "5229", "Other transportation support activities"],
  ])
    await saveProductClassification(s.pool, s.identity.account_id, {
      ...s.classification,
      classification_id: randomUUID(),
      scheme,
      code,
      label,
    });
  const saved = await s.pool.query(
    "SELECT scheme,code FROM product_classification WHERE account_id=$1 ORDER BY scheme",
    [s.identity.account_id],
  );
  assert.deepEqual(saved.rows, [
    { scheme: "CPC", code: "67910" },
    { scheme: "ISIC", code: "5229" },
  ]);
});

async function fixture(t) {
  const pool = createPool({ connectionString: database, max: 10 });
  const identity = Object.fromEntries(
    [
      "account_id",
      "user_profile_id",
      "run_id",
      "execution_id",
      "classification_id",
    ].map((k) => [k, randomUUID()]),
  );
  const classification = {
    classification_id: identity.classification_id,
    scheme: "HS",
    code: "281520",
    version: "2022",
    level: "6",
    label: "Potassium hydroxide",
    description: "Fixture classification",
    is_primary: true,
    confidence: "high",
    assigned_at: ago(0),
  };
  const approved = {
    revision_id: randomUUID(),
    english_translation: "Find potassium hydroxide suppliers",
  };
  const prompt = {
    is_approved: true,
    prompt_text: "Find evidence for potassium hydroxide suppliers",
    revision_id: randomUUID(),
  };
  t.after(async () => {
    try {
      for (const table of [
        "consultant_workflow_event",
        "consultant_workflow_job",
        "consultant_workflow_session",
        "consultant_draft_session",
        "consultant_intake_snapshot",
        "consultant_output_v3",
        "consultant_supplier_entity_v3",
        "consultant_research_execution",
        "product_classification",
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
    "INSERT INTO account(account_id,display_name,status) VALUES($1,'Private evidence isolated fixture','active')",
    [identity.account_id],
  );
  await saveConsultantWorkflowSession(pool, {
    ...identity,
    session_id: randomUUID(),
    current_state: "workflow_complete",
    original_intake: { product_requirement: "Potassium hydroxide" },
    classification,
    approved_request_revision: approved,
    deep_prompt_revision: prompt,
    workflow_metadata: {
      mode: "live",
      classification_id: identity.classification_id,
    },
  });
  function output(options = {}) {
    const supplierId = randomUUID();
    const source = {
      evidence_id: "e1",
      source_id: "source1",
      source_url: `https://registry.example.invalid/${options.source ?? "supplier"}`,
      source_title: "Official registry record",
      publisher: "Registry fixture",
      source_type: options.source_type ?? "official_registry",
      retrieved_at: ago(options.retrieved_days ?? 0),
      published_at: ago(0),
      verification_status: "externally_verified",
      freshness_status: "current",
      excerpt_summary: `${options.country ?? "China"} registry CN12345. Example Chemical supplies potassium hydroxide. Price USD 600 per tonne.`,
      supports_claim_ids: ["identity", "price"],
      contradicts_claim_ids: [],
    };
    const supplier = {
      supplier_entity_id: supplierId,
      legal_name: "Example Chemical",
      trading_name: "Example",
      aliases: [],
      website: "https://example.invalid/",
      country_of_registration: options.country ?? "China",
      registry_identifiers: options.unresolved
        ? {}
        : { company_register: "CN12345" },
      identity_evidence_ids: ["e1"],
      commercial: {
        currency: "USD",
        unit: "tonne",
        price_min: 600,
        price_max: 600,
        price_date: options.undated ? undefined : ago(options.price_days ?? 1),
        commercial_evidence_ids: ["e1"],
      },
    };
    return {
      research_mode: "live",
      user_profile_id: identity.user_profile_id,
      research_run_id: identity.run_id,
      execution_id: identity.execution_id,
      classification_id: identity.classification_id,
      primary_classification: classification,
      supplier_candidates: [supplier],
      evidence_sources: [source],
      claims: [
        {
          claim_id: "identity",
          supplier_entity_id: supplierId,
          claim_type: "identity",
          claim_text: "Example Chemical supplies potassium hydroxide",
          status: "externally_verified",
          evidence_ids: ["e1"],
        },
        {
          claim_id: "price",
          supplier_entity_id: supplierId,
          claim_type: "pricing",
          claim_text: "Potassium hydroxide USD 600 per tonne",
          normalized_value: 600,
          unit: "tonne",
          status: "supplier_claimed",
          evidence_ids: ["e1"],
        },
      ],
    };
  }
  const capture = async (payload) =>
    inTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,output,completed_at)
      VALUES($1,$2,$3,$4,$5,1,'{}','completed',$6,$7,clock_timestamp())`,
        [
          randomUUID(),
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          identity.classification_id,
          identity.execution_id,
          JSON.stringify(payload),
        ],
      );
      return capturePrivateResearchEvidence(client, identity, payload);
    });
  const lookup = (overrides = {}) =>
    retrievePrivateEvidence(pool, {
      ...identity,
      classification,
      query: "potassium hydroxide",
      purpose: "discovery",
      ...overrides,
    });
  const command = () => ({
    parent_run_id: identity.run_id,
    expected_generation: 0,
    idempotency_key: randomUUID(),
    expected_request_hash: hashResearchAuthority(approved),
    expected_prompt_hash: hashResearchAuthority(prompt),
    compatibility_version: "renewal.v1",
  });
  return {
    pool,
    identity,
    classification,
    approved,
    prompt,
    output,
    capture,
    lookup,
    command,
  };
}

async function retainedParentFixture(t, memory = "empty") {
  const s = await fixture(t);
  await s.capture(s.output());
  const parent = (
    await s.pool.query(
      "SELECT round_id FROM consultant_research_round WHERE account_id=$1",
      [s.identity.account_id],
    )
  ).rows[0];
  const saved = (
    await s.pool.query(
      "SELECT approved_request_revision,deep_prompt_revision FROM consultant_workflow_session WHERE run_id=$1",
      [s.identity.run_id],
    )
  ).rows[0];
  const sourceId = (await s.lookup()).observations[0].source_id;
  const plan = {
    round_number: 2,
    parent_round_id: parent.round_id,
    mode: "live",
    max_calls: 8,
    automatic_recovery_attempts: 3,
    logical_request_generation: 0,
    execution_recovery: {
      version: "durable.v1",
      max_resumes: 2,
      valid_for_ms: 86400000,
    },
    request_hash: createHash("sha256")
      .update(
        JSON.stringify([
          saved.approved_request_revision,
          saved.deep_prompt_revision,
        ]),
      )
      .digest("hex"),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    ...(memory === "empty"
      ? {
          private_memory: {
            version: "private-memory.v1",
            observation_refs: [],
            valid_until: new Date(Date.now() + 3600000).toISOString(),
          },
        }
      : {}),
  };
  const quote = () => saveResearchQuote(s.pool, s.identity, plan);
  const approve = async (quoteId = undefined) => {
    const id = quoteId ?? (await quote());
    const approval = await approveResearchQuote(
      s.pool,
      s.identity.account_id,
      s.identity.user_profile_id,
      s.identity.run_id,
      id,
      plan.request_hash,
    );
    const job = await claimConsultantWorkflowJob(s.pool, approval.job.job_id);
    const next = { ...s.identity, execution_id: approval.execution_id };
    return {
      next,
      fence: { job_id: job.job_id, lease_token: job.lease_token },
      roundId: id,
    };
  };
  const manifest = {
    version: "research-stage.v1",
    stage_kind: "focus",
    qualification: "validated_focus",
    operation_key: "retained-parent",
    input_sha256: hashResearchAuthority("retained parent"),
    policy_sha256: hashResearchAuthority("policy"),
    approval_sha256: hashResearchAuthority(plan),
    schema_version: "fixture.v1",
    validator_version: "fixture.v1",
    model_policy_sha256: hashResearchAuthority("fixture"),
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  };
  const reservation = {
    request_id: randomUUID(),
    operation_key: "focus",
    stage_key: hashResearchAuthority("focus"),
    phase: "focus",
    model: "fixture",
    input_sha256: hashResearchAuthority("retained parent"),
    approval_sha256: hashResearchAuthority(plan),
    reserve_synthesis: false,
    estimated_exposure_usd: 0,
  };
  return {
    ...s,
    parent,
    sourceId,
    plan,
    quote,
    approve,
    manifest,
    reservation,
  };
}

for (const memory of ["empty", "absent"]) {
  dbTest(
    `withdrawn parent blocks quotation and approval with ${memory} private-memory selection`,
    async (t) => {
      const s = await retainedParentFixture(t, memory);
      const quoted = await s.quote();
      await withdrawPrivateEvidenceSource(
        s.pool,
        s.identity,
        s.sourceId,
        "Withdraw after quotation",
      );
      await assert.rejects(s.quote(), { code: "MB-409-EVIDENCE-WITHDRAWN" });
      await assert.rejects(s.approve(quoted), {
        code: "MB-409-EVIDENCE-WITHDRAWN",
      });
      assert.equal(
        (
          await s.pool.query(
            "SELECT count(*)::int AS n FROM consultant_workflow_job WHERE account_id=$1",
            [s.identity.account_id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  dbTest(
    `withdrawn parent blocks paid admission, stage replay and publication with ${memory} memory selection`,
    async (t) => {
      const s = await retainedParentFixture(t, memory);
      const { next, fence } = await s.approve();
      await commitResearchStage(s.pool, next, fence, s.manifest, {
        retained: "full validated focus",
      });
      await withdrawPrivateEvidenceSource(
        s.pool,
        s.identity,
        s.sourceId,
        "Withdraw during an in-flight research stage",
      );
      await assert.rejects(
        reserveResearchAttempt(s.pool, next, fence, s.reservation),
        { code: "MB-409-EVIDENCE-WITHDRAWN" },
      );
      await assert.rejects(loadResearchStage(s.pool, next, fence, s.manifest), {
        code: "MB-409-EVIDENCE-WITHDRAWN",
      });
      await assert.rejects(
        commitResearchStage(
          s.pool,
          next,
          fence,
          { ...s.manifest, operation_key: "later" },
          { result: "late" },
        ),
        { code: "MB-409-EVIDENCE-WITHDRAWN" },
      );
      await assert.rejects(
        inTransaction(s.pool, (c) =>
          assertResearchPublicationAuthority(
            c,
            next,
            fence,
            hashResearchAuthority(s.plan),
          ),
        ),
        { code: "MB-409-EVIDENCE-WITHDRAWN" },
      );
      assert.equal(
        (
          await s.pool.query(
            "SELECT count(*)::int AS n FROM consultant_research_attempt WHERE account_id=$1",
            [s.identity.account_id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
}

dbTest(
  "retained parent dependencies invalidate a child whose displayed sources omit the parent",
  async (t) => {
    const s = await retainedParentFixture(t);
    const { next, fence, roundId } = await s.approve();
    const output = {
      ...s.output(),
      execution_id: next.execution_id,
      evidence_sources: [],
      claims: [],
      supplier_candidates: [],
    };
    await inTransaction(s.pool, async (c) => {
      await assertResearchPublicationAuthority(
        c,
        next,
        fence,
        hashResearchAuthority(s.plan),
      );
      await completeResearchRound(
        c,
        next.account_id,
        next.execution_id,
        output,
        {},
      );
      await retainResearchParentDependency(c, next, s.plan);
      await assertCompletedResearchPublicationAuthority(
        c,
        next,
        fence,
        hashResearchAuthority(s.plan),
      );
    });
    await assertResearchOutputRights(s.pool, next);
    const thirdPlan = { ...s.plan, round_number: 3, parent_round_id: roundId };
    await inTransaction(s.pool, (c) =>
      assertRetainedParentAuthority(c, next, thirdPlan),
    );
    await assert.rejects(
      s.pool.query(
        "UPDATE consultant_research_parent_dependency SET parent_output_sha256=$1 WHERE execution_id=$2",
        [hashResearchAuthority("forged"), next.execution_id],
      ),
      /immutable/,
    );
    await withdrawPrivateEvidenceSource(
      s.pool,
      s.identity,
      s.sourceId,
      "Withdraw source retained only through parent context",
    );
    await assert.rejects(assertResearchOutputRights(s.pool, next), {
      code: "MB-409-EVIDENCE-WITHDRAWN",
    });
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        assertRetainedParentAuthority(c, next, thirdPlan),
      ),
      { code: "MB-409-EVIDENCE-WITHDRAWN" },
    );
    await purgeWithdrawnPrivateEvidenceSource(s.pool, s.identity, s.sourceId);
    await assert.rejects(assertResearchOutputRights(s.pool, next), {
      code: "MB-409-EVIDENCE-WITHDRAWN",
    });
  },
);

for (const deadline of ["lease", "approval"])
  dbTest(
    `publication rolls back when the ${deadline} expires while capture waits on a source`,
    async (t) => {
      const s = await retainedParentFixture(t);
      const { next, fence, roundId } = await s.approve();
      const captureUrl = "https://new-source.example.invalid/capture";
      const captureSourceId = randomUUID();
      await s.pool.query(
        "INSERT INTO consultant_private_source(source_id,account_id,user_profile_id,source_url,source_key) VALUES($1,$2,$3,$4,$5)",
        [
          captureSourceId,
          next.account_id,
          next.user_profile_id,
          captureUrl,
          hashResearchAuthority(captureUrl),
        ],
      );
      const output = { ...s.output(), execution_id: next.execution_id };
      output.evidence_sources[0].source_url = captureUrl;
      if (deadline === "lease")
        await s.pool.query(
          "UPDATE consultant_workflow_job SET lease_until=clock_timestamp()+interval '1 second' WHERE job_id=$1",
          [fence.job_id],
        );
      else
        await s.pool.query(
          "UPDATE consultant_research_round SET approved_at=clock_timestamp()-interval '24 hours'+interval '1 second' WHERE round_id=$1",
          [roundId],
        );
      const blocker = await s.pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT source_id FROM consultant_private_source WHERE source_id=$1 FOR UPDATE",
        [captureSourceId],
      );
      let announceCapture;
      const captureStarting = new Promise((resolve) => {
        announceCapture = resolve;
      });
      const publication = inTransaction(s.pool, async (c) => {
        await assertResearchPublicationAuthority(
          c,
          next,
          fence,
          hashResearchAuthority(s.plan),
        );
        await completeResearchRound(
          c,
          next.account_id,
          next.execution_id,
          output,
          {},
        );
        await retainResearchParentDependency(c, next, s.plan);
        const pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid;
        announceCapture(pid);
        await capturePrivateResearchEvidence(c, next, output);
        await assertCompletedResearchPublicationAuthority(
          c,
          next,
          fence,
          hashResearchAuthority(s.plan),
        );
      });
      const rejection = assert.rejects(publication, {
        code:
          deadline === "lease"
            ? "execution-lease-lost"
            : "MB-409-EXECUTION-AUTHORITY",
      });
      try {
        const pid = await captureStarting;
        let observed = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const blocked = (
            await s.pool.query(
              "SELECT cardinality(pg_blocking_pids($1))>0 AS waiting",
              [pid],
            )
          ).rows[0].waiting;
          if (blocked) {
            observed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          observed,
          true,
          "capture must actually wait on the source lock",
        );
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await blocker.query("COMMIT");
        await rejection;
        assert.equal(
          (
            await s.pool.query(
              "SELECT status FROM consultant_research_round WHERE round_id=$1",
              [roundId],
            )
          ).rows[0].status,
          "approved",
        );
        assert.equal(
          (
            await s.pool.query(
              "SELECT count(*)::int AS n FROM consultant_private_output_provenance WHERE execution_id=$1",
              [next.execution_id],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await s.pool.query(
              "SELECT count(*)::int AS n FROM consultant_research_parent_dependency WHERE execution_id=$1",
              [next.execution_id],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    },
  );

dbTest(
  "private observations preserve four IDs and cannot cross a profile or classification",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const selected = await s.lookup();
    assert.equal(selected.observations.length, 2);
    assert.equal(selected.fresh_discovery_required, true);
    const rows = await s.pool.query(
      "SELECT * FROM consultant_private_observation WHERE account_id=$1",
      [s.identity.account_id],
    );
    for (const row of rows.rows)
      for (const key of Object.keys(s.identity))
        assert.equal(row[key], s.identity[key]);
    assert.equal(
      (await s.lookup({ user_profile_id: randomUUID() })).observations.length,
      0,
    );
    assert.equal(
      (
        await s.lookup({
          classification: { ...s.classification, code: "999999" },
        })
      ).observations.length,
      0,
    );
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        validatePrivateEvidenceSelection(
          c,
          { ...s.identity, user_profile_id: randomUUID() },
          selected.observations,
          "discovery",
        ),
      ),
      { code: "MB-409-PRIVATE-EVIDENCE" },
    );
    const otherIdentity = {
      ...s.identity,
      run_id: randomUUID(),
      execution_id: randomUUID(),
      classification_id: randomUUID(),
    };
    await saveConsultantWorkflowSession(s.pool, {
      ...otherIdentity,
      session_id: randomUUID(),
      current_state: "research_dispatching",
      original_intake: {},
      classification: {
        ...s.classification,
        classification_id: otherIdentity.classification_id,
        code: "999999",
      },
    });
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        validatePrivateEvidenceSelection(
          c,
          otherIdentity,
          selected.observations,
          "discovery",
        ),
      ),
      { code: "MB-409-PRIVATE-EVIDENCE" },
    );
    await assert.rejects(
      s.pool.query(
        "UPDATE consultant_private_observation SET claim_text='changed' WHERE account_id=$1",
        [s.identity.account_id],
      ),
      /immutable/,
    );
  },
);

dbTest(
  "only source-backed jurisdiction and registry identifiers merge entities; names remain unresolved",
  async (t) => {
    const s = await fixture(t);
    const a = s.output();
    const unresolved = s.output({ unresolved: true });
    const resolved = privateEntityResolution(
      s.identity,
      a.supplier_candidates[0],
      a.evidence_sources,
    );
    assert.equal(resolved.resolution, "registry_scoped");
    assert.equal(
      privateEntityResolution(
        s.identity,
        {
          ...a.supplier_candidates[0],
          registry_identifiers: { company_register: "CN1234" },
        },
        a.evidence_sources,
      ).resolution,
      "unresolved",
    );
    assert.equal(
      privateEntityResolution(s.identity, a.supplier_candidates[0], [
        { ...a.evidence_sources[0], source_type: "official_website" },
      ]).resolution,
      "unresolved",
    );
    assert.equal(
      privateEntityResolution(
        s.identity,
        { ...a.supplier_candidates[0], country_of_registration: "Canada" },
        a.evidence_sources,
      ).resolution,
      "unresolved",
    );
    const first = privateEntityResolution(
      s.identity,
      unresolved.supplier_candidates[0],
      unresolved.evidence_sources,
    );
    const second = privateEntityResolution(
      { ...s.identity, execution_id: randomUUID() },
      unresolved.supplier_candidates[0],
      unresolved.evidence_sources,
    );
    assert.notEqual(first.key, second.key);
    assert.equal(first.resolution, "unresolved");
  },
);

dbTest(
  "history filters profiles before pagination and hides withdrawn result availability",
  async (t) => {
    const s = await fixture(t);
    const payload = s.output();
    await s.capture(payload);
    await saveProductClassification(
      s.pool,
      s.identity.account_id,
      s.classification,
    );
    await s.pool.query(
      `INSERT INTO consultant_research_execution(execution_id,account_id,run_id,user_profile_id,classification_id,lanes_executed,
    verification_loops_count,execution_latency_ms,synthesis_model_id,status,started_at,completed_at)
    VALUES($1,$2,$3,$4,$5,'{}',1,0,'fixture','completed',clock_timestamp(),clock_timestamp())`,
      [
        s.identity.execution_id,
        s.identity.account_id,
        s.identity.run_id,
        s.identity.user_profile_id,
        s.identity.classification_id,
      ],
    );
    await s.pool.query(
      `INSERT INTO consultant_output_v3(output_id,account_id,run_id,execution_id,classification_id,user_profile_id,title,
    generated_at,as_of_date,research_mode,research_status,total_candidates_found,document_payload,document_sha256)
    VALUES($1,$2,$3,$4,$5,$6,'Retained evidence',clock_timestamp(),current_date,'live','partial',1,$7,$8)`,
      [
        randomUUID(),
        s.identity.account_id,
        s.identity.run_id,
        s.identity.execution_id,
        s.identity.classification_id,
        s.identity.user_profile_id,
        JSON.stringify(payload),
        Buffer.alloc(32),
      ],
    );
    const foreignProfile = randomUUID();
    const foreignRun = randomUUID();
    await saveConsultantWorkflowSession(s.pool, {
      session_id: randomUUID(),
      account_id: s.identity.account_id,
      user_profile_id: foreignProfile,
      run_id: foreignRun,
      current_state: "workflow_complete",
      original_intake: { product_requirement: "Other profile private request" },
    });
    const summary = await listConsultantResearchSummaries(
      s.pool,
      s.identity.account_id,
      s.identity.user_profile_id,
    );
    assert.equal(summary.length, 1);
    assert.equal(summary[0].run_id, s.identity.run_id);
    assert.equal(summary[0].result_available, true);
    const sessions = await listConsultantWorkflowSessions(
      s.pool,
      s.identity.account_id,
      1,
      s.identity.user_profile_id,
    );
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].run_id, s.identity.run_id);
    const refs = (await s.lookup()).observations;
    await withdrawPrivateEvidenceSource(
      s.pool,
      s.identity,
      refs[0].source_id,
      "Withdrawn",
    );
    const withdrawn = await listConsultantResearchSummaries(
      s.pool,
      s.identity.account_id,
      s.identity.user_profile_id,
    );
    assert.equal(withdrawn.length, 1);
    assert.equal(withdrawn[0].result_available, false);
    assert.equal(withdrawn[0].title, "Potassium hydroxide");
    const others = await listConsultantResearchSummaries(
      s.pool,
      s.identity.account_id,
      foreignProfile,
    );
    assert.equal(others.length, 1);
    assert.equal(others[0].run_id, foreignRun);
  },
);

dbTest(
  "profile-wide evidence search does not invent a category relationship",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const library = await searchPrivateEvidenceProfile(s.pool, {
      account_id: s.identity.account_id,
      user_profile_id: s.identity.user_profile_id,
    });
    assert.ok(library.observations.length > 0);
    assert.equal(
      Object.hasOwn(library.observations[0], "category_match"),
      false,
    );
  },
);

for (const [label, options, count, recency] of [
  ["recent price", { price_days: 2 }, 1, "under_7_days"],
  ["month fallback", { price_days: 20 }, 1, "under_30_days"],
  ["old price with freshly retrieved page", { price_days: 31 }, 0, null],
  ["undated price on a fresh page", { undated: true }, 0, null],
])
  dbTest(`pricing freshness: ${label}`, async (t) => {
    const s = await fixture(t);
    await s.capture(s.output(options));
    const found = await s.lookup({ purpose: "pricing" });
    assert.equal(found.observations.length, count);
    if (count) assert.equal(found.observations[0].recency, recency);
    else assert.equal(found.needs_refresh_count, 1);
  });

dbTest(
  "withdrawal revokes selected facts, dependent reports and restored older rights epochs",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const refs = (await s.lookup()).observations;
    const peer = await fixture(t);
    await peer.capture(peer.output());
    const use = await inTransaction(s.pool, async (c) => {
      const manifest = await createEvidenceUseManifest(
        c,
        s.identity,
        refs,
        "discovery",
      );
      await registerEvidenceDerivative(c, s.identity, manifest.manifest_id, {
        kind: "research_output",
        reference: s.identity.run_id,
      });
      return manifest;
    });
    await assertResearchOutputRights(s.pool, s.identity);
    await withdrawPrivateEvidenceSource(
      s.pool,
      s.identity,
      refs[0].source_id,
      "Source permission withdrawn",
    );
    assert.equal((await s.lookup()).observations.length, 0);
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        assertEvidenceUseManifest(c, s.identity, use.manifest_id),
      ),
      { code: "MB-409-PRIVATE-EVIDENCE" },
    );
    await assert.rejects(assertResearchOutputRights(s.pool, s.identity), {
      code: "MB-409-EVIDENCE-WITHDRAWN",
    });
    await assertResearchOutputRights(peer.pool, peer.identity);
    assert.equal((await peer.lookup()).observations.length, 2);
    assert.equal(
      (await listInvalidEvidenceDerivatives(s.pool, s.identity)).length,
      1,
    );
    await assert.rejects(
      withdrawPrivateEvidenceSource(
        s.pool,
        { ...s.identity, user_profile_id: randomUUID() },
        refs[0].source_id,
        "forged",
      ),
      { code: "MB-409-PRIVATE-EVIDENCE" },
    );
    await s.pool.query(
      "UPDATE consultant_private_source SET rights_state='active',rights_epoch=1 WHERE source_id=$1",
      [refs[0].source_id],
    );
    await inTransaction(s.pool, (c) =>
      applyPrivateEvidenceTombstones(c, s.identity),
    );
    assert.equal((await s.lookup()).observations.length, 0);
    await purgeWithdrawnPrivateEvidenceSource(
      s.pool,
      s.identity,
      refs[0].source_id,
    );
    assert.equal(
      (
        await s.pool.query(
          "SELECT count(*)::int AS n FROM consultant_private_observation WHERE account_id=$1",
          [s.identity.account_id],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(assertResearchOutputRights(s.pool, s.identity), {
      code: "MB-409-EVIDENCE-WITHDRAWN",
    });
  },
);

dbTest(
  "expired evidence cannot authorize new use but historical dated results remain readable",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const refs = (await s.lookup()).observations;
    await assertResearchOutputRights(s.pool, s.identity);
    const plan = {
      private_memory: {
        version: "private-memory.v1",
        observation_refs: refs,
        valid_until: ago(1),
      },
    };
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        assertQuotedPrivateMemoryAuthority(c, s.identity, plan),
      ),
      { code: "MB-409-MEMORY-REQUOTE" },
    );
    await assertResearchOutputRights(s.pool, s.identity);
    await assertResearchOutputRights(s.pool, {
      ...s.identity,
      user_profile_id: randomUUID(),
    });
  },
);

dbTest(
  "event invalidation overrides a fresh source and invalidates the original output",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const refs = (await s.lookup()).observations;
    await invalidatePrivateEvidenceObservation(
      s.pool,
      s.identity,
      refs[0].observation_id,
      "Issuer corrected the record",
    );
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        validatePrivateEvidenceSelection(c, s.identity, refs, "discovery"),
      ),
      { code: "MB-409-PRIVATE-EVIDENCE" },
    );
    await assert.rejects(assertResearchOutputRights(s.pool, s.identity), {
      code: "MB-409-EVIDENCE-WITHDRAWN",
    });
    const row = (
      await s.pool.query(
        "SELECT event_invalidated_at FROM consultant_private_output_provenance WHERE account_id=$1",
        [s.identity.account_id],
      )
    ).rows[0];
    assert.ok(row.event_invalidated_at);
  },
);

dbTest(
  "negative checks distinguish denial, expire, and never suppress new discovery",
  async (t) => {
    const s = await fixture(t);
    const scope = {
      query: "potassium",
      entity_key: null,
      jurisdiction: "China",
      language: "en",
      aliases_sha256: hashResearchAuthority([]),
      source_scope: "registry",
      renewal_generation: 0,
    };
    await savePrivateNegativeCheck(
      s.pool,
      s.identity,
      scope,
      "denied",
      ago(0),
      new Date(Date.now() + 3600000).toISOString(),
    );
    const found = await readPrivateNegativeChecks(s.pool, s.identity, scope);
    assert.equal(found.checks[0].outcome, "denied");
    assert.equal(found.may_suppress_fresh_discovery, false);
    assert.equal(
      (
        await readPrivateNegativeChecks(s.pool, s.identity, {
          ...scope,
          aliases_sha256: hashResearchAuthority(["new"]),
        })
      ).checks.length,
      0,
    );
    await s.capture(s.output());
    assert.equal(
      (await readPrivateNegativeChecks(s.pool, s.identity, scope)).checks
        .length,
      0,
    );
  },
);

dbTest(
  "renewal creates fresh identities while preserving original approval hashes and all parent costs",
  async (t) => {
    const s = await fixture(t);
    const payload = s.output();
    await s.capture(payload);
    const before = (
      await s.pool.query(
        "SELECT to_jsonb(s) AS row FROM consultant_workflow_session s WHERE run_id=$1",
        [s.identity.run_id],
      )
    ).rows[0].row;
    const history = await getLogicalResearchHistory(
      s.pool,
      s.identity,
      s.identity.run_id,
    );
    assert.equal(history.logical_request_root_id, null);
    assert.equal(history.can_renew, true);
    await s.pool.query(
      `INSERT INTO consultant_provider_call(request_id,account_id,user_profile_id,run_id,execution_id,classification_id,phase,detail)
    VALUES($1,$2,$3,$4,$5,$6,'research',$7)`,
      [
        randomUUID(),
        s.identity.account_id,
        s.identity.user_profile_id,
        s.identity.run_id,
        s.identity.execution_id,
        s.identity.classification_id,
        JSON.stringify({
          request_id: randomUUID(),
          model: "fixture",
          state: "completed",
          dispatched: true,
          is_byok: true,
          cost_reported: true,
          cost_usd: 0.1,
          upstream_inference_cost: 2,
        }),
      ],
    );
    const command = s.command();
    const child = await createLinkedResearchRenewal(
      s.pool,
      s.identity,
      command,
    );
    for (const key of ["run_id", "execution_id", "classification_id"])
      assert.notEqual(child[key], s.identity[key]);
    assert.equal(child.generation, 1);
    assert.equal(
      (await createLinkedResearchRenewal(s.pool, s.identity, command)).run_id,
      child.run_id,
    );
    const after = (
      await s.pool.query(
        "SELECT to_jsonb(s) AS row FROM consultant_workflow_session s WHERE run_id=$1",
        [s.identity.run_id],
      )
    ).rows[0].row;
    assert.deepEqual(after, before);
    const session = (
      await s.pool.query(
        "SELECT * FROM consultant_workflow_session WHERE run_id=$1",
        [child.run_id],
      )
    ).rows[0];
    assert.deepEqual(session.approved_request_revision, s.approved);
    assert.deepEqual(session.deep_prompt_revision, s.prompt);
    assert.deepEqual(session.approvals, []);
    assert.equal(session.current_state, "prep_step3_prompt_approved");
    assert.equal(session.workflow_metadata.fresh_cost_approval_required, true);
    const linked = await getLogicalResearchHistory(
      s.pool,
      s.identity,
      s.identity.run_id,
    );
    assert.equal(linked.runs.length, 2);
    assert.equal(linked.current_run_id, child.run_id);
    assert.equal(linked.cost_events[0].detail.upstream_inference_cost, 2);
    assert.equal(linked.can_renew, false);
    await assert.rejects(
      inTransaction(s.pool, (c) =>
        assertLogicalRequestFence(c, s.identity, s.identity.run_id, 0),
      ),
      { code: "MB-409-RESEARCH-RENEWAL" },
    );
    const childFence = await inTransaction(s.pool, (c) =>
      assertLogicalRequestRunFence(c, s.identity.account_id, child.run_id, 1),
    );
    assert.equal(childFence.generation, 1);
  },
);

dbTest(
  "a renewed child restores original approvals and completes a freshly approved fixture round with new identities",
  async (t) => {
    const s = await fixture(t);
    const app = await import("../../../packages/application/dist/index.js");
    const { consultantResearchInput } =
      await import("../../../packages/application/dist/research-context-preflight.js");
    const parent = await app.submitConsultantIntake(
      {
        account_id: s.identity.account_id,
        user_profile_id: s.identity.user_profile_id,
        product_requirement: "Brazil frozen whole chicken poultry",
        technical_compliance: "Halal certification",
        order_profile: "Delivery to Saudi Arabia",
      },
      s.pool,
      { mode: "demonstration" },
    );
    await app.approveInterpretationStep(parent.run_id, undefined, s.pool);
    await app.approveDeepPromptStep(parent.run_id, undefined, s.pool);
    async function completeFixtureRound(runId, expectedGeneration) {
      const restored = await app.getOrRestoreWorkflowSession(
        s.pool,
        s.identity.account_id,
        runId,
      );
      const input = consultantResearchInput(restored);
      assert.equal(input.deep_prompt, restored.step3_deep_prompt.prompt_text);
      const { plan } = await app.buildResearchRoundPlan({
        round_number: 1,
        depth: "simple",
        parent_round_id: null,
        request_hash: app.researchRequestHash(restored),
        focus_requirements: [],
        mode: "demonstration",
      });
      const bound = await app.quotePrivateResearchMemory(
        s.pool,
        restored,
        plan,
      );
      assert.equal(bound.logical_request_generation, expectedGeneration);
      const quoteId = await saveResearchQuote(s.pool, restored, bound);
      const approval = await approveResearchQuote(
        s.pool,
        s.identity.account_id,
        s.identity.user_profile_id,
        runId,
        quoteId,
        app.researchRequestHash(restored),
      );
      await app.getOrRestoreWorkflowSession(
        s.pool,
        s.identity.account_id,
        runId,
      );
      const claimed = await claimConsultantWorkflowJob(
        s.pool,
        approval.job.job_id,
      );
      const output = await app.executeConsultantWorkflowResearch(
        s.pool,
        runId,
        {
          executionFence: {
            job_id: claimed.job_id,
            lease_token: claimed.lease_token,
          },
        },
      );
      await finishConsultantWorkflowJob(s.pool, claimed);
      return { output, approval };
    }
    await completeFixtureRound(parent.run_id, 0);
    const original = await app.getOrRestoreWorkflowSession(
      s.pool,
      s.identity.account_id,
      parent.run_id,
    );
    const requestHash = hashResearchAuthority(
      original.approved_request_revision,
    );
    const promptHash = hashResearchAuthority(original.step3_deep_prompt);
    const before = (
      await s.pool.query(
        "SELECT to_jsonb(s) AS row FROM consultant_workflow_session s WHERE run_id=$1",
        [parent.run_id],
      )
    ).rows[0].row;
    const child = await createLinkedResearchRenewal(s.pool, s.identity, {
      parent_run_id: parent.run_id,
      expected_generation: 0,
      idempotency_key: randomUUID(),
      expected_request_hash: requestHash,
      expected_prompt_hash: promptHash,
      compatibility_version: "renewal.v1",
    });
    const restoredChild = await app.getOrRestoreWorkflowSession(
      s.pool,
      s.identity.account_id,
      child.run_id,
    );
    assert.equal(
      hashResearchAuthority(restoredChild.approved_request_revision),
      requestHash,
    );
    assert.equal(
      hashResearchAuthority(restoredChild.step3_deep_prompt),
      promptHash,
    );
    await assert.rejects(
      app.executeConsultantWorkflowResearch(s.pool, child.run_id),
      { code: "MB-409-ROUND-APPROVAL" },
    );
    const { output, approval } = await completeFixtureRound(child.run_id, 1);
    assert.equal(output.research_run_id, child.run_id);
    assert.equal(output.execution_id, approval.execution_id);
    assert.equal(output.classification_id, child.classification_id);
    assert.equal(output.user_profile_id, s.identity.user_profile_id);
    assert.notEqual(output.execution_id, original.execution_id);
    assert.notEqual(output.classification_id, original.classification_id);
    assert.equal(output.supplier_candidates.length, 20);
    const stored = (
      await s.pool.query(
        "SELECT document_payload FROM consultant_output_v3 WHERE account_id=$1 AND run_id=$2",
        [s.identity.account_id, child.run_id],
      )
    ).rows[0].document_payload;
    assert.equal(stored.execution_id, approval.execution_id);
    assert.equal(stored.research_run_id, child.run_id);
    assert.equal(
      (await getLogicalResearchHistory(s.pool, s.identity, child.run_id))
        .can_renew,
      true,
    );
    const after = (
      await s.pool.query(
        "SELECT to_jsonb(s) AS row FROM consultant_workflow_session s WHERE run_id=$1",
        [parent.run_id],
      )
    ).rows[0].row;
    assert.deepEqual(after, before);
    assert.equal(
      (
        await s.pool.query(
          "SELECT count(*)::int AS n FROM consultant_private_observation WHERE account_id=$1",
          [s.identity.account_id],
        )
      ).rows[0].n,
      0,
      "fixture output is never promoted into reusable real evidence",
    );
  },
);

dbTest(
  "competing renewal commands create one unchanged-scope child",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const attempts = await Promise.allSettled([
      createLinkedResearchRenewal(s.pool, s.identity, s.command()),
      createLinkedResearchRenewal(s.pool, s.identity, s.command()),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((r) => r.status === "rejected").length, 1);
    const count = (
      await s.pool.query(
        "SELECT count(*)::int AS n FROM consultant_research_lineage WHERE account_id=$1",
        [s.identity.account_id],
      )
    ).rows[0].n;
    assert.equal(count, 2);
  },
);

dbTest(
  "renewal rejects changed approvals, a foreign profile, active work and forged lineage parents",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    await assert.rejects(
      createLinkedResearchRenewal(s.pool, s.identity, {
        ...s.command(),
        expected_prompt_hash: hashResearchAuthority("changed"),
      }),
      { code: "MB-409-RESEARCH-RENEWAL" },
    );
    await assert.rejects(
      createLinkedResearchRenewal(
        s.pool,
        { ...s.identity, user_profile_id: randomUUID() },
        s.command(),
      ),
      { code: "MB-409-RESEARCH-RENEWAL" },
    );
    const root = await inTransaction(s.pool, (c) =>
      assertLogicalRequestFence(c, s.identity, s.identity.run_id),
    );
    await assert.rejects(
      s.pool.query(
        `INSERT INTO consultant_research_lineage(run_id,account_id,user_profile_id,logical_request_root_id,renews_run_id,renewal_ordinal,root_generation,adoption)
    VALUES($1,$2,$3,$4,$1,1,1,'{}')`,
        [
          randomUUID(),
          s.identity.account_id,
          s.identity.user_profile_id,
          root.logical_request_root_id,
        ],
      ),
      /parent/,
    );
    await s.pool.query(
      `INSERT INTO consultant_workflow_job(job_id,account_id,user_profile_id,run_id,execution_id,classification_id,stage,mode)
    VALUES($1,$2,$3,$4,$5,$6,'research','live')`,
      [
        randomUUID(),
        s.identity.account_id,
        s.identity.user_profile_id,
        s.identity.run_id,
        s.identity.execution_id,
        s.identity.classification_id,
      ],
    );
    assert.equal(
      (await getLogicalResearchHistory(s.pool, s.identity, s.identity.run_id))
        .can_renew,
      false,
    );
    await assert.rejects(
      createLinkedResearchRenewal(s.pool, s.identity, s.command()),
      { code: "MB-409-RESEARCH-RENEWAL" },
    );
  },
);

dbTest(
  "root fencing serializes a legacy mutation with initial renewal registration",
  async (t) => {
    const s = await fixture(t);
    await s.capture(s.output());
    const owner = await s.pool.connect();
    await owner.query("BEGIN");
    try {
      await assertLogicalRequestRunFence(
        owner,
        s.identity.account_id,
        s.identity.run_id,
        0,
      );
      const renewal = createLinkedResearchRenewal(
        s.pool,
        s.identity,
        s.command(),
      );
      await owner.query(
        `INSERT INTO consultant_workflow_job(job_id,account_id,user_profile_id,run_id,execution_id,classification_id,stage,mode)
      VALUES($1,$2,$3,$4,$5,$6,'research','live')`,
        [
          randomUUID(),
          s.identity.account_id,
          s.identity.user_profile_id,
          s.identity.run_id,
          s.identity.execution_id,
          s.identity.classification_id,
        ],
      );
      await owner.query("COMMIT");
      await assert.rejects(renewal, { code: "MB-409-RESEARCH-RENEWAL" });
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    } finally {
      owner.release();
    }
  },
);
