import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  groundRecentPriceObservations,
  selectPriceSourceExcerpt,
  parsePublicPriceDate,
  executeRecentPriceResearch,
} from "../../../packages/application/dist/recent-price-research.js";
import { synthesizeConsultantOutputV3 } from "../../../packages/application/dist/synthesis-engine.js";
import { executeDualLaneResearch } from "../../../packages/application/dist/dual-lane-orchestrator.js";
import { parseConsultantResearchOutputV3 } from "../../../packages/contracts/dist/src/index.js";
const source = "https://prices.example.com/rice";
const asOf = "2026-09-09T12:00:00.000Z";
function observation(date = "2026-09-08", extra = {}) {
  return {
    source_url: source,
    quote: "Acme Rice offers Grade A rice at 500 to 550 USD / MT FOB India.",
    date_quote: `Published ${date}.`,
    amount_min: "500",
    amount_max: "550",
    currency: "USD",
    unit: "MT",
    product_or_service: "Grade A rice",
    route_or_market: "India",
    quantity_basis: null,
    incoterm: "FOB",
    source_date_text: date,
    valid_until_text: null,
    date_basis: "published",
    provenance: "supplier_listing",
    supplier_name: "Acme Rice",
    relevance_note:
      "Comparable grade; confirm quantity and destination freight.",
    ...extra,
  };
}
function citations(row) {
  return [
    {
      url: source,
      title: "Public rice prices",
      content: `${row.quote} ${row.date_quote}`,
    },
  ];
}
test("L02 price freshness requires literal dated source evidence and separates benchmark attribution", () => {
  const row = observation();
  const result = groundRecentPriceObservations([row], citations(row), asOf, 7);
  assert.equal(result.length, 1);
  assert.equal(result[0].recency, "under_7_days");
  assert.equal(result[0].price_min, 500);
  assert.equal(
    groundRecentPriceObservations(
      [{ ...row, amount_min: "499" }],
      citations(row),
      asOf,
      7,
    ).length,
    0,
  );
  assert.equal(
    groundRecentPriceObservations(
      [{ ...row, source_url: "https://invented.example.com" }],
      citations(row),
      asOf,
      7,
    ).length,
    0,
  );
  assert.equal(
    groundRecentPriceObservations(
      [{ ...row, source_date_text: "2026-09-09" }],
      citations(row),
      asOf,
      7,
    ).length,
    0,
  );
  for (const [quote, amount] of [
    ["Price 500 USD", "50"],
    ["Price 0.5 USD", "5"],
    ["Price 1,500 USD", "50"],
    ["Price 1 500 USD", "500"],
    ["Price 500.50 USD", "500"],
  ]) {
    const misleading = {
      ...row,
      quote,
      amount_min: amount,
      amount_max: amount,
      product_or_service: "Price",
      supplier_name: null,
      provenance: "market_benchmark",
      unit: null,
      route_or_market: null,
      incoterm: null,
    };
    assert.equal(
      groundRecentPriceObservations(
        [misleading],
        citations(misleading),
        asOf,
        7,
      ).length,
      0,
      quote,
    );
  }
  const formatted = {
    ...row,
    quote: row.quote.replace("500 to 550", "1,500.50 to 1,550.50"),
    amount_min: "1,500.50",
    amount_max: "1,550.50",
  };
  assert.equal(
    groundRecentPriceObservations([formatted], citations(formatted), asOf, 7)[0]
      .price_min,
    1500.5,
  );
  const today = {
    ...row,
    date_quote: "Published 2026-09-08. Valid until 2026-09-09.",
    valid_until_text: "2026-09-09",
  };
  assert.equal(
    groundRecentPriceObservations([today], citations(today), asOf, 7)[0]
      .valid_until,
    "2026-09-09T23:59:59.999Z",
  );
  const benchmark = { ...row, provenance: "market_benchmark" };
  assert.equal(
    groundRecentPriceObservations([benchmark], citations(benchmark), asOf, 7)[0]
      .supplier_name,
    null,
  );
  for (const date of [
    "2026-09-10",
    "2026-08-10",
    "02/09/2026",
    "February 31, 2026",
  ]) {
    const candidate = observation(date);
    assert.equal(
      groundRecentPriceObservations([candidate], citations(candidate), asOf, 30)
        .length,
      0,
      date,
    );
  }
  const older = observation("2026-09-01");
  assert.equal(
    groundRecentPriceObservations([older], citations(older), asOf, 7).length,
    0,
  );
  assert.equal(
    groundRecentPriceObservations([older], citations(older), asOf, 30)[0]
      .recency,
    "under_30_days",
  );
  const boundary = observation("2026-09-02");
  assert.equal(
    groundRecentPriceObservations(
      [boundary],
      citations(boundary),
      "2026-09-09T00:00:00Z",
      7,
    ).length,
    0,
  );
  const retrieved = observation("2026-09-08", {
    date_quote: "Retrieved 2026-09-08.",
  });
  assert.equal(
    groundRecentPriceObservations([retrieved], citations(retrieved), asOf, 7)
      .length,
    0,
  );
  const expired = observation("2026-09-08", {
    date_quote: "Published 2026-09-08. Valid until 2026-09-08.",
    valid_until_text: "2026-09-08",
  });
  assert.equal(
    groundRecentPriceObservations([expired], citations(expired), asOf, 7)
      .length,
    0,
  );
  assert.equal(
    parsePublicPriceDate("September 8, 2026"),
    "2026-09-08T00:00:00.000Z",
  );
});
const models = [
  "google/gemini-3.8-flash",
  "openai/gpt-5.2",
  "anthropic/claude-test",
  "deepseek/deepseek-test",
  "x-ai/grok-test",
];
const provider = {
  google: ["google-ai-studio", "Google AI Studio"],
  openai: ["openai", "OpenAI"],
  anthropic: ["anthropic", "Anthropic"],
  deepseek: ["deepseek", "DeepSeek"],
  "x-ai": ["xai", "xAI"],
};
function setup(t, row, failedModel = null) {
  const vars = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_ANTHROPIC: "anthropic",
    MATCHBASE_PROVIDER_DEEPSEEK: "deepseek",
    MATCHBASE_PROVIDER_XAI: "xai",
  };
  const prior = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    const parameters = ["structured_outputs", "reasoning", "max_tokens"];
    if (url.endsWith("/models/user"))
      return Response.json({
        data: models.map((id) => ({ id, supported_parameters: parameters })),
      });
    if (url.endsWith("/endpoints")) {
      const family = Object.keys(provider).find((f) => url.includes(`/${f}/`));
      return Response.json({
        data: {
          endpoints: [
            { tag: provider[family][0], supported_parameters: parameters },
          ],
        },
      });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    requests.push(body);
    const schema = body.response_format?.json_schema?.name;
    const payload =
      schema === "recent_price_observations"
        ? { observations: row ? [row] : [] }
        : schema === "matchbase_live_synthesis"
          ? {
              summary:
                "No supplier identity was evidenced; price research is retained separately.",
              ranked_candidates: [],
            }
          : schema === "matchbase_native_candidate_index"
            ? {
                candidates: [],
                remaining_gaps: [],
                evidence_exhausted: true,
                summary: "No grounded supplier",
              }
            : "Public price evidence and no supplier identity.";
    return Response.json({
      id: `price-test-${requests.length}`,
      model: body.model,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [
            {
              selected: true,
              model: body.model,
              provider: provider[body.model.split("/")[0]][1],
            },
          ],
        },
      },
      choices: [
        {
          finish_reason:
            body.plugins && body.model === failedModel ? "length" : "stop",
          message: {
            content:
              typeof payload === "string" ? payload : JSON.stringify(payload),
            annotations: body.plugins
              ? [
                  {
                    type: "url_citation",
                    url_citation: citations(row ?? observation())[0],
                  },
                ]
              : [],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        cost: 0.01,
        cost_details: { upstream_inference_cost: 0.02 },
      },
    });
  });
  return requests;
}
function plan(count = 2) {
  return {
    version: "research-round.v1",
    round_number: 1,
    research_models: models.slice(0, count),
    synthesis_model: models[1],
    extraction_model: models[1],
    candidate_limit_per_search: Math.ceil(20 / count),
    search_engine: "native",
    search_engines: Object.fromEntries(
      models.map((m) => [m, m.startsWith("deepseek/") ? "exa" : "native"]),
    ),
    price_research: {
      model: models[1],
      search_engine: "native",
      max_calls: 4,
      preferred_window_days: 7,
      window_days: 30,
    },
  };
}
for (const age of [2, 12])
  test(`L02 dedicated price search ${age === 2 ? "stops after preferred seven-day evidence" : "broadens to thirty days only after no valid seven-day price"}`, async (t) => {
    const date = new Date(Date.now() - age * 86400000)
      .toISOString()
      .slice(0, 10);
    const row = observation(date);
    const requests = setup(t, row);
    const events = [];
    const result = await executeRecentPriceResearch(
      { product: "Grade A rice" },
      plan(),
      { before_call: async () => {}, on_checkpoint: (e) => events.push(e) },
      async () => citations(row),
    );
    assert.equal(requests.length, age === 2 ? 2 : 4);
    assert.deepEqual(
      result.search.searched_windows_days,
      age === 2 ? [7] : [7, 30],
    );
    assert.equal(result.search.observations.length, 1);
    assert.equal(result.search.status, "prices_found");
    assert.equal(
      events.filter((e) => e.state === "completed").length,
      requests.length,
    );
  });
