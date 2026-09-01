import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  SYNTHETIC_DOMAIN_PACK,
  STANDARD_SYNTHETIC_WARNING,
  buildStandardSyntheticEvidenceGraph,
  normalizeStandardSyntheticScenarioForConstraints,
  canonicalizeStandardCondition,
  canonicalizeStandardConstraintComparand,
  canonicalizeStandardExclusion,
  canonicalizeStandardFieldValue,
  canonicalizeStandardRequiredResult,
  prepareStandardCompleteResultForPersistence,
  requireSyntheticDomainPackActivation,
  resolveSyntheticDomainPack,
  type StandardSyntheticScenario,
  type StandardStructuredSourceLanguage,
} from "@matchbase/ai-evidence/standard";
import {
  projectStoredResult,
  standardEvidenceGraphFromStoredCompleteResult,
  standardEvidenceGraphFromCompleteResultFoundationV2,
  type ResultProjectionMetadata,
  type StoredResultProjection,
} from "@matchbase/ai-evidence";
import type {
  DomainPackFieldV1,
  CompleteResultFoundationV2,
  DomainPackResolutionV1,
  DemoProjectionV1,
  EvidenceGraphV1,
  StandardFieldValueV1,
  StandardHardConstraintV1,
  StandardContradictionV1,
  StandardResultProjectionV1,
  StandardRequestDetailV1,
  StructuredStandardRequestV1,
} from "@matchbase/contracts";
import { STANDARD_DISCLOSURE_PROJECTION_VERSION } from "@matchbase/contracts";
import {
  admitRunWithinQuota,
  acquireExecutionLease,
  appendAuditEvent,
  bindConsultantProjectionPolicyAtResultProduction,
  DEFAULT_CONSULTANT_PROJECTION_CONFIG,
  getMigrationStatus,
  inTransaction,
  releaseExecutionLease,
  type ConsultantProjectionConfigRelease,
  type ConnectionPool,
  type TransactionClient,
} from "@matchbase/data";
import {
  assertStandardWorkspaceAuthorized,
  standardNotVisible,
} from "./standard-authorization.js";
import type {
  StandardConfirmationInput,
  StandardIdempotentResult,
  StandardIntakeInput,
  StandardVersionInput,
} from "./standard-types.js";
import {
  ApplicationFault,
  TERMINAL_RUN_STATES,
  type RequestContext,
} from "./types.js";
import {
  syntheticResearchAdmission,
  type ServerOwnedResearchAdmission,
} from "./research-admission.js";
import {
  guardFreshRunOutputRead,
  outputRestrictedFault,
} from "./result-output-guard.js";

const STANDARD_PROJECTION_VERSION = STANDARD_DISCLOSURE_PROJECTION_VERSION;
const QUALIFIED_LIVE_NOTICE =
  "Controlled web evidence is fetched for this run; external verification requires independent corroboration or authoritative registry evidence";
const HISTORY_LIMIT = 20;
const PACK_FIELDS = [
  ...SYNTHETIC_DOMAIN_PACK.core_fields,
  ...SYNTHETIC_DOMAIN_PACK.domain_fields,
] as const;
const PACK_FIELD_BY_ID = new Map(
  PACK_FIELDS.map((field) => [field.field_id, field]),
);
const CANONICAL_RELEASED_FIELDS = [
  "canonical.schema_version",
  "canonical.request_id",
  "canonical.canonical_version_id",
  "canonical.version",
  "canonical.source_language",
  "canonical.canonical_language",
  "canonical.domain_pack.registry_version",
  "canonical.domain_pack.pack_version",
  "canonical.domain_pack.category_id",
  "canonical.fields[].field_id",
  "canonical.fields[].macro_parameter",
  "canonical.fields[].typed_value.value_state",
  "canonical.fields[].typed_value.value",
  "canonical.fields[].typed_value.unit",
  "canonical.fields[].typed_value.raw_expression",
  "canonical.fields[].translated",
  "canonical.fields[].confidence",
  "canonical.hard_constraints[].constraint_id",
  "canonical.hard_constraints[].field_id",
  "canonical.hard_constraints[].operator",
  "canonical.hard_constraints[].target.value_state",
  "canonical.hard_constraints[].target.value",
  "canonical.hard_constraints[].target.unit",
  "canonical.hard_constraints[].target.raw_expression",
  "canonical.hard_constraints[].relaxability",
  "canonical.hard_constraints[].tolerance",
  "canonical.hard_constraints[].direction",
  "canonical.exclusions[].exclusion_id",
  "canonical.exclusions[].field_id",
  "canonical.exclusions[].canonical_english_value",
  "canonical.conditional_requirements[].requirement_id",
  "canonical.conditional_requirements[].canonical_english_condition",
  "canonical.conditional_requirements[].canonical_english_result",
  "canonical.conditional_requirements[].requirement_level",
  "canonical.conditional_requirements[].source_validation.algorithm",
  "canonical.conditional_requirements[].source_validation.key_id",
  "canonical.conditional_requirements[].source_validation.source_digest",
  "canonical.conditional_requirements[].source_validation.source_start_byte",
  "canonical.conditional_requirements[].source_validation.source_end_byte",
  "canonical.conditional_requirements[].source_validation.byte_length",
  "canonical.contradictions[].contradiction_id",
  "canonical.contradictions[].contradiction_class",
  "canonical.contradictions[].alternatives[].alternative_id",
  "canonical.contradictions[].alternatives[].canonical_english_value",
  "canonical.contradictions[].alternatives[].field_ids",
  "canonical.contradictions[].resolution_state",
  "canonical.contradictions[].selected_alternative_id",
  "canonical.readiness",
  "canonical.created_at",
] as const;

const PROJECTION_FIELDS = {
  request_history: [
    "schema_version",
    "projection_version",
    "items[].request_id",
    "items[].canonical_summary",
    "items[].version_count",
    "items[].created_at",
    "items[].updated_at",
    "items[].latest_run_state",
    "items[].latest_run_outcome",
    "items[].links.request",
    "items[].links.run",
    "next_cursor",
    "synthetic_warning",
  ],
  request_detail: [
    "schema_version",
    "projection_version",
    ...CANONICAL_RELEASED_FIELDS,
    "version_history[].canonical_version_id",
    "version_history[].version",
    "version_history[].readiness",
    "version_history[].created_at",
    "links.request",
    "links.versions",
    "links.runs",
    "synthetic_warning",
  ],
  version_history: [
    "schema_version",
    "projection_version",
    "items[].canonical_version_id",
    "items[].version",
    "items[].readiness",
    "items[].created_at",
    "next_cursor",
    "synthetic_warning",
  ],
  run_history: [
    "schema_version",
    "projection_version",
    "items[].run_id",
    "items[].request_id",
    "items[].canonical_request_version",
    "items[].state",
    "items[].phase",
    "items[].phase_label",
    "items[].progress",
    "items[].started_at",
    "items[].updated_at",
    "items[].limitations_notice",
    "items[].links.request",
    "items[].links.run",
    "items[].links.result",
    "items[].terminal",
    "items[].result_available",
    "items[].outcome",
    "items[].scarcity",
    "items[].poll_after_ms",
    "items[].projection_version",
    "next_cursor",
    "synthetic_warning",
  ],
  run_status: [
    "schema_version",
    "run_id",
    "request_id",
    "canonical_request_version",
    "state",
    "phase",
    "phase_label",
    "progress",
    "started_at",
    "updated_at",
    "limitations_notice",
    "links.request",
    "links.run",
    "links.result",
    "terminal",
    "result_available",
    "outcome",
    "scarcity",
    "poll_after_ms",
    "synthetic_warning",
    "projection_version",
  ],
  run_result: [
    "schema_version",
    "run_id",
    "outcome",
    "scarcity",
    "candidates",
    "gate_eliminations",
    "scarcity_analysis",
    "scarcity_analysis.reducing_constraints[].constraint_id",
    "scarcity_analysis.reducing_constraints[].field_id",
    "scarcity_analysis.reducing_constraints[].label",
    "scarcity_analysis.reducing_constraints[].eliminated_count",
    "scarcity_analysis.unmet_mandatory_constraints[].constraint_id",
    "scarcity_analysis.unmet_mandatory_constraints[].field_id",
    "scarcity_analysis.unmet_mandatory_constraints[].label",
    "scarcity_analysis.permitted_relaxations[].constraint_id",
    "scarcity_analysis.permitted_relaxations[].field_id",
    "scarcity_analysis.permitted_relaxations[].label",
    "scarcity_analysis.permitted_relaxations[].direction",
    "scarcity_analysis.permitted_relaxations[].tolerance",
    "limitations",
    "synthetic_warning",
    "projection_version",
  ],
} as const;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right, "en"),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function standardDisclosureProjectionRegistryRelease(): {
  readonly definition: string;
  readonly contentSha256: Buffer;
} {
  const definition = stableJson({
    schema_version: "standard-disclosure-projection.v4",
    version: STANDARD_PROJECTION_VERSION,
    tier: "standard",
    resources: PROJECTION_FIELDS,
  });
  return Object.freeze({
    definition,
    contentSha256: sha256(definition),
  });
}

function jsonHash(value: unknown): Buffer {
  return sha256(stableJson(value));
}

export const LEGACY_STANDARD_RESULT_INTEGRITY_RUN_ID =
  "stable-canonical-run" as const;

export type StoredCompleteResultIntegrityMode =
  | "complete_result_foundation_v1_exact"
  | "complete_result_foundation_v2_exact"
  | "legacy_standard_evidence_graph_v1_normalized_run_id";

export function standardCompleteResultDocumentSha256(
  document: unknown,
): Buffer {
  return jsonHash(document);
}

export function legacyStandardCompleteResultDocumentSha256(
  document: unknown,
): Buffer {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    throw new Error("Legacy Standard complete result must be an object.");
  return jsonHash({
    ...(document as Record<string, unknown>),
    run_id: LEGACY_STANDARD_RESULT_INTEGRITY_RUN_ID,
  });
}

export function assertStoredCompleteResultIntegrity(
  document: unknown,
  storedSha256: unknown,
  expectedRunId: string,
): StoredCompleteResultIntegrityMode {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    throw new Error("Stored complete result must be an object.");
  if (!Buffer.isBuffer(storedSha256) || storedSha256.length !== 32)
    throw new Error("Stored complete-result integrity digest is invalid.");
  const record = document as Record<string, unknown>;
  if (record.run_id !== expectedRunId)
    throw new Error("Stored complete-result run identity is invalid.");

  let expected: Buffer;
  let mode: StoredCompleteResultIntegrityMode;
  if (record.schema_version === "complete-result-foundation.v2") {
    expected = standardCompleteResultDocumentSha256(document);
    mode = "complete_result_foundation_v2_exact";
  } else if (record.schema_version === "complete-result-foundation.v1") {
    expected = standardCompleteResultDocumentSha256(document);
    mode = "complete_result_foundation_v1_exact";
  } else if (record.schema_version === "standard-evidence-graph.v1") {
    expected = legacyStandardCompleteResultDocumentSha256(document);
    mode = "legacy_standard_evidence_graph_v1_normalized_run_id";
  } else {
    throw new Error(
      "Stored complete-result integrity schema version is unsupported.",
    );
  }
  if (!timingSafeEqual(storedSha256, expected))
    throw new Error("Stored complete-result integrity check failed.");
  return mode;
}

function assertHistoricalDemoResultIntegrity(
  document: unknown,
  storedSha256: unknown,
  expectedRunId: string,
): asserts document is EvidenceGraphV1 {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    (document as { runId?: unknown }).runId !== expectedRunId
  )
    throw new Error("Stored historical Demo result identity is invalid.");
  if (!Buffer.isBuffer(storedSha256) || storedSha256.length !== 32)
    throw new Error("Stored historical Demo result digest is invalid.");
  const expected = sha256(JSON.stringify(document));
  if (!timingSafeEqual(storedSha256, expected))
    throw new Error("Stored historical Demo result integrity check failed.");
}

export function standardReleasedFieldPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const visit = (child: unknown, path: string): void => {
    if (Array.isArray(child)) {
      paths.add(path);
      for (const item of child) {
        if (item !== null && typeof item === "object") visit(item, `${path}[]`);
      }
      return;
    }
    if (child !== null && typeof child === "object") {
      const entries = Object.entries(child as Record<string, unknown>);
      if (entries.length === 0 && path) paths.add(path);
      for (const [key, nested] of entries)
        visit(nested, path ? `${path}.${key}` : key);
      return;
    }
    paths.add(path);
  };
  visit(value, "");
  paths.delete("");
  return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function canonicalSummary(document: unknown): string {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    return "Canonical request available";
  const canonical = document as Record<string, unknown>;
  const fields = Array.isArray(canonical.fields) ? canonical.fields : [];
  const values: string[] = [];
  for (const field of fields) {
    if (field === null || typeof field !== "object" || Array.isArray(field))
      continue;
    const item = field as Record<string, unknown>;
    if (canonical.schema_version === "structured-standard-request.v1") {
      const typed =
        item.typed_value !== null &&
        typeof item.typed_value === "object" &&
        !Array.isArray(item.typed_value)
          ? (item.typed_value as Record<string, unknown>)
          : null;
      if (
        typeof item.field_id === "string" &&
        typed?.value_state === "provided" &&
        typeof typed.value === "string"
      )
        values.push(`${item.field_id}: ${typed.value}`);
    } else if (
      canonical.schema_version === "canonical-request.v1" &&
      typeof item.fieldId === "string" &&
      item.valueState === "provided" &&
      typeof item.canonicalValue === "string"
    ) {
      values.push(`${item.fieldId}: ${item.canonicalValue}`);
    }
    if (values.length === 3) break;
  }
  if (values.length > 0) return values.join("; ");
  return canonical.schema_version === "structured-standard-request.v1"
    ? "Structured request with explicit unknown values"
    : canonical.schema_version === "canonical-request.v1"
      ? "Canonical request with explicit unknown values"
      : "Canonical request available";
}

function contradictionSet(
  constraints: readonly StandardHardConstraintV1[],
): StandardContradictionV1[] {
  const byField = new Map<string, StandardHardConstraintV1[]>();
  for (const constraint of constraints) {
    const list = byField.get(constraint.field_id) ?? [];
    list.push(constraint);
    byField.set(constraint.field_id, list);
  }
  const result: StandardContradictionV1[] = [];
  const normalized = (constraint: StandardHardConstraintV1): string | null =>
    constraint.target.value_state === "provided"
      ? `${constraint.target.value}\u0000${constraint.target.unit ?? ""}`
      : null;
  for (const [fieldId, rows] of byField) {
    let conflict: [StandardHardConstraintV1, StandardHardConstraintV1] | null =
      null;
    for (
      let leftIndex = 0;
      leftIndex < rows.length && !conflict;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < rows.length;
        rightIndex += 1
      ) {
        const left = rows[leftIndex]!;
        const right = rows[rightIndex]!;
        const leftValue = normalized(left);
        const rightValue = normalized(right);
        const distinctEquals =
          left.operator === "equals" &&
          right.operator === "equals" &&
          leftValue !== rightValue;
        const excludedEquals =
          leftValue === rightValue &&
          ((left.operator === "equals" && right.operator === "not_equals") ||
            (left.operator === "not_equals" && right.operator === "equals"));
        const bounds =
          left.target.value_state === "provided" &&
          right.target.value_state === "provided" &&
          ((left.operator === "minimum" &&
            right.operator === "maximum" &&
            Number(left.target.value) > Number(right.target.value)) ||
            (left.operator === "maximum" &&
              right.operator === "minimum" &&
              Number(right.target.value) > Number(left.target.value)));
        if (distinctEquals || excludedEquals || bounds) {
          conflict = [left, right];
          break;
        }
      }
    }
    if (!conflict) continue;
    const contradictionId = randomUUID();
    result.push({
      contradiction_id: contradictionId,
      contradiction_class: "hard_constraint",
      alternatives: conflict.map((constraint) => ({
        alternative_id: randomUUID(),
        canonical_english_value:
          constraint.target.value_state === "provided"
            ? `${constraint.operator} ${constraint.target.value}`
            : `${constraint.operator} ${constraint.target.value_state}`,
        field_ids: [fieldId],
      })),
      resolution_state: "unresolved",
    });
  }
  return result;
}

