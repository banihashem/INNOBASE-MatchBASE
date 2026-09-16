import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConsultantIncidentRecovery,
  classifyConsultantIncident,
} from "../../../packages/application/dist/consultant-incident-controller.js";
import { randomUUID } from "node:crypto";
test("L05 actual provider restriction shapes remain authority blocks despite retryable flags", () => {
  for (const field of ["provider_http_failure", "provider_failure"]) {
    for (const category of [
      "authentication",
      "billing",
      "privacy",
      "permission",
      "refusal",
    ]) {
      const value = classifyConsultantIncident(
        {
          code: "MB-502-LIVE-PROVIDER",
          retryable: true,
          [field]: { category, http_status: 403 },
        },
        false,
        true,
      );
      assert.equal(value.disposition, "blocked_by_authority");
    }
  }
  assert.equal(
    classifyConsultantIncident({
      code: "MB-502-LIVE-PROVIDER",
      retryable: true,
      provider_failure: { category: "unknown", http_status: 401 },
    }).disposition,
    "blocked_by_authority",
  );
});
test("L05 retained ambiguous effects override ordinary recovery without granting replay", () => {
  assert.equal(
    classifyConsultantIncident({ code: "MB-422-LIVE-JSON" }, false, true)
      .disposition,
    "outcome_unknown",
  );
  assert.equal(
    classifyConsultantIncident(new Error("private request content")).code,
    "UNCLASSIFIED",
  );
  assert.equal(
    classifyConsultantIncident({}, true, true).disposition,
    "cancelled",
  );
  assert.equal(
    classifyConsultantIncident({
      code: "MB-409-MEMORY-REQUOTE",
      retryable: true,
    }).disposition,
    "blocked_by_authority",
  );
});

test("MB-UX-QUALITY-001 L19 publishes a bounded approval decision when same-execution recovery is unavailable", async () => {
  const job = {
    job_id: randomUUID(),
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
    stage: "research",
    mode: "live",
    status: "failed",
    lease_token: null,
  };
  const writes = [];
  const db = {
    async query(sql, params) {
      writes.push({ sql, params });
      if (sql.includes("UPDATE consultant_workflow_session"))
        return { rows: [{ run_id: job.run_id }] };
      if (sql.includes("INSERT INTO consultant_workflow_event"))
        return { rows: [] };
      assert.fail(`Unexpected SQL: ${sql}`);
    },
  };
  assert.equal(
    await applyConsultantIncidentRecovery(db, job, "research", {
      code: "MB-502-LIVE-PROVIDER",
      disposition: "blocked_by_authority",
    }),
    "approval_required",
  );
  assert.equal(writes.length, 2);
  assert.match(writes[0].sql, /current_state='workflow_failed'/);
  assert.match(writes[0].sql, /last_checkpoint=\$6::text/);
  assert.match(writes[0].sql, /'phase',\$6::text/);
  assert.match(writes[0].sql, /'message',\$7::text/);
  assert.equal(writes[0].params[5], "approval_required");
  assert.match(writes[0].params[6], /current cost estimate/i);
  assert.equal(writes[1].params[5], "incident_recovery_decision");
  const eventDetail = JSON.parse(writes[1].params[6]);
  assert.equal(eventDetail.fault_code, "MB-502-LIVE-PROVIDER");
});

test("MB-UX-QUALITY-001 L19 sanitizes the incident code in the recovery audit event", async () => {
  const job = {
    job_id: randomUUID(),
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
    stage: "research",
    mode: "live",
    status: "failed",
    lease_token: null,
  };
  const writes = [];
  const db = {
    async query(sql, params) {
      writes.push({ sql, params });
      if (sql.includes("UPDATE consultant_workflow_session"))
        return { rows: [{ run_id: job.run_id }] };
      if (sql.includes("INSERT INTO consultant_workflow_event"))
        return { rows: [] };
      assert.fail(`Unexpected SQL: ${sql}`);
    },
  };
  assert.equal(
    await applyConsultantIncidentRecovery(db, job, "research", {
      code: "raw-provider-secret-category",
      disposition: "incident_required",
    }),
    "technical_review_required",
  );
  const eventDetail = JSON.parse(writes[1].params[6]);
  assert.equal(eventDetail.fault_code, "UNCLASSIFIED");
  assert.doesNotMatch(writes[1].params[6], /raw-provider-secret-category/);
});

test("MB-UX-QUALITY-001 L19 does not alter a stale or cancelled execution", async () => {
  const job = {
    job_id: randomUUID(),
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
    stage: "research",
    mode: "live",
    status: "failed",
    lease_token: null,
  };
  const db = {
    async query(sql) {
      if (sql.includes("UPDATE consultant_workflow_session"))
        return { rows: [] };
      assert.fail(`Unexpected SQL: ${sql}`);
    },
  };
  assert.equal(
    await applyConsultantIncidentRecovery(db, job, "research", {
      code: "execution-lease-lost",
      disposition: "cancelled",
    }),
    "cancelled",
  );
  assert.equal(
    await applyConsultantIncidentRecovery(db, job, "research", {
      code: "MB-502-LIVE-PROVIDER",
      disposition: "incident_required",
    }),
    "stale",
  );
});
