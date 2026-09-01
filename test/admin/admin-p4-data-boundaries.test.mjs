import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AdminAuditApplication,
  ApplicationFault,
} from "../../packages/application/dist/index.js";

import {
  ADMIN_AUDIT_RELEASED_FIELDS,
  ADMIN_UNPROJECTED_RESULT_FIELDS,
  aggregateGuardrailActivations,
  exportAdminAuditEvents,
  readAdminAuditEvents,
  readAdminUnprojectedResult,
  recordGuardrailEvaluation,
} from "../../packages/data/dist/index.js";

const accountId = randomUUID();
const actorUserId = randomUUID();
const runId = randomUUID();
const correlationId = "p4-boundary-correlation";
const deploymentId = "p4-boundary-deployment";

function poolFor({ role, events = [], unprojected = null, metrics = [] }) {
  const statements = [];
  const client = {
    statements,
    release() {},
    async query(text, values = []) {
      statements.push({ text, values });
      if (/^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(text.trim())) {
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT eg\.tier/u.test(text)) {
        return { rows: [{ tier: "admin" }], rowCount: 1 };
      }
      if (/SELECT sub_role/u.test(text)) {
        return {
          rows: role ? [{ sub_role: role }] : [],
          rowCount: role ? 1 : 0,
        };
      }
      if (/SELECT audit_id,occurred_at,account_id/u.test(text)) {
        return { rows: events, rowCount: events.length };
      }
      if (/SELECT account_id,run_id,outcome,eligible_count/u.test(text)) {
        return {
          rows: unprojected ? [unprojected] : [],
          rowCount: unprojected ? 1 : 0,
        };
      }
      if (/guardrail_identifier/u.test(text) && /GROUP BY/u.test(text)) {
        return { rows: metrics, rowCount: metrics.length };
      }
      if (/INSERT INTO audit_event/u.test(text)) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return {
    statements,
    async query(text, values = []) {
      return client.query(text, values);
    },
    async connect() {
      return client;
    },
    async end() {},
  };
}

function input(overrides = {}) {
  return {
    accountId,
    actorUserId,
    correlationId,
    deploymentId,
    ...overrides,
  };
}

for (const role of [
  null,
  "support",
  "analyst",
  "consultant_manager",
  "product",
  "super_admin",
]) {
  test(`TASK142 ${role ?? "no-sub-role"} raw audit read/export denial is durable and content-free`, async () => {
    for (const operation of ["read", "export"]) {
      const pool = poolFor({ role });
      const result =
        operation === "read"
          ? await readAdminAuditEvents(
              pool,
              input({ limit: 25, cursor: null, resourceId: runId }),
            )
          : await exportAdminAuditEvents(
              pool,
              input({ maximumRows: 100, resourceId: runId }),
            );
      assert.deepEqual(result, {
        status: 403,
        reason: "security-audit-required",
      });
      const insert = pool.statements.find(({ text }) =>
        /INSERT INTO audit_event/u.test(text),
      );
      assert.ok(insert);
      assert.equal(
        insert.values[5],
        operation === "read" ? "audit.read_denied" : "audit.export_denied",
      );
      assert.deepEqual(insert.values[10], []);
      assert.equal(insert.values[7], runId);
      assert.equal(JSON.stringify(result).includes("audit_id"), false);
    }
  });
}

for (const role of [
  null,
  "support",
  "analyst",
  "consultant_manager",
  "product",
  "super_admin",
]) {
  test(`TASK142 ${role ?? "no-sub-role"} application refusal has the exact neutral raw body`, async () => {
    for (const operation of ["read", "export"]) {
      const application = new AdminAuditApplication(
        poolFor({ role }),
        Buffer.alloc(32, 9),
      );
      const context = {
        accountId,
        userId: actorUserId,
        tier: "admin",
        adminSubRoles: role ? [role] : [],
        correlationId,
        deploymentId,
      };
      let fault;
      try {
        if (operation === "read") {
          await application.read(context, { limit: 25 });
        } else {
          await application.export(context, { limit: 10_000 });
        }
      } catch (error) {
        fault = error;
      }
      assert.ok(fault instanceof ApplicationFault);
      const body = {
        type: `about:matchbase/errors/${fault.typeSuffix}`,
        title: "Forbidden",
        status: fault.status,
        code: fault.code,
        detail: fault.message,
        correlation_id: correlationId,
        retryable: fault.retryable,
        errors: [],
      };
      assert.deepEqual(body, {
        type: "about:matchbase/errors/audit-role-required",
        title: "Forbidden",
        status: 403,
        code: "MB-403-AUDIT",
        detail: "The audit resource is not visible.",
        correlation_id: correlationId,
        retryable: false,
        errors: [],
      });
      assert.equal(
        /audit_id|event_type|justification|actor_user_id/u.test(
          JSON.stringify(body),
        ),
        false,
      );
    }
  });
}

test("TASK142 security_audit receives filtered rows and every read/export writes its own immutable event", async () => {
  const occurredAt = new Date("2026-08-29T10:00:00.000Z");
  const event = {
    audit_id: randomUUID(),
    occurred_at: occurredAt,
    account_id: accountId,
    actor_user_id: actorUserId,
    actor_tier: "admin",
    actor_admin_sub_role: "security_audit",
    on_behalf_of_user_id: null,
    event_type: "projection.served",
    resource_kind: "research_run",
    resource_id: runId,
    outcome: "allow",
    projection_version_id: null,
    fields_released: ["candidates"],
    justification: null,
    request_correlation_id: "existing",
    deployment_id: "existing",
    detail: {},
    event_schema_version: 1,
  };
  const readPool = poolFor({ role: "security_audit", events: [event] });
  const read = await readAdminAuditEvents(
    readPool,
    input({ limit: 10, cursor: null, subjectUserId: actorUserId }),
  );
  assert.equal(read.status, 200);
  assert.deepEqual(read.items, [event]);
  assert.deepEqual(
    readPool.statements
      .find(({ text }) => /FROM audit_event/u.test(text))
      .values.slice(1, 5),
    [actorUserId, null, null, null],
  );
  const readInsert = readPool.statements.find(
    ({ text, values }) =>
      /INSERT INTO audit_event/u.test(text) && values[5] === "audit.read",
  );
  assert.deepEqual(readInsert.values[10], ADMIN_AUDIT_RELEASED_FIELDS);

  const exportPool = poolFor({ role: "security_audit", events: [event] });
  const exported = await exportAdminAuditEvents(
    exportPool,
    input({ maximumRows: 100 }),
  );
  assert.equal(exported.status, 200);
  assert.equal(exported.truncated, false);
  assert.equal(
    exportPool.statements.some(
      ({ text, values }) =>
        /INSERT INTO audit_event/u.test(text) && values[5] === "audit.exported",
    ),
    true,
  );
});

for (const disclosureRole of ["analyst", "super_admin"]) {
  test(`TASK138 ${disclosureRole} unprojected access returns exact stored fields and an attributable justification audit`, async () => {
    const assembledAt = new Date("2026-08-29T09:00:00.000Z");
    const row = {
      account_id: accountId,
      run_id: runId,
      outcome: "candidates",
      eligible_count: 2,
      considered_count: 4,
      scarcity: null,
      limitations_text: "Synthetic limitation",
      complete_result_document: { private_field: "visible-to-analyst" },
      result_sha256: Buffer.alloc(32, 7),
      assembled_at: assembledAt,
    };
    const pool = poolFor({ role: disclosureRole, unprojected: row });
    const result = await readAdminUnprojectedResult(
      pool,
      input({ runId, justification: "Approved quality analysis" }),
    );
    assert.equal(result.status, 200);
    assert.equal(
      result.body.result_sha256,
      Buffer.alloc(32, 7).toString("hex"),
    );
    assert.deepEqual(
      result.body.complete_result_document,
      row.complete_result_document,
    );
    const insert = pool.statements.find(
      ({ text, values }) =>
        /INSERT INTO audit_event/u.test(text) &&
        values[5] === "unprojected.accessed",
    );
    assert.ok(insert);
    assert.equal(insert.values[2], actorUserId);
    assert.equal(insert.values[7], runId);
    assert.deepEqual(insert.values[10], ADMIN_UNPROJECTED_RESULT_FIELDS);
    assert.equal(insert.values[11], "Approved quality analysis");
  });
}

for (const role of [
  null,
  "support",
  "consultant_manager",
  "product",
  "security_audit",
]) {
  test(`TASK138 unprojected access denies ${role ?? "no-sub-role"} and audits zero released fields`, async () => {
    const pool = poolFor({ role });
    const result = await readAdminUnprojectedResult(
      pool,
      input({ runId, justification: "Synthetic negative authorization" }),
    );
    assert.deepEqual(result, { status: 403, reason: "analyst-required" });
    const insert = pool.statements.find(({ text }) =>
      /INSERT INTO audit_event/u.test(text),
    );
    assert.equal(insert.values[5], "unprojected.access_denied");
    assert.deepEqual(insert.values[10], []);
  });
}

test("TASK141 records closed guardrail activation facts and computes an attributable rate", async () => {
  const writePool = poolFor({ role: null });
  await recordGuardrailEvaluation(
    writePool,
    input({
      runId,
      guardrailIdentifier: "injection_detection",
      trigger: "prompt.injection_detected",
      disposition: "blocked",
    }),
  );
  const activation = writePool.statements.find(({ text }) =>
    /INSERT INTO audit_event/u.test(text),
  );
  assert.equal(activation.values[5], "guardrail.activated");
  assert.deepEqual(JSON.parse(activation.values[14]), {
    guardrailIdentifier: "injection_detection",
    trigger: "prompt.injection_detected",
    disposition: "blocked",
  });

  const metricsPool = poolFor({
    role: "security_audit",
    metrics: [
      {
        guardrail_identifier: "injection_detection",
        evaluation_count: 4,
        activation_count: 1,
      },
      {
        guardrail_identifier: "prohibited_phrasing",
        evaluation_count: 2,
        activation_count: 1,
      },
    ],
  });
  const metrics = await aggregateGuardrailActivations(
    metricsPool,
    input({
      from: new Date("2026-08-29T00:00:00.000Z"),
      to: new Date("2026-08-30T00:00:00.000Z"),
    }),
  );
  assert.equal(metrics.status, 200);
  assert.equal(metrics.evaluationCount, 6);
  assert.equal(metrics.activationCount, 2);
  assert.equal(metrics.activationRate, 1 / 3);
});
