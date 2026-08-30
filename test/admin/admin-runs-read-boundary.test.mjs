import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AdminRunsApplication,
  ApplicationFault,
  parseAdminRunsReadQuery,
} from "../../packages/application/dist/index.js";

const cursorKey = Buffer.from("admin-runs-test-cursor-key-32-bytes");

function context(overrides = {}) {
  return {
    accountId: randomUUID(),
    userId: randomUUID(),
    tier: "demo",
    adminSubRoles: [],
    correlationId: randomUUID(),
    deploymentId: "admin-runs-node-test",
    ...overrides,
  };
}

class AdminRunsPool {
  constructor({ role = "support", rows = [] } = {}) {
    this.role = role;
    this.rows = rows;
    this.statements = [];
  }

  async connect() {
    return this;
  }

  release() {}

  async end() {}

  async query(text, values = []) {
    this.statements.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(text)) {
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT eg\.tier/u.test(text)) {
      return { rows: [{ tier: "admin" }], rowCount: 1 };
    }
    if (/SELECT arg\.sub_role/u.test(text)) {
      return { rows: [{ sub_role: this.role }], rowCount: 1 };
    }
    if (/WITH latest_governance/u.test(text)) {
      return { rows: this.rows, rowCount: this.rows.length };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

function governanceRow({
  state = "escalated",
  to = "Escalated to Human",
  actor = null,
  raisedAt = new Date("2026-08-25T10:00:00.000Z"),
} = {}) {
  return {
    run_id: randomUUID(),
    run_state: state,
    audit_id: randomUUID(),
    raised_at: raisedAt,
    actor_user_id: actor,
    to_state: to,
    reason_code: "confidence_below_threshold",
    trigger_rule_id: "CF-015",
    system_actor: "policy-engine",
    failure_class: "timeout",
  };
}

test("Admin run query is closed and defaults to the documented page size", () => {
  assert.deepEqual(parseAdminRunsReadQuery([]), { limit: 20 });
  assert.deepEqual(
    parseAdminRunsReadQuery([
      ["limit", "100"],
      ["governance_state", "Output Restricted"],
      ["run_state", "restricted"],
      ["failure_class", "provider_unavailable"],
    ]),
    {
      limit: 100,
      governance_state: "Output Restricted",
      run_state: "restricted",
      failure_class: "provider_unavailable",
    },
  );
  for (const invalid of [
    [["oidc_role", "super_admin"]],
    [["limit", "0"]],
    [["limit", "101"]],
    [["failure_class", "provider said request content"]],
    [
      ["run_state", "failed"],
      ["run_state", "failed"],
    ],
  ]) {
    assert.throws(
      () => parseAdminRunsReadQuery(invalid),
      (error) =>
        error instanceof ApplicationFault &&
        error.status === 400 &&
        error.code === "MB-400-QUERY",
    );
  }
});

test("stored Admin entitlement authorizes the bounded projection and creates a subject-bound cursor", async () => {
  const rows = [
    governanceRow(),
    governanceRow({ raisedAt: new Date("2026-08-25T09:00:00.000Z") }),
  ];
  const pool = new AdminRunsPool({ rows });
  const application = new AdminRunsApplication(pool, cursorKey);
  const actor = context();
  const page = await application.read(actor, { limit: 1 });
  assert.equal(page.items.length, 1);
  assert.deepEqual(Object.keys(page.items[0]).sort(), [
    "automated_path_blocked",
    "governance_state",
    "human_action_required",
    "raised_at",
    "reason_code",
    "run_id",
    "run_state",
    "trigger_rule_id",
  ]);
  assert.equal(page.items[0].governance_state, "Escalated to Human");
  assert.equal(page.items[0].reason_code, "reason_unavailable");
  assert.equal(page.items[0].automated_path_blocked, true);
  assert.equal(page.page.has_more, true);
  assert.ok(page.page.next_cursor);
  assert.equal(
    pool.statements.some(({ text }) =>
      /candidate|evidence|run_result|state_reason|provider_call/iu.test(text),
    ),
    false,
  );

  await assert.rejects(
    application.read(context({ accountId: actor.accountId }), {
      limit: 1,
      cursor: page.page.next_cursor,
    }),
    (error) =>
      error instanceof ApplicationFault &&
      error.status === 400 &&
      error.code === "MB-400-CURSOR",
  );
});

test("stored consultant_manager denial ignores forged request-context claims", async () => {
  const pool = new AdminRunsPool({
    role: "consultant_manager",
    rows: [governanceRow()],
  });
  const application = new AdminRunsApplication(pool, cursorKey);
  await assert.rejects(
    application.read(
      context({ tier: "admin", adminSubRoles: ["super_admin"] }),
      { limit: 20 },
    ),
    (error) =>
      error instanceof ApplicationFault &&
      error.status === 403 &&
      error.code === "MB-403-ADMIN-RUNS",
  );
});

test("state/audit disagreement and raw failure payloads fail closed as integrity errors", async () => {
  for (const row of [
    governanceRow({ state: "complete" }),
    {
      ...governanceRow(),
      audit_id: null,
      raised_at: null,
      to_state: null,
      trigger_rule_id: null,
      failure_class: null,
      system_actor: null,
    },
    { ...governanceRow(), trigger_rule_id: "invalid trigger rule spaces" },
  ]) {
    const application = new AdminRunsApplication(
      new AdminRunsPool({ rows: [row] }),
      cursorKey,
    );
    await assert.rejects(
      application.read(context(), { limit: 20 }),
      (error) =>
        error instanceof ApplicationFault &&
        error.status === 503 &&
        error.code === "MB-503-INTEGRITY",
    );
  }
});

test("unregistered reason tokens are replaced by a neutral sentinel and whole audit detail is never selected", async () => {
  const sensitive = governanceRow();
  sensitive.reason_code = "customer_acme_private_failure";
  const pool = new AdminRunsPool({ rows: [sensitive] });
  const body = await new AdminRunsApplication(pool, cursorKey).read(context(), {
    limit: 20,
  });
  assert.equal(body.items[0].reason_code, "reason_unavailable");
  assert.equal(JSON.stringify(body).includes("customer_acme"), false);
  for (const { text } of pool.statements) {
    assert.equal(/a\.detail(?:\s+AS|\s*,|\s+FROM)/u.test(text), false);
  }
});

test("all four governance states require human action and block the automated path", async () => {
  const rows = [
    governanceRow({ state: "escalated", to: "Review Required" }),
    governanceRow({ state: "escalated", to: "Escalated to Human" }),
    governanceRow({ state: "restricted", to: "Output Restricted" }),
    governanceRow({ state: "failed", to: "Evaluation Failed" }),
  ];
  const body = await new AdminRunsApplication(
    new AdminRunsPool({ rows }),
    cursorKey,
  ).read(context(), { limit: 20 });
  assert.deepEqual(
    body.items.map((item) => ({
      governance_state: item.governance_state,
      human_action_required: item.human_action_required,
      automated_path_blocked: item.automated_path_blocked,
    })),
    [
      "Review Required",
      "Escalated to Human",
      "Output Restricted",
      "Evaluation Failed",
    ].map((governance_state) => ({
      governance_state,
      human_action_required: true,
      automated_path_blocked: true,
    })),
  );
});
