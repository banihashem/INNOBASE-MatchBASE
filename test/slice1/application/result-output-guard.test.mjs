import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationFault,
  MatchBaseApplication,
  StandardWorkspaceApplication,
  guardFreshRunOutputRead,
  outputRestrictedFault,
} from "../../../packages/application/dist/index.js";

const runId = "00000000-0000-4000-8000-000000000074";
const context = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "demo",
  adminSubRoles: [],
  correlationId: "task074-correlation",
  deploymentId: "task074-deployment",
};

function clientFor(state, { rejectAudit = false } = {}) {
  const statements = [];
  return {
    statements,
    release() {},
    async query(text, values = []) {
      statements.push({ text, values });
      if (
        /FROM research_run r/u.test(text) &&
        /live_research_terminal/u.test(text) &&
        /FOR SHARE/u.test(text)
      )
        return {
          rows: state === null ? [] : [{ state }],
          rowCount: state ? 1 : 0,
        };
      if (/INSERT INTO audit_event/u.test(text)) {
        if (rejectAudit) throw new Error("synthetic audit refusal");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function transactionalPoolFor(state, { rejectAudit = false } = {}) {
  const client = clientFor(state, { rejectAudit });
  const originalQuery = client.query.bind(client);
  client.query = async (text, values = []) => {
    if (/^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(text)) {
      client.statements.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
    return originalQuery(text, values);
  };
  return {
    statements: client.statements,
    async query(text, values = []) {
      client.statements.push({ text, values });
      if (/FROM entitlement_grant/u.test(text))
        return { rows: [{ tier: "standard" }], rowCount: 1 };
      throw new Error(`Unexpected pool query: ${text}`);
    },
    async connect() {
      return client;
    },
    async end() {},
  };
}

function applications(pool) {
  return {
    demo: new MatchBaseApplication({
      pool,
      canonicalizer: { canonicalize: async () => assert.fail("unused") },
      privacyKey: Buffer.alloc(32, 7),
    }),
    standard: new StandardWorkspaceApplication({
      pool,
      privacyKey: Buffer.alloc(32, 8),
    }),
  };
}

for (const state of ["escalated", "restricted"]) {
  test(`shared output guard denies ${state} before result bytes and persists safe audit`, async () => {
    const client = clientFor(state);
    const result = await guardFreshRunOutputRead(
      client,
      context,
      runId,
      "run.result",
    );
    assert.deepEqual(result, { kind: "output_restricted" });
    assert.equal(client.statements.length, 2);
    assert.match(client.statements[0].text, /account_id=\$2/u);
    assert.match(client.statements[0].text, /requested_by_user_id=\$3/u);
    assert.match(client.statements[0].text, /FOR SHARE/u);
    assert.equal(
      client.statements.some(({ text }) => /run_result|candidate_/u.test(text)),
      false,
    );
    const auditValues = client.statements[1].values;
    assert.equal(auditValues[5], "access.denied");
    assert.equal(auditValues[7], runId);
    const detail = JSON.parse(auditValues[14]);
    assert.deepEqual(detail, {
      refusalCode: "MB-403-OUTPUT",
      reasonCode: "output_restricted",
      routeClass: "run.result",
    });
    if (state === "escalated")
      assert.equal(JSON.stringify(detail).includes(state), false);
  });
}

test("shared output guard preserves ordinary completed reads", async () => {
  const client = clientFor("complete");
  assert.deepEqual(
    await guardFreshRunOutputRead(client, context, runId, "run.result"),
    { kind: "allowed", state: "complete" },
  );
  assert.equal(client.statements.length, 1);
});

test("shared output guard preserves cross-account non-disclosure", async () => {
  const client = clientFor(null);
  assert.deepEqual(
    await guardFreshRunOutputRead(client, context, runId, "run.status"),
    { kind: "not_visible" },
  );
  assert.equal(client.statements.length, 1);
});

test("shared output guard fails closed when deny audit cannot persist", async () => {
  const client = clientFor("restricted", { rejectAudit: true });
  await assert.rejects(
    guardFreshRunOutputRead(client, context, runId, "run.result"),
    (error) =>
      error instanceof ApplicationFault &&
      error.status === 503 &&
      error.code === "MB-503-AUDIT" &&
      error.auditRecorded,
  );
  assert.equal(
    client.statements.some(({ text }) => /run_result|candidate_/u.test(text)),
    false,
  );
});

for (const state of ["escalated", "restricted"]) {
  for (const tier of ["demo", "standard"]) {
    for (const path of ["status", "result"]) {
      test(`${tier} ${path} application read returns one audited neutral deny for ${state}`, async () => {
        const pool = transactionalPoolFor(state);
        const app = applications(pool)[tier];
        const tierContext = { ...context, tier };
        const operation =
          tier === "demo"
            ? path === "status"
              ? app.getRunStatus.bind(app)
              : app.getRunResult.bind(app)
            : path === "status"
              ? app.getRun.bind(app)
              : app.getResult.bind(app);
        await assert.rejects(
          operation(tierContext, runId),
          (error) =>
            error instanceof ApplicationFault &&
            error.status === 403 &&
            error.typeSuffix === "output-restricted" &&
            error.code === "MB-403-OUTPUT" &&
            error.message === "Run output is not available." &&
            error.auditRecorded,
        );
        const transactional = pool.statements.map(({ text }) =>
          text.trim().split(/\s+/u).slice(0, 3).join(" "),
        );
        assert.equal(transactional.includes("BEGIN"), true);
        assert.equal(transactional.includes("COMMIT"), true);
        assert.equal(transactional.includes("ROLLBACK"), false);
        assert.equal(
          pool.statements.filter(({ text }) =>
            /INSERT INTO audit_event/u.test(text),
          ).length,
          1,
        );
        assert.equal(
          pool.statements.some(({ text }) =>
            /FROM run_result|JOIN run_result|candidate_/u.test(text),
          ),
          false,
        );
      });
    }
  }
}

for (const tier of ["demo", "standard"]) {
  test(`${tier} result application read rolls back and returns 503 when deny audit fails`, async () => {
    const pool = transactionalPoolFor("restricted", { rejectAudit: true });
    const app = applications(pool)[tier];
    const tierContext = { ...context, tier };
    await assert.rejects(
      tier === "demo"
        ? app.getRunResult(tierContext, runId)
        : app.getResult(tierContext, runId),
      (error) =>
        error instanceof ApplicationFault &&
        error.status === 503 &&
        error.code === "MB-503-AUDIT",
    );
    assert.equal(
      pool.statements.some(({ text }) => text === "ROLLBACK"),
      true,
    );
    assert.equal(
      pool.statements.some(({ text }) =>
        /FROM run_result|JOIN run_result|candidate_/u.test(text),
      ),
      false,
    );
  });
}

test("public output-restricted fault is neutral and contains no result-bearing keys", () => {
  const fault = outputRestrictedFault();
  const body = {
    type: `about:matchbase/errors/${fault.typeSuffix}`,
    title: "Forbidden",
    status: fault.status,
    code: fault.code,
    detail: fault.message,
    retryable: fault.retryable,
    errors: [],
  };
  assert.deepEqual(body, {
    type: "about:matchbase/errors/output-restricted",
    title: "Forbidden",
    status: 403,
    code: "MB-403-OUTPUT",
    detail: "Run output is not available.",
    retryable: false,
    errors: [],
  });
  const forbidden =
    /candidate|score|band|citation|rationale|provider|run_result|state/u;
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.doesNotMatch(key, forbidden);
      visit(nested);
    }
  }
  visit(body);
  assert.doesNotMatch(body.detail, /escalated|restricted/u);
});
