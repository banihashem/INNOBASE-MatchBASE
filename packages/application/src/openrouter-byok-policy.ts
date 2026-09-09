import { setTimeout } from "node:timers/promises";

// MB-UX-LIVE-001 L02. Provider-reported metadata is separate from model content.
// https://openrouter.ai/docs/guides/features/router-metadata
// https://openrouter.ai/docs/api/api-reference/generations/get-generation
export interface OpenRouterByokAudit {
  readonly requested_provider: string;
  readonly actual_provider: string | null;
  readonly is_byok: boolean | null;
  readonly upstream_inference_cost: number | null;
  readonly byok_verification_source: "response" | "generation" | "unverified";
  readonly generation_metadata_attempts: number;
}

export class OpenRouterByokError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly audit?: OpenRouterByokAudit,
  ) {
    super(message);
    this.name = "OpenRouterByokError";
  }
}

const PROVIDER_NAMES: Readonly<Record<string, readonly string[]>> = {
  openai: ["OpenAI"],
  azure: ["Azure"],
  "google-ai-studio": ["Google AI Studio"],
  "google-vertex": ["Google", "Google Vertex"],
  anthropic: ["Anthropic"],
  deepseek: ["DeepSeek"],
  "x-ai": ["xAI", "xAI (Grok)", "SpaceXAI"],
  xai: ["xAI", "xAI (Grok)", "SpaceXAI"],
};

export function getConfiguredProviderRoute(model: string): string {
  let extra: unknown;
  try {
    extra = JSON.parse(process.env.MATCHBASE_PROVIDER_ROUTES || "{}");
  } catch {
    throw new OpenRouterByokError(
      "MB-503-LIVE-PROVIDER-CONFIG",
      "The server provider-route mapping is invalid.",
    );
  }
  const configured =
    extra && typeof extra === "object" && !Array.isArray(extra)
      ? (extra as Record<string, unknown>)[model.split("/")[0]!]
      : undefined;
  if (
    typeof configured === "string" &&
    /^[a-z][a-z0-9-]{1,60}$/.test(configured)
  )
    return configured;
  const family = model.startsWith("google/")
    ? "GOOGLE"
    : model.startsWith("openai/")
      ? "OPENAI"
      : model.startsWith("anthropic/")
        ? "ANTHROPIC"
        : model.startsWith("deepseek/")
          ? "DEEPSEEK"
          : model.startsWith("x-ai/")
            ? "XAI"
            : null;
  const provider = family
    ? process.env[`MATCHBASE_PROVIDER_${family}`]?.trim()
    : undefined;
  if (
    !provider ||
    !PROVIDER_NAMES[provider] ||
    (family === "GOOGLE" && !provider.startsWith("google-")) ||
    (family === "OPENAI" && !["openai", "azure"].includes(provider)) ||
    (family === "ANTHROPIC" && provider !== "anthropic") ||
    (family === "DEEPSEEK" && provider !== "deepseek") ||
    (family === "XAI" && !["xai", "x-ai"].includes(provider))
  )
    throw new OpenRouterByokError(
      "MB-503-LIVE-PROVIDER-CONFIG",
      "An explicit supported server provider route is required for this model family.",
    );
  return provider;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function cost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
function providerName(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-zA-Z][a-zA-Z0-9 ._/-]{0,79}$/.test(value)
    ? value
    : null;
}
function isExpectedProvider(name: string, requested: string): boolean {
  return (
    name.toLowerCase().replace(/[ -]/g, "") ===
      requested.toLowerCase().replace(/[ -]/g, "") ||
    Boolean(PROVIDER_NAMES[requested]?.includes(name))
  );
}

