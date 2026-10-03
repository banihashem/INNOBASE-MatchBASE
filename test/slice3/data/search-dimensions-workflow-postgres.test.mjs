import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  createPool,
  inTransaction,
  lockSearchDimensionSession,
  migrateUp,
  saveConsultantWorkflowSession,
} from "../../../packages/data/dist/index.js";
import {
  approveDeepPromptStep,
  assertSearchDimensionRevision,
  getOrRestoreWorkflowSession,
  hydrateSearchDimensions,
  researchRequestHash,
  saveConsultantSearchDimensions,
} from "../../../packages/application/dist/index.js";
import { verifySearchDimensionPlan } from "../../../packages/contracts/dist/src/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
(database ? test : test.skip)(
  "MB-SEARCH-DIMENSIONS-002 L01 saved configuration survives restore and binds serialized prompt approval",
  async (t) => {
    const pool = createPool({ connectionString: database, max: 5 });
    const account_id = randomUUID(),
      user_profile_id = randomUUID(),
      run_id = randomUUID(),
      execution_id = randomUUID(),
      classification_id = randomUUID();
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("No paid provider call is permitted by this fixture.");
    });
    await migrateUp(pool);
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'DIMENSIONS workflow isolated','active')",
      [account_id],
    );
    t.after(async () => {
      try {
        await pool.query(
          "DELETE FROM consultant_workflow_session WHERE account_id=$1",
          [account_id],
        );
        await pool.query("DELETE FROM account WHERE account_id=$1", [
          account_id,
        ]);
      } finally {
        await pool.end();
      }
    });
    await saveConsultantWorkflowSession(pool, {
      session_id: randomUUID(),
      account_id,
      user_profile_id,
      run_id,
      execution_id,
      current_state: "prep_step3_prompt_awaiting_approval",
      original_intake: {
        account_id,
        user_profile_id,
        product_requirement: "Ocean freight forwarding",
        technical_compliance: "",
        order_profile: "",
      },
      approved_request_revision: {
        revision_id: randomUUID(),
        english_translation: "Ocean freight forwarding",
        product_name: "Ocean freight forwarding",
        product_category: "Logistics",
        key_specifications: [],
        approved_at: new Date().toISOString(),
      },
      deep_prompt_revision: {
        prompt_text: "Research evidenced freight providers",
        discovery_criteria: [],
        evidence_thresholds: [],
        target_supplier_count: 20,
        is_approved: false,
      },
      classification: {
        classification_id,
        scheme: "CPC",
        code: "67910",
        version: "2.1",
      },
      approvals: [
        {
          step: "step1",
          approved_revision_id: randomUUID(),
          approved_at: new Date().toISOString(),
        },
      ],
      workflow_metadata: { mode: "demonstration", classification_id },
    });
    const initial = await getOrRestoreWorkflowSession(pool, account_id, run_id);
    await hydrateSearchDimensions(pool, initial);
    assert.equal(initial.search_dimension_revision, null);
    assert.ok(
      initial.search_dimensions.profile_ids.includes("logistics.ocean"),
    );
    const config = structuredClone(initial.search_dimensions);
    config.selections.find(
      (entry) => entry.dimension_id === "logistics.payment",
    ).active = false;
    const saved = await saveConsultantSearchDimensions(pool, {
      account_id,
      user_profile_id,
      run_id,
      expected_revision: null,
      configuration: config,
    });
    assert.ok(verifySearchDimensionPlan(saved.search_dimension_plan));
    const restored = await getOrRestoreWorkflowSession(
      pool,
      account_id,
      run_id,
    );
    assert.equal(
      restored.search_dimension_revision,
      saved.search_dimension_revision,
    );
    assert.deepEqual(restored.search_dimensions, saved.search_dimensions);
    assert.deepEqual(
      restored.search_dimension_plan,
      saved.search_dimension_plan,
    );
    await assert.rejects(
      saveConsultantSearchDimensions(pool, {
        account_id,
        user_profile_id,
        run_id,
        expected_revision: null,
        configuration: config,
      }),
      (error) => error.code === "MB-409-DIMENSIONS",
    );
    await assert.rejects(
      saveConsultantSearchDimensions(pool, {
        account_id,
        user_profile_id: randomUUID(),
        run_id,
        expected_revision: saved.search_dimension_revision,
        configuration: config,
      }),
      (error) => error.status === 404,
    );
    const before = researchRequestHash(restored);
    const approved = await inTransaction(pool, async (db) => {
      await lockSearchDimensionSession(db, account_id, user_profile_id, run_id);
      const current = await getOrRestoreWorkflowSession(db, account_id, run_id);
      assertSearchDimensionRevision(current, saved.search_dimension_revision);
      return approveDeepPromptStep(run_id, undefined, db, current);
    });
    assert.ok(approved.step3_deep_prompt.is_approved);
    assert.equal(
      approved.approved_request_revision.search_dimension_plan.plan_hash,
      saved.search_dimension_plan.plan_hash,
    );
    assert.notEqual(researchRequestHash(approved), before);
    const final = await getOrRestoreWorkflowSession(pool, account_id, run_id);
    assert.deepEqual(
      final.search_dimension_plan,
      approved.search_dimension_plan,
    );
    await assert.rejects(
      saveConsultantSearchDimensions(pool, {
        account_id,
        user_profile_id,
        run_id,
        expected_revision: saved.search_dimension_revision,
        configuration: config,
      }),
      (error) => error.code === "MB-409-DIMENSIONS",
    );
    const legacy = {
      approved_request_revision: { revision_id: "retained" },
      step3_deep_prompt: { prompt_text: "Retained approved prompt" },
    };
    assert.equal(
      researchRequestHash(legacy),
      createHash("sha256")
        .update(
          JSON.stringify([
            legacy.approved_request_revision,
            legacy.step3_deep_prompt,
          ]),
        )
        .digest("hex"),
    );
  },
);
