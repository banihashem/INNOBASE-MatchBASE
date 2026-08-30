import type {
  CompleteResultFoundationV2,
  DemoProjectionV1,
  EvidenceGraphV1,
  StandardEvidenceGraphV1,
  StandardHardConstraintV1,
  StandardResultProjectionV1,
} from "@matchbase/contracts";
import { standardEvidenceGraphFromCompleteResultFoundationV2 } from "../complete-result/foundation-v2.js";
import { assertDemoProjectionSafe, buildDemoProjection } from "./demo.js";
import {
  assertStandardProjectionSafe,
  buildStandardProjection,
  type StandardProjectionContext,
} from "./standard.js";
import { assertStandardPiiReleaseSafe } from "./standard-privacy.js";

export const DEMO_SYNTHETIC_LIMITATIONS_NOTICE =
  "Synthetic evaluation data only. This is not a sourcing result, supplier verification, compliance conclusion, or supplier quotation.";
export const DEMO_QUALIFIED_LIVE_LIMITATIONS_NOTICE =
  "Qualified live research used server-approved routes and source-bound external evidence. This remains advisory and is not supplier verification, a compliance conclusion, or a quotation.";

const DEMO_RELEASED_FIELDS = [
  "run_id",
  "outcome",
  "scarcity",
  "candidates",
  "unmet_mandatory_constraints",
  "limitations_notice",
  "projection_version",
] as const;

export interface ResultProjectionMetadata {
  readonly tier: "demo" | "standard";
  readonly projectionVersion: number;
  readonly fieldsReleased: readonly string[];
  readonly itemCount: number;
  readonly projectionAsOf?: string;
}

export interface DemoStoredResultProjectionRequest {
  readonly tier: "demo";
  readonly completeResult: EvidenceGraphV1 | CompleteResultFoundationV2;
  readonly runBoundMandatoryConstraints: readonly string[];
  readonly researchMode: "synthetic_reference" | "qualified_live_research";
}

export interface StandardStoredResultProjectionRequest {
  readonly tier: "standard";
  readonly completeResult: StandardEvidenceGraphV1 | CompleteResultFoundationV2;
  readonly projectionAsOf: string;
  readonly runBoundCanonicalHardConstraints: readonly StandardHardConstraintV1[];
  readonly allowLegacyEmptyScarcityLedger?: boolean;
  readonly volatilityPolicy?: StandardProjectionContext["volatilityPolicy"];
}

export interface UnsupportedConsultantResultProjectionRequest {
  readonly tier: "consultant";
  readonly completeResult?: unknown;
}

export type StoredResultProjectionRequest =
  | DemoStoredResultProjectionRequest
  | StandardStoredResultProjectionRequest
  | UnsupportedConsultantResultProjectionRequest;

export interface DemoStoredResultProjection {
  readonly tier: "demo";
  readonly body: DemoProjectionV1;
  readonly metadata: ResultProjectionMetadata & { readonly tier: "demo" };
}

export interface StandardStoredResultProjection {
  readonly tier: "standard";
  readonly body: StandardResultProjectionV1;
  readonly metadata: ResultProjectionMetadata & {
    readonly tier: "standard";
    readonly projectionAsOf: string;
  };
}

export type StoredResultProjection =
  DemoStoredResultProjection | StandardStoredResultProjection;

export class UnsupportedResultProjectionError extends Error {
  readonly tier: "consultant";

  constructor(tier: "consultant") {
    super(`Result projection for tier ${tier} is not implemented.`);
    this.name = "UnsupportedResultProjectionError";
    this.tier = tier;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

function releasedFieldPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const visit = (child: unknown, path: string): void => {
    if (Array.isArray(child)) {
      paths.add(path);
      for (const item of child)
        if (item !== null && typeof item === "object") visit(item, `${path}[]`);
      return;
    }
    if (child !== null && typeof child === "object") {
      const entries = Object.entries(child as Record<string, unknown>);
      if (entries.length === 0 && path) paths.add(path);
      for (const [key, nested] of entries)
        visit(nested, path ? `${path}.${key}` : key);
      return;
    }
    paths.add(path);
  };
  visit(value, "");
  paths.delete("");
  return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}

function projectionDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value)
    throw new Error("projectionAsOf must be an exact UTC ISO 8601 instant.");
  return parsed;
}

function isCompleteResultFoundationV2(
  value: EvidenceGraphV1 | StandardEvidenceGraphV1 | CompleteResultFoundationV2,
): value is CompleteResultFoundationV2 {
  return (
    "schema_version" in value &&
    value.schema_version === "complete-result-foundation.v2"
  );
}

