import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFocusedWebContext,
  buildResearchFocusContext,
  planResearchFocus,
} from "../../../packages/application/dist/research-focus-planner.js";
import {
  buildFocusedResearchInstructions,
  executeDualLaneResearch,
} from "../../../packages/application/dist/dual-lane-orchestrator.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

const messageBytes = (content, system = " ".repeat(12000)) =>
  Buffer.byteLength(
    JSON.stringify([
      { role: "system", content: system },
      { role: "user", content },
    ]),
    "utf8",
  ) + 512;

const rawQuestion = "RAW_MULTILINGUAL_QUESTION_MUST_NOT_REACH_WEB";
const input = {
  product_requirement: "Industrial pumps",
  technical_compliance: "Operating pressure at least 10 bar",
  mandatory_requirements: ["Operating pressure at least 10 bar"],
  order_profile: "10 units",
  deep_prompt:
    "Find evidenced suppliers without changing the approved requirements.",
};
const plan = {
  round_number: 2,
  focus_analysis_required: true,
  extraction_model: "openai/gpt-5.2",
  synthesis_model: "openai/gpt-5.2",
  research_models: ["google/gemini-3.8-flash"],
  max_input_tokens_per_call: 240000,
  purpose: "Verify previous findings",
  follow_up: { question: rawQuestion, lead_ids: [] },
};
const source = (index, page) =>
  `https://supplier-${index}.example.org/${page}/retained-source-reference-${"x".repeat(55)}`;
function savedInventory(count) {
  const indexed_leads = Array.from({ length: count }, (_, index) => ({
    lead_id: researchLeadKey(`Indexed Supplier ${index}`),
    name: `Indexed Supplier ${index}`,
    anchor_quote:
      `Indexed Supplier ${index}: ${"Literal retained source text. ".repeat(30)}`.slice(
        0,
        600,
      ),
    source_urls: [
      source(index, "about"),
      source(index, "catalog"),
      source(index, "offers"),
    ],
    first_seen_round: 1,
    last_seen_round: 1,
  }));
  return {
    indexed_leads,
    roster: indexed_leads.slice(0, 20).map((lead, index) => [
      `supplier-${index}`,
      {
        legal_name: lead.name,
        website: source(index, "official"),
        identity: {
          status: "unknown",
          source_urls: [lead.source_urls[0]],
          quote: lead.anchor_quote,
        },
        product: {
          status: "unknown",
          source_urls: [lead.source_urls[1]],
          quote: "Full product details ".repeat(150),
        },
        facts: [
          {
            field_path: "commercial.production_capacity",
            source_urls: [source(index, "capacity")],
            quote: "Unverified capacity statement ".repeat(100),
          },
        ],
        certifications: [],
        constraints: [],
        unknowns: ["Capacity must be verified"],
        risks: [],
      },
    ]),
    evidence: indexed_leads.slice(0, 20).map((lead, index) => [
      `evidence-${index}`,
      {
        source: {
          source_url: lead.source_urls[0],
          source_type: "official_website",
          excerpt_summary: lead.anchor_quote,
        },
        authoritative_text: "Original complete primary evidence ".repeat(200),
      },
    ]),
    retrieved: [
      [
        "https://retained.example.org/catalog",
        {
          url: "https://retained.example.org/catalog",
          text: "Retained full text",
          retrieved_at: "2026-09-11T00:00:00Z",
        },
      ],
    ],
    native_citations: [
      {
        url: "https://native.example.org/observation",
        content: "Unextracted observation",
      },
    ],
    remaining_gaps: ["Capacity", "Comparable dated prices"],
  };
}
const analysis = (selected) => ({
  objective: "Find primary evidence for capacity and dated comparable prices.",
  question_summary: "Verify previous claims against the approved requirements.",
  priority_lead_ids: selected,
  search_tasks: [
    "Inspect the selected suppliers' official technical and price sources.",
  ],
  evidence_gaps: ["Capacity", "Dated prices"],
  scope_notes: ["The approved pressure and quantity remain unchanged."],
});

