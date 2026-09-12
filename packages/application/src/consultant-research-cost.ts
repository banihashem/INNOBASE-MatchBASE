import { createHash } from "node:crypto";
import type {
  ResearchCostSummary,
  ResearchDepth,
  ResearchTier,
  ResearchModelRate,
  ResearchRoundPlan,
} from "@matchbase/contracts";
import { ResearchRoundFault } from "@matchbase/data";
import { getConfiguredProviderRoute } from "./openrouter-byok-policy.js";
import { normalizeResearchGaps } from "./research-gap-normalizer.js";
import {
  getConfiguredLiveModels,
  researchSearchEngineForModel,
  getOpenRouterApiKey,
  getOpenRouterModelCapabilities,
  getOpenRouterZdrEndpoints,
  type OpenRouterCompletionParams,
} from "./openrouter-model-policy.js";

export function researchRequestHash(session: {
  approved_request_revision: unknown;
  step3_deep_prompt: unknown;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        session.approved_request_revision,
        session.step3_deep_prompt,
      ]),
    )
    .digest("hex");
}
const validCost = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const precise = (v: number) => Math.round(v * 1e9) / 1e9;
export function summarizeResearchCosts(
  events: readonly {
    execution_id: string;
    phase: string;
    detail: Record<string, unknown>;
  }[],
  demonstration = false,
): ResearchCostSummary {
  const requests = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const d = event.detail;
    if (d.model === "http-primary-source" || typeof d.request_id !== "string")
      continue;
    const existing = requests.get(d.request_id);
    const score = (detail: Record<string, unknown>) =>
      (validCost(detail.cost_usd) ? 4 : 0) +
      (validCost(detail.upstream_inference_cost) ? 4 : 0) +
      (detail.state === "completed" ? 2 : detail.state === "failed" ? 1 : 0);
    if (!existing || score(d) >= score(existing.detail))
      requests.set(d.request_id, event);
  }
  const grouped = new Map<string, (typeof events)[number]>();
  for (const event of requests.values()) {
    const key = String(
      event.detail.provider_generation_id ?? event.detail.request_id,
    );
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, event);
      continue;
    }
    const merged = {
      ...existing.detail,
      ...Object.fromEntries(
        Object.entries(event.detail).filter(
          ([, v]) => v !== null && v !== undefined,
        ),
      ),
    };
    for (const field of ["cost_usd", "upstream_inference_cost"] as const) {
      const values = [existing.detail[field], event.detail[field]].filter(
        validCost,
      );
      if (values.length) merged[field] = Math.max(...values);
      if (new Set(values).size > 1) merged.accounting_conflict = true;
    }
    if (
      existing.detail.cost_reported === true ||
      event.detail.cost_reported === true
    )
      merged.cost_reported = true;
    grouped.set(key, { ...existing, detail: merged });
  }
  const result: ResearchCostSummary = {
    currency: "USD",
    recorded_total_usd: 0,
    openrouter_charge_usd: 0,
    byok_upstream_usd: 0,
    preparation_usd: 0,
    research_usd: 0,
    unpriced_calls: 0,
    calls: 0,
    complete: true,
    by_execution: {},
    disclosure:
      "Recorded API usage, not a provider invoice. BYOK provider costs and OpenRouter charges are shown separately; taxes, credits and external invoice adjustments are not inferred.",
  };
  for (const { execution_id, phase, detail: d } of grouped.values()) {
    if (d.dispatched === false && !d.provider_generation_id) continue;
    result.calls++;
    const platform =
      validCost(d.cost_usd) && d.cost_reported !== false ? d.cost_usd : null;
    const upstream =
      d.is_byok === true && validCost(d.upstream_inference_cost)
        ? d.upstream_inference_cost
        : null;
    const missing =
      d.accounting_conflict === true ||
      platform === null ||
      d.is_byok == null ||
      (d.is_byok === true && upstream === null);
    const amount = (platform ?? 0) + (upstream ?? 0);
    result.openrouter_charge_usd += platform ?? 0;
    result.byok_upstream_usd += upstream ?? 0;
    result.recorded_total_usd += amount;
    if (/step1|advisory|prompt/.test(phase)) result.preparation_usd += amount;
    else result.research_usd += amount;
    result.unpriced_calls += Number(missing);
    const execution = result.by_execution[execution_id] ?? {
      recorded_usd: 0,
      unpriced_calls: 0,
    };
    execution.recorded_usd = precise(execution.recorded_usd + amount);
    execution.unpriced_calls += Number(missing);
    result.by_execution[execution_id] = execution;
  }
  for (const key of [
    "recorded_total_usd",
    "openrouter_charge_usd",
    "byok_upstream_usd",
    "preparation_usd",
    "research_usd",
  ] as const)
    result[key] = precise(result[key]);
  result.complete =
    result.unpriced_calls === 0 && (result.calls > 0 || demonstration);
  if (!result.complete)
    result.disclosure +=
      " Missing or interrupted-call accounting remains pending; the displayed amount is a known subtotal, never a zero-cost assumption.";
  return result;
}

