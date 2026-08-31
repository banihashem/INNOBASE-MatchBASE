import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type {
  CanonicalFieldV1,
  CanonicalRequestV1,
  OriginalTextDigestV1,
  ProtectedSpanV1,
} from "@matchbase/contracts";
import type {
  CanonicalizationCapability,
  CanonicalizationInput,
  CapabilityInvocationOutcome,
  CapabilityInvocationTelemetry,
  CapabilityTelemetrySink,
} from "../capabilities.js";
import {
  extractPersistableProtectedSpans,
  validateProtectedSpans,
} from "./protected-spans.js";

const MODEL_ID = "gemini-3.6-flash";
const ROUTE_ID = "RT-GEMINI-DIRECT-CANONICALIZE-V1";
const PROMPT_VERSION = "canonicalization.gemini-direct.v1";
const CONFIG_VERSION = "canonicalization.gemini-direct.2026-08-30.v1";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_CANONICAL_TEXT_BYTES = 32 * 1024;

const FIELD_DEFINITIONS = Object.freeze([
  Object.freeze({ fieldId: "need", path: "product.need" }),
  Object.freeze({
    fieldId: "mandatory_constraints",
    path: "product.mandatory_constraints",
  }),
  Object.freeze({
    fieldId: "preferences_context",
    path: "commercial.preferences_context",
  }),
] as const);

const RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "canonical_text",
    "source_language_bcp47",
    "source_language_confidence",
    "fields",
  ],
  properties: {
    canonical_text: { type: "string", minLength: 1, maxLength: 16_000 },
    source_language_bcp47: { type: "string", minLength: 2, maxLength: 35 },
    source_language_confidence: { type: "number", minimum: 0, maximum: 1 },
    fields: {
      type: "object",
      additionalProperties: false,
      required: ["need", "mandatory_constraints", "preferences_context"],
      properties: {
        need: { type: "string", minLength: 1, maxLength: 4_000 },
        mandatory_constraints: {
          type: "string",
          minLength: 1,
          maxLength: 4_000,
        },
        preferences_context: {
          type: "string",
          minLength: 1,
          maxLength: 4_000,
        },
      },
    },
  },
});

type RuntimeEnvironment = "local" | "test" | "staging" | "production";

export interface GeminiDirectCanonicalizerOptions {
  apiKey: string;
  digestKey: Uint8Array;
  digestKeyId: string;
  environment: RuntimeEnvironment;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

type ClosedResult = Readonly<{
  canonical_text: string;
  source_language_bcp47: string;
  source_language_confidence: number;
  fields: Readonly<{
    need: string;
    mandatory_constraints: string;
    preferences_context: string;
  }>;
}>;

function exactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expected].sort())
  )
    throw new Error(`${label} is not closed.`);
}

