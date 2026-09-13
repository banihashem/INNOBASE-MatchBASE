/** MB-UX-QUALITY-001 L01: discovery leads are not verified supplier dossiers. */
export interface ResearchLead {
  lead_id: string;
  name: string;
  website_url?: string;
  source_urls: string[];
  status: "needs_review" | "excluded";
  reason: string;
  missing_evidence: string[];
  first_seen_round: number;
  last_seen_round: number;
}
export interface ResearchFocusAnalysis {
  objective: string;
  question_summary: string;
  priority_lead_ids: string[];
  search_tasks: string[];
  evidence_gaps: string[];
  scope_notes: string[];
  /** Research direction only; these hypotheses cannot establish supplier facts. */
  insights?: ResearchInsight[];
}
export interface ResearchInsight {
  insight_id: string;
  kind:
    | "shared_source"
    | "shared_contact"
    | "shared_location"
    | "reported_relationship"
    | "contradiction"
    | "research_opportunity";
  statement: string;
  lead_ids: string[];
  source_urls: string[];
  next_question: string;
  status: "research_hypothesis";
}
export interface ResearchEvidenceFact {
  lead_id: string;
  field_path: string;
  value: string;
  quote: string;
  source_urls: string[];
}
export interface ResearchEvidenceMemory {
  version: "research-evidence-memory.v1";
  round_number: number;
  entities: { lead_id: string; name: string }[];
  /** Complete known reference inventory, even when fact excerpts are bounded. */
  source_urls: string[];
  facts: ResearchEvidenceFact[];
  relationships: ResearchInsight[];
  limitations: string[];
}
export interface ResearchMethodReview {
  method: "public_social" | "official_institutions";
  round_number: number;
  status: "references_found" | "no_cited_sources" | "incomplete";
  searched_at: string;
  lead_ids: string[];
  sources: {
    url: string;
    title: string;
    excerpt: string;
    retrieved_at: string | null;
    access: "retrieved" | "provider_citation_only" | "access_limited";
  }[];
  limitations: string[];
}
export interface ResearchReview {
  version: "research-review.v1";
  round_number: number;
  leads: ResearchLead[];
  coverage_gaps: string[];
  summary: {
    discovered: number;
    documented: number;
    needs_review: number;
    excluded: number;
  };
  changes: { new_leads: number; promoted: number };
  focus_analysis?: ResearchFocusAnalysis;
  evidence_memory?: ResearchEvidenceMemory;
  method_reviews?: ResearchMethodReview[];
}

function researchRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid research evidence object.");
  return value as Record<string, unknown>;
}
function researchText(value: unknown, maximum = 4000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error("Invalid research evidence text.");
}
function researchList(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid research evidence list.");
  return value;
}
function researchId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value))
    throw new Error("Invalid research evidence ID.");
}
function researchUrl(value: unknown): asserts value is string {
  researchText(value, 12000);
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid research evidence URL.");
}
function researchRound(value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  )
    throw new Error("Invalid research evidence round.");
}
function researchDate(value: unknown): void {
  researchText(value, 100);
  if (!Number.isFinite(Date.parse(value)))
    throw new Error("Invalid research evidence date.");
}
export function validateResearchInsight(
  value: unknown,
): asserts value is ResearchInsight {
  const insight = researchRecord(value);
  researchId(insight.insight_id);
  if (
    ![
      "shared_source",
      "shared_contact",
      "shared_location",
      "reported_relationship",
      "contradiction",
      "research_opportunity",
    ].includes(String(insight.kind)) ||
    insight.status !== "research_hypothesis"
  )
    throw new Error("Invalid research insight kind or status.");
  researchText(insight.statement, 500);
  researchText(insight.next_question, 400);
  const ids = researchList(insight.lead_ids),
    urls = researchList(insight.source_urls);
  if (
    !ids.length ||
    ids.length > 20 ||
    !urls.length ||
    urls.length > 20 ||
    new Set(ids).size !== ids.length ||
    new Set(urls).size !== urls.length
  )
    throw new Error("Invalid research insight references.");
  ids.forEach(researchId);
  urls.forEach(researchUrl);
}
export function validateResearchEvidenceMemory(
  value: unknown,
): asserts value is ResearchEvidenceMemory {
  const memory = researchRecord(value);
  if (memory.version !== "research-evidence-memory.v1")
    throw new Error("Invalid research evidence memory version.");
  researchRound(memory.round_number);
  const entities = researchList(memory.entities).map(researchRecord);
  const ids = new Set(entities.map((entity) => entity.lead_id));
  if (ids.size !== entities.length)
    throw new Error("Duplicate research memory entity.");
  for (const entity of entities) {
    researchId(entity.lead_id);
    researchText(entity.name);
  }
  const urls = researchList(memory.source_urls);
  urls.forEach(researchUrl);
  const sources = new Set(urls);
  if (sources.size !== urls.length)
    throw new Error("Duplicate research memory source.");
  const facts = researchList(memory.facts).map(researchRecord);
  if (facts.length > 240)
    throw new Error("Research memory fact allowance exceeded.");
  for (const fact of facts) {
    researchId(fact.lead_id);
    if (!ids.has(fact.lead_id))
      throw new Error("Unknown research memory fact entity.");
    researchText(fact.field_path, 96);
    researchText(fact.value, 500);
    researchText(fact.quote, 2000);
    if (!(fact.quote as string).includes(fact.value as string))
      throw new Error("Research memory fact is not literal source text.");
    const refs = researchList(fact.source_urls);
    if (!refs.length || refs.some((url) => !sources.has(url)))
      throw new Error("Unknown research memory fact source.");
  }
  const insights = researchList(memory.relationships);
  if (insights.length > 32)
    throw new Error("Research memory relationship allowance exceeded.");
  for (const insight of insights) {
    validateResearchInsight(insight);
    if (
      insight.lead_ids.some((id) => !ids.has(id)) ||
      insight.source_urls.some((url) => !sources.has(url))
    )
      throw new Error("Unknown research memory insight reference.");
  }
  researchList(memory.limitations).forEach((item) => researchText(item));
}
export function validateResearchMethodReview(
  value: unknown,
): asserts value is ResearchMethodReview {
  const review = researchRecord(value);
  if (
    !["public_social", "official_institutions"].includes(
      String(review.method),
    ) ||
    !["references_found", "no_cited_sources", "incomplete"].includes(
      String(review.status),
    )
  )
    throw new Error("Invalid research method or status.");
  researchRound(review.round_number);
  researchDate(review.searched_at);
  researchList(review.lead_ids).forEach(researchId);
  const sources = researchList(review.sources).map(researchRecord);
  if (
    (review.status === "references_found" && !sources.length) ||
    (review.status === "no_cited_sources" && sources.length)
  )
    throw new Error("Research method coverage disagrees with sources.");
  for (const source of sources) {
    researchUrl(source.url);
    researchText(source.title);
    if (typeof source.excerpt !== "string" || source.excerpt.length > 12000)
      throw new Error("Invalid research method source excerpt.");
    if (source.retrieved_at !== null) researchDate(source.retrieved_at);
    if (
      !["retrieved", "provider_citation_only", "access_limited"].includes(
        String(source.access),
      )
    )
      throw new Error("Invalid research method source access.");
    if (source.access === "retrieved" && source.retrieved_at === null)
      throw new Error("Retrieved research source requires a date.");
  }
  researchList(review.limitations).forEach((item) => researchText(item));
}

