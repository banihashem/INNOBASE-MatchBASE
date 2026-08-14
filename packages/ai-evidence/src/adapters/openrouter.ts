import type { ProviderRouteV1 } from "@matchbase/contracts";
import { validateProviderRoute } from "../route-policy.js";
import {
  executeProviderRequest,
  type AttemptObserver,
  type Backoff,
  type ProviderTransport,
} from "../transport.js";

class OpenRouterAdapter {
  constructor(
    readonly route: ProviderRouteV1,
    private readonly transport: ProviderTransport,
    private readonly onAttempt: AttemptObserver,
    private readonly backoff?: Backoff,
  ) {
    if (route.providerId !== "openrouter") {
      throw new Error("OpenRouterAdapter requires an openrouter route.");
    }
  }

  async generateStructured(
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!this.route.enabled) throw new Error("OpenRouter route is disabled.");
    const response = await executeProviderRequest({
      route: this.route,
      transport: this.transport,
      signal,
      onAttempt: this.onAttempt,
      ...(this.backoff ? { backoff: this.backoff } : {}),
      request: (attemptSignal) => ({
        url: "https://openrouter.invalid/api/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.route.modelId,
          provider: { require_parameters: true, allow_fallbacks: false },
          response_format: { type: "json_schema", json_schema: input },
        }),
        signal: attemptSignal,
      }),
      validateResponse: (candidate) => {
        const body = candidate.body as { model?: unknown };
        if (body.model !== this.route.modelId) {
          throw new Error(
            "OpenRouter served a model outside the configured route.",
          );
        }
      },
    });
    return response.body;
  }
}

export function createOpenRouterAdapter(input: {
  route: ProviderRouteV1;
  transport: ProviderTransport;
  onAttempt: AttemptObserver;
  backoff?: Backoff;
}): OpenRouterAdapter {
  validateProviderRoute(input.route, input.route.environment);
  if (typeof input.onAttempt !== "function")
    throw new Error("OpenRouter adapter requires a mandatory attempt ledger.");
  if (input.route.providerId !== "openrouter")
    throw new Error("OpenRouter adapter requires an openrouter route.");
  return new OpenRouterAdapter(
    input.route,
    input.transport,
    input.onAttempt,
    input.backoff,
  );
}
