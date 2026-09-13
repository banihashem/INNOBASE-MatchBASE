import { createHash } from "node:crypto";
import {
  validateResearchEvidenceMemory,
  validateResearchInsight,
  type ResearchEvidenceFact,
  type ResearchEvidenceMemory,
  type ResearchInsight,
} from "@matchbase/contracts";
import type { ResearchContinuation } from "./dual-lane-orchestrator.js";
import { researchLeadKey } from "./research-review.js";
import {
  LiveResearchError,
  safePublicEvidenceUrl,
} from "./openrouter-model-policy.js";

type InsightDraft = Omit<ResearchInsight, "insight_id">;
const unique = (values: readonly string[]) => [...new Set(values)];
function identifiedInsight(draft: InsightDraft): ResearchInsight {
  const normalized = {
    kind: draft.kind,
    statement: draft.statement,
    next_question: draft.next_question,
    status: draft.status,
    lead_ids: unique(draft.lead_ids).sort(),
    source_urls: unique(draft.source_urls).sort(),
  };
  return {
    ...normalized,
    insight_id: createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex")
      .slice(0, 24),
  };
}

/** Inventory references remain data, never instructions or proof of ownership. */
export function researchEvidenceInventory(prior: ResearchContinuation) {
  const entities = new Map(
    (prior.indexed_leads ?? []).map((lead) => [
      lead.lead_id,
      { lead_id: lead.lead_id, name: lead.name },
    ]),
  );
  for (const [, candidate] of prior.roster) {
    const lead_id = researchLeadKey(candidate.legal_name);
    if (!entities.has(lead_id))
      entities.set(lead_id, { lead_id, name: candidate.legal_name });
  }
  const source_urls = unique(
    [
      ...(prior.indexed_leads ?? []).flatMap((lead) => lead.source_urls),
      ...prior.roster.flatMap(([, candidate]) => [
        ...(candidate.website ? [candidate.website] : []),
        ...candidate.identity.source_urls,
        ...candidate.product.source_urls,
        ...candidate.facts.flatMap((fact) => fact.source_urls),
        ...candidate.constraints.flatMap((fact) => fact.source_urls),
        ...candidate.certifications.flatMap((fact) => fact.source_urls),
      ]),
      ...prior.evidence.flatMap(([key, record]) => [
        key,
        record.source.source_url,
      ]),
      ...prior.retrieved.flatMap(([url, record]) => [
        url,
        ...(record ? [record.url] : []),
      ]),
      ...(prior.native_citations ?? []).map((citation) => citation.url),
      ...(prior.method_reviews ?? []).flatMap((review) =>
        review.sources.map((source) => source.url),
      ),
    ].filter(
      (url) => typeof url === "string" && Boolean(safePublicEvidenceUrl(url)),
    ),
  );
  return { entities: [...entities.values()], source_urls };
}

/** Reference validation is not semantic proof: all AI insights remain hypotheses. */
export function validateResearchFocusInsights(
  rawInsights: readonly InsightDraft[],
  prior: ResearchContinuation,
): ResearchInsight[] {
  const inventory = researchEvidenceInventory(prior);
  const ids = new Set(inventory.entities.map((entity) => entity.lead_id));
  const urls = new Set(inventory.source_urls);
  if (!Array.isArray(rawInsights) || rawInsights.length > 8)
    throw new LiveResearchError(
      "MB-422-FOCUS-PLAN",
      "The research insight allowance is invalid.",
    );
  return rawInsights.map((draft) => {
    try {
      const insight = identifiedInsight(draft);
      validateResearchInsight(insight);
      if (
        insight.lead_ids.some((id) => !ids.has(id)) ||
        insight.source_urls.some((url) => !urls.has(url))
      )
        throw new Error("Unknown reference.");
      return insight;
    } catch {
      throw new LiveResearchError(
        "MB-422-FOCUS-PLAN",
        "The research insight references an unknown lead or source, or has an invalid structure. No focused search was started.",
      );
    }
  });
}

