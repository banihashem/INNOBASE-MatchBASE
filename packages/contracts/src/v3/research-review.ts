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
  }
}
