import { createHash } from "node:crypto";
import type {
  ResearchCostSummary,
  ResearchDepth,
  ResearchModelRate,
  ResearchRoundPlan,
} from "@matchbase/contracts";
import { ResearchRoundFault } from "@matchbase/data";
import { getConfiguredProviderRoute } from "./openrouter-byok-policy.js";
import {
  getConfiguredLiveModels,
  getOpenRouterApiKey,
  getOpenRouterModelCapabilities,
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
export async function currentResearchModelRate(
  model: string,
): Promise<ResearchModelRate> {
  if (model.includes(":"))
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-VARIANT",
      "This model variant is not supported by synchronous research.",
    );
  const provider = getConfiguredProviderRoute(model);
  const capabilities = await getOpenRouterModelCapabilities(model);
  if (!capabilities.structured_outputs)
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-CAPABILITY",
      "Select a model route with structured output support.",
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
  const body = (await response.json()) as {
    data?: { endpoints?: { tag: string; pricing: Record<string, unknown> }[] };
  };
  const endpoints = body.data?.endpoints?.filter(
    (e) =>
      e.tag === provider ||
      (e.tag?.startsWith(provider + "/") &&
        !/\/(flex|fast|priority)$/.test(e.tag)),
  );
  if (!endpoints?.length)
    throw new ResearchRoundFault(
      422,
      "MB-422-MODEL-PRICING",
      "No priced endpoint is available for the configured provider.",
    );
  const maximum = (field: string, required = false) => {
    const numbers = endpoints.map((e) => decimal(e.pricing?.[field]));
    if (required && numbers.some((v) => v === null))
      throw new ResearchRoundFault(
        503,
        "MB-503-MODEL-PRICING",
        "Selected endpoint omitted required token pricing.",
      );
    return Math.max(...numbers.map((v) => v ?? 0));
  };
  return {
    model,
    provider,
    input_usd_per_token: maximum("prompt", true),
    output_usd_per_token: maximum("completion", true),
    request_usd: maximum("request"),
    web_search_usd: maximum("web_search"),
    reasoning: capabilities.reasoning,
    source_url: `https://openrouter.ai/api/v1/models/${model}/endpoints`,
  };
}
export async function researchModelChoices() {
  const configured = getConfiguredLiveModels();
  const models = (await userModels())
    .filter((m) => {
      try {
        getConfiguredProviderRoute(m.id);
        return (
          m.supported_parameters?.includes("structured_outputs") &&
          !/:|image|audio/.test(m.id) &&
          (!m.architecture?.output_modalities ||
            m.architecture.output_modalities.every((x) => x === "text"))
        );
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Number(a.pricing?.prompt ?? 99) +
        Number(a.pricing?.completion ?? 99) -
        (Number(b.pricing?.prompt ?? 99) + Number(b.pricing?.completion ?? 99)),
    );
  const ids = [
    ...new Set([
      ...Object.values(configured),
      ...models.slice(0, 10).map((m) => m.id),
    ]),
  ];
  const results = await Promise.allSettled(ids.map(currentResearchModelRate));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
export async function buildResearchRoundPlan(input: {
  round_number: number;
  depth: ResearchDepth;
  selected_model?: string;
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
  const choices =
    input.mode === "demonstration" ? [] : await researchModelChoices();
  const configured = getConfiguredLiveModels();
  const ordered = [...choices].sort(
    (a, b) =>
      a.input_usd_per_token +
      a.output_usd_per_token -
      (b.input_usd_per_token + b.output_usd_per_token),
  );
  const cheapest = ordered[0];
  const selected = input.selected_model
    ? choices.find((c) => c.model === input.selected_model)
    : input.depth === "deep"
      ? (choices.find((c) => c.model === configured.synthesis && c.reasoning) ??
        ordered.find((c) => c.reasoning))
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
  const research =
    input.round_number === 1
      ? [configured.lane_gemini, configured.lane_openai]
      : [selected?.model ?? "demonstration"];
  const synthesis = selected?.model ?? "demonstration";
  const extraction = cheapest?.model ?? "demonstration";
  const rateIds = [...new Set([...research, synthesis, extraction])];
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
  const native = input.round_number === 1;
  const maxOutput = input.depth === "deep" ? 20000 : 12000;
  const calls = input.round_number === 1 ? 9 : 7;
  const ratesForCalls = [
    ...research.map((model) => actualRates.find((r) => r.model === model)),
    ...Array.from({ length: calls - research.length - 1 }, () =>
      actualRates.find((r) => r.model === extraction),
    ),
    actualRates.find((r) => r.model === synthesis),
  ];
  const searchAllowance = native
    ? Math.max(0.1, ...actualRates.map((r) => r.web_search_usd * 10))
    : 0.04;
  const estimate = (high: boolean) =>
    input.mode === "demonstration"
      ? 0
      : precise(
          ratesForCalls.reduce(
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
            research.length * searchAllowance * (high ? 1 : 0.25),
        );
  const now = new Date();
  const titles = [
    "Initial supplier research",
    "Resolve the most important gaps",
    "Final optional analysis",
    "Public social evidence review",
    "Independent social and evidence audit",
  ];
  const purposes = [
    "Discover up to 20 companies through two search paths, retrieve supporting sources, and publish the first evidence-backed result.",
    "Reuse the saved roster and focus on missing or conflicting requirements that could change your shortlist.",
    "Choose a simpler or more thoughtful analysis of the existing result. This is the normal final round.",
    "Check relevant accessible public corporate profiles, identity linkage and dated business claims. Missing profiles are not a qualification failure.",
    "Challenge source independence, contradictions and unresolved claims; seek better primary evidence. No private accounts or supplier contact.",
  ];
  return {
    choices,
    plan: {
      version: "research-round.v1",
      round_number: input.round_number,
      depth: input.depth,
      title: titles[input.round_number - 1]!,
      purpose: purposes[input.round_number - 1]!,
      focus_requirements: input.focus_requirements.slice(0, 12),
      research_models: research,
      extraction_model: extraction,
      synthesis_model: synthesis,
      search_engine: native ? "native" : "exa",
      candidate_limit_per_search: input.round_number === 1 ? 10 : 20,
      max_calls: calls,
      max_input_tokens_per_call: 240000,
      max_output_tokens_per_call: maxOutput,
      estimated_low_usd: estimate(false),
      estimated_high_usd: estimate(true),
      pricing_checked_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60000).toISOString(),
      rates: actualRates,
      assumptions: [
        "Estimate in USD, not a guaranteed maximum or invoice.",
        "Range assumes 4,000 output tokens per call at the low end and the full approved output allowance at the high end; input volume varies.",
        "Native search can issue multiple billable queries. Search allowance is an estimate; platform BYOK fee allowance is conservatively 5%.",
        "One approval authorizes this round only. No automatic paid retries or following round.",
        "A model being listed does not prove provider-key health or sufficient balance; actual BYOK is checked on every response.",
      ],
      request_hash: input.request_hash,
      parent_round_id: input.parent_round_id,
      mode: input.mode,
    },
  };
}
export function createRoundCallGuard(plan: ResearchRoundPlan) {
  let calls = 0;
  return async (request: OpenRouterCompletionParams, web: boolean) => {
    const allowed = web
      ? plan.research_models
      : [plan.extraction_model, plan.synthesis_model];
    const rate = plan.rates.find((r) => r.model === request.model);
    if (
      plan.mode === "live" &&
      (!rate || getConfiguredProviderRoute(request.model) !== rate.provider)
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
    if (
      calls >= plan.max_calls ||
      (request.max_tokens ?? 12000) > plan.max_output_tokens_per_call ||
      Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 512 >
        plan.max_input_tokens_per_call
    )
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-ALLOWANCE",
        "The approved call or token allowance is exhausted. Review a fresh estimate before further work.",
      );
    calls++;
  };
}
