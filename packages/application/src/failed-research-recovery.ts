import {
  parseConsultantResearchOutputV3,
  validateConsultantOutputV3Integrity,
  validateConsultantOutputV3SemanticCoherence,
  type ApprovedRequestSnapshotV3,
  type ProductClassificationRecord,
} from "@matchbase/contracts";
import type { ConsultantWorkflowSessionRecord } from "@matchbase/data";
import type { ResearchContinuation } from "./dual-lane-orchestrator.js";
import { parseLiveJson } from "./live-json-schema.js";
import {
  LIVE_DISCOVERY_SCHEMA,
  ingestLiveEvidence,
  reconcileLiveCandidateRecords,
  assembleLiveSuppliers,
  stableCandidateKey,
  type LiveDiscoveryPayload,
  type LiveEvidenceRecord,
} from "./live-supplier-evidence.js";
import type {
  LiveResearchCheckpoint,
  OpenRouterCitation,
} from "./openrouter-model-policy.js";
import { normalizeResearchGaps } from "./research-gap-normalizer.js";
import { synthesizeConsultantOutputV3 } from "./synthesis-engine.js";

export interface FailedResearchEvent {
  readonly phase: string;
  readonly detail: Partial<LiveResearchCheckpoint>;
  readonly created_at: string | Date;
}

/** L15: completed batches remain useful when a sibling failed. No network access. */
export function buildFailedResearchRecovery(input: {
  readonly session: ConsultantWorkflowSessionRecord;
  readonly source_execution_id: string;
  readonly execution_id: string;
  readonly events: readonly FailedResearchEvent[];
}) {
  const { session } = input;
  const approved = session.approved_request_revision?.canonical_snapshot as
    ApprovedRequestSnapshotV3 | undefined;
  const classification = session.classification as unknown as
    ProductClassificationRecord | undefined;
  const requirements = session.deep_prompt_revision?.discovery_criteria;
  if (
    session.is_invalidated ||
    session.current_state !== "workflow_failed" ||
    session.execution_id !== input.source_execution_id ||
    input.execution_id === input.source_execution_id ||
    !approved ||
    !classification ||
    !Array.isArray(requirements) ||
    !requirements.length ||
    requirements.some((value) => typeof value !== "string" || !value.trim())
  )
    throw new Error(
      "Failed recovery requires the current failed execution and its approved requirements.",
    );
  const events = structuredClone(input.events);
  const nativeEvents = events.filter(
    (event) =>
      /^discovery_(gemini|openai)$/.test(event.phase) &&
      event.detail.state === "completed" &&
      event.detail.is_byok === true,
  );
  const citations: OpenRouterCitation[] = nativeEvents.flatMap((event) =>
    (event.detail.response_citations ?? []).map((citation) => ({
      url: citation.url,
      title: citation.title,
      ...(citation.content_excerpt
        ? { content: citation.content_excerpt }
        : {}),
    })),
  );
  const batches: LiveDiscoveryPayload[] = [];
  const gaps: string[] = [];
  for (const event of events.filter((item) =>
    /^discovery_(gemini|openai)_extraction_batch$/.test(item.phase),
  )) {
    const detail = event.detail;
    if (detail.state === "started") continue;
    if (
      detail.state !== "completed" ||
      detail.is_byok !== true ||
      detail.finish_reason === "length" ||
      detail.response_truncated ||
      !detail.response_content
    ) {
      gaps.push(
        `Saved batch ${detail.request_id ?? event.phase} was incomplete or failed and is excluded. Its candidates require another extraction attempt.`,
      );
      continue;
    }
    try {
      batches.push(
        parseLiveJson<LiveDiscoveryPayload>(
          detail.response_content,
          LIVE_DISCOVERY_SCHEMA,
        ),
      );
    } catch {
      gaps.push(
        `Saved batch ${detail.request_id ?? event.phase} did not pass current extraction validation and is excluded.`,
      );
    }
  }
  if (!batches.length || !nativeEvents.length)
    throw new Error(
      "No completed extraction batch with retained native provenance is available.",
    );
  const evidence = new Map<string, LiveEvidenceRecord>();
  for (const payload of batches)
    ingestLiveEvidence(payload, citations, evidence);
  // Evidence timestamps describe the original observations, never this local projection.
  const observedAt = new Date(nativeEvents.at(-1)!.created_at).toISOString();
  for (const record of evidence.values()) {
    record.source = { ...record.source, retrieved_at: observedAt };
  }
  const roster = reconcileLiveCandidateRecords(
    batches.flatMap((batch) => batch.candidates),
    evidence,
  );
  const entityIds = new Map<string, string>();
  const assembled = assembleLiveSuppliers(
    roster,
    requirements as string[],
    evidence,
    20,
    entityIds,
  );
  const disclosure = `Recovered completed extraction batches from failed execution ${input.source_execution_id}. No new web search, provider call, verification round or model synthesis was performed. Incomplete batches are excluded. Only retained native source text can support publication; unavailable fetched-page text is not reconstructed from model prose. Incremental recovery API cost: USD 0. Original costs remain in request history.`;
  const priorNative = {
    model: "retained-native-evidence",
    text: "",
    live_api_invoked: true,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    latency_ms: 0,
  };
  const synthesized = synthesizeConsultantOutputV3({
    user_profile_id: session.user_profile_id,
    research_run_id: session.run_id,
    execution_id: input.execution_id,
    classification_id: classification.classification_id,
    product_name: approved.product_name,
    product_category: approved.product_category,
    approved_request_snapshot: approved,
    primary_classification: classification,
    dual_lane_result: {
      lane_g_result: priorNative,
      lane_o_result: priorNative,
      ...assembled,
      verification_loops_completed: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      total_latency_ms: 0,
      checkpoints: [],
      stop_reason: "user_review",
      executed_models: [],
      usage_complete: true,
      synthesis_summary: `${assembled.candidates.length} conditional supplier profiles recovered from completed portions of the failed research. ${disclosure}`,
      coverage_gaps: gaps,
    },
  });
  const output = parseConsultantResearchOutputV3({
    ...synthesized,
    as_of_date: observedAt.slice(0, 10),
    research_status: assembled.candidates.length
      ? "partial"
      : "insufficient_evidence",
    subtitle: `${assembled.candidates.length} Recovered Evidence-Based Supplier Profiles`,
    telemetry: {
      ...synthesized.telemetry,
      synthesis_model_id: "deterministic-failed-batch-recovery.v1",
    },
    limitations_and_disclosures: [
      ...synthesized.limitations_and_disclosures,
      {
        title: "Failed research recovery",
        description: disclosure,
        severity: "advisory",
      },
    ],
  });
  const integrity = validateConsultantOutputV3Integrity(output);
  const coherence = validateConsultantOutputV3SemanticCoherence(output);
  if (!integrity.isValid || !coherence.isCoherent)
    throw new Error(
      `Failed recovery validation: ${[...integrity.errors, ...coherence.errors].join("; ")}`,
    );
  const continuation: ResearchContinuation = {
    native_citations: citations,
    roster: roster.map((candidate) => [
      stableCandidateKey(candidate),
      candidate,
    ]),
    evidence: [...evidence],
    entity_ids: [...entityIds],
    retrieved: [],
    remaining_gaps: normalizeResearchGaps(
      [...batches.flatMap((batch) => batch.remaining_gaps), ...gaps],
      40,
    ),
    coverage_gaps: gaps,
  };
  return {
    output,
    continuation,
    excluded_candidates: assembled.excluded_candidates,
    completed_batch_count: batches.length,
    missing_batch_count: gaps.length,
  };
}
