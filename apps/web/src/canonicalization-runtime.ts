import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
  GeminiDirectCanonicalizer,
  type CanonicalizationCapability,
} from "@matchbase/ai-evidence";
import type { WebConfig } from "./config";

function unavailableCanonicalizer(): CanonicalizationCapability {
  return {
    capabilityId: "CAP-TRANSLATE",
    async canonicalize() {
      throw new Error("No approved canonicalization route is configured.");
    },
  };
}

export function createRuntimeCanonicalizer(
  config: WebConfig,
  fetchImpl?: typeof fetch,
): CanonicalizationCapability {
  if (config.syntheticFixtureEnabled) {
    if (config.environment !== "local" && config.environment !== "test")
      throw new Error("Synthetic canonicalization is prohibited here.");
    return new DeterministicFixtureCanonicalizer({
      digestKey: config.digestKey,
      digestKeyId: "runtime-v1",
      languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
    });
  }
  if (!config.geminiApiKey) return unavailableCanonicalizer();
  return new GeminiDirectCanonicalizer({
    apiKey: config.geminiApiKey,
    digestKey: config.digestKey,
    digestKeyId: "runtime-v1",
    environment: config.deploymentEnvironment ?? config.environment,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
