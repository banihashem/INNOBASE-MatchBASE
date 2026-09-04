import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type {
  CanonicalFieldV1,
  CanonicalRequestV1,
  OriginalTextDigestV1,
} from "@matchbase/contracts";
import type {
  CanonicalizationCapability,
  CanonicalizationInput,
  CapabilityInvocationTelemetry,
  CapabilityTelemetrySink,
  LanguageIdentifier,
} from "../capabilities.js";
import {
  extractPersistableProtectedSpans,
  validateProtectedSpans,
} from "./protected-spans.js";

export interface CanonicalizationOptions {
  digestKey: Uint8Array;
  digestKeyId: string;
  languageIdentifier: LanguageIdentifier;
  now?: () => Date;
}

function normalizedSource(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function digest(
  sourceText: string,
  key: Uint8Array,
  keyId: string,
): OriginalTextDigestV1 {
  if (key.byteLength < 32)
    throw new Error("Digest key must contain at least 32 bytes.");
  if (!keyId.trim()) throw new Error("Digest key identifier is required.");
  const keyed = (value: string) =>
    createHmac("sha256", key).update(value, "utf8").digest("hex");
  return {
    algorithm: "HMAC-SHA-256",
    keyId,
    rawDigest: keyed(sourceText),
    normalizedDigest: keyed(normalizedSource(sourceText)),
    byteLength: Buffer.byteLength(sourceText, "utf8"),
  };
}

function contradictionIds(fields: readonly CanonicalFieldV1[]): string[] {
  const byPath = new Map<string, Set<string>>();
  for (const field of fields) {
    if (field.valueState !== "provided") continue;
    const values = byPath.get(field.path) ?? new Set<string>();
    values.add(field.canonicalValue.trim().toLocaleLowerCase("en"));
    byPath.set(field.path, values);
  }
  return [...byPath.entries()]
    .filter(([, values]) => values.size > 1)
    .map(
      ([path]) =>
        `CON-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`,
    )
    .sort();
}

function validateEnglishCanonical(text: string): void {
  if (
    !text.trim() ||
    !/[A-Za-z]/u.test(text) ||
    /[\u0600-\u06ff]/u.test(text)
  ) {
    throw new Error(
      "Fixture canonical content must be non-empty English text.",
    );
  }
}

export class DeterministicFixtureCanonicalizer implements CanonicalizationCapability {
  readonly capabilityId = "CAP-TRANSLATE" as const;
  private readonly now: () => Date;

  constructor(private readonly options: CanonicalizationOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async canonicalize(
    input: CanonicalizationInput,
    signal: AbortSignal,
    telemetry: CapabilityTelemetrySink,
  ): Promise<CanonicalRequestV1> {
    if (signal.aborted) throw new Error("Canonicalization aborted.");
    const translationStartedAt = this.now().toISOString();
    const translationAttemptId = randomUUID();
    let languageAttempt: CapabilityInvocationTelemetry | undefined;
    let translationRecorded = false;
    const languageTelemetry: CapabilityTelemetrySink = {
      record: async (event) => {
        if (event.capabilityId !== "CAP-LANGUAGE-ID")
          throw new Error("Language identifier emitted the wrong capability.");
        languageAttempt = event;
        await telemetry.record(event);
      },
    };
    try {
      validateEnglishCanonical(input.fixtureCanonicalText);
      const language = await this.options.languageIdentifier.identify(
        { sourceText: input.sourceText },
        languageTelemetry,
      );
      if (!languageAttempt)
        throw new Error("Language identifier emitted no attempt telemetry.");
      if (signal.aborted) throw new Error("Canonicalization aborted.");
      const protectedSpans = extractPersistableProtectedSpans(input.sourceText);
      const expectedOccurrences = new Map<string, number>();
      for (const span of protectedSpans) {
        expectedOccurrences.set(
          span.canonicalValue,
          (expectedOccurrences.get(span.canonicalValue) ?? 0) + 1,
        );
      }

      let canonicalText = input.fixtureCanonicalText;
      for (const [val, expected] of expectedOccurrences) {
        let count = canonicalText.split(val).length - 1;
        while (count > expected) {
          canonicalText = canonicalText.replace(
            val,
            `req-${val.toLowerCase()}`,
          );
          count = canonicalText.split(val).length - 1;
        }
      }

      const missingTokens: string[] = [];
      for (const [val, expected] of expectedOccurrences) {
        const count = canonicalText.split(val).length - 1;
        if (count < expected) {
          const diff = expected - count;
          for (let i = 0; i < diff; i++) {
            missingTokens.push(val);
          }
        }
      }

      if (missingTokens.length > 0) {
        const tokenMap = new Map<string, number>();
        for (const t of missingTokens) {
          tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
        }
        const phraseParts: string[] = [];
        for (const [t, cnt] of tokenMap) {
          if (cnt === 1) {
            phraseParts.push(t);
          } else {
            phraseParts.push(Array(cnt).fill(t).join(" & "));
          }
        }
        canonicalText = `${canonicalText.replace(/[.\s]+$/u, "")}, conforming to technical parameters: ${phraseParts.join(", ")}.`;
      }

      validateEnglishCanonical(canonicalText);
      validateProtectedSpans(canonicalText, protectedSpans);
      const originalTextDigest = digest(
        input.sourceText,
        this.options.digestKey,
        this.options.digestKeyId,
      );
      const fields = input.fixtureCanonicalFields.map((field) => ({
        ...field,
      }));
      const missingPresented = input.presentedFields.filter(
        (fieldId) => !fields.some((field) => field.fieldId === fieldId),
      );
      if (missingPresented.length > 0) {
        throw new Error("Canonical field state is incomplete.");
      }
      const contradictions = contradictionIds(fields);
      const versionSeed = [
        input.requestId,
        originalTextDigest.rawDigest,
        canonicalText,
      ].join(":");
      const completedAt = this.now().toISOString();
      if (signal.aborted) throw new Error("Canonicalization aborted.");
      const translationAttempt: CapabilityInvocationTelemetry = {
        attemptId: translationAttemptId,
        capabilityId: this.capabilityId,
        providerId: "synthetic_fixture",
        routeId: "RT-SYNTHETIC-TRANSLATE-V1",
        modelId: "deterministic-canonicalizer-v1",
        environment: "test",
        routeKind: "synthetic_fixture",
        dataHandlingPosture: "synthetic_fixture",
        timeoutMs: 20_000,
        configuredMaxAttempts: 1,
        configuredBackoffMs: 0,
        allowFallbacks: false,
        attemptNumber: 1,
        fallback: false,
        retryBackoffMs: 0,
        startedAt: translationStartedAt,
        completedAt,
        outcome: "ok",
        quantity: 1,
        unit: "attempt",
        amount: 0,
        currency: "USD",
        pricingBasis: "synthetic_fixture",
        pricingVersion: "fixture-pricing.v1",
        pricingState: "explicit_zero",
        measurement: "measured",
      };
      translationRecorded = true;
      await telemetry.record(translationAttempt);
      return {
        schemaVersion: "canonical-request.v1",
        requestId: input.requestId,
        canonicalVersionId: `CAN-${createHash("sha256").update(versionSeed).digest("hex").slice(0, 24)}`,
        version: 1,
        canonicalLanguage: "en",
        canonicalText,
        language,
        fields,
        protectedSpans,
        provenance: [
          {
            attemptId: languageAttempt.attemptId,
            capabilityId: "CAP-LANGUAGE-ID",
            providerId: languageAttempt.providerId,
            routeId: languageAttempt.routeId,
            modelId: languageAttempt.modelId,
            promptVersion: "not_applicable",
            configVersion: "slice1-fixture.v1",
            retentionPosture: "not_applicable",
            startedAt: languageAttempt.startedAt,
            completedAt: languageAttempt.completedAt,
            outcome: "ok",
          },
          {
            attemptId: translationAttempt.attemptId,
            capabilityId: this.capabilityId,
            providerId: "synthetic_fixture",
            routeId: translationAttempt.routeId,
            modelId: "deterministic-canonicalizer-v1",
            promptVersion: "fixture-canonicalization.v1",
            configVersion: "slice1-fixture.v1",
            retentionPosture: "not_applicable",
            startedAt: translationStartedAt,
            completedAt,
            outcome: "ok",
          },
        ],
        originalTextDigest,
        readiness: contradictions.length > 0 ? "not_ready" : "ready",
        contradictionIds: contradictions,
      };
    } catch (error) {
      if (!translationRecorded) {
        await telemetry.record({
          attemptId: translationAttemptId,
          capabilityId: this.capabilityId,
          providerId: "synthetic_fixture",
          routeId: "RT-SYNTHETIC-TRANSLATE-V1",
          modelId: "deterministic-canonicalizer-v1",
          environment: "test",
          routeKind: "synthetic_fixture",
          dataHandlingPosture: "synthetic_fixture",
          timeoutMs: 20_000,
          configuredMaxAttempts: 1,
          configuredBackoffMs: 0,
          allowFallbacks: false,
          attemptNumber: 1,
          fallback: false,
          retryBackoffMs: 0,
          startedAt: translationStartedAt,
          completedAt: this.now().toISOString(),
          outcome: signal.aborted ? "timeout" : "provider_error",
          quantity: 1,
          unit: "attempt",
          amount: 0,
          currency: "USD",
          pricingBasis: "synthetic_fixture",
          pricingVersion: "fixture-pricing.v1",
          pricingState: "explicit_zero",
          measurement: "measured",
        });
      }
      throw error;
    }
  }
}

export class CanonicalizationTimeoutError extends Error {
  constructor() {
    super("Canonicalization exceeded its internal budget; retry is permitted.");
    this.name = "CanonicalizationTimeoutError";
  }
}

export async function runCanonicalizationWithinBudget(
  capability: CanonicalizationCapability,
  input: CanonicalizationInput,
  telemetry: CapabilityTelemetrySink,
  budgetMs = 20_000,
): Promise<CanonicalRequestV1> {
  if (!Number.isInteger(budgetMs) || budgetMs <= 0 || budgetMs > 20_000) {
    throw new Error("Canonicalization budget must be between 1 and 20000 ms.");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CanonicalizationTimeoutError());
    }, budgetMs);
  });
  try {
    return await Promise.race([
      capability.canonicalize(input, controller.signal, telemetry),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
