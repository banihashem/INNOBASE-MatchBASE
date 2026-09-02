import {
  STANDARD_ORGANIZATION_WEB_POLICY_VERSION,
  STANDARD_ORGANIZATION_WEB_PURPOSES,
} from "./v1/standard-evidence.js";
import {
  COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
  CONSULTANT_UNAVAILABLE_SOURCE_IDS,
} from "./v1/complete-result-foundation.js";
import {
  COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION,
  DEMO_LOW_CONFIDENCE_CAUTION_TEXT,
  DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME,
} from "./v2/complete-result-foundation.js";
import {
  CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_VERSION,
} from "./v1/consultant-projection.js";
import { STANDARD_DISCLOSURE_PROJECTION_VERSION } from "./v1/standard-projection.js";
import {
  CONSULTANT_DOMAIN_PACK_ID,
  CONSULTANT_AGRICULTURAL_DOMAIN_PACK_ID,
  CONSULTANT_DUE_DILIGENCE_CHECKS,
  CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  CONSULTANT_SOURCE_POLICY_ID,
  CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
  CONSULTANT_SOURCE_POLICY_VERSION,
  CONSULTANT_AGRICULTURAL_RFQ_QUESTIONS,
  CONSULTANT_SYNTHETIC_RFQ_QUESTIONS,
} from "./v2/consultant-projection.js";

export type JsonSchema = Readonly<Record<string, unknown>>;

const closedObject = (
  required: readonly string[],
  properties: Readonly<Record<string, JsonSchema>>,
): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const string = (values?: readonly string[]): JsonSchema =>
  values ? { type: "string", enum: values } : { type: "string" };
const number: JsonSchema = { type: "number" };
const integer: JsonSchema = { type: "integer" };
const boolean: JsonSchema = { type: "boolean" };
const strings: JsonSchema = { type: "array", items: string() };

