import {
  createResearchRouteSnapshot,
  canonicalizeCandidateIdentity,
  executeProviderRequest,
  executeQualifiedResearch,
  resolveCandidateIdentities,
  resolveActiveResearchRoute,
  normalizeLegacyProviderDimensionScores,
  validateResearchRoutePolicy,
  validateEvidenceGraph,
  validateEvidenceLineageLedger,
  type Backoff,
  type LiveResearchCircuitPolicy,
  type LiveResearchRouteRecord,
  type LiveResearchTerminalRecord,
  type ProviderAttemptOutcome,
  type ProviderTransport,
  type SanitizedResearchEvidence,
} from "@matchbase/ai-evidence";
import type {
  EvidenceGraphV1,
  EvidenceLineageLedgerV1,
  ResearchRoutePolicyV1,
} from "@matchbase/contracts";
import {
  appendAuditEvent,
  bindConsultantProjectionPolicyAtResultProduction,
  DEFAULT_CONSULTANT_PROJECTION_CONFIG,
  inTransaction,
  type ConsultantProjectionConfigRelease,
  type ConnectionPool,
  type Queryable,
} from "@matchbase/data";
import {
  sealUntrustedSource,
  secureFetch,
  SecureFetchDenied,
  type DnsResolver,
  type PinnedFetchTransport,
  type SecureFetchResult,
  type SourceAccessEvaluator,
} from "@matchbase/security";
import { createHash, randomUUID } from "node:crypto";
import {
  admitLiveResearchProviderCall,
  assertApprovedLiveResearchOutputSchema,
  assertLiveResearchPipelineIdentityUnchanged,
  createLiveResearchPipelineIdentity,
  canonicalResearchRoutePolicySha256,
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
  LIVE_RESEARCH_EXTRACTION_VERSION,
  type LiveResearchPipelineIdentityV1,
} from "./live-research-pipeline-identity.js";
import {
  assertLiveEvidenceSourceBindings,
  bindServerOwnedLiveEvidenceGraph,
  type LiveSourceBindingRecord,
} from "./live-source-binding.js";
import {
  STANDARD_DIMENSION_WEIGHTS_SHA256,
  buildOperationalLiveCompleteResultV2,
  type SmeWeightValidationV2,
} from "./live-complete-result-v2.js";
import { standardCompleteResultDocumentSha256 } from "./standard-workspace.js";
import { isTransientDatabaseConnectionFailure } from "./worker-runtime.js";

const PRODUCTION_STANDARD_WEIGHTS_BP = Object.freeze({
  category_product_fit: 2500,
  compliance_certification_fit: 2000,
  volume_capacity_fit: 1500,
  price_tier_fit: 1500,
  positioning_brand_fit: 1500,
  geographic_reach_fit: 1000,
});

function authoritativeSmeWeightValidation(input: {
  readonly environment: string;
  readonly weightsBp: unknown;
  readonly smeApprovalRef: string | null;
  readonly releasedAt: Date;
}): SmeWeightValidationV2 | undefined {
  if (input.environment !== "production") return undefined;
  const weights = input.weightsBp;
  const expectedEntries = Object.entries(PRODUCTION_STANDARD_WEIGHTS_BP).sort(
    ([left], [right]) => left.localeCompare(right, "en"),
  );
  const actualEntries =
    weights !== null && typeof weights === "object" && !Array.isArray(weights)
      ? Object.entries(weights as Record<string, unknown>).sort(
          ([left], [right]) => left.localeCompare(right, "en"),
        )
      : [];
  if (
    !input.smeApprovalRef?.trim() ||
    actualEntries.length !== expectedEntries.length ||
    actualEntries.some(
      ([key, value], index) =>
        key !== expectedEntries[index]?.[0] ||
        value !== expectedEntries[index]?.[1],
    )
  )
    throw new Error(
      "Production scoring weights lack authoritative persisted SME validation.",
    );
  return Object.freeze({
    validation_record_id: input.smeApprovalRef,
    approved_at: input.releasedAt.toISOString(),
    weight_config_sha256: STANDARD_DIMENSION_WEIGHTS_SHA256,
  });
}

const sha = (value: string | Uint8Array): Buffer =>
  createHash("sha256").update(value).digest();
const json = (value: unknown): string => JSON.stringify(value);

const NON_ENGLISH_CANONICAL_SCRIPT =
  /\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Han}|\p{Script=Hebrew}/u;

function canonicalAdmissionRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function canonicalAdmissionText(
  value: unknown,
  label: string,
  maximum = 2_000,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    value !== value.normalize("NFC") ||
    value !== value.replace(/\s+/gu, " ").trim() ||
    NON_ENGLISH_CANONICAL_SCRIPT.test(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}

function exactCanonicalAdmissionKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const canonical = [...expected].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (
    keys.length !== canonical.length ||
    keys.some((key, index) => key !== canonical[index])
  )
    throw new Error(`${label} contains unsupported fields.`);
}