test("L02 exhausted price allowance is explicit incomplete research without invented prices", async (t) => {
  const row = observation();
  const requests = setup(t, row);
  const selected = plan();
  selected.price_research.max_calls = 1;
  const result = await executeRecentPriceResearch(
    {},
    selected,
    { before_call: async () => {} },
    async () => citations(row),
  );
  assert.equal(requests.length, 1);
  assert.equal(result.search.status, "incomplete");
  assert.equal(result.search.observations.length, 0);
  assert.match(result.search.limitations.join(" "), /allowance/);
});
for (const count of [2, 3, 5])
  test(`L02 approved ${count} model lanes dispatch exact engines and retain price output without admitted suppliers`, async (t) => {
    const row = observation(
      new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    );
    const requests = setup(t, row);
    const result = await executeDualLaneResearch(
      {
        product_requirement: "Grade A rice",
        technical_compliance: "Grade A",
        order_profile: "FOB India",
        deep_prompt: "Find supported suppliers and recent prices",
        mandatory_requirements: ["Grade A rice"],
      },
      {
        mode: "live",
        round_plan: plan(count),
        before_call: async () => {},
        source_retriever: async () => null,
      },
    );
    const discovery = requests.filter(
      (r) =>
        r.plugins &&
        r.messages[0].content.includes("SERVER-ASSIGNED RESEARCH ROUND"),
    );
    assert.deepEqual(
      discovery.map((r) => r.model),
      models.slice(0, count),
    );
    for (const call of discovery)
      assert.equal(
        call.plugins[0].engine,
        call.model.startsWith("deepseek/") ? "exa" : "native",
      );
    assert.equal(result.candidates.length, 0);
    assert.equal(result.price_research.observations.length, 1);
    assert.equal(requests.filter((r) => r.plugins).length, count + 1);
    assert.ok(result.total_cost_usd > 0);
    assert.equal(result.usage_complete, true);
    const output = synthesizeConsultantOutputV3({
      user_profile_id: "profile",
      research_run_id: "run",
      execution_id: "exec",
      classification_id: "class",
      product_name: "Grade A rice",
      product_category: "Rice",
      approved_translation: "Source Grade A rice FOB India.",
      dual_lane_result: result,
    });
    assert.deepEqual(
      parseConsultantResearchOutputV3(output).price_research,
      result.price_research,
    );
    output.price_research.observations[0].age_days = 99;
    assert.throws(() => parseConsultantResearchOutputV3(output), /freshness/);
  });

