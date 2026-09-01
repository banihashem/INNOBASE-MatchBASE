import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  adminResearchProductGroup,
  readAdminResearch,
  readAdminUnprojectedResult,
} from "../../packages/data/dist/index.js";

function pool(role, resultRow = null, inventoryRows = []) {
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
      if (/FROM research_run rr/u.test(text))
        return { rows: inventoryRows, rowCount: inventoryRows.length };
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
  assert.equal(audit.values[10].includes("items[].requester.email"), true);
  assert.equal(audit.values[10].includes("items[].product_group"), true);
});

test("Super-admin inventory releases verified identity and a concise structured product group", async () => {
  const runId = randomUUID();
  const repository = pool("super_admin", null, [
    {
      account_id: randomUUID(),
      run_id: runId,
      request_id: randomUUID(),
      requested_by_user_id: randomUUID(),
      display_name: "Google Test User",
      email: "google.user@example.test",
      email_verified: true,
      canonical_document: {
        schema_version: "structured-standard-request.v1",
        fields: [
          {
            field_id: "FLD-CORE-PS-01",
            typed_value: { value_state: "provided", value: "Pistachios" },
          },
          {
            field_id: "FLD-CORE-PS-03",
            typed_value: {
              value_state: "provided",
              value: "Iranian Ahmad Aghaei pistachios",
            },
          },
        ],
      },
      tier_at_submission: "consultant",
      research_mode: "qualified_live_research",
      state: "complete",
      queued_at: new Date("2026-09-01T00:00:00.000Z"),
      updated_at: new Date("2026-09-01T00:05:00.000Z"),
      outcome: "candidates",
      eligible_count: 1,
      considered_count: 4,
      result_available: true,
    },
  ]);
  const result = await readAdminResearch(repository, {
    ...base,
    limit: 20,
    cursor: null,
    scope: "all",
    purpose: "Verify user-visible research history",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.items[0].requester, {
    user_id: result.items[0].requester.user_id,
    display_name: "Google Test User",
    email: "google.user@example.test",
  });
  assert.equal(result.items[0].product_group, "Pistachios");
  const select = repository.statements.find(({ text }) =>
    /FROM research_run rr/u.test(text),
  );
  assert.match(select.text, /u\.email::text AS email,u\.email_verified/u);
});

test("unverified inventory email stays hidden and product group has deterministic historical fallbacks", async () => {
  assert.equal(
    adminResearchProductGroup({
      schema_version: "canonical-request.v1",
      canonical_text:
        "Requirement: Industrial automation controllers; delivery in Dubai.",
    }),
    "Industrial automation controllers",
  );
  assert.equal(
    adminResearchProductGroup({
      fields: [
        {
          field_id: "FLD-CORE-PS-01",
          typed_value: {
            value:
              "Procurement request for three containers of high-quality Iranian Ahmad Aghaei pistachios. The shipment must be routed via Dubai.",
          },
        },
      ],
    }),
    "high-quality Iranian Ahmad Aghaei pistachios",
  );
  assert.equal(
    adminResearchProductGroup({
      domain_pack: { category_id: "industrial_components" },
      fields: [],
    }),
    "industrial components",
  );
  assert.equal(adminResearchProductGroup(null), "Product group unavailable");

  const repository = pool("super_admin", null, [
    {
      account_id: randomUUID(),
      run_id: randomUUID(),
      request_id: randomUUID(),
      requested_by_user_id: randomUUID(),
      display_name: null,
      email: "unverified@example.test",
      email_verified: false,
      canonical_document: null,
      tier_at_submission: "demo",
      research_mode: "qualified_live_research",
      state: "failed",
      queued_at: new Date("2026-09-01T00:00:00.000Z"),
      updated_at: new Date("2026-09-01T00:01:00.000Z"),
      outcome: "failed",
      eligible_count: null,
      considered_count: null,
      result_available: false,
    },
  ]);
  const result = await readAdminResearch(repository, {
    ...base,
    limit: 20,
    cursor: null,
    scope: "all",
    purpose: "Verify unverified identity suppression",
  });
  assert.equal(result.status, 200);
  assert.equal(result.items[0].requester.email, null);
  assert.match(result.items[0].requester.display_name, /^User [0-9a-f]{8}$/u);
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
