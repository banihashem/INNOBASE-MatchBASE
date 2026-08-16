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

export interface QualifiedProviderResult {
  readonly body: unknown;
  readonly routeSnapshot: ResearchRouteSnapshotV1;
}

class QualifiedGeminiDirectAdapter {
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
  ): Promise<QualifiedProviderResult> {
    const route = resolveActiveResearchRoute(
      this.policy,
      this.routeId,
      execution.capturedAt,
    );
    if (route.path !== "gemini_direct") {
      throw new Error(
        "Qualified Gemini adapter requires a direct Gemini route.",
      );
    }
    const requestInput = validateQualifiedResearchRequest(input);
    const response = await executeProviderRequest({
      route: {
        routeId: route.routeId,
        providerId: "gemini_direct",
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
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.requestedModelId)}:generateContent`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: route.requestedModelId,
          contents: [
            {
              role: "user",
              parts: [
                { text: requestInput.canonicalEnglishRequest },
                ...(requestInput.sanitizedEvidence.length > 0
                  ? [
                      {
                        text: serializeSanitizedEvidence(
                          requestInput.sanitizedEvidence,
                        ),
                      },
                    ]
                  : []),
              ],
            },
          ],
          tools: [{ google_search: {} }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: requestInput.outputSchema,
            maxOutputTokens: route.parameterPolicy.maxOutputTokens,
          },
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
            "Gemini served provider/model identity outside the frozen route.",
          );
        }
      },
    });
    const identity = response.servedIdentity;
    if (!identity) throw new Error("Gemini response omitted served identity.");
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

export function createQualifiedGeminiDirectAdapter(input: {
  policy: ResearchRoutePolicyV1;
  routeId: string;
  activatedAt: string;
  transport: ProviderTransport;
  onAttempt: AttemptObserver;
  backoff?: Backoff;
}): QualifiedGeminiDirectAdapter {
  const route = resolveActiveResearchRoute(
    input.policy,
    input.routeId,
    input.activatedAt,
  );
  if (route.path !== "gemini_direct") {
    throw new Error("Qualified Gemini adapter requires a direct Gemini route.");
  }
  if (typeof input.onAttempt !== "function") {
    throw new Error(
      "Qualified Gemini adapter requires a mandatory attempt ledger.",
    );
  }
  return new QualifiedGeminiDirectAdapter(
    input.policy,
    input.routeId,
    input.transport,
    input.onAttempt,
    input.backoff,
  );
}
