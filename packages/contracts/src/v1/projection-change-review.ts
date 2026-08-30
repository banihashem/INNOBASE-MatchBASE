export const PROJECTION_CHANGE_REVIEW_SCHEMA_VERSION =
  "projection-change-review.v1" as const;
export const PROJECTION_FIELD_REGISTRY_SCHEMA_VERSION =
  "projection-field-registry.v1" as const;

export const TASK139_SYNTHETIC_FUTURE_FIELD =
  "task139_future_sensitive_field" as const;

export const PROJECTION_CHANGE_REVIEW_TIERS = [
  "demo",
  "standard",
  "consultant",
] as const;
export type ProjectionChangeReviewTier =
  (typeof PROJECTION_CHANGE_REVIEW_TIERS)[number];

export const PROJECTION_RESOURCE_KINDS = [
  "candidate",
  "run",
  "artifact",
] as const;
export type ProjectionResourceKind = (typeof PROJECTION_RESOURCE_KINDS)[number];

export const PROJECTION_ENDPOINTS = {
  candidate: {
    endpointId: "run_result_candidates",
    method: "GET",
    routeTemplate: "/api/v1/runs/{run_id}/result#candidates[]",
  },
  run: {
    endpointId: "run_result",
    method: "GET",
    routeTemplate: "/api/v1/runs/{run_id}/result",
  },
  artifact: {
    endpointId: "artifact_download",
    method: "GET",
    routeTemplate: "/api/v1/artifacts/{artifact_version_id}",
  },
} as const;

