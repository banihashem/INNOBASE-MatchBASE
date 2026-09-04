import type {
  AdminSubRole,
  CanonicalFieldV1,
  ConsultantResultProjectionV1,
  ConsultantResultProjectionV2,
  DemoProjectionV1,
  PersistedTier,
  StandardResultProjectionV1,
} from "@matchbase/contracts";

export const API_MINOR_VERSION = "2026-08-14";
export const TERMINAL_RUN_STATES = new Set([
  "complete",
  "no_responsible_match",
  "failed",
  "cancelled",
  "superseded",
]);

export type { AdminSubRole, PersistedTier } from "@matchbase/contracts";

export interface RequestContext {
  accountId: string;
  userId: string;
  tier: PersistedTier;
  adminSubRoles: readonly AdminSubRole[];
  correlationId: string;
  deploymentId: string;
}

export interface IntakeInput {
  sourceText: string;
  fixtureCanonicalText: string;
  fixtureCanonicalFields: CanonicalFieldV1[];
  presentedFields: string[];
}

export interface CanonicalRevisionInput {
  canonicalText: string;
  fields: CanonicalFieldV1[];
  readiness: "ready" | "partially_ready" | "not_ready";
}

export interface RunStatus {
  run_id: string;
  request_id: string;
  canonical_request_version: number;
  state: string;
  phase: string;
  phase_label: string;
  progress: {
    steps_completed: number;
    steps_total_planned: number;
    monotonic_sequence: number;
    percent_complete: number | null;
  };
  started_at: string | null;
  updated_at: string;
  estimated_completion_at: null;
  poll_after_ms: number | null;
  terminal: boolean;
  result_available: boolean;
  projection_version: 1;
  links: {
    self: string;
    result: string | null;
    cancel: string;
  };
}

export interface ResultDisclosure {
  body:
    | DemoProjectionV1
    | StandardResultProjectionV1
    | ConsultantResultProjectionV1
    | ConsultantResultProjectionV2;
  auditId: string;
}

export class ApplicationFault extends Error {
  constructor(
    readonly status: number,
    readonly typeSuffix: string,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly headers: Readonly<Record<string, string>> = {},
    readonly auditRecorded = false,
  ) {
    super(message);
    this.name = "ApplicationFault";
  }
}
