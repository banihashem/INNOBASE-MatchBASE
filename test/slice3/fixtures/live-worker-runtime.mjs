import {
  GeminiServerOwnedSourceDiscovery,
  LiveResearchExecutionService,
  QualifiedLiveResearchWorkerDispatcher,
} from "../../../packages/application/dist/index.js";
import { randomUUID } from "node:crypto";

export const LIVE_WORKER_FIXTURE_POLICY = Object.freeze({
  schemaVersion: "research-route-policy.v1",
  policyVersion: "slice3-worker-fixture.v1",
  capabilityPolicyVersion: "slice3-capabilities.v1",
  environment: "test",
  evaluatedAt: "2026-08-15T00:00:00.000Z",
  liveActivation: "enabled",
  routes: [
    {
      routeId: "RT-GEMINI-WORKER-FIXTURE-S3-V1",
      adapterId: "gemini_direct",
      adapterVersion: "slice3-adapter.v1",
      path: "gemini_direct",
      providerId: "google",
      requestedModelId: "gemini-2.5-flash",
      expectedServedModelId: "gemini-2.5-flash",
      enabled: true,
      liveQualified: true,
      fallbackPosition: 0,
      capabilities: [
        "query_planning",
        "web_search_grounding",
        "retrieval",
        "structured_extraction",
        "advisory_synthesis",
      ],
      parameterPolicy: {
        policyVersion: "slice3-parameters.v1",
        searchMode: "provider_native_web_search",
        structuredOutput: "json_schema",
        requireParameters: true,
        allowFallbacks: false,
        maxOutputTokens: 2048,
        temperature: 0,
        timeoutMs: 1000,
        maxAttempts: 1,
        backoffMs: 0,
      },
      dataHandling: {
        evidenceVersion: "slice3-provider-evidence.v1",
        evidenceRefs: ["https://example.invalid/official-evidence"],
        evidenceAccessedAt: "2026-08-15T00:00:00.000Z",
        evidenceExpiresAt: "2026-09-15T00:00:00.000Z",
        paidPath: "verified",
        retentionTrainingPosture: "verified_no_training",
      },
      costPolicy: {
        pricingState: "known",
        pricingVersion: "slice3-pricing.v1",
        currency: "USD",
        accountingMode: "conservative_estimate",
      },
    },
    {
      routeId: "RT-OPENROUTER-WORKER-FIXTURE-S3-V1",
      adapterId: "openrouter",
      adapterVersion: "slice3-adapter.v1",
      path: "openrouter",
      providerId: "google",
      requestedModelId: "google/gemini-2.5-flash",
      expectedServedModelId: "google/gemini-2.5-flash",
      enabled: true,
      liveQualified: true,
      fallbackPosition: 1,
      capabilities: [
        "query_planning",
        "web_search_grounding",
        "retrieval",
        "structured_extraction",
        "advisory_synthesis",
      ],
      parameterPolicy: {
        policyVersion: "slice3-parameters.v1",
        searchMode: "external_sanitized_evidence",
        structuredOutput: "json_schema",
        requireParameters: true,
        allowFallbacks: false,
        maxOutputTokens: 2048,
        temperature: 0,
        timeoutMs: 1000,
        maxAttempts: 1,
        backoffMs: 0,
      },
      dataHandling: {
        evidenceVersion: "slice3-provider-evidence.v1",
        evidenceRefs: ["https://example.invalid/official-evidence"],
        evidenceAccessedAt: "2026-08-15T00:00:00.000Z",
        evidenceExpiresAt: "2026-09-15T00:00:00.000Z",
        paidPath: "verified",
        retentionTrainingPosture: "verified_no_training",
      },
      costPolicy: {
        pricingState: "known",
        pricingVersion: "slice3-pricing.v1",
        currency: "USD",
        accountingMode: "conservative_estimate",
      },
    },
  ],
});

const searchAccounting = Object.freeze({
  state: "estimated",
  quantity: 1,
  unit: "search",
  amount: 0.0005,
  currency: "USD",
  pricingVersion: "slice3-pricing.v1",
  measurement: "estimated",
});

const generationAccounting = Object.freeze({
  state: "estimated",
  quantity: 1,
  unit: "request",
  amount: 0.001,
  currency: "USD",
  pricingVersion: "slice3-pricing.v1",
  measurement: "estimated",
});

