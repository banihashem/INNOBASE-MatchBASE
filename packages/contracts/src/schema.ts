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
