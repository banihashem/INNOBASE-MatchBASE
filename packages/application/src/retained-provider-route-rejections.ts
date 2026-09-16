import type { ProviderHttpFailure } from "./provider-http-failure.js";
import type { DefinitiveProviderRouteRejection } from "./openrouter-model-policy.js";

export interface ProviderRouteCheckpointEvent {
  readonly phase: string;
  readonly detail: Record<string, unknown>;
}

const requestFormats = new Set(["json_schema", "json_object", "text"]);
const failureCategories = new Set([
  "authentication",
  "billing",
  "permission",
  "privacy",
  "refusal",
  "context_limit",
  "schema_compatibility",
  "unsupported_parameters",
  "rate_limit",
  "endpoint_unavailable",
  "web_unavailable",
  "unknown",
]);

function parseProviderHttpFailure(value: unknown): ProviderHttpFailure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const failure = value as Record<string, unknown>;
  if (
    !Number.isInteger(failure.http_status) ||
    Number(failure.http_status) < 400 ||
    Number(failure.http_status) > 599 ||
    typeof failure.request_format !== "string" ||
    !requestFormats.has(failure.request_format) ||
    typeof failure.category !== "string" ||
    !failureCategories.has(failure.category)
  )
    return null;
  return structuredClone(value) as ProviderHttpFailure;
}

function expectedDiscoveryPhase(model: string): string {
  const family = model.split("/")[0];
  return `discovery_${family === "google" ? "gemini" : family === "x-ai" ? "xai" : family}`;
}

function expectedProviderPhase(phase: string, model: string): boolean {
  return (
    phase === expectedDiscoveryPhase(model) ||
    phase === "research_focus_analysis"
  );
}

/**
 * Derive only definitive no-receipt route rejections from ordered checkpoints.
 * A later completion for the exact phase/model clears an older rejection.
 */
export function retainedProviderRouteRejections(
  events: readonly ProviderRouteCheckpointEvent[],
): DefinitiveProviderRouteRejection[] {
  const retained = new Map<string, DefinitiveProviderRouteRejection>();
  for (const event of events) {
    const detail = event.detail;
    const model =
      typeof detail.requested_model === "string"
        ? detail.requested_model
        : typeof detail.model === "string"
          ? detail.model
          : null;
    if (!model || !expectedProviderPhase(event.phase, model)) continue;
    const key = `${event.phase}\u0000${model}`;
    if (detail.state === "completed") {
      retained.delete(key);
      continue;
    }
    const providerHttpFailure = parseProviderHttpFailure(
      detail.provider_http_failure,
    );
    if (
      detail.state !== "failed" ||
      detail.dispatched !== true ||
      detail.provider_dispatch_rejected !== true ||
      detail.provider_receipt_received !== false ||
      !providerHttpFailure
    )
      continue;
    retained.set(key, {
      model,
      phase: event.phase,
      error:
        typeof detail.error === "string"
          ? detail.error.slice(0, 2000)
          : "The provider route rejected the request before returning a response.",
      provider_http_failure: providerHttpFailure,
    });
  }
  return [...retained.values()];
}
