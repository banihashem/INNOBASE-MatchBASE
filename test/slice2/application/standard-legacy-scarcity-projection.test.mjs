import assert from "node:assert/strict";
import test from "node:test";

import {
  StandardWorkspaceApplication,
  legacyStandardCompleteResultDocumentSha256,
} from "../../../packages/application/dist/index.js";

const runId = "00000000-0000-4000-8000-000000000071";
const context = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "standard",
  adminSubRoles: [],
  correlationId: "00000000-0000-4000-8000-000000000003",
  deploymentId: "task-071-test",
};

function legacyZeroGraph() {
  return {
    schema_version: "standard-evidence-graph.v1",
    run_id: runId,
    candidates: [],
    claims: [],
    evidence: [],
    evidenced_values: [],
    eligible_candidate_ids: [],
    gate_evaluations: [
      {
        gate_id: "mandatory_constraints",
        label: "Mandatory constraint failures",
        eliminated_count: 2,
      },
      {
        gate_id: "evidence_sufficiency",
        label: "Insufficient decision evidence",
        eliminated_count: 1,
      },
    ],
    unknown_count: 2,
    not_asked_count: 1,
    gate_evaluation_completed_at: "2026-08-15T00:00:00.000+00:00",
  };
}

function applicationFor(row) {
  const query = async (text) =>
    /^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(text)
      ? { rows: [], rowCount: 0 }
      : text.includes("FROM entitlement_grant")
        ? { rows: [{ tier: "standard" }], rowCount: 1 }
        : text.includes("SELECT state")
          ? { rows: [{ state: row.state }], rowCount: 1 }
          : { rows: [row], rowCount: 1 };
  return new StandardWorkspaceApplication({
    pool: {
      query,
      connect: async () => ({ query, release() {} }),
    },
    privacyKey: Buffer.from(
      "local-synthetic-digest-key-32-bytes-minimum",
      "utf8",
    ),
  });
}

function legacyResultRow(overrides = {}) {
  const completeResult = legacyZeroGraph();
  return {
    state: "no_responsible_match",
    complete_result_document: completeResult,
    result_sha256: legacyStandardCompleteResultDocumentSha256(completeResult),
    canonical_document: { hard_constraints: [] },
    scarcity_outcome: "no_responsible_match",
    unmet_constraints: [],
    permitted_relaxations: [],
    projection_as_of: new Date("2026-08-15T00:00:00.000Z"),
    ...overrides,
  };
}

test("serves immutable v3 zero-result rows through a truthful v4 scarcity projection", async () => {
  const application = applicationFor(legacyResultRow());

  const result = await application.getResult(context, runId, false);

  assert.equal(result.projection_version, 4);
  assert.equal(result.scarcity, "zero");
  assert.deepEqual(result.scarcity_analysis, {
    reducing_constraints: [],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [],
  });
  assert.equal(result.gate_eliminations[0].eliminated_count, 2);
});

test("does not normalize a non-legacy scarcity ledger", async () => {
  const application = applicationFor(
    legacyResultRow({
      unmet_constraints: [
        { constraint_id: "unsupported", eliminated_count: 2 },
      ],
    }),
  );

  await assert.rejects(
    application.getResult(context, runId, false),
    /Mandatory gate count does not match enumerated candidate failures/u,
  );
});

test("repository rejects a tampered legacy document before projection", async () => {
  const row = legacyResultRow();
  row.complete_result_document.unknown_count += 1;
  const application = applicationFor(row);

  await assert.rejects(
    application.getResult(context, runId, false),
    /integrity check failed/iu,
  );
});

test("repository rejects a wrong stored legacy digest", async () => {
  const application = applicationFor(
    legacyResultRow({ result_sha256: Buffer.alloc(32, 0x55) }),
  );

  await assert.rejects(
    application.getResult(context, runId, false),
    /integrity check failed/iu,
  );
});
