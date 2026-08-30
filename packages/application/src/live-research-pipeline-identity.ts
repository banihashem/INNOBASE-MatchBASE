import { EVIDENCE_GRAPH_SCHEMA_VERSION } from "@matchbase/contracts";
import { createHash } from "node:crypto";

export const LIVE_RESEARCH_PIPELINE_IDENTITY_VERSION =
  "live-research-pipeline-identity.v1" as const;
export const LIVE_RESEARCH_EXTRACTION_VERSION =
  "untrusted-source-boundary.v1" as const;

export interface LiveResearchPipelineIdentityV1 {
  readonly schemaVersion: typeof LIVE_RESEARCH_PIPELINE_IDENTITY_VERSION;
  readonly outputSchemaIdentifier: typeof EVIDENCE_GRAPH_SCHEMA_VERSION;
  readonly outputSchemaCanonicalSha256: string;
  readonly researchRoutePolicyId: string;
  readonly routePolicyVersion: string;
  readonly routePolicyCanonicalSha256: string;
  readonly modelPolicyVersionId: string;
  readonly modelPolicyVersion: string;
  readonly modelPolicyContentSha256: string;
  readonly scoringConfigVersionId: string;
  readonly scoringConfigVersion: string;
  readonly scoringConfigContentSha256: string;
  readonly extractionVersion: typeof LIVE_RESEARCH_EXTRACTION_VERSION;
}

export type LiveResearchPipelineIdentityField = Exclude<
  keyof LiveResearchPipelineIdentityV1,
  "schemaVersion"
>;

export class LiveResearchPipelineIdentityDrift extends Error {
  constructor(readonly field: LiveResearchPipelineIdentityField) {
    super(`Live research pipeline identity drifted at ${field}.`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Live research output schema is not canonical JSON.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value !== "object")
    throw new Error("Live research output schema is not canonical JSON.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function nonEmptyVersion(value: string, label: string): string {
  if (value !== value.trim() || value.length < 1 || value.length > 128)
    throw new Error(`${label} is invalid.`);
  return value;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "runId",
    "candidates",
    "claims",
    "evidence",
    "eligibleCandidateIds",
    "gateEvaluationCompletedAt",
  ],
  properties: {
    schemaVersion: { const: EVIDENCE_GRAPH_SCHEMA_VERSION },
    runId: { type: "string" },
    candidates: { type: "array" },
    claims: { type: "array" },
    evidence: { type: "array" },
    eligibleCandidateIds: { type: "array", items: { type: "string" } },
    gateEvaluationCompletedAt: { type: "string" },
  },
} as const);

export function canonicalLiveResearchOutputSchemaSha256(
  outputSchema: Readonly<Record<string, unknown>>,
): string {
  return createHash("sha256").update(canonicalJson(outputSchema)).digest("hex");
}

export const LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256 =
  canonicalLiveResearchOutputSchemaSha256(LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA);

export function assertApprovedLiveResearchOutputSchema(
  outputSchema: Readonly<Record<string, unknown>>,
): void {
  if (
    canonicalLiveResearchOutputSchemaSha256(outputSchema) !==
    LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256
  )
    throw new Error("Live research output schema is not server-approved.");
}

