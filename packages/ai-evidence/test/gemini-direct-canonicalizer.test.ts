import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CapabilityInvocationTelemetry } from "../src/capabilities.js";
import { GeminiDirectCanonicalizer } from "../src/canonicalization/gemini-direct.js";

const source = "نیاز به پمپ MX900 با ظرفیت 45 kg و کد HS-CODE";

function input() {
  return {
    requestId: "00000000-0000-4000-8000-000000000123",
    sourceText: source,
    presentedFields: ["need", "mandatory_constraints", "preferences_context"],
    fixtureCanonicalText: "SYNTHETIC_FIXTURE_MUST_NOT_ESCAPE",
    fixtureCanonicalFields: [
      {
        fieldId: "need",
        path: "product.need",
        valueState: "provided" as const,
        languageOrigin: "translated" as const,
        canonicalValue: "SYNTHETIC_NEED_MUST_NOT_ESCAPE",
      },
      {
        fieldId: "mandatory_constraints",
        path: "product.mandatory_constraints",
        valueState: "provided" as const,
        languageOrigin: "translated" as const,
        canonicalValue: "SYNTHETIC_CONSTRAINTS_MUST_NOT_ESCAPE",
      },
      {
        fieldId: "preferences_context",
        path: "commercial.preferences_context",
        valueState: "explicitly_unknown" as const,
        languageOrigin: "translated" as const,
        canonicalValue: "SYNTHETIC_CONTEXT_MUST_NOT_ESCAPE",
      },
    ],
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: JSON.stringify({
                canonical_text:
                  "Source a pump model PS-0001 with capacity PS-0002 under code PS-0003.",
                source_language_bcp47: "fa",
                source_language_confidence: 0.99,
                fields: {
                  need: "Industrial pump model PS-0001",
                  mandatory_constraints: "Capacity PS-0002; code PS-0003",
                  preferences_context: "Unknown",
                },
              }),
            },
          ],
        },
      },
    ],
    modelVersion: "gemini-3.6-flash",
    responseId: "provider-response-id-not-retained",
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
    ...overrides,
  };
}

function canonicalizer(fetchImpl: typeof fetch): GeminiDirectCanonicalizer {
  return new GeminiDirectCanonicalizer({
    apiKey: "secret-gemini-key",
    digestKey: createHash("sha256").update("canonical-digest-key").digest(),
    digestKeyId: "canonical-runtime-v1",
    environment: "staging",
    fetchImpl,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
}

test("direct Gemini canonicalization preserves protected spans and emits reconciled live telemetry", async () => {
  let requestBody = "";
  let requestHeaders: HeadersInit | undefined;
  let requestUrl = "";
  let requestMethod: string | undefined;
  let calls = 0;
  const events: CapabilityInvocationTelemetry[] = [];
  const result = await canonicalizer(async (url, init) => {
    calls += 1;
    requestUrl = String(url);
    requestMethod = init?.method;
    requestBody = String(init?.body);
    requestHeaders = init?.headers;
    return Response.json(envelope());
  }).canonicalize(input(), new AbortController().signal, {
    record: (event) => {
      events.push(event);
    },
  });

  assert.equal(calls, 1);
  assert.equal(
    requestUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
  );
  assert.equal(requestMethod, "POST");
  assert.equal(
    (requestHeaders as Record<string, string>)["x-goog-api-key"],
    "secret-gemini-key",
  );
  assert.equal(requestBody.includes("secret-gemini-key"), false);
  assert.equal(
    requestBody.includes("SYNTHETIC_FIXTURE_MUST_NOT_ESCAPE"),
    false,
  );
  assert.equal(requestBody.includes("SYNTHETIC_NEED_MUST_NOT_ESCAPE"), false);
  assert.equal(requestBody.includes("MX900"), false);
  assert.equal(requestBody.includes("PS-0001"), true);
  const body = JSON.parse(requestBody);
  assert.equal(body.generationConfig.maxOutputTokens, 4096);
  assert.equal(body.generationConfig.temperature, 0);
  assert.equal(
    body.generationConfig.responseJsonSchema.additionalProperties,
    false,
  );
  assert.equal(result.canonicalText.includes(source), false);
  assert.equal(result.canonicalText.split("MX900").length - 1, 1);
  assert.equal(result.canonicalText.split("45 kg").length - 1, 1);
  assert.equal(result.canonicalText.split("HS-CODE").length - 1, 1);
  assert.equal(result.fields[2]?.canonicalValue, "Unknown");
  assert.equal(result.originalTextDigest.rawDigest.length, 64);
  assert.equal(JSON.stringify(result).includes("provider-response-id"), false);
  assert.deepEqual(
    events.map((event) => ({
      providerId: event.providerId,
      routeId: event.routeId,
      modelId: event.modelId,
      environment: event.environment,
      posture: event.dataHandlingPosture,
      timeoutMs: event.timeoutMs,
      attempts: event.configuredMaxAttempts,
      outcome: event.outcome,
      quantity: event.quantity,
    })),
    [
      {
        providerId: "gemini_direct",
        routeId: "RT-GEMINI-DIRECT-CANONICALIZE-V1",
        modelId: "gemini-3.6-flash",
        environment: "staging",
        posture: "paid_no_training",
        timeoutMs: 20_000,
        attempts: 1,
        outcome: "ok",
        quantity: 160,
      },
    ],
  );
  assert.equal(result.provenance[0]?.attemptId, events[0]?.attemptId);
  assert.equal(result.provenance[0]?.modelId, events[0]?.modelId);
});

test("direct Gemini canonicalization fails closed on model identity and closed-schema drift without retry", async () => {
  for (const providerEnvelope of [
    envelope({ modelVersion: "gemini-3.6-flash-unapproved" }),
    envelope({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  canonical_text: "Canonical output PS-0001 PS-0002 PS-0003",
                  source_language_bcp47: "fa",
                  source_language_confidence: 0.9,
                  fields: {
                    need: "Need PS-0001",
                    mandatory_constraints: "Constraint PS-0002 PS-0003",
                    preferences_context: "Unknown",
                  },
                  unsupported: true,
                }),
              },
            ],
          },
        },
      ],
    }),
  ]) {
    let calls = 0;
    const events: CapabilityInvocationTelemetry[] = [];
    await assert.rejects(
      canonicalizer(async () => {
        calls += 1;
        return Response.json(providerEnvelope);
      }).canonicalize(input(), new AbortController().signal, {
        record: (event) => {
          events.push(event);
        },
      }),
    );
    assert.equal(calls, 1);
    assert.equal(events.length, 1);
    assert.notEqual(events[0]?.outcome, "ok");
    assert.equal(events[0]?.configuredMaxAttempts, 1);
    assert.equal(events[0]?.allowFallbacks, false);
  }
});
