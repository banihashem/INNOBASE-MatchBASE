import { createHash } from "node:crypto";
import type { ResearchReview, SupplierEntityV3 } from "@matchbase/contracts";
import type { ResearchContinuation } from "./dual-lane-orchestrator.js";
import { evaluateLiveCandidate } from "./live-supplier-evidence.js";
import { safePublicEvidenceUrl } from "./openrouter-model-policy.js";
import type { Queryable, ResearchRoundRecord } from "@matchbase/data";
import {
  groundNativeCandidateIndex,
  type CandidateIndex,
} from "./native-candidate-index.js";
import { researchCitationInventory } from "./research-source-context.js";
import type {
  LiveResearchCheckpoint,
  OpenRouterCompletionResult,
} from "./openrouter-model-policy.js";

export interface CollectedResearchLead {
  lead_id: string;
  name: string;
  anchor_quote: string;
  source_urls: string[];
  first_seen_round: number;
  last_seen_round: number;
}
export const researchLeadKey = (name: string) =>
  createHash("sha256")
    .update(
      name
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .digest("hex")
    .slice(0, 24);

/** Merge exact observed names only; a shared domain is not corporate identity. */
export function collectResearchLeads(
  previous: readonly CollectedResearchLead[],
  indexed: readonly {
    legal_name: string;
    anchor_quote: string;
    source_urls: string[];
  }[],
  round: number,
): CollectedResearchLead[] {
  const leads = new Map(
    previous.map((lead) => [
      lead.lead_id,
      { ...lead, source_urls: [...lead.source_urls] },
    ]),
  );
  for (const item of indexed) {
    const lead_id = researchLeadKey(item.legal_name);
    const old = leads.get(lead_id);
    leads.set(lead_id, {
      lead_id,
      name: item.legal_name,
      anchor_quote: item.anchor_quote,
      source_urls: [
        ...new Set([...(old?.source_urls ?? []), ...item.source_urls]),
      ],
      first_seen_round: old?.first_seen_round ?? round,
      last_seen_round: round,
    });
  }
  return [...leads.values()];
}

/** Public review is a curated projection; raw responses remain in the round snapshot. */
export function buildResearchReview(
  continuation: ResearchContinuation | undefined,
  candidates: readonly SupplierEntityV3[],
  requirements: readonly string[],
  round: number,
  previous?: ResearchReview,
): ResearchReview {
  let collected = continuation?.indexed_leads ?? [];
  for (const [, item] of continuation?.roster ?? []) {
    if (
      collected.some(
        (lead) => lead.lead_id === researchLeadKey(item.legal_name),
      )
    )
      continue;
    collected = collectResearchLeads(
      collected,
      [
        {
          legal_name: item.legal_name,
          anchor_quote: item.identity.quote,
          source_urls: [
            ...item.identity.source_urls,
            ...item.product.source_urls,
          ],
        },
      ],
      round,
    );
  }
  const documented = new Set(
    candidates.map((item) => researchLeadKey(item.legal_name)),
  );
  const evidence = new Map(continuation?.evidence);
  const roster = new Map(
    (continuation?.roster ?? []).map(([, item]) => [
      researchLeadKey(item.legal_name),
      item,
    ]),
  );
  const leads = collected
    .filter((lead) => !documented.has(lead.lead_id))
    .map((lead) => {
      const record = roster.get(lead.lead_id);
      const problems = record
        ? evaluateLiveCandidate(record, requirements, evidence)
        : [];
      const excluded = problems.some((reason) =>
        reason.startsWith("Mandatory technical or compliance mismatch:"),
      );
      const source_urls = [
        ...new Set([
          ...lead.source_urls,
          ...(record?.identity.source_urls ?? []),
          ...(record?.product.source_urls ?? []),
        ]),
      ].filter((url) => Boolean(safePublicEvidenceUrl(url)));
      const website = record?.website && safePublicEvidenceUrl(record.website);
      const missing = record
        ? [...new Set([...problems, ...record.unknowns])]
        : [
            "Identity and relevant service or product evidence have not yet been assessed in a detailed dossier.",
          ];
      return {
        lead_id: lead.lead_id,
        name: lead.name,
        ...(website ? { website_url: website } : {}),
        source_urls,
        status: excluded ? ("excluded" as const) : ("needs_review" as const),
        reason: excluded
          ? "Available evidence conflicts with a mandatory requirement. Review the cited basis before further investigation."
          : record
            ? "Evidence is incomplete for a documented supplier profile. This is a research lead, not a verified recommendation."
            : "Found during discovery; detailed evidence review remains pending. This name is not a verified supplier.",
        missing_evidence: missing.map((item) => item.trim()).filter(Boolean),
        first_seen_round: lead.first_seen_round,
        last_seen_round: lead.last_seen_round,
      };
    });
  const oldIds = new Set(previous?.leads.map((lead) => lead.lead_id));
  return {
    version: "research-review.v1",
    round_number: round,
    leads,
    coverage_gaps: [
      ...new Set([
        ...(continuation?.remaining_gaps ?? []),
        ...(continuation?.coverage_gaps ?? []),
      ]),
    ]
      .map((item) => item.trim())
      .filter(Boolean),
    summary: {
      discovered: new Set([
        ...collected.map((lead) => lead.lead_id),
        ...documented,
      ]).size,
      documented: candidates.length,
      needs_review: leads.filter((lead) => lead.status === "needs_review")
        .length,
      excluded: leads.filter((lead) => lead.status === "excluded").length,
    },
    changes: {
      new_leads: leads.filter((lead) => lead.first_seen_round === round).length,
      promoted: [...documented].filter((id) => oldIds.has(id)).length,
    },
    ...(continuation?.focus_analysis
      ? { focus_analysis: continuation.focus_analysis }
      : {}),
  };
}

/** Compatibility projection for old completed rounds; never rewrites their saved output. */
export async function hydrateResearchContinuation(
  db: Queryable,
  round: ResearchRoundRecord,
): Promise<ResearchContinuation> {
  const prior = structuredClone(
    (round.continuation ?? {
      roster: [],
      evidence: [],
      retrieved: [],
      remaining_gaps: [],
    }) as unknown as ResearchContinuation,
  );
  const rosterLeads = prior.roster.map(([, item]) => ({
    legal_name: item.legal_name,
    anchor_quote: item.identity.quote,
    source_urls: [...item.identity.source_urls, ...item.product.source_urls],
  }));
  const appendRoster = (leads: CollectedResearchLead[]) =>
    collectResearchLeads(
      leads,
      rosterLeads.filter(
        (item) =>
          !leads.some(
            (lead) => lead.lead_id === researchLeadKey(item.legal_name),
          ),
      ),
      round.round_number,
    );
  if (prior.indexed_leads !== undefined)
    prior.indexed_leads = appendRoster(prior.indexed_leads);
  if (prior.indexed_leads !== undefined) return prior;
  let ancestorLeads: CollectedResearchLead[] = [];
  if (round.round_number > 1 && round.plan.parent_round_id) {
    const parents = await db.query<ResearchRoundRecord>(
      `SELECT * FROM consultant_research_round WHERE round_id=$1
       AND account_id=$2 AND run_id=$3 AND user_profile_id=$4 AND classification_id=$5
       AND round_number=$6 AND status='completed' AND output IS NOT NULL`,
      [
        round.plan.parent_round_id,
        round.account_id,
        round.run_id,
        round.user_profile_id,
        round.classification_id,
        round.round_number - 1,
      ],
    );
    const parent = parents.rows[0];
    if (parent)
      ancestorLeads =
        (await hydrateResearchContinuation(db, parent)).indexed_leads ?? [];
  }
  const events = await db.query<{
    phase: string;
    detail: Partial<LiveResearchCheckpoint>;
  }>(
    `SELECT phase,detail FROM consultant_workflow_event WHERE account_id=$1 AND run_id=$2 AND execution_id=$3 AND detail ? 'response_content' ORDER BY event_id`,
    [round.account_id, round.run_id, round.execution_id],
  );
  // Raw failed responses remain in the audit history, never in follow-up
  // grounding. A completed index can still retain an incomplete research lead
  // when its subsequent supplier-details extraction failed.
  const completed = events.rows.filter(
    ({ detail }) =>
      detail.state === "completed" &&
      !detail.response_failure_kind &&
      (!detail.finish_reason || detail.finish_reason === "stop") &&
      (!detail.native_finish_reason ||
        detail.native_finish_reason.toUpperCase() === "STOP"),
  );
  const native = completed.filter(
    (event) =>
      /^(discovery|verification)/.test(event.phase) &&
      !event.phase.includes("extraction"),
  );
  const citations = researchCitationInventory(
    native.flatMap((event) =>
      (event.detail.response_citations ?? []).map((source) => ({
        url: source.url,
        title: source.title,
        content: source.content_excerpt ?? "",
      })),
    ),
    prior.native_citations ?? [],
    new Map(prior.retrieved),
  );
  const completion: OpenRouterCompletionResult = {
    model: "retained-source-projection",
    input_tokens: 0,
    output_tokens: 0,
    latency_ms: 0,
    cost_usd: 0,
    live_api_invoked: false,
    text: native.map((event) => event.detail.response_content ?? "").join("\n"),
    citations: citations.map((source) => ({
      ...source,
      content: [
        source.content ?? "",
        prior.retrieved.find(([url]) => url === source.url)?.[1]?.text ?? "",
      ].join("\n"),
    })),
  };
  let leads: CollectedResearchLead[] = ancestorLeads;
  for (const event of completed.filter((item) =>
    item.phase.endsWith("extraction_index"),
  )) {
    try {
      const index = JSON.parse(
        (event.detail.response_content ?? "").replace(
          /^```(?:json)?\s*|\s*```$/g,
          "",
        ),
      ) as CandidateIndex;
      if (!Array.isArray(index.candidates)) continue;
      index.candidates = index.candidates.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.legal_name === "string" &&
          item.legal_name.length > 0 &&
          item.legal_name.length <= 200 &&
          typeof item.anchor_quote === "string" &&
          Array.isArray(item.source_urls) &&
          item.source_urls.every((url) => typeof url === "string"),
      );
      const grounded = groundNativeCandidateIndex(index, completion);
      leads = collectResearchLeads(
        leads,
        grounded.index.candidates,
        round.round_number,
      );
    } catch {
      // Invalid or truncated historical text is retained in its event, not promoted to a lead.
    }
  }
  prior.indexed_leads = appendRoster(leads);
  return prior;
}

export async function getResearchRoundReview(
  db: Queryable,
  round: ResearchRoundRecord,
): Promise<ResearchReview> {
  if (round.output?.research_review)
    return round.output.research_review as ResearchReview;
  return buildResearchReview(
    await hydrateResearchContinuation(db, round),
    (round.output?.supplier_candidates ?? []) as SupplierEntityV3[],
    round.plan.focus_requirements,
    round.round_number,
  );
}
