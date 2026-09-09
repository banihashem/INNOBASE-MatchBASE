import {
  parseConsultantResearchOutputV3,
  validateConsultantOutputV3Integrity,
  validateConsultantOutputV3SemanticCoherence,
  type ConsultantResearchOutputV3,
} from "@matchbase/contracts";
import type { ResearchContinuation } from "./dual-lane-orchestrator.js";
import {
  assembleLiveSuppliers,
  revalidateRetainedLiveEvidence,
  reconcileLiveCandidateRecords,
  ingestLiveEvidence,
} from "./live-supplier-evidence.js";
import { repairSourceTranscription } from "./source-transcription-repair.js";
import { researchCitationInventory } from "./research-source-context.js";
import { normalizeResearchGaps } from "./research-gap-normalizer.js";

export interface RetainedResearchRecoveryInput {
  readonly prior_output: ConsultantResearchOutputV3;
  readonly continuation: ResearchContinuation;
  readonly mandatory_requirements: readonly string[];
  readonly execution_id: string;
  readonly recovered_at?: string;
}

/** L11: project retained evidence through existing gates without tools or inference. */
export function buildRetainedResearchRecovery(
  input: RetainedResearchRecoveryInput,
) {
  const prior = parseConsultantResearchOutputV3(input.prior_output);
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (prior.research_mode !== "live" || !prior.approved_request_snapshot)
    throw new Error(
      "Retained recovery requires a live output with approved request lineage.",
    );
  if (
    !uuid.test(input.execution_id) ||
    input.execution_id === prior.execution_id
  )
    throw new Error(
      "Recovery requires a distinct host-assigned execution UUID.",
    );
  const recoveredAt = input.recovered_at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(recoveredAt)))
    throw new Error("Recovery timestamp is invalid.");
  const requirements = [...new Set(input.mandatory_requirements)];
  if (!requirements.length || requirements.some((value) => !value.trim()))
    throw new Error(
      "The original approved mandatory requirements are required.",
    );

  // Helpers may replace map records; clone all nested records to preserve audit inputs.
  const continuation = structuredClone(input.continuation);
  const evidence = new Map(continuation.evidence);
  const entityIds = new Map(continuation.entity_ids);
  const retrieved = new Map(continuation.retrieved);
  const citations = researchCitationInventory(
    [],
    continuation.native_citations ??
      [...evidence.values()].map((record) => record.native_citation),
    retrieved,
  );
  const transcribed = repairSourceTranscription(
    continuation.roster.map(([, candidate]) => candidate),
    citations,
    retrieved,
  );
  ingestLiveEvidence(transcribed, citations, evidence, retrieved);
  continuation.native_citations = citations;
  continuation.remaining_gaps = normalizeResearchGaps(
    continuation.remaining_gaps,
    40,
  );
  const retainedRoster = transcribed.candidates;
  continuation.roster = continuation.roster.map(([key], index) => [
    key,
    retainedRoster[index]!,
  ]);
  revalidateRetainedLiveEvidence(retainedRoster, evidence);
  const roster = reconcileLiveCandidateRecords(retainedRoster, evidence);
  const assembled = assembleLiveSuppliers(
    roster,
    requirements,
    evidence,
    20,
    entityIds,
  );
  const candidates = [...assembled.candidates]
    .sort(
      (a, b) =>
        b.assessment.compatibility_score - a.assessment.compatibility_score ||
        a.legal_name.localeCompare(b.legal_name, "en") ||
        a.candidate_id.localeCompare(b.candidate_id, "en"),
    )
    .map((candidate, index) => ({
      ...candidate,
      assessment: {
        ...candidate.assessment,
        rank: index + 1,
        positive_drivers: [
          ...candidate.assessment.positive_drivers,
          "Ordering uses the existing deterministic compatibility calculation; no new model comparison was performed.",
        ],
      },
    }));
  const count = candidates.length;
  const recoveryDisclosure = `Recovered from retained execution ${prior.execution_id}. No new web search, provider request, verification round or LLM synthesis was performed. Incremental recovery API cost: USD 0. Original source dates, approved requirements and historical accounting are retained. Ordering uses the existing deterministic compatibility calculation, then company name; it is not a new model recommendation.`;
  const { report_artifact: _previousArtifact, ...base } = prior;
  const retainedLimitations = prior.limitations_and_disclosures.filter(
    (item) =>
      ![
        "Candidate coverage",
        "Retained evidence recovery",
        "Recovered candidate exclusions",
      ].includes(item.title),
  );
  const limitations: ConsultantResearchOutputV3["limitations_and_disclosures"] =
    [
      ...retainedLimitations,
      {
        title: "Retained evidence recovery",
        description: recoveryDisclosure,
        severity: "advisory",
      },
      {
        title: "Candidate coverage",
        description: `${count} profiles pass the existing publication gates from ${roster.length} retained candidate records, against a target of 20. This recovery does not refresh evidence or establish current availability.`,
        severity: "advisory",
      },
      ...(assembled.excluded_candidates.length
        ? [
            {
              title: "Recovered candidate exclusions",
              description: assembled.excluded_candidates
                .map((item) => `${item.legal_name}: ${item.reason}`)
                .join("\n"),
              severity: "advisory" as const,
            },
          ]
        : []),
      ...(continuation.coverage_gaps ?? [])
        .filter(
          (gap) =>
            !retainedLimitations.some((item) => item.description === gap),
        )
        .map((gap) => ({
          title: "Partial research coverage",
          description: gap,
          severity: "critical" as const,
        })),
    ];
  const output = parseConsultantResearchOutputV3({
    ...base,
    execution_id: input.execution_id,
    generated_at: recoveredAt,
    // as_of_date stays tied to the old evidence; rebuilding is not a new observation.
    subtitle: `${count} Recovered Evidence-Based Supplier Profiles`,
    research_status: count ? "partial" : "insufficient_evidence",
    total_candidates_found: count,
    supplier_candidates: candidates,
    claims: assembled.claims,
    evidence_sources: assembled.evidence_sources,
    executive_summary: {
      headline: `${count} Recovered Supplier Profiles`,
      direct_answer: `${count} supplier profiles can be published from retained evidence after revalidation against the original mandatory requirements. ${recoveryDisclosure}`,
      key_findings: [
        `${candidates.filter((item) => item.commercial.price_min !== undefined).length} profiles contain an observed price; remaining prices are unknown.`,
        `${candidates.filter((item) => item.contacts?.sales_email || item.contacts?.export_email || item.contacts?.general_email || item.contacts?.phone).length} profiles contain source-backed public business contact data.`,
        `${assembled.excluded_candidates.length} retained candidates remain excluded by the unchanged publication gates.`,
        `Approved request revision: ${prior.approved_request_snapshot.revision_id}.`,
      ],
      candidate_count: count,
      confidence_assessment: count ? "medium" : "not_assessed",
      primary_limitation:
        "Retained evidence only; no new verification or model synthesis.",
      ...(count
        ? {}
        : {
            no_match_summary:
              "No retained candidate passed the existing publication gates. This does not establish that suitable suppliers do not exist.",
          }),
      research_coverage_status: count ? "partial" : "insufficient",
    },
    telemetry: {
      lanes_executed: [],
      verification_loops_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      execution_latency_ms: 0,
      synthesis_model_id: "deterministic-retained-evidence-recovery.v1",
      executed_at: recoveredAt,
    },
    limitations_and_disclosures: limitations,
  });
  const integrity = validateConsultantOutputV3Integrity(output);
  const coherence = validateConsultantOutputV3SemanticCoherence(output);
  if (!integrity.isValid || !coherence.isCoherent)
    throw new Error(
      `Retained recovery validation failed: ${[...integrity.errors, ...coherence.errors].join("; ")}`,
    );
  return {
    output,
    continuation: {
      ...continuation,
      evidence: [...evidence],
      entity_ids: [...entityIds],
    },
    excluded_candidates: assembled.excluded_candidates,
    recovery_audit: {
      source_execution_id: prior.execution_id,
      recovery_execution_id: input.execution_id,
      recovered_at: recoveredAt,
      historical_telemetry: structuredClone(prior.telemetry),
      provider_call_count: 0,
      incremental_cost_usd: 0,
      ranking_method: "existing_compatibility_score_then_company_name",
    },
  };
}