export function projectStoredResult(
  request: DemoStoredResultProjectionRequest,
): DemoStoredResultProjection;
export function projectStoredResult(
  request: StandardStoredResultProjectionRequest,
): StandardStoredResultProjection;
export function projectStoredResult(
  request: UnsupportedConsultantResultProjectionRequest,
): never;
export function projectStoredResult(
  request: StoredResultProjectionRequest,
): StoredResultProjection {
  if (request.tier === "consultant")
    throw new UnsupportedResultProjectionError("consultant");

  if (request.tier === "demo") {
    const isV2 = isCompleteResultFoundationV2(request.completeResult);
    const demoBase = isV2
      ? (() => {
          const rationaleByCandidate = new Map(
            request.completeResult.demo_rationale_sources.map((item) => [
              item.candidate_id,
              item.rationale_short,
            ]),
          );
          const candidateById = new Map(
            request.completeResult.candidates.map((item) => [
              item.candidate_id,
              item,
            ]),
          );
          const candidates = request.completeResult.eligible_candidate_ids
            .slice(0, 3)
            .map((candidateId) => {
              const candidate = candidateById.get(candidateId);
              const rationale = rationaleByCandidate.get(candidateId);
              if (!candidate || rationale === undefined)
                throw new Error("V2 Demo projection mapping is incomplete.");
              return {
                display_name: candidate.display_name,
                country_code: candidate.country_code,
                rationale_short: rationale,
              };
            });
          const outcome: "matched" | "no_responsible_match" =
            candidates.length === 0 ? "no_responsible_match" : "matched";
          const mandatoryConstraints = [
            ...new Set(
              request.runBoundMandatoryConstraints.map((item) => item.trim()),
            ),
          ];
          if (
            outcome === "no_responsible_match" &&
            mandatoryConstraints.length === 0
          )
            throw new Error(
              "A Demo no-match projection requires run-bound mandatory constraints.",
            );
          return {
            schema_version: "demo-projection.v1" as const,
            run_id: request.completeResult.run_id,
            outcome,
            scarcity:
              candidates.length === 0
                ? ("zero" as const)
                : candidates.length < 3
                  ? ("limited" as const)
                  : ("none" as const),
            candidates,
            unmet_mandatory_constraints:
              outcome === "no_responsible_match" ? mandatoryConstraints : [],
            projection_version: 1 as const,
          };
        })()
      : buildDemoProjection(
          request.completeResult,
          request.runBoundMandatoryConstraints,
        );
    const body: DemoProjectionV1 = {
      ...demoBase,
      limitations_notice:
        request.researchMode === "qualified_live_research"
          ? DEMO_QUALIFIED_LIVE_LIMITATIONS_NOTICE
          : DEMO_SYNTHETIC_LIMITATIONS_NOTICE,
    };
    assertDemoProjectionSafe(body);
    return deepFreeze({
      tier: "demo" as const,
      body,
      metadata: {
        tier: "demo" as const,
        projectionVersion: body.projection_version,
        fieldsReleased: [...DEMO_RELEASED_FIELDS],
        itemCount: body.candidates.length,
      },
    });
  }

  const context: StandardProjectionContext = {
    now: projectionDate(request.projectionAsOf),
    runBoundCanonicalHardConstraints: request.runBoundCanonicalHardConstraints,
    ...(request.allowLegacyEmptyScarcityLedger === undefined
      ? {}
      : {
          allowLegacyEmptyScarcityLedger:
            request.allowLegacyEmptyScarcityLedger,
        }),
    ...(request.volatilityPolicy === undefined
      ? {}
      : { volatilityPolicy: request.volatilityPolicy }),
  };
  const standardGraph = isCompleteResultFoundationV2(request.completeResult)
    ? standardEvidenceGraphFromCompleteResultFoundationV2(
        request.completeResult,
      )
    : request.completeResult;
  const body = buildStandardProjection(standardGraph, context);
  assertStandardProjectionSafe(body);
  assertStandardPiiReleaseSafe(body);
  return deepFreeze({
    tier: "standard" as const,
    body,
    metadata: {
      tier: "standard" as const,
      projectionVersion: body.projection_version,
      fieldsReleased: releasedFieldPaths(body),
      itemCount: body.candidates.length,
      projectionAsOf: request.projectionAsOf,
    },
  });
}
