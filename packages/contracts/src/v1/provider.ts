export const PROVIDER_REGISTRY_SCHEMA_VERSION = "provider-registry.v1" as const;

export type CapabilityId =
  | "CAP-LANGUAGE-ID"
  | "CAP-TRANSLATE"
  | "CAP-SEARCH"
  | "CAP-STRUCTURED-GENERATION";

export type RetentionPosture =
  "zdr" | "no_training_30d_logs" | "unknown" | "not_applicable";

export interface RetryPolicyV1 {
  maxAttempts: number;
  backoffMs: number;
}

export interface ProviderRouteV1 {
  routeId: string;
  providerId: "gemini_direct" | "openrouter" | "synthetic_fixture";
  modelId: string;
  enabled: boolean;
  environment: "local" | "test" | "staging" | "production";
  realData: boolean;
  billingPath: "paid_verified" | "not_applicable";
  retentionPosture: RetentionPosture;
  dataHandlingEvidenceRefs: string[];
  timeoutMs: number;
  retry: RetryPolicyV1;
  requireParameters: boolean;
  allowFallbacks: boolean;
  capabilities: CapabilityId[];
}

export interface ProviderRegistryV1 {
  schemaVersion: typeof PROVIDER_REGISTRY_SCHEMA_VERSION;
  registryVersion: string;
  environment: "local" | "test" | "staging" | "production";
  realData: boolean;
  routes: ProviderRouteV1[];
}

export interface CapabilityAttemptV1 {
  attemptId: string;
  runId: string | null;
  canonicalizationRunId: string | null;
  userId: string;
  accountId: string;
  capabilityId: CapabilityId;
  providerId: string;
  routeId: string;
  modelId: string;
  environment: string;
  startedAt: string;
  completedAt: string;
  outcome: "ok" | "failed" | "timed_out";
}
