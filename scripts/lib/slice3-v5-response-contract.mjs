export const V5_RESPONSE_EXTRACTED_DATA_KEYS = Object.freeze([
  "byok_usage",
  "byok_usage_daily",
  "byok_usage_monthly",
  "byok_usage_weekly",
  "creator_user_id",
  "expires_at",
  "include_byok_in_limit",
  "is_free_tier",
  "is_management_key",
  "is_provisioning_key",
  "label",
  "limit",
  "limit_remaining",
  "limit_reset",
  "rate_limit",
  "usage",
  "usage_daily",
  "usage_monthly",
  "usage_weekly",
]);

// Compatibility alias. This is an extraction allowlist, not a rejection list.
export const V5_RESPONSE_ALLOWED_DATA_KEYS = V5_RESPONSE_EXTRACTED_DATA_KEYS;

export const V5_RESPONSE_REQUIRED_DATA_KEYS = Object.freeze(
  V5_RESPONSE_EXTRACTED_DATA_KEYS.filter((key) => key !== "expires_at"),
);

export const V5_RESPONSE_DECISION_DIAGNOSTICS = Object.freeze([
  "KNOWN_FIELD_TYPE_MISMATCH",
  "MISSING_REQUIRED_FIELD",
  "MISSING_PAID_STATUS",
  "KEY_CLASS_UNPROVEN",
  "EXPIRY_UNPROVEN",
  "QUOTA_UNPROVEN",
  "QUOTA_EXHAUSTED",
  "UNKNOWN_FIELDS_DISCARDED",
]);

export const V5_RESPONSE_FAILURE_CLASSES = Object.freeze([
  "HTTP_401",
  "HTTP_403",
  "REDIRECT_RESPONSE",
  "INVALID_200_SCHEMA",
  "OTHER_HTTP_STATUS",
  "UNPAID_CREDENTIAL",
  "INELIGIBLE_MANAGEMENT_KEY",
  "INELIGIBLE_PROVISIONING_KEY",
  "EXPIRED_KEY",
  "KEY_CLASS_UNPROVEN",
  "EXPIRY_UNPROVEN",
  "QUOTA_UNPROVEN",
  "QUOTA_EXHAUSTED",
  "CREDENTIAL_READ_OR_PRE_SEND_FAILURE",
  "RESPONSE_REDUCTION_FAILURE",
  "UNKNOWN_TRANSPORT_TIMEOUT_OR_REDIRECT",
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
  "decisionDiagnostics",
]);

export const V5_RESPONSE_PROHIBITED_PERSISTENCE = Object.freeze([
  "authorization_header",
  "credential_value",
  "raw_headers",
  "raw_response_body",
  "raw_response_body_digest",
  "account_identifier",
  "email",
  "label",
  "provider_message",
  "decision_field_values",
  "unknown_field_names",
]);

const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);