function normalized(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function originalTextDigest(
  sourceText: string,
  key: Uint8Array,
  keyId: string,
): OriginalTextDigestV1 {
  const keyed = (value: string) =>
    createHmac("sha256", key).update(value, "utf8").digest("hex");
  return {
    algorithm: "HMAC-SHA-256",
    keyId,
    rawDigest: keyed(sourceText),
    normalizedDigest: keyed(normalized(sourceText)),
    byteLength: Buffer.byteLength(sourceText, "utf8"),
  };
}

function assertFormalEnglish(value: string, label: string): string {
  const candidate = normalized(value);
  if (
    !candidate ||
    Buffer.byteLength(candidate, "utf8") > MAX_CANONICAL_TEXT_BYTES ||
    !/[A-Za-z]/u.test(candidate) ||
    [...candidate].some(
      (character) =>
        /\p{Letter}/u.test(character) && !/\p{Script=Latin}/u.test(character),
    )
  )
    throw new Error(`${label} must be bounded formal English.`);
  return candidate;
}

function maskProtectedSpans(
  sourceText: string,
  spans: readonly ProtectedSpanV1[],
): string {
  const values = new Set<string>();
  let masked = sourceText;
  for (const span of spans) {
    if (values.has(span.canonicalValue))
      throw new Error("Repeated protected values are ambiguous.");
    values.add(span.canonicalValue);
    masked = masked.replace(span.canonicalValue, span.placeholder);
  }
  return masked;
}

function restoreProtectedSpans(
  value: string,
  spans: readonly ProtectedSpanV1[],
  requireEverySpan: boolean,
): string {
  let restored = value;
  for (const span of spans) {
    const occurrences = restored.split(span.placeholder).length - 1;
    if ((requireEverySpan && occurrences !== 1) || occurrences > 1)
      throw new Error("Canonicalization did not preserve protected spans.");
    restored = restored.replace(span.placeholder, span.canonicalValue);
  }
  if (/PS-\d{4}/u.test(restored))
    throw new Error("Canonicalization returned an unknown protected span.");
  return restored;
}

function fieldStates(
  input: CanonicalizationInput,
): ReadonlyMap<string, CanonicalFieldV1["valueState"]> {
  const allowedFields = new Set(
    FIELD_DEFINITIONS.map(({ fieldId }) => fieldId as string),
  );
  if (
    input.presentedFields.length !== FIELD_DEFINITIONS.length ||
    new Set(input.presentedFields).size !== FIELD_DEFINITIONS.length ||
    input.presentedFields.some((fieldId) => !allowedFields.has(fieldId)) ||
    input.fixtureCanonicalFields.length !== FIELD_DEFINITIONS.length ||
    new Set(input.fixtureCanonicalFields.map(({ fieldId }) => fieldId)).size !==
      FIELD_DEFINITIONS.length ||
    input.fixtureCanonicalFields.some(
      ({ fieldId }) => !allowedFields.has(fieldId),
    )
  )
    throw new Error("Canonicalization field presentation is invalid.");
  const states = new Map<string, CanonicalFieldV1["valueState"]>();
  for (const definition of FIELD_DEFINITIONS) {
    const source = input.fixtureCanonicalFields.find(
      ({ fieldId }) => fieldId === definition.fieldId,
    );
    if (
      !source ||
      source.path !== definition.path ||
      !["provided", "explicitly_unknown", "not_asked"].includes(
        source.valueState,
      )
    )
      throw new Error("Canonicalization field state is invalid.");
    states.set(definition.fieldId, source.valueState);
  }
  return states;
}

async function boundedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("Gemini returned no response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new Error("Gemini response exceeded its byte bound.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Gemini response envelope is invalid.");
  return parsed as Record<string, unknown>;
}

function parseClosedResult(value: unknown): ClosedResult {
  exactKeys(
    value,
    [
      "canonical_text",
      "source_language_bcp47",
      "source_language_confidence",
      "fields",
    ],
    "Gemini canonicalization result",
  );
  exactKeys(
    value.fields,
    ["need", "mandatory_constraints", "preferences_context"],
    "Gemini canonical fields",
  );
  if (
    typeof value.canonical_text !== "string" ||
    typeof value.source_language_bcp47 !== "string" ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(
      value.source_language_bcp47,
    ) ||
    typeof value.source_language_confidence !== "number" ||
    !Number.isFinite(value.source_language_confidence) ||
    value.source_language_confidence < 0 ||
    value.source_language_confidence > 1 ||
    typeof value.fields.need !== "string" ||
    typeof value.fields.mandatory_constraints !== "string" ||
    typeof value.fields.preferences_context !== "string"
  )
    throw new Error("Gemini canonicalization result failed validation.");
  return value as unknown as ClosedResult;
}

function telemetryEvent(input: {
  attemptId: string;
  environment: RuntimeEnvironment;
  startedAt: string;
  completedAt: string;
  outcome: CapabilityInvocationOutcome;
  tokenQuantity: number;
}): CapabilityInvocationTelemetry {
  return {
    attemptId: input.attemptId,
    capabilityId: "CAP-TRANSLATE",
    providerId: "gemini_direct",
    routeId: ROUTE_ID,
    modelId: MODEL_ID,
    environment: input.environment,
    routeKind: "real_data",
    dataHandlingPosture: "paid_no_training",
    timeoutMs: 20_000,
    configuredMaxAttempts: 1,
    configuredBackoffMs: 0,
    allowFallbacks: false,
    attemptNumber: 1,
    fallback: false,
    retryBackoffMs: 0,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    outcome: input.outcome,
    quantity: input.tokenQuantity,
    unit: "tokens",
    amount: "unknown",
    currency: "USD",
    pricingBasis: "provider_usage_unpriced",
    pricingVersion: "gemini-3.6-canonicalization.2026-08-30",
    pricingState: "unpriced",
    measurement: "measured",
  };
}

export class GeminiDirectCanonicalizer implements CanonicalizationCapability {
  readonly capabilityId = "CAP-TRANSLATE" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: GeminiDirectCanonicalizerOptions) {
    if (!options.apiKey.trim()) throw new Error("Gemini API key is required.");
    if (options.digestKey.byteLength < 32)
      throw new Error("Digest key must contain at least 32 bytes.");
    if (!options.digestKeyId.trim())
      throw new Error("Digest key identifier is required.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async canonicalize(
    input: CanonicalizationInput,
    signal: AbortSignal,
    telemetry: CapabilityTelemetrySink,
  ): Promise<CanonicalRequestV1> {
    const attemptId = randomUUID();
    const startedAt = this.now().toISOString();
    let recorded = false;
    let outcome: CapabilityInvocationOutcome = "provider_error";
    let tokenQuantity = 0;
    try {
      if (signal.aborted) {
        outcome = "cancelled";
        throw new Error("Canonicalization was cancelled.");
      }
      const states = fieldStates(input);
      const protectedSpans = extractPersistableProtectedSpans(input.sourceText);
      const maskedSource = maskProtectedSpans(input.sourceText, protectedSpans);
      const prompt = JSON.stringify({
        instruction:
          "Rewrite the source as concise formal English for a sourcing request. The source paragraphs correspond in order to need, mandatory_constraints, and preferences_context when present. Preserve every PS-NNNN token exactly once in canonical_text. Do not invent facts. Return only the schema response.",
        field_order: FIELD_DEFINITIONS.map(({ fieldId }) => fieldId),
        field_states: Object.fromEntries(states),
        source: maskedSource,
      });
      const response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`,
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.options.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: RESPONSE_SCHEMA,
              maxOutputTokens: 4096,
              temperature: 0,
            },
          }),
        },
      );
      if (!response.ok) throw new Error("Gemini canonicalization failed.");
      const envelope = await boundedJson(response);
      if (envelope.modelVersion !== MODEL_ID)
        throw new Error("Gemini served an unapproved model identity.");
      const candidates = envelope.candidates;
      if (!Array.isArray(candidates) || candidates.length !== 1)
        throw new Error("Gemini returned an invalid candidate count.");
      const candidate = candidates[0] as Record<string, unknown>;
      if (candidate?.finishReason !== "STOP") {
        outcome = "refusal";
        throw new Error("Gemini did not complete canonicalization.");
      }
      const parts = (candidate?.content as Record<string, unknown> | undefined)
        ?.parts;
      if (!Array.isArray(parts) || parts.length !== 1)
        throw new Error("Gemini returned invalid canonicalization content.");
      const text = (parts[0] as Record<string, unknown> | undefined)?.text;
      if (typeof text !== "string" || Buffer.byteLength(text) > 64 * 1024)
        throw new Error("Gemini returned invalid canonicalization content.");
      let parsed: ClosedResult;
      try {
        parsed = parseClosedResult(JSON.parse(text));
      } catch {
        outcome = "schema_violation";
        throw new Error("Gemini returned a schema-invalid canonicalization.");
      }
      const restoredCanonical = restoreProtectedSpans(
        parsed.canonical_text,
        protectedSpans,
        true,
      );
      const canonicalText = assertFormalEnglish(
        restoredCanonical,
        "Canonical text",
      );
      validateProtectedSpans(canonicalText, protectedSpans);
      if (normalized(canonicalText) === normalized(input.sourceText))
        throw new Error("Canonicalization returned untransformed source text.");
      const languageIsEnglish = /^en(?:-|$)/iu.test(
        parsed.source_language_bcp47,
      );
      const fields = FIELD_DEFINITIONS.map((definition) => {
        const state = states.get(definition.fieldId)!;
        const providerValue = parsed.fields[definition.fieldId];
        const canonicalValue =
          state === "explicitly_unknown" || state === "not_asked"
            ? "Unknown"
            : assertFormalEnglish(
                restoreProtectedSpans(providerValue, protectedSpans, false),
                `Canonical field ${definition.fieldId}`,
              );
        return {
          fieldId: definition.fieldId,
          path: definition.path,
          valueState: state,
          languageOrigin:
            state === "provided"
              ? languageIsEnglish
                ? "entered_in_english"
                : "translated"
              : "derived_deterministic",
          canonicalValue,
        } satisfies CanonicalFieldV1;
      });
      const usage = envelope.usageMetadata as Record<string, unknown>;
      const inputTokens = usage?.promptTokenCount;
      const outputTokens = usage?.candidatesTokenCount;
      if (
        !Number.isSafeInteger(inputTokens) ||
        Number(inputTokens) < 0 ||
        !Number.isSafeInteger(outputTokens) ||
        Number(outputTokens) < 0
      )
        throw new Error("Gemini usage metadata is invalid.");
      tokenQuantity = Number(inputTokens) + Number(outputTokens);
      const digest = originalTextDigest(
        input.sourceText,
        this.options.digestKey,
        this.options.digestKeyId,
      );
      const completedAt = this.now().toISOString();
      const successful = telemetryEvent({
        attemptId,
        environment: this.options.environment,
        startedAt,
        completedAt,
        outcome: "ok",
        tokenQuantity,
      });
      recorded = true;
      await telemetry.record(successful);
      return {
        schemaVersion: "canonical-request.v1",
        requestId: input.requestId,
        canonicalVersionId: `CAN-${createHash("sha256")
          .update(`${input.requestId}:${digest.rawDigest}:${canonicalText}`)
          .digest("hex")
          .slice(0, 24)}`,
        version: 1,
        canonicalLanguage: "en",
        canonicalText,
        language: {
          bcp47: parsed.source_language_bcp47,
          confidence: parsed.source_language_confidence,
          detectorId: "gemini-direct",
          detectorVersion: MODEL_ID,
        },
        fields,
        protectedSpans,
        provenance: [
          {
            attemptId,
            capabilityId: "CAP-TRANSLATE",
            providerId: "gemini_direct",
            routeId: ROUTE_ID,
            modelId: MODEL_ID,
            promptVersion: PROMPT_VERSION,
            configVersion: CONFIG_VERSION,
            retentionPosture: "no_training_30d_logs",
            startedAt,
            completedAt,
            outcome: "ok",
          },
        ],
        originalTextDigest: digest,
        readiness: "ready",
        contradictionIds: [],
      };
    } catch (error) {
      if (!recorded) {
        if (signal.aborted) outcome = "timeout";
        recorded = true;
        await telemetry.record(
          telemetryEvent({
            attemptId,
            environment: this.options.environment,
            startedAt,
            completedAt: this.now().toISOString(),
            outcome,
            tokenQuantity,
          }),
        );
      }
      throw error;
    }
  }
}
