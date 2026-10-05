export type WorkflowIdentity = {
  account_id: string;
  user_id: string;
  tier: string;
};

/** MB-UX-QUALITY-002 L03: consume the actual /api/v1/me subject envelope. */
export function readWorkflowIdentity(value: unknown): WorkflowIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  const subject = envelope.subject;
  if (!subject || typeof subject !== "object" || Array.isArray(subject))
    return null;
  const { account_id, user_id } = subject as Record<string, unknown>;
  const { tier } = envelope;
  if (
    typeof account_id !== "string" ||
    !account_id.trim() ||
    typeof user_id !== "string" ||
    !user_id.trim() ||
    typeof tier !== "string" ||
    !["demo", "standard", "consultant", "admin"].includes(tier)
  )
    return null;
  return { account_id, user_id, tier };
}
