import {
  commitResearchStage,
  hashResearchAuthority,
  loadResearchStage,
  reserveResearchAttempt,
  assertEvidenceUseManifest,
  inTransaction,
  type ConnectionPool,
  type ConsultantWorkflowIdentity,
  type ExecutionFence,
  type ResearchRoundRecord,
  type ResearchStageManifest as StoredStageManifest,
} from "@matchbase/data";
import {
  LiveResearchError,
  type LiveCallOptions,
} from "./openrouter-model-policy.js";
import type { ResearchStageManifest } from "./research-stage-executor.js";

/** MB-ARCH-IMPLEMENT-001 L01: callers cannot supply their own persistence scope. */
export function createDurableResearchContext(
  pool: ConnectionPool,
  identity: ConsultantWorkflowIdentity,
  fence: ExecutionFence,
  round: ResearchRoundRecord,
  memoryManifestId?: string,
): Pick<LiveCallOptions, "admit_call" | "stage_store"> {
  const authority = hashResearchAuthority(round.plan);
  const approvedAt = new Date(round.approved_at ?? "").getTime();
  const duration = Math.min(
    86_400_000,
    round.plan.execution_recovery?.valid_for_ms ?? 86_400_000,
  );
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isSafeInteger(duration) ||
    duration <= 0
  )
    throw new LiveResearchError(
      "MB-409-EXECUTION-AUTHORITY",
      "The approved execution window is invalid.",
    );
  // A process restart cannot extend the original approval's execution deadline.
  const expiresAt = new Date(approvedAt + duration).toISOString();
  const modelPolicy = hashResearchAuthority({
    research_models: round.plan.research_models,
    extraction_model: round.plan.extraction_model,
    synthesis_model: round.plan.synthesis_model,
    rates: round.plan.rates,
    model_fallbacks: round.plan.model_fallbacks,
    search_engines: round.plan.search_engines,
  });
  const enrich = (manifest: ResearchStageManifest): StoredStageManifest => ({
    ...manifest,
    approval_sha256: authority,
    schema_version: "research-stage-schema.v1",
    validator_version: "research-stage-validation.v1",
    model_policy_sha256: modelPolicy,
    expires_at: expiresAt,
  });
  return {
    admit_call: async (request, web, admission) => {
      if (memoryManifestId)
        await inTransaction(pool, (client) =>
          assertEvidenceUseManifest(client, identity, memoryManifestId),
        );
      const rate = round.plan.rates.find(
        (item) => item.model === request.model,
      );
      // Exposure is an estimate, never a hard cap or a claim that native query count is known.
      const estimatedExposure = rate
        ? (admission.request_input_bytes * rate.input_usd_per_token +
            admission.max_output_tokens * rate.output_usd_per_token +
            rate.request_usd +
            (web ? 8 * rate.web_search_usd : 0)) *
          1.05
        : null;
      const result = await reserveResearchAttempt(pool, identity, fence, {
        request_id: admission.request_id,
        operation_key: admission.operation_key,
        stage_key: admission.stage_key,
        phase: admission.phase,
        model: request.model,
        input_sha256: admission.effective_request_sha256,
        approval_sha256: authority,
        reserve_synthesis:
          (round.plan.automatic_recovery_attempts ?? 1) > 1 &&
          !admission.is_synthesis,
        estimated_exposure_usd: estimatedExposure,
      });
      if (!result.reserved)
        throw new LiveResearchError(
          "MB-409-EXECUTION-ATTEMPT",
          "This provider attempt already has a dispatch record. No duplicate request was sent.",
        );
    },
    stage_store: {
      load: async (manifest) => {
        const stored = await loadResearchStage(
          pool,
          identity,
          fence,
          enrich(manifest),
        );
        return stored ? { manifest, result: stored.result } : null;
      },
      commit: async (manifest, result) => {
        await commitResearchStage(
          pool,
          identity,
          fence,
          enrich(manifest),
          result,
        );
      },
    },
  };
}