test("MB-UX-QUALITY-001 L01 280-lead planner success also yields bounded focused web input with every name, source and selection", () => {
  const prior = savedInventory(280);
  const saved = structuredClone(prior);
  const selected = [
    prior.indexed_leads[0].lead_id,
    prior.indexed_leads[279].lead_id,
  ];
  const approved = {
    ...plan,
    follow_up: { question: rawQuestion, lead_ids: selected },
  };
  const oldPayload = JSON.stringify({
    retained_discovery_leads: prior.indexed_leads,
    current_roster: prior.roster.map(([, item]) => item),
  });
  assert.ok(
    Buffer.byteLength(oldPayload) > 240000,
    "The fixture reproduces the former native payload overflow.",
  );
  const planner = buildResearchFocusContext(input, approved, prior);
  assert.ok(
    Buffer.byteLength(planner) <= 200000,
    "Paid planning previously accepted this inventory.",
  );
  const serialized = buildFocusedWebContext(
    input,
    approved,
    prior,
    analysis(selected),
    {
      ...buildFocusedResearchInstructions(approved),
      publication_blockers: prior.roster.map(([, item]) => ({
        legal_name: item.legal_name,
        blockers: [
          "Inspect official identity and relevant capability evidence.",
        ],
      })),
    },
  );
  const context = JSON.parse(serialized);
  assert.ok(
    messageBytes(
      serialized,
      buildFocusedResearchInstructions(approved).system_instruction,
    ) <= approved.max_input_tokens_per_call,
    "The actual native messages, JSON escaping, system policy and 512-byte guard margin fit the approved allowance.",
  );
  const preflight = buildFocusedWebContext(
    input,
    approved,
    prior,
    undefined,
    buildFocusedResearchInstructions(approved),
  );
  assert.ok(
    messageBytes(
      preflight,
      buildFocusedResearchInstructions(approved).system_instruction,
    ) +
      60000 <=
      approved.max_input_tokens_per_call,
  );
  assert.deepEqual(
    context.retained_discovery_leads.map((lead) => lead.name),
    prior.indexed_leads.map((lead) => lead.name),
  );
  assert.deepEqual(
    context.retained_discovery_leads.map((lead) => lead.lead_id),
    prior.indexed_leads.map((lead) => lead.lead_id),
  );
  assert.deepEqual(
    context.retained_discovery_leads.map((lead) => lead.source_urls),
    prior.indexed_leads.map((lead) => lead.source_urls),
  );
  assert.deepEqual(context.selected_lead_ids, selected);
  assert.deepEqual(context.focused_research_plan, analysis(selected));
  for (let index = 0; index < 20; index++) {
    assert.equal(
      context.current_roster[index].legal_name,
      prior.roster[index][1].legal_name,
    );
    assert.ok(
      context.current_roster[index].source_urls.includes(
        source(index, "capacity"),
      ),
    );
    assert.ok(
      context.current_roster[index].source_urls.includes(
        source(index, "official"),
      ),
    );
  }
  assert.ok(context.additional_source_urls.includes(prior.retrieved[0][0]));
  assert.ok(
    context.additional_source_urls.includes(prior.native_citations[0].url),
  );
  assert.equal(serialized.includes(rawQuestion), false);
  assert.match(
    context.context_disclosure,
    /Full records remain in the saved previous round/,
  );
  assert.match(context.context_disclosure, /excerpts/);
  assert.deepEqual(context.approved_request, input);
  assert.deepEqual(prior, saved);
});

test("MB-UX-QUALITY-001 L01 unavoidable immutable inventory overflow stops before paid focus planning", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected provider request");
  });
  const prior = savedInventory(1600);
  await assert.rejects(planResearchFocus(input, plan, prior, {}), {
    code: "MB-409-FOCUS-CONTEXT",
    message:
      "MB-409-FOCUS-CONTEXT: The saved research inventory exceeds this approved focused-search allowance. No focused search was started.",
  });
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("MB-UX-QUALITY-001 L01 live orchestrator rejects oversized focused inventory before any planning or native request", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected provider request");
  });
  const beforeCall = t.mock.fn(() => {
    throw new Error("No paid call may be admitted.");
  });
  await assert.rejects(
    executeDualLaneResearch(input, {
      mode: "live",
      round_plan: plan,
      continuation: savedInventory(1600),
      before_call: beforeCall,
    }),
    { code: "MB-409-FOCUS-CONTEXT" },
  );
  assert.equal(beforeCall.mock.callCount(), 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("MB-UX-QUALITY-001 L01 focused context uses UTF-8 bytes and never truncates immutable lead identities to fit", () => {
  const prior = savedInventory(280);
  prior.indexed_leads = prior.indexed_leads.map((lead) => ({
    ...lead,
    name: `${lead.name} ${"供應商".repeat(8)}`,
    anchor_quote: "來源原文".repeat(200),
  }));
  const serialized = buildFocusedWebContext(input, plan, prior, analysis([]));
  assert.ok(messageBytes(serialized) <= plan.max_input_tokens_per_call);
  assert.deepEqual(
    JSON.parse(serialized).retained_discovery_leads.map((lead) => lead.name),
    prior.indexed_leads.map((lead) => lead.name),
  );
  assert.throws(
    () =>
      buildFocusedWebContext(
        { ...input, deep_prompt: "immutable approved request ".repeat(15000) },
        plan,
        prior,
      ),
    { code: "MB-409-FOCUS-CONTEXT" },
  );
});

test("MB-UX-QUALITY-001 L01 escaping-heavy evidence fits the full planner and native request guards", () => {
  const prior = savedInventory(280);
  for (const lead of prior.indexed_leads)
    lead.anchor_quote = String.fromCharCode(34, 92).repeat(600);
  for (const [, record] of prior.roster)
    record.product.quote = String.fromCharCode(34, 92).repeat(5000);
  for (const [, record] of prior.evidence)
    record.authoritative_text = String.fromCharCode(34, 92).repeat(5000);
  const saved = structuredClone(prior);
  const planner = buildResearchFocusContext(input, plan, prior);
  const instructions = buildFocusedResearchInstructions(plan);
  const native = buildFocusedWebContext(
    input,
    plan,
    prior,
    analysis([]),
    instructions,
  );
  assert.ok(messageBytes(planner) <= plan.max_input_tokens_per_call);
  assert.ok(
    messageBytes(native, instructions.system_instruction) <=
      plan.max_input_tokens_per_call,
  );
  assert.deepEqual(
    JSON.parse(native).retained_discovery_leads.map((lead) => lead.source_urls),
    prior.indexed_leads.map((lead) => lead.source_urls),
  );
  assert.deepEqual(prior, saved);
});

test("MB-UX-QUALITY-001 L01 preflight reserves returned analysis before paying for a near-limit immutable inventory", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected provider request");
  });
  const prior = savedInventory(350);
  const instructions = buildFocusedResearchInstructions(plan);
  const native = buildFocusedWebContext(
    input,
    plan,
    prior,
    analysis([]),
    instructions,
  );
  assert.ok(
    messageBytes(native, instructions.system_instruction) <=
      plan.max_input_tokens_per_call,
  );
  await assert.rejects(
    planResearchFocus(input, plan, prior, {}, instructions),
    { code: "MB-409-FOCUS-CONTEXT" },
  );
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
