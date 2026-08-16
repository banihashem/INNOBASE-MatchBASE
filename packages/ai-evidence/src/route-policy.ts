import { isAbsolute, win32 } from "node:path";
import type { ProviderRegistryV1 } from "@matchbase/contracts";

const PROVIDERS = new Set(["gemini_direct", "openrouter", "synthetic_fixture"]);
const ENVIRONMENTS = new Set(["local", "test", "staging", "production"]);
const BILLING_PATHS = new Set(["paid_verified", "not_applicable"]);
const RETENTION_POSTURES = new Set([
  "zdr",
  "no_training_30d_logs",
  "unknown",
  "not_applicable",
]);
const CAPABILITIES = new Set([
  "CAP-LANGUAGE-ID",
  "CAP-TRANSLATE",
  "CAP-SEARCH",
  "CAP-STRUCTURED-GENERATION",
]);

const allowedRegistryFields = new Set([
  "schemaVersion",
  "registryVersion",
  "environment",
  "realData",
  "routes",
]);

const allowedRouteFields = new Set([
  "routeId",
  "providerId",
  "modelId",
  "enabled",
  "environment",
  "realData",
  "billingPath",
  "retentionPosture",
  "dataHandlingEvidenceRefs",
  "timeoutMs",
  "retry",
  "requireParameters",
  "allowFallbacks",
  "capabilities",
]);

const prohibitedSecretField =
  /(?:api.?key|authorization|credential|password|secret|token)/iu;
