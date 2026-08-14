import { isAbsolute } from "node:path";

const allowedRouteFields = new Set([
  "id",
  "provider",
  "model",
  "enabled",
  "realData",
  "billingPath",
  "paidEvidenceRefs",
  "dataHandlingEvidenceRefs",
]);

function requireCanonicalText(value, field, routeId) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(
      `Route ${routeId}: ${field} must be nonempty canonical text.`,
    );
  }
  return value.toLowerCase();
}

function requireEvidenceRefs(value, field, routeId) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Route ${routeId}: ${field} requires at least one evidence reference.`,
    );
  }
  for (const reference of value) {
    if (
      typeof reference !== "string" ||
      reference !== reference.trim() ||
      !reference ||
      (!isAbsolute(reference) &&
        !/^(?:https|gs|matchbase):\/\//i.test(reference))
    ) {
      throw new Error(`Route ${routeId}: invalid ${field} reference.`);
    }
  }
}

export function validateProviderRoutes(policy) {
  if (!policy || typeof policy !== "object" || policy.schemaVersion !== 1) {
    throw new Error("Provider-route policy schema is invalid.");
  }
  if (
    policy.rules?.openRouterAutoAllowed !== false ||
    policy.rules?.realDataRequiresPaidVerifiedRoute !== true ||
    policy.rules?.credentialsInRepositoryAllowed !== false
  ) {
    throw new Error("Provider-route policy boundary is invalid.");
  }
  if (!Array.isArray(policy.routes))
    throw new Error("Provider routes must be an array.");

  const ids = new Set();
  for (const route of policy.routes) {
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      throw new Error("Provider route must be an object.");
    }
    const unknownFields = Object.keys(route).filter(
      (field) => !allowedRouteFields.has(field),
    );
    if (unknownFields.length) {
      throw new Error(
        `Provider route contains unsupported fields: ${unknownFields.join(", ")}`,
      );
    }
    const id = requireCanonicalText(route.id, "id", "UNKNOWN");
    if (ids.has(id)) throw new Error(`Duplicate provider route id: ${id}`);
    ids.add(id);
    const provider = requireCanonicalText(route.provider, "provider", id);
    const model = requireCanonicalText(route.model, "model", id);
    if (
      typeof route.enabled !== "boolean" ||
      typeof route.realData !== "boolean"
    ) {
      throw new Error(`Route ${id}: enabled and realData must be booleans.`);
    }
    if (provider === "openrouter" && model === "auto") {
      throw new Error(`Route ${id}: openrouter/auto is prohibited.`);
    }
    if (route.realData) {
      if (route.billingPath !== "PAID_VERIFIED") {
        throw new Error(
          `Route ${id}: real data requires PAID_VERIFIED billing.`,
        );
      }
      requireEvidenceRefs(route.paidEvidenceRefs, "paidEvidenceRefs", id);
      requireEvidenceRefs(
        route.dataHandlingEvidenceRefs,
        "dataHandlingEvidenceRefs",
        id,
      );
    } else if (
      route.billingPath !== "NOT_APPLICABLE" &&
      route.billingPath !== "PAID_VERIFIED"
    ) {
      throw new Error(`Route ${id}: billingPath is invalid.`);
    }
  }
}
