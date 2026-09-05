export interface OpenRouterMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface OpenRouterCompletionParams {
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly temperature?: number;
  readonly plugins?: readonly {
    readonly id: string;
    readonly max_results?: number;
  }[];
  readonly response_format?: { readonly type: "json_object" };
  readonly max_tokens?: number;
}

export interface OpenRouterCompletionResult {
  readonly model: string;
  readonly text: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms: number;
  readonly cost_usd: number;
  readonly live_api_invoked: boolean;
}

export const CANONICAL_MODELS = {
  lane_gemini: "google/gemini-2.5-flash",
  lane_openai: "openai/gpt-4o",
  synthesis: "openai/o3-mini",
  fallback_synthesis: "deepseek/deepseek-v3.2",
} as const;

export function getOpenRouterApiKey(): string | null {
  const key =
    process.env.MATCHBASE_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!key || !key.trim()) return null;
  return key.trim();
}

export async function callOpenRouterCompletion(
  params: OpenRouterCompletionParams,
): Promise<OpenRouterCompletionResult> {
  const apiKey = getOpenRouterApiKey();
  const startTime = Date.now();

  // If no API key is set, fail explicitly without hidden synthetic domain fallback
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is not configured (MATCHBASE_OPENROUTER_API_KEY). Live research cannot be dispatched.",
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const bodyPayload: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens ?? 4000,
    };

    if (params.plugins && params.plugins.length > 0) {
      bodyPayload.plugins = params.plugins;
    }

    if (params.response_format) {
      bodyPayload.response_format = params.response_format;
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://innobase.matchbase.internal",
        "X-Title": "MatchBASE Consultant Research",
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency_ms = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      throw new Error(
        `OpenRouter API returned HTTP ${res.status}: ${errText}. Provider failure must be handled explicitly.`,
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    const inTokens = data.usage?.prompt_tokens ?? 1000;
    const outTokens = data.usage?.completion_tokens ?? 2000;
    const estimatedCost = inTokens * 0.0000003 + outTokens * 0.0000025;

    return {
      model: params.model,
      text: content,
      input_tokens: inTokens,
      output_tokens: outTokens,
      latency_ms,
      cost_usd: Math.round(estimatedCost * 100000) / 100000,
      live_api_invoked: true,
    };
  } catch (err) {
    throw new Error(
      `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}. Provider failure must be handled explicitly.`,
    );
  }
}