const prohibitedSecretValue =
  /(?:bearer\s+[a-z0-9._-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|token|secret|apikey)[-_][a-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{20,}\b)/iu;

function requireCanonical(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} must be explicit canonical text.`);
  }
  return value;
}

function containsSecretField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretField);
  return Object.entries(value).some(
    ([key, nested]) =>
      prohibitedSecretField.test(key) || containsSecretField(nested),
  );
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") return prohibitedSecretValue.test(value);
  if (!value || typeof value !== "object") return false;
  return Array.isArray(value)
    ? value.some(containsSecretLikeValue)
    : Object.values(value).some(containsSecretLikeValue);
}

function requireBoolean(
  value: unknown,
  label: string,
): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function validateReference(reference: string): boolean {
  return (
    isAbsolute(reference) ||
    win32.isAbsolute(reference) ||
    /^(?:https|matchbase):\/\//iu.test(reference)
  );
}

export function validateProviderRoute(
  input: unknown,
  registryEnvironment: ProviderRegistryV1["environment"],
): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Provider route must be an object.");
  }
  if (containsSecretField(input) || containsSecretLikeValue(input)) {
    throw new Error("Provider route contains secret-bearing material.");
  }
  const route = input as Record<string, unknown>;
  const unknown = Object.keys(route).filter(
    (key) => !allowedRouteFields.has(key),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Route contains unsupported fields: ${unknown.join(", ")}.`,
    );
  }
  const routeId = requireCanonical(route.routeId, "routeId");
  const modelId = requireCanonical(route.modelId, `Route ${routeId} modelId`);
  const providerId = requireCanonical(
    route.providerId,
    `Route ${routeId} providerId`,
  );
  requireEnum(providerId, PROVIDERS, `Route ${routeId} providerId`);
  requireEnum(route.environment, ENVIRONMENTS, `Route ${routeId} environment`);
  requireEnum(route.billingPath, BILLING_PATHS, `Route ${routeId} billingPath`);
  requireEnum(
    route.retentionPosture,
    RETENTION_POSTURES,
    `Route ${routeId} retentionPosture`,
  );
  requireBoolean(route.enabled, `Route ${routeId} enabled`);
  requireBoolean(route.realData, `Route ${routeId} realData`);
  requireBoolean(route.requireParameters, `Route ${routeId} requireParameters`);
  requireBoolean(route.allowFallbacks, `Route ${routeId} allowFallbacks`);
  if (route.environment !== registryEnvironment) {
    throw new Error(`Route ${routeId} environment must match its registry.`);
  }
  if (/^(?:auto|default)$/iu.test(modelId) || modelId.includes("*")) {
    throw new Error(`Route ${routeId} uses an implicit or wildcard model.`);
  }
  if (providerId === "openrouter" && /(?:^|\/)auto$/iu.test(modelId)) {
    throw new Error(`Route ${routeId} uses prohibited openrouter/auto.`);
  }
  if (
    typeof route.timeoutMs !== "number" ||
    !Number.isInteger(route.timeoutMs) ||
    route.timeoutMs <= 0 ||
    route.timeoutMs > 120_000
  ) {
    throw new Error(`Route ${routeId} timeoutMs must be a positive integer.`);
  }
  if (
    !route.retry ||
    typeof route.retry !== "object" ||
    Array.isArray(route.retry) ||
    Object.keys(route.retry).some(
      (key) => !["maxAttempts", "backoffMs"].includes(key),
    ) ||
    !Number.isInteger((route.retry as Record<string, unknown>).maxAttempts) ||
    Number((route.retry as Record<string, unknown>).maxAttempts) < 1 ||
    Number((route.retry as Record<string, unknown>).maxAttempts) > 10 ||
    !Number.isInteger((route.retry as Record<string, unknown>).backoffMs) ||
    Number((route.retry as Record<string, unknown>).backoffMs) < 0 ||
    Number((route.retry as Record<string, unknown>).backoffMs) > 60_000
  ) {
    throw new Error(`Route ${routeId} retry policy is invalid.`);
  }
  if (
    !Array.isArray(route.capabilities) ||
    route.capabilities.length === 0 ||
    route.capabilities.some(
      (capability) =>
        typeof capability !== "string" || !CAPABILITIES.has(capability),
    ) ||
    new Set(route.capabilities).size !== route.capabilities.length
  ) {
    throw new Error(`Route ${routeId} must declare capabilities.`);
  }
  if (providerId === "openrouter") {
    if (!route.requireParameters || route.allowFallbacks) {
      throw new Error(
        `Route ${routeId} must require parameters and disable provider fallbacks.`,
      );
    }
    if (route.enabled && route.retentionPosture !== "zdr") {
      throw new Error(
        `Route ${routeId} OpenRouter requests require verified ZDR posture.`,
      );
    }
  }
  if (providerId === "synthetic_fixture") {
    if (!["local", "test"].includes(route.environment)) {
      throw new Error(
        `Route ${routeId} cannot enable fixtures outside local/test.`,
      );
    }
    if (route.realData || route.billingPath !== "not_applicable") {
      throw new Error(`Route ${routeId} fixture posture is invalid.`);
    }
  }
  if (
    !Array.isArray(route.dataHandlingEvidenceRefs) ||
    route.dataHandlingEvidenceRefs.some(
      (reference) =>
        typeof reference !== "string" ||
        !reference ||
        reference !== reference.trim(),
    )
  )
    throw new Error(`Route ${routeId} evidence references are invalid.`);
  if (route.realData) {
    if (
      route.billingPath !== "paid_verified" ||
      route.retentionPosture === "unknown" ||
      route.retentionPosture === "not_applicable" ||
      route.dataHandlingEvidenceRefs.length === 0 ||
      !(route.dataHandlingEvidenceRefs as string[]).every(validateReference)
    ) {
      throw new Error(
        `Route ${routeId} lacks verified real-data posture evidence.`,
      );
    }
  }
}

export function validateProviderRegistry(input: unknown): ProviderRegistryV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Provider registry must be an object.");
  }
  if (containsSecretField(input) || containsSecretLikeValue(input)) {
    throw new Error("Provider registry contains a secret-bearing field.");
  }
  const raw = input as Record<string, unknown>;
  const unknown = Object.keys(raw).filter(
    (key) => !allowedRegistryFields.has(key),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Provider registry contains unsupported fields: ${unknown.join(", ")}.`,
    );
  }
  const registry = input as ProviderRegistryV1;
  if (registry.schemaVersion !== "provider-registry.v1") {
    throw new Error("Provider registry schema version is invalid.");
  }
  requireCanonical(registry.registryVersion, "registryVersion");
  requireEnum(registry.environment, ENVIRONMENTS, "registry environment");
  requireBoolean(registry.realData, "registry realData");
  if (!Array.isArray(registry.routes))
    throw new Error("Routes must be an array.");
  const routeIds = new Set<string>();
  for (const route of registry.routes) {
    validateProviderRoute(route, registry.environment);
    const id = route.routeId.toLowerCase();
    if (routeIds.has(id))
      throw new Error(`Duplicate routeId: ${route.routeId}.`);
    routeIds.add(id);
  }
  if (
    registry.realData !==
    registry.routes.some((route) => route.enabled && route.realData)
  ) {
    throw new Error("Registry realData must match its enabled routes.");
  }
  return registry;
}
