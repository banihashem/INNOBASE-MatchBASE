import { describe, expect, it } from "vitest";
import type { CapabilityInvocationTelemetry } from "@matchbase/ai-evidence";
import { loadWebConfig } from "./config";
import { createRuntimeCanonicalizer } from "./canonicalization-runtime";

const productionEnvironment = {
  DATABASE_URL: "postgresql://synthetic.invalid/matchbase",
  MATCHBASE_DIGEST_KEY: "synthetic-config-key-material-32-bytes",
  MATCHBASE_ENVIRONMENT: "production",
  MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
  MATCHBASE_DEPLOYMENT_ID: `sha256:${"a".repeat(64)}`,
  MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
  GOOGLE_CLIENT_ID: "client-id-fixture",
  GOOGLE_CLIENT_SECRET: "client-secret-fixture",
  GOOGLE_REDIRECT_URI:
    "https://matchbase-staging.innobase.app/auth/google/callback",
  MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
  MATCHBASE_ORIGIN_ADMISSION_KEY:
    "synthetic-origin-admission-key-material-32-bytes",
  MATCHBASE_GEMINI_API_KEY: "gemini-runtime-test-key",
};

describe("web canonicalization runtime", () => {
  it("selects the governed direct Gemini route for staging and never the synthetic fixture", async () => {
    let calls = 0;
    const canonicalizer = createRuntimeCanonicalizer(
      loadWebConfig(productionEnvironment),
      async (_url, init) => {
        calls += 1;
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["x-goog-api-key"]).toBe("gemini-runtime-test-key");
        expect(String(init?.body)).not.toContain("fixture canonical output");
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      canonical_text:
                        "Procure model PS-0001 with capacity PS-0002 under code PS-0003.",
                      source_language_bcp47: "en",
                      source_language_confidence: 1,
                      fields: {
                        need: "Procure model PS-0001",
                        mandatory_constraints:
                          "Capacity PS-0002 under code PS-0003",
                        preferences_context: "Unknown",
                      },
                    }),
                  },
                ],
              },
            },
          ],
          modelVersion: "gemini-3.6-flash",
          responseId: "not-persisted",
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 },
        });
      },
    );
    const events: CapabilityInvocationTelemetry[] = [];
    const result = await canonicalizer.canonicalize(
      {
        requestId: "00000000-0000-4000-8000-000000000987",
        sourceText: "Need MX900 with 45 kg capacity and HS-CODE",
        presentedFields: [
          "need",
          "mandatory_constraints",
          "preferences_context",
        ],
        fixtureCanonicalText: "fixture canonical output",
        fixtureCanonicalFields: [
          {
            fieldId: "need",
            path: "product.need",
            valueState: "provided",
            languageOrigin: "translated",
            canonicalValue: "fixture need",
          },
          {
            fieldId: "mandatory_constraints",
            path: "product.mandatory_constraints",
            valueState: "provided",
            languageOrigin: "translated",
            canonicalValue: "fixture constraints",
          },
          {
            fieldId: "preferences_context",
            path: "commercial.preferences_context",
            valueState: "explicitly_unknown",
            languageOrigin: "translated",
            canonicalValue: "fixture context",
          },
        ],
      },
      new AbortController().signal,
      {
        record: (event) => {
          events.push(event);
        },
      },
    );
    expect(calls).toBe(1);
    expect(result.canonicalText).toContain("MX900");
    expect(result.canonicalText).not.toContain("fixture canonical output");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      providerId: "gemini_direct",
      environment: "staging",
      routeKind: "real_data",
      dataHandlingPosture: "paid_no_training",
      configuredMaxAttempts: 1,
      timeoutMs: 20_000,
    });
  });
});
