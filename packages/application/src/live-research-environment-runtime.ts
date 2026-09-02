import {
  GeminiServerOwnedSourceDiscovery,
  LiveResearchExecutionService,
} from "./live-research-execution.js";
import {
  QualifiedLiveResearchWorkerDispatcher,
  type QualifiedLiveWorkItem,
} from "./live-research-worker.js";
import {
  ProviderTransportFailure,
  validateResearchRoutePolicy,
  type LiveResearchCircuitPolicy,
  type ProviderAccounting,
  type ProviderTransport,
  type TransportRequest,
  type TransportResponse,
} from "@matchbase/ai-evidence";
import type {
  EvidenceGraphV1,
  ResearchRoutePolicyV1,
} from "@matchbase/contracts";
import {
  consultantProjectionConfigFromEnvironment,
  inTransaction,
  type ConnectionPool,
} from "@matchbase/data";
import {
  createPinnedRobotsEvaluator,
  nodePinnedFetchTransport,
  resolvePublicDns,
} from "@matchbase/security";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  LIVE_RESEARCH_CREDENTIAL_HANDLES,
  providerCredentialHandlePresent,
  type LiveResearchCredentialHandle,
} from "./live-research-credential-policy.js";
import { LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA } from "./live-research-pipeline-identity.js";

export {
  LIVE_RESEARCH_CREDENTIAL_HANDLES,
  providerCredentialHandlePresent,
} from "./live-research-credential-policy.js";
export type { LiveResearchCredentialHandle } from "./live-research-credential-policy.js";

class EnvironmentSecretHandles {
  constructor(
    private readonly environment: Readonly<
      Record<string, string | undefined>
    > = process.env,
  ) {}

  read(name: LiveResearchCredentialHandle): string {
    if (!providerCredentialHandlePresent(this.environment, name))
      throw new Error(
        `Required provider credential handle ${name} is unavailable.`,
      );
    return this.environment[name] as string;
  }
}

function positiveCost(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0 || value > 100)
    throw new Error(`Conservative provider cost handle ${name} is invalid.`);
  return value;
}

function exactPricingVersion(): string {
  const value = process.env.MATCHBASE_LIVE_PRICING_VERSION;
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(value))
    throw new Error("Live pricing version handle is invalid.");
  return value;
}

