export const LIVE_RESEARCH_CREDENTIAL_HANDLES = Object.freeze({
  geminiDirect: "MATCHBASE_GEMINI_API_KEY",
  openrouter: "MATCHBASE_OPENROUTER_API_KEY",
} as const);

export type LiveResearchCredentialHandle =
  (typeof LIVE_RESEARCH_CREDENTIAL_HANDLES)[keyof typeof LIVE_RESEARCH_CREDENTIAL_HANDLES];

const UNSAFE_HANDLE_TEXT = /[\s\p{Cc}\p{Cf}]/u;

export function providerCredentialHandlePresent(
  environment: Readonly<Record<string, string | undefined>>,
  name: LiveResearchCredentialHandle,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(environment, name)) return false;
  const value = environment[name];
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !UNSAFE_HANDLE_TEXT.test(value)
  );
}
