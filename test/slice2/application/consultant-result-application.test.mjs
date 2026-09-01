import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  ConsultantResultApplication,
  assertLegacyDemoResultIntegrity,
  standardCompleteResultDocumentSha256,
} from "../../../packages/application/dist/index.js";
import {
  buildCompleteResultFoundation,
  buildCompleteResultFoundationV2,
  buildSyntheticEvidenceGraph,
} from "../../../packages/ai-evidence/dist/src/index.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../../../packages/ai-evidence/dist/src/standard.js";
import { consultantProjectionConfigSha256 } from "../../../packages/data/dist/index.js";

const runId = "00000000-0000-4000-8000-000000000137";
const context = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "consultant",
  adminSubRoles: [],
  correlationId: "consultant-result-application-test",
  deploymentId: "test",
};
const hardConstraints = buildStandardSyntheticHardConstraints();
const projectionConfig = {
  configId: "00000000-0000-4000-8000-000000000003",
  version: "consultant-soft-cap.test-3.v1",
  softCap: 3,
  contentSha256: consultantProjectionConfigSha256(3),
};
const graph = buildStandardSyntheticEvidenceGraph(
  runId,
  "many",
  hardConstraints,
);
const foundation = buildCompleteResultFoundation(graph);
const row = {
  tier_at_submission: "consultant",
  research_mode: "synthetic_reference",
  complete_result_document: foundation,
  result_sha256: standardCompleteResultDocumentSha256(foundation),
  canonical_document: { hard_constraints: hardConstraints },
  scarcity_outcome: null,
  unmet_constraints: null,
  permitted_relaxations: null,
  projection_as_of: new Date("2026-08-25T00:00:00.000Z"),
};

function repository({
  visible = true,
  failPolicyAudit = false,
  projectionVersionDrift = false,
  resultRow = row,
  boundConfig = projectionConfig,
  historyRows = [],
} = {}) {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(text))
      return { rows: [], rowCount: 0 };
    if (text.includes("FROM entitlement_grant"))
      return { rows: [{ tier: "consultant" }], rowCount: 1 };
    if (text.includes("FROM research_run") && text.includes("FOR SHARE"))
      return {
        rows: visible ? [{ state: "complete" }] : [],
        rowCount: visible ? 1 : 0,
      };
    if (
      text.includes("FROM research_run rr") &&
      text.includes("result_document_available")
    )
      return { rows: historyRows, rowCount: historyRows.length };
    if (text.includes("SELECT rr.tier_at_submission"))
      return { rows: [resultRow], rowCount: 1 };
    if (text.includes("FROM consultant_result_projection_policy"))
      return {
        rows: [
          {
            config_id: boundConfig.configId,
            config_version: boundConfig.version,
            soft_cap: boundConfig.softCap,
            config_content_sha256: boundConfig.contentSha256,
            bound_at: new Date("2026-08-25T00:00:00.000Z"),
            released_at: new Date("2026-08-24T00:00:00.000Z"),
            definition: {
              schema_version: "consultant-projection-config.v1",
              soft_cap: boundConfig.softCap,
            },
          },
        ],
        rowCount: 1,
      };
    if (
      text.includes("INSERT INTO audit_event") &&
      values[5] === "result.projection_policy_applied"
    ) {
      if (failPolicyAudit) throw new Error("audit unavailable");
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO projection_version"))
      return { rows: [], rowCount: 1 };
    if (text.includes("SELECT projection_version_id"))
      return {
        rows: [
          {
            projection_version_id: randomUUID(),
            definition: projectionVersionDrift
              ? { allowlist: "drifted", tier: "consultant" }
              : JSON.parse(
                  calls.findLast((call) =>
                    call.text.includes("INSERT INTO projection_version"),
                  ).values[2],
                ),
            content_sha256: calls.findLast((call) =>
              call.text.includes("INSERT INTO projection_version"),
            ).values[3],
          },
        ],
        rowCount: 1,
      };
    return { rows: [], rowCount: 1 };
  };
  return {
    calls,
    application: new ConsultantResultApplication({
      query,
      connect: async () => ({ query, release() {} }),
    }),
  };
}

