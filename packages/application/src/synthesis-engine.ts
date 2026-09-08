import {
  CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
  CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
  createApprovedRequestSnapshotV3,
  formatApprovedFactV3,
  type ApprovedRequestSnapshotV3,
  type ConsultantResearchOutputV3,
  type ProductClassificationRecord,
  type RequestSnapshotV2,
  type EvidenceSourceV3,
  type ClaimV3,
} from "@matchbase/contracts";
import type { DualLaneExecutionResult } from "./dual-lane-orchestrator.js";

export interface SynthesisInput {
  readonly user_profile_id: string;
  readonly research_run_id: string;
  readonly execution_id: string;
  readonly classification_id: string;
  readonly product_name: string;
  readonly product_category: string;
  readonly dual_lane_result: DualLaneExecutionResult;
  readonly approved_request_snapshot?: ApprovedRequestSnapshotV3;
  readonly primary_classification?: ProductClassificationRecord;
  readonly approved_translation?: string;
  readonly intake?: {
    product_requirement: string;
    technical_compliance: string;
    order_profile: string;
  };
}

export function projectApprovedRequestSnapshotV3(
  snapshot: ApprovedRequestSnapshotV3 | undefined,
  name: string,
  category: string,
): RequestSnapshotV2 {
  const facts = snapshot?.facts ?? [];
  const attributes: Record<
    string,
    string | number | boolean | readonly string[]
  > = {};
  const aliases: Record<string, string> = {
    storage_capacity: "capacity_litres",
    external_diameter: "max_outer_diameter_cm",
    working_pressure: "pressure_bar",
    order_quantity: "quantity",
    electrical_power: "electrical",
    warranty_duration: "warranty",
    delivery_terms: "incoterm",
  };
  for (const fact of facts) {
    const key = aliases[fact.concept] ?? fact.concept;
    const value = [
      "storage_capacity",
      "external_diameter",
      "order_quantity",
    ].includes(fact.concept)
      ? fact.value
      : formatApprovedFactV3(fact);
    if (attributes[key] !== undefined)
      attributes[key] = [
        ...(Array.isArray(attributes[key])
          ? (attributes[key] as string[])
          : [String(attributes[key])]),
        String(value),
      ];
    else attributes[key] = value;
    if (fact.concept === "delivery_terms") {
      attributes.incoterm = String(fact.value);
      if (fact.qualifiers.destination)
        attributes.destination = fact.qualifiers.destination;
    }
  }
  return {
    primary_query_type: "sourcing",
    secondary_query_types: ["pricing", "product_recommendation"],
    intent_scope: facts.some((f) => f.concept === "delivery_terms")
      ? "trade_lane"
      : "unspecified",
    business_context: snapshot ? [snapshot.approved_translation] : [],
    product_name: snapshot?.product_name ?? name,
    product_category: snapshot?.product_category ?? category,
    confidence_level_required: "high",
    compliance_sensitive: facts.some((f) => f.concept === "certification"),
    pricing_volatile: false,
    product_attributes: attributes,
    normalized_requirements: facts.map((f) => ({
      name: f.label,
      value: formatApprovedFactV3(f),
      ...(f.unit ? { unit: f.unit } : {}),
      requirement_level:
        f.modality === "optional" ? ("informational" as const) : f.modality,
    })),
    mandatory_constraints: facts
      .filter((f) => f.modality === "mandatory" && f.operator !== "prohibits")
      .map((f) => `${f.label}: ${formatApprovedFactV3(f)}`),
    preferred_constraints: facts
      .filter((f) => f.modality === "preferred")
      .map((f) => `${f.label}: ${formatApprovedFactV3(f)}`),
    excluded_constraints: facts
      .filter((f) => f.operator === "prohibits")
      .map(formatApprovedFactV3),
    ...(attributes.destination
      ? { destination_market: String(attributes.destination) }
      : {}),
  };
}