type CatalogModel = {
  id: string;
  supported_parameters: string[];
  pricing?: Record<string, string>;
  architecture?: { output_modalities?: string[] };
};
let catalog:
  { fingerprint: string; expires: number; models: CatalogModel[] } | undefined;
async function userModels() {
  const key = getOpenRouterApiKey();
  if (!key)
    throw new ResearchRoundFault(
      503,
      "MB-503-MODEL-CATALOG",
      "OpenRouter is not configured.",
    );
  const fingerprint = createHash("sha256").update(key).digest("hex");
  if (
    catalog &&
    catalog.fingerprint === fingerprint &&
    catalog.expires > Date.now()
  )
    return catalog.models;
  const response = await fetch("https://openrouter.ai/api/v1/models/user", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok)
    throw new ResearchRoundFault(
      503,
      "MB-503-MODEL-CATALOG",
      "Current account model pricing is unavailable. No research has started.",
    );
  const body = (await response.json()) as { data: CatalogModel[] };
  if (!Array.isArray(body.data))
    throw new Error("Invalid OpenRouter model catalog.");
  catalog = { fingerprint, expires: Date.now() + 300000, models: body.data };
  return body.data;
}
const decimal = (v: unknown) =>
  typeof v === "string" &&
  v.trim() !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;
const extraCreditFamily = (model: string) =>
  /^(anthropic|deepseek|x-ai)\//.test(model);
