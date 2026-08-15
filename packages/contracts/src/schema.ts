import {
  STANDARD_ORGANIZATION_WEB_POLICY_VERSION,
  STANDARD_ORGANIZATION_WEB_PURPOSES,
} from "./v1/standard-evidence.js";

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
      exclusion_reason: string(),
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
      exact_url: string(),
      fixture_identity: string(),
      title: string(),
      publisher: string(),
      published_or_updated: string(),
      accessed_at: string(),
      source_tier: string(["primary", "official_secondary", "secondary"]),
      status: standardVerificationStatus,
      access_state: string(["available", "blocked", "unreachable"]),
      extract: string(),
      content_sha256: string(),
      provenance: string(["synthetic_fixture", "repository_fixture"]),
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
      band_ceiling_reason: string(),
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
    projection_version: { type: "integer", enum: [3] },
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
      standardResultProjection: closedObject(
        [
          "schema_version",
          "run_id",
          "outcome",
          "scarcity",
          "candidates",
          "gate_eliminations",
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
          limitations,
          synthetic_warning: string(),
          projection_version: { type: "integer", enum: [3] },
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
          projection_version: { type: "integer", enum: [3] },
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
          projection_version: { type: "integer", enum: [3] },
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
          projection_version: { type: "integer", enum: [3] },
        },
      ),
      standardRunHistory: closedObject(
        ["schema_version", "items", "synthetic_warning", "projection_version"],
        {
          schema_version: string(["standard-run-history.v1"]),
          items: { type: "array", items: runHistoryItem },
          next_cursor: string(),
          synthetic_warning: string(),
          projection_version: { type: "integer", enum: [3] },
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

function renderJson(value: unknown, depth: number, column: number): string {
  const indentation = "  ".repeat(depth);
  const childIndentation = "  ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inline = `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
    const primitivesOnly = value.every(
      (entry) => entry === null || typeof entry !== "object",
    );
    if (primitivesOnly && column + inline.length <= 80) return inline;
    return `[\n${value
      .map(
        (entry) =>
          `${childIndentation}${renderJson(entry, depth + 1, childIndentation.length)}`,
      )
      .join(",\n")}\n${indentation}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{\n${entries
      .map(([key, entry]) => {
        const prefix = `${childIndentation}${JSON.stringify(key)}: `;
        return `${prefix}${renderJson(entry, depth + 1, prefix.length)}`;
      })
      .join(",\n")}\n${indentation}}`;
  }

  return JSON.stringify(value);
}