export function generateContractSchemas(): JsonSchema {
  const language = closedObject(
    ["bcp47", "confidence", "detectorId", "detectorVersion"],
    {
      bcp47: string(),
      confidence: number,
      detectorId: string(),
      detectorVersion: string(),
    },
  );
  const protectedSpan = closedObject(
    ["placeholder", "category", "canonicalValue", "sourceByteLength"],
    {
      placeholder: string(),
      category: string(["identifier", "model", "quantity_unit", "code_enum"]),
      canonicalValue: string(),
      sourceByteLength: integer,
    },
  );
  const canonicalField = closedObject(
    ["fieldId", "path", "valueState", "languageOrigin", "canonicalValue"],
    {
      fieldId: string(),
      path: string(),
      valueState: string(["provided", "explicitly_unknown", "not_asked"]),
      languageOrigin: string([
        "entered_in_english",
        "translated",
        "protected_span",
        "derived_deterministic",
      ]),
      canonicalValue: string(),
    },
  );
  const provenance = closedObject(
    [
      "attemptId",
      "capabilityId",
      "providerId",
      "routeId",
      "modelId",
      "promptVersion",
      "configVersion",
      "retentionPosture",
      "startedAt",
      "completedAt",
      "outcome",
    ],
    {
      attemptId: string(),
      capabilityId: string(),
      providerId: string(),
      routeId: string(),
      modelId: string(),
      promptVersion: string(),
      configVersion: string(),
      retentionPosture: string([
        "zdr",
        "no_training_30d_logs",
        "not_applicable",
      ]),
      startedAt: string(),
      completedAt: string(),
      outcome: string(["ok", "failed", "timed_out"]),
    },
  );
  const digest = closedObject(
    ["algorithm", "keyId", "rawDigest", "normalizedDigest", "byteLength"],
    {
      algorithm: string(["HMAC-SHA-256"]),
      keyId: string(),
      rawDigest: string(),
      normalizedDigest: string(),
      byteLength: integer,
    },
  );
  const retry = closedObject(["maxAttempts", "backoffMs"], {
    maxAttempts: integer,
    backoffMs: integer,
  });
  const route = closedObject(
    [
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
    ],
    {
      routeId: string(),
      providerId: string(["gemini_direct", "openrouter", "synthetic_fixture"]),
      modelId: string(),
      enabled: boolean,
      environment: string(["local", "test", "staging", "production"]),
      realData: boolean,
      billingPath: string(["paid_verified", "not_applicable"]),
      retentionPosture: string([
        "zdr",
        "no_training_30d_logs",
        "unknown",
        "not_applicable",
      ]),
      dataHandlingEvidenceRefs: strings,
      timeoutMs: integer,
      retry,
      requireParameters: boolean,
      allowFallbacks: boolean,
      capabilities: strings,
    },
  );
  const researchRouteParameterPolicy = closedObject(
    [
      "policyVersion",
      "searchMode",
      "structuredOutput",
      "requireParameters",
      "allowFallbacks",
      "maxOutputTokens",
      "timeoutMs",
      "maxAttempts",
      "backoffMs",
    ],
    {
      policyVersion: string(),
      searchMode: string([
        "provider_native_web_search",
        "external_sanitized_evidence",
      ]),
      structuredOutput: string(["json_schema"]),
      requireParameters: { type: "boolean", enum: [true] },
      allowFallbacks: { type: "boolean", enum: [false] },
      maxOutputTokens: { type: "integer", minimum: 1 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
      maxAttempts: { type: "integer", minimum: 1, maximum: 3 },
      backoffMs: { type: "integer", minimum: 0, maximum: 10000 },
    },
  );
  const researchRouteDataHandling = closedObject(
    [
      "evidenceVersion",
      "evidenceRefs",
      "evidenceAccessedAt",
      "evidenceExpiresAt",
      "paidPath",
      "retentionTrainingPosture",
    ],
    {
      evidenceVersion: string(),
      evidenceRefs: strings,
      evidenceAccessedAt: string(),
      evidenceExpiresAt: string(),
      paidPath: string(["verified", "unverified"]),
      retentionTrainingPosture: string([
        "verified_no_training",
        "verified_zdr",
        "unknown",
      ]),
    },
  );
  const researchRouteCostPolicy = closedObject(
    ["pricingState", "pricingVersion", "currency", "accountingMode"],
    {
      pricingState: string(["known", "unknown"]),
      pricingVersion: string(),
      currency: string(),
      accountingMode: string([
        "provider_reported",
        "conservative_estimate",
        "unavailable",
      ]),
    },
  );
  const researchRoute = closedObject(
    [
      "routeId",
      "adapterId",
      "adapterVersion",
      "path",
      "providerId",
      "requestedModelId",
      "expectedServedModelId",
      "enabled",
      "liveQualified",
      "fallbackPosition",
      "capabilities",
      "parameterPolicy",
      "dataHandling",
      "costPolicy",
    ],
    {
      routeId: string(),
      adapterId: string(["gemini_direct", "openrouter"]),
      adapterVersion: string(),
      path: string(["gemini_direct", "openrouter"]),
      providerId: string(),
      requestedModelId: string(),
      expectedServedModelId: string(),
      enabled: boolean,
      liveQualified: boolean,
      fallbackPosition: { type: "integer", minimum: 0 },
      capabilities: {
        type: "array",
        items: string([
          "query_planning",
          "web_search_grounding",
          "retrieval",
          "structured_extraction",
          "advisory_synthesis",
        ]),
      },
      parameterPolicy: researchRouteParameterPolicy,
      dataHandling: researchRouteDataHandling,
      costPolicy: researchRouteCostPolicy,
    },
  );
  const candidate = closedObject(
    [
      "candidateId",
      "displayName",
      "countryCode",
      "rationaleShort",
      "rationaleClaimIds",
      "compatibilityScore",
      "fitBand",
      "bandCeiling",
      "displayedBand",
      "dimensionScores",
      "citations",
      "verificationStatus",
      "mandatoryConstraintsSatisfied",
      "failedConstraintIds",
      "deterministicRankKey",
    ],
    {
      candidateId: string(),
      displayName: string(),
      countryCode: string(),
      rationaleShort: string(),
      rationaleClaimIds: strings,
      compatibilityScore: number,
      fitBand: string(),
      bandCeiling: string(),
      displayedBand: string(),
      dimensionScores: {
        type: "object",
        additionalProperties: number,
      },
      citations: strings,
      verificationStatus: string([
        "claimed",
        "externally_verified",
        "inferred",
        "stale",
        "conflicting",
        "unknown",
        "synthetic",
      ]),
      mandatoryConstraintsSatisfied: boolean,
      failedConstraintIds: strings,
      deterministicRankKey: string(),
    },
  );
  const claim = closedObject(
    [
      "claimId",
      "candidateId",
      "text",
      "decisionBearing",
      "verificationStatus",
      "evidenceConfidence",
      "evidenceIds",
    ],
    {
      claimId: string(),
      candidateId: string(),
      text: string(),
      decisionBearing: boolean,
      verificationStatus: string([
        "claimed",
        "externally_verified",
        "inferred",
        "stale",
        "conflicting",
        "unknown",
        "synthetic",
      ]),
      evidenceConfidence: string(["high", "medium", "low"]),
      evidenceIds: strings,
    },
  );
  const evidenceItem = closedObject(
    [
      "evidenceId",
      "sourceKind",
      "url",
      "title",
      "publisher",
      "publisherDomain",
      "retrievedAt",
      "contentSha256",
      "extract",
      "verificationDisposition",
      "exclusionReason",
    ],
    {
      evidenceId: string(),
      sourceKind: string([
        "synthetic_fixture",
        "reserved_url",
        "local_fixture",
        "external_url",
      ]),
      url: string(),
      title: string(),
      publisher: string(),
      publisherDomain: string(),
      retrievedAt: string(),
      contentSha256: string(),
      extract: string(),
      verificationDisposition: string(["accepted", "excluded"]),
      exclusionReason: string(),
    },
  );
  const evidenceValueRecord = closedObject(
    [
      "valueId",
      "accountId",
      "runId",
      "candidateId",
      "claimId",
      "evidenceId",
      "fieldId",
      "valueSha256",
    ],
    {
      valueId: string(),
      accountId: string(),
      runId: string(),
      candidateId: string(),
      claimId: string(),
      evidenceId: string(),
      fieldId: string(),
      valueSha256: string(),
    },
  );
  const evidenceDriverRecord = closedObject(
    [
      "driverId",
      "accountId",
      "runId",
      "candidateId",
      "claimId",
      "valueId",
      "evidenceId",
      "dimensionId",
      "direction",
    ],
    {
      driverId: string(),
      accountId: string(),
      runId: string(),
      candidateId: string(),
      claimId: string(),
      valueId: string(),
      evidenceId: string(),
      dimensionId: string(),
      direction: string(["supports", "contradicts", "limits"]),
    },
  );
  const candidateIdentityResolution = closedObject(
    [
      "resolutionId",
      "accountId",
      "runId",
      "candidateId",
      "canonicalIdentitySha256",
      "disposition",
      "mergedIntoCandidateId",
      "resolverVersion",
      "reasonCode",
    ],
    {
      resolutionId: string(),
      accountId: string(),
      runId: string(),
      candidateId: string(),
      canonicalIdentitySha256: string(),
      disposition: string(["distinct", "duplicate", "rejected_ambiguous"]),
      mergedIntoCandidateId: { type: ["string", "null"] },
      resolverVersion: string(["candidate-identity-resolver.v1"]),
      reasonCode: string([
        "unique_canonical_identity",
        "duplicate_canonical_identity",
        "insufficient_identity",
        "canonical_hash_collision",
      ]),
    },
  );
  const standardVerificationStatus = string([
    "claimed",
    "externally_verified",
    "inferred",
    "stale",
    "conflicting",
    "unknown",
  ]);
  const standardConfidence = string(["high", "medium", "low"]);
  const standardFitBand = string(["strong_fit", "potential_fit", "low_fit"]);
  const standardMacro = string([
    "product_specification",
    "supplier_producer_profile",
    "trade_structure_commercial_execution",
  ]);
  const standardTypedValue: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["value_state"],
    properties: {
      value_state: string([
        "provided",
        "explicitly_unknown",
        "empty",
        "not_applicable",
        "not_asked",
      ]),
      value: string(),
      unit: string(),
      raw_expression: string(),
    },
    oneOf: [
      {
        required: ["value_state", "value"],
        properties: { value_state: { const: "provided" } },
      },
      ...["explicitly_unknown", "empty", "not_applicable", "not_asked"].map(
        (state) => ({
          required: ["value_state"],
          properties: { value_state: { const: state } },
          not: {
            anyOf: [
              { required: ["value"] },
              { required: ["unit"] },
              { required: ["raw_expression"] },
            ],
          },
        }),
      ),
    ],
  };
  const standardFieldValue = closedObject(
    ["field_id", "macro_parameter", "typed_value"],
    {
      field_id: string(),
      macro_parameter: standardMacro,
      typed_value: standardTypedValue,
    },
  );
  const canonicalStandardFieldValue = closedObject(
    ["field_id", "macro_parameter", "typed_value", "translated", "confidence"],
    {
      field_id: string(),
      macro_parameter: standardMacro,
      typed_value: standardTypedValue,
      translated: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  );
  const standardHardConstraint: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "constraint_id",
      "field_id",
      "operator",
      "target",
      "relaxability",
    ],
    properties: {
      constraint_id: string(),
      field_id: string(),
      operator: string([
        "equals",
        "not_equals",
        "minimum",
        "maximum",
        "includes",
        "excludes",
      ]),
      target: standardTypedValue,
      relaxability: string(["relaxable", "non_relaxable"]),
      tolerance: string(),
      direction: string([
        "higher_is_acceptable",
        "lower_is_acceptable",
        "exact",
      ]),
    },
    oneOf: [
      {
        required: ["tolerance", "direction"],
        properties: { relaxability: { const: "relaxable" } },
      },
      {
        properties: { relaxability: { const: "non_relaxable" } },
        not: {
          anyOf: [{ required: ["tolerance"] }, { required: ["direction"] }],
        },
      },
    ],
  };
  const standardExclusion = closedObject(
    ["exclusion_id", "field_id", "canonical_english_value"],
    {
      exclusion_id: string(),
      field_id: string(),
      canonical_english_value: string(),
    },
  );
  const domainField = closedObject(
    [
      "field_id",
      "macro_parameter",
      "label",
      "description",
      "kind",
      "requirement",
      "allowed_units",
      "allowed_values",
    ],
    {
      field_id: string(),
      macro_parameter: standardMacro,
      label: string(),
      description: string(),
      kind: string([
        "text",
        "integer",
        "decimal",
        "boolean",
        "single_select",
        "multi_select",
        "quantity",
      ]),
      requirement: string(["required", "conditional", "optional"]),
      allowed_units: strings,
      allowed_values: strings,
    },
  );
  const sourceValidation = closedObject(
    [
      "algorithm",
      "key_id",
      "source_digest",
      "source_start_byte",
      "source_end_byte",
      "byte_length",
    ],
    {
      algorithm: string(["HMAC-SHA-256"]),
      key_id: string(),
      source_digest: string(),
      source_start_byte: integer,
      source_end_byte: integer,
      byte_length: integer,
    },
  );
  const canonicalConditional = closedObject(
    [
      "requirement_id",
      "canonical_english_condition",
      "canonical_english_result",
      "requirement_level",
      "source_validation",
    ],
    {
      requirement_id: string(),
      canonical_english_condition: string(),
      canonical_english_result: string(),
      requirement_level: string(["mandatory", "preferred"]),
      source_validation: sourceValidation,
    },
  );
  const contradictionAlternative = closedObject(
    ["alternative_id", "canonical_english_value", "field_ids"],
    {
      alternative_id: string(),
      canonical_english_value: string(),
      field_ids: strings,
    },
  );
  const standardContradiction: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "contradiction_id",
      "contradiction_class",
      "alternatives",
      "resolution_state",
    ],
    properties: {
      contradiction_id: string(),
      contradiction_class: string([
        "hard_constraint",
        "conditional",
        "field_value",
      ]),
      alternatives: { type: "array", items: contradictionAlternative },
      resolution_state: string(["unresolved", "resolved_by_owner"]),
      selected_alternative_id: string(),
    },
    oneOf: [
      {
        properties: { resolution_state: { const: "unresolved" } },
        not: { required: ["selected_alternative_id"] },
      },
      {
        required: ["selected_alternative_id"],
        properties: { resolution_state: { const: "resolved_by_owner" } },
      },
    ],
  };
  const dimensionDefinitions = [
    ["category_product_fit", 25],
    ["compliance_certification_fit", 20],
    ["volume_capacity_fit", 15],
    ["price_tier_fit", 15],
    ["positioning_brand_fit", 15],
    ["geographic_reach_fit", 10],
  ] as const;
  const standardDimensionSchemas = dimensionDefinitions.map(
    ([dimensionId, weight]) =>
      closedObject(["dimension_id", "weight", "score", "confidence"], {
        dimension_id: string([dimensionId]),
        weight: { type: "integer", enum: [weight] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        confidence: standardConfidence,
      }),
  );
  const standardDimensions: JsonSchema = {
    type: "array",
    prefixItems: standardDimensionSchemas,
    items: false,
    minItems: 6,
    maxItems: 6,
  };
  const standardEvidenceItem: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "evidence_id",
      "source_kind",
      "title",
      "publisher",
      "publisher_domain",
      "published_or_updated",
      "accessed_at",
      "source_tier",
      "verification_status",
      "access_state",
      "volatility_class",
      "extract",
      "content_sha256",
      "verification_disposition",
      "provenance",
    ],
    properties: {
      evidence_id: string(),
      source_kind: string([
        "synthetic_fixture",
        "local_fixture",
        "reserved_url",
      ]),
      exact_url: string(),
      fixture_identity: string(),
      title: string(),
      publisher: string(),
      publisher_domain: string(),
      published_or_updated: string(),
      accessed_at: string(),
      source_tier: string(["primary", "official_secondary", "secondary"]),
      verification_status: standardVerificationStatus,
      access_state: string(["available", "blocked", "unreachable"]),
      volatility_class: string(["stable", "moderate", "volatile"]),
      extract: string(),
      content_sha256: string(),
      verification_disposition: string(["accepted", "excluded"]),
      exclusion_reason: { type: "string", pattern: "\\S" },
      provenance: string(["synthetic_fixture", "repository_fixture"]),
    },
    allOf: [
      {
        oneOf: [
          {
            required: ["exact_url"],
            not: { required: ["fixture_identity"] },
          },
          {
            required: ["fixture_identity"],
            not: { required: ["exact_url"] },
          },
        ],
      },
      {
        oneOf: [
          {
            properties: {
              verification_disposition: { const: "accepted" },
            },
            not: { required: ["exclusion_reason"] },
          },
          {
            required: ["exclusion_reason"],
            properties: {
              verification_disposition: { const: "excluded" },
            },
          },
        ],
      },
    ],
  };
  const completeResultEvidenceV2Properties = {
    ...(standardEvidenceItem.properties as Readonly<
      Record<string, JsonSchema>
    >),
    evidence_id: { type: "string", minLength: 1 },
    exact_url: { type: "string", format: "uri", pattern: "^https://" },
    publisher_domain: { type: "string", minLength: 1 },
    accessed_at: { type: "string", format: "date-time" },
    extract: { type: "string", minLength: 1, maxLength: 600 },
    content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  } as const;
  const completeResultNonLiveEvidenceV2: JsonSchema = {
    ...standardEvidenceItem,
    properties: {
      ...completeResultEvidenceV2Properties,
      provenance: string(["synthetic_fixture", "repository_fixture"]),
    },
  };
  const noExternalVerificationBasisV2 = closedObject(["kind"], {
    kind: { const: "not_externally_verified" },
  });
  const independentExternalVerificationBasisV2 = closedObject(
    ["kind", "independent_evidence_ids"],
    {
      kind: { const: "independent_corroboration" },
      independent_evidence_ids: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 2,
        uniqueItems: true,
      },
    },
  );
  const registryExternalVerificationBasisV2 = closedObject(
    ["kind", "registry_evidence_id"],
    {
      kind: { const: "authoritative_registry" },
      registry_evidence_id: { type: "string", minLength: 1 },
    },
  );
  const externalVerificationBasisV2: JsonSchema = {
    oneOf: [
      noExternalVerificationBasisV2,
      independentExternalVerificationBasisV2,
      registryExternalVerificationBasisV2,
    ],
  };
  const completeResultLiveEvidenceV2: JsonSchema = {
    ...standardEvidenceItem,
    required: [
      ...(standardEvidenceItem.required as readonly string[]),
      "exact_url",
      "external_verification_basis",
    ],
    properties: {
      ...completeResultEvidenceV2Properties,
      source_kind: { const: "reserved_url" },
      provenance: { const: "live_secure_fetch" },
      external_verification_basis: externalVerificationBasisV2,
    },
    not: { required: ["fixture_identity"] },
    allOf: [
      (standardEvidenceItem.allOf as readonly JsonSchema[])[1]!,
      {
        oneOf: [
          {
            properties: {
              verification_status: { const: "externally_verified" },
              external_verification_basis: {
                oneOf: [
                  independentExternalVerificationBasisV2,
                  registryExternalVerificationBasisV2,
                ],
              },
            },
          },
          {
            properties: {
              verification_status: string([
                "claimed",
                "inferred",
                "stale",
                "conflicting",
                "unknown",
              ]),
              external_verification_basis: noExternalVerificationBasisV2,
            },
          },
        ],
      },
    ],
  };
  const completeResultEvidenceV2: JsonSchema = {
    oneOf: [completeResultNonLiveEvidenceV2, completeResultLiveEvidenceV2],
  };
  const demoRationaleSourceV2: JsonSchema = {
    oneOf: Object.entries(DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME).map(
      ([ruleOutcome, rationaleShort]) =>
        closedObject(["candidate_id", "rule_outcome", "rationale_short"], {
          candidate_id: string(),
          rule_outcome: { const: ruleOutcome },
          rationale_short: { const: rationaleShort },
        }),
    ),
  };
  const demoLowConfidenceCautionV2: JsonSchema = {
    oneOf: [
      closedObject(["state", "text"], {
        state: { const: "not_required" },
        text: { const: "" },
      }),
      closedObject(["state", "text"], {
        state: { const: "present" },
        text: { const: DEMO_LOW_CONFIDENCE_CAUTION_TEXT },
      }),
    ],
  };
  const corroboration = closedObject(
    ["required", "status", "independent_evidence_ids"],
    {
      required: boolean,
      status: string(["not_required", "satisfied", "missing", "conflicting"]),
      independent_evidence_ids: strings,
    },
  );
  const standardClaim = closedObject(
    [
      "claim_id",
      "candidate_id",
      "text",
      "decision_bearing",
      "high_risk",
      "verification_status",
      "evidence_confidence",
      "evidence_ids",
      "corroboration",
    ],
    {
      claim_id: string(),
      candidate_id: string(),
      text: string(),
      decision_bearing: boolean,
      high_risk: boolean,
      verification_status: standardVerificationStatus,
      evidence_confidence: standardConfidence,
      evidence_ids: strings,
      corroboration,
    },
  );
  const standardEvidencedValue: JsonSchema = {
    oneOf: [
      closedObject(
        [
          "value_id",
          "candidate_id",
          "kind",
          "channel_type",
          "value",
          "organization_domain",
          "verification_status",
          "evidence_ids",
        ],
        {
          value_id: string(),
          candidate_id: string(),
          kind: string(["organization_contact"]),
          channel_type: string(["role_email", "organization_phone"]),
          value: string(),
          organization_domain: string(),
          verification_status: standardVerificationStatus,
          evidence_ids: strings,
        },
      ),
      closedObject(
        [
          "value_id",
          "candidate_id",
          "kind",
          "channel_type",
          "value",
          "organization_domain",
          "organization_web_policy_version",
          "organization_web_purpose",
          "organization_web_form",
          "verification_status",
          "evidence_ids",
        ],
        {
          value_id: string(),
          candidate_id: string(),
          kind: string(["organization_contact"]),
          channel_type: string(["organization_web"]),
          value: string(),
          organization_domain: string(),
          organization_web_policy_version: string([
            STANDARD_ORGANIZATION_WEB_POLICY_VERSION,
          ]),
          organization_web_purpose: string([
            "organization_root",
            ...STANDARD_ORGANIZATION_WEB_PURPOSES,
          ]),
          organization_web_form: string([
            "root",
            "role_path",
            "role_subdomain",
            "contact_role_path",
          ]),
          verification_status: standardVerificationStatus,
          evidence_ids: strings,
        },
      ),
      closedObject(
        [
          "value_id",
          "candidate_id",
          "kind",
          "value",
          "verification_status",
          "evidence_ids",
        ],
        {
          value_id: string(),
          candidate_id: string(),
          kind: string(["plant", "approval", "capacity"]),
          value: string(),
          verification_status: standardVerificationStatus,
          evidence_ids: strings,
        },
      ),
    ],
  };
  const standardHiddenCandidate = closedObject(
    [
      "candidate_id",
      "display_name",
      "country_code",
      "rationale_extended",
      "rationale_claim_ids",
      "mandatory_constraints_satisfied",
      "failed_constraint_ids",
      "dimensions",
      "verification_status",
      "evidence_confidence",
      "deterministic_tie_breaker",
    ],
    {
      candidate_id: string(),
      display_name: string(),
      country_code: string(),
      rationale_extended: string(),
      rationale_claim_ids: strings,
      mandatory_constraints_satisfied: boolean,
      failed_constraint_ids: strings,
      dimensions: standardDimensions,
      verification_status: standardVerificationStatus,
      evidence_confidence: standardConfidence,
      deterministic_tie_breaker: string(),
    },
  );
  const gateEvaluation = closedObject(
    ["gate_id", "label", "eliminated_count"],
    {
      gate_id: string(),
      label: string(),
      eliminated_count: { type: "integer", minimum: 0 },
    },
  );
  const consultantMissingSources: JsonSchema = {
    type: "array",
    prefixItems: CONSULTANT_UNAVAILABLE_SOURCE_IDS.map((sourceId) =>
      closedObject(["source_id", "status", "reason_code"], {
        source_id: string([sourceId]),
        status: string(["unavailable"]),
        reason_code: string(["not_produced_by_current_pipeline"]),
      }),
    ),
    items: false,
    minItems: CONSULTANT_UNAVAILABLE_SOURCE_IDS.length,
    maxItems: CONSULTANT_UNAVAILABLE_SOURCE_IDS.length,
  };
  const consultantProjectionReadiness = closedObject(
    ["outcome", "missing_sources"],
    {
      outcome: string(["blocked"]),
      missing_sources: consultantMissingSources,
    },
  );
  const standardCitation: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "evidence_id",
      "title",
      "publisher",
      "published_or_updated",
      "accessed_at",
      "source_tier",
      "status",
      "access_state",
      "extract",
      "content_sha256",
      "provenance",
    ],
    properties: {
      evidence_id: string(),
      exact_url: { type: "string", format: "uri", pattern: "^https://" },
      fixture_identity: { type: "string", minLength: 1 },
      title: string(),
      publisher: string(),
      published_or_updated: string(),
      accessed_at: string(),
      source_tier: string(["primary", "official_secondary", "secondary"]),
      status: standardVerificationStatus,
      access_state: string(["available", "blocked", "unreachable"]),
      extract: string(),
      content_sha256: string(),
      provenance: string([
        "synthetic_fixture",
        "repository_fixture",
        "live_secure_fetch",
      ]),
    },
    oneOf: [
      {
        required: ["exact_url"],
        not: { required: ["fixture_identity"] },
      },
      {
        required: ["fixture_identity"],
        not: { required: ["exact_url"] },
      },
    ],
  };
  const explanation = closedObject(
    ["dimension_id", "explanation", "claim_id", "evidence_ids"],
    {
      dimension_id: string(),
      explanation: string(),
      claim_id: string(),
      evidence_ids: strings,
    },
  );
  const projectedValue: JsonSchema = {
    oneOf: [
      closedObject(
        [
          "kind",
          "channel_type",
          "value",
          "organization_domain",
          "verification_status",
          "evidence_ids",
        ],
        {
          kind: string(["organization_contact"]),
          channel_type: string(["role_email", "organization_phone"]),
          value: string(),
          organization_domain: string(),
          verification_status: standardVerificationStatus,
          evidence_ids: strings,
        },
      ),
      closedObject(
        [
          "kind",
          "channel_type",
          "value",
          "organization_domain",
          "organization_web_policy_version",
          "organization_web_purpose",
          "organization_web_form",
          "verification_status",
          "evidence_ids",
        ],
        {
          kind: string(["organization_contact"]),
          channel_type: string(["organization_web"]),
          value: string(),
          organization_domain: string(),
          organization_web_policy_version: string([
            STANDARD_ORGANIZATION_WEB_POLICY_VERSION,
          ]),
          organization_web_purpose: string([
            "organization_root",
            ...STANDARD_ORGANIZATION_WEB_PURPOSES,
          ]),
          organization_web_form: string([
            "root",
            "role_path",
            "role_subdomain",
            "contact_role_path",
          ]),
          verification_status: standardVerificationStatus,
          evidence_ids: strings,
        },
      ),
      closedObject(["kind", "value", "verification_status", "evidence_ids"], {
        kind: string(["plant", "approval", "capacity"]),
        value: string(),
        verification_status: standardVerificationStatus,
        evidence_ids: strings,
      }),
    ],
  };
  const standardCandidateProjection = closedObject(
    [
      "display_name",
      "country_code",
      "rationale_extended",
      "compatibility_score",
      "fit_band",
      "band_ceiling",
      "displayed_band",
      "dimension_scores",
      "positive_drivers",
      "limiting_gaps",
      "citations",
      "freshness",
      "verification_status",
      "evidence_confidence",
    ],
    {
      display_name: string(),
      country_code: string(),
      rationale_extended: string(),
      compatibility_score: { type: "integer", minimum: 0, maximum: 100 },
      fit_band: standardFitBand,
      band_ceiling: standardFitBand,
      displayed_band: standardFitBand,
      band_ceiling_reason: { type: "string", pattern: "\\S" },
      dimension_scores: standardDimensions,
      positive_drivers: { type: "array", items: explanation, maxItems: 3 },
      limiting_gaps: { type: "array", items: explanation, maxItems: 3 },
      citations: { type: "array", items: standardCitation },
      freshness: string(["current", "stale", "mixed"]),
      verification_status: standardVerificationStatus,
      evidence_confidence: standardConfidence,
      contact_details: { type: "array", items: projectedValue },
      plant_identifiers: { type: "array", items: projectedValue },
      approval_identifiers: { type: "array", items: projectedValue },
      capacity_figures: { type: "array", items: projectedValue },
    },
  );
  const limitations = closedObject(
    [
      "unknown_count",
      "not_asked_count",
      "affected_low_confidence_dimensions",
      "evidence_states",
      "restricted_party_screening_notice",
      "advisory_boundary",
    ],
    {
      unknown_count: { type: "integer", minimum: 0 },
      not_asked_count: { type: "integer", minimum: 0 },
      affected_low_confidence_dimensions: strings,
      evidence_states: { type: "array", items: standardVerificationStatus },
      cap_notice: string(),
      restricted_party_screening_notice: string(),
      advisory_boundary: string(),
    },
  );
  const scarcityAnalysis = closedObject(
    [
      "reducing_constraints",
      "unmet_mandatory_constraints",
      "permitted_relaxations",
    ],
    {
      reducing_constraints: {
        type: "array",
        items: closedObject(
          ["constraint_id", "field_id", "label", "eliminated_count"],
          {
            constraint_id: string(),
            field_id: string(),
            label: string(),
            eliminated_count: { type: "integer", minimum: 1 },
          },
        ),
      },
      unmet_mandatory_constraints: {
        type: "array",
        items: closedObject(["constraint_id", "field_id", "label"], {
          constraint_id: string(),
          field_id: string(),
          label: string(),
        }),
      },
      permitted_relaxations: {
        type: "array",
        items: closedObject(
          ["constraint_id", "field_id", "label", "direction", "tolerance"],
          {
            constraint_id: string(),
            field_id: string(),
            label: string(),
            direction: string([
              "higher_is_acceptable",
              "lower_is_acceptable",
              "exact",
            ]),
            tolerance: string(),
          },
        ),
      },
    },
  );
  const consultantLandscape = closedObject(
    [
      "eligible_count",
      "displayed_count",
      "soft_cap",
      "truncated",
      "scarcity_override_applied",
    ],
    {
      eligible_count: { type: "integer", minimum: 0 },
      displayed_count: { type: "integer", minimum: 0 },
      soft_cap: { type: "integer", minimum: 3 },
      truncated: boolean,
      scarcity_override_applied: boolean,
      truncation_notice: { type: "string", pattern: "\\S" },
    },
  );
  const consultantSourceReadiness = closedObject(["state", "notice"], {
    state: string(["limited"]),
    notice: { type: "string", pattern: "\\S" },
  });
  const consultantRankedCandidate = closedObject(
    [
      "candidate_id",
      "rank",
      "display_name",
      "country_code",
      "projection_index",
      "evidence_ids",
    ],
    {
      candidate_id: { type: "string", minLength: 1 },
      rank: { type: "integer", minimum: 1 },
      display_name: { type: "string", minLength: 1 },
      country_code: { type: "string", minLength: 1 },
      projection_index: {
        oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
      },
      evidence_ids: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
    },
  );
  const consultantReserveCandidate = closedObject(
    [
      "candidate_id",
      "rank",
      "display_name",
      "country_code",
      "projection_index",
      "evidence_ids",
      "eligibility_basis",
      "promotion_state",
    ],
    {
      candidate_id: { type: "string", minLength: 1 },
      rank: { type: "integer", minimum: 1 },
      display_name: { type: "string", minLength: 1 },
      country_code: { type: "string", minLength: 1 },
      projection_index: {
        oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
      },
      evidence_ids: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
      eligibility_basis: string(["eligible_candidate_ids_only"]),
      promotion_state: string(["next_ranked_eligible"]),
    },
  );
  const consultantConfigurationRelease = closedObject(
    [
      "config_id",
      "config_version",
      "content_sha256",
      "bound_at",
      "effective_release_at",
      "soft_cap",
    ],
    {
      config_id: { type: "string", format: "uuid" },
      config_version: { type: "string", minLength: 1 },
      content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      bound_at: { type: "string", format: "date-time", pattern: "Z$" },
      effective_release_at: {
        type: "string",
        format: "date-time",
        pattern: "Z$",
      },
      soft_cap: { type: "integer", minimum: 3 },
    },
  );
  const consultantRfqExecutionSnapshot = closedObject(
    [
      "state",
      "contact_state",
      "response_state",
      "qualified_response_count",
      "expansion_model",
      "wave_id",
      "wave_sequence",
      "wave_instance_id",
      "selected_candidates",
      "remaining_displayed_queue",
      "stop_state",
      "next_reserve_promotion",
      "audit_identity",
    ],
    {
      state: string([
        "synthetic_planning_only",
        "governed_agricultural_planning_only",
      ]),
      contact_state: string(["not_contacted"]),
      response_state: string(["not_collected"]),
      qualified_response_count: { type: "integer", enum: [0] },
      expansion_model: closedObject(
        [
          "initial_wave_size",
          "subsequent_wave_size",
          "expansion_threshold",
          "effective_expansion_threshold",
        ],
        {
          initial_wave_size: { type: "integer", enum: [3] },
          subsequent_wave_size: { type: "integer", enum: [2] },
          expansion_threshold: { type: "integer", enum: [3] },
          effective_expansion_threshold: {
            type: "integer",
            minimum: 0,
            maximum: 3,
          },
        },
      ),
      wave_id: string(["RFQ_WAVE_INITIAL"]),
      wave_sequence: { type: "integer", enum: [1] },
      wave_instance_id: { type: "string", pattern: "^[a-f0-9]{64}$" },
      selected_candidates: {
        type: "array",
        items: consultantRankedCandidate,
        maxItems: 3,
      },
      remaining_displayed_queue: {
        type: "array",
        items: consultantRankedCandidate,
      },
      stop_state: string([
        "awaiting_synthetic_checkpoint",
        "awaiting_governed_agricultural_checkpoint",
        "exhausted_displayed_queue",
      ]),
      next_reserve_promotion: closedObject(
        ["state", "candidate", "promotion_mode"],
        {
          state: string(["available", "exhausted"]),
          candidate: {
            oneOf: [consultantReserveCandidate, { type: "null" }],
          },
          promotion_mode: string(["one_next_ranked_eligible_only"]),
        },
      ),
      audit_identity: closedObject(
        [
          "event_type",
          "event_id",
          "actor_type",
          "actor_id",
          "occurred_at",
          "policy_id",
          "policy_version",
          "policy_content_sha256",
          "config_id",
          "config_version",
          "config_content_sha256",
        ],
        {
          event_type: string([
            "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED",
            "AGRICULTURAL_WAVE_SNAPSHOT_PROJECTED",
          ]),
          event_id: { type: "string", pattern: "^[a-f0-9]{64}$" },
          actor_type: string(["agent"]),
          actor_id: string([
            "matchbase_agent_research_and_implementation_team",
          ]),
          occurred_at: { type: "string", format: "date-time", pattern: "Z$" },
          policy_id: string([CONSULTANT_SOURCE_POLICY_ID]),
          policy_version: {
            type: "integer",
            enum: [CONSULTANT_SOURCE_POLICY_VERSION],
          },
          policy_content_sha256: string([
            CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
          ]),
          config_id: { type: "string", format: "uuid" },
          config_version: { type: "string", minLength: 1 },
          config_content_sha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
        },
      ),
    },
  );
  const consultantSourceFact: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "evidence_id",
      "title",
      "publisher",
      "published_or_updated",
      "accessed_at",
      "source_tier",
      "status",
      "access_state",
      "extract",
      "content_sha256",
      "provenance",
      "verification_disposition",
    ],
    properties: {
      evidence_id: { type: "string", minLength: 1 },
      exact_url: { type: "string", format: "uri", pattern: "^https://" },
      fixture_identity: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      publisher: { type: "string", minLength: 1 },
      publisher_domain: { type: "string", minLength: 1 },
      published_or_updated: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T.*Z)?$",
      },
      accessed_at: { type: "string", format: "date-time", pattern: "Z$" },
      source_tier: string(["primary", "official_secondary", "secondary"]),
      status: standardVerificationStatus,
      access_state: string(["available", "blocked", "unreachable"]),
      extract: { type: "string", minLength: 1, maxLength: 2000 },
      content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      provenance: string([
        "synthetic_fixture",
        "repository_fixture",
        "live_secure_fetch",
      ]),
      verification_disposition: string(["accepted", "excluded"]),
      exclusion_reason: { type: "string", pattern: "\\S" },
    },
    allOf: [
      {
        oneOf: [
          {
            required: ["exact_url", "publisher_domain"],
            properties: { provenance: { const: "live_secure_fetch" } },
            not: { required: ["fixture_identity"] },
          },
          {
            required: ["fixture_identity"],
            properties: {
              provenance: {
                enum: ["synthetic_fixture", "repository_fixture"],
              },
            },
            not: {
              anyOf: [
                { required: ["exact_url"] },
                { required: ["publisher_domain"] },
              ],
            },
          },
        ],
      },
      {
        oneOf: [
          {
            properties: { verification_disposition: { const: "accepted" } },
            not: { required: ["exclusion_reason"] },
          },
          {
            required: ["exclusion_reason"],
            properties: { verification_disposition: { const: "excluded" } },
          },
        ],
      },
    ],
  };
  const consultantExcludedEvidence: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "evidence_id",
      "title",
      "publisher",
      "published_or_updated",
      "accessed_at",
      "source_tier",
      "status",
      "access_state",
      "extract",
      "content_sha256",
      "provenance",
      "verification_disposition",
      "exclusion_reason",
    ],
    properties: {
      evidence_id: { type: "string", minLength: 1 },
      exact_url: { type: "string", format: "uri", pattern: "^https://" },
      fixture_identity: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      publisher: { type: "string", minLength: 1 },
      publisher_domain: { type: "string", minLength: 1 },
      published_or_updated: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T.*Z)?$",
      },
      accessed_at: { type: "string", format: "date-time", pattern: "Z$" },
      source_tier: string(["primary", "official_secondary", "secondary"]),
      status: standardVerificationStatus,
      access_state: string(["available", "blocked", "unreachable"]),
      extract: { type: "string", minLength: 1, maxLength: 2000 },
      content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      provenance: string([
        "synthetic_fixture",
        "repository_fixture",
        "live_secure_fetch",
      ]),
      verification_disposition: string(["excluded"]),
      exclusion_reason: { type: "string", pattern: "\\S" },
    },
    oneOf: [
      {
        required: ["exact_url", "publisher_domain"],
        properties: { provenance: { const: "live_secure_fetch" } },
        not: { required: ["fixture_identity"] },
      },
      {
        required: ["fixture_identity"],
        properties: {
          provenance: { enum: ["synthetic_fixture", "repository_fixture"] },
        },
        not: {
          anyOf: [
            { required: ["exact_url"] },
            { required: ["publisher_domain"] },
          ],
        },
      },
    ],
  };
  const projectionLinks = closedObject(["request", "run"], {
    request: string(),
    run: string(),
    result: string(),
  });
  const requestHistoryItem = closedObject(
    [
      "request_id",
      "canonical_summary",
      "version_count",
      "created_at",
      "updated_at",
      "latest_run_state",
      "latest_run_outcome",
      "links",
    ],
    {
      request_id: string(),
      canonical_summary: string(),
      version_count: { type: "integer", minimum: 1 },
      created_at: string(),
      updated_at: string(),
      latest_run_state: string([
        "not_started",
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "superseded",
      ]),
      latest_run_outcome: string([
        "not_started",
        "pending",
        "matched",
        "no_responsible_match",
        "failed",
        "cancelled",
        "superseded",
      ]),
      links: projectionLinks,
    },
  );
  const runStateProperties: Readonly<Record<string, JsonSchema>> = {
    run_id: string(),
    request_id: string(),
    canonical_request_version: { type: "integer", minimum: 1 },
    state: string([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "superseded",
    ]),
    phase: string(),
    phase_label: string(),
    progress: { type: "integer", minimum: 0, maximum: 100 },
    started_at: string(),
    updated_at: string(),
    estimated_completion_at: string(),
    poll_after_ms: { type: "integer", minimum: 0 },
    terminal: boolean,
    result_available: boolean,
    outcome: string([
      "pending",
      "matched",
      "no_responsible_match",
      "failed",
      "cancelled",
      "superseded",
    ]),
    scarcity: string(["pending", "none", "limited", "zero", "not_applicable"]),
    limitations_notice: string(),
    links: projectionLinks,
    projection_version: {
      type: "integer",
      enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
    },
  };
  const runStateRequired = [
    "run_id",
    "request_id",
    "canonical_request_version",
    "state",
    "phase",
    "phase_label",
    "progress",
    "started_at",
    "updated_at",
    "terminal",
    "result_available",
    "outcome",
    "scarcity",
    "limitations_notice",
    "links",
    "projection_version",
  ] as const;
  const runStateVariants: JsonSchema[] = [
    {
      required: ["poll_after_ms"],
      properties: {
        state: { enum: ["queued", "running"] },
        terminal: { const: false },
        result_available: { const: false },
        outcome: { const: "pending" },
        scarcity: { const: "pending" },
      },
    },
    {
      properties: {
        state: { enum: ["completed", "failed", "cancelled", "superseded"] },
        terminal: { const: true },
        outcome: {
          enum: [
            "matched",
            "no_responsible_match",
            "failed",
            "cancelled",
            "superseded",
          ],
        },
        scarcity: { enum: ["none", "limited", "zero", "not_applicable"] },
      },
      not: {
        anyOf: [
          { required: ["poll_after_ms"] },
          { required: ["estimated_completion_at"] },
        ],
      },
    },
  ];
  const runHistoryItem: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: runStateRequired,
    properties: runStateProperties,
    oneOf: runStateVariants,
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    bundleVersion: "matchbase-contracts.v1",
    schemas: {
      canonicalRequest: closedObject(
        [
          "schemaVersion",
          "requestId",
          "canonicalVersionId",
          "version",
          "canonicalLanguage",
          "canonicalText",
          "language",
          "fields",
          "protectedSpans",
          "provenance",
          "originalTextDigest",
          "readiness",
          "contradictionIds",
        ],
        {
          schemaVersion: string(["canonical-request.v1"]),
          requestId: string(),
          canonicalVersionId: string(),
          version: integer,
          canonicalLanguage: string(["en"]),
          canonicalText: string(),
          language,
          fields: { type: "array", items: canonicalField },
          protectedSpans: { type: "array", items: protectedSpan },
          provenance: { type: "array", items: provenance },
          originalTextDigest: digest,
          readiness: string(["ready", "partially_ready", "not_ready"]),
          contradictionIds: strings,
        },
      ),
      consultantRunHistory: closedObject(["schema_version", "items"], {
        schema_version: string(["consultant-run-history.v1"]),
        items: {
          type: "array",
          items: closedObject(
            [
              "run_id",
              "request_id",
              "state",
              "updated_at",
              "result_available",
              "outcome",
            ],
            {
              run_id: string(),
              request_id: string(),
              state: string([
                "queued",
                "running",
                "completed",
                "failed",
                "cancelled",
                "superseded",
              ]),
              updated_at: string(),
              result_available: boolean,
              outcome: string([
                "pending",
                "matched",
                "no_responsible_match",
                "failed",
                "cancelled",
                "superseded",
              ]),
            },
          ),
        },
      }),
      providerRegistry: closedObject(
        [
          "schemaVersion",
          "registryVersion",
          "environment",
          "realData",
          "routes",
        ],
        {
          schemaVersion: string(["provider-registry.v1"]),
          registryVersion: string(),
          environment: string(["local", "test", "staging", "production"]),
          realData: boolean,
          routes: { type: "array", items: route },
        },
      ),
      researchRoutePolicy: closedObject(
        [
          "schemaVersion",
          "policyVersion",
          "capabilityPolicyVersion",
          "environment",
          "evaluatedAt",
          "liveActivation",
          "routes",
        ],
        {
          schemaVersion: string(["research-route-policy.v1"]),
          policyVersion: string(),
          capabilityPolicyVersion: string(),
          environment: string(["local", "test", "staging", "production"]),
          evaluatedAt: string(),
          liveActivation: string(["enabled", "blocked"]),
          routes: { type: "array", items: researchRoute },
        },
      ),
      researchRouteSnapshot: closedObject(
        [
          "schemaVersion",
          "snapshotId",
          "runId",
          "policyVersion",
          "routeId",
          "adapterId",
          "adapterVersion",
          "path",
          "providerId",
          "requestedModelId",
          "servedProviderId",
          "servedModelId",
          "capabilityPolicyVersion",
          "parameterPolicy",
          "dataHandlingEvidenceVersion",
          "fallbackPosition",
          "capturedAt",
        ],
        {
          schemaVersion: string(["research-route-snapshot.v1"]),
          snapshotId: string(),
          runId: string(),
          policyVersion: string(),
          routeId: string(),
          adapterId: string(["gemini_direct", "openrouter"]),
          adapterVersion: string(),
          path: string(["gemini_direct", "openrouter"]),
          providerId: string(),
          requestedModelId: string(),
          servedProviderId: string(),
          servedModelId: string(),
          capabilityPolicyVersion: string(),
          parameterPolicy: researchRouteParameterPolicy,
          dataHandlingEvidenceVersion: string(),
          fallbackPosition: { type: "integer", minimum: 0 },
          capturedAt: string(),
        },
      ),
      evidenceGraph: closedObject(
        [
          "schemaVersion",
          "runId",
          "candidates",
          "claims",
          "evidence",
          "eligibleCandidateIds",
          "gateEvaluationCompletedAt",
        ],
        {
          schemaVersion: string(["evidence-graph.v1"]),
          runId: string(),
          candidates: { type: "array", items: candidate },
          claims: { type: "array", items: claim },
          evidence: { type: "array", items: evidenceItem },
          eligibleCandidateIds: strings,
          gateEvaluationCompletedAt: string(),
        },
      ),
      evidenceLineageLedger: closedObject(
        [
          "schemaVersion",
          "accountId",
          "runId",
          "values",
          "drivers",
          "identityResolutions",
        ],
        {
          schemaVersion: string(["evidence-lineage-ledger.v1"]),
          accountId: string(),
          runId: string(),
          values: { type: "array", items: evidenceValueRecord },
          drivers: { type: "array", items: evidenceDriverRecord },
          identityResolutions: {
            type: "array",
            items: candidateIdentityResolution,
          },
        },
      ),
      demoProjection: closedObject(
        [
          "schema_version",
          "run_id",
          "outcome",
          "scarcity",
          "candidates",
          "unmet_mandatory_constraints",
          "limitations_notice",
          "projection_version",
        ],
        {
          schema_version: string(["demo-projection.v1"]),
          run_id: string(),
          outcome: string(["matched", "no_responsible_match"]),
          scarcity: string(["none", "limited", "zero"]),
          candidates: {
            type: "array",
            items: closedObject(
              ["display_name", "country_code", "rationale_short"],
              {
                display_name: string(),
                country_code: string(),
                rationale_short: string(),
              },
            ),
          },
          unmet_mandatory_constraints: strings,
          limitations_notice: string(),
          projection_version: { type: "integer", enum: [1] },
        },
      ),
      domainPack: closedObject(
        [
          "schema_version",
          "registry_version",
          "pack_version",
          "category_id",
          "category_label",
          "macro_parameters",
          "core_fields",
          "domain_fields",
          "synthetic",
        ],
        {
          schema_version: string(["domain-pack.v1"]),
          registry_version: string(),
          pack_version: string(),
          category_id: string(),
          category_label: string(),
          macro_parameters: {
            type: "array",
            prefixItems: [
              string(["product_specification"]),
              string(["supplier_producer_profile"]),
              string(["trade_structure_commercial_execution"]),
            ],
            items: false,
            minItems: 3,
            maxItems: 3,
          },
          core_fields: { type: "array", items: domainField },
          domain_fields: { type: "array", items: domainField },
          synthetic: { type: "boolean", enum: [true] },
        },
      ),
      domainPackV2: closedObject(
        [
          "schema_version",
          "discriminator",
          "registry_version",
          "pack_version",
          "category_id",
          "category_label",
          "macro_parameters",
          "core_fields",
          "domain_fields",
          "synthetic",
          "content_sha256",
        ],
        {
          schema_version: string(["domain-pack.v2"]),
          discriminator: string(["food_agricultural_commodity"]),
          registry_version: string(),
          pack_version: string(),
          category_id: string(),
          category_label: string(),
          macro_parameters: {
            type: "array",
            prefixItems: [
              string(["product_specification"]),
              string(["supplier_producer_profile"]),
              string(["trade_structure_commercial_execution"]),
            ],
            items: false,
            minItems: 3,
            maxItems: 3,
          },
          core_fields: { type: "array", items: domainField },
          domain_fields: { type: "array", items: domainField },
          synthetic: { type: "boolean", enum: [false] },
          content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
      ),
      domainPackResolution: {
        type: "object",
        additionalProperties: false,
        required: [
          "schema_version",
          "resolver_version",
          "confidence",
          "activation_state",
          "synthetic",
        ],
        properties: {
          schema_version: string(["domain-pack-resolution.v1"]),
          resolver_version: string(),
          category_id: string(),
          confidence: { type: "number", minimum: 0, maximum: 1 },
          activation_state: string([
            "confirmed",
            "confirmation_required",
            "unresolved",
          ]),
          activation_token: string(),
          pack_version: string(),
          synthetic: { type: "boolean", enum: [true] },
        },
        oneOf: [
          {
            required: ["category_id", "pack_version", "activation_token"],
            properties: { activation_state: { const: "confirmed" } },
          },
          {
            required: ["category_id", "pack_version"],
            properties: {
              activation_state: { const: "confirmation_required" },
            },
            not: { required: ["activation_token"] },
          },
          {
            properties: { activation_state: { const: "unresolved" } },
            not: {
              anyOf: [
                { required: ["category_id"] },
                { required: ["pack_version"] },
                { required: ["activation_token"] },
              ],
            },
          },
        ],
      },
      domainPackResolutionV2: {
        type: "object",
        additionalProperties: false,
        required: [
          "schema_version",
          "discriminator",
          "resolver_version",
          "confidence",
          "activation_state",
          "synthetic",
        ],
        properties: {
          schema_version: string(["domain-pack-resolution.v2"]),
          discriminator: string(["food_agricultural_commodity"]),
          resolver_version: string(),
          category_id: string(),
          confidence: { type: "number", minimum: 0, maximum: 1 },
          activation_state: string([
            "confirmed",
            "confirmation_required",
            "unresolved",
          ]),
          activation_token: string(),
          pack_version: string(),
          content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          synthetic: { type: "boolean", enum: [false] },
        },
        oneOf: [
          {
            required: [
              "category_id",
              "pack_version",
              "content_sha256",
              "activation_token",
            ],
            properties: { activation_state: { const: "confirmed" } },
          },
          {
            required: ["category_id", "pack_version", "content_sha256"],
            properties: {
              activation_state: { const: "confirmation_required" },
            },
            not: { required: ["activation_token"] },
          },
          {
            properties: { activation_state: { const: "unresolved" } },
            not: {
              anyOf: [
                { required: ["category_id"] },
                { required: ["pack_version"] },
                { required: ["content_sha256"] },
                { required: ["activation_token"] },
              ],
            },
          },
        ],
      },
      standardIntakeSubmission: closedObject(
        [
          "schema_version",
          "domain_pack_activation_token",
          "source_language",
          "source_text",
          "fields",
          "hard_constraints",
          "exclusions",
          "conditional_requirements",
        ],
        {
          schema_version: string(["standard-intake-submission.v1"]),
          domain_pack_activation_token: string(),
          source_language: string(),
          source_text: string(),
          fields: { type: "array", items: standardFieldValue },
          hard_constraints: { type: "array", items: standardHardConstraint },
          exclusions: { type: "array", items: standardExclusion },
          conditional_requirements: {
            type: "array",
            items: closedObject(
              [
                "requirement_id",
                "condition",
                "required_result",
                "source_text",
                "source_start_byte",
                "source_end_byte",
                "requirement_level",
              ],
              {
                requirement_id: string(),
                condition: string(),
                required_result: string(),
                source_text: string(),
                source_start_byte: integer,
                source_end_byte: integer,
                requirement_level: string(["mandatory", "preferred"]),
              },
            ),
          },
        },
      ),
      structuredStandardRequest: closedObject(
        [
          "schema_version",
          "request_id",
          "canonical_version_id",
          "version",
          "source_language",
          "canonical_language",
          "domain_pack",
          "fields",
          "hard_constraints",
          "exclusions",
          "conditional_requirements",
          "contradictions",
          "readiness",
          "created_at",
        ],
        {
          schema_version: string(["structured-standard-request.v1"]),
          request_id: string(),
          canonical_version_id: string(),
          version: { type: "integer", minimum: 1 },
          source_language: string(),
          canonical_language: string(["en"]),
          domain_pack: closedObject(
            ["registry_version", "pack_version", "category_id"],
            {
              registry_version: string(),
              pack_version: string(),
              category_id: string(),
            },
          ),
          fields: { type: "array", items: canonicalStandardFieldValue },
          hard_constraints: { type: "array", items: standardHardConstraint },
          exclusions: { type: "array", items: standardExclusion },
          conditional_requirements: {
            type: "array",
            items: canonicalConditional,
          },
          contradictions: { type: "array", items: standardContradiction },
          readiness: string(["ready", "partially_ready", "not_ready"]),
          created_at: string(),
        },
      ),
      structuredStandardRequestV2: closedObject(
        [
          "schema_version",
          "request_id",
          "canonical_version_id",
          "version",
          "source_language",
          "canonical_language",
          "domain_pack",
          "fields",
          "hard_constraints",
          "exclusions",
          "conditional_requirements",
          "contradictions",
          "readiness",
          "created_at",
        ],
        {
          schema_version: string(["structured-standard-request.v2"]),
          request_id: string(),
          canonical_version_id: string(),
          version: { type: "integer", minimum: 1 },
          source_language: string(),
          canonical_language: string(["en"]),
          domain_pack: closedObject(
            [
              "schema_version",
              "registry_version",
              "pack_version",
              "category_id",
              "pack_schema_version",
              "content_sha256",
              "resolver_version",
            ],
            {
              schema_version: string(["domain-pack-binding.v2"]),
              registry_version: string(),
              pack_version: string(),
              category_id: string(),
              pack_schema_version: string(["domain-pack.v2"]),
              content_sha256: {
                type: "string",
                pattern: "^[a-f0-9]{64}$",
              },
              resolver_version: string(),
            },
          ),
          fields: { type: "array", items: canonicalStandardFieldValue },
          hard_constraints: { type: "array", items: standardHardConstraint },
          exclusions: { type: "array", items: standardExclusion },
          conditional_requirements: {
            type: "array",
            items: canonicalConditional,
          },
          contradictions: { type: "array", items: standardContradiction },
          readiness: string(["ready", "partially_ready", "not_ready"]),
          created_at: string(),
        },
      ),
      standardEvidenceGraph: closedObject(
        [
          "schema_version",
          "run_id",
          "candidates",
          "claims",
          "evidence",
          "evidenced_values",
          "eligible_candidate_ids",
          "gate_evaluations",
          "unknown_count",
          "not_asked_count",
          "gate_evaluation_completed_at",
        ],
        {
          schema_version: string(["standard-evidence-graph.v1"]),
          run_id: string(),
          candidates: { type: "array", items: standardHiddenCandidate },
          claims: { type: "array", items: standardClaim },
          evidence: { type: "array", items: standardEvidenceItem },
          evidenced_values: { type: "array", items: standardEvidencedValue },
          eligible_candidate_ids: strings,
          gate_evaluations: { type: "array", items: gateEvaluation },
          unknown_count: { type: "integer", minimum: 0 },
          not_asked_count: { type: "integer", minimum: 0 },
          gate_evaluation_completed_at: string(),
        },
      ),
      completeResultFoundation: closedObject(
        [
          "schema_version",
          "run_id",
          "candidates",
          "claims",
          "evidence",
          "evidenced_values",
          "eligible_candidate_ids",
          "gate_evaluations",
          "unknown_count",
          "not_asked_count",
          "gate_evaluation_completed_at",
          "consultant_projection_readiness",
        ],
        {
          schema_version: string([COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION]),
          run_id: string(),
          candidates: { type: "array", items: standardHiddenCandidate },
          claims: { type: "array", items: standardClaim },
          evidence: { type: "array", items: standardEvidenceItem },
          evidenced_values: { type: "array", items: standardEvidencedValue },
          eligible_candidate_ids: strings,
          gate_evaluations: { type: "array", items: gateEvaluation },
          unknown_count: { type: "integer", minimum: 0 },
          not_asked_count: { type: "integer", minimum: 0 },
          gate_evaluation_completed_at: string(),
          consultant_projection_readiness: consultantProjectionReadiness,
        },
      ),
      completeResultFoundationV2: closedObject(
        [
          "schema_version",
          "run_id",
          "candidates",
          "claims",
          "evidence",
          "evidenced_values",
          "eligible_candidate_ids",
          "gate_evaluations",
          "unknown_count",
          "not_asked_count",
          "gate_evaluation_completed_at",
          "demo_rationale_sources",
          "demo_low_confidence_caution",
          "consultant_projection_readiness",
        ],
        {
          schema_version: string([
            COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION,
          ]),
          run_id: string(),
          candidates: { type: "array", items: standardHiddenCandidate },
          claims: { type: "array", items: standardClaim },
          evidence: { type: "array", items: completeResultEvidenceV2 },
          evidenced_values: { type: "array", items: standardEvidencedValue },
          eligible_candidate_ids: strings,
          gate_evaluations: { type: "array", items: gateEvaluation },
          unknown_count: { type: "integer", minimum: 0 },
          not_asked_count: { type: "integer", minimum: 0 },
          gate_evaluation_completed_at: string(),
          demo_rationale_sources: {
            type: "array",
            items: demoRationaleSourceV2,
          },
          demo_low_confidence_caution: demoLowConfidenceCautionV2,
          consultant_projection_readiness: consultantProjectionReadiness,
        },
      ),
      standardResultProjection: closedObject(
        [
          "schema_version",
          "run_id",
          "outcome",
          "scarcity",
          "candidates",
          "gate_eliminations",
          "scarcity_analysis",
          "limitations",
          "synthetic_warning",
          "projection_version",
        ],
        {
          schema_version: string(["standard-result-projection.v1"]),
          run_id: string(),
          outcome: string(["matched", "no_responsible_match"]),
          scarcity: string(["none", "limited", "zero"]),
          candidates: {
            type: "array",
            items: standardCandidateProjection,
            maxItems: 3,
          },
          gate_eliminations: { type: "array", items: gateEvaluation },
          scarcity_analysis: scarcityAnalysis,
          limitations,
          synthetic_warning: string(),
          projection_version: {
            type: "integer",
            enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
          },
        },
      ),
      consultantResultProjection: closedObject(
        [
          "schema_version",
          "run_id",
          "outcome",
          "scarcity",
          "candidates",
          "gate_eliminations",
          "scarcity_analysis",
          "limitations",
          "synthetic_warning",
          "landscape",
          "consultant_source_readiness",
          "projection_version",
        ],
        {
          schema_version: string([CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION]),
          run_id: string(),
          outcome: string(["matched", "no_responsible_match"]),
          scarcity: string(["none", "limited", "zero"]),
          candidates: { type: "array", items: standardCandidateProjection },
          gate_eliminations: { type: "array", items: gateEvaluation },
          scarcity_analysis: scarcityAnalysis,
          limitations,
          synthetic_warning: string(),
          landscape: consultantLandscape,
          consultant_source_readiness: consultantSourceReadiness,
          projection_version: {
            type: "integer",
            enum: [CONSULTANT_RESULT_PROJECTION_VERSION],
          },
        },
      ),
      consultantResultProjectionV2: closedObject(
        [
          "schema_version",
          "run_id",
          "outcome",
          "scarcity",
          "candidates",
          "gate_eliminations",
          "scarcity_analysis",
          "limitations",
          "synthetic_warning",
          "landscape",
          "source_policy",
          "configuration_release",
          "agent_authorship",
          "rfq_questions",
          "wave_recommendations",
          "eligible_ranking",
          "rfq_execution_snapshot",
          "reserve_candidates",
          "due_diligence_checklist",
          "source_facts",
          "excluded_evidence",
          "full_limitations",
          "projection_version",
        ],
        {
          schema_version: string([
            CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
          ]),
          run_id: string(),
          outcome: string(["matched", "no_responsible_match"]),
          scarcity: string(["none", "limited", "zero"]),
          candidates: { type: "array", items: standardCandidateProjection },
          gate_eliminations: { type: "array", items: gateEvaluation },
          scarcity_analysis: scarcityAnalysis,
          limitations,
          synthetic_warning: string(),
          landscape: consultantLandscape,
          source_policy: closedObject(
            [
              "policy_id",
              "policy_version",
              "content_sha256",
              "domain_pack_id",
              "mode",
              "production_state",
            ],
            {
              policy_id: string([CONSULTANT_SOURCE_POLICY_ID]),
              policy_version: {
                type: "integer",
                enum: [CONSULTANT_SOURCE_POLICY_VERSION],
              },
              content_sha256: string([CONSULTANT_SOURCE_POLICY_CONTENT_SHA256]),
              domain_pack_id: string([
                CONSULTANT_DOMAIN_PACK_ID,
                CONSULTANT_AGRICULTURAL_DOMAIN_PACK_ID,
              ]),
              mode: string([
                "agent_researched_synthetic_qualification",
                "agent_researched_agricultural_qualification",
              ]),
              production_state: string([
                "blocked_pending_attributable_sme_validation",
              ]),
            },
          ),
          configuration_release: consultantConfigurationRelease,
          agent_authorship: closedObject(
            [
              "prepared_by",
              "mode",
              "human_consultant_authorship",
              "production_sme_validation",
            ],
            {
              prepared_by: string([
                "matchbase_agent_research_and_implementation_team",
              ]),
              mode: string([
                "agent_researched_synthetic_qualification",
                "agent_researched_agricultural_qualification",
              ]),
              human_consultant_authorship: string(["not_claimed"]),
              production_sme_validation: string(["not_claimed"]),
            },
          ),
          rfq_questions: {
            oneOf: [
              CONSULTANT_SYNTHETIC_RFQ_QUESTIONS,
              CONSULTANT_AGRICULTURAL_RFQ_QUESTIONS,
            ].map((questions) => ({
              type: "array",
              prefixItems: questions.map(
                ([questionId, requiredResponse], index) =>
                  closedObject(
                    [
                      "order",
                      "question_id",
                      "required_response",
                      "response_state",
                    ],
                    {
                      order: { type: "integer", enum: [index + 1] },
                      question_id: string([questionId]),
                      required_response: string([requiredResponse]),
                      response_state: string(["not_collected"]),
                    },
                  ),
              ),
              items: false,
              minItems: questions.length,
              maxItems: questions.length,
            })),
          },
          wave_recommendations: {
            type: "array",
            prefixItems: [
              closedObject(
                ["wave_id", "action", "selection_rule", "candidates"],
                {
                  wave_id: string(["RFQ_WAVE_INITIAL"]),
                  action: string([
                    "prepare_synthetic_rfq",
                    "prepare_governed_agricultural_rfq",
                    "no_eligible_candidates",
                  ]),
                  selection_rule: string([
                    "first_min_initial_wave_size_displayed",
                  ]),
                  candidates: {
                    type: "array",
                    items: consultantRankedCandidate,
                  },
                },
              ),
            ],
            items: false,
            minItems: 1,
            maxItems: 1,
          },
          eligible_ranking: {
            type: "array",
            items: consultantRankedCandidate,
          },
          rfq_execution_snapshot: consultantRfqExecutionSnapshot,
          reserve_candidates: {
            type: "array",
            items: consultantReserveCandidate,
          },
          due_diligence_checklist: {
            type: "array",
            prefixItems: CONSULTANT_DUE_DILIGENCE_CHECKS.map(
              ([checkId, label], index) =>
                closedObject(
                  [
                    "order",
                    "check_id",
                    "label",
                    "state",
                    "required_before_production",
                  ],
                  {
                    order: { type: "integer", enum: [index + 1] },
                    check_id: string([checkId]),
                    label: string([label]),
                    state: string(["not_executed"]),
                    required_before_production: {
                      type: "boolean",
                      enum: [true],
                    },
                  },
                ),
            ),
            items: false,
            minItems: CONSULTANT_DUE_DILIGENCE_CHECKS.length,
            maxItems: CONSULTANT_DUE_DILIGENCE_CHECKS.length,
          },
          source_facts: {
            type: "array",
            items: consultantSourceFact,
          },
          excluded_evidence: {
            type: "array",
            items: consultantExcludedEvidence,
          },
          full_limitations: closedObject(
            [
              "qualification_scope",
              "human_consultant_authorship",
              "production_sme_validation",
              "production_release",
              "restricted_party_clearance",
              "due_diligence_completeness",
              "notices",
            ],
            {
              qualification_scope: string([
                "synthetic_only",
                "governed_agricultural_qualification",
              ]),
              human_consultant_authorship: string(["not_claimed"]),
              production_sme_validation: string(["not_claimed"]),
              production_release: string(["blocked"]),
              restricted_party_clearance: string(["not_claimed"]),
              due_diligence_completeness: string(["not_executed"]),
              notices: {
                type: "array",
                items: { type: "string", minLength: 1 },
                minItems: 5,
                maxItems: 5,
              },
            },
          ),
          projection_version: {
            type: "integer",
            enum: [CONSULTANT_RESULT_PROJECTION_V2_VERSION],
          },
        },
      ),
      standardRunProjection: {
        type: "object",
        additionalProperties: false,
        required: ["schema_version", ...runStateRequired, "synthetic_warning"],
        properties: {
          schema_version: string(["standard-run-projection.v1"]),
          ...runStateProperties,
          synthetic_warning: string(),
        },
        oneOf: runStateVariants,
      },
      standardRequestHistory: closedObject(
        ["schema_version", "items", "synthetic_warning", "projection_version"],
        {
          schema_version: string(["standard-request-history.v1"]),
          items: { type: "array", items: requestHistoryItem },
          next_cursor: string(),
          synthetic_warning: string(),
          projection_version: {
            type: "integer",
            enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
          },
        },
      ),
      standardRequestDetail: closedObject(
        [
          "schema_version",
          "canonical",
          "version_history",
          "links",
          "synthetic_warning",
          "projection_version",
        ],
        {
          schema_version: string(["standard-request-detail.v1"]),
          canonical: { $ref: "#/schemas/structuredStandardRequest" },
          version_history: {
            type: "array",
            items: closedObject(
              ["canonical_version_id", "version", "readiness", "created_at"],
              {
                canonical_version_id: string(),
                version: { type: "integer", minimum: 1 },
                readiness: string(["ready", "partially_ready", "not_ready"]),
                created_at: string(),
              },
            ),
          },
          links: closedObject(["request", "versions", "runs"], {
            request: string(),
            versions: string(),
            runs: string(),
          }),
          synthetic_warning: string(),
          projection_version: {
            type: "integer",
            enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
          },
        },
      ),
      standardRequestDetailV2: closedObject(
        [
          "schema_version",
          "canonical",
          "version_history",
          "links",
          "synthetic_warning",
          "projection_version",
        ],
        {
          schema_version: string(["standard-request-detail.v2"]),
          canonical: { $ref: "#/schemas/structuredStandardRequestV2" },
          version_history: {
            type: "array",
            items: closedObject(
              ["canonical_version_id", "version", "readiness", "created_at"],
              {
                canonical_version_id: string(),
                version: { type: "integer", minimum: 1 },
                readiness: string(["ready", "partially_ready", "not_ready"]),
                created_at: string(),
              },
            ),
          },
          links: closedObject(["request", "versions", "runs"], {
            request: string(),
            versions: string(),
            runs: string(),
          }),
          synthetic_warning: string(),
          projection_version: {
            type: "integer",
            enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
          },
        },
      ),
      standardRequestVersionHistory: closedObject(
        ["schema_version", "items", "synthetic_warning", "projection_version"],
        {
          schema_version: string(["standard-request-version-history.v1"]),
          items: {
            type: "array",
            items: closedObject(
              ["canonical_version_id", "version", "readiness", "created_at"],
              {
                canonical_version_id: string(),
                version: { type: "integer", minimum: 1 },
                readiness: string(["ready", "partially_ready", "not_ready"]),
                created_at: string(),
              },
            ),
          },
          next_cursor: string(),
          synthetic_warning: string(),
          projection_version: {
            type: "integer",
            enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
          },
        },
      ),
      standardRunHistory: closedObject(
        ["schema_version", "items", "synthetic_warning", "projection_version"],
        {
          schema_version: string(["standard-run-history.v1"]),
          items: { type: "array", items: runHistoryItem },
          next_cursor: string(),
          synthetic_warning: string(),
          projection_version: {
            type: "integer",
            enum: [STANDARD_DISCLOSURE_PROJECTION_VERSION],
          },
        },
      ),
      costEvent: closedObject(
        [
          "schemaVersion",
          "costEventId",
          "attemptId",
          "runId",
          "userId",
          "accountId",
          "capabilityId",
          "providerId",
          "modelId",
          "environment",
          "quantity",
          "unit",
          "amount",
          "currency",
          "pricingBasis",
          "pricingVersion",
          "measurement",
          "occurredAt",
        ],
        {
          schemaVersion: string(["cost-event.v1"]),
          costEventId: string(),
          attemptId: string(),
          runId: string(),
          userId: string(),
          accountId: string(),
          capabilityId: string(),
          providerId: string(),
          modelId: string(),
          environment: string(),
          quantity: number,
          unit: string(),
          amount: { anyOf: [number, string(["unknown"])] },
          currency: string(),
          pricingBasis: string(),
          pricingVersion: string(),
          measurement: string([
            "provider_reported",
            "estimated",
            "explicit_fixture_zero",
          ]),
          occurredAt: string(),
        },
      ),
    },
  };
}

export function serializeContractSchemas(): string {
  return `${renderJson(generateContractSchemas(), 0, 0)}\n`;
}

function renderJson(
  value: unknown,
  depth: number,
  column: number,
  trailingComma = false,
): string {
  const indentation = "  ".repeat(depth);
  const childIndentation = "  ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inline = `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
    const primitivesOnly = value.every(
      (entry) => entry === null || typeof entry !== "object",
    );
    if (
      primitivesOnly &&
      column + inline.length + (trailingComma ? 1 : 0) <= 80
    )
      return inline;
    return `[\n${value
      .map(
        (entry, index) =>
          `${childIndentation}${renderJson(
            entry,
            depth + 1,
            childIndentation.length,
            index < value.length - 1,
          )}`,
      )
      .join(",\n")}\n${indentation}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{\n${entries
      .map(([key, entry], index) => {
        const prefix = `${childIndentation}${JSON.stringify(key)}: `;
        return `${prefix}${renderJson(
          entry,
          depth + 1,
          prefix.length,
          index < entries.length - 1,
        )}`;
      })
      .join(",\n")}\n${indentation}}`;
  }

  return JSON.stringify(value);
}
