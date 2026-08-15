import type {
  DomainPackResolutionV1,
  DomainPackV1,
  StandardRequestHistoryV1,
  StandardRequestDetailV1,
  StandardResultProjectionV1,
  StandardRunHistoryV1,
  StandardRunProjectionV1,
  StructuredStandardRequestV1,
} from "@matchbase/contracts";

export type WorkspaceSession = {
  display_name: string;
  tier: "demo" | "standard" | "consultant" | "admin";
  quota: {
    limit: number | null;
    used: number;
    remaining: number | null;
    next_capacity_at: string | null;
  };
  execution: { active: number; capacity: number };
  research_mode: {
    id: "synthetic_reference" | "qualified_live_research";
    label: "Synthetic reference" | "Qualified live research";
    live_qualified: boolean;
  };
  csrf_token: string;
  environment: "local" | "test";
};

export type {
  DomainPackResolutionV1,
  DomainPackV1,
  StandardRequestHistoryV1,
  StandardRequestDetailV1,
  StandardResultProjectionV1,
  StandardRunHistoryV1,
  StandardRunProjectionV1,
  StructuredStandardRequestV1,
};

export type StandardScreen =
  "requests" | "intake" | "canonical" | "running" | "result" | "help";

export const SYNTHETIC_NOTICE =
  "Synthetic evaluation data — not a sourcing result";