export function validateResearchReview(
  value: unknown,
): asserts value is ResearchReview {
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new Error("Invalid research review object.");
    return v as Record<string, unknown>;
  };
  const text = (v: unknown) => {
    if (typeof v !== "string" || !v.trim())
      throw new Error("Invalid research review text.");
  };
  const list = (v: unknown): unknown[] => {
    if (!Array.isArray(v)) throw new Error("Invalid research review list.");
    return v;
  };
  const count = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      throw new Error("Invalid research review count.");
    return v;
  };
  const id = (v: unknown) => {
    if (typeof v !== "string" || !/^[a-f0-9]{24}$/.test(v))
      throw new Error("Invalid research lead ID.");
  };
  const url = (v: unknown) => {
    text(v);
    const parsed = new URL(v as string);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Invalid research lead source URL.");
  };
  const review = record(value);
  if (review.version !== "research-review.v1")
    throw new Error("Invalid research review version.");
  const round = count(review.round_number);
  if (round < 1 || round > 5) throw new Error("Invalid research review round.");
  const ids = new Set<unknown>();
  const leads = list(review.leads).map(record);
  for (const lead of leads) {
    id(lead.lead_id);
    if (ids.has(lead.lead_id)) throw new Error("Duplicate research lead ID.");
    ids.add(lead.lead_id);
    text(lead.name);
    text(lead.reason);
    if (!["needs_review", "excluded"].includes(String(lead.status)))
      throw new Error("Invalid research lead status.");
    list(lead.source_urls).forEach(url);
    if (lead.website_url !== undefined) url(lead.website_url);
    list(lead.missing_evidence).forEach(text);
    const first = count(lead.first_seen_round),
      last = count(lead.last_seen_round);
    if (first < 1 || first > last || last > round)
      throw new Error("Invalid research lead history.");
  }
  list(review.coverage_gaps).forEach(text);
  const summary = record(review.summary),
    changes = record(review.changes);
  for (const field of ["discovered", "documented", "needs_review", "excluded"])
    count(summary[field]);
  for (const field of ["new_leads", "promoted"]) count(changes[field]);
  if (
    summary.needs_review !==
      leads.filter((lead) => lead.status === "needs_review").length ||
    summary.excluded !==
      leads.filter((lead) => lead.status === "excluded").length
  )
    throw new Error("Research review counts disagree with retained leads.");
  if (review.focus_analysis !== undefined) {
    const focus = record(review.focus_analysis);
    text(focus.objective);
    text(focus.question_summary);
    list(focus.priority_lead_ids).forEach(id);
    for (const field of ["search_tasks", "evidence_gaps", "scope_notes"])
      list(focus[field]).forEach(text);
    if (!list(focus.search_tasks).length)
      throw new Error("Research focus requires an actionable task.");
    if (focus.insights !== undefined) {
      const insights = list(focus.insights);
      if (insights.length > 8)
        throw new Error("Research focus insight allowance exceeded.");
      insights.forEach(validateResearchInsight);
    }
  }
  if (review.evidence_memory !== undefined) {
    validateResearchEvidenceMemory(review.evidence_memory);
    if (review.evidence_memory.round_number !== round)
      throw new Error("Research memory round mismatch.");
  }
  if (review.method_reviews !== undefined) {
    for (const method of list(review.method_reviews)) {
      validateResearchMethodReview(method);
      if (method.round_number > round)
        throw new Error("Research method refers to a future round.");
    }
  }
}