test("L02 a five-path approved round retains four completed paths and all attempted usage after one exhausted model", async (t) => {
  const row = observation(
    new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
  );
  const requests = setup(t, row, models[2]);
  const result = await executeDualLaneResearch(
    {
      product_requirement: "Grade A rice",
      technical_compliance: "Grade A",
      order_profile: "FOB India",
      deep_prompt: "Find rice",
      mandatory_requirements: ["Grade A rice"],
    },
    {
      mode: "live",
      round_plan: plan(5),
      before_call: async () => {},
      source_retriever: async () => null,
    },
  );
  assert.match(
    result.coverage_gaps.join(" "),
    /4 of 5 approved discovery paths/,
  );
  assert.ok(result.executed_models.includes(models[2]));
  assert.equal(
    result.checkpoints.filter(
      (e) => e.phase === "discovery_anthropic" && e.state === "failed",
    ).length,
    1,
  );
  assert.ok(Math.abs(result.total_cost_usd - requests.length * 0.03) < 1e-9);
  assert.equal(result.price_research.observations.length, 1);
});

test("L02 malformed optional pricing cannot invalidate otherwise publishable supplier output", async (t) => {
  const row = observation(
    new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    { relevance_note: " " },
  );
  const requests = setup(t, row);
  const result = await executeRecentPriceResearch(
    {},
    plan(),
    { before_call: async () => {} },
    async () => citations(row),
  );
  assert.equal(requests.length, 4);
  assert.equal(result.search.status, "no_recent_prices");
  assert.equal(result.search.observations.length, 0);
  const golden = await import("../../../packages/contracts/dist/src/index.js");
  const output = structuredClone(golden.GOLDEN_SCENARIO_V3_01);
  output.price_research = result.search;
  assert.equal(
    parseConsultantResearchOutputV3(output).supplier_candidates.length,
    20,
  );
});

