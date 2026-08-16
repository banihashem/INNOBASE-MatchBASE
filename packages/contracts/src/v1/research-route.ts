export const RESEARCH_ROUTE_POLICY_SCHEMA_VERSION =
  "research-route-policy.v1" as const;
export const RESEARCH_ROUTE_SNAPSHOT_SCHEMA_VERSION =
  "research-route-snapshot.v1" as const;

export type ResearchRouteEnvironment =
  "local" | "test" | "staging" | "production";
export type ResearchRoutePath = "gemini_direct" | "openrouter";
export type ResearchCapability =
  | "query_planning"
  | "web_search_grounding"
  | "retrieval"
  | "structured_extraction"
  | "advisory_synthesis";

export interface ResearchRouteParameterPolicyV1 {
  readonly policyVersion: string;
  readonly searchMode:
    "provider_native_web_search" | "external_sanitized_evidence";
  readonly structuredOutput: "json_schema";
  readonly requireParameters: true;
  readonly allowFallbacks: false;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
}

export interface ResearchRouteDataHandlingV1 {
  readonly evidenceVersion: string;
  readonly evidenceRefs: readonly string[];
  readonly evidenceAccessedAt: string;
  readonly evidenceExpiresAt: string;
  readonly paidPath: "verified" | "unverified";
  readonly retentionTrainingPosture:
    "verified_no_training" | "verified_zdr" | "unknown";
}

export interface ResearchRouteCostPolicyV1 {
  readonly pricingState: "known" | "unknown";
  readonly pricingVersion: string;
  readonly currency: string;
  readonly accountingMode:
    "provider_reported" | "conservative_estimate" | "unavailable";
}

export interface ResearchRouteDefinitionV1 {
  readonly routeId: string;
  readonly adapterId: ResearchRoutePath;
  readonly adapterVersion: string;
  readonly path: ResearchRoutePath;
  readonly providerId: string;
  readonly requestedModelId: string;
  readonly expectedServedModelId: string;
  readonly enabled: boolean;
  readonly liveQualified: boolean;
  readonly fallbackPosition: number;
  readonly capabilities: readonly ResearchCapability[];
  readonly parameterPolicy: ResearchRouteParameterPolicyV1;
  readonly dataHandling: ResearchRouteDataHandlingV1;
  readonly costPolicy: ResearchRouteCostPolicyV1;
}

export interface ResearchRoutePolicyV1 {
  readonly schemaVersion: typeof RESEARCH_ROUTE_POLICY_SCHEMA_VERSION;
  readonly policyVersion: string;
  readonly capabilityPolicyVersion: string;
  readonly environment: ResearchRouteEnvironment;
  readonly evaluatedAt: string;
  readonly liveActivation: "enabled" | "blocked";
  readonly routes: readonly ResearchRouteDefinitionV1[];
}

export interface ResearchRouteSnapshotV1 {
  readonly schemaVersion: typeof RESEARCH_ROUTE_SNAPSHOT_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly runId: string;
  readonly policyVersion: string;
  readonly routeId: string;
  readonly adapterId: ResearchRoutePath;
  readonly adapterVersion: string;
  readonly path: ResearchRoutePath;
  readonly providerId: string;
  readonly requestedModelId: string;
  readonly expectedServedProviderId: string;
  readonly expectedServedModelId: string;
  readonly servedProviderId: string | null;
  readonly servedModelId: string | null;
  readonly terminalDisposition: "ok" | "failed" | "cancelled";
  readonly capabilityPolicyVersion: string;
  readonly parameterPolicy: ResearchRouteParameterPolicyV1;
  readonly dataHandlingEvidenceVersion: string;
  readonly fallbackPosition: number;
  readonly capturedAt: string;
}
