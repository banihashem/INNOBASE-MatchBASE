import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPool,
  enqueueConsultantWorkflowJob,
  inTransaction,
  listOwnedSearchDimensionDefinitions,
  lockSearchDimensionSession,
  migrateUp,
  saveConsultantWorkflowSession,
  saveOwnedSearchDimensionDefinitions,
} from "../../../packages/data/dist/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;

async function fixture(t) {
  // createPool refuses non-disposable or non-loopback test targets before connecting.
  const pool = createPool({ connectionString: database, max: 6 });
  const identity = {
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
    category_key: "test:industrial-pumps:v1",
  };
  await migrateUp(pool);
  await pool.query(
    "INSERT INTO account(account_id,display_name,status) VALUES($1,'DIMENSIONS002 isolated fixture','active')",
    [identity.account_id],
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
  const session = (owner = identity) => ({
    ...owner,
    session_id: randomUUID(),
    current_state: "prep_step3_prompt_awaiting_approval",
    original_intake: { product_requirement: "Isolated industrial pumps" },
    approved_request_revision: {
      revision_id: randomUUID(),
      english_translation: "Isolated industrial pumps",
    },
    deep_prompt_revision: {
      is_approved: false,
      prompt_text: "Isolated pump research",
    },
    classification: {
      classification_id: owner.classification_id,
      scheme: "HS",
      code: "8413",
      version: "2022",
    },
    workflow_metadata: {
      mode: "demonstration",
      classification_id: owner.classification_id,
    },
  });
  await saveConsultantWorkflowSession(pool, session());
  const definition = (id = "custom.material", extra = {}) => ({
    id,
    revision: 1,
    label: "Wetted material",
    description: "Verify the offered material.",
    kind: "capability",
    value_type: "text",
    profile_ids: ["industrial.pumps"],
    default_active: false,
    default_severity: "preferred",
    applicability: "always",
    locked: false,
    allowed_operators: ["research", "equals"],
    owner_scope: {
      account_id: identity.account_id,
      user_profile_id: identity.user_profile_id,
    },
    ...extra,
  });
  const save = (definitions, owner = identity) =>
    inTransaction(pool, (db) =>
      saveOwnedSearchDimensionDefinitions(db, owner, definitions),
    );
  const lock = (owner = identity) =>
    inTransaction(pool, (db) =>
      lockSearchDimensionSession(
        db,
        owner.account_id,
        owner.user_profile_id,
        owner.run_id,
      ),
    );
  return { pool, identity, session, definition, save, lock };
}

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 private catalogue isolates owners/categories and appends revisions",
  async (t) => {
    const { pool, identity, definition, save } = await fixture(t);
    const original = definition();
    assert.deepEqual(await save([original]), [original]);
    assert.deepEqual(await save([original]), [original]);
    const [second] = await save([
      { ...original, label: "Qualified wetted material" },
    ]);
    assert.equal(second.revision, 2);
    assert.deepEqual(
      await listOwnedSearchDimensionDefinitions(pool, identity),
      [second],
    );
    for (const change of [
      { account_id: randomUUID() },
      { user_profile_id: randomUUID() },
      { category_key: "other-category" },
    ])
      assert.deepEqual(
        await listOwnedSearchDimensionDefinitions(pool, {
          ...identity,
          ...change,
        }),
        [],
      );
    const rows = await pool.query(
      "SELECT revision,definition,run_id,execution_id,classification_id FROM consultant_search_dimension_revision WHERE account_id=$1 ORDER BY revision",
      [identity.account_id],
    );
    assert.equal(rows.rows.length, 2);
    assert.deepEqual(rows.rows[0].definition, original);
    for (const row of rows.rows) {
      assert.equal(row.run_id, identity.run_id);
      assert.equal(row.execution_id, identity.execution_id);
      assert.equal(row.classification_id, identity.classification_id);
    }
    await assert.rejects(save([original]), { status: 409 });
    await assert.rejects(
      pool.query(
        "UPDATE consultant_search_dimension_revision SET definition=jsonb_set(definition,'{label}','\"Tampered\"') WHERE account_id=$1",
        [identity.account_id],
      ),
      /immutable/,
    );
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 definition provenance and ownership reject substitution",
  async (t) => {
    const { pool, identity, definition, save, lock } = await fixture(t);
    await assert.rejects(lock({ ...identity, user_profile_id: randomUUID() }), {
      status: 404,
    });
    await assert.rejects(lock({ ...identity, account_id: randomUUID() }), {
      status: 404,
    });
    for (const field of ["execution_id", "classification_id"])
      await assert.rejects(
        save([definition()], { ...identity, [field]: randomUUID() }),
        { status: 409 },
      );
    await assert.rejects(
      save([
        definition("custom.bad", {
          owner_scope: {
            account_id: identity.account_id,
            user_profile_id: randomUUID(),
          },
        }),
      ]),
      { status: 422 },
    );
    const original = definition();
    await assert.rejects(
      pool.query(
        `INSERT INTO consultant_search_dimension_revision
    (account_id,user_profile_id,category_key,dimension_id,revision,run_id,execution_id,classification_id,definition)
    VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)`,
        [
          identity.account_id,
          identity.user_profile_id,
          identity.category_key,
          original.id,
          identity.run_id,
          randomUUID(),
          identity.classification_id,
          JSON.stringify(original),
        ],
      ),
      /provenance/,
    );
    assert.deepEqual(
      await listOwnedSearchDimensionDefinitions(pool, identity),
      [],
    );
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 mutation gates reject approved prompts, active jobs and quoted rounds",
  async (t) => {
    const { pool, identity, lock } = await fixture(t);
    await pool.query(
      "UPDATE consultant_workflow_session SET current_state='prep_step1_awaiting_approval',approved_request_revision=NULL WHERE run_id=$1",
      [identity.run_id],
    );
    assert.equal((await lock()).current_state, "prep_step1_awaiting_approval");
    await pool.query(
      "UPDATE consultant_workflow_session SET current_state='prep_step1_approved' WHERE run_id=$1",
      [identity.run_id],
    );
    await assert.rejects(lock(), { status: 409 });
    await pool.query(
      "UPDATE consultant_workflow_session SET current_state='prep_step1_awaiting_approval',deep_prompt_revision='{" +
        '"is_approved":true' +
        "}'::jsonb WHERE run_id=$1",
      [identity.run_id],
    );
    await assert.rejects(lock(), { status: 409 });
    await pool.query(
      "UPDATE consultant_workflow_session SET deep_prompt_revision=NULL WHERE run_id=$1",
      [identity.run_id],
    );
    await enqueueConsultantWorkflowJob(
      pool,
      identity,
      "prepare",
      "demonstration",
    );
    await assert.rejects(lock(), { status: 409 });
    await pool.query(
      "UPDATE consultant_workflow_job SET status='completed' WHERE run_id=$1",
      [identity.run_id],
    );
    await pool.query(
      `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan)
    VALUES($1,$2,$3,$4,$5,1,'{}')`,
      [
        randomUUID(),
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.classification_id,
      ],
    );
    await assert.rejects(lock(), { status: 409 });
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 catalogue and session mutation roll back atomically",
  async (t) => {
    const { pool, identity, definition } = await fixture(t);
    await assert.rejects(
      inTransaction(pool, async (db) => {
        await saveOwnedSearchDimensionDefinitions(db, identity, [definition()]);
        await db.query(
          "UPDATE consultant_workflow_session SET workflow_metadata=workflow_metadata || '{\"should_rollback\":true}'::jsonb WHERE run_id=$1",
          [identity.run_id],
        );
        throw new Error("Isolated transaction abort");
      }),
      /Isolated transaction abort/,
    );
    assert.deepEqual(
      await listOwnedSearchDimensionDefinitions(pool, identity),
      [],
    );
    const row = await pool.query(
      "SELECT workflow_metadata FROM consultant_workflow_session WHERE run_id=$1",
      [identity.run_id],
    );
    assert.equal(row.rows[0].workflow_metadata.should_rollback, undefined);
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 concurrent edits from separate sessions serialize catalogue revisions",
  async (t) => {
    const { pool, identity, session, definition, save } = await fixture(t);
    const other = {
      ...identity,
      run_id: randomUUID(),
      execution_id: randomUUID(),
      classification_id: randomUUID(),
    };
    await saveConsultantWorkflowSession(pool, session(other));
    const original = definition();
    await save([original]);
    const results = await Promise.allSettled([
      save([{ ...original, label: "First concurrent change" }]),
      save([{ ...original, label: "Second concurrent change" }], other),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const failed = results.find((result) => result.status === "rejected");
    assert.equal(failed.reason.status, 409);
    const rows = await pool.query(
      "SELECT revision FROM consultant_search_dimension_revision WHERE account_id=$1 ORDER BY revision",
      [identity.account_id],
    );
    assert.deepEqual(
      rows.rows.map((row) => row.revision),
      [1, 2],
    );
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 waiting mutations recheck prompt approval after the session lock",
  async (t) => {
    const { pool, identity } = await fixture(t);
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await lockSearchDimensionSession(
        first,
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
      );
      const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      const waiting = lockSearchDimensionSession(
        second,
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
      );
      const outcome = assert.rejects(waiting, { status: 409 });
      let observedWait = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const status = await pool.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [pid],
        );
        if (status.rows[0]?.wait_event_type === "Lock") {
          observedWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        observedWait,
        true,
        "Second mutation must wait on the transaction authority lock",
      );
      await first.query(
        "UPDATE consultant_workflow_session SET deep_prompt_revision=jsonb_set(deep_prompt_revision,'{is_approved}','true') WHERE run_id=$1",
        [identity.run_id],
      );
      await first.query("COMMIT");
      await outcome;
    } finally {
      await first.query("ROLLBACK");
      await second.query("ROLLBACK");
      first.release();
      second.release();
    }
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 private category capacity and payload bounds are enforced",
  async (t) => {
    const { pool, identity, definition, save } = await fixture(t);
    await assert.rejects(save([definition(), definition()]), { status: 422 });
    await assert.rejects(
      save([definition("custom.too_large", { description: "x".repeat(9000) })]),
      { status: 422 },
    );
    await save(
      Array.from({ length: 16 }, (_, i) => definition(`custom.item_${i}`)),
    );
    await assert.rejects(save([definition("custom.seventeenth")]), {
      status: 422,
    });
    assert.equal(
      (await listOwnedSearchDimensionDefinitions(pool, identity)).length,
      16,
    );
    const differentCategory = {
      ...identity,
      category_key: "different-category",
    };
    await save([definition()], differentCategory);
    assert.equal(
      (await listOwnedSearchDimensionDefinitions(pool, differentCategory))
        .length,
      1,
    );
  },
);

dbTest(
  "MB-SEARCH-DIMENSIONS-002 L01 additive migration round trip preserves historical workflow records",
  async (t) => {
    const { pool, identity } = await fixture(t);
    const before = await pool.query(
      "SELECT to_jsonb(s) AS record FROM consultant_workflow_session s WHERE run_id=$1",
      [identity.run_id],
    );
    const base = new URL("../../../packages/data/migrations/", import.meta.url);
    const down = await readFile(
      new URL("0028_consultant_search_dimensions.down.sql", base),
      "utf8",
    );
    const up = await readFile(
      new URL("0028_consultant_search_dimensions.up.sql", base),
      "utf8",
    );
    await inTransaction(pool, async (db) => {
      await db.query(down);
      await db.query(up);
    });
    const after = await pool.query(
      "SELECT to_jsonb(s) AS record FROM consultant_workflow_session s WHERE run_id=$1",
      [identity.run_id],
    );
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual(
      await listOwnedSearchDimensionDefinitions(pool, identity),
      [],
    );
  },
);