/** Reconstruct literal observations before model-context excerpts can hide them. */
export function buildResearchEvidenceMemory(
  prior: ResearchContinuation,
  roundNumber: number,
): ResearchEvidenceMemory {
  const inventory = researchEvidenceInventory(prior);
  const evidence = new Map(prior.evidence);
  const facts: ResearchEvidenceFact[] = [];
  const observedFacts = new Set<string>();
  let factBytes = 0;
  let omitted = 0;
  const addFact = (
    lead_id: string,
    field_path: string,
    value: string,
    quote: string,
    sourceUrls: string[],
  ) => {
    if (!value?.trim() || !quote?.includes(value)) return;
    const source_urls = unique(
      sourceUrls.filter((url) => {
        const record = evidence.get(url);
        if (!record || !safePublicEvidenceUrl(url)) return false;
        const passages = record.verified_excerpts ?? [
          {
            excerpt: record.source.excerpt_summary,
            authoritative_text: record.authoritative_text,
          },
        ];
        return passages.some(
          (passage) =>
            passage.excerpt?.includes(quote) &&
            passage.authoritative_text?.includes(quote),
        );
      }),
    );
    if (!source_urls.length) return;
    const fact = { lead_id, field_path, value, quote, source_urls };
    const encoded = JSON.stringify(fact);
    if (observedFacts.has(encoded)) return;
    observedFacts.add(encoded);
    if (
      facts.length >= 240 ||
      value.length > 500 ||
      quote.length > 2000 ||
      field_path.length > 96
    ) {
      omitted++;
      return;
    }
    const bytes = Buffer.byteLength(encoded, "utf8");
    if (factBytes + bytes > 48000) {
      omitted++;
      return;
    }
    factBytes += bytes;
    facts.push(fact);
  };
  // Round-robin fields preserve useful observations across every retained company.
  const records = prior.roster.map(([, candidate]) => ({
    id: researchLeadKey(candidate.legal_name),
    observations: [
      {
        field_path: "identity.legal_name",
        value: candidate.legal_name,
        ...candidate.identity,
      },
      {
        field_path: "product_name",
        value: candidate.product_name,
        ...candidate.product,
      },
      ...candidate.facts,
    ],
  }));
  const longest = Math.max(
    0,
    ...records.map((record) => record.observations.length),
  );
  for (let index = 0; index < longest; index++)
    for (const record of records) {
      const observation = record.observations[index];
      if (observation)
        addFact(
          record.id,
          observation.field_path,
          observation.value,
          observation.quote,
          observation.source_urls,
        );
    }
  const relationships: ResearchInsight[] = [];
  let relationshipBytes = 0;
  let omittedRelationships = 0;
  const observedInsights = new Set<string>();
  const addInsight = (draft: InsightDraft) => {
    const insight = identifiedInsight(draft);
    if (observedInsights.has(insight.insight_id)) return;
    observedInsights.add(insight.insight_id);
    if (relationships.length >= 32) {
      omittedRelationships++;
      return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(insight), "utf8");
    if (relationshipBytes + bytes > 20000) {
      omittedRelationships++;
      return;
    }
    relationshipBytes += bytes;
    relationships.push(insight);
  };
  const grouped = new Map<string, ResearchEvidenceFact[]>();
  for (const fact of facts) {
    if (
      !/^(contacts\.(?:sales_email|export_email|general_email|phone)|headquarters_address|manufacturing_location)$/.test(
        fact.field_path,
      )
    )
      continue;
    const kind = fact.field_path.startsWith("contacts.")
      ? "shared_contact"
      : "shared_location";
    const key = `${kind}:${fact.value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), fact]);
  }
  for (const [key, group] of grouped) {
    const ids = unique(group.map((fact) => fact.lead_id));
    if (ids.length < 2) continue;
    if (ids.length > 20) {
      omittedRelationships++;
      continue;
    }
    const urls = unique(group.flatMap((fact) => fact.source_urls));
    if (urls.length > 20) {
      omittedRelationships++;
      continue;
    }
    addInsight({
      kind: key.startsWith("shared_contact:")
        ? "shared_contact"
        : "shared_location",
      statement: `Retained literal observations share ${key.startsWith("shared_contact:") ? "a business contact" : "a location value"}. This may reflect shared premises, representation or reused source material; it does not establish common ownership.`,
      lead_ids: ids,
      source_urls: urls,
      next_question:
        "Which independent official records distinguish these legal entities and explain the shared observation?",
      status: "research_hypothesis",
    });
  }
  const byField = new Map<string, ResearchEvidenceFact[]>();
  for (const fact of facts) {
    const key = `${fact.lead_id}:${fact.field_path}`;
    byField.set(key, [...(byField.get(key) ?? []), fact]);
  }
  for (const group of byField.values()) {
    if (unique(group.map((fact) => fact.value)).length < 2) continue;
    const urls = unique(group.flatMap((fact) => fact.source_urls));
    if (urls.length > 20) {
      omittedRelationships++;
      continue;
    }
    addInsight({
      kind: "contradiction",
      statement: `Different source observations remain for ${group[0]!.field_path.replaceAll(".", " ").replaceAll("_", " ")}. They may describe different dates, sites or commercial terms and require reconciliation.`,
      lead_ids: [group[0]!.lead_id],
      source_urls: urls,
      next_question:
        "Do source dates, entity identifiers and scope explain these differing values, or does a current contradiction remain?",
      status: "research_hypothesis",
    });
  }
  const bySource = new Map<string, string[]>();
  for (const lead of prior.indexed_leads ?? [])
    for (const url of lead.source_urls)
      if (inventory.source_urls.includes(url))
        bySource.set(url, unique([...(bySource.get(url) ?? []), lead.lead_id]));
  for (const [url, ids] of bySource) {
    if (ids.length < 2) continue;
    if (ids.length > 20) {
      omittedRelationships++;
      continue;
    }
    addInsight({
      kind: "shared_source",
      statement:
        "The same retained source references multiple companies. Co-mention and repeated publication do not establish affiliation or independent corroboration.",
      lead_ids: ids,
      source_urls: [url],
      next_question:
        "What separately attributable primary evidence establishes each company's identity and role?",
      status: "research_hypothesis",
    });
  }
  const ids = new Set(inventory.entities.map((entity) => entity.lead_id));
  const urls = new Set(inventory.source_urls);
  for (const insight of [
    ...(prior.focus_analysis?.insights ?? []),
    ...(prior.evidence_memory?.relationships ?? []),
  ]) {
    try {
      validateResearchInsight(insight);
      if (
        insight.lead_ids.every((id) => ids.has(id)) &&
        insight.source_urls.every((url) => urls.has(url))
      )
        addInsight(insight);
    } catch {
      /* Invalid historical hypotheses remain in their original snapshot, not active memory. */
    }
  }
  const memory: ResearchEvidenceMemory = {
    version: "research-evidence-memory.v1",
    round_number: roundNumber,
    ...inventory,
    facts,
    relationships,
    limitations: [
      "Facts are literal retained source observations, not independent certification of accuracy, identity, ownership or current commercial availability. Unverified candidate fields are excluded.",
      "Relationship insights are research hypotheses. A shared source, contact, location, corporate website or social profile is not proof of ownership or independent corroboration. Similar names and URL suffixes do not establish jurisdiction.",
      `All ${inventory.entities.length} known entity identities and ${inventory.source_urls.length} public source references are retained. Fact memory is bounded to 240 observations and 48,000 serialized bytes, 500 characters per value and 2,000 characters per literal quote; ${omitted} qualifying observations were omitted from this compact view. Full records remain in the round snapshot.`,
      `Relationship memory is bounded to 32 hypotheses and 20,000 serialized bytes, with at most 20 entities and 20 source references each; ${omittedRelationships} further hypotheses exceeded the compact allowance. Absence from this view is not evidence of absence.`,
    ],
  };
  validateResearchEvidenceMemory(memory);
  return memory;
}
