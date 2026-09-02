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
  qualifiedResearchOutputInstruction,
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

const OPENROUTER_PROVIDER_FIELDS = new Set([
  "zdr",
  "data_collection",
  "only",
  "order",
  "require_parameters",
  "allow_fallbacks",
]);

export interface OpenRouterProviderRequestPolicy {
  readonly zdr: true;
  readonly data_collection: "deny";
  readonly only: readonly string[];
  readonly order: readonly string[];
  readonly require_parameters: true;
  readonly allow_fallbacks: false;
}

export function validateOpenRouterProviderRequestPolicy(
  value: unknown,
  context: Readonly<{
    orderedProviderAllowlist: readonly string[];
    retentionTrainingPosture: string;
    requireParameters: boolean;
    allowFallbacks: boolean;
  }>,
): asserts value is OpenRouterProviderRequestPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenRouter provider policy must be a closed object.");
  }
  const provider = value as Record<string, unknown>;
  const fields = Object.keys(provider);
  if (
    fields.length !== OPENROUTER_PROVIDER_FIELDS.size ||
    fields.some((field) => !OPENROUTER_PROVIDER_FIELDS.has(field))
  ) {
    throw new Error("OpenRouter provider policy contains unsupported fields.");
  }
  const expected = context.orderedProviderAllowlist;
  const only = provider.only;
  const order = provider.order;
  if (
    context.retentionTrainingPosture !== "zdr" &&
    context.retentionTrainingPosture !== "verified_zdr"
  ) {
    throw new Error("OpenRouter provider policy lacks verified ZDR evidence.");
  }
  if (context.requireParameters !== true || context.allowFallbacks !== false) {
    throw new Error(
      "OpenRouter route policy permits parameter or fallback drift.",
    );
  }
  if (
    provider.zdr !== true ||
    provider.data_collection !== "deny" ||
    provider.require_parameters !== true ||
    provider.allow_fallbacks !== false
  ) {
    throw new Error("OpenRouter provider privacy policy mismatch.");
  }
  if (
    expected.length === 0 ||
    new Set(expected).size !== expected.length ||
    expected.some((item) => typeof item !== "string" || !item) ||
    !Array.isArray(only) ||
    !Array.isArray(order) ||
    only.length !== expected.length ||
    order.length !== expected.length ||
    only.some((item, index) => item !== expected[index]) ||
    order.some((item, index) => item !== expected[index])
  ) {
    throw new Error("OpenRouter provider allowlist/order mismatch.");
  }
}

function closedOpenRouterProviderPolicy(
  context: Parameters<typeof validateOpenRouterProviderRequestPolicy>[1],
): OpenRouterProviderRequestPolicy {
  const allowlist = Object.freeze([...context.orderedProviderAllowlist]);
  const policy = Object.freeze({
    zdr: true as const,
    data_collection: "deny" as const,
    only: allowlist,
    order: allowlist,
    require_parameters: true as const,
    allow_fallbacks: false as const,
  });
  validateOpenRouterProviderRequestPolicy(policy, context);
  return policy;
}

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
    const provider = closedOpenRouterProviderPolicy({
      orderedProviderAllowlist: [this.route.providerId],
      retentionTrainingPosture: this.route.retentionPosture,
      requireParameters: this.route.requireParameters,
      allowFallbacks: this.route.allowFallbacks,
    });
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
          provider,
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
    const provider = closedOpenRouterProviderPolicy({
      orderedProviderAllowlist: [route.providerId],
      retentionTrainingPosture: route.dataHandling.retentionTrainingPosture,
      requireParameters: route.parameterPolicy.requireParameters,
      allowFallbacks: route.parameterPolicy.allowFallbacks,
    });
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
          provider,
          messages: [
            {
              role: "user",
              content: qualifiedResearchOutputInstruction({
                runId: execution.runId,
                capturedAt: execution.capturedAt,
                canonicalEnglishRequest: requestInput.canonicalEnglishRequest,
              }),
            },
            {
              role: "user",
              content: serializeSanitizedEvidence(
                requestInput.sanitizedEvidence,
              ),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "matchbase_evidence_graph_v1",
              strict: false,
              schema: requestInput.outputSchema,
            },
          },
          ...(route.requestedModelId === "openai/gpt-5.4-mini"
            ? { max_completion_tokens: route.parameterPolicy.maxOutputTokens }
            : { max_tokens: route.parameterPolicy.maxOutputTokens }),
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
