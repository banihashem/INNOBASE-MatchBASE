import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  approveDeepPromptStep,
  approveInterpretationStep,
  assertSearchDimensionRevision,
  getOrRestoreWorkflowSession,
  hydrateSearchDimensions,
} from "../../../packages/application/dist/index.js";
import {
  compileSearchDimensionPlan,
  createSearchDimensionConfiguration,
  hashSearchDimensionConfiguration,
  verifySearchDimensionPlan,
} from "../../../packages/contracts/dist/src/index.js";

for (const stage of ["step1", "step3"])
  for (const saved of [false, true]) {
    test(`MB-SEARCH-DIMENSIONS-002 L01 ${stage} approval freezes the checked object after concurrent cache replacement (${saved ? "saved" : "new"})`, async () => {
      const run_id = randomUUID(),
        account_id = randomUUID(),
        user_profile_id = randomUUID(),
        classification_id = randomUUID();
      const definition = {
        id: "custom.route_check",
        revision: 1,
        label: "Route check",
        description: "Investigate service route evidence.",
        kind: "capability",
        value_type: "text",
        profile_ids: ["logistics.ocean"],
        default_active: true,
        default_severity: "preferred",
        applicability: "always",
        locked: false,
        allowed_operators: ["research", "equals"],
        owner_scope: { account_id, user_profile_id },
      };
      const configuration = createSearchDimensionConfiguration({
        text: "Industrial pumps",
      });
      const plan = compileSearchDimensionPlan(configuration, {
        owner_scope: { account_id, user_profile_id },
        primary_classification_id: classification_id,
        original_buyer_intent: "Industrial pumps",
      });
      const revision = hashSearchDimensionConfiguration(configuration);
      const row = {
        session_id: randomUUID(),
        run_id,
        account_id,
        user_profile_id,
        execution_id: randomUUID(),
        current_state:
          stage === "step1"
            ? "prep_step1_awaiting_approval"
            : "prep_step3_prompt_awaiting_approval",
        original_intake: {
          account_id,
          user_profile_id,
          product_requirement: "Industrial pumps",
          technical_compliance: "",
          order_profile: "",
        },
        draft_revision: {
          revision_id: randomUUID(),
          english_translation: "Industrial pumps",
          created_at: new Date().toISOString(),
        },
        approved_request_revision:
          stage === "step1"
            ? null
            : {
                revision_id: randomUUID(),
                english_translation: "Industrial pumps",
                product_name: "Industrial pumps",
                product_category: "Pumps",
                key_specifications: [],
                approved_at: new Date().toISOString(),
              },
        classification: {
          classification_id,
          scheme: "CPC",
          version: "2.1",
          code: "67910",
        },
        deep_prompt_revision:
          stage === "step1"
            ? null
            : {
                prompt_text: "Research Industrial pumps",
                discovery_criteria: [],
                evidence_thresholds: [],
                target_supplier_count: 20,
                is_approved: false,
              },
        workflow_metadata: {
          mode: "demonstration",
          ...(saved
            ? {
                search_dimensions: configuration,
                search_dimension_plan: plan,
                search_dimension_revision: revision,
              }
            : {}),
        },
        created_at: new Date(),
        updated_at: new Date(),
        approvals: [],
      };
      let catalogueResolve;
      const catalogue = new Promise((resolve) => {
        catalogueResolve = resolve;
      });
      const writes = [];
      const db = {
        async query(sql, params) {
          if (sql.includes("SELECT * FROM consultant_workflow_session"))
            return { rows: [structuredClone(row)] };
          if (sql.includes("SELECT DISTINCT ON"))
            return { rows: await catalogue };
          if (sql.includes("INSERT INTO consultant_workflow_session")) {
            writes.push(params);
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO consultant_workflow_event"))
            return { rows: [] };
          throw new Error(`Unexpected fixture query: ${sql.slice(0, 80)}`);
        },
      };
      const checked = await getOrRestoreWorkflowSession(db, account_id, run_id);
      assertSearchDimensionRevision(checked, saved ? revision : null);
      const hydration = hydrateSearchDimensions(db, checked);
      // An older independent GET finishes after the transaction loaded its authority.
      const previous = row.workflow_metadata;
      row.workflow_metadata = { mode: "demonstration" };
      const replacement = await getOrRestoreWorkflowSession(
        db,
        account_id,
        run_id,
      );
      row.workflow_metadata = previous;
      catalogueResolve([{ definition }]);
      await hydration;
      const approved =
        stage === "step1"
          ? await approveInterpretationStep(run_id, undefined, db, {
              defer_generation: true,
              transaction_session: checked,
            })
          : await approveDeepPromptStep(run_id, undefined, db, checked);
      assert.equal(approved, checked);
      assert.notEqual(approved, replacement);
      assert.ok(verifySearchDimensionPlan(approved.search_dimension_plan));
      assert.equal(
        approved.approved_request_revision.search_dimension_plan.plan_hash,
        approved.search_dimension_plan.plan_hash,
      );
      if (saved) assert.equal(approved.search_dimension_revision, revision);
      else {
        assert.ok(
          approved.search_dimensions.profile_ids.includes("logistics.ocean"),
        );
        assert.ok(
          approved.search_dimensions.custom_definitions.some(
            (entry) => entry.id === definition.id,
          ),
        );
      }
      assert.ok(
        writes.some((params) =>
          params.some(
            (value) =>
              typeof value === "string" &&
              value.includes('"search_dimension_plan"'),
          ),
        ),
      );
    });
  }