function structuredProviderValue(
  value: unknown,
  label: string,
): Readonly<{ value: string; unit?: string }> | null {
  const typed = canonicalAdmissionRecord(value, label);
  const state = typed.value_state;
  if (
    ![
      "provided",
      "explicitly_unknown",
      "empty",
      "not_applicable",
      "not_asked",
    ].includes(String(state))
  )
    throw new Error(`${label} value state is invalid.`);
  if (state !== "provided") {
    exactCanonicalAdmissionKeys(typed, ["value_state"], label);
    return null;
  }
  const allowed = ["value_state", "value", "unit", "raw_expression"];
  if (Object.keys(typed).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains unsupported fields.`);
  const canonicalValue = canonicalAdmissionText(typed.value, `${label}.value`);
  const unit =
    typed.unit === undefined
      ? undefined
      : canonicalAdmissionText(typed.unit, `${label}.unit`, 100);
  if (
    typed.raw_expression !== undefined &&
    typeof typed.raw_expression !== "string"
  )
    throw new Error(`${label}.raw_expression is invalid.`);
  return Object.freeze({
    value: canonicalValue,
    ...(unit === undefined ? {} : { unit }),
  });
}

/** Derives only confirmed canonical facts; raw source material is excluded. */
export function liveProviderRequestFromCanonicalDocument(
  value: unknown,
): string {
  const document = canonicalAdmissionRecord(value, "Canonical document");
  if (document.schema_version === "canonical-request.v1") {
    if (
      Object.keys(document).some(
        (key) => !["schema_version", "canonical_text", "fields"].includes(key),
      ) ||
      (document.fields !== undefined && !Array.isArray(document.fields))
    )
      throw new Error("Legacy canonical document contains unsupported fields.");
    return canonicalAdmissionText(
      document.canonical_text,
      "Legacy canonical text",
      12_000,
    );
  }
  if (document.schema_version !== "structured-standard-request.v1")
    throw new Error("Canonical document schema is unsupported.");
  exactCanonicalAdmissionKeys(
    document,
    [
      "schema_version",
      "request_id",
      "canonical_version_id",
      "version",
      "source_language",
      "canonical_language",
      "domain_pack",
      "fields",
      "hard_constraints",
      "exclusions",
      "conditional_requirements",
      "contradictions",
      "readiness",
      "created_at",
    ],
    "Structured canonical document",
  );
  if (document.canonical_language !== "en")
    throw new Error("Structured canonical document is not canonical English.");
  const domainPack = canonicalAdmissionRecord(
    document.domain_pack,
    "Structured domain pack",
  );
  exactCanonicalAdmissionKeys(
    domainPack,
    ["registry_version", "pack_version", "category_id"],
    "Structured domain pack",
  );
  const categoryId = canonicalAdmissionText(
    domainPack.category_id,
    "Structured category",
    200,
  );
  if (!Array.isArray(document.fields) || document.fields.length > 64)
    throw new Error("Structured canonical fields are invalid.");
  const fields = document.fields.flatMap((candidate, index) => {
    const field = canonicalAdmissionRecord(
      candidate,
      `Structured field ${index}`,
    );
    exactCanonicalAdmissionKeys(
      field,
      [
        "field_id",
        "macro_parameter",
        "typed_value",
        "translated",
        "confidence",
      ],
      `Structured field ${index}`,
    );
    const typed = structuredProviderValue(
      field.typed_value,
      `Structured field ${index}`,
    );
    if (!typed) return [];
    return [
      Object.freeze({
        field_id: canonicalAdmissionText(
          field.field_id,
          `Structured field ${index}.field_id`,
          200,
        ),
        value: typed.value,
        ...(typed.unit === undefined ? {} : { unit: typed.unit }),
      }),
    ];
  });
  if (
    !Array.isArray(document.hard_constraints) ||
    document.hard_constraints.length > 64
  )
    throw new Error("Structured hard constraints are invalid.");
  const hardConstraints = document.hard_constraints.map((candidate, index) => {
    const constraint = canonicalAdmissionRecord(
      candidate,
      `Structured constraint ${index}`,
    );
    const allowed = [
      "constraint_id",
      "field_id",
      "operator",
      "target",
      "relaxability",
      "tolerance",
      "direction",
    ];
    if (Object.keys(constraint).some((key) => !allowed.includes(key)))
      throw new Error(
        `Structured constraint ${index} contains unsupported fields.`,
      );
    const target = structuredProviderValue(
      constraint.target,
      `Structured constraint ${index}.target`,
    );
    if (!target)
      throw new Error(
        `Structured constraint ${index} has no canonical target.`,
      );
    return Object.freeze({
      constraint_id: canonicalAdmissionText(
        constraint.constraint_id,
        `Structured constraint ${index}.constraint_id`,
        200,
      ),
      field_id: canonicalAdmissionText(
        constraint.field_id,
        `Structured constraint ${index}.field_id`,
        200,
      ),
      operator: canonicalAdmissionText(
        constraint.operator,
        `Structured constraint ${index}.operator`,
        40,
      ),
      value: target.value,
      ...(target.unit === undefined ? {} : { unit: target.unit }),
      relaxability: canonicalAdmissionText(
        constraint.relaxability,
        `Structured constraint ${index}.relaxability`,
        40,
      ),
      ...(constraint.tolerance === undefined
        ? {}
        : {
            tolerance: canonicalAdmissionText(
              constraint.tolerance,
              `Structured constraint ${index}.tolerance`,
              100,
            ),
          }),
      ...(constraint.direction === undefined
        ? {}
        : {
            direction: canonicalAdmissionText(
              constraint.direction,
              `Structured constraint ${index}.direction`,
              100,
            ),
          }),
    });
  });
  if (!Array.isArray(document.exclusions) || document.exclusions.length > 64)
    throw new Error("Structured exclusions are invalid.");
  const exclusions = document.exclusions.map((candidate, index) => {
    const exclusion = canonicalAdmissionRecord(
      candidate,
      `Structured exclusion ${index}`,
    );
    exactCanonicalAdmissionKeys(
      exclusion,
      ["exclusion_id", "field_id", "canonical_english_value"],
      `Structured exclusion ${index}`,
    );
    return Object.freeze({
      exclusion_id: canonicalAdmissionText(
        exclusion.exclusion_id,
        `Structured exclusion ${index}.exclusion_id`,
        200,
      ),
      field_id: canonicalAdmissionText(
        exclusion.field_id,
        `Structured exclusion ${index}.field_id`,
        200,
      ),
      value: canonicalAdmissionText(
        exclusion.canonical_english_value,
        `Structured exclusion ${index}.value`,
      ),
    });
  });
  if (
    !Array.isArray(document.conditional_requirements) ||
    document.conditional_requirements.length > 32
  )
    throw new Error("Structured conditional requirements are invalid.");
  const conditionals = document.conditional_requirements.map(
    (candidate, index) => {
      const conditional = canonicalAdmissionRecord(
        candidate,
        `Structured conditional ${index}`,
      );
      exactCanonicalAdmissionKeys(
        conditional,
        [
          "requirement_id",
          "canonical_english_condition",
          "canonical_english_result",
          "requirement_level",
          "source_validation",
        ],
        `Structured conditional ${index}`,
      );
      return Object.freeze({
        requirement_id: canonicalAdmissionText(
          conditional.requirement_id,
          `Structured conditional ${index}.requirement_id`,
          200,
        ),
        condition: canonicalAdmissionText(
          conditional.canonical_english_condition,
          `Structured conditional ${index}.condition`,
        ),
        result: canonicalAdmissionText(
          conditional.canonical_english_result,
          `Structured conditional ${index}.result`,
        ),
        requirement_level: canonicalAdmissionText(
          conditional.requirement_level,
          `Structured conditional ${index}.requirement_level`,
          40,
        ),
      });
    },
  );
  const providerRequest = JSON.stringify({
    schema_version: "live-provider-request.v1",
    category_id: categoryId,
    fields: fields.sort((left, right) =>
      left.field_id.localeCompare(right.field_id, "en"),
    ),
    hard_constraints: hardConstraints.sort((left, right) =>
      left.constraint_id.localeCompare(right.constraint_id, "en"),
    ),
    exclusions: exclusions.sort((left, right) =>
      left.exclusion_id.localeCompare(right.exclusion_id, "en"),
    ),
    conditional_requirements: conditionals.sort((left, right) =>
      left.requirement_id.localeCompare(right.requirement_id, "en"),
    ),
  });
  if (
    providerRequest.length > 12_000 ||
    !/[A-Za-z]/u.test(providerRequest) ||
    NON_ENGLISH_CANONICAL_SCRIPT.test(providerRequest)
  )
    throw new Error("Structured live provider request is invalid.");
  return providerRequest;
}

async function inSerializableTransaction<T>(
  pool: ConnectionPool,
  operation: (client: Queryable) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await inTransaction(pool, async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        return await operation(client);
      });
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "40001" ||
        attempt === 4
      )
        throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt + 1));
    }
  }
  throw new Error("Serializable transaction retry limit was exhausted.");
}

interface ReservationRow {
  execution_id: string;
  account_id: string;
  run_id: string;
  generation: number | string;
  state: "in_progress" | "terminal";
  lease_expires_at: Date;
  lease_active?: boolean;
  ownership_token_sha256: Buffer;
  execution_lease_slot: number | string;
  execution_lease_generation: number | string;
  terminal_record: unknown | null;
  pipeline_identity_record: unknown | null;
}

export interface ServerOwnedSourceDiscovery {
  discover(input: {
    policy: ResearchRoutePolicyV1;
    executionId: string;
    runId: string;
    capturedAt: string;
    canonicalEnglishRequest: string;
    signal: AbortSignal;
    assertOwnership: () => Promise<void>;
  }): Promise<{
    route: LiveResearchRouteRecord;
    sourceUrls: readonly string[];
  }>;
}

class SourceDiscoveryFailure extends Error {
  constructor(
    message: string,
    readonly route: LiveResearchRouteRecord,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LiveResearchProcessInterrupted extends Error {}
export class LiveResearchCapacityUnavailable extends Error {}

interface SourceDiscoveryCheckpoint {
  readonly route: LiveResearchRouteRecord;
  readonly sourceUrls: readonly string[];
  readonly searchAttemptId: string;
}

export function canonicalSourceUrls(
  value: readonly string[],
): readonly string[] {
  if (value.length < 1 || value.length > 10)
    throw new Error("Server-owned source discovery returned invalid URLs.");
  const canonical: string[] = [];
  for (const candidate of value) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error("Server-owned source discovery returned invalid URLs.");
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      (url.href !== candidate && url.href !== `${candidate}/`)
    )
      throw new Error("Server-owned source discovery returned invalid URLs.");
    canonical.push(url.href);
  }
  if (new Set(canonical).size !== canonical.length)
    throw new Error("Server-owned source discovery returned invalid URLs.");
  return Object.freeze(canonical);
}

export function isGeminiGroundingRedirectIntermediary(
  candidate: string,
): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === "vertexaisearch.cloud.google.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    url.search === "" &&
    url.pathname.startsWith("/grounding-api-redirect/")
  );
}

function validateSourceDiscoveryCheckpoint(
  value: unknown,
  runId: string,
  searchAttemptId: string,
): SourceDiscoveryCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Source-discovery checkpoint is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "route,sourceUrls")
    throw new Error("Source-discovery checkpoint is not closed.");
  const route = record.route as LiveResearchRouteRecord;
  if (
    !route ||
    route.failureCode !== null ||
    route.snapshot?.runId !== runId ||
    route.snapshot.terminalDisposition !== "ok" ||
    !Array.isArray(route.attempts) ||
    route.attempts.length < 1 ||
    route.attempts.some(
      (attempt) =>
        attempt.capabilityId !== "CAP-SEARCH" ||
        attempt.outcome !== "ok" ||
        attempt.costState === "unknown",
    )
  )
    throw new Error("Source-discovery checkpoint route is invalid.");
  if (!Array.isArray(record.sourceUrls))
    throw new Error("Source-discovery checkpoint URLs are invalid.");
  return Object.freeze({
    route,
    sourceUrls: canonicalSourceUrls(record.sourceUrls as string[]),
    searchAttemptId,
  });
}

export class GeminiServerOwnedSourceDiscovery implements ServerOwnedSourceDiscovery {
  constructor(private readonly transport: ProviderTransport) {}

  async discover(input: {
    policy: ResearchRoutePolicyV1;
    executionId: string;
    runId: string;
    capturedAt: string;
    canonicalEnglishRequest: string;
    signal: AbortSignal;
    assertOwnership: () => Promise<void>;
  }): Promise<{
    route: LiveResearchRouteRecord;
    sourceUrls: readonly string[];
  }> {
    const definition = input.policy.routes
      .filter((route) => route.enabled && route.path === "gemini_direct")
      .sort((left, right) => left.fallbackPosition - right.fallbackPosition)[0];
    if (!definition)
      throw new Error(
        "Qualified direct source-discovery route is unavailable.",
      );
    const route = resolveActiveResearchRoute(
      input.policy,
      definition.routeId,
      input.capturedAt,
    );
    if (route.parameterPolicy.searchMode !== "provider_native_web_search")
      throw new Error("Direct source discovery lacks native web search.");
    await input.assertOwnership();
    const attempts: ProviderAttemptOutcome[] = [];
    let response: Awaited<ReturnType<typeof executeProviderRequest>>;
    try {
      response = await executeProviderRequest({
        capabilityId: "CAP-SEARCH",
        route: {
          routeId: route.routeId,
          providerId: "gemini_direct",
          modelId: route.requestedModelId,
          enabled: true,
          environment: input.policy.environment,
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
        signal: input.signal,
        onAttempt: (attempt) =>
          void attempts.push(Object.freeze({ ...attempt })),
        request: (signal) => ({
          url: "https://generativelanguage.googleapis.com/v1beta/interactions",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json({
            model: route.requestedModelId,
            input: [
              input.canonicalEnglishRequest,
              "Search the current public web now using five distinct query angles inside this single grounded interaction: exact product and supplier identity; current inventory or dated availability; requested volume and export capacity; Dubai routing or UAE presence; and African-market distribution or compliance.",
              "Prefer primary supplier pages, official registries, dated catalog or stock pages, and authoritative trade or customs sources.",
              "Return up to ten unique canonical public HTTPS source URLs that materially support or refute any part of the request. Do not require one source to prove every constraint.",
            ].join("\n"),
            tools: [{ type: "google_search" }],
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["sourceUrls"],
                properties: {
                  sourceUrls: {
                    type: "array",
                    minItems: 1,
                    maxItems: 10,
                    uniqueItems: true,
                    items: { type: "string", format: "uri" },
                  },
                },
              },
            },
          }),
          signal,
        }),
        validateResponse: (candidate) => {
          if (
            candidate.servedIdentity?.providerId !== route.providerId ||
            candidate.servedIdentity.modelId !== route.expectedServedModelId
          )
            throw new Error("Source-discovery served identity drifted.");
        },
      });
    } catch (error) {
      if (attempts.length === 0) throw error;
      throw new SourceDiscoveryFailure(
        input.signal.aborted
          ? "Source-discovery provider attempt was cancelled."
          : "Source-discovery provider attempt failed.",
        {
          snapshot: createResearchRouteSnapshot({
            policy: input.policy,
            route,
            snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${route.routeId}`,
            runId: input.runId,
            servedProviderId: null,
            servedModelId: null,
            terminalDisposition: input.signal.aborted ? "cancelled" : "failed",
            capturedAt: input.capturedAt,
          }),
          attempts,
          failureCode: input.signal.aborted
            ? "source_discovery_cancelled"
            : "source_discovery_failed",
        },
        { cause: error },
      );
    }
    const body = response.body as { sourceUrls?: unknown };
    if (
      !body ||
      Object.keys(body).join(",") !== "sourceUrls" ||
      !Array.isArray(body.sourceUrls) ||
      body.sourceUrls.length < 1 ||
      body.sourceUrls.length > 10 ||
      body.sourceUrls.some(
        (url) => typeof url !== "string" || !url.startsWith("https://"),
      ) ||
      new Set(body.sourceUrls).size !== body.sourceUrls.length ||
      attempts.length < 1 ||
      attempts.some((attempt) => attempt.costState === "unknown")
    ) {
      throw new SourceDiscoveryFailure(
        "Source-discovery response is invalid or unreconciled.",
        {
          snapshot: createResearchRouteSnapshot({
            policy: input.policy,
            route,
            snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${route.routeId}`,
            runId: input.runId,
            servedProviderId: null,
            servedModelId: null,
            terminalDisposition: "failed",
            capturedAt: input.capturedAt,
          }),
          attempts,
          failureCode: "source_discovery_invalid",
        },
      );
    }
    return {
      route: {
        snapshot: createResearchRouteSnapshot({
          policy: input.policy,
          route,
          snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${route.routeId}`,
          runId: input.runId,
          servedProviderId: response.servedIdentity!.providerId,
          servedModelId: response.servedIdentity!.modelId,
          terminalDisposition: "ok",
          capturedAt: input.capturedAt,
        }),
        attempts,
        failureCode: null,
      },
      sourceUrls: Object.freeze([...body.sourceUrls]),
    };
  }
}