test("L02 price extraction receives literal amount and date passages beyond long navigation within its existing budget", async (t) => {
  const row = observation(
    new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
  );
  const text =
    "Navigation menu and account links. ".repeat(500) +
    row.quote +
    " Shipping guidance and unrelated content. ".repeat(300) +
    row.date_quote +
    " Footer links. ".repeat(50);
  const actual = [{ url: source, title: "Public rice prices", content: text }];
  const excerpt = selectPriceSourceExcerpt(
    text,
    "Grade A rice FOB India",
    3000,
  );
  assert.ok(excerpt.includes(row.quote));
  assert.ok(excerpt.includes(row.date_quote));
  assert.ok(excerpt.length <= 3000);
  for (const part of excerpt.split("\n\n[Separate literal source excerpt]\n\n"))
    assert.ok(text.includes(part));
  const fake = { ...row, quote: row.quote + " " + row.date_quote };
  assert.equal(
    groundRecentPriceObservations([fake], actual, new Date().toISOString(), 7)
      .length,
    0,
  );
  const requests = setup(t, row);
  const result = await executeRecentPriceResearch(
    { product_requirement: "Grade A rice", order_profile: "FOB India" },
    plan(),
    { before_call: async () => {} },
    async () => actual,
  );
  const extraction = requests.find(
    (request) =>
      request.response_format?.json_schema?.name ===
      "recent_price_observations",
  );
  const supplied = JSON.parse(extraction.messages[1].content).sources[0]
    .content;
  assert.ok(supplied.includes(row.quote));
  assert.ok(supplied.includes(row.date_quote));
  assert.ok(supplied.length <= 30000);
  assert.equal(result.search.observations.length, 1);
});

test("L02 overlapping price/date windows retain both complete literal observations", () => {
  const row = observation();
  const text =
    "navigation ".repeat(1200) +
    row.quote +
    " unrelated ".repeat(65) +
    row.date_quote +
    " footer ".repeat(300);
  const excerpt = selectPriceSourceExcerpt(text, "Grade A rice", 3000);
  assert.ok(excerpt.includes(row.quote));
  assert.ok(excerpt.includes(row.date_quote));
  assert.ok(excerpt.length <= 3000);
});
