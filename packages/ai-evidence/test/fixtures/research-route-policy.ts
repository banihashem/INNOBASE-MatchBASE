import type { ResearchRoutePolicyV1 } from "@matchbase/contracts";

export function qualifiedPolicy(): ResearchRoutePolicyV1 {
  const common = {
    adapterVersion: "slice3-adapter.v2",
    enabled: true,
    liveQualified: true,
    capabilities: [
      "query_planning",
      "web_search_grounding",
      "retrieval",
      "structured_extraction",
      "advisory_synthesis",
    ],
    parameterPolicy: {
      policyVersion: "slice3-parameters.v2",
      searchMode: "provider_native_web_search",
      structuredOutput: "json_schema",
      requireParameters: true,
      allowFallbacks: false,
      maxOutputTokens: 2048,
      timeoutMs: 20_000,
      maxAttempts: 1,
      backoffMs: 0,
    },
    dataHandling: {
      evidenceVersion: "slice3-provider-evidence.v1",
      evidenceRefs: ["https://example.invalid/official-provider-evidence"],
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
  } as const;
  return {
    schemaVersion: "research-route-policy.v1",
    policyVersion: "slice3-routes.v1",
    capabilityPolicyVersion: "slice3-capabilities.v1",
    environment: "test",
    evaluatedAt: "2026-08-15T00:00:00.000Z",
    liveActivation: "enabled",
    routes: [
      {
        ...common,
        routeId: "RT-GEMINI-DIRECT-S3-V1",
        adapterId: "gemini_direct",
        path: "gemini_direct",
        providerId: "google",
        requestedModelId: "gemini-2.5-flash",
        expectedServedModelId: "gemini-2.5-flash",
        fallbackPosition: 0,
      },
      {
        ...common,
        parameterPolicy: {
          ...common.parameterPolicy,
          searchMode: "external_sanitized_evidence",
        },
        dataHandling: {
          ...common.dataHandling,
          retentionTrainingPosture: "verified_zdr",
        },
        routeId: "RT-OPENROUTER-GOOGLE-S3-V1",
        adapterId: "openrouter",
        path: "openrouter",
        providerId: "google",
        requestedModelId: "google/gemini-2.5-flash",
        expectedServedModelId: "google/gemini-2.5-flash",
        fallbackPosition: 1,
      },
    ],
  };
}
