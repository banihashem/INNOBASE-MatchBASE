export const UPGRADE_PROMPT_SCHEMA_VERSION = "upgrade-prompt.v1" as const;

export interface UpgradePromptV1 {
  readonly schema_version: typeof UPGRADE_PROMPT_SCHEMA_VERSION;
  readonly message: "Additional governed MatchBASE capabilities are available on another tier.";
  readonly action: "review_tier_options";
}

const exactKeys = new Set(["schema_version", "message", "action"]);

/**
 * This response is intentionally independent of a result payload. It cannot
 * reveal a restricted candidate, value, score, field name, or eligible count.
 */
export function buildUpgradePrompt(): UpgradePromptV1 {
  return Object.freeze({
    schema_version: UPGRADE_PROMPT_SCHEMA_VERSION,
    message:
      "Additional governed MatchBASE capabilities are available on another tier.",
    action: "review_tier_options",
  });
}

export function assertUpgradePromptSafe(
  value: unknown,
): asserts value is UpgradePromptV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Upgrade prompt must be a closed object.");
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== exactKeys.size ||
    Object.keys(record).some((key) => !exactKeys.has(key)) ||
    record.schema_version !== UPGRADE_PROMPT_SCHEMA_VERSION ||
    record.message !==
      "Additional governed MatchBASE capabilities are available on another tier." ||
    record.action !== "review_tier_options"
  )
    throw new Error(
      "Upgrade prompt contains an unregistered or restricted value.",
    );
}
