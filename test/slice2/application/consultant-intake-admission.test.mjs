import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  submitConsultantIntake,
  retryConsultantIntakeInterpretation,
} from "../../../packages/application/dist/consultant-v3-service.js";
import { LivePreparationModelGateway } from "../../../packages/application/dist/live-preparation.js";
import { saveConsultantDraftSession } from "../../../packages/data/dist/index.js";

// A transaction-aware SQL fixture exercises real admission/service code without
// opening a database or invoking an LLM. SQL shape assertions cover owner and CAS predicates.
function fixture() {
  const intake = {
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    product_requirement: "Industrial pumps",
    technical_compliance: "",
    order_profile: "",
  };
  const draft = {
    draft_id: randomUUID(),
    account_id: intake.account_id,
    user_profile_id: intake.user_profile_id,
    status: "active",
    draft_version: 2,
    current_run_id: null,
    snapshot_id: null,
    draft_data: {},
    created_at: new Date(),
    updated_at: new Date(),
  };
  let state = { draft, snapshots: new Map(), sessions: new Map() };
  const queries = [];
  let lastTransaction = Promise.resolve();
  let failInitialWrite = false;
  const query = async (sql, p = []) => {
    queries.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("FOR UPDATE")) {
      assert.match(
        sql,
        /draft_id=\$1 AND account_id=\$2 AND user_profile_id=\$3/,
      );
      return {
        rows:
          p[0] === state.draft.draft_id &&
          p[1] === state.draft.account_id &&
          p[2] === state.draft.user_profile_id
            ? [structuredClone(state.draft)]
            : [],
      };
    }
    if (sql.includes("INSERT INTO consultant_intake_snapshot")) {
      state.snapshots.set(p[0], [...p]);
      return { rows: [] };
    }
    if (
      sql.includes("UPDATE consultant_draft_session") &&
      sql.includes("draft_version=draft_version+1")
    ) {
      assert.match(
        sql,
        /status='active' AND current_run_id IS NULL AND draft_version=\$7/,
      );
      Object.assign(state.draft, {
        current_run_id: p[3],
        snapshot_id: p[4],
        draft_data: JSON.parse(p[5]),
        status: "submitted",
        draft_version: state.draft.draft_version + 1,
      });
      return { rows: [{ draft_version: state.draft.draft_version }] };
    }
    if (sql.includes("INSERT INTO consultant_workflow_session")) {
      assert.doesNotMatch(sql, /original_intake\s*=\s*EXCLUDED/);
      if (failInitialWrite)
        throw new Error("Synthetic transaction storage failure");
      const previous = state.sessions.get(p[2]);
      state.sessions.set(p[2], {
        session_id: p[0],
        account_id: p[1],
        run_id: p[2],
        user_profile_id: p[3],
        current_state: p[4],
        original_intake: previous?.original_intake ?? JSON.parse(p[5]),
        draft_revision: p[6] ? JSON.parse(p[6]) : null,
        approved_request_revision: p[7] ? JSON.parse(p[7]) : null,
        advisory_output: p[8] ? JSON.parse(p[8]) : null,
        deep_prompt_revision: p[10] ? JSON.parse(p[10]) : null,
        approvals: p[11] ? JSON.parse(p[11]) : [],
        classification: p[12] ? JSON.parse(p[12]) : null,
        execution_id: p[13],
        last_checkpoint: p[14],
        is_invalidated: p[15],
        workflow_metadata: JSON.parse(p[17]),
        created_at: new Date(),
        updated_at: new Date(),
      });
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM consultant_workflow_session"))
      return {
        rows: [...state.sessions.values()]
          .filter((row) => row.account_id === p[0] && row.run_id === p[1])
          .map((row) => structuredClone(row)),
      };
    if (sql.includes("UPDATE consultant_workflow_session")) {
      assert.match(
        sql,
        /account_id=\$1 AND user_profile_id=\$2 AND run_id=\$3/,
      );
      assert.match(sql, /current_state='workflow_failed'/);
      assert.match(sql, /approved_request_revision IS NULL/);
      assert.match(sql, /workflow_metadata->>'retry_action'='interpretation'/);
      const row = state.sessions.get(p[2]);
      if (
        !row ||
        row.account_id !== p[0] ||
        row.user_profile_id !== p[1] ||
        row.current_state !== "workflow_failed" ||
        row.approved_request_revision ||
        row.is_invalidated ||
        row.workflow_metadata.retry_action !== "interpretation"
      )
        return { rows: [] };
      Object.assign(row, {
        current_state: "prep_step1_interpreting",
        execution_id: p[3],
      });
      delete row.workflow_metadata.error;
      return { rows: [{ run_id: row.run_id }] };
    }
    if (
      sql.includes("FROM consultant_draft_session") &&
      sql.includes("current_run_id")
    )
      return {
        rows:
          state.draft.account_id === p[0] && state.draft.current_run_id === p[1]
            ? [structuredClone(state.draft)]
            : [],
      };
    if (sql.includes("SELECT draft_id, draft_version, account_id"))
      return { rows: [structuredClone(state.draft)] };
    if (sql.includes("UPDATE consultant_draft_session")) {
      assert.match(sql, /AND draft_version=\$9 AND status='active'/);
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM consultant_draft_session"))
      return { rows: [structuredClone(state.draft)] };
    if (sql.includes("INSERT INTO consultant_workflow_event"))
      return { rows: [] };
    throw new Error(`Unexpected isolated query: ${sql.slice(0, 100)}`);
  };
  const pool = {
    query,
    async connect() {
      const previous = lastTransaction;
      let release;
      lastTransaction = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const before = structuredClone(state);
      return {
        query: async (sql, p) => {
          if (sql === "ROLLBACK") state = before;
          return query(sql, p);
        },
        release,
      };
    },
  };
  const options = {
    mode: "live",
    draft: { draft_id: draft.draft_id, expected_version: 2 },
  };
  return {
    intake,
    pool,
    options,
    queries,
    get state() {
      return state;
    },
    failInitialWrite() {
      failInitialWrite = true;
    },
  };
}

const interpretation = {
  english_translation: "Industrial pumps",
  product_category: "Pumps",
  product_name: "Industrial pumps",
  explicit_requirements: [],
  mandatory_requirements: [],
  preferred_requirements: [],
  excluded_requirements: [],
  ambiguities: [],
  unknowns: [],
  suggested_clarifications: [],
  classification: {},
};

test("L03 submission rejects unknown owner and stale versions before interpretation", async (t) => {
  const model = t.mock.method(
    LivePreparationModelGateway.prototype,
    "extractAndInterpret",
    async () => interpretation,
  );
  for (const modify of [
    (f) => (f.intake.account_id = randomUUID()),
    (f) => (f.intake.user_profile_id = randomUUID()),
    (f) => (f.options.draft.draft_id = randomUUID()),
    (f) => (f.options.draft.expected_version = 1),
  ]) {
    const f = fixture();
    modify(f);
    await assert.rejects(
      submitConsultantIntake(f.intake, f.pool, f.options),
      (error) => [404, 409].includes(error.status),
    );
    assert.equal(f.state.snapshots.size, 0);
    assert.equal(f.state.sessions.size, 0);
  }
  assert.equal(model.mock.callCount(), 0);
});

test("L03 concurrent exact submissions share one persisted run and one interpretation", async (t) => {
  const f = fixture();
  let releaseModel;
  const blocked = new Promise((resolve) => {
    releaseModel = resolve;
  });
  const model = t.mock.method(
    LivePreparationModelGateway.prototype,
    "extractAndInterpret",
    async () => {
      assert.equal(f.queries.at(-1), "COMMIT");
      assert.equal(f.state.draft.status, "submitted");
      assert.equal(f.state.snapshots.size, 1);
      assert.equal(f.state.sessions.size, 1);
      await blocked;
      return interpretation;
    },
  );
  const first = submitConsultantIntake(f.intake, f.pool, f.options);
  const second = submitConsultantIntake(f.intake, f.pool, f.options);
  const replay = await second;
  assert.equal(replay.state, "prep_step1_interpreting");
  releaseModel();
  const completed = await first;
  assert.equal(replay.run_id, completed.run_id);
  assert.equal(model.mock.callCount(), 1);
  assert.equal(f.state.draft.draft_version, 3);
  assert.equal(completed.draft_version, 3);
  await assert.rejects(
    submitConsultantIntake(
      { ...f.intake, product_requirement: "Different pumps" },
      f.pool,
      f.options,
    ),
    { code: "MB-409-DRAFT-CONFLICT" },
  );
  await assert.rejects(
    submitConsultantIntake(f.intake, f.pool, {
      ...f.options,
      mode: "demonstration",
    }),
    { code: "MB-409-DRAFT-CONFLICT" },
  );
  assert.equal(model.mock.callCount(), 1);
});

test("L03 initial transaction failure rolls back draft claim and makes no model call", async (t) => {
  const f = fixture();
  f.failInitialWrite();
  const model = t.mock.method(
    LivePreparationModelGateway.prototype,
    "extractAndInterpret",
    async () => interpretation,
  );
  await assert.rejects(
    submitConsultantIntake(f.intake, f.pool, f.options),
    /Synthetic transaction storage failure/,
  );
  assert.equal(f.state.draft.status, "active");
  assert.equal(f.state.draft.current_run_id, null);
  assert.equal(f.state.snapshots.size, 0);
  assert.equal(model.mock.callCount(), 0);
});

test("L03 failed interpretation keeps immutable intake and only an explicit CAS retry dispatches", async (t) => {
  const f = fixture();
  let releaseRetry;
  const retryBlocked = new Promise((resolve) => {
    releaseRetry = resolve;
  });
  let calls = 0;
  t.mock.method(
    LivePreparationModelGateway.prototype,
    "extractAndInterpret",
    async () => {
      calls++;
      if (calls === 1)
        throw Object.assign(new Error("Synthetic model failure"), {
          code: "MB-502-INTERPRETATION",
        });
      await retryBlocked;
      return interpretation;
    },
  );
  let failure;
  await assert.rejects(
    submitConsultantIntake(f.intake, f.pool, f.options),
    (error) => {
      failure = error;
      return error.status === 502;
    },
  );
  assert.equal(failure.run_id, f.state.draft.current_run_id);
  assert.equal(failure.draft_id, f.options.draft.draft_id);
  assert.equal(failure.retry_action, "interpretation");
  const originalSnapshot = structuredClone([...f.state.snapshots.values()]);
  const replay = await submitConsultantIntake(f.intake, f.pool, f.options);
  assert.equal(replay.state, "workflow_failed");
  assert.equal(replay.retry_action, "interpretation");
  assert.equal(
    calls,
    1,
    "a submit replay must never retry a failed paid operation",
  );
  await assert.rejects(
    retryConsultantIntakeInterpretation(
      f.pool,
      f.intake.account_id,
      randomUUID(),
      failure.run_id,
    ),
    { code: "MB-409-INTERPRETATION-RETRY" },
  );
  const retry = retryConsultantIntakeInterpretation(
    f.pool,
    f.intake.account_id,
    f.intake.user_profile_id,
    failure.run_id,
  );
  await assert.rejects(
    retryConsultantIntakeInterpretation(
      f.pool,
      f.intake.account_id,
      f.intake.user_profile_id,
      failure.run_id,
    ),
    { code: "MB-409-INTERPRETATION-RETRY" },
  );
  releaseRetry();
  const completed = await retry;
  assert.equal(completed.run_id, failure.run_id);
  assert.notEqual(completed.execution_id, failure.execution_id);
  assert.deepEqual(completed.intake, f.intake);
  assert.deepEqual([...f.state.snapshots.values()], originalSnapshot);
  assert.equal(f.state.draft.draft_version, 3);
  assert.equal(calls, 2);
});

test("L03 ordinary draft saving cannot overwrite a submitted draft", async (t) => {
  const f = fixture();
  t.mock.method(
    LivePreparationModelGateway.prototype,
    "extractAndInterpret",
    async () => interpretation,
  );
  await submitConsultantIntake(f.intake, f.pool, f.options);
  for (const status of ["active", "submitted"])
    await assert.rejects(
      saveConsultantDraftSession(
        f.pool,
        {
          ...f.state.draft,
          status,
          draft_data: { product_requirement: "Replacement" },
        },
        3,
      ),
      { code: "MB-409-DRAFT-CONFLICT" },
    );
  assert.equal(
    f.state.draft.draft_data.product_requirement,
    f.intake.product_requirement,
  );
});
