export const CANONICAL_REQUEST_SCHEMA_VERSION = "canonical-request.v1" as const;

export type CanonicalValueState =
  "provided" | "explicitly_unknown" | "not_asked";

export type LanguageOrigin =
  | "entered_in_english"
  | "translated"
  | "protected_span"
  | "derived_deterministic";

export interface LanguageMetadataV1 {
  bcp47: string;
  confidence: number;
  detectorId: string;
  detectorVersion: string;
}

export interface ProtectedSpanV1 {
  placeholder: string;
  category: "identifier" | "model" | "quantity_unit" | "code_enum";
  canonicalValue: string;
  sourceByteLength: number;
}

export interface CanonicalFieldV1 {
  fieldId: string;
  path: string;
  valueState: CanonicalValueState;
  languageOrigin: LanguageOrigin;
  canonicalValue: string;
}

export interface TransformationProvenanceV1 {
  attemptId: string;
  capabilityId: string;
  providerId: string;
  routeId: string;
  modelId: string;
  promptVersion: string;
  configVersion: string;
  retentionPosture: "zdr" | "no_training_30d_logs" | "not_applicable";
  startedAt: string;
  completedAt: string;
  outcome: "ok" | "failed" | "timed_out";
}

export interface OriginalTextDigestV1 {
  algorithm: "HMAC-SHA-256";
  keyId: string;
  rawDigest: string;
  normalizedDigest: string;
  byteLength: number;
}

export interface CanonicalRequestV1 {
  schemaVersion: typeof CANONICAL_REQUEST_SCHEMA_VERSION;
  requestId: string;
  canonicalVersionId: string;
  version: number;
  canonicalLanguage: "en";
  canonicalText: string;
  language: LanguageMetadataV1;
  fields: CanonicalFieldV1[];
  protectedSpans: ProtectedSpanV1[];
  provenance: TransformationProvenanceV1[];
  originalTextDigest: OriginalTextDigestV1;
  readiness: "ready" | "partially_ready" | "not_ready";
  contradictionIds: string[];
}
