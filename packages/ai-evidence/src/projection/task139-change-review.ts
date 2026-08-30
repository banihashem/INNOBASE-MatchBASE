import {
  TASK139_PROJECTION_CHANGE_REVIEW,
  TASK139_PROJECTION_FIELD_REGISTRY,
  TASK139_SYNTHETIC_FUTURE_FIELD,
  contractSha256Hex,
  validateProjectionChangeReviewV1,
  validateProjectionFieldRegistryV1,
  type ProjectionChangeReviewV1,
  type ProjectionFieldRegistryV1,
} from "@matchbase/contracts";
import {
  buildTask137ActualTierProjectionSafetyOutputs,
  type Task137ActualTierProjectionSafetyOutputs,
} from "../task137/synthetic-weight-qualification.js";

export const TASK139_SYNTHETIC_FUTURE_FIELD_VALUE =
  "synthetic-probe-deny-by-default" as const;

export interface Task139RawTierProjectionProbe {
  readonly storedInputProbe: {
    readonly fieldName: typeof TASK139_SYNTHETIC_FUTURE_FIELD;
    readonly fieldValue: typeof TASK139_SYNTHETIC_FUTURE_FIELD_VALUE;
    readonly presentBeforeProjection: true;
  };
  readonly outputs: Task137ActualTierProjectionSafetyOutputs;
}

export interface Task139TierDenialEvidence {
  readonly tier: "demo" | "standard" | "consultant";
  readonly rawOutputSchemaVersion: string;
  readonly futureFieldPaths: readonly string[];
  readonly deniedByDefault: true;
  readonly rawOutputSha256: string;
}

export interface Task139ProjectionChangeReviewEvidence {
  readonly review: ProjectionChangeReviewV1;
  readonly registry: ProjectionFieldRegistryV1;
  readonly storedInputProbe: Task139RawTierProjectionProbe["storedInputProbe"];
  readonly tierDenialEvidence: readonly [
    Task139TierDenialEvidence,
    Task139TierDenialEvidence,
    Task139TierDenialEvidence,
  ];
}

export function findExactFieldPaths(
  value: unknown,
  fieldName: string,
  path = "$",
  findings: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findExactFieldPaths(item, fieldName, `${path}[${index}]`, findings),
    );
    return findings;
  }
  if (value === null || typeof value !== "object") return findings;
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`;
    if (key === fieldName) findings.push(itemPath);
    findExactFieldPaths(item, fieldName, itemPath, findings);
  }
  return findings;
}

export function buildTask139RawTierProjectionProbe(): Task139RawTierProjectionProbe {
  const storedInputExtension = {
    [TASK139_SYNTHETIC_FUTURE_FIELD]: TASK139_SYNTHETIC_FUTURE_FIELD_VALUE,
  } as const;
  if (!(TASK139_SYNTHETIC_FUTURE_FIELD in storedInputExtension)) {
    throw new Error(
      "TASK139 future-field probe was not present before projection.",
    );
  }
  return {
    storedInputProbe: {
      fieldName: TASK139_SYNTHETIC_FUTURE_FIELD,
      fieldValue: TASK139_SYNTHETIC_FUTURE_FIELD_VALUE,
      presentBeforeProjection: true,
    },
    outputs:
      buildTask137ActualTierProjectionSafetyOutputs(storedInputExtension),
  };
}

export function assertTask139FutureFieldDenied(
  value: unknown,
  tier: Task139TierDenialEvidence["tier"],
): Task139TierDenialEvidence {
  const futureFieldPaths = findExactFieldPaths(
    value,
    TASK139_SYNTHETIC_FUTURE_FIELD,
  );
  if (futureFieldPaths.length > 0) {
    throw new Error(
      `TASK139 future field leaked into ${tier}: ${futureFieldPaths.join(", ")}.`,
    );
  }
  const rawOutputSchemaVersion =
    value !== null &&
    typeof value === "object" &&
    "schema_version" in value &&
    typeof value.schema_version === "string"
      ? value.schema_version
      : "unknown";
  return {
    tier,
    rawOutputSchemaVersion,
    futureFieldPaths,
    deniedByDefault: true,
    rawOutputSha256: contractSha256Hex(JSON.stringify(value)),
  };
}

export function buildTask139ProjectionChangeReviewEvidence(): Task139ProjectionChangeReviewEvidence {
  const probe = buildTask139RawTierProjectionProbe();
  return {
    review: validateProjectionChangeReviewV1(
      structuredClone(TASK139_PROJECTION_CHANGE_REVIEW),
    ),
    registry: validateProjectionFieldRegistryV1(
      structuredClone(TASK139_PROJECTION_FIELD_REGISTRY),
    ),
    storedInputProbe: probe.storedInputProbe,
    tierDenialEvidence: [
      assertTask139FutureFieldDenied(probe.outputs.demo, "demo"),
      assertTask139FutureFieldDenied(probe.outputs.standard, "standard"),
      assertTask139FutureFieldDenied(probe.outputs.consultant, "consultant"),
    ],
  };
}
