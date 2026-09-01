import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  StandardWorkspaceApplication,
  assertStoredCompleteResultIntegrity,
  legacyStandardCompleteResultDocumentSha256,
  standardCompleteResultDocumentSha256,
} from "../../../packages/application/dist/index.js";

const runId = "00000000-0000-4000-8000-000000000137";
const context = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "standard",
  adminSubRoles: [],
  correlationId: "00000000-0000-4000-8000-000000000003",
  deploymentId: "task-137-integrity-test",
};

function foundation() {
  return {
    schema_version: "complete-result-foundation.v1",
    run_id: runId,
    nested: { z: 1, a: "é" },
    ordered: [2, 1],
  };
}

function repositoryForMissingDigest(
  resultSha256,
  tierAtSubmission = "standard",
) {
  const row = {
    state: "complete",
    tier_at_submission: tierAtSubmission,
    research_mode: "qualified_live_research",
    complete_result_document: {
      schema_version: "complete-result-foundation.v1",
      run_id: runId,
    },
    result_sha256: resultSha256,
    canonical_document: { hard_constraints: [] },
    scarcity_outcome: null,
    unmet_constraints: null,
    permitted_relaxations: null,
    projection_as_of: new Date("2026-08-15T00:00:00.000Z"),
  };
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

test("accepts an exact canonical foundation digest and rejects tampering", () => {
  const document = foundation();
  const digest = standardCompleteResultDocumentSha256(document);
  assert.equal(
    assertStoredCompleteResultIntegrity(document, digest, runId),
    "complete_result_foundation_v1_exact",
  );

  const tampered = structuredClone(document);
  tampered.nested.z = 2;
  assert.throws(
    () => assertStoredCompleteResultIntegrity(tampered, digest, runId),
    /integrity check failed/iu,
  );
  assert.throws(
    () =>
      assertStoredCompleteResultIntegrity(
        document,
        Buffer.alloc(32, 0x7f),
        runId,
      ),
    /integrity check failed/iu,
  );
});

test("canonicalization is key-order independent and array-order sensitive", () => {
  const document = foundation();
  const reordered = {
    ordered: [2, 1],
    nested: { a: "é", z: 1 },
    run_id: runId,
    schema_version: "complete-result-foundation.v1",
  };
  const expectedCanonical =
    '{"nested":{"a":"é","z":1},"ordered":[2,1],"run_id":"00000000-0000-4000-8000-000000000137","schema_version":"complete-result-foundation.v1"}';
  assert.deepEqual(
    standardCompleteResultDocumentSha256(document),
    createHash("sha256").update(expectedCanonical, "utf8").digest(),
  );
  assert.deepEqual(
    standardCompleteResultDocumentSha256(document),
    standardCompleteResultDocumentSha256(reordered),
  );

  reordered.ordered.reverse();
  assert.notDeepEqual(
    standardCompleteResultDocumentSha256(document),
    standardCompleteResultDocumentSha256(reordered),
  );
});

test("legacy Standard integrity is explicit and never trusts run identity", () => {
  const legacy = {
    schema_version: "standard-evidence-graph.v1",
    run_id: runId,
    candidates: [],
  };
  const digest = legacyStandardCompleteResultDocumentSha256(legacy);
  assert.equal(
    assertStoredCompleteResultIntegrity(legacy, digest, runId),
    "legacy_standard_evidence_graph_v1_normalized_run_id",
  );
  assert.throws(
    () =>
      assertStoredCompleteResultIntegrity(
        { ...legacy, run_id: "00000000-0000-4000-8000-000000000999" },
        digest,
        runId,
      ),
    /run identity is invalid/iu,
  );
  assert.throws(
    () => assertStoredCompleteResultIntegrity(legacy, Buffer.alloc(31), runId),
    /integrity digest is invalid/iu,
  );
});

for (const [label, missingDigest] of [
  ["undefined", undefined],
  ["null", null],
])
  test(`repository rejects ${label} result_sha256 before parsing`, async () => {
    const application = repositoryForMissingDigest(missingDigest);
    await assert.rejects(
      application.getResult(context, runId, false),
      /integrity digest is invalid/iu,
    );
  });

test("a Standard result route never down-projects a Consultant-tier run", async () => {
  const application = repositoryForMissingDigest(
    Buffer.alloc(32),
    "consultant",
  );
  await assert.rejects(
    application.getResult(context, runId, false),
    (error) => error.status === 403 && error.code === "MB-403-NOT-VISIBLE",
  );
});
