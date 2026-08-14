import type {
  CanonicalFieldV1,
  CanonicalRequestV1,
  EvidenceGraphV1,
  LanguageMetadataV1,
} from "@matchbase/contracts";

export interface LanguageIdentificationInput {
  sourceText: string;
}

export type CapabilityInvocationOutcome =
  | "ok"
  | "schema_violation"
  | "refusal"
  | "provider_error"
  | "timeout"
  | "circuit_open"
  | "cancelled";

export interface CapabilityInvocationTelemetry {
  attemptId: string;
  capabilityId:
    | "CAP-LANGUAGE-ID"
    | "CAP-TRANSLATE"
    | "CAP-SEARCH"
    | "CAP-STRUCTURED-GENERATION";
  providerId: string;
  routeId: string;
  modelId: string;
  environment: "local" | "test" | "staging" | "production";
  routeKind: "real_data" | "synthetic_fixture";
  dataHandlingPosture:
    "synthetic_fixture" | "zdr_verified" | "paid_no_training" | "unknown";
  timeoutMs: number;
  configuredMaxAttempts: number;
  configuredBackoffMs: number;
  allowFallbacks: boolean;
  attemptNumber: number;
  fallback: boolean;
  retryBackoffMs: number;
  startedAt: string;
  completedAt: string;
  outcome: CapabilityInvocationOutcome;
  quantity: number;
  unit: string;
  amount: number | "unknown";
  currency: string | null;
  pricingBasis: string;
  pricingVersion: string;
  pricingState: "priced" | "explicit_zero" | "unknown" | "unpriced";
  measurement: "measured" | "estimated";
}

export interface CapabilityTelemetrySink {
  record(event: CapabilityInvocationTelemetry): void | Promise<void>;
}

export interface LanguageIdentifier {
  readonly capabilityId: "CAP-LANGUAGE-ID";
  identify(
    input: LanguageIdentificationInput,
    telemetry: CapabilityTelemetrySink,
  ): Promise<LanguageMetadataV1>;
}

export interface CanonicalizationInput {
  requestId: string;
  sourceText: string;
  presentedFields: readonly string[];
  fixtureCanonicalText: string;
  fixtureCanonicalFields: readonly CanonicalFieldV1[];
}

export interface CanonicalizationCapability {
  readonly capabilityId: "CAP-TRANSLATE";
  canonicalize(
    input: CanonicalizationInput,
    signal: AbortSignal,
    telemetry: CapabilityTelemetrySink,
  ): Promise<CanonicalRequestV1>;
}

export interface ResearchInput {
  runId: string;
  fixtureCase: "zero" | "one" | "two" | "three" | "many";
}

export interface ResearchCapability {
  readonly capabilityId: "CAP-SEARCH";
  research(input: ResearchInput): Promise<EvidenceGraphV1>;
}

export interface StructuredGenerationInput {
  claimIds: readonly string[];
  facts: Readonly<Record<string, string>>;
}

export interface StructuredGenerationCapability<TOutput> {
  readonly capabilityId: "CAP-STRUCTURED-GENERATION";
  generate(
    input: StructuredGenerationInput,
    signal: AbortSignal,
  ): Promise<TOutput>;
}
