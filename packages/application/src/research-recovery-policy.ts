/** MB-ARCH-IMPLEMENT-001 L01: deterministic incident classification grants no authority. */
export type ResearchRecoveryDisposition =
  | "cancelled"
  | "blocked_by_authority"
  | "outcome_unknown"
  | "bounded_retry"
  | "bounded_content_repair"
  | "incident_required";

export function researchRecoveryDisposition(input: {
  code: string;
  retryable?: boolean;
  dispatched?: boolean;
  provider_receipt_received?: boolean;
  cancelled?: boolean;
  provider_failure_category?: string;
}): ResearchRecoveryDisposition {
  if (
    input.cancelled ||
    ["execution-lease-lost", "user-cancelled"].includes(input.code)
  )
    return "cancelled";
  if (
    ["authentication", "billing", "permission", "privacy", "refusal"].includes(
      input.provider_failure_category ?? "",
    ) ||
    /(?:CREDENTIAL|BYOK|BILLING|ALLOWANCE|APPROVAL|ROUND-PROVIDER|ROUND-MODEL|ROUND-SEARCH-ENGINE|AUTHORITY|RIGHTS|FENCE|DEADLINE|MEMORY|PRIVATE-EVIDENCE|EVIDENCE-WITHDRAWN|RESEARCH-RENEWAL)/u.test(
      input.code,
    )
  )
    return "blocked_by_authority";
  if (
    input.dispatched &&
    !input.provider_receipt_received &&
    [
      "MB-503-LIVE-TRANSPORT",
      "MB-503-LIVE-CHECKPOINT",
      "execution-interrupted",
    ].includes(input.code)
  )
    return "outcome_unknown";
  if (
    [
      "MB-422-LIVE-JSON",
      "MB-422-LIVE-SCHEMA",
      "MB-422-LIVE-OUTPUT-LIMIT",
      "MB-422-LIVE-INDEX",
      "MB-422-LIVE-EXTRACTION-SCOPE",
    ].includes(input.code)
  )
    return "bounded_content_repair";
  if (
    input.retryable &&
    [
      "MB-503-LIVE-TRANSPORT",
      "MB-502-LIVE-PROVIDER",
      "MB-502-LIVE-RESPONSE",
    ].includes(input.code)
  )
    return "bounded_retry";
  return "incident_required";
}
