import assert from "node:assert/strict";
import test from "node:test";
import {
  consultantResearchInput,
  preflightResearchRoundContext,
} from "../../../packages/application/dist/research-context-preflight.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

const session = {
  account_id: "account",
  user_profile_id: "profile",
  run_id: "run",
  classification_id: "classification",
  mode: "live",
  intake: {
    product_requirement: "Market research service",
    technical_compliance: "Verify official evidence",
    order_profile: "One study",
  },
  approved_request_revision: {
    key_specifications: ["Fallback mandatory criterion"],
  },
  step3_deep_prompt: {
    is_approved: true,
    prompt_text: "Find a research service provider, not the underlying goods.",
    discovery_criteria: ["Official evidence OR a documented alternative"],
  },
};
const lead = {
  lead_id: researchLeadKey("Research Company"),
  name: "Research Company",
  source_urls: ["https://research.example/about"],
  anchor_quote: "Research Company",
  first_seen_round: 1,
  last_seen_round: 3,
};
const parent = {
  round_id: "parent",
  round_number: 3,
  status: "completed",
  account_id: session.account_id,
  user_profile_id: session.user_profile_id,
  run_id: session.run_id,
  classification_id: session.classification_id,
  continuation: {
    indexed_leads: [lead],
    roster: [],
    evidence: [],
    retrieved: [],
    remaining_gaps: ["Find current attributable service prices"],
  },
};
const plan = {
  round_number: 4,
  parent_round_id: parent.round_id,
  focus_analysis_required: true,
  research_strategy: "progressive-evidence.v1",
  purpose: "Inspect official institutional sources",
  focus_requirements: ["Find current attributable service prices"],
  max_input_tokens_per_call: 240000,
  follow_up: { question: "Verify ownership", lead_ids: [lead.lead_id] },
};
const db = {
  query() {
    throw new Error(
      "No database call is expected for current saved inventories",
    );
  },
};

test("MB-UX-QUALITY-001 L13 quotation and execution share full approved input and preserve alternatives", () => {
  const input = consultantResearchInput(session);
  assert.deepEqual(input, {
    ...session.intake,
    deep_prompt: session.step3_deep_prompt.prompt_text,
    mandatory_requirements: session.step3_deep_prompt.discovery_criteria,
    target_supplier_count: 20,
  });
  assert.deepEqual(
    consultantResearchInput({
      ...session,
      step3_deep_prompt: {
        ...session.step3_deep_prompt,
        discovery_criteria: [],
      },
    }).mandatory_requirements,
    session.approved_request_revision.key_specifications,
  );
  assert.throws(
    () =>
      consultantResearchInput({ ...session, approved_request_revision: null }),
    { code: "MB-409-APPROVAL-REQUIRED" },
  );
});
test("MB-UX-QUALITY-001 L13 preflight reads retained context without a provider call or snapshot mutation", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("No provider call is authorized by preflight");
  });
  const saved = structuredClone({ session, parent, plan });
  await preflightResearchRoundContext(db, session, plan, parent);
  assert.deepEqual({ session, parent, plan }, saved);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
test("MB-UX-QUALITY-001 L13 unavoidable context capacity failure is actionable before quote creation", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("No provider request");
  });
  await assert.rejects(
    preflightResearchRoundContext(
      db,
      {
        ...session,
        step3_deep_prompt: {
          ...session.step3_deep_prompt,
          prompt_text: "Immutable scope ".repeat(30000),
        },
      },
      plan,
      parent,
    ),
    (error) =>
      error.status === 409 &&
      error.code === "MB-409-FOCUS-CONTEXT" &&
      error.message.includes("No estimate or research has been started"),
  );
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
for (const field of [
  "account_id",
  "user_profile_id",
  "run_id",
  "classification_id",
  "round_id",
  "round_number",
  "status",
]) {
  test(`MB-UX-QUALITY-001 L13 preflight rejects mismatched parent ${field} before hydration`, async () => {
    await assert.rejects(
      preflightResearchRoundContext(db, session, plan, {
        ...parent,
        [field]: field === "round_number" ? 2 : "foreign",
      }),
      { code: "MB-409-FOCUS-STALE" },
    );
  });
}
test("MB-UX-QUALITY-001 L13 unknown selections cannot become a qualified quotation", async () => {
  await assert.rejects(
    preflightResearchRoundContext(
      db,
      session,
      {
        ...plan,
        follow_up: { question: "", lead_ids: [researchLeadKey("Unknown")] },
      },
      parent,
    ),
    { code: "MB-409-FOCUS-STALE" },
  );
});
test("MB-UX-QUALITY-001 L13 initial and demonstration quotations keep their existing path", async () => {
  await preflightResearchRoundContext(
    db,
    session,
    { ...plan, round_number: 1, focus_analysis_required: false },
    undefined,
  );
  await preflightResearchRoundContext(
    db,
    { ...session, mode: "demonstration" },
    plan,
    undefined,
  );
});