export function canonicalResearchRoutePolicySha256(policy: unknown): string {
  return createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

function exactSha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function exactUuid(value: string, label: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new Error(`${label} is invalid.`);
  return value;
}

export function createLiveResearchPipelineIdentity(input: {
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly researchRoutePolicyId: string;
  readonly routePolicyVersion: string;
  readonly routePolicyCanonicalSha256: string;
  readonly modelPolicyVersionId: string;
  readonly modelPolicyVersion: string;
  readonly modelPolicyContentSha256: string;
  readonly scoringConfigVersionId: string;
  readonly scoringConfigVersion: string;
  readonly scoringConfigContentSha256: string;
}): LiveResearchPipelineIdentityV1 {
  assertApprovedLiveResearchOutputSchema(input.outputSchema);
  return deepFreeze({
    schemaVersion: LIVE_RESEARCH_PIPELINE_IDENTITY_VERSION,
    outputSchemaIdentifier: EVIDENCE_GRAPH_SCHEMA_VERSION,
    outputSchemaCanonicalSha256: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
    researchRoutePolicyId: exactUuid(
      input.researchRoutePolicyId,
      "Live research route-policy id",
    ),
    routePolicyVersion: nonEmptyVersion(
      input.routePolicyVersion,
      "Live research route-policy version",
    ),
    routePolicyCanonicalSha256: exactSha256(
      input.routePolicyCanonicalSha256,
      "Live research route-policy digest",
    ),
    modelPolicyVersionId: exactUuid(
      input.modelPolicyVersionId,
      "Live research model-policy id",
    ),
    modelPolicyVersion: nonEmptyVersion(
      input.modelPolicyVersion,
      "Live research model-policy version",
    ),
    modelPolicyContentSha256: exactSha256(
      input.modelPolicyContentSha256,
      "Live research model-policy digest",
    ),
    scoringConfigVersionId: exactUuid(
      input.scoringConfigVersionId,
      "Live research scoring-config id",
    ),
    scoringConfigVersion: nonEmptyVersion(
      input.scoringConfigVersion,
      "Live research scoring-config version",
    ),
    scoringConfigContentSha256: exactSha256(
      input.scoringConfigContentSha256,
      "Live research scoring-config digest",
    ),
    extractionVersion: LIVE_RESEARCH_EXTRACTION_VERSION,
  });
}

const IDENTITY_KEYS = Object.freeze([
  "extractionVersion",
  "modelPolicyContentSha256",
  "modelPolicyVersion",
  "modelPolicyVersionId",
  "outputSchemaCanonicalSha256",
  "outputSchemaIdentifier",
  "researchRoutePolicyId",
  "routePolicyCanonicalSha256",
  "routePolicyVersion",
  "schemaVersion",
  "scoringConfigContentSha256",
  "scoringConfigVersion",
  "scoringConfigVersionId",
]);

export function parseLiveResearchPipelineIdentity(
  value: unknown,
): LiveResearchPipelineIdentityV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Live research pipeline identity is unavailable.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== IDENTITY_KEYS.join(","))
    throw new Error("Live research pipeline identity is not closed.");
  if (
    record.schemaVersion !== LIVE_RESEARCH_PIPELINE_IDENTITY_VERSION ||
    record.outputSchemaIdentifier !== EVIDENCE_GRAPH_SCHEMA_VERSION ||
    typeof record.outputSchemaCanonicalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.outputSchemaCanonicalSha256) ||
    typeof record.researchRoutePolicyId !== "string" ||
    typeof record.routePolicyVersion !== "string" ||
    typeof record.routePolicyCanonicalSha256 !== "string" ||
    typeof record.modelPolicyVersionId !== "string" ||
    typeof record.modelPolicyVersion !== "string" ||
    typeof record.modelPolicyContentSha256 !== "string" ||
    typeof record.scoringConfigVersionId !== "string" ||
    typeof record.scoringConfigVersion !== "string" ||
    typeof record.scoringConfigContentSha256 !== "string" ||
    record.extractionVersion !== LIVE_RESEARCH_EXTRACTION_VERSION
  )
    throw new Error("Live research pipeline identity is invalid.");
  return deepFreeze({
    schemaVersion: record.schemaVersion,
    outputSchemaIdentifier: record.outputSchemaIdentifier,
    outputSchemaCanonicalSha256: record.outputSchemaCanonicalSha256,
    researchRoutePolicyId: exactUuid(
      record.researchRoutePolicyId,
      "Live research route-policy id",
    ),
    routePolicyVersion: nonEmptyVersion(
      record.routePolicyVersion,
      "Live research route-policy version",
    ),
    routePolicyCanonicalSha256: exactSha256(
      record.routePolicyCanonicalSha256,
      "Live research route-policy digest",
    ),
    modelPolicyVersionId: exactUuid(
      record.modelPolicyVersionId,
      "Live research model-policy id",
    ),
    modelPolicyVersion: nonEmptyVersion(
      record.modelPolicyVersion,
      "Live research model-policy version",
    ),
    modelPolicyContentSha256: exactSha256(
      record.modelPolicyContentSha256,
      "Live research model-policy digest",
    ),
    scoringConfigVersionId: exactUuid(
      record.scoringConfigVersionId,
      "Live research scoring-config id",
    ),
    scoringConfigVersion: nonEmptyVersion(
      record.scoringConfigVersion,
      "Live research scoring-config version",
    ),
    scoringConfigContentSha256: exactSha256(
      record.scoringConfigContentSha256,
      "Live research scoring-config digest",
    ),
    extractionVersion: record.extractionVersion,
  });
}

export function assertLiveResearchPipelineIdentityUnchanged(
  pinnedValue: unknown,
  current: LiveResearchPipelineIdentityV1,
): void {
  const pinned = parseLiveResearchPipelineIdentity(pinnedValue);
  const fields: readonly LiveResearchPipelineIdentityField[] = [
    "outputSchemaIdentifier",
    "outputSchemaCanonicalSha256",
    "researchRoutePolicyId",
    "routePolicyVersion",
    "routePolicyCanonicalSha256",
    "modelPolicyVersionId",
    "modelPolicyVersion",
    "modelPolicyContentSha256",
    "scoringConfigVersionId",
    "scoringConfigVersion",
    "scoringConfigContentSha256",
    "extractionVersion",
  ];
  for (const field of fields) {
    if (pinned[field] !== current[field])
      throw new LiveResearchPipelineIdentityDrift(field);
  }
}

export async function admitLiveResearchProviderCall<T>(
  pinnedValue: unknown,
  current: LiveResearchPipelineIdentityV1,
  providerCall: () => Promise<T>,
): Promise<T> {
  assertLiveResearchPipelineIdentityUnchanged(pinnedValue, current);
  return await providerCall();
}