function hasExplicitProviderConfiguration(model: string): boolean {
  const family = model.split("/")[0]!;
  let routes: unknown;
  try {
    routes = JSON.parse(process.env.MATCHBASE_PROVIDER_ROUTES || "{}");
  } catch {
    return true;
  } // Malformed explicit configuration must never enable credit fallback.
  if (!routes || typeof routes !== "object" || Array.isArray(routes))
    return true;
  const familyEnvironment: Record<string, string> = {
    anthropic: "ANTHROPIC",
    deepseek: "DEEPSEEK",
    "x-ai": "XAI",
  };
  const env = familyEnvironment[family];
  return (
    Object.prototype.hasOwnProperty.call(routes, family) ||
    Boolean(env && process.env[`MATCHBASE_PROVIDER_${env}`]?.trim())
  );
}
function permitsCreditRoute(model: string): boolean {
  return (
    extraCreditFamily(model) &&
    !hasExplicitProviderConfiguration(model) &&
    Boolean(getOpenRouterApiKey())
  );
}
export async function currentResearchModelRate(
  model: string,
): Promise<ResearchModelRate> {
  if (model.includes(":"))
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-VARIANT",
      "This model variant is not supported by synchronous research.",
    );
  const credit = permitsCreditRoute(model);
  let provider = credit ? undefined : getConfiguredProviderRoute(model);
  if (credit && !(await userModels()).some((entry) => entry.id === model))
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-UNAVAILABLE",
      "The selected credit model is not available to this OpenRouter account.",
    );
  const response = await fetch(
    `https://openrouter.ai/api/v1/models/${model.split("/").map(encodeURIComponent).join("/")}/endpoints`,
    { signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  if (!response.ok)
    throw new ResearchRoundFault(
      503,
      "MB-503-MODEL-PRICING",
      "Endpoint pricing is unavailable.",
    );
  type Endpoint = {
    tag: string;
    status?: number;
    provider_name?: string;
    pricing: Record<string, unknown>;
    supported_parameters?: string[];
  };
  const body = (await response.json()) as { data?: { endpoints?: Endpoint[] } };
  const usable = (body.data?.endpoints ?? []).filter(
    (entry) =>
      typeof entry.tag === "string" &&
      (!credit || entry.status === undefined || entry.status === 0) &&
      /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*$/.test(entry.tag) &&
      !/\/(flex|fast|priority)$/.test(entry.tag),
  );
  if (credit) {
    const zdr = await getOpenRouterZdrEndpoints();
    const candidates = usable.filter(
      (entry) =>
        (entry.supported_parameters?.includes("max_tokens") ||
          entry.supported_parameters?.includes("max_completion_tokens")) &&
        decimal(entry.pricing?.prompt) !== null &&
        decimal(entry.pricing?.completion) !== null &&
        zdr.has(`${model}:${entry.tag}`) &&
        (!model.startsWith("x-ai/") ||
          entry.tag === "xai" ||
          entry.tag === "x-ai" ||
          /^(xai|x-ai)\/zdr$/.test(entry.tag)),
    );
    candidates.sort(
      (a, b) =>
        Number(a.pricing.prompt) +
          Number(a.pricing.completion) -
          (Number(b.pricing.prompt) + Number(b.pricing.completion)) ||
        a.tag.localeCompare(b.tag),
    );
    provider = candidates[0]?.tag;
  }
  if (!provider)
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-PRICING",
      "No eligible priced endpoint is available for the requested billing route.",
    );
  const endpoints = usable.filter(
    (entry) =>
      entry.tag === provider ||
      (!credit && entry.tag.startsWith(provider + "/")),
  );
  if (!endpoints.length)
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-PRICING",
      "No priced endpoint is available for the configured provider.",
    );
  const capabilities = await getOpenRouterModelCapabilities(
    model,
    credit ? provider : undefined,
  );
  const maximum = (field: string, required = false) => {
    const numbers = endpoints.map((entry) => decimal(entry.pricing?.[field]));
    if (required && numbers.some((value) => value === null))
      throw new ResearchRoundFault(
        503,
        "MB-503-MODEL-PRICING",
        "Selected endpoint omitted required token pricing.",
      );
    return Math.max(...numbers.map((value) => value ?? 0));
  };
  return {
    model,
    provider,
    billing_mode: credit ? "openrouter_credits" : "byok",
    ...(credit &&
    endpoints[0]?.provider_name &&
    /^[a-zA-Z][a-zA-Z0-9 ._/-]{0,79}$/.test(endpoints[0].provider_name)
      ? { provider_display_name: endpoints[0].provider_name }
      : {}),
    input_usd_per_token: maximum("prompt", true),
    output_usd_per_token: maximum("completion", true),
    request_usd: maximum("request"),
    web_search_usd: maximum("web_search"),
    reasoning: capabilities.reasoning,
    structured_outputs: capabilities.structured_outputs,
    source_url: `https://openrouter.ai/api/v1/models/${model}/endpoints`,
  };
}
// A research-fit rubric precedes price; cheap coding/experimental variants are not supplier researchers.
export function researchModelSuitability(model: string): number {
  if (
    /(?:^|[-/:])(?:build|coder|coding|codex|code|distill|exp|experimental|vision|image|audio|multi-agent)(?:[-/:]|$)/.test(
      model,
    )
  )
    return -1;
  if (model.startsWith("anthropic/claude-sonnet-")) return 40;
  if (model.startsWith("anthropic/claude-opus-")) return 35;
  if (model.startsWith("deepseek/deepseek-v4-pro")) return 40;
  if (/^deepseek\/deepseek-v3\.2$/.test(model)) return 35;
  if (model.startsWith("deepseek/deepseek-v4-flash")) return 30;
  if (model.startsWith("x-ai/grok-4")) return 40;
  return 0;
}
export async function researchModelChoices(
  options: { for_followup?: boolean } = {},
) {
  const configured = getConfiguredLiveModels();
  const models = (await userModels())
    .filter((m) => {
      try {
        if (!permitsCreditRoute(m.id)) getConfiguredProviderRoute(m.id);
        return (
          (m.supported_parameters?.includes("max_tokens") ||
            m.supported_parameters?.includes("max_completion_tokens")) &&
          !/:|image|audio/.test(m.id) &&
          researchModelSuitability(m.id) >= 0 &&
          (!m.architecture?.output_modalities ||
            m.architecture.output_modalities.every((x) => x === "text"))
        );
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        researchModelSuitability(b.id) - researchModelSuitability(a.id) ||
        Number(a.pricing?.prompt ?? 99) +
          Number(a.pricing?.completion ?? 99) -
          (Number(b.pricing?.prompt ?? 99) +
            Number(b.pricing?.completion ?? 99)),
    );
  const ids = [
    ...new Set([
      ...Object.values(configured),
      ...["anthropic", "deepseek", "x-ai"].flatMap((family) =>
        models
          .filter((m) => m.id.startsWith(`${family}/`))
          .slice(0, 4)
          .map((m) => m.id),
      ),
      ...models.slice(0, 10).map((m) => m.id),
    ]),
  ];
  const results = await Promise.allSettled(ids.map(currentResearchModelRate));
  return results.flatMap((r) =>
    r.status === "fulfilled" &&
    (!options.for_followup || r.value.structured_outputs === true)
      ? [r.value]
      : [],
  );
}
/** Configuration visibility only; a configured route does not establish key health or pricing. */
export function configuredResearchTierAvailability(): Record<
  ResearchTier,
  { configured: boolean; missing_families: string[] }
> {
  const models = getConfiguredLiveModels();
  const configured = (model: string) => {
    try {
      if (!permitsCreditRoute(model)) getConfiguredProviderRoute(model);
      return true;
    } catch {
      return false;
    }
  };
  const base = [
    ["Google", models.lane_gemini],
    ["OpenAI", models.lane_openai],
  ]
    .filter(([, model]) => !configured(model!))
    .map(([name]) => name!);
  const extras = [
    ["Anthropic", "anthropic/claude"],
    ["DeepSeek", "deepseek/model"],
    ["Grok", "x-ai/grok"],
  ]
    .filter(([, model]) => !configured(model!))
    .map(([name]) => name!);
  const advanced = [
    ...base,
    ...(extras.length === 3 ? ["Anthropic, DeepSeek or Grok"] : []),
  ];
  return {
    default: { configured: base.length === 0, missing_families: base },
    advanced: { configured: advanced.length === 0, missing_families: advanced },
    ultra: {
      configured: base.length === 0 && extras.length === 0,
      missing_families: [...base, ...extras],
    },
  };
}
export async function buildResearchRoundPlan(input: {
  follow_up?: ResearchRoundPlan["follow_up"];
  round_number: number;
  depth: ResearchDepth;
  selected_model?: string;
  research_tier?: ResearchTier;
  parent_round_id: string | null;
  request_hash: string;
  focus_requirements: string[];
  mode: "live" | "demonstration";
}): Promise<{ plan: ResearchRoundPlan; choices: ResearchModelRate[] }> {
  if (input.round_number < 1 || input.round_number > 5)
    throw new ResearchRoundFault(
      409,
      "MB-409-ROUND-LIMIT",
      "Five research rounds are complete. No additional round is scheduled.",
    );
  const tier = input.research_tier ?? "default";
  if (!["default", "advanced", "ultra"].includes(tier))
    throw new ResearchRoundFault(
      422,
      "MB-422-RESEARCH-TIER",
      "Select a supported research tier.",
    );
  const choices =
    input.mode === "demonstration"
      ? []
      : await researchModelChoices({ for_followup: input.round_number > 1 });
  const configured = getConfiguredLiveModels();
  const ordered = choices
    .filter((c) => c.structured_outputs !== false)
    .sort(
      (a, b) =>
        a.input_usd_per_token +
        a.output_usd_per_token -
        (b.input_usd_per_token + b.output_usd_per_token),
    );
  const cheapest = ordered[0];
  const selected =
    input.round_number > 1 && input.selected_model
      ? choices.find((c) => c.model === input.selected_model)
      : input.depth === "deep"
        ? (choices.find(
            (c) => c.model === configured.synthesis && c.reasoning,
          ) ?? ordered.find((c) => c.reasoning))
        : cheapest;
  if (input.mode === "live" && (!selected || !cheapest))
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-UNAVAILABLE",
      "No eligible configured model route can produce this estimate. Model listing does not establish BYOK key health.",
    );
  if (input.mode === "live" && input.depth === "deep" && !selected?.reasoning)
    throw new ResearchRoundFault(
      422,
      "MB-422-REASONING-MODEL",
      "Thoughtful research requires an eligible reasoning model.",
    );
  const requiredExtraFamilies =
    tier === "ultra" ? ["anthropic", "deepseek", "x-ai"] : [];
  const research =
    input.round_number === 1
      ? [configured.lane_gemini, configured.lane_openai]
      : [selected?.model ?? "demonstration"];
  const qualityOrder = (a: ResearchModelRate, b: ResearchModelRate) =>
    Number(b.reasoning) - Number(a.reasoning) ||
    Number(b.model === configured.synthesis) -
      Number(a.model === configured.synthesis) ||
    researchModelSuitability(b.model) - researchModelSuitability(a.model) ||
    Number(b.structured_outputs !== false) -
      Number(a.structured_outputs !== false) ||
    a.input_usd_per_token +
      a.output_usd_per_token -
      (b.input_usd_per_token + b.output_usd_per_token) ||
    a.model.localeCompare(b.model);
  const ranked = [...choices].sort(qualityOrder);
  if (input.round_number === 1 && tier !== "default") {
    if (input.mode === "demonstration") {
      research.push(
        ...(tier === "ultra"
          ? [
              "anthropic/demonstration",
              "deepseek/demonstration",
              "x-ai/demonstration",
            ]
          : ["anthropic/demonstration"]),
      );
    } else if (tier === "advanced") {
      const extra = ranked.find((r) =>
        /^(anthropic|deepseek|x-ai)\//.test(r.model),
      );
      if (!extra)
        throw new ResearchRoundFault(
          422,
          "MB-422-RESEARCH-TIER-UNAVAILABLE",
          "Advanced research needs a priced Anthropic, DeepSeek or Grok route, using configured BYOK or explicitly approved OpenRouter credits. No research has started.",
        );
      research.push(extra.model);
    } else {
      for (const family of requiredExtraFamilies) {
        const extra = ranked.find((r) => r.model.startsWith(`${family}/`));
        if (!extra)
          throw new ResearchRoundFault(
            422,
            "MB-422-RESEARCH-TIER-UNAVAILABLE",
            `Ultra research requires all five families. The ${family} family has no eligible priced BYOK or OpenRouter-credit route. No reduced tier or research was started.`,
          );
        research.push(extra.model);
      }
    }
  }
  // Explicit application rubric, never presented as an OpenRouter recommendation.
  const synthesisRate =
    input.round_number === 1
      ? ranked.find(
          (r) =>
            r.structured_outputs !== false &&
            r.reasoning &&
            (research.includes(r.model) || r.model === configured.synthesis),
        )
      : selected;
  if (input.mode === "live" && input.round_number === 1 && !synthesisRate)
    throw new ResearchRoundFault(
      422,
      "MB-422-REASONING-MODEL",
      "This tier needs an eligible reasoning model with structured output for synthesis.",
    );
  const synthesis = synthesisRate?.model ?? "demonstration";
  // Evidence dossiers require source attribution and uncertainty reasoning.
  // First-round extraction is fixed independently of a stale later-round model
  // dropdown; only later deep rounds retain the explicit model choice.
  // All resulting calls are priced before the human approves this new plan.
  const extraction =
    input.mode === "demonstration"
      ? "demonstration"
      : input.round_number > 1 && input.depth === "deep"
        ? selected!.model
        : configured.synthesis;
  // A fallback is part of a new quote, never an extension of historical consent.
  // Keep its billing mode unchanged and prefer an independent model family.
  const fallbackRate =
    input.mode === "live" && input.round_number > 1 && selected
      ? [...ranked]
          .filter(
            (rate) =>
              rate.model !== selected.model &&
              rate.structured_outputs === true &&
              (input.depth !== "deep" || rate.reasoning) &&
              (rate.billing_mode ?? "byok") ===
                (selected.billing_mode ?? "byok"),
          )
          .sort(
            (a, b) =>
              Number(b.model.split("/")[0] !== selected.model.split("/")[0]) -
                Number(
                  a.model.split("/")[0] !== selected.model.split("/")[0],
                ) || qualityOrder(a, b),
          )[0]
      : undefined;
  const modelFallbacks = fallbackRate
    ? { [selected!.model]: [fallbackRate.model] }
    : undefined;
  const rateIds = [
    ...new Set([
      ...research,
      synthesis,
      extraction,
      ...(fallbackRate ? [fallbackRate.model] : []),
    ]),
  ];
  const rates =
    input.mode === "demonstration"
      ? []
      : rateIds.map((id) => choices.find((c) => c.model === id));
  if (rates.some((rate) => !rate))
    throw new ResearchRoundFault(
      503,
      "MB-503-MODEL-PRICING",
      "Pricing for a required discovery model is unavailable.",
    );
  const actualRates = rates as ResearchModelRate[];
  if (
    input.mode === "live" &&
    [extraction, synthesis].some(
      (model) =>
        actualRates.find((rate) => rate.model === model)?.structured_outputs !==
        true,
    )
  )
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-CAPABILITY",
      "Extraction and analysis require endpoints with structured output support. Select a compatible model before approving research.",
    );
  if (
    input.round_number === 1 &&
    tier === "default" &&
    actualRates.some(
      (rate) =>
        !/^(google|openai)\//.test(rate.model) ||
        rate.billing_mode === "openrouter_credits",
    )
  )
    throw new ResearchRoundFault(
      422,
      "MB-422-RESEARCH-TIER",
      "Default research requires Google/OpenAI BYOK models for discovery, extraction and synthesis. Review the configured synthesis model.",
    );
  const native = input.round_number === 1;
  const approvedSearchModels = [
    ...new Set([
      ...research,
      ...research.flatMap((model) => modelFallbacks?.[model] ?? []),
    ]),
  ];
  const searchEngines = Object.fromEntries(
    approvedSearchModels.map((model) => [
      model,
      native
        ? researchSearchEngineForModel(
            model,
            actualRates.find((rate) => rate.model === model)?.provider,
          )
        : "exa",
    ]),
  ) as Record<string, "native" | "exa">;
  const priceModel = research[0]!;
  const priceCalls = 4;
  const priceEngine = searchEngines[priceModel]!;
  const maxOutput = input.depth === "deep" ? 20000 : 12000;
  const candidateLimit =
    input.round_number === 1 ? Math.ceil(20 / research.length) : 20;
  const baseCalls =
    (input.round_number === 1
      ? research.length * (2 + Math.ceil(candidateLimit / 2)) + 1
      : 14) + priceCalls;
  const recoveryReserve = 6;
  const calls = baseCalls + recoveryReserve;
  const conservativeRetryRate = actualRates.length
    ? {
        input_usd_per_token: Math.max(
          ...actualRates.map((r) => r.input_usd_per_token),
        ),
        output_usd_per_token: Math.max(
          ...actualRates.map((r) => r.output_usd_per_token),
        ),
        request_usd: Math.max(...actualRates.map((r) => r.request_usd)),
      }
    : undefined;
  const ratesForCalls = [
    ...research.map((model) => actualRates.find((r) => r.model === model)),
    ...Array.from({ length: baseCalls - research.length - 3 }, () =>
      actualRates.find((r) => r.model === extraction),
    ),
    ...Array.from({ length: 2 }, () =>
      actualRates.find((r) => r.model === priceModel),
    ),
    actualRates.find((r) => r.model === synthesis),
    ...Array.from({ length: recoveryReserve }, () => conservativeRetryRate),
  ];
  const highRatesForCalls = ratesForCalls.map((rate) => {
    if (!rate || !("model" in rate)) return rate;
    const alternatives = modelFallbacks?.[rate.model as string] ?? [];
    const applicable = actualRates.filter(
      (candidate) =>
        candidate.model === rate.model ||
        alternatives.includes(candidate.model),
    );
    return {
      input_usd_per_token: Math.max(
        ...applicable.map((candidate) => candidate.input_usd_per_token),
      ),
      output_usd_per_token: Math.max(
        ...applicable.map((candidate) => candidate.output_usd_per_token),
      ),
      request_usd: Math.max(
        ...applicable.map((candidate) => candidate.request_usd),
      ),
    };
  });
  const webAllowance = (model: string, engine: "native" | "exa") =>
    engine === "exa"
      ? 0.007
      : Math.max(
          0.1,
          (actualRates.find((r) => r.model === model)?.web_search_usd ?? 0) *
            10,
        );
  const searchAllowance =
    research.reduce(
      (sum, model) => sum + webAllowance(model, searchEngines[model]!),
      0,
    ) +
    2 * webAllowance(priceModel, priceEngine) +
    recoveryReserve *
      Math.max(
        0.007,
        ...approvedSearchModels.map((model) =>
          webAllowance(model, searchEngines[model]!),
        ),
      );
  const estimate = (high: boolean) =>
    input.mode === "demonstration"
      ? 0
      : precise(
          (high ? highRatesForCalls : ratesForCalls).reduce(
            (sum, r) =>
              sum +
              (r
                ? (high ? 240000 : 18000) * r.input_usd_per_token +
                  (high ? maxOutput : 4000) * r.output_usd_per_token +
                  r.request_usd
                : 0),
            0,
          ) *
            1.05 +
            searchAllowance * (high ? 1 : 0.25),
        );
  const now = new Date();
  const titles = [
    "Initial supplier research",
    "Resolve the most important gaps",
    "Focused evidence refinement",
    "Public social evidence review",
    "Independent social and evidence audit",
  ];
  const purposes = [
    "Discover up to 20 companies through two search paths. Establish seller identity, relevant product or service evidence and published contacts first; publish conditional findings with unresolved quotation requirements.",
    "Reuse the saved roster and resolve missing seller identity and product or service evidence before refining quotation, warranty and order-specific details. Preserve unknown requirements as explicit gaps.",
    "Analyse the buyer follow-up against saved findings, then deepen research into useful evidence gaps. Preserve prior round history and unresolved requirements.",
    "Check relevant accessible public corporate profiles, identity linkage and dated business claims. Missing profiles are not a qualification failure.",
    "Challenge source independence, contradictions and unresolved claims; seek better primary evidence. No private accounts or supplier contact.",
  ];
  return {
    choices,
    plan: {
      version: "research-round.v1",
      ...(input.round_number > 1
        ? {
            focus_analysis_required: true,
            follow_up: input.follow_up ?? { question: "", lead_ids: [] },
          }
        : {}),
      round_number: input.round_number,
      depth: input.depth,
      research_tier: tier,
      title: titles[input.round_number - 1]!,
      purpose:
        input.round_number === 1
          ? `Discover up to 20 companies through ${research.length} approved search paths. Establish identity, relevant offerings and published contacts; disclose missing quotation requirements.`
          : purposes[input.round_number - 1]!,
      focus_requirements: normalizeResearchGaps(input.focus_requirements),
      research_models: research,
      ...(modelFallbacks ? { model_fallbacks: modelFallbacks } : {}),
      extraction_model: extraction,
      synthesis_model: synthesis,
      search_engine: native ? "native" : "exa",
      search_engines: searchEngines,
      synthesis_selection_reason:
        "Application selection: structured output and reasoning capability, configured synthesis preference, then lower token price. This is not a provider recommendation or a benchmark claim.",
      price_research: {
        model: priceModel,
        search_engine: priceEngine,
        max_calls: priceCalls,
        preferred_window_days: 7,
        window_days: 30,
      },
      candidate_limit_per_search: candidateLimit,
      automatic_recovery_attempts: 3,
      extraction_batch_size: 2,
      recovery_call_reserve: recoveryReserve,
      max_calls: calls,
      max_input_tokens_per_call: 240000,
      max_output_tokens_per_call: maxOutput,
      estimated_low_usd: estimate(false),
      estimated_high_usd: estimate(true),
      pricing_checked_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60000).toISOString(),
      rates: actualRates,
      assumptions: [
        ...(fallbackRate
          ? [
              `Automatic technical recovery may use ${fallbackRate.model} through ${fallbackRate.provider} (${fallbackRate.billing_mode ?? "byok"}) instead of ${selected!.model}, using Exa for web research. The estimate includes six shared recovery calls and at most three total attempts per stage within the total call allowance. The high estimate prices affected stage calls and the recovery reserve at the highest applicable primary or alternative rates. Refusals, safety blocks, authentication, billing, permission, cancellation and approval failures never authorize substitution. No following round starts automatically.`,
            ]
          : input.mode === "live" && input.round_number > 1
            ? [
                "No compatible same-billing alternative is available in this estimate. Technical recovery retains the selected model within the existing attempt and call allowances; any other model requires a new estimate and approval.",
              ]
            : []),
        ...(input.round_number > 1
          ? [
              "This estimate includes one AI analysis of your follow-up and saved findings before focused web research. Editing the question does not call a model. Original requirements and all prior round results remain preserved.",
            ]
          : []),
        "Dedicated price research includes a seven-day web pass and structured extraction; a thirty-day fallback and extraction are included only when the first pass has no usable sourced recent price. Four calls are reserved, with at most two web searches.",
        "DeepSeek and later-round Exa search incurs an additional OpenRouter platform search charge (Exa Auto at USD0.007 per request including up to ten results; this plan limits results to eight), independent of BYOK model inference (OpenRouter web-search documentation checked 2026-09-09). Native search follows the explicitly selected model and provider; hosted Anthropic endpoints use priced Exa search. Unsupported endpoints fail rather than silently switching engines.",
        "Evidence extraction uses the model named in this estimate; its actual configured rates are included. A more economical research choice does not silently downgrade source attribution to the cheapest model.",
        "Estimate in USD, not a guaranteed maximum or invoice.",
        "Range assumes 4,000 output tokens per call at the low end and the full approved output allowance at the high end; input volume varies.",
        "Native search can issue multiple billable queries. Search allowance is an estimate; platform BYOK fee allowance is conservatively 5%.",
        "One approval authorizes this round only, including up to three attempts per recoverable stage and six shared recovery calls within the total call allowance. No following round starts automatically.",
        "Two suppliers are extracted per dossier batch. The estimate includes the six-call recovery reserve at the highest approved token and search rates; actual usage may be lower. Saved successful stages are reused when possible.",
        "Each model billing mode is frozen in this estimate. Google/OpenAI and explicitly configured BYOK routes remain strict BYOK. Additional families without a configured BYOK route use the named zero-data-retention OpenRouter-credit endpoint only after you approve this estimate. No failed BYOK call falls back to credits.",
        "Model listing does not prove provider-key health or sufficient balance. Actual route, billing mode and usage are checked on every response.",
      ],
      request_hash: input.request_hash,
      parent_round_id: input.parent_round_id,
      mode: input.mode,
    },
  };
}
export function createRoundCallGuard(
  plan: ResearchRoundPlan,
  previouslyConsumedCalls = 0,
) {
  const primaryModels = new Set([
    ...plan.research_models,
    plan.extraction_model,
    plan.synthesis_model,
  ]);
  const approvedFallbacks = new Map<string, string>();
  for (const [primary, alternatives] of Object.entries(
    plan.model_fallbacks ?? {},
  )) {
    const alternative = alternatives?.[0];
    const primaryRate = plan.rates.find((rate) => rate.model === primary);
    const alternativeRate = plan.rates.find(
      (rate) => rate.model === alternative,
    );
    if (
      plan.mode !== "live" ||
      plan.round_number < 2 ||
      (plan.automatic_recovery_attempts ?? 1) <= 1 ||
      (plan.recovery_call_reserve ?? 0) < 1 ||
      !primaryModels.has(primary) ||
      !Array.isArray(alternatives) ||
      alternatives.length !== 1 ||
      typeof alternative !== "string" ||
      alternative === primary ||
      !primaryRate ||
      !alternativeRate ||
      primaryRate.structured_outputs !== true ||
      alternativeRate.structured_outputs !== true ||
      (plan.depth === "deep" &&
        (!primaryRate.reasoning || !alternativeRate.reasoning)) ||
      (primaryRate.billing_mode ?? "byok") !==
        (alternativeRate.billing_mode ?? "byok") ||
      (plan.research_models.includes(primary) &&
        !["native", "exa"].includes(plan.search_engines?.[alternative] ?? ""))
    )
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-FALLBACK",
        "The recovery alternative is not covered by a compatible priced approval. Review a new estimate before further work.",
      );
    approvedFallbacks.set(primary, alternative);
  }
  if (
    !Number.isSafeInteger(previouslyConsumedCalls) ||
    previouslyConsumedCalls < 0
  )
    throw new ResearchRoundFault(
      409,
      "MB-409-ROUND-ALLOWANCE",
      "Saved provider-call accounting is invalid. No provider request was sent.",
    );
  let calls = previouslyConsumedCalls;
  return async (request: OpenRouterCompletionParams, web: boolean) => {
    const primaryAllowed = web
      ? plan.research_models
      : [plan.extraction_model, plan.synthesis_model];
    // One hop only. Pricing a model does not authorize it for every role.
    const allowed = primaryAllowed.flatMap((model) => [
      model,
      ...(approvedFallbacks.has(model) ? [approvedFallbacks.get(model)!] : []),
    ]);
    const rate = plan.rates.find((r) => r.model === request.model);
    if (
      plan.mode === "live" &&
      (!rate ||
        (rate.billing_mode === "openrouter_credits"
          ? !permitsCreditRoute(request.model)
          : getConfiguredProviderRoute(request.model) !== rate.provider))
    )
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-PROVIDER",
        "The configured provider changed. Review a new estimate.",
      );
    if (!allowed.includes(request.model))
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-MODEL",
        "The model differs from the approved round.",
      );
    if (web && plan.search_engines) {
      const plugin = request.plugins?.find((entry) => entry.id === "web");
      if (
        plugin?.engine !== plan.search_engines[request.model] ||
        (plugin?.engine === "exa" && (plugin.max_results ?? 5) > 8)
      )
        throw new ResearchRoundFault(
          409,
          "MB-409-ROUND-SEARCH-ENGINE",
          "Search routing differs from the approved engine or result allowance. Review a new estimate.",
        );
    }
    const inputBytes =
      Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 512;
    const synthesis =
      request.response_format?.type === "json_schema" &&
      request.response_format.json_schema.name === "matchbase_live_synthesis";
    const reserveSynthesis =
      (plan.automatic_recovery_attempts ?? 1) > 1 && !synthesis;
    const callLimit = plan.max_calls - Number(reserveSynthesis);
    const exhausted =
      calls >= callLimit
        ? reserveSynthesis
          ? `The research call allowance is exhausted; the final approved call is reserved for result synthesis.`
          : `The approved allowance of ${plan.max_calls} provider calls is exhausted.`
        : (request.max_tokens ?? 12000) > plan.max_output_tokens_per_call
          ? `The requested output exceeds the approved ${plan.max_output_tokens_per_call}-token allowance.`
          : inputBytes > plan.max_input_tokens_per_call
            ? `The prepared evidence exceeds the conservative input allowance (${inputBytes} serialized bytes; approved limit ${plan.max_input_tokens_per_call}).`
            : null;
    if (exhausted)
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-ALLOWANCE",
        `${exhausted} No provider request was sent. Review a fresh estimate before further work.`,
      );
    calls++;
  };
}
