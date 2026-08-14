export const COST_EVENT_SCHEMA_VERSION = "cost-event.v1" as const;

export interface CostEventV1 {
  schemaVersion: typeof COST_EVENT_SCHEMA_VERSION;
  costEventId: string;
  attemptId: string;
  runId: string | null;
  canonicalizationRunId: string | null;
  userId: string;
  accountId: string;
  capabilityId: string;
  providerId: string;
  modelId: string;
  environment: string;
  quantity: number;
  unit: string;
  amount: number | "unknown";
  currency: string;
  pricingBasis: string;
  pricingVersion: string;
  measurement: "provider_reported" | "estimated" | "explicit_fixture_zero";
  occurredAt: string;
}
