import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { authorizeConsultantRunResourceRead } from "../../../packages/application/dist/consultant-authorization.js";
import { GOLDEN_SCENARIO_V3_01 } from "../../../packages/contracts/dist/src/index.js";

const envKeys = [
  "MATCHBASE_ENVIRONMENT",
  "MATCHBASE_SYNTHETIC_FIXTURE",
  "NODE_ENV",
];
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});
const runId = "10000000-0000-4000-8000-000000000001";
const context = {
  accountId: "account-owner",
  userId: "profile-owner",
  tier: "consultant",
  adminSubRoles: [],
  correlationId: "pilot-isolation",
  deploymentId: "isolated-test",
};
function read(row, options = {}) {
  return authorizeConsultantRunResourceRead({
    context,
    runId,
    pool: { query: async () => ({ rows: row ? [row] : [] }) },
    resourceKind: "run_detail",
    ...options,
  });
}
function row(overrides = {}) {
  return {
    output_id: "output",
    output_account_id: context.accountId,
    output_user_profile_id: context.userId,
    session_id: null,
    document_payload: GOLDEN_SCENARIO_V3_01,
    ...overrides,
  };
}
const hidden = { status: 404, code: "MB-404-RUN" };

test("MB-UX-PILOT-001 L01 historical output without a workflow session remains readable by its profile", async () => {
  assert.equal((await read(row())).status, 200);
});
test("another profile in the same account cannot read output-only history or PDF", async () => {
  await assert.rejects(
    read(row({ output_user_profile_id: "another-profile" }), {
      resourceKind: "report_pdf",
    }),
    hidden,
  );
});
test("another account cannot read run output", async () => {
  await assert.rejects(
    read(row({ output_account_id: "another-account" })),
    hidden,
  );
});
test("persisted session ownership must agree with output ownership", async () => {
  await assert.rejects(
    read(
      row({
        session_id: "session",
        session_account_id: context.accountId,
        user_profile_id: "another-profile",
      }),
    ),
    hidden,
  );
});
test("profile-owned draft-only workflow remains readable", async () => {
  const result = await read(
    row({
      output_id: null,
      document_payload: null,
      session_id: "session",
      session_account_id: context.accountId,
      user_profile_id: context.userId,
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.output, null);
});
test("session-only workflow belonging to another profile is hidden", async () => {
  await assert.rejects(
    read(
      row({
        output_id: null,
        document_payload: null,
        session_id: "session",
        session_account_id: context.accountId,
        user_profile_id: "another-profile",
      }),
    ),
    hidden,
  );
});
test("super-admin historical oversight retains cross-account access", async () => {
  assert.equal(
    (
      await read(row({ output_account_id: "another-account" }), {
        context: { ...context, tier: "admin", adminSubRoles: ["super_admin"] },
      })
    ).status,
    200,
  );
});
test("missing golden output does not fall back without explicit fixture admission", async () => {
  delete process.env.MATCHBASE_SYNTHETIC_FIXTURE;
  await assert.rejects(read(null, { runId: "run-v3-golden-01" }), hidden);
});
test("production cannot admit golden fallback even if its fixture flag is enabled", async () => {
  process.env.MATCHBASE_ENVIRONMENT = "production";
  process.env.MATCHBASE_SYNTHETIC_FIXTURE = "true";
  await assert.rejects(read(null, { runId: "run-v3-golden-01" }), hidden);
});
test("production does not exempt persisted golden IDs from profile isolation", async () => {
  process.env.MATCHBASE_ENVIRONMENT = "production";
  process.env.MATCHBASE_SYNTHETIC_FIXTURE = "true";
  await assert.rejects(
    read(row({ output_user_profile_id: "another-profile" }), {
      runId: "run-v3-golden-01",
    }),
    hidden,
  );
});
test("explicit local synthetic mode preserves simulator golden fixtures", async () => {
  process.env.MATCHBASE_ENVIRONMENT = "local";
  process.env.NODE_ENV = "test";
  process.env.MATCHBASE_SYNTHETIC_FIXTURE = "true";
  assert.equal((await read(null, { runId: "run-v3-golden-01" })).status, 200);
});
