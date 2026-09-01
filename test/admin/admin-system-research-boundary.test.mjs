import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  readAdminResearch,
  readAdminUnprojectedResult,
} from "../../packages/data/dist/index.js";

function pool(role, resultRow = null) {
  const statements = [];
  const client = {
    release() {},
    async query(text, values = []) {
      statements.push({ text, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(text.trim()))
        return { rows: [], rowCount: 0 };
      if (/SELECT eg\.tier/u.test(text))
        return { rows: [{ tier: "admin" }], rowCount: 1 };
      if (/SELECT sub_role/u.test(text))
        return { rows: [{ sub_role: role }], rowCount: 1 };
      if (/FROM research_run rr/u.test(text)) return { rows: [], rowCount: 0 };
      if (/FROM run_result/u.test(text))
        return {
          rows: resultRow ? [resultRow] : [],
          rowCount: resultRow ? 1 : 0,
        };
      if (/INSERT INTO audit_event/u.test(text))
        return { rows: [{ audit_id: randomUUID() }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return {
    statements,
    query: client.query.bind(client),
    connect: async () => client,
  };
}

const base = {
  accountId: randomUUID(),
  actorUserId: randomUUID(),
  correlationId: randomUUID(),
  deploymentId: "admin-system-boundary-test",
};

test("Super-admin all-scope inventory is system-wide and purpose-audited", async () => {
  const repository = pool("super_admin");
  await readAdminResearch(repository, {
    ...base,
    limit: 20,
    cursor: null,
    scope: "all",
    purpose: "Investigate system-wide research operations",
  });
  const select = repository.statements.find(({ text }) =>
    /FROM research_run rr/u.test(text),
  );
  assert.match(select.text, /WHERE \(\$2::text='all' OR \(rr\.account_id=\$1/u);
  assert.match(select.text, /LEFT JOIN live_research_terminal/iu);
  assert.match(select.text, /THEN 'failed' ELSE rr\.state/iu);
  assert.match(select.text, /THEN 'failed' END\) AS outcome/iu);
  const audit = repository.statements.find(
    ({ text, values }) =>
      /INSERT INTO audit_event/u.test(text) &&
      values[5] === "admin.research_inventory.projected",
  );
  assert.equal(audit.values[11], "Investigate system-wide research operations");
});

test("only Super-admin full-result reads cross the account boundary", async () => {
  const row = {
    account_id: randomUUID(),
    run_id: randomUUID(),
    outcome: "matched",
    eligible_count: 1,
    considered_count: 1,
    scarcity: null,
    limitations_text: "bounded",
    complete_result_document: {},
    result_sha256: Buffer.alloc(32),
    assembled_at: new Date(),
  };
  for (const [role, systemWide] of [
    ["analyst", false],
    ["super_admin", true],
  ]) {
    const repository = pool(role, row);
    await readAdminUnprojectedResult(repository, {
      ...base,
      runId: row.run_id,
      justification: "Operational verification",
    });
    const select = repository.statements.find(({ text }) =>
      /FROM run_result/u.test(text),
    );
    assert.match(select.text, /\$3::boolean OR account_id=\$1/u);
    assert.equal(select.values[2], systemWide);
  }
});

test("migration makes tier_at_submission immutable without rewriting rows", async () => {
  const sql = await readFile(
    new URL(
      "../../packages/data/migrations/0011_admin_system_scope_and_run_tier_immutability.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /BEFORE UPDATE OF tier_at_submission ON research_run/u);
  assert.match(sql, /IS DISTINCT FROM OLD\.tier_at_submission/u);
  assert.doesNotMatch(sql, /UPDATE research_run/u);
  assert.match(sql, /ENABLE ALWAYS TRIGGER/u);
});