export async function seedLiveWorkerFixture(pool) {
  await pool.query(
    `INSERT INTO research_route_policy
       (research_route_policy_id,schema_version,policy_version,environment,
        activation_state,official_evidence,qualification_budget)
     VALUES($1,'research-route-policy.v1',$2,'test','qualified',
            '["fixture-a","fixture-b"]','{"max_calls":2,"max_cost_usd":1}')
     ON CONFLICT(policy_version) DO NOTHING`,
    [randomUUID(), LIVE_WORKER_FIXTURE_POLICY.policyVersion],
  );
  for (const route of LIVE_WORKER_FIXTURE_POLICY.routes) {
    const providerRouteId = randomUUID();
    await pool.query(
      `INSERT INTO provider_route
         (provider_route_id,route_id,capability,provider,model_id,environment,
          route_kind,data_handling_posture,timeout_ms,max_attempts,retry_policy,
          config_version,enabled)
       VALUES($1,$2,'CAP-STRUCTURED-GENERATION',$3,$4,'test','real_data',
              'paid_no_training',1000,1,'{}',$5,true)
       ON CONFLICT(route_id,config_version) DO NOTHING`,
      [
        providerRouteId,
        route.routeId,
        route.path,
        route.requestedModelId,
        LIVE_WORKER_FIXTURE_POLICY.policyVersion,
      ],
    );
    const stored = await pool.query(
      `SELECT provider_route_id FROM provider_route
        WHERE route_id=$1 AND config_version=$2`,
      [route.routeId, LIVE_WORKER_FIXTURE_POLICY.policyVersion],
    );
    const storedId = stored.rows[0]?.provider_route_id;
    if (!storedId) throw new Error("Fixture provider route was not persisted.");
    const capabilities =
      route.path === "gemini_direct"
        ? ["CAP-SEARCH", "CAP-STRUCTURED-GENERATION"]
        : ["CAP-STRUCTURED-GENERATION"];
    for (const capability of capabilities) {
      await pool.query(
        `INSERT INTO provider_route_capability(provider_route_id,capability)
         VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [storedId, capability],
      );
    }
  }
}

export async function createLiveWorkerFixture(pool) {
  const discovery = new GeminiServerOwnedSourceDiscovery({
    async send() {
      return {
        status: 200,
        body: {
          sourceUrls: ["https://evidence.example.org/combined-worker"],
        },
        servedIdentity: {
          providerId: "google",
          modelId: "gemini-2.5-flash",
        },
        accounting: searchAccounting,
      };
    },
  });
  return new QualifiedLiveResearchWorkerDispatcher({
    pool,
    policy: LIVE_WORKER_FIXTURE_POLICY,
    outputSchema: { type: "object", additionalProperties: false },
    now: () => new Date("2026-08-15T00:01:00.000Z"),
    serviceFactory: (work, policyId) =>
      new LiveResearchExecutionService({
        pool,
        accountId: work.accountId,
        userId: work.userId,
        policyId,
        resolver: async () => ["93.184.216.34"],
        accessEvaluator: async () => "allowed",
        fetchTransport: async () => {
          const body = new TextEncoder().encode(
            "Bounded public worker fixture evidence.",
          );
          return {
            status: 200,
            headers: { "content-type": "text/plain" },
            body,
            compressedBytes: body.byteLength,
          };
        },
        sourceDiscovery: discovery,
        providerTransports: {
          gemini_direct: {
            async send() {
              return {
                status: 200,
                body: {
                  schemaVersion: "evidence-graph.v1",
                  runId: work.runId,
                  candidates: [],
                  claims: [],
                  evidence: [],
                  eligibleCandidateIds: [],
                  gateEvaluationCompletedAt: "2026-08-15T00:01:00.000Z",
                },
                servedIdentity: {
                  providerId: "google",
                  modelId: "gemini-2.5-flash",
                },
                accounting: generationAccounting,
              };
            },
          },
          openrouter: {
            async send() {
              throw new Error("Fixture fallback must not run.");
            },
          },
        },
        circuit: { isRouteAvailable: async () => true },
        validateOutput: (body) => body,
        backoff: async () => undefined,
      }),
  });
}