export function synthesizeConsultantOutputV3(
  input: SynthesisInput,
): ConsultantResearchOutputV3 {
  const result = input.dual_lane_result as DualLaneExecutionResult & {
    evidence_sources?: readonly EvidenceSourceV3[];
    claims?: readonly ClaimV3[];
    stop_reason?: string;
    usage_complete?: boolean;
  };
  const isLive =
    result.lane_g_result.live_api_invoked ||
    result.lane_o_result?.live_api_invoked;
  if (
    isLive &&
    result.candidates.some(
      (candidate) =>
        candidate.entity_basis === "synthetic_fixture" ||
        candidate.evidence_basis === "illustrative_fixture",
    )
  ) {
    throw new Error(
      "Live synthesis cannot consume demonstration supplier fixtures.",
    );
  }
  const now = new Date().toISOString();
  // Compatibility callers may supply approved text; intake is never used as a replacement for approval.
  const approved =
    input.approved_request_snapshot ??
    (input.approved_translation?.trim()
      ? createApprovedRequestSnapshotV3({
          revision_id: `legacy-approved-text-${input.research_run_id}`,
          approved_translation: input.approved_translation,
          product_name: input.product_name,
          product_category: input.product_category,
          approved_at: now,
        })
      : undefined);
  const candidates = [...result.candidates]
    .sort(
      (a, b) =>
        b.assessment.compatibility_score - a.assessment.compatibility_score ||
        a.assessment.rank - b.assessment.rank,
    )
    .map((candidate, index) => ({
      ...candidate,
      assessment: { ...candidate.assessment, rank: index + 1 },
    }));
  const count = candidates.length;
  const evidence = result.evidence_sources ?? [];
  const claims = result.claims ?? [];
  const limitations: ConsultantResearchOutputV3["limitations_and_disclosures"][number][] =
    [
      {
        title: "Evidence and commercial scope",
        description:
          "Observed supplier terms do not replace approved buyer requirements. Availability, exact product identity, authorization, certificates and quotation validity must be resolved from the cited evidence and written supplier confirmation.",
        severity: "advisory",
      },
    ];
  if (!approved)
    limitations.push({
      title: "Approved request lineage unavailable",
      description:
        "This record has no trustworthy approved request snapshot. Buyer requirements are unknown; no template values have been substituted.",
      severity: "critical",
    });
  if (!isLive)
    limitations.push({
      title: "Demonstration dataset",
      description:
        "All supplied company profiles and commercial values in this demonstration are illustrative fixtures. No external market evidence was collected and no compliance with the current request is asserted.",
      severity: "critical",
    });
  if (count < 20)
    limitations.push({
      title: "Candidate coverage",
      description: `The research returned ${count} distinct candidates against a target of 20. No additional entities were invented. Stop condition: ${result.stop_reason ?? "available evidence"}.`,
      severity: "advisory",
    });
  if (result.usage_complete === false)
    limitations.push({
      title: "Provider usage incomplete",
      description:
        "At least one provider response omitted usage metadata; reported consumption is incomplete.",
      severity: "advisory",
    });
  return {
    schema_version: CONSULTANT_RESEARCH_OUTPUT_V3_SCHEMA_VERSION,
    schema_contract_version: CONSULTANT_RESEARCH_OUTPUT_V3_VERSION,
    user_profile_id: input.user_profile_id,
    research_run_id: input.research_run_id,
    execution_id: input.execution_id,
    classification_id: input.classification_id,
    title: `${approved?.product_name ?? input.product_name} Supplier Landscape`,
    subtitle: `${count} ${isLive ? "Evidence-Based" : "Illustrative"} Supplier Profiles`,
    generated_at: now,
    as_of_date: now.slice(0, 10),
    research_mode: isLive ? "live" : "fixture",
    research_status:
      count === 0
        ? "insufficient_evidence"
        : count < 20
          ? "partial"
          : "complete",
    primary_classification: input.primary_classification ?? {
      classification_id: input.classification_id,
      scheme: "CUSTOM_MATCHBASE",
      code: "UNCLASSIFIED",
      version: "1",
      level: "provisional",
      label: "Classification requires verification",
      description: approved?.product_name ?? input.product_name,
      is_primary: true,
      confidence: "not_assessed",
      assigned_at: now,
    },
    secondary_classifications: [],
    ...(approved ? { approved_request_snapshot: approved } : {}),
    request_snapshot: projectApprovedRequestSnapshotV3(
      approved,
      input.product_name,
      input.product_category,
    ),
    executive_summary: {
      headline: `${count} ${isLive ? "Researched" : "Illustrative"} Supplier Profiles`,
      direct_answer: isLive
        ? (result.synthesis_summary ??
          `Research produced ${count} distinct supplier profiles with ${claims.length} recorded claims and ${evidence.length} sources. Assess each supplier's evidence, commercial terms and unresolved requirements before shortlisting.`)
        : `Demonstration includes ${count} illustrative supplier profiles. It does not establish that these profiles meet the approved request.`,
      key_findings: [
        `${candidates.filter((c) => c.commercial.price_min !== undefined).length} profiles contain an observed price; remaining prices are unknown.`,
        `${candidates.filter((c) => c.contacts?.sales_email || c.contacts?.export_email || c.contacts?.general_email || c.contacts?.phone).length} profiles contain business contact data.`,
        `Request lineage: ${approved ? approved.revision_id : "unavailable"}.`,
      ],
      candidate_count: count,
      confidence_assessment:
        isLive && evidence.length ? "medium" : "not_assessed",
      research_coverage_status: !isLive
        ? "not_assessed"
        : count === 20
          ? "sufficient"
          : count
            ? "partial"
            : "insufficient",
    },
    target_candidates_count: 20,
    total_candidates_found: count,
    supplier_candidates: candidates,
    claims,
    evidence_sources: evidence,
    telemetry: {
      lanes_executed: isLive
        ? [...new Set(result.executed_models ?? ["lane_gemini", "lane_openai"])]
        : [],
      verification_loops_count: result.verification_loops_completed,
      total_input_tokens: isLive ? result.total_input_tokens : 0,
      total_output_tokens: isLive ? result.total_output_tokens : 0,
      total_cost_usd: isLive ? result.total_cost_usd : 0,
      execution_latency_ms: result.total_latency_ms,
      synthesis_model_id: isLive
        ? (result.synthesis_result?.model ?? "evidence-preserving-projection")
        : "deterministic-demonstration",
      executed_at: now,
    },
    limitations_and_disclosures: limitations,
  };
}