export async function auditOpenRouterByok(input: {
  readonly envelope: unknown;
  readonly generation_id: string | null;
  readonly requested_model: string;
  readonly allowed_model_ids: readonly string[];
  readonly requested_provider: string;
  readonly api_key: string;
  readonly signal: AbortSignal;
}): Promise<OpenRouterByokAudit> {
  const envelope = record(input.envelope);
  const routing = record(envelope.openrouter_metadata);
  const available = record(routing.endpoints).available;
  const selected = Array.isArray(available)
    ? available.filter((entry) => record(entry).selected === true)
    : [];
  const selectedProvider =
    selected.length === 1 ? providerName(record(selected[0]).provider) : null;
  const responseProvider = providerName(envelope.provider);
  let audit: OpenRouterByokAudit = {
    requested_provider: input.requested_provider,
    actual_provider: selectedProvider ?? responseProvider,
    is_byok: typeof routing.is_byok === "boolean" ? routing.is_byok : null,
    upstream_inference_cost: cost(
      record(record(envelope.usage).cost_details).upstream_inference_cost,
    ),
    byok_verification_source:
      typeof routing.is_byok === "boolean" ? "response" : "unverified",
    generation_metadata_attempts: 0,
  };
  const fail = (code: string, message: string): never => {
    throw new OpenRouterByokError(code, message, audit);
  };
  const assertProvider = () => {
    if (
      audit.actual_provider &&
      !isExpectedProvider(audit.actual_provider, input.requested_provider)
    )
      fail(
        "MB-502-LIVE-PROVIDER-DRIFT",
        "Actual provider differs from the configured provider route.",
      );
  };
  if (
    !input.allowed_model_ids.includes(String(envelope.model)) ||
    selected.some(
      (entry) => !input.allowed_model_ids.includes(String(record(entry).model)),
    )
  )
    fail(
      "MB-502-LIVE-PROVIDER-DRIFT",
      "Actual model differs from the configured model and its catalog identities.",
    );
  if (
    selected.length > 1 ||
    (routing.requested !== undefined &&
      routing.requested !== input.requested_model) ||
    (routing.attempt !== undefined && routing.attempt !== 1) ||
    (routing.strategy !== undefined && routing.strategy !== "direct") ||
    (selectedProvider &&
      responseProvider &&
      selectedProvider !== responseProvider)
  )
    fail(
      "MB-502-LIVE-PROVIDER-DRIFT",
      "Provider routing metadata did not reconcile with the request.",
    );
  assertProvider();
  if (audit.is_byok === false)
    fail(
      "MB-502-LIVE-BYOK-REQUIRED",
      "Provider reported shared capacity (is_byok=false); Live requires verified BYOK.",
    );
  if (!input.generation_id)
    fail(
      "MB-502-LIVE-BYOK-UNVERIFIED",
      "Provider omitted a verifiable generation identity.",
    );

  // Retry only read-only metadata propagation, never the billed completion.
  for (
    let attempt = 0;
    attempt < 3 &&
    (audit.is_byok === null ||
      audit.actual_provider === null ||
      audit.upstream_inference_cost === null);
    attempt++
  ) {
    if (attempt > 0)
      await setTimeout(attempt * 250, undefined, { signal: input.signal });
    audit = { ...audit, generation_metadata_attempts: attempt + 1 };
    let metadata: Record<string, unknown>;
    try {
      const response = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(input.generation_id!)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.api_key}` },
          redirect: "error",
          signal: AbortSignal.any([input.signal, AbortSignal.timeout(5000)]),
        },
      );
      if (!response.ok) {
        if (
          response.status === 404 ||
          response.status === 429 ||
          response.status >= 500
        )
          continue;
        break;
      }
      metadata = record(record(await response.json()).data);
    } catch {
      if (input.signal.aborted) break;
      continue;
    }
    if (
      metadata.id !== input.generation_id ||
      (typeof envelope.model === "string" && metadata.model !== envelope.model)
    )
      fail(
        "MB-502-LIVE-PROVIDER-DRIFT",
        "Generation metadata does not match the completed request.",
      );
    const actualProvider = providerName(metadata.provider_name);
    const actualByok =
      typeof metadata.is_byok === "boolean" ? metadata.is_byok : null;
    const conflict =
      (audit.actual_provider !== null &&
        actualProvider !== null &&
        audit.actual_provider !== actualProvider) ||
      (audit.is_byok !== null &&
        actualByok !== null &&
        audit.is_byok !== actualByok);
    audit = {
      ...audit,
      actual_provider: actualProvider ?? audit.actual_provider,
      is_byok: actualByok ?? audit.is_byok,
      upstream_inference_cost:
        cost(metadata.upstream_inference_cost) ?? audit.upstream_inference_cost,
      byok_verification_source:
        actualByok !== null ? "generation" : audit.byok_verification_source,
    };
    if (conflict)
      fail(
        "MB-502-LIVE-PROVIDER-DRIFT",
        "Response and generation metadata contradict each other.",
      );
    assertProvider();
    if (audit.is_byok === false)
      fail(
        "MB-502-LIVE-BYOK-REQUIRED",
        "Generation metadata reported shared capacity (is_byok=false).",
      );
  }
  if (audit.is_byok !== true || !audit.actual_provider)
    fail(
      "MB-502-LIVE-BYOK-UNVERIFIED",
      "Provider BYOK usage could not be verified within the metadata retry bound.",
    );
  return audit;
}