export function validateV5ResponseContractArtifact(value) {
  const keys = [
    "schemaVersion",
    "endpoint",
    "method",
    "successStatus",
    "contentType",
    "maximumBodyBytes",
    "maximumJsonDepth",
    "officialDocsEvidence",
    "officialDocsEvidenceAudit",
    "governanceAmendment",
    "requiredTopLevelKeys",
    "extractedDataKeys",
    "requiredDataKeys",
    "optionalDataKeys",
    "rateLimitKeys",
    "requiredRateLimitKeys",
    "unknownFieldPolicy",
    "paidCredentialPredicate",
    "nullLimitRemainingPolicy",
    "rateLimitRequestsPolicy",
    "decisionDiagnostics",
    "failureClasses",
    "persistedFields",
    "prohibitedPersistence",
  ];
  if (
    !exactKeys(value, keys) ||
    value.schemaVersion !==
      "matchbase.openrouter-key-status-response-contract/v2" ||
    value.endpoint !== "https://openrouter.ai/api/v1/key" ||
    value.method !== "GET" ||
    value.successStatus !== 200 ||
    value.contentType !== "application/json" ||
    value.maximumBodyBytes !== 32_768 ||
    value.maximumJsonDepth !== 8 ||
    !exactKeys(value.officialDocsEvidence, ["path", "bytes", "sha256"]) ||
    value.officialDocsEvidence.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_2026-08-23.json" ||
    value.officialDocsEvidence.bytes !== 3901 ||
    value.officialDocsEvidence.sha256 !==
      "F73071B74AC60D557697ACE6278E1B0091185AFEC065D61C7E4D3CC0900607D4" ||
    !exactKeys(value.officialDocsEvidenceAudit, ["path", "bytes", "sha256"]) ||
    value.officialDocsEvidenceAudit.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_OPENROUTER_KEY_STATUS_OFFICIAL_DOCS_EVIDENCE_V2_AUDIT_2026-08-23.json" ||
    value.officialDocsEvidenceAudit.bytes !== 1490 ||
    value.officialDocsEvidenceAudit.sha256 !==
      "A01BF254BD41CA0896D43F132E97DBEDE2E736FE0E4A3742EB09B060691584C3" ||
    !exactKeys(value.governanceAmendment, ["path", "bytes", "sha256"]) ||
    value.governanceAmendment.path !==
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_V5_SUCCESSOR_GOVERNANCE_AMENDMENT_RATE_LIMIT_REQUESTS_V1.md" ||
    value.governanceAmendment.bytes !== 2771 ||
    value.governanceAmendment.sha256 !==
      "AFCC3A48B201393EA9E20F8690B5E604571B71B984B5C618FA3F374FA4551566" ||
    JSON.stringify(value.requiredTopLevelKeys) !== JSON.stringify(["data"]) ||
    JSON.stringify(value.extractedDataKeys) !==
      JSON.stringify(V5_RESPONSE_EXTRACTED_DATA_KEYS) ||
    JSON.stringify(value.requiredDataKeys) !==
      JSON.stringify(V5_RESPONSE_REQUIRED_DATA_KEYS) ||
    JSON.stringify(value.optionalDataKeys) !== JSON.stringify(["expires_at"]) ||
    JSON.stringify(value.rateLimitKeys) !==
      JSON.stringify(["requests", "interval", "note"]) ||
    JSON.stringify(value.requiredRateLimitKeys) !==
      JSON.stringify(["requests", "interval", "note"]) ||
    value.unknownFieldPolicy !== "IGNORE_DISCARD_DIAGNOSTIC" ||
    !exactKeys(value.paidCredentialPredicate, ["path", "operator", "value"]) ||
    value.paidCredentialPredicate.path !== "data.is_free_tier" ||
    value.paidCredentialPredicate.operator !== "EQUALS" ||
    value.paidCredentialPredicate.value !== false ||
    value.nullLimitRemainingPolicy !== "QUOTA_UNPROVEN" ||
    value.rateLimitRequestsPolicy !== "SAFE_INTEGER_GTE_NEGATIVE_ONE" ||
    JSON.stringify(value.decisionDiagnostics) !==
      JSON.stringify(V5_RESPONSE_DECISION_DIAGNOSTICS) ||
    JSON.stringify(value.failureClasses) !==
      JSON.stringify(V5_RESPONSE_FAILURE_CLASSES) ||
    JSON.stringify(value.persistedFields) !==
      JSON.stringify(V5_RESPONSE_PERSISTED_FIELDS) ||
    JSON.stringify(value.prohibitedPersistence) !==
      JSON.stringify(V5_RESPONSE_PROHIBITED_PERSISTENCE)
  )
    throw new Error("V5 response contract v2 semantics are invalid.");
  return Object.freeze(value);
}

export function assertV5SanitizedEnvelopeShape(envelope) {
  if (!exactKeys(envelope, V5_RESPONSE_PERSISTED_FIELDS))
    throw new Error("V5 sanitized envelope drifted from response contract v2.");
  if (
    !Array.isArray(envelope.decisionDiagnostics) ||
    new Set(envelope.decisionDiagnostics).size !==
      envelope.decisionDiagnostics.length ||
    envelope.decisionDiagnostics.some(
      (value) => !V5_RESPONSE_DECISION_DIAGNOSTICS.includes(value),
    ) ||
    JSON.stringify(envelope.decisionDiagnostics) !==
      JSON.stringify(
        V5_RESPONSE_DECISION_DIAGNOSTICS.filter((value) =>
          envelope.decisionDiagnostics.includes(value),
        ),
      ) ||
    ![null, ...V5_RESPONSE_FAILURE_CLASSES].includes(envelope.failureClass)
  )
    throw new Error("V5 sanitized decision fields are invalid.");
  return envelope;
}
