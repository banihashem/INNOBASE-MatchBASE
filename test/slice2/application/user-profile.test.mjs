import assert from "node:assert/strict";
import test from "node:test";

import { UserProfileApplication } from "../../../packages/application/dist/index.js";

const context = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "standard",
  adminSubRoles: [],
  correlationId: "profile-history-test",
  deploymentId: "test",
};

function repository({ tier = "standard", superAdmin = false } = {}) {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(text))
      return { rows: [], rowCount: 0 };
    if (text.includes("FROM entitlement_grant"))
      return {
        rows: [{ tier, is_super_admin: superAdmin }],
        rowCount: 1,
      };
    if (text.includes("FROM sourcing_request sr"))
      return {
        rows: [
          {
            request_id: "00000000-0000-4000-8000-000000000003",
            current_version: 1,
            lifecycle_state: "confirmed",
            created_at: new Date("2026-08-31T10:00:00.000Z"),
            canonical_created_at: new Date("2026-08-31T10:01:00.000Z"),
            canonical_document: { canonical_text: "Owner canonical request" },
            run_count: 2,
          },
        ],
        rowCount: 1,
      };
    if (text.includes("SELECT rr.run_id,crv.request_id"))
      return {
        rows: [
          {
            run_id: "00000000-0000-4000-8000-000000000004",
            request_id: "00000000-0000-4000-8000-000000000003",
            version: 1,
            tier_at_submission: "demo",
            state: "complete",
            queued_at: new Date("2026-08-31T10:02:00.000Z"),
            started_at: new Date("2026-08-31T10:03:00.000Z"),
            completed_at: new Date("2026-08-31T10:04:00.000Z"),
            cancelled_at: null,
            result_document_available: true,
          },
          {
            run_id: "00000000-0000-4000-8000-000000000005",
            request_id: "00000000-0000-4000-8000-000000000003",
            version: 1,
            tier_at_submission: "consultant",
            state: "complete",
            queued_at: new Date("2026-08-31T11:02:00.000Z"),
            started_at: new Date("2026-08-31T11:03:00.000Z"),
            completed_at: new Date("2026-08-31T11:04:00.000Z"),
            cancelled_at: null,
            result_document_available: true,
          },
        ],
        rowCount: 2,
      };
    return { rows: [], rowCount: 1 };
  };
  return {
    calls,
    application: new UserProfileApplication({
      query,
      connect: async () => ({ query, release() {} }),
    }),
  };
}

test("projects owner history without widening submission-bound results", async () => {
  const fixture = repository();
  const history = await fixture.application.getHistory(context);
  assert.equal(
    history.requests[0].canonical_summary,
    "Owner canonical request",
  );
  assert.equal(history.schema_version, "user-profile-history.v2");
  assert.equal(history.requests[0].product_group, "Owner canonical request");
  assert.equal(history.runs[0].submitted_tier, "demo");
  assert.equal(history.runs[0].result_projection, "demo");
  assert.match(history.runs[0].links.result, /\/result$/u);
  assert.equal(history.runs[1].submitted_tier, "consultant");
  assert.equal(history.runs[1].result_available, true);
  assert.equal(history.runs[1].result_projection, null);
  assert.equal(history.runs[1].links.result, null);
  const ownerReads = fixture.calls.filter(
    (call) =>
      call.text.includes("FROM sourcing_request sr") ||
      call.text.includes("SELECT rr.run_id,crv.request_id"),
  );
  assert.deepEqual(
    ownerReads.map((call) => call.values),
    [
      [context.accountId, context.userId, 51, 0],
      [context.accountId, context.userId, 51, 0],
    ],
  );
  assert.match(ownerReads[1].text, /LEFT JOIN live_research_terminal/iu);
  assert.match(ownerReads[1].text, /THEN 'failed' ELSE rr\.state/iu);
  assert.ok(
    fixture.calls.some(
      (call) =>
        call.text.includes("INSERT INTO audit_event") &&
        call.values[5] === "profile.history.projected",
    ),
  );
  assert.equal(fixture.calls.at(-1).text, "COMMIT");
});

test("projects a stored Super-admin profile at Consultant depth without changing the Admin identity", async () => {
  const fixture = repository({ tier: "admin", superAdmin: true });
  const history = await fixture.application.getHistory({
    ...context,
    tier: "admin",
    adminSubRoles: ["super_admin"],
  });
  assert.equal(history.current_tier, "consultant");
  assert.equal(history.runs[0].result_projection, "demo");
  assert.equal(history.runs[1].result_projection, "consultant");
  assert.match(history.runs[1].links.result, /\/api\/v1\/consultant\/runs\//u);
  const audit = fixture.calls.find(
    (call) =>
      call.text.includes("INSERT INTO audit_event") &&
      call.values[5] === "profile.history.projected",
  );
  assert.equal(audit.values[3], "admin");
});

test("denies an Admin profile when stored Super-admin authority is absent", async () => {
  const fixture = repository({ tier: "admin", superAdmin: false });
  await assert.rejects(
    fixture.application.getHistory({
      ...context,
      tier: "admin",
      adminSubRoles: ["super_admin"],
    }),
    (error) => error.status === 403 && error.code === "MB-403-PROFILE",
  );
});
