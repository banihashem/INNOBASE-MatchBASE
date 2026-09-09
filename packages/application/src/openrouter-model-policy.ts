import { createHash, randomUUID } from "node:crypto";
import type { ResearchModelRate } from "@matchbase/contracts";
import { ResearchRoundFault } from "@matchbase/data";
import { Agent } from "undici";
import { fetchPrimaryEvidenceText } from "./live-source-fetch.js";
import {
  auditOpenRouterByok,
  getConfiguredProviderRoute,
  OpenRouterByokError,
  type OpenRouterByokAudit,
} from "./openrouter-byok-policy.js";

export interface OpenRouterMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}
export type JsonSchema = Readonly<Record<string, unknown>>;
export interface OpenRouterCompletionParams {
  readonly approved_rate?: ResearchModelRate;
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly temperature?: number;
  readonly plugins?: readonly {
    readonly id: string;
    readonly engine?: "native" | "exa";
    readonly max_results?: number;
  }[];
  readonly response_format?:
    | { readonly type: "json_object" }
    | {
        readonly type: "json_schema";
        readonly json_schema: {
          readonly name: string;
          readonly strict: true;
          readonly schema: JsonSchema;
        };
      };
  readonly max_tokens?: number;
  readonly reasoning?: {
    readonly effort: "high" | "low";
    readonly exclude: true;
  };
  readonly request_id?: string;
  readonly timeout_ms?: number;
  readonly signal?: AbortSignal;
}
export interface OpenRouterCitation {
  readonly url: string;
  readonly title: string;
  readonly content?: string;
  readonly original_url?: string;
  readonly content_sha256?: string;
}
export interface OpenRouterCompletionResult extends Partial<OpenRouterByokAudit> {
  readonly model: string;
  readonly text: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly finish_reason?: string | undefined;
  readonly reasoning_tokens?: number | undefined;
  readonly latency_ms: number;
  readonly cost_usd: number;
  readonly live_api_invoked: boolean;
  readonly request_id?: string;
  readonly provider_generation_id?: string;
  readonly requested_model?: string;
  readonly citations?: readonly OpenRouterCitation[];
  readonly usage_reported?: boolean;
  readonly cost_reported?: boolean;
}
export const CANONICAL_MODELS = {
  lane_gemini: "google/gemini-3.8-flash",
  lane_openai: "openai/gpt-5.2",
  synthesis: "openai/gpt-5.2",
} as const;
export interface OpenRouterModelCapabilities {
  readonly id: string;
  readonly supported_parameters: readonly string[];
  readonly structured_outputs: boolean;
  readonly reasoning: boolean;
  readonly served_model_ids?: readonly string[];
}
export interface LiveResearchCheckpoint extends Partial<OpenRouterByokAudit> {
  readonly dispatched?: boolean;
  readonly index_validation?: {
    readonly accepted_candidates: number;
    readonly reanchored_names: readonly string[];
    readonly discarded_source_urls: readonly string[];
    readonly rejected_candidates: readonly {
      readonly legal_name: string;
      readonly reason: string;
    }[];
  };
  readonly checkpoint_id: string;
  readonly request_id: string;
  readonly phase: string;
  readonly stage: string;
  readonly loop: number;
  readonly max_loops: number;
  readonly message: string;
  readonly state: "started" | "completed" | "failed";
  readonly requested_model: string;
  readonly model: string;
  readonly actual_model?: string;
  readonly request_hash: string;
  readonly request_timeout_ms?: number;
  readonly request_input_bytes?: number;
  readonly request_output_token_limit?: number;
  readonly provider_generation_id?: string;
  readonly started_at: string;
  readonly completed_at?: string;
  readonly native_web: boolean;
  readonly reasoning_effort: "high" | "low" | "unsupported";
  readonly evidence_urls: readonly string[];
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly finish_reason?: string | undefined;
  readonly reasoning_tokens?: number | undefined;
  readonly cost_usd?: number;
  readonly usage_reported?: boolean;
  readonly cost_reported?: boolean;
  readonly error?: string;
  readonly content_sha256?: string;
  readonly source_content_hashes?: readonly {
    readonly url: string;
    readonly content_sha256: string;
  }[];
  readonly response_content?: string;
  readonly response_truncated?: boolean;
  readonly response_citations?: readonly {
    readonly url: string;
    readonly title: string;
    readonly content_excerpt?: string;
  }[];
}
export interface LiveCallOptions {
  /** Conservative serialized-message byte budget used by the approved call guard. */
  readonly max_input_bytes?: number;
  readonly approved_rates?: readonly ResearchModelRate[];
  readonly max_output_tokens?: number;
  readonly reasoning_effort?: "high" | "low";
  readonly web_engine?: "native" | "exa";
  readonly before_call?: (
    request: OpenRouterCompletionParams,
    web: boolean,
  ) => Promise<void>;
  readonly on_checkpoint?: (
    checkpoint: LiveResearchCheckpoint,
  ) => void | Promise<void>;
  readonly signal?: AbortSignal;
}
function byokCheckpointFields(
  result: OpenRouterCompletionResult,
): Partial<OpenRouterByokAudit> {
  if (!result.requested_provider) return {};
  return {
    requested_provider: result.requested_provider,
    actual_provider: result.actual_provider ?? null,
    is_byok: result.is_byok ?? null,
    upstream_inference_cost: result.upstream_inference_cost ?? null,
    byok_verification_source: result.byok_verification_source ?? "unverified",
    generation_metadata_attempts: result.generation_metadata_attempts ?? 0,
  };
}
export class LiveResearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly audited_response?: OpenRouterCompletionResult,
  ) {
    super(`${code}: ${message}`);
    this.name = "LiveResearchError";
  }
}
export function getOpenRouterApiKey(): string | null {
  return (
    (
      process.env.MATCHBASE_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
    )?.trim() || null
  );
}
export function getConfiguredLiveModels() {
  return {
    lane_gemini:
      process.env.MATCHBASE_MODEL_GEMINI?.trim() ||
      CANONICAL_MODELS.lane_gemini,
    lane_openai:
      process.env.MATCHBASE_MODEL_OPENAI?.trim() ||
      CANONICAL_MODELS.lane_openai,
    preparation:
      process.env.MATCHBASE_MODEL_PREPARATION?.trim() ||
      CANONICAL_MODELS.synthesis,
    synthesis:
      process.env.MATCHBASE_MODEL_SYNTHESIS?.trim() ||
      CANONICAL_MODELS.synthesis,
  };
}
let catalogCache:
  | {
      expires: number;
      credential_fingerprint: string;
      models: readonly OpenRouterModelCapabilities[];
    }
  | undefined;