export class PostgresLiveResearchAtomicLedger {
  constructor(
    private readonly options: {
      pool: ConnectionPool;
      accountId: string;
      userId: string;
      policyId: string;
      leaseMs?: number;
      heartbeatMs?: number;
      pollMs?: number;
      waitMs?: number;
      now?: () => Date;
      pipelineIdentity: LiveResearchPipelineIdentityV1;
      authoritativeRegistryDomains?: readonly string[];
      executionEnvironment?: "local" | "test" | "staging" | "production";
      deploymentId?: string;
      consultantProjectionConfig?: ConsultantProjectionConfigRelease;
    },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private leaseMs(): number {
    const value = this.options.leaseMs ?? 120_000;
    if (!Number.isSafeInteger(value) || value < 40 || value > 600_000)
      throw new Error("Live research lease duration is invalid.");
    return value;
  }

  private heartbeatMs(): number {
    const value = this.options.heartbeatMs ?? 30_000;
    if (
      !Number.isSafeInteger(value) ||
      value < 10 ||
      value > 30_000 ||
      value * 4 > this.leaseMs()
    )
      throw new Error("Live research heartbeat duration is invalid.");
    return value;
  }

  private async authoritativePipelineIdentity(
    runId: string,
    database: Queryable,
    lockRunRow = true,
  ): Promise<LiveResearchPipelineIdentityV1> {
    type IdentityRow = {
      research_route_policy_id: string;
      route_policy_version: string;
      route_policy_content_sha256: Buffer | null;
      model_policy_version_id: string;
      model_policy_version: number | string;
      model_policy_content_sha256: Buffer;
      scoring_config_version_id: string;
      scoring_config_version: number | string;
      scoring_config_content_sha256: Buffer;
    };
    const result = lockRunRow
      ? await database.query<IdentityRow>(
          `SELECT rp.research_route_policy_id,
              rp.policy_version route_policy_version,
              rp.content_sha256 route_policy_content_sha256,
              mp.model_policy_version_id,mp.version model_policy_version,
              mp.content_sha256 model_policy_content_sha256,
              sc.scoring_config_version_id,sc.version scoring_config_version,
              sc.content_sha256 scoring_config_content_sha256
         FROM research_run r
         JOIN model_policy_version mp
           ON mp.model_policy_version_id=r.model_policy_version_id
         JOIN scoring_config_version sc
           ON sc.scoring_config_version_id=r.scoring_config_version_id
         JOIN research_route_policy rp
           ON rp.research_route_policy_id=$3 AND rp.activation_state='qualified'
        WHERE r.account_id=$1 AND r.run_id=$2
        FOR SHARE OF r`,
          [this.options.accountId, runId, this.options.policyId],
        )
      : await (async () => {
          const run = await database.query<{
            model_policy_version_id: string;
            scoring_config_version_id: string;
          }>(
            `SELECT model_policy_version_id,scoring_config_version_id
               FROM research_run
              WHERE account_id=$1 AND run_id=$2`,
            [this.options.accountId, runId],
          );
          const pinned = run.rows[0];
          if (!pinned)
            throw new Error(
              "Authoritative version-pinned live research admission is unavailable.",
            );
          return await database.query<IdentityRow>(
            `SELECT rp.research_route_policy_id,
                    rp.policy_version route_policy_version,
                    rp.content_sha256 route_policy_content_sha256,
                    mp.model_policy_version_id,mp.version model_policy_version,
                    mp.content_sha256 model_policy_content_sha256,
                    sc.scoring_config_version_id,sc.version scoring_config_version,
                    sc.content_sha256 scoring_config_content_sha256
               FROM model_policy_version mp
               JOIN scoring_config_version sc
                 ON sc.scoring_config_version_id=$2
               JOIN research_route_policy rp
                 ON rp.research_route_policy_id=$3 AND rp.activation_state='qualified'
              WHERE mp.model_policy_version_id=$1
              `,
            [
              pinned.model_policy_version_id,
              pinned.scoring_config_version_id,
              this.options.policyId,
            ],
          );
        })();
    const row = result.rows[0];
    if (!row?.route_policy_content_sha256)
      throw new Error(
        "Authoritative version-pinned live research admission is unavailable.",
      );
    return createLiveResearchPipelineIdentity({
      outputSchema: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
      researchRoutePolicyId: row.research_route_policy_id,
      routePolicyVersion: row.route_policy_version,
      routePolicyCanonicalSha256:
        row.route_policy_content_sha256.toString("hex"),
      modelPolicyVersionId: row.model_policy_version_id,
      modelPolicyVersion: String(row.model_policy_version),
      modelPolicyContentSha256: row.model_policy_content_sha256.toString("hex"),
      scoringConfigVersionId: row.scoring_config_version_id,
      scoringConfigVersion: String(row.scoring_config_version),
      scoringConfigContentSha256:
        row.scoring_config_content_sha256.toString("hex"),
    });
  }

  private async terminal(
    executionId: string,
  ): Promise<LiveResearchTerminalRecord<EvidenceGraphV1> | null> {
    const result = await this.options.pool.query<{ terminal_record: unknown }>(
      `SELECT t.terminal_record
         FROM live_research_execution_reservation r
         JOIN live_research_terminal t ON t.live_research_terminal_id=r.terminal_id
        WHERE r.execution_id=$1 AND r.account_id=$2 AND r.state='terminal'`,
      [executionId, this.options.accountId],
    );
    return (
      (result.rows[0]
        ?.terminal_record as LiveResearchTerminalRecord<EvidenceGraphV1>) ??
      null
    );
  }

  private async waitForTerminal(
    executionId: string,
    runId: string,
  ): Promise<LiveResearchTerminalRecord<EvidenceGraphV1>> {
    const deadline = Date.now() + (this.options.waitMs ?? 30_000);
    while (Date.now() < deadline) {
      const terminal = await this.terminal(executionId);
      if (terminal) {
        if (terminal.runId !== runId)
          throw new Error(
            "Live research execution identity belongs to another run.",
          );
        return terminal;
      }
      const lease = await this.options.pool.query<{ lease_active: boolean }>(
        `SELECT lease_expires_at > $4::timestamptz AS lease_active
           FROM live_research_execution_reservation
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3`,
        [executionId, this.options.accountId, runId, this.now()],
      );
      if (!lease.rows[0]?.lease_active)
        throw new Error(
          "Live research execution lease expired; retry may reclaim it.",
        );
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.pollMs ?? 20),
      );
    }
    throw new Error("Timed out waiting for the owned live research execution.");
  }

  async reserveExecution(executionId: string, runId: string) {
    const ownershipToken = randomUUID();
    const tokenHash = sha(ownershipToken);
    const leaseMs = this.leaseMs();
    const now = this.now();
    const state = await inSerializableTransaction(
      this.options.pool,
      async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${this.options.accountId}:${runId}`],
        );
        const authoritativeIdentity = await this.authoritativePipelineIdentity(
          runId,
          client,
        );
        assertLiveResearchPipelineIdentityUnchanged(
          authoritativeIdentity,
          this.options.pipelineIdentity,
        );
        const existing = await client.query<ReservationRow>(
          `SELECT r.execution_id,r.account_id,r.run_id,r.generation,r.state,r.lease_expires_at,
                r.ownership_token_sha256,r.execution_lease_slot,
                r.execution_lease_generation,r.pipeline_identity_record,t.terminal_record
           FROM live_research_execution_reservation r
           LEFT JOIN live_research_terminal t ON t.live_research_terminal_id=r.terminal_id
          WHERE r.execution_id=$1 OR (r.account_id=$2 AND r.run_id=$3)
          FOR UPDATE OF r`,
          [executionId, this.options.accountId, runId],
        );
        if (existing.rows.length > 1)
          throw new Error(
            "Live research execution identity belongs to another run.",
          );
        const row = existing.rows[0];
        if (
          row &&
          (row.account_id !== this.options.accountId || row.run_id !== runId)
        )
          throw new Error(
            "Live research execution identity belongs to another run.",
          );
        if (row)
          assertLiveResearchPipelineIdentityUnchanged(
            row.pipeline_identity_record,
            authoritativeIdentity,
          );
        if (row && row.execution_id !== executionId)
          throw new Error(
            "Live research execution identity changed on resume.",
          );
        if (row?.state === "terminal") return { state: "existing" as const };
        if (row && row.lease_expires_at > now)
          return { state: "existing" as const };

        const slot = await client.query<{
          slot_no: number;
          generation: number;
          run_id: string | null;
        }>(
          `SELECT slot_no,generation,run_id
           FROM execution_lease
          WHERE run_id IS NULL OR released_at IS NOT NULL OR expires_at <= $1
          ORDER BY slot_no
          FOR UPDATE SKIP LOCKED LIMIT 1`,
          [now],
        );
        const selected = slot.rows[0];
        if (!selected) return { state: "unavailable" as const };
        if (selected.run_id && selected.run_id !== runId) {
          await client.query(
            `UPDATE research_run
              SET state='failed_retryable',state_reason='lease_expired',started_at=NULL
            WHERE run_id=$1 AND state IN ('researching','scoring','cancelling')`,
            [selected.run_id],
          );
        }
        const acquiredSlot = await client.query<{
          slot_no: number;
          generation: number;
        }>(
          `UPDATE execution_lease
            SET run_id=$1,account_id=$2,owner_token_hash=$3,
                generation=generation+1,acquired_at=$5,renewed_at=$5,
                expires_at=$5::timestamptz+($4::int * interval '1 millisecond'),
                released_at=NULL,release_reason=NULL
          WHERE slot_no=$6
          RETURNING slot_no,generation`,
          [
            runId,
            this.options.accountId,
            tokenHash,
            leaseMs,
            now,
            selected.slot_no,
          ],
        );
        const globalLease = acquiredSlot.rows[0];
        if (!globalLease)
          throw new Error("Global live research execution slot was lost.");
        const runUpdated = await client.query(
          `UPDATE research_run
            SET state='researching',started_at=coalesce(started_at,$3)
          WHERE run_id=$1 AND account_id=$2
            AND research_mode='qualified_live_research'
            AND state IN ('queued','failed_retryable','researching')`,
          [runId, this.options.accountId, now],
        );
        if (runUpdated.rowCount !== 1)
          throw new Error("Qualified live research run is not claimable.");

        const reservationGeneration = row ? Number(row.generation) + 1 : 1;
        if (!Number.isSafeInteger(reservationGeneration))
          throw new Error("Live research reservation generation is invalid.");
        if (row) {
          await client.query(
            `UPDATE live_research_execution_reservation
              SET ownership_token_sha256=$4,generation=$5,
                  execution_lease_slot=$6,execution_lease_generation=$7,
                  lease_expires_at=$8::timestamptz+($9::int * interval '1 millisecond'),
                  claimed_at=$8,updated_at=$8
            WHERE execution_id=$1 AND account_id=$2 AND run_id=$3`,
            [
              executionId,
              this.options.accountId,
              runId,
              tokenHash,
              reservationGeneration,
              globalLease.slot_no,
              globalLease.generation,
              now,
              leaseMs,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO live_research_execution_reservation
             (execution_id,account_id,run_id,generation,ownership_token_sha256,state,
              execution_lease_slot,execution_lease_generation,pipeline_identity_record,
              lease_expires_at,claimed_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'in_progress',$6,$7,
                   $8::jsonb,$9::timestamptz+($10::int * interval '1 millisecond'),$9,$9)`,
            [
              executionId,
              this.options.accountId,
              runId,
              reservationGeneration,
              tokenHash,
              globalLease.slot_no,
              globalLease.generation,
              json(authoritativeIdentity),
              now,
              leaseMs,
            ],
          );
        }
        await this.recordReservationEvent(
          client,
          executionId,
          runId,
          row ? "reclaimed_after_expiry" : "claimed",
          tokenHash,
          reservationGeneration,
        );
        return {
          state: "acquired" as const,
          generation: reservationGeneration,
        };
      },
    );
    return state.state === "acquired"
      ? ({ ...state, ownershipToken } as const)
      : state.state === "unavailable"
        ? (state as { state: "unavailable" })
        : ({
            state: state.state,
            terminal: this.waitForTerminal(executionId, runId),
          } as const);
  }

  async assertOwnership(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    database: Queryable = this.options.pool,
  ): Promise<void> {
    const owned = await database.query(
      `SELECT 1 FROM live_research_execution_reservation r
         JOIN execution_lease e
           ON e.slot_no=r.execution_lease_slot
          AND e.generation=r.execution_lease_generation
          AND e.run_id=r.run_id AND e.account_id=r.account_id
          AND e.owner_token_hash=r.ownership_token_sha256
        WHERE r.execution_id=$1 AND r.account_id=$2 AND r.run_id=$3
          AND r.generation=$4 AND r.ownership_token_sha256=$5
          AND r.state='in_progress' AND r.lease_expires_at > $6::timestamptz
          AND e.released_at IS NULL AND e.expires_at > $6::timestamptz`,
      [
        executionId,
        this.options.accountId,
        runId,
        generation,
        sha(ownershipToken),
        this.now(),
      ],
    );
    if (owned.rowCount !== 1)
      throw new Error("Live research execution ownership was fenced.");
  }

  async withPipelineIdentityAdmission<T>(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    providerCall: () => Promise<T>,
  ): Promise<T> {
    const verifyAdmission = async () =>
      await inTransaction(this.options.pool, async (client) => {
        const authoritativeIdentity = await this.authoritativePipelineIdentity(
          runId,
          client,
          false,
        );
        assertLiveResearchPipelineIdentityUnchanged(
          authoritativeIdentity,
          this.options.pipelineIdentity,
        );
        const result = await client.query<{
          pipeline_identity_record: unknown | null;
        }>(
          `SELECT pipeline_identity_record
             FROM live_research_execution_reservation r
             JOIN execution_lease e
               ON e.slot_no=r.execution_lease_slot
              AND e.generation=r.execution_lease_generation
              AND e.run_id=r.run_id AND e.account_id=r.account_id
              AND e.owner_token_hash=r.ownership_token_sha256
            WHERE r.execution_id=$1 AND r.account_id=$2 AND r.run_id=$3
              AND r.generation=$4 AND r.ownership_token_sha256=$5
              AND r.state='in_progress'
              AND r.lease_expires_at > $6::timestamptz
              AND e.released_at IS NULL AND e.expires_at > $6::timestamptz`,
          [
            executionId,
            this.options.accountId,
            runId,
            generation,
            sha(ownershipToken),
            this.now(),
          ],
        );
        const pinnedIdentity = result.rows[0]?.pipeline_identity_record;
        if (!pinnedIdentity)
          throw new Error(
            `Live research pipeline identity ownership was fenced for ${executionId}.`,
          );
        assertLiveResearchPipelineIdentityUnchanged(
          pinnedIdentity,
          authoritativeIdentity,
        );
        return { authoritativeIdentity, pinnedIdentity };
      });
    const before = await verifyAdmission();
    const response = await admitLiveResearchProviderCall(
      before.pinnedIdentity,
      before.authoritativeIdentity,
      providerCall,
    );
    const after = await verifyAdmission();
    assertLiveResearchPipelineIdentityUnchanged(
      after.authoritativeIdentity,
      before.authoritativeIdentity,
    );
    return response;
  }

  async lockOwnership(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    client: Queryable,
  ): Promise<void> {
    const owned = await client.query(
      `SELECT 1 FROM live_research_execution_reservation r
         JOIN execution_lease e
           ON e.slot_no=r.execution_lease_slot
          AND e.generation=r.execution_lease_generation
          AND e.run_id=r.run_id AND e.account_id=r.account_id
          AND e.owner_token_hash=r.ownership_token_sha256
        WHERE r.execution_id=$1 AND r.account_id=$2 AND r.run_id=$3
          AND r.generation=$4 AND r.ownership_token_sha256=$5
          AND r.state='in_progress' AND r.lease_expires_at > $6::timestamptz
          AND e.released_at IS NULL AND e.expires_at > $6::timestamptz
        FOR UPDATE OF r,e`,
      [
        executionId,
        this.options.accountId,
        runId,
        generation,
        sha(ownershipToken),
        this.now(),
      ],
    );
    if (owned.rowCount !== 1)
      throw new Error("Live research persistence ownership was fenced.");
  }

  async renewOwnership(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
  ): Promise<void> {
    const now = this.now();
    const tokenHash = sha(ownershipToken);
    await inTransaction(this.options.pool, async (client) => {
      const reservation = await client.query<ReservationRow>(
        `SELECT account_id,run_id,generation,state,lease_expires_at,
                ownership_token_sha256,execution_lease_slot,
                execution_lease_generation,NULL::jsonb terminal_record
           FROM live_research_execution_reservation
          WHERE execution_id=$1 FOR UPDATE`,
        [executionId],
      );
      const row = reservation.rows[0];
      if (
        !row ||
        row.account_id !== this.options.accountId ||
        row.run_id !== runId ||
        String(row.generation) !== String(generation) ||
        row.state !== "in_progress" ||
        row.lease_expires_at <= now ||
        !row.ownership_token_sha256.equals(tokenHash)
      )
        throw new Error("Live research heartbeat lost execution ownership.");
      const global = await client.query(
        `UPDATE execution_lease
            SET renewed_at=$7,
                expires_at=$7::timestamptz+($6::int * interval '1 millisecond')
          WHERE slot_no=$1 AND run_id=$2 AND account_id=$3
            AND generation=$4 AND owner_token_hash=$5
            AND released_at IS NULL AND expires_at > $7
          RETURNING slot_no`,
        [
          Number(row.execution_lease_slot),
          runId,
          this.options.accountId,
          Number(row.execution_lease_generation),
          tokenHash,
          this.leaseMs(),
          now,
        ],
      );
      if (global.rowCount !== 1)
        throw new Error("Live research heartbeat lost its global slot.");
      await client.query(
        `UPDATE live_research_execution_reservation
            SET lease_expires_at=$6::timestamptz+($5::int * interval '1 millisecond'),
                updated_at=$6
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3
            AND generation=$4`,
        [
          executionId,
          this.options.accountId,
          runId,
          generation,
          this.leaseMs(),
          now,
        ],
      );
    });
  }

  startHeartbeat(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    onOwnershipLost?: (error: Error) => void,
  ): { assertOwned: () => Promise<void>; stop: () => Promise<void> } {
    let stopped = false;
    let inFlight: Promise<void> = Promise.resolve();
    let failure: Error | undefined;
    const beat = () => {
      if (stopped || failure) return;
      inFlight = this.renewOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
      ).catch((error: unknown) => {
        failure =
          error instanceof Error
            ? error
            : new Error("Live research heartbeat failed.");
        onOwnershipLost?.(failure);
      });
    };
    const timer = setInterval(beat, this.heartbeatMs());
    timer.unref();
    return {
      assertOwned: async () => {
        await inFlight;
        if (failure) throw failure;
        await this.assertOwnership(
          ownershipToken,
          generation,
          executionId,
          runId,
        );
      },
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await inFlight;
      },
    };
  }

  private async recordReservationEvent(
    client: Queryable,
    executionId: string,
    runId: string,
    eventType: "claimed" | "reclaimed_after_expiry" | "terminal_committed",
    tokenHash: Buffer,
    generation: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO live_research_execution_reservation_event
         (reservation_event_id,execution_id,account_id,run_id,event_type,
          generation,ownership_token_sha256,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        executionId,
        this.options.accountId,
        runId,
        eventType,
        generation,
        tokenHash,
        this.now(),
      ],
    );
  }

  async commitTerminal(
    ownershipToken: string,
    generation: number,
    record: LiveResearchTerminalRecord<EvidenceGraphV1>,
    sourceDiscovery?: Readonly<{
      canonicalEnglishRequest: string;
      resultCount: number;
    }>,
  ): Promise<LiveResearchTerminalRecord<EvidenceGraphV1>> {
    const tokenHash = sha(ownershipToken);
    return await inTransaction(this.options.pool, async (client) => {
      const reservation = await client.query<ReservationRow>(
        `SELECT account_id,run_id,generation,state,lease_expires_at,
                lease_expires_at > $2::timestamptz lease_active,
                ownership_token_sha256,execution_lease_slot,
                execution_lease_generation,NULL::jsonb terminal_record
           FROM live_research_execution_reservation
          WHERE execution_id=$1 FOR UPDATE`,
        [record.executionId, this.now()],
      );
      const row = reservation.rows[0];
      if (!row)
        throw new Error("Live research terminal reservation is unavailable.");
      if (
        row.account_id !== this.options.accountId ||
        row.run_id !== record.runId
      )
        throw new Error("Live research terminal ownership scope changed.");
      if (String(row.generation) !== String(generation))
        throw new Error("Live research terminal generation was fenced.");
      if (
        row.state !== "in_progress" ||
        !row.ownership_token_sha256.equals(tokenHash) ||
        !row.lease_active
      )
        throw new Error(
          "Live research terminal commit lacks active ownership.",
        );

      const policy = await client.query<{ policy_version: string }>(
        `SELECT policy_version FROM research_route_policy
          WHERE research_route_policy_id=$1 AND activation_state='qualified'`,
        [this.options.policyId],
      );
      if (!policy.rows[0])
        throw new Error("Qualified route policy is unavailable.");

      let terminalSearchAttemptId: string | null = null;
      let terminalSearchRoute: LiveResearchRouteRecord | null = null;
      for (const routeRecord of record.routes) {
        const snapshot = routeRecord.snapshot;
        if (snapshot.policyVersion !== policy.rows[0].policy_version)
          throw new Error(
            "Route snapshot policy does not match the qualified DB policy.",
          );
        await client.query(
          `INSERT INTO research_route_snapshot
             (research_route_snapshot_id,account_id,run_id,research_route_policy_id,
              snapshot_version,adapter_version,route_id,route_path,requested_provider,
              requested_model,expected_served_provider,expected_served_model,served_provider,
              served_model,terminal_disposition,capability_policy_version,
              parameter_policy_sha256,data_handling_evidence_version,fallback_position,
              qualification_state,captured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'qualified',$20)`,
          [
            snapshot.snapshotId,
            this.options.accountId,
            record.runId,
            this.options.policyId,
            snapshot.schemaVersion,
            snapshot.adapterVersion,
            snapshot.routeId,
            snapshot.path,
            snapshot.providerId,
            snapshot.requestedModelId,
            snapshot.expectedServedProviderId,
            snapshot.expectedServedModelId,
            snapshot.servedProviderId,
            snapshot.servedModelId,
            snapshot.terminalDisposition,
            snapshot.capabilityPolicyVersion,
            sha(json(snapshot.parameterPolicy)),
            snapshot.dataHandlingEvidenceVersion,
            snapshot.fallbackPosition,
            snapshot.capturedAt,
          ],
        );
        let lastProviderAttemptId = "";
        for (const attempt of routeRecord.attempts) {
          lastProviderAttemptId = await this.persistProviderAttempt(
            client,
            record.runId,
            snapshot,
            attempt,
          );
        }
        if (
          routeRecord.attempts.some(
            (attempt) => attempt.capabilityId === "CAP-SEARCH",
          )
        ) {
          if (
            !sourceDiscovery ||
            !lastProviderAttemptId ||
            routeRecord.attempts.some(
              (attempt) => attempt.capabilityId !== "CAP-SEARCH",
            )
          )
            throw new Error(
              "Source-discovery terminal omitted its exact search lineage.",
            );
          terminalSearchAttemptId = await this.persistSearchAttempt(
            client,
            record.runId,
            lastProviderAttemptId,
            sourceDiscovery.canonicalEnglishRequest,
            routeRecord,
            sourceDiscovery.resultCount,
          );
          terminalSearchRoute = routeRecord;
        }
      }
      const persistedResult =
        record.result === null
          ? null
          : await this.persistEvidenceGraph(
              client,
              record.runId,
              record.result,
            );
      const persistedRecord =
        persistedResult === record.result
          ? record
          : Object.freeze({ ...record, result: persistedResult });

      const totals = await client.query<{
        provider_attempts: number;
        cost_events: number;
        amount: string;
        currencies: string[];
        pricing_versions: string[];
        has_unknown: boolean;
      }>(
        `SELECT count(pa.*)::int provider_attempts,
                count(ce.*)::int cost_events,
                coalesce(sum(ce.amount),0)::text amount,
                coalesce(array_agg(DISTINCT ce.currency_code) FILTER (WHERE ce.currency_code IS NOT NULL),'{}') currencies,
                coalesce(array_agg(DISTINCT ce.pricing_version) FILTER (WHERE ce.pricing_version IS NOT NULL),'{}') pricing_versions,
                coalesce(bool_or(ce.pricing_state IN ('unknown','unpriced')),false) has_unknown
           FROM provider_attempt pa
           LEFT JOIN cost_event ce ON ce.capability_attempt_id=pa.capability_attempt_id
          WHERE pa.account_id=$1 AND pa.run_id=$2`,
        [this.options.accountId, record.runId],
      );
      const total = totals.rows[0]!;
      const unknown =
        total.provider_attempts !== total.cost_events ||
        total.currencies.length > 1 ||
        total.has_unknown;
      const reconciliationState = unknown ? "blocked_unknown" : "closed";
      if (record.disposition === "complete" && reconciliationState !== "closed")
        throw new Error(
          "A complete live result requires closed cost reconciliation.",
        );
      await client.query(
        `INSERT INTO live_cost_reconciliation
           (live_cost_reconciliation_id,account_id,run_id,expected_provider_attempts,
            recorded_provider_attempts,recorded_cost_events,amount,currency_code,
            pricing_version,reconciliation_state,reconciled_at)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
        [
          randomUUID(),
          this.options.accountId,
          record.runId,
          total.provider_attempts,
          total.cost_events,
          unknown ? null : Number(total.amount),
          unknown ? null : (total.currencies[0] ?? "USD"),
          unknown
            ? null
            : `pricing-set:${sha(total.pricing_versions.sort().join("\0")).toString("hex").slice(0, 24)}`,
          reconciliationState,
        ],
      );
      const terminalId = randomUUID();
      const serializedResult =
        persistedRecord.result === null ? null : json(persistedRecord.result);
      await client.query(
        `INSERT INTO live_research_terminal
           (live_research_terminal_id,execution_id,account_id,run_id,disposition,
            reason_code,route_count,terminal_record,sanitized_result,result_sha256,completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
        [
          terminalId,
          record.executionId,
          this.options.accountId,
          record.runId,
          record.disposition,
          record.reasonCode,
          record.routes.length,
          json(persistedRecord),
          serializedResult,
          serializedResult === null ? null : sha(serializedResult),
          record.completedAt,
        ],
      );
      await client.query(
        `UPDATE live_research_execution_reservation
            SET state='terminal',terminal_id=$4,
                checkpoint_stage=CASE WHEN coalesce($5::uuid,search_attempt_id) IS NULL
                                      THEN 'terminal_no_source' ELSE 'terminal' END,
                source_discovery_record=coalesce($6::jsonb,source_discovery_record),
                search_attempt_id=coalesce($5::uuid,search_attempt_id),
                updated_at=clock_timestamp()
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3`,
        [
          record.executionId,
          this.options.accountId,
          record.runId,
          terminalId,
          terminalSearchAttemptId,
          terminalSearchRoute
            ? json({ route: terminalSearchRoute, sourceUrls: [] })
            : null,
        ],
      );
      const runState =
        record.disposition === "complete"
          ? "complete"
          : record.disposition === "cancelled"
            ? "cancelled"
            : "failed";
      const runUpdated = await client.query(
        `UPDATE research_run
            SET state=$4,state_reason=$5,
                completed_at=CASE WHEN $4 IN ('complete','failed','cancelled')
                                  THEN $6::timestamptz ELSE NULL END,
                cancelled_at=CASE WHEN $4='cancelled' THEN $6::timestamptz ELSE NULL END
          WHERE account_id=$1 AND run_id=$2
            AND research_mode='qualified_live_research'
            AND state IN ('queued','researching','failed_retryable','cancelling')
            AND requested_by_user_id=$3`,
        [
          this.options.accountId,
          record.runId,
          this.options.userId,
          runState,
          record.reasonCode,
          record.completedAt,
        ],
      );
      if (runUpdated.rowCount !== 1)
        throw new Error("Qualified live research run lifecycle was not owned.");
      if (
        record.disposition === "failed_retryable" ||
        record.disposition === "failed"
      ) {
        const compensationId = randomUUID();
        const compensated = await client.query<{
          compensates_entry_id: string;
        }>(
          `INSERT INTO quota_ledger (
             quota_entry_id,account_id,user_id,run_id,entry_kind,units,
             charged_at,reason_code,compensates_entry_id
           )
           SELECT $4,q.account_id,q.user_id,q.run_id,'compensation',-1,
                  clock_timestamp(),'live_research_terminal_failure',
                  q.quota_entry_id
             FROM quota_ledger q
            WHERE q.account_id=$1 AND q.user_id=$2 AND q.run_id=$3
              AND q.entry_kind='charge'
              AND NOT EXISTS (
                SELECT 1 FROM quota_ledger c
                 WHERE c.compensates_entry_id=q.quota_entry_id
              )
            RETURNING compensates_entry_id`,
          [
            this.options.accountId,
            this.options.userId,
            record.runId,
            compensationId,
          ],
        );
        const chargeId = compensated.rows[0]?.compensates_entry_id;
        if (compensated.rowCount !== 1 || !chargeId)
          throw new Error(
            "Terminal live research failure quota compensation was not applied.",
          );
        await appendAuditEvent(client, {
          accountId: this.options.accountId,
          actorUserId: this.options.userId,
          eventType: "quota.compensated",
          resourceKind: "research_run",
          resourceId: record.runId,
          outcome: "allow",
          correlationId: record.executionId,
          deploymentId: this.options.deploymentId ?? "live-research-worker",
          detail: {
            chargeId,
            compensationId,
            reasonCode: "live_research_terminal_failure",
            terminalDisposition: record.disposition,
            terminalReasonCode: record.reasonCode,
          },
        });
      }
      const released = await client.query(
        `UPDATE execution_lease
            SET released_at=coalesce(released_at,clock_timestamp()),
                release_reason=coalesce(release_reason,'live_research_terminal')
          WHERE slot_no=$1 AND run_id=$2 AND account_id=$3
            AND generation=$4 AND owner_token_hash=$5
          RETURNING slot_no`,
        [
          Number(row.execution_lease_slot),
          record.runId,
          this.options.accountId,
          Number(row.execution_lease_generation),
          tokenHash,
        ],
      );
      if (released.rowCount !== 1)
        throw new Error("Live research global slot release was fenced.");
      await this.recordReservationEvent(
        client,
        record.executionId,
        record.runId,
        "terminal_committed",
        tokenHash,
        generation,
      );
      return persistedRecord;
    });
  }

  private async persistProviderAttempt(
    client: Queryable,
    runId: string,
    snapshot: LiveResearchRouteRecord["snapshot"],
    attempt: ProviderAttemptOutcome,
  ): Promise<string> {
    const route = await client.query<{ provider_route_id: string }>(
      `SELECT r.provider_route_id FROM provider_route r
         JOIN provider_route_capability c
           ON c.provider_route_id=r.provider_route_id AND c.capability=$6
        WHERE r.route_id=$1 AND r.provider=$2 AND r.model_id=$3 AND r.environment=$4
          AND r.route_kind=$5 AND r.enabled
        ORDER BY r.created_at DESC LIMIT 1`,
      [
        attempt.routeId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        attempt.routeKind,
        attempt.capabilityId,
      ],
    );
    if (!route.rows[0])
      throw new Error("Exact enabled provider route is unavailable.");
    const capabilityAttemptId = randomUUID();
    const providerAttemptId = randomUUID();
    await client.query(
      `INSERT INTO capability_attempt
         (capability_attempt_id,run_id,account_id,user_id,capability,provider,
          model_id,environment,provider_route_id,outcome,started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        capabilityAttemptId,
        runId,
        this.options.accountId,
        this.options.userId,
        attempt.capabilityId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        route.rows[0].provider_route_id,
        attempt.outcome,
        attempt.startedAt,
        attempt.completedAt,
      ],
    );
    await client.query(
      `INSERT INTO provider_call
         (provider_call_id,capability_attempt_id,run_id,account_id,user_id,capability,
          provider,model_id,environment,route_id,request_parameters,
          request_identifier_hash,called_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb,$11,$12)`,
      [
        randomUUID(),
        capabilityAttemptId,
        runId,
        this.options.accountId,
        this.options.userId,
        attempt.capabilityId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        attempt.routeId,
        sha(`${runId}:${attempt.routeId}:${attempt.attemptNumber}`),
        attempt.startedAt,
      ],
    );
    await client.query(
      `INSERT INTO provider_attempt
         (provider_attempt_id,account_id,run_id,research_route_snapshot_id,
          capability_attempt_id,attempt_number,outcome,requested_provider,
          requested_model,served_provider,served_model,started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        providerAttemptId,
        this.options.accountId,
        runId,
        snapshot.snapshotId,
        capabilityAttemptId,
        attempt.attemptNumber,
        attempt.outcome,
        snapshot.providerId,
        snapshot.requestedModelId,
        attempt.servedProviderId ?? null,
        attempt.servedModelId ?? null,
        attempt.startedAt,
        attempt.completedAt,
      ],
    );
    const unknown = attempt.costState === "unknown";
    const notIncurred = attempt.costState === "not_incurred";
    await client.query(
      `INSERT INTO cost_event
           (cost_event_id,capability_attempt_id,run_id,account_id,user_id,capability,
            provider,model_id,environment,quantity,unit,amount,currency_code,
            pricing_basis,pricing_version,pricing_state,measurement_kind,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        randomUUID(),
        capabilityAttemptId,
        runId,
        this.options.accountId,
        this.options.userId,
        attempt.capabilityId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        unknown || notIncurred ? 0 : attempt.costQuantity,
        unknown || notIncurred ? "request" : attempt.costUnit,
        unknown ? null : notIncurred ? 0 : attempt.costAmount,
        unknown ? null : notIncurred ? "USD" : attempt.costCurrency,
        unknown
          ? "provider_accounting_missing"
          : notIncurred
            ? "free_contract"
            : "provider_reported",
        unknown
          ? "unknown.v1"
          : notIncurred
            ? "not-incurred.v1"
            : attempt.pricingVersion,
        unknown ? "unknown" : notIncurred ? "explicit_zero" : "priced",
        unknown
          ? "estimated"
          : notIncurred
            ? "measured"
            : attempt.costMeasurement,
        attempt.completedAt,
      ],
    );
    await this.persistRouteHealthObservation(
      client,
      attempt,
      providerAttemptId,
    );
    return providerAttemptId;
  }

  private async persistRouteHealthObservation(
    client: Queryable,
    attempt: ProviderAttemptOutcome,
    providerAttemptId: string,
  ): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${attempt.environment}:${attempt.routeId}`,
    ]);
    const previous = await client.query<{
      consecutive_failures: number;
      circuit_disposition: "closed" | "open" | "half_open";
    }>(
      `SELECT consecutive_failures,circuit_disposition
         FROM research_route_health_observation
        WHERE route_id=$1 AND environment=$2
        ORDER BY observed_at DESC,research_route_health_observation_id DESC
        LIMIT 1`,
      [attempt.routeId, attempt.environment],
    );
    const priorFailures = Number(previous.rows[0]?.consecutive_failures ?? 0);
    const success = attempt.outcome === "ok";
    const cancelled = attempt.outcome === "cancelled";
    const consecutiveFailures = success
      ? 0
      : cancelled
        ? priorFailures
        : priorFailures + 1;
    const observation = success
      ? "success"
      : cancelled
        ? "cancelled"
        : attempt.outcome === "timeout"
          ? "timeout"
          : "transient_failure";
    const circuitDisposition = success
      ? "closed"
      : cancelled
        ? (previous.rows[0]?.circuit_disposition ?? "closed") === "half_open"
          ? "open"
          : (previous.rows[0]?.circuit_disposition ?? "closed")
        : consecutiveFailures >= 3 ||
            previous.rows[0]?.circuit_disposition === "half_open"
          ? "open"
          : "closed";
    await client.query(
      `INSERT INTO research_route_health_observation
         (research_route_health_observation_id,route_id,environment,observation,
          consecutive_failures,circuit_disposition,source_attempt_id,observed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
      [
        randomUUID(),
        attempt.routeId,
        attempt.environment,
        observation,
        consecutiveFailures,
        circuitDisposition,
        providerAttemptId,
      ],
    );
  }

  private async persistSearchAttempt(
    client: Queryable,
    runId: string,
    providerAttemptId: string,
    canonicalEnglishRequest: string,
    routeRecord: LiveResearchRouteRecord,
    resultCount: number,
  ): Promise<string> {
    if (
      routeRecord.attempts.length === 0 ||
      routeRecord.attempts.some(
        (attempt) => attempt.capabilityId !== "CAP-SEARCH",
      ) ||
      !Number.isSafeInteger(resultCount) ||
      resultCount < 0 ||
      resultCount > 10
    )
      throw new Error("Source-discovery search lineage is invalid.");
    const successful =
      routeRecord.failureCode === null &&
      routeRecord.snapshot.terminalDisposition === "ok" &&
      routeRecord.attempts.every(
        (attempt) =>
          attempt.outcome === "ok" && attempt.costState !== "unknown",
      );
    if (successful !== resultCount > 0)
      throw new Error("Source-discovery outcome contradicts its result count.");
    const lastAttempt = routeRecord.attempts.at(-1)!;
    const hasUnknown = routeRecord.attempts.some(
      (attempt) => attempt.costState === "unknown",
    );
    const allNotIncurred = routeRecord.attempts.every(
      (attempt) => attempt.costState === "not_incurred",
    );
    const outcome = successful
      ? "ok"
      : hasUnknown
        ? "blocked"
        : lastAttempt.outcome === "cancelled"
          ? "cancelled"
          : lastAttempt.outcome === "timeout"
            ? "timeout"
            : "provider_error";
    const costState = hasUnknown
      ? "unknown"
      : allNotIncurred
        ? "not_incurred"
        : routeRecord.attempts.some(
              (attempt) => attempt.costState === "estimated",
            )
          ? "estimated"
          : "priced";
    const searchAttemptId = randomUUID();
    await client.query(
      `INSERT INTO search_attempt
         (search_attempt_id,account_id,run_id,provider_attempt_id,
          query_digest_hmac_sha256,search_capability,outcome,result_count,
          cost_state,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'provider_native_source_discovery',$6,$7,$8,$9,$10)`,
      [
        searchAttemptId,
        this.options.accountId,
        runId,
        providerAttemptId,
        sha(canonicalEnglishRequest),
        outcome,
        resultCount,
        costState,
        routeRecord.attempts[0]!.startedAt,
        lastAttempt.completedAt,
      ],
    );
    return searchAttemptId;
  }

  async persistSourceDiscovery(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    canonicalEnglishRequest: string,
    routeRecord: LiveResearchRouteRecord,
    resultCount: number,
    sourceUrls: readonly string[],
  ): Promise<string> {
    if (
      routeRecord.failureCode !== null ||
      routeRecord.snapshot.runId !== runId ||
      routeRecord.snapshot.terminalDisposition !== "ok" ||
      routeRecord.attempts.length === 0 ||
      routeRecord.attempts.some(
        (attempt) =>
          attempt.outcome !== "ok" || attempt.costState === "unknown",
      )
    )
      throw new Error(
        "Source discovery did not close its route and cost ledger.",
      );
    return await inTransaction(this.options.pool, async (client) => {
      await this.lockOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
        client,
      );
      const snapshot = routeRecord.snapshot;
      await client.query(
        `INSERT INTO research_route_snapshot
           (research_route_snapshot_id,account_id,run_id,research_route_policy_id,
            snapshot_version,adapter_version,route_id,route_path,requested_provider,
            requested_model,expected_served_provider,expected_served_model,
            served_provider,served_model,terminal_disposition,capability_policy_version,
            parameter_policy_sha256,data_handling_evidence_version,fallback_position,
            qualification_state,captured_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                $17,$18,$19,'qualified',$20)`,
        [
          snapshot.snapshotId,
          this.options.accountId,
          runId,
          this.options.policyId,
          snapshot.schemaVersion,
          snapshot.adapterVersion,
          snapshot.routeId,
          snapshot.path,
          snapshot.providerId,
          snapshot.requestedModelId,
          snapshot.expectedServedProviderId,
          snapshot.expectedServedModelId,
          snapshot.servedProviderId,
          snapshot.servedModelId,
          snapshot.terminalDisposition,
          snapshot.capabilityPolicyVersion,
          sha(json(snapshot.parameterPolicy)),
          snapshot.dataHandlingEvidenceVersion,
          snapshot.fallbackPosition,
          snapshot.capturedAt,
        ],
      );
      let providerAttemptId = "";
      for (const attempt of routeRecord.attempts) {
        providerAttemptId = await this.persistProviderAttempt(
          client,
          runId,
          snapshot,
          attempt,
        );
      }
      const searchAttemptId = await this.persistSearchAttempt(
        client,
        runId,
        providerAttemptId,
        canonicalEnglishRequest,
        routeRecord,
        resultCount,
      );
      const checkpoint = json({
        route: routeRecord,
        sourceUrls: canonicalSourceUrls(sourceUrls),
      });
      const updated = await client.query(
        `UPDATE live_research_execution_reservation
            SET checkpoint_stage='source_discovered',
                source_discovery_record=$6::jsonb,search_attempt_id=$7,updated_at=$8
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3
            AND generation=$4 AND ownership_token_sha256=$5
            AND state='in_progress' AND checkpoint_stage='reserved'`,
        [
          executionId,
          this.options.accountId,
          runId,
          generation,
          sha(ownershipToken),
          checkpoint,
          searchAttemptId,
          this.now(),
        ],
      );
      if (updated.rowCount !== 1)
        throw new Error("Source-discovery checkpoint ownership was fenced.");
      await this.assertOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
        client,
      );
      return searchAttemptId;
    });
  }

  async loadSourceDiscoveryCheckpoint(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
  ): Promise<SourceDiscoveryCheckpoint | null> {
    await this.assertOwnership(ownershipToken, generation, executionId, runId);
    const result = await this.options.pool.query<{
      checkpoint_stage: string;
      source_discovery_record: unknown | null;
      search_attempt_id: string | null;
      pipeline_identity_record: unknown | null;
    }>(
      `SELECT checkpoint_stage,source_discovery_record,search_attempt_id,
              pipeline_identity_record
         FROM live_research_execution_reservation
        WHERE execution_id=$1 AND account_id=$2 AND run_id=$3
          AND generation=$4 AND ownership_token_sha256=$5 AND state='in_progress'`,
      [
        executionId,
        this.options.accountId,
        runId,
        generation,
        sha(ownershipToken),
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error("Source-discovery checkpoint ownership was fenced.");
    assertLiveResearchPipelineIdentityUnchanged(
      row.pipeline_identity_record,
      this.options.pipelineIdentity,
    );
    if (row.checkpoint_stage === "reserved") return null;
    if (
      row.checkpoint_stage !== "source_discovered" ||
      !row.source_discovery_record ||
      !row.search_attempt_id
    )
      throw new Error("Source-discovery checkpoint state is invalid.");
    return validateSourceDiscoveryCheckpoint(
      row.source_discovery_record,
      runId,
      row.search_attempt_id,
    );
  }

  private async persistEvidenceGraph(
    client: Queryable,
    runId: string,
    graph: EvidenceGraphV1,
  ): Promise<EvidenceGraphV1> {
    validateEvidenceGraph(graph);
    if (graph.runId !== runId)
      throw new Error("Live evidence graph belongs to another run.");
    let persistedSmeWeightValidation: SmeWeightValidationV2 | undefined;
    if (this.options.executionEnvironment === "production") {
      const scoring = await client.query<{
        weights_bp: unknown;
        sme_approval_ref: string | null;
        released_at: Date;
        content_sha256: Buffer;
      }>(
        `SELECT weights_bp,sme_approval_ref,released_at,content_sha256
           FROM scoring_config_version
           WHERE scoring_config_version_id=$1`,
        [this.options.pipelineIdentity.scoringConfigVersionId],
      );
      const row = scoring.rows[0];
      if (
        !row ||
        row.content_sha256.toString("hex") !==
          this.options.pipelineIdentity.scoringConfigContentSha256
      )
        throw new Error(
          "Production scoring authority does not match the pinned pipeline identity.",
        );
      persistedSmeWeightValidation = authoritativeSmeWeightValidation({
        environment: "production",
        weightsBp: row.weights_bp,
        smeApprovalRef: row.sme_approval_ref,
        releasedAt: row.released_at,
      });
    }
    const sources = await client.query<{
      evidence_item_id: string;
      canonical_url: string;
      normalized_domain: string;
      retrieved_at: Date;
      content_sha256: Buffer;
      bounded_extract: string;
    }>(
      `SELECT p.evidence_item_id,s.canonical_url,s.normalized_domain,s.retrieved_at,
              s.content_sha256,s.bounded_extract
         FROM live_source_provenance p
         JOIN source_document s
           ON s.account_id=p.account_id AND s.run_id=p.run_id
          AND s.source_document_id=p.source_document_id
        WHERE p.account_id=$1 AND p.run_id=$2 AND p.source_disposition='accepted'`,
      [this.options.accountId, runId],
    );
    const sourceBindings = sources.rows.map((source) => ({
      evidenceId: source.evidence_item_id,
      canonicalUrl: source.canonical_url,
      publisherDomain: source.normalized_domain,
      retrievedAt: source.retrieved_at.toISOString(),
      contentSha256: source.content_sha256.toString("hex"),
      boundedExcerpt: source.bounded_extract,
    }));
    assertLiveEvidenceSourceBindings(graph.evidence, sourceBindings);
    const identityResolutions = resolveCandidateIdentities({
      accountId: this.options.accountId,
      runId,
      candidates: graph.candidates,
    });
    if (
      identityResolutions.some(
        (resolution) => resolution.reasonCode === "canonical_hash_collision",
      )
    ) {
      throw new Error("Candidate identity hash collision was rejected.");
    }
    const identityByCandidate = new Map(
      identityResolutions.map((resolution) => [
        resolution.candidateId,
        resolution,
      ]),
    );
    const eligible = new Set(
      graph.eligibleCandidateIds.filter(
        (candidateId) =>
          identityByCandidate.get(candidateId)?.disposition === "distinct",
      ),
    );
    const persistedGraph: EvidenceGraphV1 = {
      ...graph,
      eligibleCandidateIds: graph.eligibleCandidateIds.filter((candidateId) =>
        eligible.has(candidateId),
      ),
    };
    const completeResult = buildOperationalLiveCompleteResultV2({
      graph,
      eligibleCandidateIds: persistedGraph.eligibleCandidateIds,
      sourceBindings,
      qualificationMode:
        this.options.executionEnvironment === "production"
          ? "production"
          : "synthetic_qualification",
      ...(persistedSmeWeightValidation === undefined
        ? {}
        : { smeWeightValidation: persistedSmeWeightValidation }),
      ...(this.options.authoritativeRegistryDomains === undefined
        ? {}
        : {
            authoritativeRegistryDomains:
              this.options.authoritativeRegistryDomains,
          }),
    }).foundation;
    const values: EvidenceLineageLedgerV1["values"] = graph.claims.flatMap(
      (claim) =>
        claim.evidenceIds.map((evidenceId) => ({
          valueId: randomUUID(),
          accountId: this.options.accountId,
          runId,
          candidateId: claim.candidateId,
          claimId: claim.claimId,
          evidenceId,
          fieldId: "claim_assertion",
          valueSha256: sha(claim.text).toString("hex"),
        })),
    );
    const candidateById = new Map(
      graph.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    const drivers: EvidenceLineageLedgerV1["drivers"] = values.flatMap(
      (value) => {
        const candidate = candidateById.get(value.candidateId);
        if (!candidate)
          throw new Error("Evidence value candidate lineage is unavailable.");
        const dimensions = Object.keys(candidate.dimensionScores).sort();
        return (
          dimensions.length > 0 ? dimensions : ["overall_compatibility"]
        ).map((dimensionId) => ({
          driverId: randomUUID(),
          accountId: this.options.accountId,
          runId,
          candidateId: value.candidateId,
          claimId: value.claimId,
          valueId: value.valueId,
          evidenceId: value.evidenceId,
          dimensionId,
          direction: "supports" as const,
        }));
      },
    );
    const lineageLedger: EvidenceLineageLedgerV1 = {
      schemaVersion: "evidence-lineage-ledger.v1",
      accountId: this.options.accountId,
      runId,
      values,
      drivers,
      identityResolutions,
    };
    validateEvidenceLineageLedger(persistedGraph, lineageLedger);
    for (const [index, candidate] of graph.candidates.entries()) {
      await client.query(
        `INSERT INTO candidate
           (candidate_id,run_id,account_id,canonical_name,country_code,
            deterministic_rank,eligible)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          candidate.candidateId,
          runId,
          this.options.accountId,
          candidate.displayName,
          candidate.countryCode,
          index + 1,
          eligible.has(candidate.candidateId),
        ],
      );
    }
    for (const candidate of graph.candidates) {
      const identity = identityByCandidate.get(candidate.candidateId);
      if (!identity)
        throw new Error("Candidate identity resolution is unavailable.");
      await client.query(
        `INSERT INTO candidate_identity_resolution
           (candidate_identity_resolution_id,account_id,run_id,candidate_id,
             canonical_identity,canonical_identity_sha256,duplicate_of_candidate_id,disposition,
             resolver_version,reason_code,resolved_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`,
        [
          randomUUID(),
          this.options.accountId,
          runId,
          candidate.candidateId,
          canonicalizeCandidateIdentity(candidate),
          Buffer.from(identity.canonicalIdentitySha256, "hex"),
          identity.mergedIntoCandidateId,
          identity.disposition,
          identity.resolverVersion,
          identity.reasonCode,
        ],
      );
    }
    for (const claim of graph.claims) {
      await client.query(
        `INSERT INTO claim
           (claim_id,run_id,account_id,candidate_id,assertion_text,
            decision_bearing,verification_status)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          claim.claimId,
          runId,
          this.options.accountId,
          claim.candidateId,
          claim.text,
          claim.decisionBearing,
          claim.verificationStatus,
        ],
      );
      for (const evidenceId of claim.evidenceIds) {
        await client.query(
          `INSERT INTO claim_evidence
             (claim_id,evidence_item_id,account_id,relation,support_locator)
           VALUES($1,$2,$3,'supports',$4::jsonb)`,
          [
            claim.claimId,
            evidenceId,
            this.options.accountId,
            json({ extraction_version: LIVE_RESEARCH_EXTRACTION_VERSION }),
          ],
        );
      }
    }
    for (const value of lineageLedger.values) {
      await client.query(
        `INSERT INTO evidence_value
           (evidence_value_id,account_id,run_id,candidate_id,claim_id,
            evidence_item_id,field_id,value_sha256,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())`,
        [
          value.valueId,
          value.accountId,
          value.runId,
          value.candidateId,
          value.claimId,
          value.evidenceId,
          value.fieldId,
          Buffer.from(value.valueSha256, "hex"),
        ],
      );
    }
    for (const driver of lineageLedger.drivers) {
      await client.query(
        `INSERT INTO evidence_driver
           (evidence_driver_id,account_id,run_id,candidate_id,claim_id,
            evidence_value_id,evidence_item_id,dimension_id,direction,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
        [
          driver.driverId,
          driver.accountId,
          driver.runId,
          driver.candidateId,
          driver.claimId,
          driver.valueId,
          driver.evidenceId,
          driver.dimensionId,
          driver.direction,
        ],
      );
    }
    const serialized = json(completeResult);
    const outcome = eligible.size > 0 ? "candidates" : "no_responsible_match";
    await client.query(
      `INSERT INTO run_result
         (run_id,account_id,outcome,eligible_count,considered_count,scarcity,
          limitations_text,complete_result_document,result_sha256,assembled_at)
       VALUES($1,$2,$3,$4,$5,NULL,$6,$7::jsonb,$8,clock_timestamp())`,
      [
        runId,
        this.options.accountId,
        outcome,
        eligible.size,
        persistedGraph.candidates.length,
        "Unsupported claims are withheld; live evidence remains source-bound.",
        serialized,
        standardCompleteResultDocumentSha256(completeResult),
      ],
    );
    await bindConsultantProjectionPolicyAtResultProduction(client, {
      accountId: this.options.accountId,
      runId,
      release:
        this.options.consultantProjectionConfig ??
        DEFAULT_CONSULTANT_PROJECTION_CONFIG,
    });
    for (const [index, candidate] of graph.candidates.entries()) {
      await client.query(
        `INSERT INTO result_candidate
           (run_id,candidate_id,account_id,rank,eligible,rationale_short,
            exclusion_reason_code)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          runId,
          candidate.candidateId,
          this.options.accountId,
          index + 1,
          eligible.has(candidate.candidateId),
          candidate.rationaleShort,
          eligible.has(candidate.candidateId)
            ? null
            : identityByCandidate.get(candidate.candidateId)?.disposition ===
                "duplicate"
              ? "duplicate_identity"
              : identityByCandidate.get(candidate.candidateId)?.disposition ===
                  "rejected_ambiguous"
                ? "ambiguous_identity"
                : "not_eligible",
        ],
      );
    }
    return persistedGraph;
  }
}

export class LiveResearchExecutionService {
  constructor(
    private readonly options: {
      pool: ConnectionPool;
      accountId: string;
      userId: string;
      policyId: string;
      resolver: DnsResolver;
      accessEvaluator: SourceAccessEvaluator;
      fetchTransport: PinnedFetchTransport;
      sourceDiscovery: ServerOwnedSourceDiscovery;
      providerTransports: Readonly<{
        gemini_direct: ProviderTransport;
        openrouter: ProviderTransport;
      }>;
      circuit: LiveResearchCircuitPolicy;
      validateOutput: (body: unknown) => EvidenceGraphV1;
      authoritativeRegistryDomains?: readonly string[];
      consultantProjectionConfig?: ConsultantProjectionConfigRelease;
      backoff?: Backoff;
      phaseObserver?: (
        phase:
          "source_discovered" | "fetch_persistence_locked" | "source_persisted",
        detail?: string,
      ) => void | Promise<void>;
      ledgerTiming?: Readonly<{
        leaseMs: number;
        heartbeatMs: number;
        pollMs?: number;
        waitMs?: number;
        now?: () => Date;
      }>;
      deploymentId?: string;
    },
  ) {}

  async execute(input: {
    policy: ResearchRoutePolicyV1;
    executionId: string;
    runId: string;
    capturedAt: string;
    outputSchema: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<LiveResearchTerminalRecord<EvidenceGraphV1>> {
    assertApprovedLiveResearchOutputSchema(input.outputSchema);
    const validatedPolicy = validateResearchRoutePolicy(input.policy);
    const routePolicyCanonicalSha256 =
      canonicalResearchRoutePolicySha256(validatedPolicy);
    const admission = await this.options.pool.query<{
      canonical_document: unknown;
      research_route_policy_id: string;
      route_policy_version: string;
      route_policy_content_sha256: Buffer | null;
      model_policy_version_id: string;
      model_policy_version: number | string;
      model_policy_content_sha256: Buffer;
      scoring_config_version_id: string;
      scoring_config_version: number | string;
      scoring_config_content_sha256: Buffer;
      scoring_weights_bp: unknown;
      scoring_sme_approval_ref: string | null;
      scoring_released_at: Date;
    }>(
      `SELECT v.canonical_document,
              rp.research_route_policy_id,rp.policy_version route_policy_version,
              rp.content_sha256 route_policy_content_sha256,
              mp.model_policy_version_id,mp.version model_policy_version,
              mp.content_sha256 model_policy_content_sha256,
              sc.scoring_config_version_id,sc.version scoring_config_version,
              sc.content_sha256 scoring_config_content_sha256,
              sc.weights_bp scoring_weights_bp,
              sc.sme_approval_ref scoring_sme_approval_ref,
              sc.released_at scoring_released_at
         FROM research_run r
         JOIN canonical_request_version v
           ON v.account_id=r.account_id
          AND v.canonical_request_version_id=r.canonical_request_version_id
         JOIN model_policy_version mp
           ON mp.model_policy_version_id=r.model_policy_version_id
         JOIN scoring_config_version sc
           ON sc.scoring_config_version_id=r.scoring_config_version_id
         JOIN research_route_policy rp
           ON rp.research_route_policy_id=$3 AND rp.policy_version=$4
          AND rp.activation_state='qualified'
        WHERE r.account_id=$1 AND r.run_id=$2 AND v.match_readiness <> 'not_ready'
           AND EXISTS (SELECT 1 FROM canonical_confirmation c
                        WHERE c.canonical_request_version_id=v.canonical_request_version_id
                          AND c.accepted)`,
      [
        this.options.accountId,
        input.runId,
        this.options.policyId,
        validatedPolicy.policyVersion,
      ],
    );
    const admitted = admission.rows[0];
    if (
      !admitted ||
      !admitted.research_route_policy_id ||
      !admitted.route_policy_version ||
      !admitted.route_policy_content_sha256 ||
      !admitted.model_policy_version_id ||
      !admitted.model_policy_version ||
      !admitted.model_policy_content_sha256 ||
      !admitted.scoring_config_version_id ||
      !admitted.scoring_config_version ||
      !admitted.scoring_config_content_sha256
    )
      throw new Error(
        "Confirmed version-pinned live research admission is unavailable.",
      );
    const canonicalEnglishRequest = liveProviderRequestFromCanonicalDocument(
      admitted.canonical_document,
    );
    const pipelineIdentity = createLiveResearchPipelineIdentity({
      outputSchema: input.outputSchema,
      researchRoutePolicyId: admitted.research_route_policy_id,
      routePolicyVersion: admitted.route_policy_version,
      routePolicyCanonicalSha256,
      modelPolicyVersionId: admitted.model_policy_version_id,
      modelPolicyVersion: String(admitted.model_policy_version),
      modelPolicyContentSha256:
        admitted.model_policy_content_sha256.toString("hex"),
      scoringConfigVersionId: admitted.scoring_config_version_id,
      scoringConfigVersion: String(admitted.scoring_config_version),
      scoringConfigContentSha256:
        admitted.scoring_config_content_sha256.toString("hex"),
    });
    if (
      admitted.route_policy_content_sha256.toString("hex") !==
      pipelineIdentity.routePolicyCanonicalSha256
    )
      throw new Error("Qualified route-policy content digest does not match.");
    const smeWeightValidation = authoritativeSmeWeightValidation({
      environment: validatedPolicy.environment,
      weightsBp: admitted.scoring_weights_bp,
      smeApprovalRef: admitted.scoring_sme_approval_ref,
      releasedAt: admitted.scoring_released_at,
    });
    const ledger = new PostgresLiveResearchAtomicLedger({
      pool: this.options.pool,
      accountId: this.options.accountId,
      userId: this.options.userId,
      policyId: this.options.policyId,
      pipelineIdentity,
      executionEnvironment: validatedPolicy.environment,
      ...(this.options.deploymentId === undefined
        ? {}
        : { deploymentId: this.options.deploymentId }),
      consultantProjectionConfig:
        this.options.consultantProjectionConfig ??
        DEFAULT_CONSULTANT_PROJECTION_CONFIG,
      ...(this.options.authoritativeRegistryDomains === undefined
        ? {}
        : {
            authoritativeRegistryDomains:
              this.options.authoritativeRegistryDomains,
          }),
      ...this.options.ledgerTiming,
    });
    const reservation = await ledger.reserveExecution(
      input.executionId,
      input.runId,
    );
    if (reservation.state === "unavailable")
      throw new LiveResearchCapacityUnavailable(
        "Global live research execution capacity is unavailable.",
      );
    if (reservation.state === "existing") return await reservation.terminal;
    const ownershipToken = reservation.ownershipToken;
    const generation = reservation.generation;
    const operationController = new AbortController();
    const abortOperation = () => operationController.abort(input.signal.reason);
    if (input.signal.aborted) abortOperation();
    else input.signal.addEventListener("abort", abortOperation, { once: true });
    const heartbeat = ledger.startHeartbeat(
      ownershipToken,
      generation,
      input.executionId,
      input.runId,
      (error) => operationController.abort(error),
    );
    try {
      await heartbeat.assertOwned();
      const existingDiscovery = await ledger.loadSourceDiscoveryCheckpoint(
        ownershipToken,
        generation,
        input.executionId,
        input.runId,
      );
      let sourceUrls: readonly string[];
      let searchAttemptId: string;
      if (existingDiscovery) {
        sourceUrls = existingDiscovery.sourceUrls;
        searchAttemptId = existingDiscovery.searchAttemptId;
      } else {
        const sourceRouteDefinition = validatedPolicy.routes
          .filter((route) => route.enabled && route.path === "gemini_direct")
          .sort(
            (left, right) => left.fallbackPosition - right.fallbackPosition,
          )[0];
        if (!sourceRouteDefinition)
          throw new Error(
            "Qualified direct source-discovery route is unavailable.",
          );
        const sourceRoute = resolveActiveResearchRoute(
          validatedPolicy,
          sourceRouteDefinition.routeId,
          input.capturedAt,
        );
        const sourceCircuitAdmission =
          await this.options.circuit.isRouteAvailable(
            sourceRoute.routeId,
            input.capturedAt,
          );
        if (!sourceCircuitAdmission) {
          const circuitOpenRoute: LiveResearchRouteRecord = {
            snapshot: createResearchRouteSnapshot({
              policy: validatedPolicy,
              route: sourceRoute,
              snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${sourceRoute.routeId}`,
              runId: input.runId,
              servedProviderId: null,
              servedModelId: null,
              terminalDisposition: "failed",
              capturedAt: input.capturedAt,
            }),
            attempts: [],
            failureCode: "source_discovery_circuit_open",
          };
          await ledger.commitTerminal(ownershipToken, generation, {
            schemaVersion: "live-research-terminal.v1",
            executionId: input.executionId,
            runId: input.runId,
            disposition: "failed_retryable",
            reasonCode: "source_discovery_circuit_open",
            routes: [circuitOpenRoute],
            result: null,
            completedAt: new Date().toISOString(),
          });
          throw new Error("Source-discovery circuit is open.");
        }
        const sourceCircuitProbe =
          typeof sourceCircuitAdmission === "object"
            ? sourceCircuitAdmission
            : undefined;
        const sourceSignal = sourceCircuitProbe
          ? AbortSignal.any([
              operationController.signal,
              sourceCircuitProbe.signal,
            ])
          : operationController.signal;
        let discovery: Awaited<
          ReturnType<ServerOwnedSourceDiscovery["discover"]>
        >;
        try {
          await sourceCircuitProbe?.assertOwnership();
          discovery = await ledger.withPipelineIdentityAdmission(
            ownershipToken,
            generation,
            input.executionId,
            input.runId,
            async () =>
              await this.options.sourceDiscovery.discover({
                policy: validatedPolicy,
                executionId: input.executionId,
                runId: input.runId,
                capturedAt: input.capturedAt,
                canonicalEnglishRequest,
                signal: sourceSignal,
                assertOwnership: heartbeat.assertOwned,
              }),
          );
          await sourceCircuitProbe?.assertOwnership();
        } catch (error) {
          if (isTransientDatabaseConnectionFailure(error))
            throw new LiveResearchProcessInterrupted(
              "Transient database connectivity interrupted source discovery.",
              { cause: error },
            );
          const failedRoute =
            error instanceof SourceDiscoveryFailure ? [error.route] : [];
          await ledger.commitTerminal(
            ownershipToken,
            generation,
            {
              schemaVersion: "live-research-terminal.v1",
              executionId: input.executionId,
              runId: input.runId,
              disposition: operationController.signal.aborted
                ? "cancelled"
                : "failed_retryable",
              reasonCode: operationController.signal.aborted
                ? "cancelled"
                : "source_discovery_failed",
              routes: failedRoute,
              result: null,
              completedAt: new Date().toISOString(),
            },
            failedRoute.length === 0
              ? undefined
              : { canonicalEnglishRequest, resultCount: 0 },
          );
          throw error;
        } finally {
          sourceCircuitProbe?.close();
        }
        try {
          sourceUrls = canonicalSourceUrls(discovery.sourceUrls);
        } catch (error) {
          const failedRoute: LiveResearchRouteRecord = {
            snapshot: {
              ...discovery.route.snapshot,
              servedProviderId: null,
              servedModelId: null,
              terminalDisposition: "failed",
            },
            attempts: discovery.route.attempts,
            failureCode: "source_discovery_invalid",
          };
          await ledger.commitTerminal(
            ownershipToken,
            generation,
            {
              schemaVersion: "live-research-terminal.v1",
              executionId: input.executionId,
              runId: input.runId,
              disposition: "failed_retryable",
              reasonCode: "source_discovery_invalid",
              routes: [failedRoute],
              result: null,
              completedAt: new Date().toISOString(),
            },
            { canonicalEnglishRequest, resultCount: 0 },
          );
          throw error;
        }
        await heartbeat.assertOwned();
        searchAttemptId = await ledger.persistSourceDiscovery(
          ownershipToken,
          generation,
          input.executionId,
          input.runId,
          canonicalEnglishRequest,
          discovery.route,
          sourceUrls.length,
          sourceUrls,
        );
        await this.options.phaseObserver?.("source_discovered");
      }
      const fetchInput = {
        runId: input.runId,
        searchAttemptId,
        capturedAt: input.capturedAt,
      };
      const sanitizedEvidence: SanitizedResearchEvidence[] = [];
      const sourceBindings: LiveSourceBindingRecord[] = [];
      try {
        let lastSecureFetchDenial: SecureFetchDenied | null = null;
        for (const url of sourceUrls) {
          await heartbeat.assertOwned();
          const checkpoint = await this.loadPersistedSource(
            input.runId,
            searchAttemptId,
            url,
            ledger,
            ownershipToken,
            generation,
            input.executionId,
          );
          if (checkpoint.disposition === "denied") continue;
          if (checkpoint.disposition === "accepted") {
            sanitizedEvidence.push(checkpoint.evidence);
            sourceBindings.push(checkpoint.binding);
            continue;
          }
          let fetched: SecureFetchResult;
          try {
            fetched = await ledger.withPipelineIdentityAdmission(
              ownershipToken,
              generation,
              input.executionId,
              input.runId,
              async () =>
                await secureFetch({
                  url,
                  resolver: this.options.resolver,
                  accessEvaluator: this.options.accessEvaluator,
                  redirectIntermediaryEvaluator:
                    isGeminiGroundingRedirectIntermediary,
                  transport: this.options.fetchTransport,
                  signal: operationController.signal,
                }),
            );
          } catch (error) {
            if (error instanceof SecureFetchDenied) {
              await this.persistFetchAttempts(
                { ...fetchInput, sourceRequestUrl: url },
                error.attempts,
                null,
                ledger,
                ownershipToken,
                generation,
                input.executionId,
              );
              lastSecureFetchDenial = error;
              continue;
            }
            throw error;
          }
          const persistedSource = await this.persistFetchAttempts(
            { ...fetchInput, sourceRequestUrl: url },
            fetched.attempts,
            fetched,
            ledger,
            ownershipToken,
            generation,
            input.executionId,
          );
          const sealed = sealUntrustedSource(fetched.body, fetched.contentType);
          const excerpt = sealed.normalizedText.slice(0, 600).trim();
          if (!excerpt)
            throw new Error("Fetched evidence produced no safe excerpt.");
          if (!persistedSource.binding)
            throw new Error("Persisted live source binding is unavailable.");
          sanitizedEvidence.push({
            sourceId: persistedSource.evidenceItemId,
            canonicalUrl: fetched.canonicalUrl,
            publisherDomain: persistedSource.binding.publisherDomain,
            retrievedAt: persistedSource.binding.retrievedAt,
            contentSha256: fetched.contentSha256.toLowerCase(),
            excerpt,
          });
          sourceBindings.push(persistedSource.binding);
          await this.options.phaseObserver?.("source_persisted", url);
        }
        if (sanitizedEvidence.length === 0)
          throw (
            lastSecureFetchDenial ??
            new Error("No discovered source passed secure fetch policy.")
          );
      } catch (error) {
        if (error instanceof LiveResearchProcessInterrupted) throw error;
        if (isTransientDatabaseConnectionFailure(error))
          throw new LiveResearchProcessInterrupted(
            "Transient database connectivity interrupted secure fetch persistence.",
            { cause: error },
          );
        await ledger.commitTerminal(ownershipToken, generation, {
          schemaVersion: "live-research-terminal.v1",
          executionId: input.executionId,
          runId: input.runId,
          disposition: operationController.signal.aborted
            ? "cancelled"
            : "failed",
          reasonCode: operationController.signal.aborted
            ? "cancelled"
            : "secure_fetch_failed",
          routes: [],
          result: null,
          completedAt: new Date().toISOString(),
        });
        throw error;
      }
      const fencedTransport = (
        transport: ProviderTransport,
      ): ProviderTransport => ({
        send: async (request) => {
          await heartbeat.assertOwned();
          return await ledger.withPipelineIdentityAdmission(
            ownershipToken,
            generation,
            input.executionId,
            input.runId,
            async () => await transport.send(request),
          );
        },
      });
      return await executeQualifiedResearch({
        policy: validatedPolicy,
        executionId: input.executionId,
        runId: input.runId,
        capturedAt: input.capturedAt,
        request: {
          canonicalLanguage: "en",
          canonicalEnglishRequest,
          sanitizedEvidence,
          outputSchema: input.outputSchema,
        },
        transports: {
          gemini_direct: fencedTransport(
            this.options.providerTransports.gemini_direct,
          ),
          openrouter: fencedTransport(
            this.options.providerTransports.openrouter,
          ),
        },
        ledger: {
          reserveExecution: async (executionId, runId) => {
            if (executionId !== input.executionId || runId !== input.runId)
              throw new Error("Pre-reserved execution identity changed.");
            await heartbeat.assertOwned();
            return { state: "acquired" as const, ownershipToken };
          },
          commitTerminal: async (token, record) =>
            await ledger.commitTerminal(token, generation, record),
        },
        circuit: {
          isRouteAvailable: async (routeId, _at) => {
            await heartbeat.assertOwned();
            // Route health is operational state, not an immutable fact of the
            // request capture time. Source discovery may close a half-open
            // circuit during this execution; reusing capturedAt here would
            // hide that success and incorrectly skip the direct generation
            // route in the same run.
            return await this.options.circuit.isRouteAvailable(
              routeId,
              new Date().toISOString(),
            );
          },
        },
        validateOutput: (body) => {
          const graph = bindServerOwnedLiveEvidenceGraph(
            normalizeLegacyProviderDimensionScores(
              this.options.validateOutput(body),
            ) as EvidenceGraphV1,
            sourceBindings,
            { runId: input.runId, capturedAt: input.capturedAt },
          );
          validateEvidenceGraph(graph);
          if (graph.runId !== input.runId)
            throw new Error("Live evidence graph belongs to another run.");
          assertLiveEvidenceSourceBindings(graph.evidence, sourceBindings);
          if (
            resolveCandidateIdentities({
              accountId: this.options.accountId,
              runId: input.runId,
              candidates: graph.candidates,
            }).some(
              (resolution) =>
                resolution.reasonCode === "canonical_hash_collision",
            )
          )
            throw new Error("Candidate identity hash collision was rejected.");
          buildOperationalLiveCompleteResultV2({
            graph,
            eligibleCandidateIds: graph.eligibleCandidateIds,
            sourceBindings,
            qualificationMode:
              validatedPolicy.environment === "production"
                ? "production"
                : "synthetic_qualification",
            ...(smeWeightValidation === undefined
              ? {}
              : { smeWeightValidation }),
            ...(this.options.authoritativeRegistryDomains === undefined
              ? {}
              : {
                  authoritativeRegistryDomains:
                    this.options.authoritativeRegistryDomains,
                }),
          });
          return graph;
        },
        signal: operationController.signal,
        ...(this.options.backoff ? { backoff: this.options.backoff } : {}),
      });
    } finally {
      input.signal.removeEventListener("abort", abortOperation);
      operationController.abort();
      await heartbeat.stop();
    }
  }

  private async persistFetchAttempts(
    input: {
      runId: string;
      searchAttemptId: string;
      sourceRequestUrl: string;
      capturedAt: string;
    },
    attempts: SecureFetchResult["attempts"],
    fetched: SecureFetchResult | null,
    ledger: PostgresLiveResearchAtomicLedger,
    ownershipToken: string,
    generation: number,
    executionId: string,
  ): Promise<{
    sourceDocumentId: string;
    evidenceItemId: string;
    binding: LiveSourceBindingRecord | null;
  }> {
    return await inTransaction(this.options.pool, async (client) => {
      await ledger.lockOwnership(
        ownershipToken,
        generation,
        executionId,
        input.runId,
        client,
      );
      await this.options.phaseObserver?.(
        "fetch_persistence_locked",
        input.sourceRequestUrl,
      );
      let acceptedFetchAttemptId: string | null = null;
      for (const [index, attempt] of attempts.entries()) {
        const fetchAttemptId = randomUUID();
        const finalAccepted =
          fetched !== null &&
          index === attempts.length - 1 &&
          attempt.decision === "accepted";
        await client.query(
          `INSERT INTO fetch_attempt
             (fetch_attempt_id,account_id,run_id,search_attempt_id,policy_version,
              source_request_url,canonical_url,publisher_domain,resolved_address_hashes,redirect_hop,
              decision,reason_code,http_status,content_type,compressed_bytes,
              decompressed_bytes,content_sha256,robots_disposition,started_at,completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
          [
            fetchAttemptId,
            this.options.accountId,
            input.runId,
            input.searchAttemptId,
            attempt.policyVersion,
            input.sourceRequestUrl,
            attempt.canonicalUrl,
            attempt.hostname,
            json(
              attempt.resolvedAddresses.map((address) =>
                sha(address).toString("hex"),
              ),
            ),
            attempt.redirectHop,
            attempt.decision,
            attempt.reason,
            attempt.status,
            finalAccepted ? fetched.contentType : null,
            attempt.compressedBytes,
            attempt.decompressedBytes,
            finalAccepted ? Buffer.from(fetched.contentSha256, "hex") : null,
            attempt.robotsDisposition,
            input.capturedAt,
          ],
        );
        if (finalAccepted) acceptedFetchAttemptId = fetchAttemptId;
      }
      if (!fetched) {
        await ledger.assertOwnership(
          ownershipToken,
          generation,
          executionId,
          input.runId,
          client,
        );
        return {
          sourceDocumentId: "",
          evidenceItemId: "",
          binding: null,
        };
      }
      if (!acceptedFetchAttemptId)
        throw new Error("Secure fetch omitted a final accepted attempt.");
      const sealed = sealUntrustedSource(fetched.body, fetched.contentType);
      const excerpt = sealed.normalizedText.slice(0, 600).trim();
      const sourceDocumentId = randomUUID();
      const evidenceItemId = randomUUID();
      await client.query(
        `INSERT INTO source_document
           (source_document_id,account_id,run_id,fetch_attempt_id,canonical_url,
            normalized_domain,content_type,content_sha256,bounded_extract,
            bounded_extract_sha256,extraction_version,active_content_removed,
            untrusted_data_only,retrieved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,true,$12)`,
        [
          sourceDocumentId,
          this.options.accountId,
          input.runId,
          acceptedFetchAttemptId,
          fetched.canonicalUrl,
          fetched.publisherDomain,
          fetched.contentType,
          Buffer.from(fetched.contentSha256, "hex"),
          excerpt,
          sha(excerpt),
          LIVE_RESEARCH_EXTRACTION_VERSION,
          input.capturedAt,
        ],
      );
      await client.query(
        `INSERT INTO evidence_item
           (evidence_item_id,run_id,account_id,source_kind,url,title,publisher_domain,
            retrieved_at,content_sha256,verification_disposition)
         VALUES ($1,$2,$3,'external_url',$4,$5,$6,$7,$8,'verified')`,
        [
          evidenceItemId,
          input.runId,
          this.options.accountId,
          fetched.canonicalUrl,
          fetched.publisherDomain,
          fetched.publisherDomain,
          input.capturedAt,
          Buffer.from(fetched.contentSha256, "hex"),
        ],
      );
      await client.query(
        `INSERT INTO live_source_provenance
           (live_source_provenance_id,account_id,run_id,evidence_item_id,
            fetch_attempt_id,source_document_id,canonical_url,normalized_domain,
            extraction_method,extraction_version,bounded_excerpt_sha256,
            source_disposition,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'deterministic_text_boundary',
                 $9,$10,'accepted',$11)`,
        [
          randomUUID(),
          this.options.accountId,
          input.runId,
          evidenceItemId,
          acceptedFetchAttemptId,
          sourceDocumentId,
          fetched.canonicalUrl,
          fetched.publisherDomain,
          LIVE_RESEARCH_EXTRACTION_VERSION,
          sha(excerpt),
          input.capturedAt,
        ],
      );
      await ledger.assertOwnership(
        ownershipToken,
        generation,
        executionId,
        input.runId,
        client,
      );
      return {
        sourceDocumentId,
        evidenceItemId,
        binding: Object.freeze({
          evidenceId: evidenceItemId,
          canonicalUrl: fetched.canonicalUrl,
          publisherDomain: fetched.publisherDomain,
          retrievedAt: input.capturedAt,
          contentSha256: fetched.contentSha256.toLowerCase(),
          boundedExcerpt: excerpt,
        }),
      };
    });
  }

  private async loadPersistedSource(
    runId: string,
    searchAttemptId: string,
    canonicalUrl: string,
    ledger: PostgresLiveResearchAtomicLedger,
    ownershipToken: string,
    generation: number,
    executionId: string,
  ): Promise<
    | { disposition: "none" }
    | { disposition: "denied" }
    | {
        disposition: "accepted";
        evidence: SanitizedResearchEvidence;
        binding: LiveSourceBindingRecord;
      }
  > {
    return await inTransaction(this.options.pool, async (client) => {
      await ledger.assertOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
        client,
      );
      const accepted = await client.query<{
        evidence_item_id: string;
        canonical_url: string;
        normalized_domain: string;
        retrieved_at: Date;
        content_sha256: Buffer;
        bounded_extract: string;
      }>(
        `SELECT p.evidence_item_id,s.canonical_url,s.normalized_domain,s.retrieved_at,
                s.content_sha256,s.bounded_extract
           FROM fetch_attempt f
           JOIN source_document s
             ON s.account_id=f.account_id AND s.run_id=f.run_id
            AND s.fetch_attempt_id=f.fetch_attempt_id
           JOIN live_source_provenance p
             ON p.account_id=s.account_id AND p.run_id=s.run_id
            AND p.source_document_id=s.source_document_id
          WHERE f.account_id=$1 AND f.run_id=$2 AND f.search_attempt_id=$3
            AND f.source_request_url=$4 AND f.decision='accepted'
            AND p.source_disposition='accepted'
          ORDER BY f.redirect_hop DESC LIMIT 1`,
        [this.options.accountId, runId, searchAttemptId, canonicalUrl],
      );
      const source = accepted.rows[0];
      if (source)
        return {
          disposition: "accepted" as const,
          evidence: Object.freeze({
            sourceId: source.evidence_item_id,
            canonicalUrl: source.canonical_url,
            publisherDomain: source.normalized_domain,
            retrievedAt: source.retrieved_at.toISOString(),
            contentSha256: source.content_sha256.toString("hex"),
            excerpt: source.bounded_extract,
          }),
          binding: Object.freeze({
            evidenceId: source.evidence_item_id,
            canonicalUrl: source.canonical_url,
            publisherDomain: source.normalized_domain,
            retrievedAt: source.retrieved_at.toISOString(),
            contentSha256: source.content_sha256.toString("hex"),
            boundedExcerpt: source.bounded_extract,
          }),
        };
      const denied = await client.query(
        `SELECT 1 FROM fetch_attempt
          WHERE account_id=$1 AND run_id=$2 AND search_attempt_id=$3
            AND source_request_url=$4 AND decision='denied' LIMIT 1`,
        [this.options.accountId, runId, searchAttemptId, canonicalUrl],
      );
      return denied.rowCount === 1
        ? { disposition: "denied" as const }
        : { disposition: "none" as const };
    });
  }
}
