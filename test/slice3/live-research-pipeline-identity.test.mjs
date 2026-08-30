import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  admitLiveResearchProviderCall,
  assertApprovedLiveResearchOutputSchema,
  canonicalLiveResearchOutputSchemaSha256,
  createLiveResearchPipelineIdentity,
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
  LiveResearchExecutionService,
  LiveResearchPipelineIdentityDrift,
} from "../../packages/application/dist/index.js";

const schemaWithShuffledKeys = Object.freeze({
  additionalProperties: false,
  properties: {
    gateEvaluationCompletedAt: { type: "string" },
    eligibleCandidateIds: { items: { type: "string" }, type: "array" },
    evidence: { type: "array" },
    claims: { type: "array" },
    candidates: { type: "array" },
    schemaVersion: { const: "evidence-graph.v1" },
    runId: { type: "string" },
  },
  required: [
    "schemaVersion",
    "runId",
    "candidates",
    "claims",
    "evidence",
    "eligibleCandidateIds",
    "gateEvaluationCompletedAt",
  ],
  type: "object",
});

const identity = () =>
  createLiveResearchPipelineIdentity({
    outputSchema: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
    researchRoutePolicyId: "10000000-0000-4000-8000-000000000001",
    routePolicyVersion: "2026-08-24.1",
    routePolicyCanonicalSha256: "a".repeat(64),
    modelPolicyVersionId: "20000000-0000-4000-8000-000000000002",
    modelPolicyVersion: "model-2026-08-24.1",
    modelPolicyContentSha256: "b".repeat(64),
    scoringConfigVersionId: "30000000-0000-4000-8000-000000000003",
    scoringConfigVersion: "scoring-2026-08-24.1",
    scoringConfigContentSha256: "c".repeat(64),
  });

test("canonical output-schema hash is independent of object key insertion order", () => {
  assert.equal(
    identity().outputSchemaCanonicalSha256,
    canonicalLiveResearchOutputSchemaSha256(schemaWithShuffledKeys),
  );
  assert.throws(
    () =>
      assertApprovedLiveResearchOutputSchema({
        ...LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
        additionalProperties: true,
      }),
    /not server-approved/,
  );
});

test("unchanged pinned pipeline identity admits exactly one provider call", async () => {
  let providerCalls = 0;
  const result = await admitLiveResearchProviderCall(
    structuredClone(identity()),
    identity(),
    async () => {
      providerCalls += 1;
      return "provider-result";
    },
  );
  assert.equal(result, "provider-result");
  assert.equal(providerCalls, 1);
});

test("unapproved first output schema is rejected before DB or provider admission", async () => {
  let databaseCalls = 0;
  let providerCalls = 0;
  const service = new LiveResearchExecutionService({
    pool: {
      query: async () => {
        databaseCalls += 1;
        throw new Error("database must not run");
      },
    },
    accountId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000002",
    policyId: "30000000-0000-4000-8000-000000000003",
    resolver: async () => [],
    accessEvaluator: async () => "denied",
    fetchTransport: async () => {
      providerCalls += 1;
      throw new Error("transport must not run");
    },
    sourceDiscovery: {
      discover: async () => {
        providerCalls += 1;
        throw new Error("provider must not run");
      },
    },
    providerTransports: {
      gemini_direct: {
        send: async () => {
          providerCalls += 1;
          throw new Error("provider must not run");
        },
      },
      openrouter: {
        send: async () => {
          providerCalls += 1;
          throw new Error("provider must not run");
        },
      },
    },
    circuit: { isRouteAvailable: async () => true },
    validateOutput: (value) => value,
  });
  await assert.rejects(
    service.execute({
      policy: {},
      executionId: "FIRST-PIN-REJECT",
      runId: "40000000-0000-4000-8000-000000000004",
      capturedAt: "2026-08-25T00:00:00.000Z",
      outputSchema: { type: "object" },
      signal: new AbortController().signal,
    }),
    /not server-approved/,
  );
  assert.equal(databaseCalls, 0);
  assert.equal(providerCalls, 0);
});

for (const [field, driftedValue] of [
  ["outputSchemaIdentifier", "evidence-graph.v2"],
  ["outputSchemaCanonicalSha256", "1".repeat(64)],
  ["researchRoutePolicyId", "10000000-0000-4000-8000-000000000099"],
  ["routePolicyVersion", "2026-08-25.1"],
  ["routePolicyCanonicalSha256", "2".repeat(64)],
  ["modelPolicyVersionId", "20000000-0000-4000-8000-000000000099"],
  ["modelPolicyVersion", "model-2026-08-25.1"],
  ["modelPolicyContentSha256", "3".repeat(64)],
  ["scoringConfigVersionId", "30000000-0000-4000-8000-000000000099"],
  ["scoringConfigVersion", "scoring-2026-08-25.1"],
  ["scoringConfigContentSha256", "4".repeat(64)],
  ["extractionVersion", "untrusted-source-boundary.v2"],
]) {
  test(`${field} drift fails before provider call`, async () => {
    let providerCalls = 0;
    const current = { ...identity(), [field]: driftedValue };
    await assert.rejects(
      admitLiveResearchProviderCall(identity(), current, async () => {
        providerCalls += 1;
        return "must-not-run";
      }),
      (error) => {
        assert.ok(error instanceof LiveResearchPipelineIdentityDrift);
        assert.equal(error.field, field);
        return true;
      },
    );
    assert.equal(providerCalls, 0);
  });
}

test("missing historical pin fails closed before provider call", async () => {
  let providerCalls = 0;
  await assert.rejects(
    admitLiveResearchProviderCall(null, identity(), async () => {
      providerCalls += 1;
      return "must-not-run";
    }),
    /pipeline identity is unavailable/,
  );
  assert.equal(providerCalls, 0);
});

test("every live transport runs inside an authoritative locked admission", async () => {
  const [source, migration] = await Promise.all([
    readFile(
      new URL(
        "../../packages/application/src/live-research-execution.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../packages/data/migrations/0005_task_137_live_pipeline_identity.up.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    source,
    /ledger\.withPipelineIdentityAdmission\([\s\S]{0,500}sourceDiscovery\.discover/,
  );
  assert.match(
    source,
    /ledger\.withPipelineIdentityAdmission\([\s\S]{0,300}transport\.send\(request\)/,
  );
  assert.match(
    source,
    /ledger\.withPipelineIdentityAdmission\([\s\S]{0,500}secureFetch\(\{/,
  );
  assert.match(
    source,
    /JOIN model_policy_version mp[\s\S]{0,300}JOIN scoring_config_version sc/,
  );
  assert.match(source, /FOR SHARE OF r,mp,sc,rp/);
  assert.match(
    migration,
    new RegExp(LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256),
  );
});
