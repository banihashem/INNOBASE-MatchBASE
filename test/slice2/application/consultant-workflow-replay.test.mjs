import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  approveDeepPromptStep,
  approveInterpretationStep,
  getOrRestoreWorkflowSession,
  getWorkflowSession,
  queueConsultantWorkflowStep,
} from "../../../packages/application/dist/consultant-v3-service.js";

// Exercise production service functions with an in-memory Queryable. These tests
// never connect to PostgreSQL or call a provider.
function workflowFixture(state = "prep_step3_prompt_awaiting_approval") {
  const identity = {
    session_id: randomUUID(),
    account_id: randomUUID(),
    run_id: randomUUID(),
    user_profile_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
  };
  const timestamp = new Date();
  const row = {
    ...identity,
    current_state: state,
    original_intake: {
      product_requirement: "Industrial pump",
      technical_compliance: "",
      order_profile: "",
    },
    draft_revision: {
      revision_id: randomUUID(),
      english_translation: "Industrial pump",
      created_at: timestamp.toISOString(),
    },
    approved_request_revision: {
      revision_id: randomUUID(),
      english_translation: "Industrial pump",
      key_specifications: [],
      product_name: "Industrial pump",
      product_category: "pump",
    },
    deep_prompt_revision: {
      prompt_text: "Original generated prompt",
      discovery_criteria: [],
      evidence_thresholds: [],
      target_supplier_count: 20,
      is_approved: false,
    },
    classification: { classification_id: identity.classification_id },
    workflow_metadata: { mode: "demonstration" },
    created_at: timestamp,
    updated_at: timestamp,
    approvals: [],
  };
  const pendingResearchJob = {
    ...identity,
    job_id: randomUUID(),
    stage: "research",
    mode: "demonstration",
    status: "queued",
    lease_token: null,
  };
  const sessionWrites = [];
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT * FROM consultant_workflow_session")) {
        return { rows: [row] };
      }
      if (sql.includes("INSERT INTO consultant_workflow_job")) {
        return { rows: [] }; // Simulate the unique active-job conflict.
      }
      if (sql.includes("SELECT * FROM consultant_workflow_job")) {
        return { rows: [pendingResearchJob] };
      }
      if (sql.includes("INSERT INTO consultant_workflow_session")) {
        sessionWrites.push(params);
        return { rows: [] };
      }
      throw new Error(
        `Unexpected query in isolated service fixture: ${sql.slice(0, 80)}`,
      );
    },
  };
  return { identity, row, db, pendingResearchJob, sessionWrites };
}

test("MB-UX-LIVE-001 L01 replayed preparation cannot reset a queued research stage", async () => {
  const fixture = workflowFixture("research_dispatching");
  fixture.row.deep_prompt_revision.is_approved = true;
  await getOrRestoreWorkflowSession(
    fixture.db,
    fixture.identity.account_id,
    fixture.identity.run_id,
  );
  const job = await queueConsultantWorkflowStep(
    fixture.db,
    fixture.identity.run_id,
    "prepare",
  );
  assert.equal(job.job_id, fixture.pendingResearchJob.job_id);
  assert.equal(job.stage, "research");
  assert.equal(
    getWorkflowSession(fixture.identity.run_id).state,
    "research_dispatching",
  );
  assert.equal(
    fixture.sessionWrites.length,
    0,
    "another stage's job must never rewrite the session",
  );
});

test("MB-UX-LIVE-001 L01 explicit blank prompts are rejected without approving earlier text", async () => {
  for (const submittedText of ["", "   "]) {
    const fixture = workflowFixture();
    await getOrRestoreWorkflowSession(
      fixture.db,
      fixture.identity.account_id,
      fixture.identity.run_id,
    );
    await assert.rejects(
      approveDeepPromptStep(fixture.identity.run_id, submittedText),
      { status: 422 },
    );
    const session = getWorkflowSession(fixture.identity.run_id);
    assert.equal(session.step3_deep_prompt.is_approved, false);
    assert.equal(
      session.step3_deep_prompt.prompt_text,
      "Original generated prompt",
    );
    assert.equal(session.approvals.length, 0);
  }
});

test("MB-UX-LIVE-001 L01 explicit blank interpretations cannot approve the original translation", async () => {
  for (const submittedText of ["", "   "]) {
    const fixture = workflowFixture("prep_step1_awaiting_approval");
    fixture.row.approved_request_revision = null;
    await getOrRestoreWorkflowSession(
      fixture.db,
      fixture.identity.account_id,
      fixture.identity.run_id,
    );
    await assert.rejects(
      approveInterpretationStep(
        fixture.identity.run_id,
        submittedText,
        undefined,
        { defer_generation: true },
      ),
      { status: 422 },
    );
    assert.equal(
      getWorkflowSession(fixture.identity.run_id).approved_request_revision,
      null,
    );
  }
});