export function createPostgresLiveResearchCircuit(options: {
  pool: ConnectionPool;
  environment: ResearchRoutePolicyV1["environment"];
  probeAfterMs?: number;
}): LiveResearchCircuitPolicy {
  const probeAfterMs = options.probeAfterMs ?? 60_000;
  if (
    !Number.isSafeInteger(probeAfterMs) ||
    probeAfterMs < 10 ||
    probeAfterMs > 3_600_000
  )
    throw new Error("Live research circuit probe duration is invalid.");
  return {
    isRouteAvailable: async (routeId, at) =>
      await inTransaction(options.pool, async (client) => {
        const atTime = new Date(at).getTime();
        if (!Number.isFinite(atTime))
          throw new Error("Live research circuit observation time is invalid.");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${options.environment}:${routeId}`],
        );
        const result = await client.query<{
          consecutive_failures: number;
          circuit_disposition: "closed" | "open" | "half_open";
          observed_at: Date;
        }>(
          `SELECT consecutive_failures,circuit_disposition,observed_at
             FROM research_route_health_observation
            WHERE route_id=$1 AND environment=$2 AND observed_at <= $3
            ORDER BY observed_at DESC,research_route_health_observation_id DESC
            LIMIT 1`,
          [routeId, options.environment, at],
        );
        const latest = result.rows[0];
        if (!latest || latest.circuit_disposition === "closed") return true;
        if (latest.observed_at.getTime() + probeAfterMs > atTime) return false;
        const probeId = randomUUID();
        await client.query(
          `INSERT INTO research_route_health_observation
             (research_route_health_observation_id,route_id,environment,observation,
              consecutive_failures,circuit_disposition,source_attempt_id,observed_at)
           VALUES($1,$2,$3,'probe_eligible',$4,'half_open',NULL,$5)`,
          [
            probeId,
            routeId,
            options.environment,
            Number(latest.consecutive_failures),
            at,
          ],
        );
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort("circuit_probe_lease_expired"),
          probeAfterMs,
        );
        timer.unref();
        let closed = false;
        return Object.freeze({
          signal: controller.signal,
          assertOwnership: async () => {
            if (closed || controller.signal.aborted)
              throw new Error("Live research circuit probe lease expired.");
            const ownership = await options.pool.query<{ owned: boolean }>(
              `SELECT EXISTS(
                 SELECT 1
                   FROM research_route_health_observation h
                  WHERE h.research_route_health_observation_id=$1
                    AND h.route_id=$2 AND h.environment=$3
                    AND h.circuit_disposition='half_open'
                    AND h.observed_at + ($4::int * interval '1 millisecond')
                        > clock_timestamp()
                    AND NOT EXISTS (
                      SELECT 1 FROM research_route_health_observation newer
                       WHERE newer.route_id=h.route_id
                         AND newer.environment=h.environment
                         AND (newer.observed_at,newer.research_route_health_observation_id)
                             > (h.observed_at,h.research_route_health_observation_id)
                    )
               ) owned`,
              [probeId, routeId, options.environment, probeAfterMs],
            );
            if (!ownership.rows[0]?.owned) {
              controller.abort("circuit_probe_fenced");
              throw new Error("Live research circuit probe was fenced.");
            }
          },
          close: () => {
            closed = true;
            clearTimeout(timer);
          },
        });
      }),
  };
}

export async function readBoundedProviderJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const limit = 2 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("Provider response exceeded the bounded JSON limit.");
  if (!response.body)
    throw new Error("Provider response omitted its bounded JSON body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel("bounded_provider_response_exceeded");
        throw new Error("Provider response exceeded the bounded JSON limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provider response body is not a JSON object.");
  return value as Record<string, unknown>;
}

function structuredGeminiInteractionBody(
  envelope: Record<string, unknown>,
): unknown {
  if (
    !hasOnlyKeys(
      envelope,
      new Set([
        "created",
        "id",
        "model",
        "object",
        "service_tier",
        "status",
        "steps",
        "updated",
        "usage",
      ]),
    ) ||
    envelope.object !== "interaction" ||
    envelope.status !== "completed" ||
    !Array.isArray(envelope.steps) ||
    envelope.steps.length < 3 ||
    envelope.steps.length > 32
  )
    throw new Error("Gemini interaction envelope is invalid.");
  const calls = new Set<string>();
  const results = new Set<string>();
  const outputTexts: string[] = [];
  for (const value of envelope.steps) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Gemini interaction step is invalid.");
    const step = value as Record<string, unknown>;
    if (step.type === "google_search_call") {
      if (
        !hasOnlyKeys(
          step,
          new Set(["arguments", "id", "search_type", "signature", "type"]),
        ) ||
        typeof step.id !== "string" ||
        !step.id ||
        calls.has(step.id)
      )
        throw new Error("Gemini search-call step is invalid.");
      calls.add(step.id);
      continue;
    }
    if (step.type === "google_search_result") {
      if (
        !hasOnlyKeys(
          step,
          new Set(["call_id", "is_error", "result", "signature", "type"]),
        ) ||
        typeof step.call_id !== "string" ||
        !step.call_id ||
        step.is_error !== false ||
        results.has(step.call_id)
      )
        throw new Error("Gemini search-result step is invalid.");
      results.add(step.call_id);
      continue;
    }
    if (step.type === "thought") {
      if (!hasOnlyKeys(step, new Set(["signature", "type"])))
        throw new Error("Gemini thought step is invalid.");
      continue;
    }
    if (step.type === "model_output") {
      if (
        !hasOnlyKeys(step, new Set(["content", "type"])) ||
        !Array.isArray(step.content) ||
        step.content.length !== 1
      )
        throw new Error("Gemini model-output step is invalid.");
      const block = step.content[0];
      if (
        !block ||
        typeof block !== "object" ||
        Array.isArray(block) ||
        !hasOnlyKeys(
          block as Record<string, unknown>,
          new Set(["annotations", "text", "type"]),
        ) ||
        (block as Record<string, unknown>).type !== "text" ||
        typeof (block as Record<string, unknown>).text !== "string"
      )
        throw new Error("Gemini model-output content is invalid.");
      outputTexts.push(String((block as Record<string, unknown>).text));
      continue;
    }
    throw new Error("Gemini interaction step type is invalid.");
  }
  if (
    calls.size < 1 ||
    calls.size > 10 ||
    calls.size !== results.size ||
    [...calls].some((id) => !results.has(id)) ||
    outputTexts.length !== 1 ||
    outputTexts[0]!.length < 2 ||
    outputTexts[0]!.length > 2 * 1024 * 1024
  )
    throw new Error("Gemini interaction search lineage is invalid.");
  return JSON.parse(outputTexts[0]!);
}

function structuredBody(
  provider: "gemini_direct" | "openrouter",
  envelope: Record<string, unknown>,
  pathname: string,
): unknown {
  if (provider === "gemini_direct" && pathname === "/v1beta/interactions")
    return structuredGeminiInteractionBody(envelope);
  const text =
    provider === "gemini_direct"
      ? (
          envelope.candidates as
            | Array<{
                content?: { parts?: Array<{ text?: unknown }> };
              }>
            | undefined
        )?.[0]?.content?.parts?.[0]?.text
      : (
          envelope.choices as
            | Array<{
                message?: { content?: unknown };
              }>
            | undefined
        )?.[0]?.message?.content;
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024)
    throw new Error("Provider omitted its bounded structured response.");
  return JSON.parse(text);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

const OPENROUTER_ROUTER_MODELS = new Set([
  "google/gemini-3.6-flash",
  "google/gemini-3.6-flash-20260721",
]);

function auditedOpenRouterRoute(
  value: unknown,
): Readonly<{ provider: "Google" | "Google Vertex"; model: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OpenRouter routing metadata is invalid.");
  const routing = value as Record<string, unknown>;
  if (
    routing.requested !== "google/gemini-3.6-flash" ||
    routing.strategy !== "direct" ||
    routing.attempt !== 1 ||
    ("is_byok" in routing && routing.is_byok !== false) ||
    (routing.pipeline !== undefined &&
      (!Array.isArray(routing.pipeline) ||
        routing.pipeline.length > 64 ||
        routing.pipeline.some(
          (stage) =>
            !stage || typeof stage !== "object" || Array.isArray(stage),
        )))
  )
    throw new Error("OpenRouter routing metadata is invalid.");
  const endpoints = routing.endpoints;
  if (!endpoints || typeof endpoints !== "object" || Array.isArray(endpoints))
    throw new Error("OpenRouter routing metadata is invalid.");
  const endpointRecord = endpoints as Record<string, unknown>;
  const available = endpointRecord.available;
  if (
    !Array.isArray(available) ||
    available.length === 0 ||
    available.length > 64 ||
    !Number.isSafeInteger(endpointRecord.total) ||
    Number(endpointRecord.total) < available.length ||
    Number(endpointRecord.total) > 64
  )
    throw new Error("OpenRouter routing metadata is invalid.");
  const candidates = available.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("OpenRouter routing metadata is invalid.");
    const candidate = entry as Record<string, unknown>;
    if (
      (candidate.provider !== "Google" &&
        candidate.provider !== "Google Vertex") ||
      !OPENROUTER_ROUTER_MODELS.has(String(candidate.model)) ||
      typeof candidate.selected !== "boolean"
    )
      throw new Error("OpenRouter routing metadata is invalid.");
    return candidate as {
      provider: "Google" | "Google Vertex";
      model: string;
      selected: boolean;
    };
  });
  const selected = candidates.filter((candidate) => candidate.selected);
  const attempts = routing.attempts;
  if (
    (attempts !== undefined && !Array.isArray(attempts)) ||
    (Array.isArray(attempts) && attempts.length > 1) ||
    selected.length !== 1
  )
    throw new Error("OpenRouter routing metadata is invalid.");
  if (Array.isArray(attempts) && attempts.length === 1) {
    const attempt = attempts[0];
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt))
      throw new Error("OpenRouter routing metadata is invalid.");
    const record = attempt as Record<string, unknown>;
    if (
      record.provider !== selected[0]!.provider ||
      record.model !== selected[0]!.model ||
      record.status !== 200
    )
      throw new Error("OpenRouter routing metadata is invalid.");
  }
  return Object.freeze({
    provider: selected[0]!.provider,
    model: selected[0]!.model,
  });
}

export class EnvironmentProviderTransport implements ProviderTransport {
  constructor(
    private readonly provider: "gemini_direct" | "openrouter",
    private readonly secret: string,
    private readonly conservativeCost: number,
    private readonly pricingVersion: string,
    private readonly accountingUnit: "request" | "search",
  ) {}

  private conservativeAccounting(): ProviderAccounting {
    return Object.freeze({
      state: "estimated",
      quantity: 1,
      unit: this.accountingUnit,
      amount: this.conservativeCost,
      currency: "USD",
      pricingVersion: this.pricingVersion,
      measurement: "estimated",
    });
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    const url = new URL(request.url);
    const expectedHost =
      this.provider === "gemini_direct"
        ? "generativelanguage.googleapis.com"
        : "openrouter.ai";
    if (
      url.protocol !== "https:" ||
      url.hostname !== expectedHost ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      throw new Error("Provider request escaped its qualified endpoint.");
    if (
      (this.provider === "gemini_direct" &&
        url.pathname !== "/v1beta/interactions" &&
        !/^\/v1beta\/models\/[^/]+:generateContent$/u.test(url.pathname)) ||
      (this.provider === "openrouter" &&
        url.pathname !== "/api/v1/chat/completions")
    )
      throw new Error("Provider request escaped its qualified endpoint.");
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: request.signal,
        headers: {
          ...request.headers,
          ...(this.provider === "gemini_direct"
            ? { "x-goog-api-key": this.secret }
            : {
                Authorization: `Bearer ${this.secret}`,
                "X-OpenRouter-Metadata": "enabled",
              }),
        },
        body: request.body,
      });
      return await this.readProviderResponse(url, response);
    } catch (error) {
      if (request.signal.aborted || error instanceof ProviderTransportFailure)
        throw error;
      const cause =
        error instanceof Error ? error : new Error("Provider failure.");
      throw new ProviderTransportFailure(
        cause.message,
        {
          ...(response ? { status: response.status } : {}),
          accounting: this.conservativeAccounting(),
        },
        { cause },
      );
    }
  }

  private async readProviderResponse(
    url: URL,
    response: Response,
  ): Promise<TransportResponse> {
    const envelope = await readBoundedProviderJson(response);
    let openRouterMetadata: Record<string, unknown> | null = null;
    if (this.provider === "openrouter" && response.ok) {
      const selectedRoute = auditedOpenRouterRoute(
        envelope.openrouter_metadata,
      );
      const bodyId = typeof envelope.id === "string" ? envelope.id : null;
      const headerId = response.headers.get("x-generation-id");
      if (!bodyId && !headerId)
        throw new Error("OpenRouter omitted its generation identity.");
      if (bodyId && headerId && bodyId !== headerId)
        throw new Error("OpenRouter generation identities differ.");
      const generationId = bodyId ?? headerId;
      const usage = envelope.usage as Record<string, unknown> | undefined;
      const finishReason = (
        envelope.choices as Array<{ finish_reason?: unknown }> | undefined
      )?.[0]?.finish_reason;
      const promptTokens = usage?.prompt_tokens;
      const completionTokens = usage?.completion_tokens;
      const totalCost = Number(usage?.cost);
      if (
        envelope.model !== "google/gemini-3.6-flash" ||
        typeof finishReason !== "string" ||
        !Number.isSafeInteger(promptTokens) ||
        Number(promptTokens) < 0 ||
        !Number.isSafeInteger(completionTokens) ||
        Number(completionTokens) < 0 ||
        !Number.isFinite(totalCost) ||
        totalCost <= 0
      )
        throw new Error("OpenRouter generation metadata did not reconcile.");
      openRouterMetadata = {
        id: generationId,
        provider_name: selectedRoute.provider,
        model: selectedRoute.model,
        finish_reason: finishReason,
        tokens_prompt: promptTokens,
        tokens_completion: completionTokens,
        total_cost: totalCost,
      };
    }
    const modelFromPath = decodeURIComponent(
      url.pathname.match(/\/models\/([^:/]+):/u)?.[1] ?? "",
    );
    const servedModel =
      this.provider === "gemini_direct"
        ? url.pathname === "/v1beta/interactions"
          ? envelope.model
          : envelope.modelVersion
        : envelope.model;
    const servedProvider =
      this.provider === "gemini_direct"
        ? "google"
        : openRouterMetadata?.provider_name === "Google" ||
            openRouterMetadata?.provider_name === "Google Vertex"
          ? "google-vertex"
          : null;
    return {
      status: response.status,
      body: response.ok
        ? structuredBody(this.provider, envelope, url.pathname)
        : Object.freeze({ provider_error: true }),
      ...(typeof servedModel === "string" &&
      typeof servedProvider === "string" &&
      (this.provider !== "gemini_direct" ||
        modelFromPath ||
        url.pathname === "/v1beta/interactions")
        ? {
            servedIdentity: {
              providerId: servedProvider,
              modelId: servedModel,
            },
          }
        : {}),
      accounting: {
        state:
          this.provider === "openrouter" && openRouterMetadata
            ? "priced"
            : "estimated",
        quantity: 1,
        unit: this.accountingUnit,
        amount:
          this.provider === "openrouter" && openRouterMetadata
            ? Number(openRouterMetadata.total_cost)
            : this.conservativeCost,
        currency: "USD",
        pricingVersion: this.pricingVersion,
        measurement:
          this.provider === "openrouter" && openRouterMetadata
            ? "measured"
            : "estimated",
      },
    };
  }
}

export async function createEnvironmentLiveResearchDispatcher(options: {
  pool: ConnectionPool;
}): Promise<QualifiedLiveResearchWorkerDispatcher | null> {
  const path = resolve(
    process.cwd(),
    "config/slice3/research-route-policy.v1.json",
  );
  const policy = validateResearchRoutePolicy(
    JSON.parse(await readFile(path, "utf8")),
  );
  if (
    process.env.MATCHBASE_LIVE_RESEARCH_ENABLED !== "true" ||
    policy.liveActivation !== "enabled"
  )
    return null;
  const secrets = new EnvironmentSecretHandles();
  const pricingVersion = exactPricingVersion();
  const geminiCredential = secrets.read(
    LIVE_RESEARCH_CREDENTIAL_HANDLES.geminiDirect,
  );
  const geminiSearch = new EnvironmentProviderTransport(
    "gemini_direct",
    geminiCredential,
    positiveCost("MATCHBASE_GEMINI_CONSERVATIVE_SEARCH_USD"),
    pricingVersion,
    "search",
  );
  const geminiGeneration = new EnvironmentProviderTransport(
    "gemini_direct",
    geminiCredential,
    positiveCost("MATCHBASE_GEMINI_CONSERVATIVE_REQUEST_USD"),
    pricingVersion,
    "request",
  );
  const openrouter = new EnvironmentProviderTransport(
    "openrouter",
    secrets.read(LIVE_RESEARCH_CREDENTIAL_HANDLES.openrouter),
    positiveCost("MATCHBASE_OPENROUTER_CONSERVATIVE_REQUEST_USD"),
    pricingVersion,
    "request",
  );
  const accessEvaluator = createPinnedRobotsEvaluator({
    resolver: resolvePublicDns,
    transport: nodePinnedFetchTransport,
  });
  const consultantProjectionConfig = consultantProjectionConfigFromEnvironment(
    process.env,
  );
  return new QualifiedLiveResearchWorkerDispatcher({
    pool: options.pool,
    policy,
    outputSchema: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
    serviceFactory: (work: QualifiedLiveWorkItem, policyId: string) =>
      new LiveResearchExecutionService({
        pool: options.pool,
        accountId: work.accountId,
        userId: work.userId,
        policyId,
        resolver: resolvePublicDns,
        accessEvaluator,
        fetchTransport: nodePinnedFetchTransport,
        sourceDiscovery: new GeminiServerOwnedSourceDiscovery(geminiSearch),
        providerTransports: {
          gemini_direct: geminiGeneration,
          openrouter,
        },
        circuit: createPostgresLiveResearchCircuit({
          pool: options.pool,
          environment: policy.environment,
        }),
        validateOutput: (body) => body as EvidenceGraphV1,
        deploymentId:
          process.env.MATCHBASE_DEPLOYMENT_ID ?? "live-research-worker",
        consultantProjectionConfig,
      }),
  });
}