export interface ProjectionChangeReviewV1 {
  readonly schemaVersion: typeof PROJECTION_CHANGE_REVIEW_SCHEMA_VERSION;
  readonly reviewId: "TASK139-PROJECTION-CHANGE-REVIEW-001";
  readonly changeId: "TASK-139";
  readonly reviewer: {
    readonly reviewerId: "matchbase-agent:task139-contract-reviewer";
    readonly reviewerRole: "projection_contract_reviewer";
  };
  readonly decisionReference: "PO-001-TASK137-RESULT-CONTRACT-2026-08-25";
  readonly reviewedField: typeof TASK139_SYNTHETIC_FUTURE_FIELD;
  readonly requiredDefault: "deny_unregistered_fields";
  readonly decision: "fail_closed_required";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

export const TASK139_PROJECTION_CHANGE_REVIEW = deepFreeze({
  schemaVersion: PROJECTION_CHANGE_REVIEW_SCHEMA_VERSION,
  reviewId: "TASK139-PROJECTION-CHANGE-REVIEW-001",
  changeId: "TASK-139",
  reviewer: {
    reviewerId: "matchbase-agent:task139-contract-reviewer",
    reviewerRole: "projection_contract_reviewer",
  },
  decisionReference: "PO-001-TASK137-RESULT-CONTRACT-2026-08-25",
  reviewedField: TASK139_SYNTHETIC_FUTURE_FIELD,
  requiredDefault: "deny_unregistered_fields",
  decision: "fail_closed_required",
} as const satisfies ProjectionChangeReviewV1);

export type ProjectionRegistryVerificationState =
  "raw_projection_probe" | "registry_only_pending_runtime";

export interface ProjectionFieldRegistryEntryV1 {
  readonly registryEntryId: string;
  readonly endpointId:
    "run_result_candidates" | "run_result" | "artifact_download";
  readonly method: "GET";
  readonly routeTemplate:
    | "/api/v1/runs/{run_id}/result#candidates[]"
    | "/api/v1/runs/{run_id}/result"
    | "/api/v1/artifacts/{artifact_version_id}";
  readonly tier: ProjectionChangeReviewTier;
  readonly resourceKind: ProjectionResourceKind;
  readonly fieldName: typeof TASK139_SYNTHETIC_FUTURE_FIELD;
  readonly defaultPolicy: "deny";
  readonly verificationState: ProjectionRegistryVerificationState;
}

export interface ProjectionFieldRegistryV1 {
  readonly schemaVersion: typeof PROJECTION_FIELD_REGISTRY_SCHEMA_VERSION;
  readonly entries: readonly ProjectionFieldRegistryEntryV1[];
}

function registryEntry(
  tier: ProjectionChangeReviewTier,
  resourceKind: ProjectionResourceKind,
): ProjectionFieldRegistryEntryV1 {
  const endpoint = PROJECTION_ENDPOINTS[resourceKind];
  return {
    registryEntryId: `TASK139-${tier}-${resourceKind}`,
    endpointId: endpoint.endpointId,
    method: endpoint.method,
    routeTemplate: endpoint.routeTemplate,
    tier,
    resourceKind,
    fieldName: TASK139_SYNTHETIC_FUTURE_FIELD,
    defaultPolicy: "deny",
    verificationState:
      resourceKind === "artifact"
        ? "registry_only_pending_runtime"
        : "raw_projection_probe",
  };
}

export const TASK139_PROJECTION_FIELD_REGISTRY = deepFreeze({
  schemaVersion: PROJECTION_FIELD_REGISTRY_SCHEMA_VERSION,
  entries: PROJECTION_CHANGE_REVIEW_TIERS.flatMap((tier) =>
    PROJECTION_RESOURCE_KINDS.map((resourceKind) =>
      registryEntry(tier, resourceKind),
    ),
  ),
} as const satisfies ProjectionFieldRegistryV1);

const REVIEW_KEYS = [
  "schemaVersion",
  "reviewId",
  "changeId",
  "reviewer",
  "decisionReference",
  "reviewedField",
  "requiredDefault",
  "decision",
] as const;
const REVIEWER_KEYS = ["reviewerId", "reviewerRole"] as const;
const REGISTRY_KEYS = ["schemaVersion", "entries"] as const;
const ENTRY_KEYS = [
  "registryEntryId",
  "endpointId",
  "method",
  "routeTemplate",
  "tier",
  "resourceKind",
  "fieldName",
  "defaultPolicy",
  "verificationState",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function validateProjectionChangeReviewV1(
  value: unknown,
): ProjectionChangeReviewV1 {
  if (!isRecord(value) || !hasExactKeys(value, REVIEW_KEYS)) {
    throw new Error("Projection change review must be a closed v1 record.");
  }
  if (
    !isRecord(value.reviewer) ||
    !hasExactKeys(value.reviewer, REVIEWER_KEYS)
  ) {
    throw new Error("Projection change review identity must be closed.");
  }
  const expected = TASK139_PROJECTION_CHANGE_REVIEW;
  if (
    value.schemaVersion !== expected.schemaVersion ||
    value.reviewId !== expected.reviewId ||
    value.changeId !== expected.changeId ||
    value.reviewer.reviewerId !== expected.reviewer.reviewerId ||
    value.reviewer.reviewerRole !== expected.reviewer.reviewerRole ||
    value.decisionReference !== expected.decisionReference ||
    value.reviewedField !== expected.reviewedField ||
    value.requiredDefault !== expected.requiredDefault ||
    value.decision !== expected.decision
  ) {
    throw new Error(
      "Projection change review differs from the recorded decision.",
    );
  }
  return value as unknown as ProjectionChangeReviewV1;
}

export function validateProjectionFieldRegistryV1(
  value: unknown,
): ProjectionFieldRegistryV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REGISTRY_KEYS) ||
    value.schemaVersion !== PROJECTION_FIELD_REGISTRY_SCHEMA_VERSION ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("Projection field registry must be a closed v1 record.");
  }
  const expectedPairs = new Set(
    PROJECTION_CHANGE_REVIEW_TIERS.flatMap((tier) =>
      PROJECTION_RESOURCE_KINDS.map(
        (resourceKind) => `${tier}:${resourceKind}`,
      ),
    ),
  );
  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();
  for (const item of value.entries) {
    if (!isRecord(item) || !hasExactKeys(item, ENTRY_KEYS)) {
      throw new Error("Projection field registry entry must be closed.");
    }
    const tier = item.tier;
    const resourceKind = item.resourceKind;
    if (
      typeof tier !== "string" ||
      !PROJECTION_CHANGE_REVIEW_TIERS.includes(
        tier as ProjectionChangeReviewTier,
      ) ||
      typeof resourceKind !== "string" ||
      !PROJECTION_RESOURCE_KINDS.includes(
        resourceKind as ProjectionResourceKind,
      )
    ) {
      throw new Error(
        "Projection field registry has an unknown tier or resource.",
      );
    }
    const typedTier = tier as ProjectionChangeReviewTier;
    const typedResource = resourceKind as ProjectionResourceKind;
    const endpoint = PROJECTION_ENDPOINTS[typedResource];
    const pair = `${typedTier}:${typedResource}`;
    if (
      item.registryEntryId !== `TASK139-${typedTier}-${typedResource}` ||
      item.endpointId !== endpoint.endpointId ||
      item.method !== endpoint.method ||
      item.routeTemplate !== endpoint.routeTemplate ||
      item.fieldName !== TASK139_SYNTHETIC_FUTURE_FIELD ||
      item.defaultPolicy !== "deny" ||
      item.verificationState !==
        (typedResource === "artifact"
          ? "registry_only_pending_runtime"
          : "raw_projection_probe") ||
      seenPairs.has(pair) ||
      seenIds.has(String(item.registryEntryId))
    ) {
      throw new Error(
        "Projection field registry entry is invalid or duplicated.",
      );
    }
    seenPairs.add(pair);
    seenIds.add(String(item.registryEntryId));
  }
  if (
    seenPairs.size !== expectedPairs.size ||
    [...expectedPairs].some((pair) => !seenPairs.has(pair))
  ) {
    throw new Error(
      "Projection field registry is missing a closed matrix entry.",
    );
  }
  return value as unknown as ProjectionFieldRegistryV1;
}
