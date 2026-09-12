/** MB-UX-QUALITY-001 L08: retain controlled diagnostics, never raw provider errors. */
export type ResponseFailureKind =
  "provider_error" | "empty_response" | "refusal" | "incomplete_response";

const transientTypes = new Set([
  "rate_limit_exceeded",
  "provider_overloaded",
  "provider_unavailable",
  "server",
  "timeout",
]);
const refusalTypes = new Set(["content_policy_violation", "refusal"]);
const terminalTypes = new Set([
  "authentication",
  "permission_denied",
  "payment_required",
  "context_length_exceeded",
  "max_tokens_exceeded",
  "token_limit_exceeded",
  "string_too_long",
  "invalid_request",
  "invalid_prompt",
  "not_found",
  "precondition_failed",
  "payload_too_large",
  "unprocessable",
]);
const nativeReasons = new Set([
  "RECITATION",
  "SAFETY",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "MODEL_ARMOR",
  "STOP",
  "MAX_TOKENS",
  "OTHER",
  "MALFORMED_FUNCTION_CALL",
  "UNEXPECTED_TOOL_CALL",
  "CANCELLED",
  "FINISH_REASON_UNSPECIFIED",
]);
const blockedNativeReasons = new Set([
  "RECITATION",
  "SAFETY",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "MODEL_ARMOR",
]);
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function normalizedNativeFinishReason(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const reason = value.toUpperCase();
  return nativeReasons.has(reason) ? reason : undefined;
}

export function classifyResponseFailure(input: {
  readonly errors: readonly unknown[];
  readonly finish_reason?: string;
  readonly native_finish_reason?: string;
  readonly refusal?: unknown;
  readonly text: unknown;
}): { kind: ResponseFailureKind; error_type?: string } | undefined {
  const errors = input.errors.filter((error) => error != null);
  const classifications = errors.map((error) => {
    const item = record(error);
    const type = record(item.metadata).error_type;
    const serialized = JSON.stringify(error).toLowerCase();
    // Known denial categories take priority even if a gateway reports HTTP 500.
    if (typeof type === "string") {
      if (refusalTypes.has(type))
        return { kind: "refusal" as const, error_type: type };
      if (terminalTypes.has(type))
        return { kind: "incomplete_response" as const, error_type: type };
      if (
        transientTypes.has(type) &&
        ![400, 401, 402, 403, 404, 413, 422].includes(Number(item.code))
      )
        return { kind: "provider_error" as const, error_type: type };
      return { kind: "incomplete_response" as const, error_type: "unknown" };
    }
    if (
      /recitation|content.?filter|content.?policy|\brefusal\b|\bsafety\b|moderation|guardrail/.test(
        serialized,
      )
    )
      return { kind: "refusal" as const, error_type: "refusal" };
    if (
      [401, 402].includes(Number(item.code)) ||
      /api.?key|authenticat|unauthori|permission|insufficient|payment|credit|privacy|\bzdr\b|unsupported|not.support|no.endpoints/.test(
        serialized,
      )
    )
      return {
        kind: "incomplete_response" as const,
        error_type: "permission_denied",
      };
    if ([400, 404, 413, 422].includes(Number(item.code)))
      return {
        kind: "incomplete_response" as const,
        error_type: "invalid_request",
      };
    if ([408, 429, 500, 502, 503, 504, 529].includes(Number(item.code)))
      return {
        kind: "provider_error" as const,
        error_type:
          Number(item.code) === 429
            ? "rate_limit_exceeded"
            : "provider_unavailable",
      };
    return { kind: "incomplete_response" as const, error_type: "unknown" };
  });
  // A simultaneous provider block does not waive a separate authorization,
  // billing or request restriction, even when diagnostic metadata says RECITATION.
  const restriction = classifications.find((entry) =>
    terminalTypes.has(entry.error_type),
  );
  if (restriction) return restriction;
  if (input.native_finish_reason === "CANCELLED")
    return { kind: "incomplete_response", error_type: "unknown" };
  const explicitRefusal =
    input.finish_reason === "content_filter" ||
    input.finish_reason === "refusal" ||
    (input.refusal != null && input.refusal !== "") ||
    classifications.some((entry) => entry.kind === "refusal");
  const recitationOnly =
    input.native_finish_reason === "RECITATION" &&
    !explicitRefusal &&
    classifications.every((entry) => entry.kind === "provider_error") &&
    !errors.some((error) => Number(record(error).code) === 403);
  if (recitationOnly) return { kind: "refusal", error_type: "recitation" };
  if (
    explicitRefusal ||
    blockedNativeReasons.has(input.native_finish_reason ?? "") ||
    classifications.some((entry) => entry.kind === "refusal")
  )
    return { kind: "refusal", error_type: "refusal" };
  // L09: these provider generation defects are technical tool-call failures,
  // not consent or content-policy decisions. Mixed unknown/restricted errors
  // remain terminal instead of gaining retry authority from a native reason.
  if (
    ["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"].includes(
      input.native_finish_reason ?? "",
    ) &&
    classifications.every((entry) => entry.kind === "provider_error")
  )
    return {
      kind: "provider_error",
      error_type: input.native_finish_reason!.toLowerCase(),
    };
  if (
    input.native_finish_reason &&
    input.native_finish_reason !== "STOP" &&
    input.finish_reason !== "length"
  )
    return { kind: "incomplete_response", error_type: "unknown" };
  const terminal = classifications.find(
    (entry) => entry.kind === "incomplete_response",
  );
  if (terminal) return terminal;
  if (classifications.length) return classifications[0];
  // A bare generation error has no evidence that automatic replay is safe.
  if (input.finish_reason && !["stop", "length"].includes(input.finish_reason))
    return { kind: "incomplete_response", error_type: "unknown" };
  if (typeof input.text !== "string" || !input.text.trim())
    return { kind: "empty_response" };
  return undefined;
}
