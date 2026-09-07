import { createHash, randomUUID } from "node:crypto";
import { fetchPrimaryEvidenceText } from "./live-source-fetch.js";

export interface OpenRouterMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}
export type JsonSchema = Readonly<Record<string, unknown>>;
export interface OpenRouterCompletionParams {
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly temperature?: number;
  readonly plugins?: readonly {
    readonly id: string;
    readonly engine?: "native";
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
  readonly reasoning?: { readonly effort: "high"; readonly exclude: true };
  readonly request_id?: string;
  readonly signal?: AbortSignal;
}
export interface OpenRouterCitation {
  readonly url: string;
  readonly title: string;
  readonly content?: string;
  readonly original_url?: string;
  readonly content_sha256?: string;
}
export interface OpenRouterCompletionResult {
  readonly model: string;
  readonly text: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
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
}
export interface LiveResearchCheckpoint {
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
  readonly provider_generation_id?: string;
  readonly started_at: string;
  readonly completed_at?: string;
  readonly native_web: boolean;
  readonly reasoning_effort: "high" | "unsupported";
  readonly evidence_urls: readonly string[];
  readonly input_tokens?: number;
  readonly output_tokens?: number;
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
  readonly on_checkpoint?: (
    checkpoint: LiveResearchCheckpoint,
  ) => void | Promise<void>;
  readonly signal?: AbortSignal;
}
export class LiveResearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
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
  return capabilities;
}
export async function validateLiveModelConfiguration() {
  if (!getOpenRouterApiKey())
    throw new LiveResearchError(
      "MB-503-LIVE-CREDENTIAL",
      "Server OpenRouter credential is not configured.",
    );
  const models = getConfiguredLiveModels();
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
  return { models, capabilities };
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
function providerErrorCategory(body: string): string {
  const normalized = body.toLowerCase();
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
  const timeout = AbortSignal.timeout(180000);
  const signal = params.signal
    ? AbortSignal.any([params.signal, timeout])
    : timeout;
  try {
    const capabilities = await getOpenRouterModelCapabilities(params.model);
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
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://innobase.matchbase.internal",
          "X-Title": "MatchBASE Consultant Research",
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
          provider: { require_parameters: true, allow_fallbacks: false },
        }),
        signal,
      },
    );
    // Provider bodies may echo credentials or user input. Expose only controlled error codes.
    if (!response.ok) {
      const category = providerErrorCategory(
        await response.text().catch(() => ""),
      );
      throw new LiveResearchError(
        "MB-502-LIVE-PROVIDER",
        `Provider returned HTTP ${response.status}: ${category}.`,
        response.status === 429 || response.status >= 500,
      );
    }
    const data = (await response.json()) as {
      id?: string;
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
        cost?: unknown;
      };
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
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
      );
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
    return {
      model: typeof data.model === "string" ? data.model : params.model,
      requested_model: params.model,
      request_id: requestId,
      ...(typeof data.id === "string"
        ? { provider_generation_id: data.id }
        : {}),
      text,
      citations,
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
  } catch (error) {
    if (error instanceof LiveResearchError) throw error;
    throw new LiveResearchError(
      "MB-503-LIVE-TRANSPORT",
      signal.aborted
        ? "Provider request was cancelled or timed out."
        : "Provider transport or response decoding failed.",
      true,
    );
  }
}
export async function runLiveCompletion(
  request: Omit<OpenRouterCompletionParams, "reasoning">,
  context: {
    phase: string;
    loop: number;
    max_loops?: number;
    require_web?: boolean;
  },
  options: LiveCallOptions = {},
): Promise<OpenRouterCompletionResult> {
  const checkpointId = randomUUID();
  let auditedResponse: OpenRouterCompletionResult | undefined;
  let checkpoint: LiveResearchCheckpoint = {
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
    started_at: new Date().toISOString(),
    native_web: Boolean(context.require_web),
    reasoning_effort: "unsupported",
    evidence_urls: [],
  };
  try {
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
      !/^(google\/gemini-|openai\/)/.test(request.model)
    )
      throw new LiveResearchError(
        "MB-422-MODEL-CAPABILITY",
        "Discovery requires configured Gemini or OpenAI native web models.",
      );
    checkpoint = {
      ...checkpoint,
      reasoning_effort: capabilities.reasoning ? "high" : "unsupported",
    };
    await options.on_checkpoint?.(checkpoint);
    let result = await callOpenRouterCompletion({
      ...request,
      request_id: checkpointId,
      ...(capabilities.reasoning
        ? { reasoning: { effort: "high", exclude: true } as const }
        : {}),
      ...(context.require_web
        ? { plugins: [{ id: "web", engine: "native" }] as const }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
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
      cost_usd: result.cost_usd,
      usage_reported: result.usage_reported ?? false,
      cost_reported: result.cost_reported ?? false,
      response_content: result.text.slice(0, 200000),
      response_truncated: result.text.length > 200000,
      response_citations: (result.citations ?? []).map((citation) => ({
        url: citation.url,
        title: citation.title,
        ...(citation.content
          ? { content_excerpt: citation.content.slice(0, 1600) }
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
    const safeError =
      error instanceof LiveResearchError
        ? error
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
            cost_usd: auditedResponse.cost_usd,
            evidence_urls: (auditedResponse.citations ?? []).map(
              (citation) => citation.url,
            ),
          }
        : {}),
    });
    throw safeError;
  }
}