function structuredReadiness(
  fields: readonly StandardFieldValueV1[],
  contradictions: readonly StandardContradictionV1[],
): StructuredStandardRequestV1["readiness"] {
  if (contradictions.some((item) => item.resolution_state === "unresolved"))
    return "not_ready";
  const byId = new Map(fields.map((field) => [field.field_id, field]));
  const required = [
    ...SYNTHETIC_DOMAIN_PACK.core_fields,
    ...SYNTHETIC_DOMAIN_PACK.domain_fields,
  ].filter((field) => field.requirement === "required");
  if (
    required.some(
      (definition) =>
        byId.get(definition.field_id)?.typed_value.value_state === "empty",
    )
  )
    return "not_ready";
  if (
    required.some(
      (definition) =>
        byId.get(definition.field_id)?.typed_value.value_state !== "provided",
    )
  )
    return "partially_ready";
  return "ready";
}

interface StandardWorkspaceOptions {
  pool: ConnectionPool;
  privacyKey: Uint8Array | string;
  activationTtlSeconds?: number;
  consultantProjectionConfig?: ConsultantProjectionConfigRelease;
  researchAdmission?: ServerOwnedResearchAdmission;
}

interface CursorPayload {
  kind: "request_history" | "run_history" | "version_history";
  account_id: string;
  user_id: string;
  query: string;
  order: "created_desc_id_desc";
  projection: number;
  last_at: string;
  last_id: string;
}

export class StandardWorkspaceApplication {
  readonly pool: ConnectionPool;
  private readonly secret: Buffer;
  private readonly activationTtlSeconds: number;
  private readonly consultantProjectionConfig: ConsultantProjectionConfigRelease;
  private readonly researchAdmission: ServerOwnedResearchAdmission;

  constructor(options: StandardWorkspaceOptions) {
    this.pool = options.pool;
    this.secret = Buffer.from(options.privacyKey);
    if (this.secret.byteLength < 32)
      throw new Error(
        "Standard workspace privacy key must contain at least 32 bytes.",
      );
    this.activationTtlSeconds = options.activationTtlSeconds ?? 900;
    this.consultantProjectionConfig =
      options.consultantProjectionConfig ??
      DEFAULT_CONSULTANT_PROJECTION_CONFIG;
    this.researchAdmission =
      options.researchAdmission ?? syntheticResearchAdmission;
  }

  async authorize(context: RequestContext, action: string): Promise<void> {
    await assertStandardWorkspaceAuthorized(this.pool, context, action);
  }

  async readiness(): Promise<boolean> {
    try {
      return (
        this.researchAdmission.isReady() &&
        (await getMigrationStatus(this.pool)).ready
      );
    } catch {
      return false;
    }
  }

