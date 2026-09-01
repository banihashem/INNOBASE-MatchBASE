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
  user_display_name?: string | null;
  email?: string | null;
  subject?: { user_id: string; account_id: string };
  tier: "demo" | "standard" | "consultant" | "admin";
  admin_sub_roles?: string[];
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

export function userFacingSessionName(session: {
  display_name: string;
  user_display_name?: string | null;
  subject?: { user_id: string };
}): string {
  const verifiedName = session.user_display_name?.trim();
  if (verifiedName && verifiedName.toLocaleLowerCase("en") !== "google user")
    return verifiedName;
  const accountName = session.display_name.trim();
  if (accountName && accountName.toLocaleLowerCase("en") !== "google user")
    return accountName;
  return session.subject?.user_id
    ? `User ${session.subject.user_id.slice(0, 8)}`
    : "Verified Google account";
}

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
  | "requests"
  | "profile"
  | "intake"
  | "canonical"
  | "running"
  | "result"
  | "help";

export const SYNTHETIC_NOTICE =
  "Synthetic evaluation data — not a sourcing result";
