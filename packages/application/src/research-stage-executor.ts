import { createHash } from "node:crypto";

/** MB-ARCH-IMPLEMENT-001 L01: artifacts are scoped to an execution by the store. */
export interface ResearchStageManifest {
  readonly version: "research-stage.v1";
  readonly stage_kind: string;
  readonly qualification:
    | "received_unvalidated"
    | "validated_extraction"
    | "validated_focus"
    | "validated_synthesis_input"
    | "validated_synthesis";
  readonly operation_key: string;
  readonly input_sha256: string;
  readonly policy_sha256: string;
}
export interface ResearchStageRecord {
  readonly manifest: ResearchStageManifest;
  readonly result: unknown;
}
/** The implementation must enforce current identity, authority and fence on both methods. */
export interface ResearchStageStore {
  load(manifest: ResearchStageManifest): Promise<ResearchStageRecord | null>;
  commit(manifest: ResearchStageManifest, result: unknown): Promise<void>;
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new Error("Stage manifests require plain JSON objects.");
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  throw new Error("Stage manifests require finite JSON values.");
}

export function researchStageHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function createResearchStageManifest(input: {
  stage_kind: string;
  qualification: ResearchStageManifest["qualification"];
  input: unknown;
  policy: unknown;
}): ResearchStageManifest {
  const manifest = {
    version: "research-stage.v1" as const,
    stage_kind: input.stage_kind,
    qualification: input.qualification,
    input_sha256: researchStageHash(input.input),
    policy_sha256: researchStageHash(input.policy),
  };
  return { ...manifest, operation_key: researchStageHash(manifest) };
}

/** A stored receipt is never upgraded to evidence by this generic executor. */
export async function executeResearchStage<T>(input: {
  manifest: ResearchStageManifest;
  store?: ResearchStageStore | undefined;
  signal?: AbortSignal | undefined;
  execute: () => Promise<T>;
  validate: (value: unknown) => T;
  on_reuse?: () => Promise<void>;
}): Promise<T> {
  input.signal?.throwIfAborted();
  const stored = await input.store?.load(input.manifest);
  input.signal?.throwIfAborted();
  if (stored) {
    if (
      researchStageHash(stored.manifest) !== researchStageHash(input.manifest)
    )
      throw Object.assign(
        new Error("Stored research stage manifest does not match."),
        {
          code: "MB-409-STAGE-INTEGRITY",
        },
      );
    let value: T;
    try {
      value = input.validate(structuredClone(stored.result));
    } catch {
      throw Object.assign(
        new Error(
          "Stored research stage failed revalidation; no replacement request was sent.",
        ),
        {
          code: "MB-409-STAGE-INTEGRITY",
        },
      );
    }
    input.signal?.throwIfAborted();
    await input.on_reuse?.();
    return value;
  }
  const value = input.validate(await input.execute());
  input.signal?.throwIfAborted();
  // Publication failure is terminal; callers must not turn it into a new provider request.
  await input.store?.commit(input.manifest, value);
  return value;
}
