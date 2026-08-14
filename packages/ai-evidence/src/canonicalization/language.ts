import { randomUUID } from "node:crypto";
import type { LanguageMetadataV1 } from "@matchbase/contracts";
import type {
  CapabilityInvocationTelemetry,
  CapabilityTelemetrySink,
  LanguageIdentificationInput,
  LanguageIdentifier,
} from "../capabilities.js";

function ratio(
  text: string,
  predicate: (codePoint: number) => boolean,
): number {
  const points = Array.from(text, (character) => character.codePointAt(0) ?? 0);
  if (points.length === 0) return 0;
  return points.filter(predicate).length / points.length;
}

export class DeterministicFixtureLanguageIdentifier implements LanguageIdentifier {
  readonly capabilityId = "CAP-LANGUAGE-ID" as const;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async identify(
    input: LanguageIdentificationInput,
    telemetry: CapabilityTelemetrySink,
  ): Promise<LanguageMetadataV1> {
    const startedAt = this.now().toISOString();
    const attemptId = randomUUID();
    let outcome: CapabilityInvocationTelemetry["outcome"] = "ok";
    try {
      const text = input.sourceText.normalize("NFC");
      const persianSpecific = ratio(text, (point) =>
        [0x067e, 0x0686, 0x0698, 0x06af, 0x06cc, 0x06a9].includes(point),
      );
      const arabicScript = ratio(
        text,
        (point) => point >= 0x0600 && point <= 0x06ff,
      );
      const spanishSpecific = ratio(text, (point) =>
        [0x00f1, 0x00d1, 0x00bf, 0x00a1].includes(point),
      );
      const latin = ratio(
        text,
        (point) =>
          (point >= 0x0041 && point <= 0x005a) ||
          (point >= 0x0061 && point <= 0x007a),
      );

      const result =
        persianSpecific > 0
          ? { bcp47: "fa", confidence: 0.99 }
          : arabicScript > 0.2
            ? { bcp47: "ar", confidence: 0.98 }
            : spanishSpecific > 0
              ? { bcp47: "es", confidence: 0.97 }
              : latin > 0.2
                ? { bcp47: "en", confidence: 0.96 }
                : { bcp47: "und", confidence: 0 };

      return {
        ...result,
        detectorId: "deterministic-fixture-script-detector",
        detectorVersion: "1.0.0",
      };
    } catch (error) {
      outcome = "provider_error";
      throw error;
    } finally {
      await telemetry.record({
        attemptId,
        capabilityId: this.capabilityId,
        providerId: "synthetic_fixture",
        routeId: "RT-SYNTHETIC-LANGUAGE-ID-V1",
        modelId: "deterministic-fixture-script-detector",
        environment: "test",
        routeKind: "synthetic_fixture",
        dataHandlingPosture: "synthetic_fixture",
        timeoutMs: 1_000,
        configuredMaxAttempts: 1,
        configuredBackoffMs: 0,
        allowFallbacks: false,
        attemptNumber: 1,
        fallback: false,
        retryBackoffMs: 0,
        startedAt,
        completedAt: this.now().toISOString(),
        outcome,
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
  }
}