test("lists only owner-bound Consultant runs and audits before response", async () => {
  const requestId = "00000000-0000-4000-8000-000000000138";
  const fixture = repository({
    historyRows: [
      {
        run_id: runId,
        request_id: requestId,
        state: "complete",
        queued_at: new Date("2026-08-24T23:00:00.000Z"),
        started_at: new Date("2026-08-24T23:01:00.000Z"),
        completed_at: new Date("2026-08-25T00:00:00.000Z"),
        result_document_available: true,
      },
    ],
  });
  const history = await fixture.application.listRuns(context);
  assert.deepEqual(history, {
    schema_version: "consultant-run-history.v1",
    items: [
      {
        run_id: runId,
        request_id: requestId,
        state: "completed",
        updated_at: "2026-08-25T00:00:00.000Z",
        result_available: true,
        outcome: "matched",
      },
    ],
  });
  const historyRead = fixture.calls.find((call) =>
    call.text.includes("result_document_available"),
  );
  assert.deepEqual(historyRead.values, [context.accountId, context.userId]);
  assert.match(historyRead.text, /LEFT JOIN live_research_terminal/iu);
  assert.match(historyRead.text, /THEN 'failed' ELSE rr\.state/iu);
  assert.ok(
    fixture.calls.some(
      (call) =>
        call.text.includes("INSERT INTO audit_event") &&
        call.values[5] === "consultant.run_history.projected",
    ),
  );
  assert.equal(fixture.calls.at(-1).text, "COMMIT");
});

test("projects a terminal live failure as failed rather than running", async () => {
  const fixture = repository({
    historyRows: [
      {
        run_id: runId,
        request_id: "00000000-0000-4000-8000-000000000138",
        state: "failed",
        queued_at: new Date("2026-09-01T00:00:00.000Z"),
        started_at: new Date("2026-09-01T00:01:00.000Z"),
        completed_at: new Date("2026-09-01T00:02:00.000Z"),
        result_document_available: false,
      },
    ],
  });
  const history = await fixture.application.listRuns(context);
  assert.equal(history.items[0].state, "failed");
  assert.equal(history.items[0].outcome, "failed");
  assert.equal(history.items[0].result_available, false);
});

test("persists the projection decision and serving audit in one transaction", async () => {
  const fixture = repository();
  const result = await fixture.application.getResult(context, runId);
  assert.equal(result.projectionTier, "consultant");
  assert.equal(result.body.landscape.soft_cap, 3);
  assert.equal(result.body.landscape.displayed_count, 3);
  assert.ok(result.body.landscape.eligible_count > 3);
  assert.equal(result.body.landscape.truncated, true);
  const policyAudit = fixture.calls.find(
    (call) =>
      call.text.includes("INSERT INTO audit_event") &&
      call.values[5] === "result.projection_policy_applied",
  );
  assert.ok(policyAudit);
  assert.deepEqual(JSON.parse(policyAudit.values[14]), {
    configId: projectionConfig.configId,
    configVersion: projectionConfig.version,
    configContentSha256: projectionConfig.contentSha256.toString("hex"),
    boundAt: "2026-08-25T00:00:00.000Z",
    effectiveReleaseAt: "2026-08-24T00:00:00.000Z",
    policyId: result.body.source_policy.policy_id,
    policyVersion: result.body.source_policy.policy_version,
    policyContentSha256: result.body.source_policy.content_sha256,
    rfqWaveId: result.body.rfq_execution_snapshot.wave_id,
    rfqWaveSequence: result.body.rfq_execution_snapshot.wave_sequence,
    rfqWaveInstanceId: result.body.rfq_execution_snapshot.wave_instance_id,
    rfqAuditEventId: result.body.rfq_execution_snapshot.audit_identity.event_id,
    softCap: 3,
    eligibleCount: result.body.landscape.eligible_count,
    displayedCount: 3,
    truncated: true,
    scarcityOverrideApplied: false,
  });
  assert.ok(
    fixture.calls.some(
      (call) =>
        call.text.includes("INSERT INTO audit_event") &&
        call.values[5] === "result.projected",
    ),
  );
  assert.ok(
    fixture.calls.some((call) =>
      call.text.includes("INSERT INTO projection_serving"),
    ),
  );
  const serving = fixture.calls.find((call) =>
    call.text.includes("INSERT INTO projection_serving"),
  );
  assert.equal(serving.values[3], "consultant");
  assert.match(serving.text, /resource_id,run_id/iu);
  const commitIndex = fixture.calls.findIndex((call) => call.text === "COMMIT");
  const servingIndex = fixture.calls.findIndex((call) =>
    call.text.includes("INSERT INTO projection_serving"),
  );
  const artifactLookupIndex = fixture.calls.findIndex((call) =>
    call.text.includes("FROM artifact a"),
  );
  assert.ok(servingIndex >= 0 && commitIndex > servingIndex);
  assert.ok(artifactLookupIndex > commitIndex);
});

test("tenant/owner invisibility is a neutral 403 before result rows are read", async () => {
  const fixture = repository({ visible: false });
  await assert.rejects(
    fixture.application.getResult(context, runId),
    (error) => error.status === 403 && error.code === "MB-403-RESOURCE",
  );
  assert.equal(
    fixture.calls.some((call) =>
      call.text.includes("SELECT rr.tier_at_submission"),
    ),
    false,
  );
});

