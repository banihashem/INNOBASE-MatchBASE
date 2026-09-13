import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  executeConsultantWorkflowResearch,
  getOrRestoreWorkflowSession,
} from "../../../packages/application/dist/consultant-v3-service.js";
import { preflightResearchRoundContext } from "../../../packages/application/dist/research-context-preflight.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

function legacyFixture() {
  const identity = {
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    classification_id: randomUUID(),
  };
  const model = "openai/gpt-5.2";
  const name = "Historical Research Company";
  const url = "https://historical-company.example/about";
  const parent = {
    ...identity,
    round_id: randomUUID(),
    execution_id: randomUUID(),
    round_number: 1,
    status: "completed",
    continuation: null,
    output: { supplier_candidates: [] },
    plan: { parent_round_id: null, focus_requirements: [] },
  };
  const plan = {
    mode: "live",
    round_number: 2,
    parent_round_id: parent.round_id,
    focus_analysis_required: true,
    research_strategy: "progressive-evidence.v1",
    depth: "simple",
    purpose: "Inspect the retained company evidence",
    focus_requirements: ["Original company identity"],
    follow_up: {
      question: "Verify the retained company",
      lead_ids: [researchLeadKey(name)],
    },
    research_models: [model],
    extraction_model: model,
    synthesis_model: model,
    search_engine: "native",
    max_calls: 5,
    automatic_recovery_attempts: 1,
    max_input_tokens_per_call: 240000,
    max_output_tokens_per_call: 12000,
    rates: [
      {
        model,
        provider: "openai",
        billing_mode: "byok",
        structured_outputs: true,
        reasoning: true,
        input_usd_per_token: 0.000001,
        output_usd_per_token: 0.000002,
        request_usd: 0,
        web_search_usd: 0,
      },
    ],
  };
  const round = {
    ...identity,
    round_id: randomUUID(),
    execution_id: randomUUID(),
    round_number: 2,
    status: "approved",
    plan,
  };
  const row = {
    ...identity,
    session_id: randomUUID(),
    execution_id: round.execution_id,
    current_state: "prep_step3_prompt_approved",
    created_at: new Date("2026-09-13T00:00:00Z"),
    updated_at: new Date("2026-09-13T00:00:00Z"),
    original_intake: {
      ...identity,
      product_requirement: "Industrial pumps",
      technical_compliance: "Original identity evidence",
      order_profile: "Ten pumps",
    },
    approved_request_revision: {
      key_specifications: ["Original company identity"],
    },
    deep_prompt_revision: {
      is_approved: true,
      prompt_text: "Find evidenced suppliers",
      discovery_criteria: ["Original company identity"],
    },
    workflow_metadata: {
      mode: "live",
      classification_id: identity.classification_id,
    },
  };
  const historicalEvents = [
    {
      phase: "discovery_openai",
      detail: {
        state: "completed",
        response_content: `${name} supplies industrial pumps.`,
        response_citations: [
          {
            url,
            title: name,
            content_excerpt: `${name} supplies industrial pumps.`,
          },
        ],
      },
    },
    {
      phase: "discovery_openai_extraction_index",
      detail: {
        state: "completed",
        response_content: JSON.stringify({
          candidates: [
            {
              legal_name: name,
              anchor_quote: `${name} supplies industrial pumps.`,
              source_urls: [url],
            },
          ],
          remaining_gaps: [],
          evidence_exhausted: false,
          summary: "Observed company",
        }),
      },
    },
  ];
  const hydrationQueries = [],
    writes = [];
  const db = {
    async query(sql, values) {
      if (
        sql.startsWith("SELECT") &&
        sql.includes("FROM consultant_workflow_session")
      )
        return { rows: [row] };
      if (
        sql.startsWith("SELECT") &&
        sql.includes("FROM consultant_research_round")
      )
        return {
          rows: sql.includes("execution_id=$2") ? [round] : [parent, round],
        };
      if (
        sql.startsWith("SELECT phase,detail FROM consultant_workflow_event")
      ) {
        assert.deepEqual(values, [
          identity.account_id,
          identity.run_id,
          parent.execution_id,
        ]);
        hydrationQueries.push(values);
        return { rows: historicalEvents };
      }
      if (
        sql.startsWith(
          "SELECT execution_id,phase,detail FROM consultant_provider_call",
        )
      )
        return { rows: [] };
      if (/^(INSERT|UPDATE)/.test(sql)) {
        writes.push(sql);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected synthetic query: ${sql}`);
    },
  };
  return {
    db,
    row,
    parent,
    round,
    plan,
    name,
    url,
    model,
    hydrationQueries,
    writes,
  };
}

test("MB-UX-QUALITY-001 L13 worker consumes the same hydrated legacy parent and selected lead qualified by quotation", async (t) => {
  const f = legacyFixture();
  const savedParent = structuredClone(f.parent);
  const keys = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_OPENAI: "openai",
  };
  const previous = Object.fromEntries(
    Object.keys(keys).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, keys);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    const supported_parameters = [
      "structured_outputs",
      "max_tokens",
      "reasoning",
    ];
    if (url.endsWith("/models/user"))
      return Response.json({ data: [{ id: f.model, supported_parameters }] });
    if (url.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: "openai",
              provider_name: "OpenAI",
              model_id: f.model,
              supported_parameters,
            },
          ],
        },
      });
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    return Response.json(
      {
        error: {
          code: 400,
          message:
            "Synthetic terminal failure after intercepted planning request",
        },
      },
      { status: 400 },
    );
  });
  const session = await getOrRestoreWorkflowSession(
    f.db,
    f.row.account_id,
    f.row.run_id,
  );
  await preflightResearchRoundContext(f.db, session, f.plan, f.parent);
  assert.equal(f.hydrationQueries.length, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  await assert.rejects(
    executeConsultantWorkflowResearch(f.db, f.row.run_id),
    /HTTP 400/,
  );
  assert.equal(f.hydrationQueries.length, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].plugins, undefined);
  const context = JSON.parse(requests[0].messages[1].content);
  assert.deepEqual(context.buyer_follow_up.lead_ids, [researchLeadKey(f.name)]);
  assert.equal(context.prior_leads[0].name, f.name);
  assert.deepEqual(context.prior_leads[0].source_urls, [f.url]);
  assert.deepEqual(f.parent, savedParent);
});

for (const field of [
  "account_id",
  "user_profile_id",
  "run_id",
  "classification_id",
  "round_number",
  "status",
]) {
  test(`MB-UX-QUALITY-001 L13 worker rejects a mismatched focused parent ${field} before historical hydration`, async () => {
    const f = legacyFixture();
    f.parent[field] = field === "round_number" ? 4 : "foreign";
    await getOrRestoreWorkflowSession(f.db, f.row.account_id, f.row.run_id);
    await assert.rejects(
      executeConsultantWorkflowResearch(f.db, f.row.run_id),
      { code: "MB-409-FOCUS-STALE" },
    );
    assert.equal(f.hydrationQueries.length, 0);
  });
}

for (const variant of ["initial", "demonstration", "legacy-unfocused"]) {
  test(`MB-UX-QUALITY-001 L13 ${variant} execution does not introduce legacy-parent hydration`, async () => {
    const f = legacyFixture();
    if (variant === "demonstration") {
      f.row.workflow_metadata.mode = "demonstration";
      f.plan.mode = "demonstration";
    } else {
      f.plan.focus_analysis_required = false;
      delete f.plan.research_strategy;
    }
    if (variant === "initial") {
      f.plan.parent_round_id = null;
      f.plan.round_number = 1;
      f.round.round_number = 1;
    }
    await getOrRestoreWorkflowSession(f.db, f.row.account_id, f.row.run_id);
    const boundary = new Error(
      "Synthetic stop at the initial execution checkpoint",
    );
    await assert.rejects(
      executeConsultantWorkflowResearch(f.db, f.row.run_id, {
        assertLease: async () => {
          throw boundary;
        },
      }),
      (error) => error === boundary,
    );
    assert.equal(f.hydrationQueries.length, 0);
  });
}