  async resolveDomainPack(
    context: RequestContext,
    input: { source_text: string; category_id?: string },
  ): Promise<DomainPackResolutionV1> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "domain_pack.resolve",
    );
    try {
      return resolveSyntheticDomainPack(
        {
          sourceText: input.source_text,
          ...(input.category_id
            ? { explicitCategoryId: input.category_id }
            : {}),
        },
        {
          accountId: context.accountId,
          userId: context.userId,
          now: new Date(),
          activationTtlSeconds: this.activationTtlSeconds,
          hmacSecret: this.secret.toString("base64url"),
        },
      );
    } catch {
      throw new ApplicationFault(
        422,
        "domain-pack-unresolved",
        "MB-422-DOMAIN-PACK",
        "Domain-pack resolution is invalid.",
      );
    }
  }

  async getDomainPack(
    context: RequestContext,
    categoryId: string,
    activationToken: string | null,
  ): Promise<unknown> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "domain_pack.read",
    );
    if (categoryId !== SYNTHETIC_DOMAIN_PACK.category_id)
      throw standardNotVisible();
    if (!activationToken) throw standardNotVisible();
    try {
      return requireSyntheticDomainPackActivation(activationToken, {
        accountId: context.accountId,
        userId: context.userId,
        now: new Date(),
        hmacSecret: this.secret.toString("base64url"),
      });
    } catch {
      throw standardNotVisible();
    }
  }

  async createRequest(
    context: RequestContext,
    idempotencyKey: string,
    input: StandardIntakeInput,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.create",
    );
    let pack;
    try {
      pack = requireSyntheticDomainPackActivation(
        input.domain_pack_activation_token,
        {
          accountId: context.accountId,
          userId: context.userId,
          now: new Date(),
          hmacSecret: this.secret.toString("base64url"),
        },
      );
    } catch {
      throw new ApplicationFault(
        422,
        "domain-pack-token-invalid",
        "MB-422-DOMAIN-PACK-TOKEN",
        "Domain-pack activation is invalid or expired.",
      );
    }
    if (
      !(["en", "fa", "ar", "es"] as const).includes(
        input.source_language as StandardStructuredSourceLanguage,
      )
    )
      throw new ApplicationFault(
        422,
        "canonicalisation-fixture-unsupported",
        "MB-422-CANONICAL",
        "Structured canonicalisation fixture is unavailable.",
      );
    const sourceLanguage =
      input.source_language as StandardStructuredSourceLanguage;
    const canonicalTyped = (
      value: StandardHardConstraintV1["target"],
      fieldId: string,
      role: "field" | "constraint",
    ): StandardHardConstraintV1["target"] => {
      return this.canonicalizeTypedValue(
        value,
        fieldId,
        sourceLanguage,
        role,
        sourceLanguage === "en",
      );
    };
    const canonicalFields = input.fields.map((field) => {
      const typedValue = canonicalTyped(
        field.typed_value,
        field.field_id,
        "field",
      );
      const canonical =
        field.typed_value.value_state === "provided" &&
        typedValue.value_state === "provided" &&
        typedValue.value !== field.typed_value.value
          ? {
              translated: sourceLanguage !== "en",
              confidence: sourceLanguage === "en" ? 1 : 0.99,
            }
          : null;
      return {
        ...structuredClone(field),
        typed_value: typedValue,
        translated: canonical?.translated ?? false,
        confidence: canonical?.confidence ?? 1,
      };
    });
    const canonicalConstraints = input.hard_constraints.map((constraint) => ({
      ...structuredClone(constraint),
      target: canonicalTyped(
        constraint.target,
        constraint.field_id,
        "constraint",
      ),
    }));
    const canonicalExclusions = input.exclusions.map((exclusion) => ({
      ...structuredClone(exclusion),
      canonical_english_value: (() => {
        try {
          return canonicalizeStandardExclusion(
            exclusion.canonical_english_value,
            sourceLanguage,
          ).canonical_english;
        } catch {
          throw new ApplicationFault(
            422,
            "canonicalisation-fixture-unsupported",
            "MB-422-CANONICAL",
            "Structured canonicalisation fixture is unavailable.",
          );
        }
      })(),
    }));
    this.validateStructuredInput(
      canonicalFields,
      canonicalConstraints,
      canonicalExclusions,
    );
    const conditional = input.conditional_requirements.map((item) => {
      const source = Buffer.from(input.source_text, "utf8");
      const submitted = Buffer.from(item.source_text, "utf8");
      if (
        !Number.isSafeInteger(item.source_start_byte) ||
        !Number.isSafeInteger(item.source_end_byte) ||
        item.source_start_byte < 0 ||
        item.source_end_byte <= item.source_start_byte ||
        item.source_end_byte > source.length ||
        !source
          .subarray(item.source_start_byte, item.source_end_byte)
          .equals(submitted)
      ) {
        throw new ApplicationFault(
          422,
          "source-substring-invalid",
          "MB-422-SOURCE-SUBSTRING",
          "Conditional source text is not an exact submitted byte substring.",
        );
      }
      return {
        ...item,
        canonicalCondition: (() => {
          try {
            return canonicalizeStandardCondition(item.condition, sourceLanguage)
              .canonical_english;
          } catch {
            throw new ApplicationFault(
              422,
              "canonicalisation-fixture-unsupported",
              "MB-422-CANONICAL",
              "Structured canonicalisation fixture is unavailable.",
            );
          }
        })(),
        canonicalResult: (() => {
          try {
            return canonicalizeStandardRequiredResult(
              item.required_result,
              sourceLanguage,
            ).canonical_english;
          } catch {
            throw new ApplicationFault(
              422,
              "canonicalisation-fixture-unsupported",
              "MB-422-CANONICAL",
              "Structured canonicalisation fixture is unavailable.",
            );
          }
        })(),
        digest: createHmac("sha256", this.secret).update(submitted).digest(),
      };
    });
    const requestHash = createHmac("sha256", this.secret)
      .update(JSON.stringify(input), "utf8")
      .digest();
    const keyHash = sha256(idempotencyKey);
    return inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT 1 FROM account WHERE account_id = $1 FOR UPDATE",
        [context.accountId],
      );
      const replay = await this.readIdempotency(
        client,
        context,
        "/api/v1/standard/requests",
        keyHash,
        requestHash,
      );
      if (replay) return replay;
      const used = await client.query(
        "SELECT 1 FROM request_domain_pack_activation WHERE activation_token_hash = $1 LIMIT 1",
        [sha256(input.domain_pack_activation_token)],
      );
      if (used.rowCount)
        throw new ApplicationFault(
          409,
          "domain-pack-token-replayed",
          "MB-409-DOMAIN-PACK-TOKEN",
          "Domain-pack activation has already been consumed.",
        );

      const requestId = randomUUID();
      const canonicalizationRunId = randomUUID();
      const versionId = randomUUID();
      await this.seedPack(client);
      await client.query(
        `INSERT INTO canonicalization_execution_run
          (canonicalization_run_id, account_id, user_id, subject_request_id, request_correlation_id, started_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [
          canonicalizationRunId,
          context.accountId,
          context.userId,
          requestId,
          context.correlationId,
        ],
      );
      const contradictions = contradictionSet(canonicalConstraints);
      const document: StructuredStandardRequestV1 = {
        schema_version: "structured-standard-request.v1",
        request_id: requestId,
        canonical_version_id: versionId,
        version: 1,
        source_language: input.source_language,
        canonical_language: "en",
        domain_pack: {
          registry_version: pack.registry_version,
          pack_version: pack.pack_version,
          category_id: pack.category_id,
        },
        fields: canonicalFields,
        hard_constraints: canonicalConstraints,
        exclusions: canonicalExclusions,
        conditional_requirements: conditional.map((item) => ({
          requirement_id: item.requirement_id,
          canonical_english_condition: item.canonicalCondition,
          canonical_english_result: item.canonicalResult,
          requirement_level: item.requirement_level,
          source_validation: {
            algorithm: "HMAC-SHA-256",
            key_id: "standard-source-v1",
            source_digest: item.digest.toString("hex"),
            source_start_byte: item.source_start_byte,
            source_end_byte: item.source_end_byte,
            byte_length: Buffer.byteLength(item.source_text, "utf8"),
          },
        })),
        contradictions,
        readiness: structuredReadiness(canonicalFields, contradictions),
        created_at: new Date().toISOString(),
      };
      await client.query(
        `INSERT INTO sourcing_request
          (request_id, account_id, created_by_user_id, canonicalization_run_id, current_version, lifecycle_state)
         VALUES ($1,$2,$3,$4,1,'canonicalised')`,
        [requestId, context.accountId, context.userId, canonicalizationRunId],
      );
      await this.persistVersion(
        client,
        context,
        requestId,
        versionId,
        1,
        null,
        document,
        createHmac("sha256", this.secret)
          .update(Buffer.from(input.source_text, "utf8"))
          .digest(),
      );
      const packVersion = await client.query<{
        domain_pack_version_id: string;
      }>(
        "SELECT domain_pack_version_id FROM domain_pack_version WHERE category_code = $1 AND version = 1",
        [pack.category_id],
      );
      await client.query(
        `INSERT INTO request_domain_pack_activation
          (activation_id, account_id, owner_user_id, canonical_request_version_id,
           domain_pack_version_id, resolved_category_code, category_confidence,
           category_confirmed, activation_token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,true,$7,clock_timestamp() + interval '24 hours')`,
        [
          randomUUID(),
          context.accountId,
          context.userId,
          versionId,
          packVersion.rows[0]!.domain_pack_version_id,
          pack.category_id,
          sha256(input.domain_pack_activation_token),
        ],
      );
      for (const item of conditional) {
        await client.query(
          `INSERT INTO conditional_requirement
            (conditional_requirement_id, account_id, owner_user_id, canonical_request_version_id,
             condition_english, required_result_english, requirement_level, validation_locator,
             validation_digest_hmac_sha256, validation_key_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'standard-source-v1')`,
          [
            randomUUID(),
            context.accountId,
            context.userId,
            versionId,
            item.canonicalCondition,
            item.canonicalResult,
            item.requirement_level === "preferred"
              ? "recommended"
              : "mandatory",
            `bytes:${item.source_start_byte}-${item.source_end_byte}`,
            item.digest,
          ],
        );
      }
      const response: Record<string, unknown> = structuredClone(
        document,
      ) as unknown as Record<string, unknown>;
      await client.query(
        `INSERT INTO idempotency_record
          (idempotency_record_id, account_id, subject_user_id, route, key_hash, request_hash,
           response_status, response_body, result_resource_id, created_at, expires_at)
         VALUES ($1,$2,$3,'/api/v1/standard/requests',$4,$5,201,$6::jsonb,$7,clock_timestamp(),clock_timestamp()+interval '24 hours')`,
        [
          randomUUID(),
          context.accountId,
          context.userId,
          keyHash,
          requestHash,
          JSON.stringify(response),
          requestId,
        ],
      );
      await appendAuditEvent(
        client,
        this.audit(
          context,
          "request.canonicalised",
          "sourcing_request",
          requestId,
          "allow",
          {
            version: 1,
            sourceLanguageTag: input.source_language,
            domainPackVersion: pack.pack_version,
            translationRoute: "deterministic_internal_fixture",
            capabilityAttemptCreated: false,
          },
        ),
      );
      return response;
    });
  }

  async listRequests(
    context: RequestContext,
    cursor?: string,
    query = "",
    filter = "all",
    recordProjection = true,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.history",
    );
    const binding = JSON.stringify({ query, filter });
    const position = cursor
      ? this.openCursor(context, cursor, "request_history", binding)
      : null;
    const result = await this.pool.query<{
      request_id: string;
      created_at: Date;
      updated_at: Date;
      current_version: number;
      canonical_document: unknown;
      latest_state: string | null;
      latest_outcome: string | null;
    }>(
      `SELECT r.request_id, r.created_at, GREATEST(v.created_at,COALESCE(latest.updated_at,v.created_at)) AS updated_at, r.current_version, v.canonical_document,
              latest.state AS latest_state, latest.outcome AS latest_outcome
         FROM sourcing_request r JOIN canonical_request_version v
           ON v.request_id=r.request_id AND v.version=r.current_version
         LEFT JOIN LATERAL (
           SELECT CASE WHEN rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL
                       THEN 'failed' ELSE rr.state END AS state,
                  rs.outcome,
                  GREATEST(rr.queued_at,COALESCE(rr.started_at,rr.queued_at),
                           COALESCE(rr.completed_at,lt.completed_at,rr.queued_at),
                           COALESCE(rr.cancelled_at,rr.queued_at)) AS updated_at
             FROM research_run rr
             LEFT JOIN run_result rs USING(run_id)
             LEFT JOIN live_research_terminal lt
               ON lt.account_id=rr.account_id AND lt.run_id=rr.run_id
            WHERE rr.canonical_request_version_id=v.canonical_request_version_id
              AND rr.requested_by_user_id=$3 ORDER BY rr.queued_at DESC,rr.run_id DESC LIMIT 1
         ) latest ON true
        WHERE r.account_id=$1 AND r.created_by_user_id=$3
          AND ($4::text = '' OR v.canonical_document::text ILIKE '%' || $4 || '%')
          AND ($5::timestamptz IS NULL OR (GREATEST(v.created_at,COALESCE(latest.updated_at,v.created_at)),r.request_id) < ($5,$6::uuid))
          AND ($7='all'
            OR ($7='active' AND latest.state IN ('queued','researching','scoring','escalated','restricted','cancelling','failed_retryable'))
            OR ($7='completed' AND latest.state='complete')
            OR ($7='failed' AND latest.state='failed')
            OR ($7='cancelled' AND latest.state='cancelled')
            OR ($7='superseded' AND latest.state='superseded')
            OR ($7='scarce' AND (latest.state='no_responsible_match' OR latest.outcome='scarcity')))
        ORDER BY updated_at DESC,r.request_id DESC LIMIT $2`,
      [
        context.accountId,
        HISTORY_LIMIT + 1,
        context.userId,
        query,
        position?.last_at ?? null,
        position?.last_id ?? null,
        filter,
      ],
    );
    const hasMore = result.rows.length > HISTORY_LIMIT;
    const rows = result.rows.slice(0, HISTORY_LIMIT);
    const items = rows.map((row) => ({
      request_id: row.request_id,
      canonical_summary: canonicalSummary(row.canonical_document),
      version_count: row.current_version,
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
      latest_run_state: this.publicState(row.latest_state),
      latest_run_outcome: this.publicOutcome(row.latest_state),
      links: {
        request: `/api/v1/requests/${row.request_id}`,
        run: `/api/v1/runs?request_id=${row.request_id}`,
      },
    }));
    const last = rows.at(-1);
    const body = {
      schema_version: "standard-request-history.v1",
      projection_version: STANDARD_PROJECTION_VERSION,
      items,
      ...(hasMore && last
        ? {
            next_cursor: this.sealCursor(
              context,
              "request_history",
              binding,
              iso(last.updated_at),
              last.request_id,
            ),
          }
        : {}),
      synthetic_warning: STANDARD_SYNTHETIC_WARNING,
    };
    this.assertClosedProjection("request_history", body);
    if (recordProjection)
      await this.recordProjection(
        context,
        "request_history",
        context.userId,
        items[0]?.request_id,
        undefined,
        standardReleasedFieldPaths(body),
        items.length,
      );
    return body;
  }

  async getRequest(
    context: RequestContext,
    requestId: string,
    recordProjection = true,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(this.pool, context, "request.read");
    const result = await this.pool.query<{
      canonical_document: StructuredStandardRequestV1;
      canonical_request_version_id: string;
      version: number;
      match_readiness: StructuredStandardRequestV1["readiness"];
      created_at: Date;
    }>(
      `SELECT v.canonical_document,v.canonical_request_version_id,v.version,v.match_readiness,v.created_at FROM sourcing_request r JOIN canonical_request_version v
        ON v.request_id=r.request_id AND v.version=r.current_version
       WHERE r.request_id=$1 AND r.account_id=$2 AND r.created_by_user_id=$3`,
      [requestId, context.accountId, context.userId],
    );
    const current = result.rows[0];
    if (!current) throw standardNotVisible();
    const history = await this.pool.query<{
      canonical_request_version_id: string;
      version: number;
      match_readiness: StructuredStandardRequestV1["readiness"];
      created_at: Date;
    }>(
      `SELECT v.canonical_request_version_id,v.version,v.match_readiness,v.created_at
         FROM canonical_request_version v JOIN sourcing_request r USING(request_id)
        WHERE v.request_id=$1 AND v.account_id=$2 AND r.created_by_user_id=$3
        ORDER BY v.created_at DESC,v.canonical_request_version_id DESC LIMIT $4`,
      [requestId, context.accountId, context.userId, HISTORY_LIMIT],
    );
    const body: StandardRequestDetailV1 = {
      schema_version: "standard-request-detail.v1",
      projection_version: STANDARD_PROJECTION_VERSION,
      canonical: current.canonical_document,
      version_history: history.rows.map((row) => ({
        canonical_version_id: row.canonical_request_version_id,
        version: row.version,
        readiness: row.match_readiness,
        created_at: iso(row.created_at),
      })),
      links: {
        request: `/api/v1/requests/${requestId}`,
        versions: `/api/v1/requests/${requestId}/versions`,
        runs: `/api/v1/runs?request_id=${requestId}`,
      },
      synthetic_warning: STANDARD_SYNTHETIC_WARNING,
    };
    this.assertClosedProjection(
      "request_detail",
      body as unknown as Record<string, unknown>,
    );
    if (recordProjection)
      await this.recordProjection(
        context,
        "request",
        requestId,
        requestId,
        undefined,
        standardReleasedFieldPaths(body),
        1,
      );
    return body as unknown as Record<string, unknown>;
  }

  async listVersions(
    context: RequestContext,
    requestId: string,
    cursor?: string,
    recordProjection = true,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.version_history",
    );
    await this.assertRequestOwner(context, requestId);
    const position = cursor
      ? this.openCursor(context, cursor, "version_history", requestId)
      : null;
    const result = await this.pool.query<{
      canonical_request_version_id: string;
      version: number;
      created_at: Date;
      match_readiness: string;
      canonical_document: StructuredStandardRequestV1;
    }>(
      `SELECT v.canonical_request_version_id,v.version,v.created_at,v.match_readiness,v.canonical_document
         FROM canonical_request_version v JOIN sourcing_request r USING(request_id)
        WHERE v.request_id=$1 AND v.account_id=$2 AND r.created_by_user_id=$3
          AND ($4::timestamptz IS NULL OR (v.created_at,v.canonical_request_version_id)<($4,$5::uuid))
        ORDER BY v.created_at DESC,v.canonical_request_version_id DESC LIMIT $6`,
      [
        requestId,
        context.accountId,
        context.userId,
        position?.last_at ?? null,
        position?.last_id ?? null,
        HISTORY_LIMIT + 1,
      ],
    );
    const rows = result.rows.slice(0, HISTORY_LIMIT);
    const last = rows.at(-1);
    const body = {
      schema_version: "standard-request-version-history.v1",
      projection_version: STANDARD_PROJECTION_VERSION,
      items: rows.map((row) => ({
        canonical_version_id: row.canonical_request_version_id,
        version: row.version,
        readiness: row.match_readiness,
        created_at: iso(row.created_at),
      })),
      ...(result.rows.length > HISTORY_LIMIT && last
        ? {
            next_cursor: this.sealCursor(
              context,
              "version_history",
              requestId,
              iso(last.created_at),
              last.canonical_request_version_id,
            ),
          }
        : {}),
      synthetic_warning: STANDARD_SYNTHETIC_WARNING,
    };
    this.assertClosedProjection("version_history", body);
    if (recordProjection)
      await this.recordProjection(
        context,
        "request_version_history",
        requestId,
        requestId,
        undefined,
        standardReleasedFieldPaths(body),
        rows.length,
      );
    return body;
  }

  async createVersion(
    context: RequestContext,
    requestId: string,
    input: StandardVersionInput,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.version_create",
    );
    return inTransaction(this.pool, (client) =>
      this.createVersionTransaction(client, context, requestId, input),
    );
  }

  private async createVersionTransaction(
    client: TransactionClient,
    context: RequestContext,
    requestId: string,
    input: StandardVersionInput,
  ): Promise<Record<string, unknown>> {
    const owner = await client.query<{
      current_version: number;
      canonical_request_version_id: string;
      canonical_document: StructuredStandardRequestV1;
    }>(
      `SELECT r.current_version,v.canonical_request_version_id,v.canonical_document FROM sourcing_request r
          JOIN canonical_request_version v ON v.request_id=r.request_id AND v.version=r.current_version
         WHERE r.request_id=$1 AND r.account_id=$2 AND r.created_by_user_id=$3 FOR UPDATE OF r`,
      [requestId, context.accountId, context.userId],
    );
    const prior = owner.rows[0];
    if (!prior) throw standardNotVisible();
    const version = prior.current_version + 1;
    const versionId = randomUUID();
    const sourceLanguage: StandardStructuredSourceLanguage = "en";
    const canonicalFields = input.fields.map((field) => {
      const typedValue = this.canonicalizeTypedValue(
        field.typed_value,
        field.field_id,
        sourceLanguage,
        "field",
        true,
      );
      return {
        ...structuredClone(field),
        typed_value: typedValue,
        translated: false,
        confidence: 1,
      };
    });
    const canonicalConstraints = input.hard_constraints.map((constraint) => {
      return {
        ...structuredClone(constraint),
        target: this.canonicalizeTypedValue(
          constraint.target,
          constraint.field_id,
          sourceLanguage,
          "constraint",
          true,
        ),
      };
    });
    const canonicalExclusions = input.exclusions.map((exclusion) => {
      try {
        return {
          ...structuredClone(exclusion),
          canonical_english_value: canonicalizeStandardExclusion(
            exclusion.canonical_english_value,
            sourceLanguage,
          ).canonical_english,
        };
      } catch {
        throw new ApplicationFault(
          422,
          "canonicalisation-fixture-unsupported",
          "MB-422-CANONICAL",
          "Structured canonicalisation fixture is unavailable.",
        );
      }
    });
    this.validateStructuredInput(
      canonicalFields,
      canonicalConstraints,
      canonicalExclusions,
    );
    const contradictions = contradictionSet(canonicalConstraints);
    const document: StructuredStandardRequestV1 = {
      ...structuredClone(prior.canonical_document),
      canonical_version_id: versionId,
      version,
      fields: canonicalFields,
      hard_constraints: canonicalConstraints,
      exclusions: canonicalExclusions,
      contradictions,
      readiness: structuredReadiness(canonicalFields, contradictions),
      created_at: new Date().toISOString(),
    };
    await this.persistVersion(
      client,
      context,
      requestId,
      versionId,
      version,
      prior.canonical_request_version_id,
      document,
      undefined,
      true,
      "en",
    );
    await client.query(
      "UPDATE sourcing_request SET current_version=$2,lifecycle_state='canonicalised' WHERE request_id=$1",
      [requestId, version],
    );
    await appendAuditEvent(
      client,
      this.audit(
        context,
        "request.version.created",
        "sourcing_request",
        requestId,
        "allow",
        { version },
      ),
    );
    return structuredClone(document) as unknown as Record<string, unknown>;
  }

  async createVersionIdempotent(
    context: RequestContext,
    idempotencyKey: string,
    requestId: string,
    input: StandardVersionInput,
  ): Promise<StandardIdempotentResult<Record<string, unknown>>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.version_create",
    );
    const route = `/api/v1/requests/${requestId}/versions`;
    const keyHash = sha256(idempotencyKey);
    const requestHash = createHmac("sha256", this.secret)
      .update(JSON.stringify(input), "utf8")
      .digest();
    return inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT 1 FROM account WHERE account_id=$1 FOR UPDATE",
        [context.accountId],
      );
      const replay = await this.readIdempotency(
        client,
        context,
        route,
        keyHash,
        requestHash,
      );
      if (replay) return { body: replay, replayed: true };
      const body = await this.createVersionTransaction(
        client,
        context,
        requestId,
        input,
      );
      await this.writeIdempotency(
        client,
        context,
        route,
        keyHash,
        requestHash,
        body,
        201,
      );
      return { body, replayed: false };
    });
  }

  async confirmVersion(
    context: RequestContext,
    requestId: string,
    version: number,
    accepted: boolean,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.confirm",
    );
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<{
        canonical_request_version_id: string;
        match_readiness: string;
      }>(
        `SELECT v.canonical_request_version_id,v.match_readiness FROM canonical_request_version v JOIN sourcing_request r USING(request_id)
          WHERE r.request_id=$1 AND r.account_id=$2 AND r.created_by_user_id=$3 AND v.version=$4`,
        [requestId, context.accountId, context.userId, version],
      );
      const row = result.rows[0];
      if (!row) throw standardNotVisible();
      if (accepted && row.match_readiness === "not_ready")
        throw new ApplicationFault(
          422,
          "unresolved-contradiction",
          "MB-422-CONTRADICTION",
          "The canonical request is not ready.",
        );
      await client.query(
        `INSERT INTO canonical_confirmation (confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [
          randomUUID(),
          row.canonical_request_version_id,
          context.accountId,
          context.userId,
          accepted,
        ],
      );
      if (accepted)
        await client.query(
          "UPDATE sourcing_request SET lifecycle_state='confirmed' WHERE request_id=$1",
          [requestId],
        );
      await appendAuditEvent(
        client,
        this.audit(
          context,
          "request.confirmed",
          "sourcing_request",
          requestId,
          accepted ? "allow" : "deny",
          { version, accepted },
        ),
      );
      return {
        request_id: requestId,
        version,
        accepted,
        readiness: row.match_readiness,
      };
    });
  }

  async confirmVersionIdempotent(
    context: RequestContext,
    idempotencyKey: string,
    requestId: string,
    pathVersion: number,
    input: StandardConfirmationInput,
  ): Promise<StandardIdempotentResult<Record<string, unknown>>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.confirm",
    );
    const route = `/api/v1/requests/${requestId}/versions/${pathVersion}/confirmation`;
    const keyHash = sha256(idempotencyKey);
    const requestHash = createHmac("sha256", this.secret)
      .update(JSON.stringify(input), "utf8")
      .digest();
    return inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT 1 FROM account WHERE account_id=$1 FOR UPDATE",
        [context.accountId],
      );
      const replay = await this.readIdempotency(
        client,
        context,
        route,
        keyHash,
        requestHash,
      );
      if (replay) return { body: replay, replayed: true };
      const current = await client.query<{
        canonical_request_version_id: string;
        current_version: number;
        canonical_document: StructuredStandardRequestV1;
      }>(
        `SELECT v.canonical_request_version_id,r.current_version,v.canonical_document
           FROM sourcing_request r JOIN canonical_request_version v
             ON v.request_id=r.request_id AND v.version=r.current_version
          WHERE r.request_id=$1 AND r.account_id=$2 AND r.created_by_user_id=$3
            AND r.current_version=$4 FOR UPDATE OF r`,
        [requestId, context.accountId, context.userId, pathVersion],
      );
      const row = current.rows[0];
      if (!row) throw standardNotVisible();
      const resolutionIds = new Set<string>();
      const validated = input.contradiction_resolutions.map((resolution) => {
        if (
          !resolution.reason_english.trim() ||
          !/^[\x20-\x7E]+$/u.test(resolution.reason_english) ||
          resolutionIds.has(resolution.contradiction_id)
        )
          throw new ApplicationFault(
            422,
            "schema-violation",
            "MB-422-SCHEMA",
            "Contradiction resolutions must be unique canonical English records.",
          );
        resolutionIds.add(resolution.contradiction_id);
        const contradiction = row.canonical_document.contradictions.find(
          (item) =>
            item.contradiction_id === resolution.contradiction_id &&
            item.resolution_state === "unresolved",
        );
        if (!contradiction) throw standardNotVisible();
        const alternativeId =
          typeof resolution.selected_alternative === "string"
            ? resolution.selected_alternative
            : resolution.selected_alternative &&
                typeof resolution.selected_alternative === "object"
              ? (
                  resolution.selected_alternative as {
                    alternative_id?: unknown;
                  }
                ).alternative_id
              : null;
        const alternative = contradiction.alternatives.find(
          (item) => item.alternative_id === alternativeId,
        );
        if (!alternative)
          throw new ApplicationFault(
            422,
            "contradiction-alternative-invalid",
            "MB-422-CONTRADICTION",
            "Contradiction resolution alternative is invalid.",
          );
        const selectedConstraint = row.canonical_document.hard_constraints.find(
          (constraint) => {
            const value =
              constraint.target.value_state === "provided"
                ? constraint.target.value
                : constraint.target.value_state;
            return (
              alternative.field_ids.includes(constraint.field_id) &&
              `${constraint.operator} ${value}` ===
                alternative.canonical_english_value
            );
          },
        );
        if (!selectedConstraint)
          throw new ApplicationFault(
            422,
            "contradiction-alternative-invalid",
            "MB-422-CONTRADICTION",
            "Contradiction resolution does not identify canonical constraint truth.",
          );
        return {
          resolution,
          contradiction,
          alternativeId: alternative.alternative_id,
          selectedConstraint,
        };
      });

      let targetVersion = row.current_version;
      let targetVersionId = row.canonical_request_version_id;
      let targetDocument = structuredClone(row.canonical_document);
      if (validated.length > 0) {
        const replacedFields = new Set(
          validated.flatMap((item) =>
            item.contradiction.alternatives.flatMap(
              (alternative) => alternative.field_ids,
            ),
          ),
        );
        const selected = validated.map((item) =>
          structuredClone(item.selectedConstraint),
        );
        const hardConstraints = row.canonical_document.hard_constraints
          .filter((constraint) => !replacedFields.has(constraint.field_id))
          .concat(selected);
        const contradictions: StandardContradictionV1[] =
          row.canonical_document.contradictions.map((item) => {
            const resolution = validated.find(
              (candidate) =>
                candidate.contradiction.contradiction_id ===
                item.contradiction_id,
            );
            return resolution
              ? {
                  ...item,
                  resolution_state: "resolved_by_owner" as const,
                  selected_alternative_id: resolution.alternativeId,
                }
              : item;
          });
        targetVersion += 1;
        targetVersionId = randomUUID();
        targetDocument = {
          ...targetDocument,
          canonical_version_id: targetVersionId,
          version: targetVersion,
          hard_constraints: hardConstraints,
          contradictions,
          readiness: structuredReadiness(targetDocument.fields, contradictions),
          created_at: new Date().toISOString(),
        };
        await this.persistVersion(
          client,
          context,
          requestId,
          targetVersionId,
          targetVersion,
          row.canonical_request_version_id,
          targetDocument,
          undefined,
          false,
          "en",
        );
        for (const item of validated) {
          await client.query(
            `INSERT INTO canonical_contradiction_resolution (contradiction_resolution_id,account_id,contradiction_id,resolved_by_user_id,resolving_canonical_request_version_id,selected_alternative,resolution_reason_english) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
            [
              randomUUID(),
              context.accountId,
              item.contradiction.contradiction_id,
              context.userId,
              targetVersionId,
              JSON.stringify({ alternative_id: item.alternativeId }),
              item.resolution.reason_english,
            ],
          );
        }
        await client.query(
          "UPDATE sourcing_request SET current_version=$2,lifecycle_state='canonicalised' WHERE request_id=$1",
          [requestId, targetVersion],
        );
        await appendAuditEvent(
          client,
          this.audit(
            context,
            "request.contradiction.resolved",
            "sourcing_request",
            requestId,
            "allow",
            {
              contradictionIds: validated.map(
                (item) => item.contradiction.contradiction_id,
              ),
              version: targetVersion,
            },
          ),
        );
      }
      if (input.accepted && targetDocument.readiness === "not_ready")
        throw new ApplicationFault(
          422,
          "unresolved-contradiction",
          "MB-422-CONTRADICTION",
          "The canonical request is not ready.",
        );
      await client.query(
        `INSERT INTO canonical_confirmation (confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [
          randomUUID(),
          targetVersionId,
          context.accountId,
          context.userId,
          input.accepted,
        ],
      );
      if (input.accepted)
        await client.query(
          "UPDATE sourcing_request SET lifecycle_state='confirmed' WHERE request_id=$1",
          [requestId],
        );
      await appendAuditEvent(
        client,
        this.audit(
          context,
          "request.confirmed",
          "sourcing_request",
          requestId,
          input.accepted ? "allow" : "deny",
          { version: targetVersion, accepted: input.accepted },
        ),
      );
      const body = {
        request_id: requestId,
        canonical_version_id: targetVersionId,
        version: targetVersion,
        accepted: input.accepted,
        readiness: targetDocument.readiness,
      };
      await this.writeIdempotency(
        client,
        context,
        route,
        keyHash,
        requestHash,
        body,
        200,
      );
      return { body, replayed: false };
    });
  }

  async resolveContradiction(
    context: RequestContext,
    requestId: string,
    contradictionId: string,
    selectedAlternative: unknown,
    reasonEnglish: string,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "request.contradiction_resolve",
    );
    if (!reasonEnglish.trim() || !/[A-Za-z]/u.test(reasonEnglish))
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "Resolution reason must be canonical English.",
      );
    return inTransaction(this.pool, async (client) => {
      const current = await client.query<{
        canonical_request_version_id: string;
        current_version: number;
        canonical_document: StructuredStandardRequestV1;
      }>(
        `SELECT v.canonical_request_version_id,r.current_version,v.canonical_document FROM sourcing_request r JOIN canonical_request_version v ON v.request_id=r.request_id AND v.version=r.current_version WHERE r.request_id=$1 AND r.account_id=$2 AND r.created_by_user_id=$3 FOR UPDATE OF r`,
        [requestId, context.accountId, context.userId],
      );
      const row = current.rows[0];
      if (!row) throw standardNotVisible();
      const contradiction = row.canonical_document.contradictions.find(
        (item) =>
          item.contradiction_id === contradictionId &&
          item.resolution_state === "unresolved",
      );
      if (!contradiction) throw standardNotVisible();
      const alternativeId =
        typeof selectedAlternative === "string"
          ? selectedAlternative
          : selectedAlternative && typeof selectedAlternative === "object"
            ? (selectedAlternative as { alternative_id?: unknown })
                .alternative_id
            : null;
      if (
        typeof alternativeId !== "string" ||
        !contradiction.alternatives.some(
          (alternative) => alternative.alternative_id === alternativeId,
        )
      )
        throw new ApplicationFault(
          422,
          "contradiction-alternative-invalid",
          "MB-422-CONTRADICTION",
          "Contradiction resolution alternative is invalid.",
        );
      const selectedAlternativeRecord = contradiction.alternatives.find(
        (alternative) => alternative.alternative_id === alternativeId,
      )!;
      const selectedConstraint = row.canonical_document.hard_constraints.find(
        (constraint) => {
          const value =
            constraint.target.value_state === "provided"
              ? constraint.target.value
              : constraint.target.value_state;
          return (
            selectedAlternativeRecord.field_ids.includes(constraint.field_id) &&
            `${constraint.operator} ${value}` ===
              selectedAlternativeRecord.canonical_english_value
          );
        },
      );
      if (!selectedConstraint)
        throw new ApplicationFault(
          422,
          "contradiction-alternative-invalid",
          "MB-422-CONTRADICTION",
          "Contradiction resolution does not identify canonical constraint truth.",
        );
      const versionId = randomUUID();
      const version = row.current_version + 1;
      const contradictions: StandardContradictionV1[] =
        row.canonical_document.contradictions.map((item) =>
          item.contradiction_id === contradictionId
            ? {
                ...item,
                resolution_state: "resolved_by_owner" as const,
                selected_alternative_id: alternativeId,
              }
            : item,
        );
      const document: StructuredStandardRequestV1 = {
        ...structuredClone(row.canonical_document),
        canonical_version_id: versionId,
        version,
        hard_constraints: row.canonical_document.hard_constraints
          .filter(
            (constraint) =>
              !selectedAlternativeRecord.field_ids.includes(
                constraint.field_id,
              ),
          )
          .concat(structuredClone(selectedConstraint)),
        contradictions,
        readiness: structuredReadiness(
          row.canonical_document.fields,
          contradictions,
        ),
        created_at: new Date().toISOString(),
      };
      await this.persistVersion(
        client,
        context,
        requestId,
        versionId,
        version,
        row.canonical_request_version_id,
        document,
        undefined,
        false,
      );
      await client.query(
        `INSERT INTO canonical_contradiction_resolution (contradiction_resolution_id,account_id,contradiction_id,resolved_by_user_id,resolving_canonical_request_version_id,selected_alternative,resolution_reason_english) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          randomUUID(),
          context.accountId,
          contradictionId,
          context.userId,
          versionId,
          JSON.stringify({ alternative_id: alternativeId }),
          reasonEnglish,
        ],
      );
      await client.query(
        "UPDATE sourcing_request SET current_version=$2,lifecycle_state='canonicalised' WHERE request_id=$1",
        [requestId, version],
      );
      await appendAuditEvent(
        client,
        this.audit(
          context,
          "request.contradiction.resolved",
          "sourcing_request",
          requestId,
          "allow",
          { contradictionId },
        ),
      );
      return structuredClone(document) as unknown as Record<string, unknown>;
    });
  }

  async submitRun(
    context: RequestContext,
    idempotencyKey: string,
    requestId: string,
    version: number,
  ): Promise<Record<string, unknown>> {
    const productTier = await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "run.submit",
    );
    const researchMode = this.researchAdmission.decide(productTier);
    const target = await this.pool.query<{
      canonical_request_version_id: string;
      match_readiness: string;
      confirmed: boolean;
    }>(
      `SELECT v.canonical_request_version_id,v.match_readiness,EXISTS(SELECT 1 FROM canonical_confirmation c WHERE c.canonical_request_version_id=v.canonical_request_version_id AND c.accepted) AS confirmed
         FROM canonical_request_version v JOIN sourcing_request r USING(request_id)
        WHERE r.request_id=$1 AND r.account_id=$2 AND r.created_by_user_id=$3 AND v.version=$4`,
      [requestId, context.accountId, context.userId, version],
    );
    const row = target.rows[0];
    if (!row) throw standardNotVisible();
    if (row.match_readiness === "not_ready" || !row.confirmed)
      throw new ApplicationFault(
        422,
        "request-not-ready",
        "MB-422-READY",
        "The request is not ready and confirmed.",
      );
    const configuration = await this.configuration();
    const admitted = await admitRunWithinQuota(this.pool, {
      accountId: context.accountId,
      userId: context.userId,
      canonicalRequestVersionId: row.canonical_request_version_id,
      idempotencyKeyHash: sha256(idempotencyKey),
      requestHash: jsonHash({ requestId, version }),
      modelPolicyVersionId: configuration.model,
      scoringConfigVersionId: configuration.scoring,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      researchMode: researchMode.id,
      ...(productTier === "consultant"
        ? { adminProductTier: "consultant" as const }
        : {}),
    });
    if (admitted.disposition === "quota_exceeded")
      throw new ApplicationFault(
        429,
        "quota-exceeded",
        "MB-429-QUOTA",
        "Rolling quota exceeded.",
        true,
        {
          "Retry-After": "1",
          "MB-RateLimit-Limit": String(admitted.limit),
          "MB-RateLimit-Remaining": "0",
          "MB-RateLimit-Reset": admitted.nextCapacityAt,
        },
      );
    return {
      run_id: admitted.runId,
      state: "queued",
      poll_after_ms: 10_000,
      quota: {
        limit: admitted.limit,
        used: admitted.used,
        remaining: admitted.remaining,
        next_capacity_at: admitted.nextCapacityAt,
      },
      idempotent_replay: admitted.disposition === "replayed",
      research_mode: {
        id: researchMode.id,
        label: researchMode.label,
        live_qualified: researchMode.liveQualified,
      },
    };
  }

  async listRuns(
    context: RequestContext,
    cursor?: string,
    requestId = "",
    filter = "all",
    recordProjection = true,
  ): Promise<Record<string, unknown>> {
    const productTier = await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "run.history",
    );
    const binding = JSON.stringify({ requestId, filter });
    const position = cursor
      ? this.openCursor(context, cursor, "run_history", binding)
      : null;
    const result = await this.pool.query<{
      run_id: string;
      request_id: string;
      version: number;
      state: string;
      queued_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
      eligible_count: number | null;
      tier_at_submission: "demo" | "standard" | "consultant";
      research_mode: "synthetic_reference" | "qualified_live_research";
    }>(
      `SELECT rr.run_id,v.request_id,v.version,
              CASE WHEN rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL
                   THEN 'failed' ELSE rr.state END AS state,
              rr.queued_at,rr.started_at,COALESCE(rr.completed_at,lt.completed_at) AS completed_at,
              rr.tier_at_submission,rr.research_mode,rs.eligible_count
         FROM research_run rr
         JOIN canonical_request_version v USING(canonical_request_version_id)
         LEFT JOIN run_result rs USING(run_id)
         LEFT JOIN live_research_terminal lt
           ON lt.account_id=rr.account_id AND lt.run_id=rr.run_id
        WHERE rr.account_id=$1 AND rr.requested_by_user_id=$2 AND ($3::text='' OR v.request_id=$3::uuid)
          AND ($4::timestamptz IS NULL OR (rr.queued_at,rr.run_id)<($4,$5::uuid))
          AND ($7='all'
            OR ($7='active' AND (rr.state IN ('queued','researching','scoring','escalated','restricted','cancelling')
                                 OR (rr.state='failed_retryable' AND lt.live_research_terminal_id IS NULL)))
            OR ($7='completed' AND rr.state='complete')
            OR ($7='failed' AND (rr.state='failed' OR (rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL)))
            OR ($7='cancelled' AND rr.state='cancelled')
            OR ($7='superseded' AND rr.state='superseded')
            OR ($7='scarce' AND (rr.state='no_responsible_match' OR EXISTS(SELECT 1 FROM run_result rs WHERE rs.run_id=rr.run_id AND rs.outcome='scarcity')))
          ) ORDER BY rr.queued_at DESC,rr.run_id DESC LIMIT $6`,
      [
        context.accountId,
        context.userId,
        requestId,
        position?.last_at ?? null,
        position?.last_id ?? null,
        HISTORY_LIMIT + 1,
        filter,
      ],
    );
    const rows = result.rows.slice(0, HISTORY_LIMIT);
    const items = rows.map((row) =>
      this.runProjection(row, false, productTier),
    );
    const last = rows.at(-1);
    const body = {
      schema_version: "standard-run-history.v1",
      projection_version: STANDARD_PROJECTION_VERSION,
      items,
      ...(result.rows.length > HISTORY_LIMIT && last
        ? {
            next_cursor: this.sealCursor(
              context,
              "run_history",
              binding,
              iso(last.queued_at),
              last.run_id,
            ),
          }
        : {}),
      synthetic_warning: STANDARD_SYNTHETIC_WARNING,
    };
    this.assertClosedProjection("run_history", body);
    if (recordProjection)
      await this.recordProjection(
        context,
        "run_history",
        context.userId,
        undefined,
        rows[0]?.run_id,
        standardReleasedFieldPaths(body),
        items.length,
      );
    return body;
  }

  async getRun(
    context: RequestContext,
    runId: string,
    recordProjection = true,
  ): Promise<Record<string, unknown>> {
    const productTier = await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "run.read",
    );
    const guarded = await inTransaction(this.pool, async (client) => {
      const guard = await guardFreshRunOutputRead(
        client,
        context,
        runId,
        "run.status",
      );
      if (guard.kind !== "allowed") return guard;
      const result = await client.query<{
        run_id: string;
        request_id: string;
        version: number;
        queued_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        eligible_count: number | null;
        tier_at_submission: "demo" | "standard" | "consultant";
        research_mode: "synthetic_reference" | "qualified_live_research";
      }>(
        `SELECT rr.run_id,v.request_id,v.version,rr.queued_at,rr.started_at,
                COALESCE(rr.completed_at,lt.completed_at) AS completed_at,
                rr.tier_at_submission,rr.research_mode,rs.eligible_count
           FROM research_run rr JOIN canonical_request_version v USING(canonical_request_version_id)
           LEFT JOIN run_result rs ON rs.account_id=rr.account_id AND rs.run_id=rr.run_id
           LEFT JOIN live_research_terminal lt ON lt.account_id=rr.account_id AND lt.run_id=rr.run_id
          WHERE rr.run_id=$1 AND rr.account_id=$2 AND rr.requested_by_user_id=$3`,
        [runId, context.accountId, context.userId],
      );
      const row = result.rows[0];
      return row
        ? { kind: "allowed" as const, row: { ...row, state: guard.state } }
        : { kind: "not_visible" as const };
    });
    if (guarded.kind === "output_restricted") throw outputRestrictedFault();
    if (guarded.kind === "not_visible") throw standardNotVisible();
    const row = guarded.row;
    const body = this.runProjection(row, true, productTier);
    this.assertClosedProjection("run_status", body);
    if (recordProjection)
      await this.recordProjection(
        context,
        "run_status",
        runId,
        undefined,
        runId,
        standardReleasedFieldPaths(body),
        1,
      );
    return body;
  }

  async getResultProjection(
    context: RequestContext,
    runId: string,
  ): Promise<StoredResultProjection> {
    await assertStandardWorkspaceAuthorized(this.pool, context, "run.result");
    const guarded = await inTransaction(this.pool, async (client) => {
      const guard = await guardFreshRunOutputRead(
        client,
        context,
        runId,
        "run.result",
      );
      if (guard.kind !== "allowed") return guard;
      const result = await client.query<{
        tier_at_submission: "demo" | "standard" | "consultant";
        research_mode: "synthetic_reference" | "qualified_live_research";
        complete_result_document: unknown;
        result_sha256: Buffer;
        canonical_document:
          StructuredStandardRequestV1 | Record<string, unknown>;
        scarcity_outcome: "scarcity" | "no_responsible_match" | null;
        unmet_constraints: unknown;
        permitted_relaxations: unknown;
        projection_as_of: Date;
      }>(
        `SELECT rr.tier_at_submission,rr.research_mode,
              rs.complete_result_document,rs.result_sha256,v.canonical_document,
              sa.outcome AS scarcity_outcome,sa.unmet_constraints,sa.permitted_relaxations,
              transaction_timestamp() AS projection_as_of
         FROM research_run rr
         JOIN canonical_request_version v
           ON v.account_id=rr.account_id
          AND v.canonical_request_version_id=rr.canonical_request_version_id
         LEFT JOIN run_result rs
           ON rs.account_id=rr.account_id AND rs.run_id=rr.run_id
         LEFT JOIN scarcity_analysis sa
           ON sa.account_id=rr.account_id AND sa.run_id=rr.run_id
        WHERE rr.run_id=$1 AND rr.account_id=$2 AND rr.requested_by_user_id=$3`,
        [runId, context.accountId, context.userId],
      );
      const row = result.rows[0];
      if (!row) return { kind: "not_visible" as const };
      if (
        !row.complete_result_document ||
        !["complete", "no_responsible_match"].includes(guard.state)
      )
        throw new ApplicationFault(
          409,
          "run-not-complete",
          "MB-409-RUN",
          "Run result is not available.",
          true,
        );
      if (row.tier_at_submission === "demo") {
        const document = row.complete_result_document;
        if (
          (document as Record<string, unknown>).schema_version ===
          "complete-result-foundation.v2"
        )
          assertStoredCompleteResultIntegrity(
            document,
            row.result_sha256,
            runId,
          );
        else
          assertHistoricalDemoResultIntegrity(
            document,
            row.result_sha256,
            runId,
          );
        const canonical = row.canonical_document as Record<string, unknown>;
        const fields = Array.isArray(canonical.fields) ? canonical.fields : [];
        const mandatoryConstraints = fields.flatMap((field) => {
          if (
            field === null ||
            typeof field !== "object" ||
            Array.isArray(field)
          )
            return [];
          const value = field as Record<string, unknown>;
          if (
            value.fieldId !== "mandatory_constraints" ||
            value.valueState !== "provided" ||
            typeof value.canonicalValue !== "string"
          )
            return [];
          return [value.canonicalValue];
        });
        return {
          kind: "allowed" as const,
          projected: projectStoredResult({
            tier: "demo",
            completeResult: document as
              EvidenceGraphV1 | CompleteResultFoundationV2,
            runBoundMandatoryConstraints: mandatoryConstraints,
            researchMode: row.research_mode,
          }),
        };
      }
      if (row.tier_at_submission === "consultant")
        throw new ApplicationFault(
          403,
          "run-not-visible",
          "MB-403-NOT-VISIBLE",
          "The requested resource is not visible.",
        );
      const legacyEmptyScarcityLedger =
        row.scarcity_outcome !== null &&
        Array.isArray(row.unmet_constraints) &&
        row.unmet_constraints.length === 0 &&
        Array.isArray(row.permitted_relaxations) &&
        row.permitted_relaxations.length === 0;
      assertStoredCompleteResultIntegrity(
        row.complete_result_document,
        row.result_sha256,
        runId,
      );
      const completeResult =
        (row.complete_result_document as Record<string, unknown>)
          .schema_version === "complete-result-foundation.v2"
          ? standardEvidenceGraphFromCompleteResultFoundationV2(
              row.complete_result_document as CompleteResultFoundationV2,
            )
          : standardEvidenceGraphFromStoredCompleteResult(
              row.complete_result_document,
            );
      const projected = projectStoredResult({
        tier: "standard",
        completeResult,
        projectionAsOf: row.projection_as_of.toISOString(),
        runBoundCanonicalHardConstraints: (
          row.canonical_document as StructuredStandardRequestV1
        ).hard_constraints,
        allowLegacyEmptyScarcityLedger: legacyEmptyScarcityLedger,
      });
      const body = projected.body;
      if (body.scarcity === "none") {
        if (row.scarcity_outcome !== null)
          throw new ApplicationFault(
            500,
            "scarcity-analysis-integrity",
            "MB-500-SCARCITY",
            "Stored scarcity analysis conflicts with the completed result.",
            false,
          );
      } else {
        const expectedOutcome =
          body.scarcity === "zero" ? "no_responsible_match" : "scarcity";
        const expectedReducing =
          body.scarcity_analysis.reducing_constraints.map(
            ({ constraint_id, eliminated_count }) => ({
              constraint_id,
              eliminated_count,
            }),
          );
        const expectedRelaxations =
          body.scarcity_analysis.permitted_relaxations.map(
            ({ constraint_id }) => constraint_id,
          );
        if (
          row.scarcity_outcome !== expectedOutcome ||
          stableJson(row.unmet_constraints) !== stableJson(expectedReducing) ||
          stableJson(row.permitted_relaxations) !==
            stableJson(expectedRelaxations)
        )
          throw new ApplicationFault(
            500,
            "scarcity-analysis-integrity",
            "MB-500-SCARCITY",
            "Stored scarcity analysis does not match the run-bound canonical result.",
            false,
          );
      }
      this.assertClosedProjection(
        "run_result",
        body as unknown as Record<string, unknown>,
      );
      return { kind: "allowed" as const, projected };
    });
    if (guarded.kind === "output_restricted") throw outputRestrictedFault();
    if (guarded.kind === "not_visible") throw standardNotVisible();
    return guarded.projected;
  }

  async getResult(
    context: RequestContext,
    runId: string,
    recordProjection = true,
  ): Promise<StandardResultProjectionV1 | DemoProjectionV1> {
    const projected = await this.getResultProjection(context, runId);
    const { body, metadata } = projected;
    if (recordProjection)
      await this.recordProjection(
        context,
        "run_result",
        runId,
        undefined,
        runId,
        [...metadata.fieldsReleased],
        metadata.itemCount,
        false,
        "projectionAsOf" in metadata ? metadata.projectionAsOf : undefined,
      );
    return body;
  }

  async cancelRun(
    context: RequestContext,
    runId: string,
  ): Promise<Record<string, unknown>> {
    await assertStandardWorkspaceAuthorized(this.pool, context, "run.cancel");
    return inTransaction(this.pool, (client) =>
      this.cancelRunTransaction(client, context, runId),
    );
  }

  async cancelRunIdempotent(
    context: RequestContext,
    idempotencyKey: string,
    runId: string,
  ): Promise<StandardIdempotentResult<Record<string, unknown>>> {
    await assertStandardWorkspaceAuthorized(this.pool, context, "run.cancel");
    const route = `/api/v1/runs/${runId}/cancellation`;
    const keyHash = sha256(idempotencyKey);
    const requestHash = jsonHash({ runId, reason: "owner_cancelled" });
    return inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT 1 FROM account WHERE account_id=$1 FOR UPDATE",
        [context.accountId],
      );
      const replay = await this.readIdempotency(
        client,
        context,
        route,
        keyHash,
        requestHash,
      );
      if (replay) return { body: replay, replayed: true };
      const body = await this.cancelRunTransaction(client, context, runId);
      await this.writeIdempotency(
        client,
        context,
        route,
        keyHash,
        requestHash,
        body,
        202,
      );
      return { body, replayed: false };
    });
  }

  async executeSyntheticRun(
    context: RequestContext,
    runId: string,
  ): Promise<boolean> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      "worker.execute",
    );
    const existing = await this.pool.query(
      "SELECT 1 FROM run_result WHERE run_id=$1 AND account_id=$2",
      [runId, context.accountId],
    );
    if (existing.rowCount === 1) return true;
    const ownerToken = sha256(randomUUID());
    const leaseContext = {
      accountId: context.accountId,
      actorUserId: context.userId,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
    };
    let lease;
    try {
      lease = await acquireExecutionLease(
        this.pool,
        runId,
        ownerToken,
        60_000,
        leaseContext,
      );
    } catch (error) {
      const state = await this.pool.query<{ state: string }>(
        "SELECT state FROM research_run WHERE run_id=$1 AND account_id=$2",
        [runId, context.accountId],
      );
      if (state.rows[0] && TERMINAL_RUN_STATES.has(state.rows[0].state))
        return false;
      throw error;
    }
    if (!lease) return false;
    try {
      const run = await this.pool.query<{
        canonical_document: StructuredStandardRequestV1;
        scoring_config_version_id: string;
      }>(
        `SELECT v.canonical_document,rr.scoring_config_version_id FROM research_run rr JOIN canonical_request_version v USING(canonical_request_version_id) WHERE rr.run_id=$1 AND rr.account_id=$2 AND rr.requested_by_user_id=$3`,
        [runId, context.accountId, context.userId],
      );
      const row = run.rows[0];
      if (!row) throw standardNotVisible();
      const scenarios: StandardSyntheticScenario[] = [
        "zero",
        "one",
        "two",
        "three",
        "many",
      ];
      const hardConstraints = Array.isArray(
        row.canonical_document.hard_constraints,
      )
        ? row.canonical_document.hard_constraints
        : [];
      const scenarioMaterial = {
        selector_version: "canonical-registry.v1",
        domain_pack: row.canonical_document.domain_pack,
        fields: row.canonical_document.fields,
        hard_constraints: hardConstraints.map(
          ({ constraint_id: _constraintId, ...constraint }) => constraint,
        ),
        exclusions: row.canonical_document.exclusions,
        conditional_requirements:
          row.canonical_document.conditional_requirements,
        contradictions: row.canonical_document.contradictions,
      };
      const scenarioDigest = jsonHash(scenarioMaterial);
      const scenario = normalizeStandardSyntheticScenarioForConstraints(
        scenarios[scenarioDigest[0]! % scenarios.length]!,
        hardConstraints.length,
      );
      const rawGraph = buildStandardSyntheticEvidenceGraph(
        runId,
        scenario,
        hardConstraints,
      );
      const preparedRelease = prepareStandardCompleteResultForPersistence(
        rawGraph,
        {
          now: new Date("2026-08-15T00:00:00Z"),
          runBoundCanonicalHardConstraints: hardConstraints,
        },
      );
      const graph = preparedRelease.persistence_graph;
      const completeResultFoundation = preparedRelease.persistence_foundation;
      const projection = preparedRelease.projection;
      await inTransaction(this.pool, async (client) => {
        const locked = await client.query<{ state: string }>(
          "SELECT state FROM research_run WHERE run_id=$1 AND account_id=$2 FOR UPDATE",
          [runId, context.accountId],
        );
        if (!locked.rows[0] || TERMINAL_RUN_STATES.has(locked.rows[0].state))
          return;
        const raced = await client.query(
          "SELECT 1 FROM run_result WHERE run_id=$1 FOR SHARE",
          [runId],
        );
        if (raced.rowCount) return;
        const routeId = "20000000-0000-4000-8000-000000000001";
        await client.query(
          `INSERT INTO provider_route(provider_route_id,route_id,capability,provider,model_id,environment,route_kind,data_handling_posture,timeout_ms,max_attempts,retry_policy,config_version,enabled) VALUES($1,'standard-synthetic-v1','CAP-SEARCH','synthetic_fixture','standard-fixture-v1','test','synthetic_fixture','synthetic_fixture',1000,1,'{"retry":false}'::jsonb,'slice2.v1',true) ON CONFLICT(route_id,config_version) DO NOTHING`,
          [routeId],
        );
        const route = await client.query<{ provider_route_id: string }>(
          "SELECT provider_route_id FROM provider_route WHERE route_id='standard-synthetic-v1' AND config_version='slice2.v1'",
          [],
        );
        const attemptId = randomUUID();
        await client.query(
          `INSERT INTO capability_attempt(capability_attempt_id,run_id,account_id,user_id,capability,provider,model_id,environment,provider_route_id,outcome,started_at,completed_at) VALUES($1,$2,$3,$4,'CAP-SEARCH','synthetic_fixture','standard-fixture-v1','test',$5,'ok',clock_timestamp(),clock_timestamp())`,
          [
            attemptId,
            runId,
            context.accountId,
            context.userId,
            route.rows[0]!.provider_route_id,
          ],
        );
        await client.query(
          `INSERT INTO provider_call(provider_call_id,capability_attempt_id,run_id,account_id,user_id,capability,step_key,provider,model_id,environment,route_id,request_parameters,input_tokens,output_tokens,cached_input_tokens,latency_ms,request_identifier_hash,called_at) VALUES($1,$2,$3,$4,$5,'CAP-SEARCH','standard_fixture','synthetic_fixture','standard-fixture-v1','test','standard-synthetic-v1',$6::jsonb,0,0,0,0,$7,clock_timestamp())`,
          [
            randomUUID(),
            attemptId,
            runId,
            context.accountId,
            context.userId,
            JSON.stringify({
              scenarioSelectorVersion: "canonical-registry.v1",
              scenario,
              canonicalScenarioSha256: scenarioDigest.toString("hex"),
            }),
            scenarioDigest,
          ],
        );
        await client.query(
          `INSERT INTO cost_event(cost_event_id,capability_attempt_id,run_id,account_id,user_id,capability,provider,model_id,environment,quantity,unit,amount,currency_code,pricing_basis,pricing_version,pricing_state,measurement_kind,occurred_at) VALUES($1,$2,$3,$4,$5,'CAP-SEARCH','synthetic_fixture','standard-fixture-v1','test',1,'invocation',0,'USD','synthetic_fixture','slice2.v1','explicit_zero','measured',clock_timestamp())`,
          [randomUUID(), attemptId, runId, context.accountId, context.userId],
        );
        const evidenceIds = new Map<string, string>();
        const supportIds = new Map<string, string>();
        for (const evidence of graph.evidence) {
          const evidenceId = randomUUID();
          const supportId = randomUUID();
          if (!("fixture_identity" in evidence))
            throw new Error(
              "Standard synthetic worker received a non-fixture source.",
            );
          evidenceIds.set(evidence.evidence_id, evidenceId);
          supportIds.set(evidence.evidence_id, supportId);
          await client.query(
            `INSERT INTO evidence_item(evidence_item_id,run_id,account_id,source_kind,local_fixture_id,title,publisher_domain,retrieved_at,content_sha256,verification_disposition,published_at,accessed_at,source_tier,extracted_support,extracted_support_locator,freshness_policy_version,volatility_class,required_corroboration) VALUES($1,$2,$3,'synthetic_fixture',$4,$5,$6,$7,$8,'synthetic',$9,$7,'fixture',$10,$11::jsonb,'standard-evidence-volatility.v1',$12,1)`,
            [
              evidenceId,
              runId,
              context.accountId,
              evidence.fixture_identity,
              evidence.title,
              evidence.publisher_domain,
              evidence.accessed_at,
              Buffer.from(evidence.content_sha256, "hex"),
              evidence.published_or_updated,
              evidence.extract,
              JSON.stringify({ fixture_identity: evidence.fixture_identity }),
              evidence.volatility_class === "moderate"
                ? "medium"
                : evidence.volatility_class,
            ],
          );
          await client.query(
            `INSERT INTO evidence_support(evidence_support_id,account_id,run_id,evidence_item_id,verification_status,freshness_status,corroboration_status,extracted_support_start,extracted_support_end,assessed_at,policy_version) VALUES($1,$2,$3,$4,'unknown','fresh','not_required',0,$5,clock_timestamp(),'standard-evidence-volatility.v1')`,
            [
              supportId,
              context.accountId,
              runId,
              evidenceId,
              Buffer.byteLength(evidence.extract, "utf8"),
            ],
          );
        }
        const candidateIds = new Map<string, string>();
        const claimIds = new Map<string, string>();
        for (const [index, candidate] of graph.candidates.entries()) {
          const candidateId = randomUUID();
          candidateIds.set(candidate.candidate_id, candidateId);
          await client.query(
            `INSERT INTO candidate(candidate_id,run_id,account_id,canonical_name,country_code,deterministic_rank,eligible) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              candidateId,
              runId,
              context.accountId,
              candidate.display_name,
              candidate.country_code,
              index + 1,
              graph.eligible_candidate_ids.includes(candidate.candidate_id),
            ],
          );
        }
        for (const claim of graph.claims) {
          const claimId = randomUUID();
          claimIds.set(claim.claim_id, claimId);
          await client.query(
            `INSERT INTO claim(claim_id,run_id,account_id,candidate_id,assertion_text,decision_bearing,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              claimId,
              runId,
              context.accountId,
              candidateIds.get(claim.candidate_id),
              claim.text,
              claim.decision_bearing,
              claim.verification_status,
            ],
          );
          for (const evidenceId of claim.evidence_ids)
            await client.query(
              `INSERT INTO claim_evidence(claim_id,evidence_item_id,account_id,relation,support_locator) VALUES($1,$2,$3,'supports',$4::jsonb)`,
              [
                claimId,
                evidenceIds.get(evidenceId),
                context.accountId,
                JSON.stringify({ exact_extract: true }),
              ],
            );
        }
        for (const candidate of graph.candidates) {
          const projected = projection.candidates.find(
            (item) => item.display_name === candidate.display_name,
          );
          if (!projected) continue;
          const candidateId = candidateIds.get(candidate.candidate_id)!;
          const scoreId = randomUUID();
          const storedBand = (band: string): string =>
            band.replace(/_fit$/u, "");
          await client.query(
            `INSERT INTO candidate_score(candidate_score_id,account_id,run_id,candidate_id,compatibility_score,fit_band,displayed_band,band_ceiling,band_ceiling_reason,evidence_confidence,scoring_config_version_id,scored_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp())`,
            [
              scoreId,
              context.accountId,
              runId,
              candidateId,
              projected.compatibility_score,
              storedBand(projected.fit_band),
              storedBand(projected.displayed_band),
              projected.fit_band === projected.displayed_band
                ? null
                : storedBand(projected.displayed_band),
              projected.band_ceiling_reason ?? null,
              projected.evidence_confidence,
              row.scoring_config_version_id,
            ],
          );
          for (const dimension of projected.dimension_scores)
            await client.query(
              `INSERT INTO candidate_dimension_score(candidate_score_id,account_id,dimension,score,weight_percent,critical,rationale_english) VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [
                scoreId,
                context.accountId,
                dimension.dimension_id,
                dimension.score,
                dimension.weight,
                ["category_product_fit", "volume_capacity_fit"].includes(
                  dimension.dimension_id,
                ),
                `Deterministic repository-fixture score for ${dimension.dimension_id}.`,
              ],
            );
          const primaryClaim = candidate.rationale_claim_ids[0];
          const evidenceId = primaryClaim
            ? graph.claims.find((claim) => claim.claim_id === primaryClaim)
                ?.evidence_ids[0]
            : undefined;
          if (primaryClaim && evidenceId) {
            for (const [kind, explanations] of [
              ["positive_driver", projected.positive_drivers],
              ["limiting_gap", projected.limiting_gaps],
            ] as const)
              for (const [index, explanation] of explanations.entries())
                await client.query(
                  `INSERT INTO candidate_explanation(candidate_explanation_id,account_id,run_id,candidate_id,explanation_kind,rank,explanation_english,claim_id,evidence_support_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                  [
                    randomUUID(),
                    context.accountId,
                    runId,
                    candidateId,
                    kind,
                    index + 1,
                    explanation.explanation,
                    claimIds.get(primaryClaim),
                    supportIds.get(evidenceId),
                  ],
                );
          }
        }
        for (const value of graph.evidenced_values) {
          const evidenceId = value.evidence_ids[0];
          if (!evidenceId) continue;
          await client.query(
            `INSERT INTO candidate_evidenced_value(candidate_evidenced_value_id,account_id,run_id,candidate_id,value_kind,typed_value,organization_contact,evidence_support_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
            [
              randomUUID(),
              context.accountId,
              runId,
              candidateIds.get(value.candidate_id),
              value.kind === "capacity"
                ? "capacity_figures"
                : value.kind === "organization_contact"
                  ? "contact_details"
                  : value.kind === "plant"
                    ? "plant_identifiers"
                    : "approval_identifiers",
              JSON.stringify(
                value.kind === "organization_contact"
                  ? {
                      value: value.value,
                      channel_type: value.channel_type,
                      organization_domain: value.organization_domain,
                      ...(value.channel_type === "organization_web"
                        ? {
                            organization_web_policy_version:
                              value.organization_web_policy_version,
                            organization_web_purpose:
                              value.organization_web_purpose,
                            organization_web_form: value.organization_web_form,
                          }
                        : {}),
                    }
                  : { value: value.value },
              ),
              value.kind === "organization_contact",
              supportIds.get(evidenceId),
            ],
          );
        }
        const eligibleCount = graph.eligible_candidate_ids.length;
        const outcome =
          eligibleCount === 0
            ? "no_responsible_match"
            : eligibleCount < 3
              ? "scarcity"
              : "candidates";
        await client.query(
          `INSERT INTO run_result(run_id,account_id,outcome,eligible_count,considered_count,scarcity,limitations_text,complete_result_document,result_sha256,assembled_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,clock_timestamp())`,
          [
            runId,
            context.accountId,
            outcome,
            eligibleCount,
            graph.candidates.length,
            JSON.stringify({ state: projection.scarcity }),
            STANDARD_SYNTHETIC_WARNING,
            JSON.stringify(completeResultFoundation),
            standardCompleteResultDocumentSha256(completeResultFoundation),
          ],
        );
        await bindConsultantProjectionPolicyAtResultProduction(client, {
          accountId: context.accountId,
          runId,
          release: this.consultantProjectionConfig,
        });
        for (const [
          index,
          candidateId,
        ] of graph.eligible_candidate_ids.entries())
          await client.query(
            `INSERT INTO result_candidate(run_id,candidate_id,account_id,rank,eligible,rationale_short) VALUES($1,$2,$3,$4,true,'Repository-owned synthetic evidence supports this screened candidate.')`,
            [
              runId,
              candidateIds.get(candidateId),
              context.accountId,
              index + 1,
            ],
          );
        await client.query(
          `INSERT INTO result_limitation(result_limitation_id,account_id,run_id,limitation_kind,notice_english,canonical_order) VALUES($1,$2,$3,'screening_not_performed','Restricted-party screening has not been performed.',1),($4,$2,$3,'advisory_boundary','Decision support only; not professional advice.',2)`,
          [randomUUID(), context.accountId, runId, randomUUID()],
        );
        if (eligibleCount < 3)
          await client.query(
            `INSERT INTO scarcity_analysis(scarcity_analysis_id,account_id,run_id,outcome,unmet_constraints,permitted_relaxations,analysis_english) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
            [
              randomUUID(),
              context.accountId,
              runId,
              eligibleCount === 0 ? "no_responsible_match" : "scarcity",
              JSON.stringify(
                projection.scarcity_analysis.reducing_constraints.map(
                  ({ constraint_id, eliminated_count }) => ({
                    constraint_id,
                    eliminated_count,
                  }),
                ),
              ),
              JSON.stringify(
                projection.scarcity_analysis.permitted_relaxations.map(
                  ({ constraint_id }) => constraint_id,
                ),
              ),
              eligibleCount === 0
                ? "No candidate met the mandatory constraints for this synthetic request."
                : "Fewer than three candidates met all mandatory constraints for this synthetic request.",
            ],
          );
        await client.query(
          `UPDATE research_run SET state=$2,completed_at=clock_timestamp() WHERE run_id=$1`,
          [runId, eligibleCount === 0 ? "no_responsible_match" : "complete"],
        );
        await appendAuditEvent(
          client,
          this.audit(context, "run.completed", "research_run", runId, "allow", {
            scenario,
            eligibleCandidates: eligibleCount,
          }),
        );
        for (const event of preparedRelease.security_events)
          await appendAuditEvent(
            client,
            this.audit(
              context,
              event.event_type,
              "research_run",
              runId,
              "allow",
              {
                policyVersion: event.policy_version,
                fieldPath: event.field_path,
                action: event.action,
                findingCount: event.finding_count,
              },
            ),
          );
      });
      return true;
    } catch (error) {
      await inTransaction(this.pool, async (client) => {
        const retryable = await client.query(
          `UPDATE research_run rr
              SET state='failed_retryable',state_reason='synthetic_execution_retryable',started_at=NULL
            WHERE rr.run_id=$1 AND rr.account_id=$2
              AND rr.state IN ('researching','scoring')
              AND NOT EXISTS (SELECT 1 FROM run_result result WHERE result.run_id=rr.run_id)
          RETURNING rr.run_id`,
          [runId, context.accountId],
        );
        if (retryable.rowCount)
          await appendAuditEvent(
            client,
            this.audit(
              context,
              "run.retryable_failure",
              "research_run",
              runId,
              "error",
              { reasonCode: "synthetic_execution_retryable" },
            ),
          );
      });
      throw error;
    } finally {
      await releaseExecutionLease(
        this.pool,
        runId,
        ownerToken,
        "standard_worker_complete",
        leaseContext,
      );
    }
  }

  async refuseAction(context: RequestContext, action: string): Promise<never> {
    await assertStandardWorkspaceAuthorized(
      this.pool,
      context,
      `forbidden.${action}`,
    );
    await inTransaction(this.pool, (client) =>
      appendAuditEvent(
        client,
        this.audit(
          context,
          "access.denied",
          "standard_action",
          undefined,
          "deny",
          { refusalCode: "MB-403-ACTION", action },
        ),
      ).then(() => undefined),
    );
    throw new ApplicationFault(
      403,
      "action-not-available",
      "MB-403-ACTION",
      "This action is not available in Standard.",
      false,
      {},
      true,
    );
  }

  async idempotentMutation<T extends Record<string, unknown>>(
    context: RequestContext,
    route: string,
    idempotencyKey: string,
    input: unknown,
    action: () => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }> {
    const keyHash = sha256(idempotencyKey);
    const requestHash = createHmac("sha256", this.secret)
      .update(JSON.stringify(input), "utf8")
      .digest();
    const reservationId = randomUUID();
    const reserved = await this.pool.query(
      `INSERT INTO idempotency_record
        (idempotency_record_id,account_id,subject_user_id,route,key_hash,request_hash,
         response_status,response_body,result_resource_id,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,102,'{"pending":true}'::jsonb,NULL,clock_timestamp(),clock_timestamp()+interval '24 hours')
       ON CONFLICT(account_id,subject_user_id,route,key_hash) DO NOTHING
       RETURNING idempotency_record_id`,
      [
        reservationId,
        context.accountId,
        context.userId,
        route,
        keyHash,
        requestHash,
      ],
    );
    if (reserved.rowCount === 0) {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const prior = await this.pool.query<{
          request_hash: Buffer;
          response_status: number;
          response_body: T;
        }>(
          `SELECT request_hash,response_status,response_body
             FROM idempotency_record
            WHERE account_id=$1 AND subject_user_id=$2 AND route=$3 AND key_hash=$4
              AND expires_at>clock_timestamp()`,
          [context.accountId, context.userId, route, keyHash],
        );
        const row = prior.rows[0];
        if (!row)
          throw new ApplicationFault(
            503,
            "idempotency-reservation-lost",
            "MB-503-IDEMPOTENCY",
            "The idempotent mutation reservation was lost.",
            true,
          );
        if (!row.request_hash.equals(requestHash))
          throw new ApplicationFault(
            409,
            "idempotency-conflict",
            "MB-409-IDEMPOTENCY",
            "Idempotency key was reused with different input.",
          );
        if (row.response_status !== 102)
          return { body: row.response_body, replayed: true };
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      throw new ApplicationFault(
        503,
        "idempotency-pending",
        "MB-503-IDEMPOTENCY",
        "The idempotent mutation is still pending.",
        true,
      );
    }
    try {
      const body = await action();
      const resourceId =
        typeof body.canonical_version_id === "string"
          ? body.canonical_version_id
          : typeof body.request_id === "string"
            ? body.request_id
            : undefined;
      const completed = await this.pool.query(
        `UPDATE idempotency_record
            SET response_status=200,response_body=$2::jsonb,result_resource_id=$3
          WHERE idempotency_record_id=$1 AND response_status=102`,
        [reservationId, JSON.stringify(body), resourceId ?? null],
      );
      if (completed.rowCount !== 1)
        throw new ApplicationFault(
          503,
          "idempotency-reservation-lost",
          "MB-503-IDEMPOTENCY",
          "The idempotent mutation reservation was lost.",
          true,
        );
      return { body, replayed: false };
    } catch (error) {
      await this.pool
        .query(
          "DELETE FROM idempotency_record WHERE idempotency_record_id=$1 AND response_status=102",
          [reservationId],
        )
        .catch(() => undefined);
      throw error;
    }
  }

  etag(value: unknown): string {
    return `"${jsonHash(value).toString("base64url")}"`;
  }

  async recordNotModifiedProjection(
    context: RequestContext,
    resourceKind:
      | "request_history"
      | "request"
      | "request_version_history"
      | "run_history"
      | "run_status"
      | "run_result",
    resourceId: string,
    requestId?: string,
    runId?: string,
    resultProjectionMetadata?: ResultProjectionMetadata,
  ): Promise<void> {
    await this.recordProjection(
      context,
      resourceKind,
      resourceId,
      requestId,
      runId,
      [],
      0,
      true,
      resultProjectionMetadata?.projectionAsOf,
    );
  }

  async recordServedProjection(
    context: RequestContext,
    _projectionKind: keyof typeof PROJECTION_FIELDS,
    resourceKind: string,
    resourceId: string,
    requestId: string | undefined,
    runId: string | undefined,
    body: Record<string, unknown>,
    resultProjectionMetadata?: ResultProjectionMetadata,
  ): Promise<void> {
    const collection = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.candidates)
        ? body.candidates
        : null;
    await this.recordProjection(
      context,
      resourceKind,
      resourceId,
      requestId,
      runId,
      resultProjectionMetadata
        ? [...resultProjectionMetadata.fieldsReleased]
        : standardReleasedFieldPaths(body),
      resultProjectionMetadata?.itemCount ?? collection?.length ?? 1,
      false,
      resultProjectionMetadata?.projectionAsOf,
    );
  }

  private exactKeys(
    value: unknown,
    allowed: readonly string[],
  ): asserts value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Closed Standard projection is invalid.");
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.some((key) => !allowed.includes(key)))
      throw new Error(
        "Closed Standard projection contains an unreleased field.",
      );
  }

  private assertClosedProjection(
    kind: keyof typeof PROJECTION_FIELDS,
    body: Record<string, unknown>,
  ): void {
    if (body.projection_version !== STANDARD_PROJECTION_VERSION)
      throw new Error("Standard disclosure projection version drifted.");
    const items = (value: unknown): Record<string, unknown>[] =>
      Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    if (kind === "request_history") {
      this.exactKeys(body, [
        "schema_version",
        "projection_version",
        "items",
        "next_cursor",
        "synthetic_warning",
      ]);
      for (const item of items(body.items)) {
        this.exactKeys(item, [
          "request_id",
          "canonical_summary",
          "version_count",
          "created_at",
          "updated_at",
          "latest_run_state",
          "latest_run_outcome",
          "links",
        ]);
        this.exactKeys(item.links, ["request", "run"]);
      }
      return;
    }
    if (kind === "version_history") {
      this.exactKeys(body, [
        "schema_version",
        "projection_version",
        "items",
        "next_cursor",
        "synthetic_warning",
      ]);
      for (const item of items(body.items))
        this.exactKeys(item, [
          "canonical_version_id",
          "version",
          "readiness",
          "created_at",
        ]);
      return;
    }
    if (kind === "request_detail") {
      this.exactKeys(body, [
        "schema_version",
        "projection_version",
        "canonical",
        "version_history",
        "links",
        "synthetic_warning",
      ]);
      this.exactKeys(body.links, ["request", "versions", "runs"]);
      for (const item of items(body.version_history))
        this.exactKeys(item, [
          "canonical_version_id",
          "version",
          "readiness",
          "created_at",
        ]);
      this.assertClosedCanonical(body.canonical);
      return;
    }
    if (kind === "run_history") {
      this.exactKeys(body, [
        "schema_version",
        "projection_version",
        "items",
        "next_cursor",
        "synthetic_warning",
      ]);
      for (const item of items(body.items)) this.assertClosedRun(item, false);
      return;
    }
    if (kind === "run_status") {
      this.assertClosedRun(body, true);
      return;
    }
    this.exactKeys(body, [
      "schema_version",
      "run_id",
      "outcome",
      "scarcity",
      "candidates",
      "gate_eliminations",
      "scarcity_analysis",
      "limitations",
      "synthetic_warning",
      "projection_version",
    ]);
    for (const candidate of items(body.candidates)) {
      this.exactKeys(candidate, [
        "display_name",
        "country_code",
        "rationale_extended",
        "compatibility_score",
        "fit_band",
        "band_ceiling",
        "displayed_band",
        "band_ceiling_reason",
        "dimension_scores",
        "positive_drivers",
        "limiting_gaps",
        "citations",
        "freshness",
        "verification_status",
        "evidence_confidence",
        "contact_details",
        "plant_identifiers",
        "approval_identifiers",
        "capacity_figures",
      ]);
      for (const dimension of items(candidate.dimension_scores))
        this.exactKeys(dimension, [
          "dimension_id",
          "weight",
          "score",
          "confidence",
        ]);
      for (const key of ["positive_drivers", "limiting_gaps"] as const)
        for (const explanation of items(candidate[key]))
          this.exactKeys(explanation, [
            "dimension_id",
            "explanation",
            "claim_id",
            "evidence_ids",
          ]);
      for (const citation of items(candidate.citations))
        this.exactKeys(citation, [
          "evidence_id",
          "title",
          "publisher",
          "published_or_updated",
          "accessed_at",
          "source_tier",
          "status",
          "access_state",
          "extract",
          "content_sha256",
          "provenance",
          "exact_url",
          "fixture_identity",
        ]);
      for (const key of [
        "contact_details",
        "plant_identifiers",
        "approval_identifiers",
        "capacity_figures",
      ] as const)
        for (const evidenced of items(candidate[key]))
          this.exactKeys(evidenced, [
            "kind",
            "value",
            "channel_type",
            "organization_domain",
            "organization_web_policy_version",
            "organization_web_purpose",
            "organization_web_form",
            "verification_status",
            "evidence_ids",
          ]);
    }
    for (const gate of items(body.gate_eliminations))
      this.exactKeys(gate, ["gate_id", "label", "eliminated_count"]);
    this.exactKeys(body.scarcity_analysis, [
      "reducing_constraints",
      "unmet_mandatory_constraints",
      "permitted_relaxations",
    ]);
    const scarcityAnalysis = body.scarcity_analysis as Record<string, unknown>;
    for (const constraint of items(scarcityAnalysis.reducing_constraints))
      this.exactKeys(constraint, [
        "constraint_id",
        "field_id",
        "label",
        "eliminated_count",
      ]);
    for (const constraint of items(
      scarcityAnalysis.unmet_mandatory_constraints,
    ))
      this.exactKeys(constraint, ["constraint_id", "field_id", "label"]);
    for (const constraint of items(scarcityAnalysis.permitted_relaxations))
      this.exactKeys(constraint, [
        "constraint_id",
        "field_id",
        "label",
        "direction",
        "tolerance",
      ]);
    this.exactKeys(body.limitations, [
      "unknown_count",
      "not_asked_count",
      "affected_low_confidence_dimensions",
      "evidence_states",
      "cap_notice",
      "restricted_party_screening_notice",
      "advisory_boundary",
    ]);
  }

  private assertClosedRun(
    body: Record<string, unknown>,
    envelope: boolean,
  ): void {
    this.exactKeys(body, [
      "run_id",
      "request_id",
      "canonical_request_version",
      "state",
      "phase",
      "phase_label",
      "progress",
      "started_at",
      "updated_at",
      "limitations_notice",
      "links",
      "terminal",
      "result_available",
      "outcome",
      "scarcity",
      "poll_after_ms",
      "estimated_completion_at",
      "projection_version",
      ...(envelope ? ["schema_version", "synthetic_warning"] : []),
    ]);
    this.exactKeys(body.links, ["request", "run", "result"]);
  }

  private assertClosedCanonical(value: unknown): void {
    this.exactKeys(value, [
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
    ]);
    const canonical = value as Record<string, unknown>;
    this.exactKeys(canonical.domain_pack, [
      "registry_version",
      "pack_version",
      "category_id",
    ]);
    for (const field of canonical.fields as Record<string, unknown>[]) {
      this.exactKeys(field, [
        "field_id",
        "macro_parameter",
        "typed_value",
        "translated",
        "confidence",
      ]);
      this.exactKeys(field.typed_value, [
        "value_state",
        "value",
        "unit",
        "raw_expression",
      ]);
    }
    for (const constraint of canonical.hard_constraints as Record<
      string,
      unknown
    >[]) {
      this.exactKeys(constraint, [
        "constraint_id",
        "field_id",
        "operator",
        "target",
        "relaxability",
        "tolerance",
        "direction",
      ]);
      this.exactKeys(constraint.target, [
        "value_state",
        "value",
        "unit",
        "raw_expression",
      ]);
    }
    for (const exclusion of canonical.exclusions as Record<string, unknown>[])
      this.exactKeys(exclusion, [
        "exclusion_id",
        "field_id",
        "canonical_english_value",
      ]);
    for (const conditional of canonical.conditional_requirements as Record<
      string,
      unknown
    >[]) {
      this.exactKeys(conditional, [
        "requirement_id",
        "canonical_english_condition",
        "canonical_english_result",
        "requirement_level",
        "source_validation",
      ]);
      this.exactKeys(conditional.source_validation, [
        "algorithm",
        "key_id",
        "source_digest",
        "source_start_byte",
        "source_end_byte",
        "byte_length",
      ]);
    }
    for (const contradiction of canonical.contradictions as Record<
      string,
      unknown
    >[]) {
      this.exactKeys(contradiction, [
        "contradiction_id",
        "contradiction_class",
        "alternatives",
        "resolution_state",
        "selected_alternative_id",
      ]);
      for (const alternative of contradiction.alternatives as Record<
        string,
        unknown
      >[])
        this.exactKeys(alternative, [
          "alternative_id",
          "canonical_english_value",
          "field_ids",
        ]);
    }
  }

  private fieldDefinition(fieldId: string): DomainPackFieldV1 {
    const definition = PACK_FIELD_BY_ID.get(fieldId);
    if (!definition)
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "Structured fields are invalid.",
      );
    return definition;
  }

  private canonicalizeTypedValue(
    value: StandardHardConstraintV1["target"],
    fieldId: string,
    sourceLanguage: StandardStructuredSourceLanguage,
    role: "field" | "constraint",
    preserveRawExpression: boolean,
  ): StandardHardConstraintV1["target"] {
    if (value.value_state !== "provided") return structuredClone(value);
    const definition = this.fieldDefinition(fieldId);
    const submitted = value.value.trim();
    let canonicalEnglish: string;
    const selectedValues = submitted
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (definition.allowed_values.length > 0) {
      const valid =
        definition.kind === "multi_select"
          ? selectedValues.length > 0 &&
            selectedValues.every((item) =>
              definition.allowed_values.includes(item),
            )
          : definition.allowed_values.includes(submitted);
      if (!valid)
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "A field value is outside the server-owned domain pack.",
        );
      canonicalEnglish =
        definition.kind === "multi_select"
          ? selectedValues.join(",")
          : submitted;
    } else if (["integer", "decimal", "quantity"].includes(definition.kind)) {
      const valid =
        definition.kind === "integer"
          ? /^-?(?:0|[1-9]\d*)$/u.test(submitted)
          : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(submitted);
      if (!valid)
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "A numeric field value is invalid.",
        );
      canonicalEnglish = submitted;
    } else if (definition.kind === "boolean") {
      if (!/^(?:true|false)$/u.test(submitted))
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "A boolean field value is invalid.",
        );
      canonicalEnglish = submitted;
    } else {
      try {
        canonicalEnglish = (
          role === "constraint"
            ? canonicalizeStandardConstraintComparand(submitted, sourceLanguage)
            : canonicalizeStandardFieldValue(submitted, sourceLanguage)
        ).canonical_english;
      } catch {
        throw new ApplicationFault(
          422,
          "canonicalisation-fixture-unsupported",
          "MB-422-CANONICAL",
          "Structured canonicalisation fixture is unavailable.",
        );
      }
    }
    return {
      value_state: "provided",
      value: canonicalEnglish,
      ...(value.unit === undefined ? {} : { unit: value.unit }),
      ...(preserveRawExpression && value.raw_expression !== undefined
        ? { raw_expression: value.raw_expression }
        : {}),
    };
  }

  private validateStructuredInput(
    fields: readonly StandardFieldValueV1[],
    constraints: readonly StandardHardConstraintV1[],
    exclusions: readonly { field_id: string }[],
  ): void {
    this.validateFields(fields);
    const constraintIds = new Set<string>();
    for (const constraint of constraints) {
      const definition = this.fieldDefinition(constraint.field_id);
      if (constraintIds.has(constraint.constraint_id))
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "Constraint identifiers must be unique.",
        );
      constraintIds.add(constraint.constraint_id);
      if (
        ["minimum", "maximum"].includes(constraint.operator) &&
        !["integer", "decimal", "quantity"].includes(definition.kind)
      )
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "Constraint operator is incompatible with its field kind.",
        );
      this.validateProvidedValue(constraint.target, definition);
    }
    const exclusionIds = new Set<string>();
    for (const exclusion of exclusions) {
      this.fieldDefinition(exclusion.field_id);
      const identifier = (exclusion as { exclusion_id?: string }).exclusion_id;
      if (identifier && exclusionIds.has(identifier))
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "Exclusion identifiers must be unique.",
        );
      if (identifier) exclusionIds.add(identifier);
    }
  }

  private validateProvidedValue(
    value: StandardHardConstraintV1["target"],
    definition: DomainPackFieldV1,
  ): void {
    if (value.value_state !== "provided") return;
    if (!value.value.trim())
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "Provided field values cannot be empty.",
      );
    if (definition.allowed_units.length > 0) {
      if (!value.unit || !definition.allowed_units.includes(value.unit))
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "A quantity unit is outside the server-owned domain pack.",
        );
    } else if (value.unit !== undefined) {
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "This field does not accept a unit.",
      );
    }
    if (definition.allowed_values.length > 0) {
      const selected = value.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const valid =
        definition.kind === "multi_select"
          ? selected.length > 0 &&
            selected.every((item) => definition.allowed_values.includes(item))
          : definition.allowed_values.includes(value.value);
      if (!valid)
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "A field value is outside the server-owned domain pack.",
        );
    }
    if (
      definition.kind === "integer" &&
      !/^-?(?:0|[1-9]\d*)$/u.test(value.value)
    )
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "An integer field value is invalid.",
      );
    if (
      ["decimal", "quantity"].includes(definition.kind) &&
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value.value)
    )
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "A numeric field value is invalid.",
      );
    if (definition.kind === "boolean" && !/^(?:true|false)$/u.test(value.value))
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "A boolean field value is invalid.",
      );
  }

  private validateFields(fields: readonly StandardFieldValueV1[]): void {
    const seen = new Set<string>();
    for (const field of fields) {
      const definition = this.fieldDefinition(field.field_id);
      if (
        seen.has(field.field_id) ||
        field.macro_parameter !== definition.macro_parameter
      )
        throw new ApplicationFault(
          422,
          "schema-violation",
          "MB-422-SCHEMA",
          "Structured fields are invalid.",
        );
      seen.add(field.field_id);
      this.validateProvidedValue(field.typed_value, definition);
    }
    if (seen.size !== PACK_FIELDS.length)
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "The complete server-owned domain-pack field set is required.",
      );
  }

  private async seedPack(client: TransactionClient): Promise<void> {
    const packId = "10000000-0000-4000-8000-000000000001";
    const versionId = "10000000-0000-4000-8000-000000000002";
    await client.query(
      `INSERT INTO domain_pack(domain_pack_id,pack_key,display_name_english) VALUES($1,'synthetic_industrial_components','Synthetic Industrial Components') ON CONFLICT DO NOTHING`,
      [packId],
    );
    await client.query(
      `INSERT INTO domain_pack_version(domain_pack_version_id,domain_pack_id,version,category_code,category_confidence_threshold,definition,content_sha256,lifecycle_state,released_at) VALUES($1,$2,1,$3,0.800,$4::jsonb,$5,'active','2026-08-15T00:00:00Z') ON CONFLICT DO NOTHING`,
      [
        versionId,
        packId,
        SYNTHETIC_DOMAIN_PACK.category_id,
        JSON.stringify(SYNTHETIC_DOMAIN_PACK),
        jsonHash(SYNTHETIC_DOMAIN_PACK),
      ],
    );
    const all = [
      ...SYNTHETIC_DOMAIN_PACK.core_fields,
      ...SYNTHETIC_DOMAIN_PACK.domain_fields,
    ];
    for (const [index, field] of all.entries()) {
      const valueType =
        field.kind === "single_select"
          ? "enum"
          : field.kind === "multi_select"
            ? "string_list"
            : field.kind === "quantity"
              ? "quantity"
              : field.kind;
      await client.query(
        `INSERT INTO domain_pack_field(domain_pack_version_id,field_key,macro_parameter,canonical_order,value_type,required,definition) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
        [
          versionId,
          field.field_id.toLocaleLowerCase("en").replaceAll("-", "_"),
          field.macro_parameter,
          index + 1,
          valueType,
          field.requirement === "required",
          JSON.stringify(field),
        ],
      );
    }
  }

  private async persistVersion(
    client: TransactionClient,
    context: RequestContext,
    requestId: string,
    versionId: string,
    version: number,
    parent: string | null,
    document: StructuredStandardRequestV1,
    sourceDigest?: Buffer,
    persistContradictions = true,
    fieldSourceLanguage = document.source_language,
  ): Promise<void> {
    await client.query(
      `INSERT INTO canonical_request_version(canonical_request_version_id,request_id,account_id,version,canonical_language,canonical_document,protected_spans,match_readiness,parent_version_id,created_by_user_id) VALUES($1,$2,$3,$4,'en',$5::jsonb,'[]'::jsonb,$6,$7,$8)`,
      [
        versionId,
        requestId,
        context.accountId,
        version,
        JSON.stringify(document),
        document.readiness,
        parent,
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO canonical_language_record(canonical_request_version_id,account_id,source_language_tag,source_language_confidence,canonical_language_tag,detected_at) VALUES($1,$2,$3,1,'en',clock_timestamp())`,
      [versionId, context.accountId, document.source_language],
    );
    if (parent) {
      await client.query(
        `INSERT INTO original_text_digest(canonical_request_version_id,account_id,digest_hmac_sha256,key_id) SELECT $1,$2,digest_hmac_sha256,key_id FROM original_text_digest WHERE canonical_request_version_id=$3`,
        [versionId, context.accountId, parent],
      );
    } else {
      if (!sourceDigest)
        throw new Error(
          "Initial Standard version requires a transient source digest.",
        );
      await client.query(
        `INSERT INTO original_text_digest(canonical_request_version_id,account_id,digest_hmac_sha256,key_id) VALUES($1,$2,$3,'standard-source-v1')`,
        [versionId, context.accountId, sourceDigest],
      );
    }
    for (const field of document.fields) {
      const value = field.typed_value;
      const fieldId = randomUUID();
      await client.query(
        `INSERT INTO request_field(field_id,canonical_request_version_id,account_id,macro_parameter,field_key,value_state,canonical_value,canonical_locator,value_type,canonical_unit,canonical_raw_value,not_applicable_reason,confidence,translated) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'text',$9,$10,$11,$12,$13)`,
        [
          fieldId,
          versionId,
          context.accountId,
          field.macro_parameter,
          field.field_id,
          value.value_state,
          value.value_state === "provided" ? JSON.stringify(value.value) : null,
          `fields.${field.field_id}`,
          value.value_state === "provided" ? (value.unit ?? null) : null,
          value.value_state === "provided"
            ? (value.raw_expression ?? value.value)
            : null,
          value.value_state === "not_applicable"
            ? "Marked not applicable by request owner."
            : null,
          field.confidence,
          field.translated,
        ],
      );
      await client.query(
        `INSERT INTO canonical_field_provenance(field_id,account_id,origin,source_language_tag,recorded_at) VALUES($1,$2,$3,$4,clock_timestamp())`,
        [
          fieldId,
          context.accountId,
          field.translated
            ? "translated"
            : parent
              ? "user_corrected"
              : "entered_english",
          fieldSourceLanguage,
        ],
      );
    }
    for (const constraint of document.hard_constraints) {
      await client.query(
        `INSERT INTO constraint_item(constraint_id,canonical_request_version_id,account_id,constraint_kind,subject_field_key,operator,canonical_comparand,requirement_level,canonical_source_locator,relaxable,relaxation_direction,relaxation_tolerance,relaxation_unit) VALUES($1,$2,$3,'hard_constraint',$4,$5,$6::jsonb,'mandatory',$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          versionId,
          context.accountId,
          constraint.field_id,
          constraint.operator,
          JSON.stringify(constraint.target),
          `hard_constraints.${constraint.constraint_id}`,
          constraint.relaxability === "relaxable",
          constraint.relaxability === "relaxable"
            ? constraint.direction === "higher_is_acceptable"
              ? "increase"
              : constraint.direction === "lower_is_acceptable"
                ? "decrease"
                : "exact_alternative"
            : null,
          constraint.relaxability === "relaxable"
            ? Number(constraint.tolerance)
            : null,
          constraint.relaxability === "relaxable" &&
          constraint.target.value_state === "provided"
            ? (constraint.target.unit ?? null)
            : null,
        ],
      );
    }
    for (const exclusion of document.exclusions)
      await client.query(
        `INSERT INTO constraint_item(constraint_id,canonical_request_version_id,account_id,constraint_kind,subject_field_key,operator,canonical_comparand,requirement_level,canonical_source_locator,relaxable) VALUES($1,$2,$3,'exclusion',$4,'excludes',$5::jsonb,'mandatory',$6,false)`,
        [
          randomUUID(),
          versionId,
          context.accountId,
          exclusion.field_id,
          JSON.stringify(exclusion.canonical_english_value),
          `exclusions.${exclusion.exclusion_id}`,
        ],
      );
    for (const contradiction of persistContradictions
      ? document.contradictions.filter(
          (item) => item.resolution_state === "unresolved",
        )
      : []) {
      const [left, right] = contradiction.alternatives;
      await client.query(
        `INSERT INTO canonical_contradiction(contradiction_id,canonical_request_version_id,account_id,blocking,alternatives,contradiction_class,left_canonical_value,left_canonical_locator,right_canonical_value,right_canonical_locator) VALUES($1,$2,$3,true,$4::jsonb,$5,$6::jsonb,$7,$8::jsonb,$9)`,
        [
          contradiction.contradiction_id,
          versionId,
          context.accountId,
          JSON.stringify(contradiction.alternatives),
          contradiction.contradiction_class,
          JSON.stringify(left?.canonical_english_value ?? null),
          `contradictions.${contradiction.contradiction_id}.alternatives.0`,
          JSON.stringify(right?.canonical_english_value ?? null),
          `contradictions.${contradiction.contradiction_id}.alternatives.1`,
        ],
      );
    }
  }

  private async assertRequestOwner(
    context: RequestContext,
    requestId: string,
  ): Promise<void> {
    const result = await this.pool.query(
      "SELECT 1 FROM sourcing_request WHERE request_id=$1 AND account_id=$2 AND created_by_user_id=$3",
      [requestId, context.accountId, context.userId],
    );
    if (result.rowCount !== 1) throw standardNotVisible();
  }

  private async cancelRunTransaction(
    client: TransactionClient,
    context: RequestContext,
    runId: string,
  ): Promise<Record<string, unknown>> {
    const run = await client.query<{
      state: string;
      terminal_failure: boolean;
    }>(
      `SELECT r.state,
              (r.state='failed_retryable' AND EXISTS (
                SELECT 1 FROM live_research_terminal t
                 WHERE t.account_id=r.account_id AND t.run_id=r.run_id
              )) AS terminal_failure
         FROM research_run r
        WHERE r.run_id=$1 AND r.account_id=$2 AND r.requested_by_user_id=$3
        FOR UPDATE`,
      [runId, context.accountId, context.userId],
    );
    const state = run.rows[0]?.terminal_failure ? "failed" : run.rows[0]?.state;
    if (!state) throw standardNotVisible();
    if (state === "cancelled")
      return {
        run_id: runId,
        state,
        cancellation_accepted: true,
        idempotent_replay: true,
      };
    if (TERMINAL_RUN_STATES.has(state))
      return {
        run_id: runId,
        state: this.publicState(state),
        cancellation_accepted: false,
        idempotent_replay: false,
      };
    await client.query(
      "UPDATE research_run SET state='cancelled',state_reason='user_cancelled',cancelled_at=clock_timestamp() WHERE run_id=$1",
      [runId],
    );
    await appendAuditEvent(
      client,
      this.audit(context, "run.cancelled", "research_run", runId, "allow", {
        priorState: state,
      }),
    );
    return {
      run_id: runId,
      state: "cancelled",
      cancellation_accepted: true,
      idempotent_replay: false,
    };
  }

  private async configuration(): Promise<{ model: string; scoring: string }> {
    const result = await this.pool.query<{ model: string; scoring: string }>(
      `SELECT (SELECT model_policy_version_id FROM model_policy_version ORDER BY version DESC LIMIT 1) AS model,(SELECT scoring_config_version_id FROM scoring_config_version ORDER BY version DESC LIMIT 1) AS scoring`,
    );
    const row = result.rows[0];
    if (!row?.model || !row.scoring)
      throw new ApplicationFault(
        503,
        "dependency-unavailable",
        "MB-503-CONFIG",
        "Required configuration is unavailable.",
        true,
      );
    return row;
  }

  private runProjection(
    row: {
      run_id: string;
      request_id: string;
      version: number;
      state: string;
      queued_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
      eligible_count?: number | null;
      tier_at_submission?: "demo" | "standard" | "consultant";
      research_mode?: "synthetic_reference" | "qualified_live_research";
    },
    envelope: boolean,
    productTier: "standard" | "consultant",
  ): Record<string, unknown> {
    const terminal = TERMINAL_RUN_STATES.has(row.state);
    const resultExists = ["complete", "no_responsible_match"].includes(
      row.state,
    );
    const resultAvailable =
      resultExists &&
      (row.tier_at_submission !== "consultant" || productTier === "consultant");
    const qualifiedLive = row.research_mode === "qualified_live_research";
    const modeNotice = qualifiedLive
      ? QUALIFIED_LIVE_NOTICE
      : STANDARD_SYNTHETIC_WARNING;
    const publicState = this.publicState(row.state);
    const scarcity =
      row.state === "no_responsible_match" || row.eligible_count === 0
        ? "zero"
        : resultAvailable
          ? row.eligible_count !== null &&
            row.eligible_count !== undefined &&
            row.eligible_count < 3
            ? "limited"
            : "none"
          : terminal
            ? "not_applicable"
            : "pending";
    return {
      ...(envelope ? { schema_version: "standard-run-projection.v1" } : {}),
      run_id: row.run_id,
      request_id: row.request_id,
      canonical_request_version: row.version,
      state: publicState,
      phase: terminal
        ? "complete"
        : row.state === "queued"
          ? "queued"
          : "research",
      phase_label: terminal
        ? "Processing finished"
        : row.state === "queued"
          ? "Queued for execution"
          : qualifiedLive
            ? "Researching qualified external evidence"
            : "Evaluating repository fixtures",
      progress: terminal ? 100 : row.state === "queued" ? 0 : 50,
      started_at: iso(row.started_at ?? row.queued_at),
      updated_at: iso(row.completed_at ?? row.started_at ?? row.queued_at),
      limitations_notice: modeNotice,
      links: {
        request: `/api/v1/requests/${row.request_id}`,
        run: `/api/v1/runs/${row.run_id}`,
        ...(resultAvailable && row.tier_at_submission !== "consultant"
          ? { result: `/api/v1/runs/${row.run_id}/result` }
          : {}),
      },
      terminal,
      result_available: resultAvailable,
      outcome: this.publicOutcome(row.state),
      scarcity,
      ...(!terminal
        ? { poll_after_ms: row.state === "queued" ? 10_000 : 2_000 }
        : {}),
      ...(envelope ? { synthetic_warning: modeNotice } : {}),
      projection_version: STANDARD_PROJECTION_VERSION,
    };
  }

  private publicState(state: string | null): string {
    if (!state) return "not_started";
    if (state === "complete" || state === "no_responsible_match")
      return "completed";
    if (
      [
        "researching",
        "scoring",
        "escalated",
        "restricted",
        "cancelling",
        "failed_retryable",
      ].includes(state)
    )
      return "running";
    return state;
  }

  private publicOutcome(state: string | null): string {
    if (!state) return "not_started";
    if (state === "complete") return "matched";
    if (state === "no_responsible_match") return "no_responsible_match";
    if (["failed", "cancelled", "superseded"].includes(state)) return state;
    return "pending";
  }

  private sealCursor(
    context: RequestContext,
    kind: CursorPayload["kind"],
    query: string,
    lastAt: string,
    lastId: string,
  ): string {
    const encoded = Buffer.from(
      JSON.stringify({
        kind,
        account_id: context.accountId,
        user_id: context.userId,
        query,
        order: "created_desc_id_desc",
        projection: STANDARD_PROJECTION_VERSION,
        last_at: lastAt,
        last_id: lastId,
      } satisfies CursorPayload),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.secret).update(encoded).digest("base64url")}`;
  }

  private openCursor(
    context: RequestContext,
    cursor: string,
    kind: CursorPayload["kind"],
    query: string,
  ): CursorPayload {
    try {
      const [encoded, signature, extra] = cursor.split(".");
      if (!encoded || !signature || extra) throw new Error();
      const expected = createHmac("sha256", this.secret)
        .update(encoded)
        .digest();
      const supplied = Buffer.from(signature, "base64url");
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        throw new Error();
      const value = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as CursorPayload;
      if (
        value.kind !== kind ||
        value.account_id !== context.accountId ||
        value.user_id !== context.userId ||
        value.query !== query ||
        value.order !== "created_desc_id_desc" ||
        value.projection !== STANDARD_PROJECTION_VERSION ||
        !value.last_at ||
        !value.last_id ||
        Number.isNaN(Date.parse(value.last_at))
      )
        throw new Error();
      return value;
    } catch {
      throw new ApplicationFault(
        400,
        "invalid-cursor",
        "MB-400-CURSOR",
        "Invalid cursor.",
      );
    }
  }

  private async recordProjection(
    context: RequestContext,
    resourceKind: string,
    resourceId: string,
    requestId: string | undefined,
    runId: string | undefined,
    fields: string[],
    count: number,
    notModified = false,
    projectionAsOf?: string,
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const release = standardDisclosureProjectionRegistryRelease();
      const serializedDefinition = release.definition;
      const definitionHash = release.contentSha256;
      await client.query(
        `INSERT INTO projection_version(projection_version_id,version,definition,content_sha256,released_at) VALUES($1,$2,$3::jsonb,$4,clock_timestamp()) ON CONFLICT(version) DO NOTHING`,
        [
          randomUUID(),
          STANDARD_PROJECTION_VERSION,
          serializedDefinition,
          definitionHash,
        ],
      );
      const version = await client.query<{
        projection_version_id: string;
        definition: unknown;
        content_sha256: Buffer;
      }>(
        "SELECT projection_version_id,definition,content_sha256 FROM projection_version WHERE version=$1",
        [STANDARD_PROJECTION_VERSION],
      );
      const registry = version.rows[0];
      if (
        !registry ||
        stableJson(registry.definition) !== serializedDefinition ||
        !registry.content_sha256.equals(definitionHash)
      )
        throw new Error(
          "Standard disclosure projection registry is stale or ambiguous.",
        );
      const projectionVersionId = registry.projection_version_id;
      if (requestId || runId)
        await client.query(
          `INSERT INTO projection_serving(projection_serving_id,account_id,subject_user_id,tier,resource_kind,resource_id,projection_version_id,fields_released,item_count,request_correlation_id,request_id,run_id) VALUES($1,$2,$3,'standard',$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            randomUUID(),
            context.accountId,
            context.userId,
            resourceKind,
            resourceId,
            projectionVersionId,
            fields,
            count,
            context.correlationId,
            requestId ?? null,
            runId ?? null,
          ],
        );
      await appendAuditEvent(client, {
        ...this.audit(
          context,
          "projection.served",
          resourceKind,
          resourceId,
          "allow",
          {
            projectionVersion: STANDARD_PROJECTION_VERSION,
            itemCount: count,
            notModified,
            bodyReleased: !notModified,
            ...(projectionAsOf === undefined ? {} : { projectionAsOf }),
          },
        ),
        projectionVersionId,
        fieldsReleased: fields,
      });
    });
  }

  private async readIdempotency(
    client: TransactionClient | ConnectionPool,
    context: RequestContext,
    route: string,
    keyHash: Buffer,
    requestHash: Buffer,
  ): Promise<Record<string, unknown> | null> {
    const result = await client.query<{
      request_hash: Buffer;
      response_body: Record<string, unknown>;
    }>(
      `SELECT request_hash,response_body FROM idempotency_record WHERE account_id=$1 AND subject_user_id=$2 AND route=$3 AND key_hash=$4 AND expires_at>clock_timestamp()`,
      [context.accountId, context.userId, route, keyHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!row.request_hash.equals(requestHash))
      throw new ApplicationFault(
        409,
        "idempotency-conflict",
        "MB-409-IDEMPOTENCY",
        "Idempotency key was reused with different input.",
      );
    return row.response_body;
  }

  private async writeIdempotency(
    client: TransactionClient,
    context: RequestContext,
    route: string,
    keyHash: Buffer,
    requestHash: Buffer,
    body: Record<string, unknown>,
    status: number,
  ): Promise<void> {
    const resourceId =
      typeof body.canonical_version_id === "string"
        ? body.canonical_version_id
        : typeof body.request_id === "string"
          ? body.request_id
          : null;
    await client.query(
      `INSERT INTO idempotency_record
        (idempotency_record_id,account_id,subject_user_id,route,key_hash,request_hash,response_status,response_body,result_resource_id,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,clock_timestamp(),clock_timestamp()+interval '24 hours')`,
      [
        randomUUID(),
        context.accountId,
        context.userId,
        route,
        keyHash,
        requestHash,
        status,
        JSON.stringify(body),
        resourceId,
      ],
    );
  }

  private audit(
    context: RequestContext,
    eventType: string,
    resourceKind: string,
    resourceId: string | undefined,
    outcome: "allow" | "deny" | "error",
    detail: Record<string, unknown>,
  ) {
    return {
      accountId: context.accountId,
      actorUserId: context.userId,
      actorTier: context.tier,
      eventType,
      resourceKind,
      ...(resourceId ? { resourceId } : {}),
      outcome,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
      detail,
    } as const;
  }
}
