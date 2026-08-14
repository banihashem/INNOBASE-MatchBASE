import type { ProviderRouteV1 } from "@matchbase/contracts";
import { validateProviderRoute } from "../route-policy.js";
import {
  executeProviderRequest,
  type AttemptObserver,
  type Backoff,
  type ProviderTransport,
} from "../transport.js";

class GeminiDirectAdapter {
  constructor(
    readonly route: ProviderRouteV1,
    private readonly transport: ProviderTransport,
    private readonly onAttempt: AttemptObserver,
    private readonly backoff?: Backoff,
  ) {
    if (route.providerId !== "gemini_direct") {
      throw new Error("GeminiDirectAdapter requires a gemini_direct route.");
    }
  }

  async generateStructured(
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!this.route.enabled) throw new Error("Gemini route is disabled.");
    const response = await executeProviderRequest({
      route: this.route,
      transport: this.transport,
      signal,
      onAttempt: this.onAttempt,
      ...(this.backoff ? { backoff: this.backoff } : {}),
      request: (attemptSignal) => ({
        url: "https://generativelanguage.googleapis.invalid/v1beta/models",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.route.modelId,
          generationConfig: { responseMimeType: "application/json" },
          input,
        }),
        signal: attemptSignal,
      }),
    });
    return response.body;
  }
}

export function createGeminiDirectAdapter(input: {
  route: ProviderRouteV1;
  transport: ProviderTransport;
  onAttempt: AttemptObserver;
  backoff?: Backoff;
}): GeminiDirectAdapter {
  validateProviderRoute(input.route, input.route.environment);
  if (typeof input.onAttempt !== "function")
    throw new Error("Gemini adapter requires a mandatory attempt ledger.");
  if (input.route.providerId !== "gemini_direct")
    throw new Error("Gemini adapter requires a gemini_direct route.");
  return new GeminiDirectAdapter(
    input.route,
    input.transport,
    input.onAttempt,
    input.backoff,
  );
}
