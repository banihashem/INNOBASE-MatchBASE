import type {
  ProviderRouteV1,
  ResearchRoutePolicyV1,
  ResearchRouteSnapshotV1,
} from "@matchbase/contracts";
import {
  createResearchRouteSnapshot,
  resolveActiveResearchRoute,
} from "../research-route-policy.js";
import {
  serializeSanitizedEvidence,
  validateQualifiedResearchRequest,
  type QualifiedResearchRequest,
} from "../qualified-research-input.js";
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

export interface QualifiedOpenRouterResult {
  readonly body: unknown;
  readonly routeSnapshot: ResearchRouteSnapshotV1;
}

class QualifiedOpenRouterAdapter {
  constructor(
    readonly policy: ResearchRoutePolicyV1,
    readonly routeId: string,
    private readonly transport: ProviderTransport,
    private readonly onAttempt: AttemptObserver,
    private readonly backoff?: Backoff,
  ) {}

  async generateStructured(
    input: QualifiedResearchRequest,
    execution: Readonly<{
      runId: string;
      snapshotId: string;
      capturedAt: string;
    }>,
    signal: AbortSignal,
  ): Promise<QualifiedOpenRouterResult> {
    const route = resolveActiveResearchRoute(
      this.policy,
      this.routeId,
      execution.capturedAt,
    );
    if (route.path !== "openrouter") {
      throw new Error(
        "Qualified OpenRouter adapter requires an OpenRouter route.",
      );
    }
    const requestInput = validateQualifiedResearchRequest(input);
    if (requestInput.sanitizedEvidence.length === 0) {
      throw new Error(
        "OpenRouter requires externally fetched sanitized evidence.",
      );
    }
    const response = await executeProviderRequest({
      route: {
        routeId: route.routeId,
        providerId: "openrouter",
        modelId: route.requestedModelId,
        enabled: true,
        environment: this.policy.environment,
        realData: true,
        billingPath: "paid_verified",
        retentionPosture:
          route.dataHandling.retentionTrainingPosture === "verified_zdr"
            ? "zdr"
            : "no_training_30d_logs",
        dataHandlingEvidenceRefs: [...route.dataHandling.evidenceRefs],
        timeoutMs: route.parameterPolicy.timeoutMs,
        retry: {
          maxAttempts: route.parameterPolicy.maxAttempts,
          backoffMs: route.parameterPolicy.backoffMs,
        },
        requireParameters: true,
        allowFallbacks: false,
        capabilities: ["CAP-SEARCH", "CAP-STRUCTURED-GENERATION"],
      },
      transport: this.transport,
      signal,
      onAttempt: this.onAttempt,
      ...(this.backoff ? { backoff: this.backoff } : {}),
      request: (attemptSignal) => ({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: route.requestedModelId,
          provider: {
            order: [route.providerId],
            require_parameters: true,
            allow_fallbacks: false,
          },
          messages: [
            { role: "user", content: requestInput.canonicalEnglishRequest },
            {
              role: "user",
              content: serializeSanitizedEvidence(
                requestInput.sanitizedEvidence,
              ),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: requestInput.outputSchema,
          },
          max_tokens: route.parameterPolicy.maxOutputTokens,
          temperature: route.parameterPolicy.temperature,
        }),
        signal: attemptSignal,
      }),
      validateResponse: (candidate) => {
        const servedIdentity = candidate.servedIdentity;
        if (
          servedIdentity?.providerId !== route.providerId ||
          servedIdentity?.modelId !== route.expectedServedModelId
        ) {
          throw new Error(
            "OpenRouter served provider/model identity outside the frozen route.",
          );
        }
      },
    });
    const identity = response.servedIdentity;
    if (!identity)
      throw new Error("OpenRouter response omitted served identity.");
    return {
      body: response.body,
      routeSnapshot: createResearchRouteSnapshot({
        policy: this.policy,
        route,
        snapshotId: execution.snapshotId,
        runId: execution.runId,
        servedProviderId: identity.providerId,
        servedModelId: identity.modelId,
        terminalDisposition: "ok",
        capturedAt: execution.capturedAt,
      }),
    };
  }
}

export function createQualifiedOpenRouterAdapter(input: {
  policy: ResearchRoutePolicyV1;
  routeId: string;
  activatedAt: string;
  transport: ProviderTransport;
  onAttempt: AttemptObserver;
  backoff?: Backoff;
}): QualifiedOpenRouterAdapter {
  const route = resolveActiveResearchRoute(
    input.policy,
    input.routeId,
    input.activatedAt,
  );
  if (route.path !== "openrouter") {
    throw new Error(
      "Qualified OpenRouter adapter requires an OpenRouter route.",
    );
  }
  if (typeof input.onAttempt !== "function") {
    throw new Error(
      "Qualified OpenRouter adapter requires a mandatory attempt ledger.",
    );
  }
  return new QualifiedOpenRouterAdapter(
    input.policy,
    input.routeId,
    input.transport,
    input.onAttempt,
    input.backoff,
  );
}