const endpointCapabilityCache = new Map<
  string,
  {
    expires: number;
    capabilities: OpenRouterModelCapabilities;
  }
>();
export async function getOpenRouterModelCapabilities(
  model: string,
): Promise<OpenRouterModelCapabilities> {
  const credential = getOpenRouterApiKey();
  if (!credential)
    throw new LiveResearchError(
      "MB-503-LIVE-CREDENTIAL",
      "Server OpenRouter credential is not configured.",
    );
  const fingerprint = createHash("sha256").update(credential).digest("hex");
  if (
    !catalogCache ||
    catalogCache.expires < Date.now() ||
    catalogCache.credential_fingerprint !== fingerprint
  ) {
    const response = await fetch("https://openrouter.ai/api/v1/models/user", {
      headers: { Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new LiveResearchError(
        "MB-503-MODEL-CATALOG",
        `Model capability catalog returned HTTP ${response.status}.`,
        true,
      );
    const body = (await response.json()) as {
      data?: { id?: unknown; supported_parameters?: unknown }[];
    };
    if (!Array.isArray(body.data))
      throw new LiveResearchError(
        "MB-502-MODEL-CATALOG",
        "Invalid model catalog response.",
      );
    const models = body.data.flatMap((entry) => {
      if (
        typeof entry.id !== "string" ||
        !Array.isArray(entry.supported_parameters)
      )
        return [];
      return [
        {
          id: entry.id,
          supported_parameters: entry.supported_parameters.filter(
            (parameter): parameter is string => typeof parameter === "string",
          ),
          structured_outputs:
            entry.supported_parameters.includes("structured_outputs"),
          reasoning: entry.supported_parameters.includes("reasoning"),
        },
      ];
    });
    catalogCache = {
      expires: Date.now() + 300000,
      credential_fingerprint: fingerprint,
      models,
    };
  }
  const capabilities = catalogCache.models.find((entry) => entry.id === model);
  if (!capabilities)
    throw new LiveResearchError(
      "MB-422-MODEL-UNAVAILABLE",
      "Configured model is absent from the current provider catalog.",
    );
  const provider = getConfiguredProviderRoute(model);
  const cacheKey = `${fingerprint}:${model}:${provider}`;
  const cachedEndpoint = endpointCapabilityCache.get(cacheKey);
  if (cachedEndpoint && cachedEndpoint.expires > Date.now())
    return cachedEndpoint.capabilities;
  const response = await fetch(
    `https://openrouter.ai/api/v1/models/${model.split("/").map(encodeURIComponent).join("/")}/endpoints`,
    {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new LiveResearchError(
      "MB-503-MODEL-CATALOG",
      `Provider endpoint catalog returned HTTP ${response.status}.`,
      true,
    );
  const body = (await response.json()) as {
    data?: {
      endpoints?: {
        name?: unknown;
        model_id?: unknown;
        tag?: unknown;
        supported_parameters?: unknown;
      }[];
    };
  };
  const endpoints = body.data?.endpoints;
  const matches = Array.isArray(endpoints)
    ? endpoints.filter(
        (entry) =>
          typeof entry.tag === "string" &&
          (entry.tag === provider ||
            (entry.tag.startsWith(`${provider}/`) &&
              !/\/(flex|fast|priority)$/.test(entry.tag))) &&
          Array.isArray(entry.supported_parameters),
      )
    : [];
  if (!matches.length)
    throw new LiveResearchError(
      "MB-422-MODEL-CAPABILITY",
      "Configured provider has no supported endpoint for the eligible model.",
    );
  // The authenticated catalog establishes model eligibility. Parameter support
  // comes from the selected provider, never from a different aggregated endpoint.
  const supported = (matches[0]!.supported_parameters as unknown[]).filter(
    (parameter): parameter is string =>
      typeof parameter === "string" &&
      matches.every((entry) =>
        (entry.supported_parameters as unknown[]).includes(parameter),
      ),
  );
  const selectedCapabilities: OpenRouterModelCapabilities = {
    id: model,
    supported_parameters: supported,
    structured_outputs: supported.includes("structured_outputs"),
    reasoning: supported.includes("reasoning"),
    served_model_ids: [
      ...new Set([
        model,
        ...matches.flatMap((entry) => {
          const dated =
            typeof entry.name === "string"
              ? entry.name.split(" | ")[1]?.trim()
              : undefined;
          return entry.model_id === model &&
            dated &&
            dated.startsWith(`${model}-`)
            ? [dated]
            : [];
        }),
      ]),
    ],
  };
  if (endpointCapabilityCache.size >= 100) endpointCapabilityCache.clear();
  endpointCapabilityCache.set(cacheKey, {
    expires: Date.now() + 300000,
    capabilities: selectedCapabilities,
  });
  return selectedCapabilities;
}
export async function validateLiveModelConfiguration() {
  if (!getOpenRouterApiKey())
    throw new LiveResearchError(
      "MB-503-LIVE-CREDENTIAL",
      "Server OpenRouter credential is not configured.",
    );
  const models = getConfiguredLiveModels();
  let providers: string[];
  try {
    providers = Object.values(models).map(getConfiguredProviderRoute);
  } catch (error) {
    if (error instanceof OpenRouterByokError)
      throw new LiveResearchError(error.code, error.message);
    throw error;
  }
  if (
    !models.lane_gemini.startsWith("google/gemini-") ||
    !models.lane_openai.startsWith("openai/")
  )
    throw new LiveResearchError(
      "MB-422-MODEL-CAPABILITY",
      "Discovery requires separate Gemini and OpenAI models.",
    );
  const capabilities = await Promise.all(
    Object.values(models).map(getOpenRouterModelCapabilities),
  );
  for (const id of [models.preparation, models.synthesis]) {
    if (
      !capabilities.find((capability) => capability.id === id)
        ?.structured_outputs
    )
      throw new LiveResearchError(
        "MB-422-MODEL-CAPABILITY",
        "Preparation and synthesis require structured output support.",
      );
  }
  return { models, capabilities, providers };
}
export function safePublicEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !new Set(["http:", "https:"]).has(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const host = url.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".invalid") ||
      host.endsWith(".example") ||
      /^\d+(?:\.\d+){3}$/.test(host) ||
      host.includes(":")
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
const DEFAULT_COMPLETION_TIMEOUT_MS = 180000;
const RESEARCH_COMPLETION_TIMEOUT_MS = 600000;
const longResearchPhases = new Set([
  "discovery_gemini",
  "discovery_openai",
  "verification",
  "discovery_gemini_extraction",
  "discovery_openai_extraction",
  "verification_extraction",
  "synthesis",
]);
function validateCompletionTimeout(timeoutMs: number): number {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > RESEARCH_COMPLETION_TIMEOUT_MS
  )
    throw new LiveResearchError(
      "MB-422-LIVE-TIMEOUT",
      "Provider request timeout must be a positive integer no greater than 600000 ms.",
    );
  return timeoutMs;
}
function providerErrorCategory(body: string, model: string): string {
  const normalized = body.toLowerCase().replace(/\\"/g, '"');
  if (
    model.startsWith("openai/") &&
    /\btool\s+["']?web_search_preview["']?\s+(?:is\s+)?disabled for this organization\b/.test(
      normalized,
    ) &&
    normalized.includes("hosted-tools")
  )
    return "OpenAI organization permissions disable the hosted web_search_preview tool";
  if (
    /zero.?data.?retention|\bzdr\b|privacy.*polic|data.*polic/.test(normalized)
  )
    return "account privacy policy has no compatible endpoint";
  if (
    /unsupported.*param|parameter.*not.*support|require.parameters/.test(
      normalized,
    )
  )
    return "requested parameters are unsupported by available endpoints";
  if (
    /insufficient.*credit|payment|required.*credit|insufficient.*fund/.test(
      normalized,
    )
  )
    return "provider credit limit prevents execution";
  if (/rate.limit|too.many.requests/.test(normalized))
    return "provider rate limit";
  if (/api.key|authentication|unauthori/.test(normalized))
    return "provider credential is not accepted";
  if (/native.*search|web.*search.*support/.test(normalized))
    return "native web search is unavailable on the selected endpoint";
  if (/no.endpoints|model.*unavailable|model.*not.found/.test(normalized))
    return "no compatible model endpoint is available";
  return "provider rejected the request";
}
export async function callOpenRouterCompletion(
  params: OpenRouterCompletionParams,
): Promise<OpenRouterCompletionResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey)
    throw new LiveResearchError(
      "MB-503-LIVE-CREDENTIAL",
      "Server OpenRouter credential is not configured.",
    );
  const startTime = Date.now();
  const requestId = params.request_id ?? randomUUID();
  const timeoutMs = validateCompletionTimeout(
    params.timeout_ms === undefined
      ? DEFAULT_COMPLETION_TIMEOUT_MS
      : params.timeout_ms,
  );
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = params.signal
    ? AbortSignal.any([params.signal, timeout])
    : timeout;
  let auditedResponse: OpenRouterCompletionResult | undefined;
  let dispatcher: Agent | undefined;
  try {
    signal.throwIfAborted();
    const provider = getConfiguredProviderRoute(params.model);
    if (params.approved_rate && params.approved_rate.provider !== provider)
      throw new LiveResearchError(
        "MB-409-ROUND-PROVIDER",
        "Provider route changed after cost approval.",
      );
    const capabilities = await getOpenRouterModelCapabilities(params.model);
    signal.throwIfAborted();
    const supported = new Set(capabilities.supported_parameters);
    const tokenParameter = supported.has("max_completion_tokens")
      ? "max_completion_tokens"
      : supported.has("max_tokens")
        ? "max_tokens"
        : null;
    if (!tokenParameter)
      throw new LiveResearchError(
        "MB-422-MODEL-CAPABILITY",
        "The configured endpoint does not advertise a supported output-token limit.",
      );
    dispatcher = new Agent({
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://innobase.matchbase.internal",
        "X-Title": "MatchBASE Consultant Research",
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(params.temperature !== undefined && supported.has("temperature")
          ? { temperature: params.temperature }
          : {}),
        [tokenParameter]: params.max_tokens ?? 12000,
        ...(params.plugins?.length ? { plugins: params.plugins } : {}),
        ...(params.response_format
          ? { response_format: params.response_format }
          : {}),
        ...(params.reasoning ? { reasoning: params.reasoning } : {}),
        provider: {
          ...(params.approved_rate
            ? {
                max_price: {
                  prompt: params.approved_rate.input_usd_per_token * 1000000,
                  completion:
                    params.approved_rate.output_usd_per_token * 1000000,
                  request: params.approved_rate.request_usd,
                },
              }
            : {}),
          only: [provider],
          order: [provider],
          require_parameters: true,
          allow_fallbacks: false,
        },
      }),
      signal,
      dispatcher,
    };
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      fetchOptions,
    );
    // Provider bodies may echo credentials or user input. Expose only controlled error codes.
    if (!response.ok) {
      const category = providerErrorCategory(
        await response.text().catch(() => ""),
        params.model,
      );
      const webPermissionDenied =
        category ===
        "OpenAI organization permissions disable the hosted web_search_preview tool";
      throw new LiveResearchError(
        webPermissionDenied
          ? "MB-403-LIVE-WEB-PERMISSION"
          : "MB-502-LIVE-PROVIDER",
        `Provider returned HTTP ${response.status}: ${category}.`,
        !webPermissionDenied &&
          (response.status === 429 || response.status >= 500),
      );
    }
    const data = (await response.json()) as {
      id?: string;
      provider?: unknown;
      openrouter_metadata?: unknown;
      model?: string;
      error?: unknown;
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string;
          annotations?: {
            type?: string;
            url_citation?: {
              url?: unknown;
              title?: unknown;
              content?: unknown;
            };
          }[];
        };
      }[];
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        completion_tokens_details?: { reasoning_tokens?: unknown };
        cost?: unknown;
        cost_details?: unknown;
      };
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    const citations: OpenRouterCitation[] = [];
    for (const annotation of choice?.message?.annotations ?? []) {
      const citation = annotation.url_citation;
      if (
        annotation.type !== "url_citation" ||
        typeof citation?.url !== "string"
      )
        continue;
      const url = safePublicEvidenceUrl(citation.url);
      if (!url || citations.some((entry) => entry.url === url)) continue;
      citations.push({
        url,
        title:
          typeof citation.title === "string"
            ? citation.title
            : new URL(url).hostname,
        ...(typeof citation.content === "string"
          ? { content: citation.content }
          : {}),
      });
    }
    const usage = data.usage;
    const costReported = finiteNonnegative(usage?.cost);
    const bodyGenerationId = typeof data.id === "string" ? data.id : null;
    const headerGenerationId = response.headers.get("x-generation-id");
    const generationId = bodyGenerationId ?? headerGenerationId;
    auditedResponse = {
      model: typeof data.model === "string" ? data.model : params.model,
      requested_model: params.model,
      request_id: requestId,
      ...(generationId ? { provider_generation_id: generationId } : {}),
      text: typeof text === "string" ? text : "",
      citations,
      ...(choice?.finish_reason ? { finish_reason: choice.finish_reason } : {}),
      ...(finiteNonnegative(usage?.completion_tokens_details?.reasoning_tokens)
        ? {
            reasoning_tokens: usage!.completion_tokens_details!
              .reasoning_tokens as number,
          }
        : {}),
      input_tokens: finiteNonnegative(usage?.prompt_tokens)
        ? usage.prompt_tokens
        : 0,
      output_tokens: finiteNonnegative(usage?.completion_tokens)
        ? usage.completion_tokens
        : 0,
      cost_usd: costReported ? (usage!.cost as number) : 0,
      usage_reported:
        finiteNonnegative(usage?.prompt_tokens) &&
        finiteNonnegative(usage?.completion_tokens),
      cost_reported: costReported,
      latency_ms: Date.now() - startTime,
      live_api_invoked: true,
    };
    if (
      bodyGenerationId &&
      headerGenerationId &&
      bodyGenerationId !== headerGenerationId
    )
      throw new LiveResearchError(
        "MB-502-LIVE-PROVIDER-DRIFT",
        "Response generation identities differ.",
        false,
        auditedResponse,
      );
    const audit = await auditOpenRouterByok({
      envelope: data,
      generation_id: generationId,
      requested_model: params.model,
      allowed_model_ids: capabilities.served_model_ids ?? [params.model],
      requested_provider: provider,
      api_key: apiKey,
      signal,
    });
    auditedResponse = { ...auditedResponse, ...audit };
    if (choice?.finish_reason === "length")
      throw new LiveResearchError(
        "MB-422-LIVE-OUTPUT-LIMIT",
        `Provider exhausted the approved output allowance (${auditedResponse.output_tokens} output tokens, ${auditedResponse.reasoning_tokens ?? "unknown"} reasoning tokens). The incomplete response and usage are retained. Review a fresh estimate before another attempt.`,
        false,
        auditedResponse,
      );
    if (
      data.error ||
      typeof text !== "string" ||
      !text.trim() ||
      (choice?.finish_reason && choice.finish_reason !== "stop")
    )
      throw new LiveResearchError(
        "MB-502-LIVE-RESPONSE",
        "Provider returned an empty, incomplete, or refused response.",
        true,
        auditedResponse,
      );
    return auditedResponse;
  } catch (error) {
    const transportCause = error instanceof Error ? error.cause : undefined;
    const transportTimedOut =
      transportCause !== null &&
      typeof transportCause === "object" &&
      "code" in transportCause &&
      (transportCause.code === "UND_ERR_HEADERS_TIMEOUT" ||
        transportCause.code === "UND_ERR_BODY_TIMEOUT");
    if (signal.aborted || transportTimedOut) {
      const cancelledByCaller =
        params.signal?.aborted && signal.reason === params.signal.reason;
      throw new LiveResearchError(
        "MB-503-LIVE-TRANSPORT",
        cancelledByCaller
          ? "Provider request was cancelled by caller."
          : `Provider request exceeded the ${timeoutMs} ms timeout.`,
        !cancelledByCaller,
        auditedResponse,
      );
    }
    if (error instanceof OpenRouterByokError)
      throw new LiveResearchError(
        error.code,
        error.message,
        false,
        auditedResponse ? { ...auditedResponse, ...error.audit } : undefined,
      );
    if (error instanceof LiveResearchError) throw error;
    throw new LiveResearchError(
      "MB-503-LIVE-TRANSPORT",
      "Provider transport or response decoding failed.",
      true,
      auditedResponse,
    );
  } finally {
    await dispatcher?.destroy();
  }
}
export async function runLiveCompletion(
  request: Omit<OpenRouterCompletionParams, "reasoning">,
  context: {
    phase: string;
    loop: number;
    max_loops?: number;
    require_web?: boolean;
    reasoning_effort?: "high" | "low";
  },
  options: LiveCallOptions = {},
): Promise<OpenRouterCompletionResult> {
  if (options.max_output_tokens)
    request = {
      ...request,
      max_tokens: Math.min(
        request.max_tokens ?? 12000,
        options.max_output_tokens,
      ),
    };
  const effort = options.reasoning_effort ?? context.reasoning_effort ?? "high";
  const checkpointId = randomUUID();
  let auditedResponse: OpenRouterCompletionResult | undefined;
  let checkpoint: LiveResearchCheckpoint = {
    dispatched: false,
    checkpoint_id: checkpointId,
    request_id: checkpointId,
    phase: context.phase,
    stage: context.phase,
    loop: context.loop,
    max_loops: context.max_loops ?? 1,
    message: `${context.phase} request started.`,
    state: "started",
    requested_model: request.model,
    model: request.model,
    request_hash: createHash("sha256")
      .update(JSON.stringify(request.messages))
      .digest("hex"),
    request_input_bytes:
      Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 512,
    request_output_token_limit: request.max_tokens ?? 12000,
    started_at: new Date().toISOString(),
    native_web: Boolean(context.require_web) && options.web_engine !== "exa",
    reasoning_effort: "unsupported",
    evidence_urls: [],
  };
  try {
    const timeoutMs = validateCompletionTimeout(
      request.timeout_ms === undefined
        ? longResearchPhases.has(context.phase)
          ? RESEARCH_COMPLETION_TIMEOUT_MS
          : DEFAULT_COMPLETION_TIMEOUT_MS
        : request.timeout_ms,
    );
    checkpoint = { ...checkpoint, request_timeout_ms: timeoutMs };
    if (!getOpenRouterApiKey())
      throw new LiveResearchError(
        "MB-503-LIVE-CREDENTIAL",
        "Server OpenRouter credential is not configured.",
      );
    const capabilities = await getOpenRouterModelCapabilities(request.model);
    if (
      request.response_format?.type === "json_schema" &&
      !capabilities.structured_outputs
    )
      throw new LiveResearchError(
        "MB-422-MODEL-CAPABILITY",
        "Configured model does not advertise structured output support.",
      );
    if (
      context.require_web &&
      options.web_engine !== "exa" &&
      !/^(google\/gemini-|openai\/)/.test(request.model)
    )
      throw new LiveResearchError(
        "MB-422-MODEL-CAPABILITY",
        "Discovery requires configured Gemini or OpenAI native web models.",
      );
    checkpoint = {
      ...checkpoint,
      reasoning_effort: capabilities.reasoning ? effort : "unsupported",
      requested_provider: getConfiguredProviderRoute(request.model),
      actual_provider: null,
      is_byok: null,
      upstream_inference_cost: null,
      byok_verification_source: "unverified",
      generation_metadata_attempts: 0,
    };
    await options.before_call?.(request, Boolean(context.require_web));
    checkpoint = { ...checkpoint, dispatched: true };
    await options.on_checkpoint?.(checkpoint);
    const callerSignals = [request.signal, options.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    let result = await callOpenRouterCompletion({
      ...request,
      request_id: checkpointId,
      ...(options.approved_rates?.find((rate) => rate.model === request.model)
        ? {
            approved_rate: options.approved_rates.find(
              (rate) => rate.model === request.model,
            )!,
          }
        : {}),
      timeout_ms: timeoutMs,
      ...(capabilities.reasoning
        ? {
            reasoning: {
              effort,
              exclude: true,
            } as const,
          }
        : {}),
      ...(context.require_web
        ? {
            plugins: [
              {
                id: "web",
                engine: options.web_engine ?? "native",
                ...(options.web_engine === "exa" ? { max_results: 8 } : {}),
              },
            ],
          }
        : {}),
      ...(callerSignals.length
        ? { signal: AbortSignal.any(callerSignals) }
        : {}),
    });
    auditedResponse = result;
    if (
      context.require_web &&
      result.citations?.some(
        (citation) =>
          new URL(citation.url).hostname === "vertexaisearch.cloud.google.com",
      )
    ) {
      const resolved: OpenRouterCitation[] = [];
      for (let offset = 0; offset < result.citations.length; offset += 3) {
        const chunk = await Promise.all(
          result.citations.slice(offset, offset + 3).map(async (citation) => {
            if (
              new URL(citation.url).hostname !==
              "vertexaisearch.cloud.google.com"
            )
              return citation;
            const actual = await fetchPrimaryEvidenceText(citation.url).catch(
              () => null,
            );
            return actual
              ? {
                  ...citation,
                  original_url: citation.url,
                  url: actual.url,
                  content: actual.text,
                  content_sha256: actual.content_sha256,
                }
              : citation;
          }),
        );
        resolved.push(...chunk);
      }
      result = {
        ...result,
        citations: [
          ...new Map(
            resolved.map((citation) => [citation.url, citation]),
          ).values(),
        ],
      };
    }
    auditedResponse = result;
    if (context.require_web && !result.citations?.length)
      throw new LiveResearchError(
        "MB-422-LIVE-EVIDENCE",
        "Native web response contained no provider citation annotations.",
      );
    await options.on_checkpoint?.({
      ...checkpoint,
      state: "completed",
      message: `${context.phase} provider response received.`,
      actual_model: result.model,
      model: result.model,
      ...(result.provider_generation_id
        ? { provider_generation_id: result.provider_generation_id }
        : {}),
      completed_at: new Date().toISOString(),
      evidence_urls: (result.citations ?? []).map((citation) => citation.url),
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      finish_reason: result.finish_reason,
      reasoning_tokens: result.reasoning_tokens,
      cost_usd: result.cost_usd,
      ...byokCheckpointFields(result),
      usage_reported: result.usage_reported ?? false,
      cost_reported: result.cost_reported ?? false,
      response_content: result.text.slice(0, 200000),
      response_truncated: result.text.length > 200000,
      response_citations: (result.citations ?? []).map((citation) => ({
        url: citation.url,
        title: citation.title,
        ...(citation.content
          ? { content_excerpt: citation.content.slice(0, 6000) }
          : {}),
      })),
      source_content_hashes: (result.citations ?? []).flatMap((citation) =>
        citation.content_sha256
          ? [{ url: citation.url, content_sha256: citation.content_sha256 }]
          : [],
      ),
    });
    return result;
  } catch (error) {
    if (error instanceof LiveResearchError && error.audited_response)
      auditedResponse = error.audited_response;
    const safeError =
      error instanceof LiveResearchError
        ? error
        : error instanceof OpenRouterByokError ||
            error instanceof ResearchRoundFault
          ? new LiveResearchError(error.code, error.message)
          : new LiveResearchError(
              "MB-503-LIVE-CHECKPOINT",
              "Live research preflight or checkpoint persistence failed.",
            );
    await options.on_checkpoint?.({
      ...checkpoint,
      state: "failed",
      message: `${context.phase} request failed.`,
      completed_at: new Date().toISOString(),
      error: safeError.message,
      ...(auditedResponse
        ? {
            response_content: auditedResponse.text.slice(0, 200000),
            response_truncated: auditedResponse.text.length > 200000,
            actual_model: auditedResponse.model,
            input_tokens: auditedResponse.input_tokens,
            output_tokens: auditedResponse.output_tokens,
            finish_reason: auditedResponse.finish_reason,
            reasoning_tokens: auditedResponse.reasoning_tokens,
            cost_usd: auditedResponse.cost_usd,
            cost_reported: auditedResponse.cost_reported ?? false,
            usage_reported: auditedResponse.usage_reported ?? false,
            provider_generation_id: auditedResponse.provider_generation_id,
            ...byokCheckpointFields(auditedResponse),
            evidence_urls: (auditedResponse.citations ?? []).map(
              (citation) => citation.url,
            ),
          }
        : {}),
    });
    throw safeError;
  }
}
