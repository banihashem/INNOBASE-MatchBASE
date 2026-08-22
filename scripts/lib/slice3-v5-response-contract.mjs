export const V5_RESPONSE_ALLOWED_DATA_KEYS = Object.freeze([
  "byok_usage",
  "byok_usage_daily",
  "byok_usage_monthly",
  "byok_usage_weekly",
  "include_byok_in_limit",
  "is_free_tier",
  "label",
  "limit",
  "limit_remaining",
  "rate_limit",
  "usage",
  "usage_daily",
  "usage_monthly",
  "usage_weekly",
]);

export const V5_RESPONSE_PERSISTED_FIELDS = Object.freeze([
  "endpointCapability",
  "httpStatus",
  "callOccurred",
  "urlValid",
  "contentTypeValid",
  "schemaValid",
  "paidCredential",
  "failureClass",
  "responseBodyPersisted",
  "rawHeadersPersisted",
]);

export const V5_RESPONSE_PROHIBITED_PERSISTENCE = Object.freeze([
  "authorization_header",
  "credential_value",
  "raw_headers",
  "raw_response_body",
  "account_identifier",
  "email",
  "label",
  "provider_message",
]);

const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());

export function validateV5ResponseContractArtifact(value) {
  if (
    !exactKeys(value, [
      "schemaVersion",
      "endpoint",
      "method",
      "successStatus",
      "contentType",
      "maximumBodyBytes",
      "topLevelKeys",
      "requiredDataKeys",
      "allowedDataKeys",
      "paidCredentialPredicate",
      "persistedFields",
      "prohibitedPersistence",
    ]) ||
    value.schemaVersion !==
      "matchbase.openrouter-key-status-response-contract/v1" ||
    value.endpoint !== "https://openrouter.ai/api/v1/key" ||
    value.method !== "GET" ||
    value.successStatus !== 200 ||
    value.contentType !== "application/json" ||
    value.maximumBodyBytes !== 32_768 ||
    JSON.stringify(value.topLevelKeys) !== JSON.stringify(["data"]) ||
    JSON.stringify(value.requiredDataKeys) !==
      JSON.stringify(["is_free_tier"]) ||
    JSON.stringify(value.allowedDataKeys) !==
      JSON.stringify(V5_RESPONSE_ALLOWED_DATA_KEYS) ||
    !exactKeys(value.paidCredentialPredicate, ["path", "operator", "value"]) ||
    value.paidCredentialPredicate.path !== "data.is_free_tier" ||
    value.paidCredentialPredicate.operator !== "EQUALS" ||
    value.paidCredentialPredicate.value !== false ||
    JSON.stringify(value.persistedFields) !==
      JSON.stringify(V5_RESPONSE_PERSISTED_FIELDS) ||
    JSON.stringify(value.prohibitedPersistence) !==
      JSON.stringify(V5_RESPONSE_PROHIBITED_PERSISTENCE)
  )
    throw new Error("V5 response contract semantics are invalid.");
  return Object.freeze(value);
}

export function assertV5SanitizedEnvelopeShape(envelope) {
  if (
    JSON.stringify(Object.keys(envelope)) !==
    JSON.stringify(V5_RESPONSE_PERSISTED_FIELDS)
  )
    throw new Error(
      "V5 sanitized envelope drifted from its response contract.",
    );
  return envelope;
}