test("audit failure rolls back policy and result disclosure", async () => {
  const fixture = repository({ failPolicyAudit: true });
  await assert.rejects(
    fixture.application.getResult(context, runId),
    /audit unavailable/iu,
  );
  assert.equal(fixture.calls.at(-1).text, "ROLLBACK");
  assert.equal(
    fixture.calls.some((call) => call.text === "COMMIT"),
    false,
  );
  assert.equal(
    fixture.calls.some((call) =>
      call.text.includes("INSERT INTO projection_serving"),
    ),
    false,
  );
});

test("projection version conflict fails closed when definition drifts", async () => {
  const fixture = repository({ projectionVersionDrift: true });
  await assert.rejects(
    fixture.application.getResult(context, runId),
    /Projection version definition drifted/iu,
  );
  assert.equal(fixture.calls.at(-1).text, "ROLLBACK");
  assert.equal(
    fixture.calls.some((call) =>
      call.text.includes("INSERT INTO projection_serving"),
    ),
    false,
  );
});

test("historical bound release survives a later runtime configuration rotation", async () => {
  const historical = {
    configId: "00000000-0000-4000-8000-000000000007",
    version: "consultant-soft-cap.historical-7.v1",
    softCap: 7,
    contentSha256: consultantProjectionConfigSha256(7),
  };
  const fixture = repository({ boundConfig: historical });
  const result = await fixture.application.getResult(context, runId);
  assert.equal(result.projectionTier, "consultant");
  assert.equal(result.body.landscape.soft_cap, 7);
  const policyRead = fixture.calls.find((call) =>
    call.text.includes("FROM consultant_result_projection_policy"),
  );
  assert.ok(policyRead);
  assert.deepEqual(policyRead.values, [context.accountId, runId]);
});

test("historical bound release fails closed on its own digest corruption", async () => {
  const corrupted = {
    configId: "00000000-0000-4000-8000-000000000008",
    version: "consultant-soft-cap.corrupt-8.v1",
    softCap: 8,
    contentSha256: Buffer.alloc(32, 8),
  };
  const fixture = repository({ boundConfig: corrupted });
  await assert.rejects(
    fixture.application.getResult(context, runId),
    /projection configuration drifted/iu,
  );
  assert.equal(fixture.calls.at(-1).text, "ROLLBACK");
});

test("historical Standard runs remain Standard-projected after Consultant upgrade", async () => {
  const fixture = repository({
    resultRow: { ...row, tier_at_submission: "standard" },
  });
  const result = await fixture.application.getResult(context, runId);
  assert.equal(result.projectionTier, "standard");
  assert.equal(result.body.schema_version, "standard-result-projection.v1");
  assert.ok(result.body.candidates.length <= 3);
  assert.equal(
    fixture.calls.some((call) =>
      call.text.includes("FROM consultant_result_projection_policy"),
    ),
    false,
  );
});

test("historical Demo runs remain Demo-projected and use their exact legacy digest", async () => {
  const demo = buildSyntheticEvidenceGraph(runId, "many");
  const demoDigest = createHash("sha256").update(JSON.stringify(demo)).digest();
  assert.doesNotThrow(() =>
    assertLegacyDemoResultIntegrity(demo, demoDigest, runId),
  );
  assert.throws(
    () =>
      assertLegacyDemoResultIntegrity(
        { ...demo, runId: randomUUID() },
        demoDigest,
        runId,
      ),
    /identity is invalid/iu,
  );
  const fixture = repository({
    resultRow: {
      ...row,
      tier_at_submission: "demo",
      complete_result_document: demo,
      result_sha256: demoDigest,
      canonical_document: { fields: [] },
    },
  });
  const result = await fixture.application.getResult(context, runId);
  assert.equal(result.projectionTier, "demo");
  assert.equal(result.body.schema_version, "demo-projection.v1");
  assert.equal(result.body.candidates.length, 3);
  assert.equal("compatibility_score" in result.body.candidates[0], false);
});

test("future live foundation v2 is readable at Demo, Standard, and Consultant tiers", async () => {
  const v2 = buildCompleteResultFoundationV2(graph);
  const v2Row = {
    ...row,
    research_mode: "qualified_live_research",
    complete_result_document: v2,
    result_sha256: standardCompleteResultDocumentSha256(v2),
  };
  for (const [tier, schemaVersion] of [
    ["demo", "demo-projection.v1"],
    ["standard", "standard-result-projection.v1"],
    ["consultant", "consultant-result-projection.v2"],
  ]) {
    const fixture = repository({
      resultRow: { ...v2Row, tier_at_submission: tier },
    });
    const result = await fixture.application.getResult(context, runId);
    assert.equal(result.projectionTier, tier);
    assert.equal(result.body.schema_version, schemaVersion);
    if (tier === "demo") {
      assert.equal("compatibility_score" in result.body.candidates[0], false);
      assert.match(
        result.body.candidates[0].rationale_short,
        /mandatory matching rules/iu,
      );
    }
  }
});
