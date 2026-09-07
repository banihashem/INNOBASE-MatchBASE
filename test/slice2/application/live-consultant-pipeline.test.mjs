import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { executeDualLaneResearch as executeResearch } from "../../../packages/application/dist/dual-lane-orchestrator.js";
import {
  callOpenRouterCompletion,
  runLiveCompletion,
  safePublicEvidenceUrl,
} from "../../../packages/application/dist/openrouter-model-policy.js";
import { LivePreparationModelGateway } from "../../../packages/application/dist/live-preparation.js";
import {
  parseLiveJson,
  objectSchema,
} from "../../../packages/application/dist/live-json-schema.js";

const originalFetch = globalThis.fetch;
const executeDualLaneResearch = (input, options = {}) =>
  executeResearch(input, { source_retriever: async () => null, ...options });
const originalKey = process.env.MATCHBASE_OPENROUTER_API_KEY;
const originalFallback = process.env.OPENROUTER_API_KEY;
const modelVariables = [
  "MATCHBASE_MODEL_GEMINI",
  "MATCHBASE_MODEL_OPENAI",
  "MATCHBASE_MODEL_PREPARATION",
  "MATCHBASE_MODEL_SYNTHESIS",
  "MATCHBASE_PROVIDER_GOOGLE",
  "MATCHBASE_PROVIDER_OPENAI",
];
const originalModels = Object.fromEntries(
  modelVariables.map((name) => [name, process.env[name]]),
);
let requests = [];
let dispatch;
const url = "https://verified-manufacturer.com/products";
const quote = "Acme Industrial manufactures stainless steel process pumps.";
const citation = {
  type: "url_citation",
  url_citation: { url, title: "Official product catalog", content: quote },
};
const proof = { status: "verified", source_urls: [url], quote };
const candidate = {
  legal_name: "Acme Industrial",
  country: "Germany",
  headquarters: "Unknown",
  website: "https://verified-manufacturer.com",
  supplier_type: "manufacturer",
  manufacturer_status: "direct_manufacturer",
  identity: proof,
  product_name: "Stainless steel process pumps",
  product_family: "Process pumps",
  product_origin: "Unknown",
  product: proof,
  facts: [],
  certifications: [],
  constraints: [
    {
      constraint: "Stainless steel process pump",
      dimension: "product",
      ...proof,
    },
    {
      constraint: "Commercial quote required",
      dimension: "price",
      status: "unknown",
      source_urls: [],
      quote: "",
    },
  ],
  unknowns: ["Current quotation"],
  risks: [],
};
function discovery(overrides = {}) {
  return {
    candidates: [structuredClone(candidate)],
    evidence: [
      {
        url,
        title: "Official product catalog",
        publisher: "Acme Industrial",
        source_type: "official_website",
        excerpt: quote,
      },
    ],
    remaining_gaps: ["Current quote"],
    evidence_exhausted: true,
    summary: "One primary-evidenced company; commercial quote remains unknown.",
    ...overrides,
  };
}
function respond(payload, annotations = [citation], extra = {}) {
  return new Response(
    JSON.stringify({
      id: "generation-test",
      model: requests.at(-1)?.model ?? "openai/gpt-5.2",
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [
            {
              selected: true,
              model: requests.at(-1)?.model ?? "openai/gpt-5.2",
              provider: requests.at(-1)?.model.startsWith("google/")
                ? "Google AI Studio"
                : "OpenAI",
            },
          ],
        },
      },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              typeof payload === "string" ? payload : JSON.stringify(payload),
            annotations,
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        cost: 0.01,
        cost_details: { upstream_inference_cost: 0.02 },
      },
      ...extra,
    }),
    { status: 200 },
  );
}
const intake = {
  product_requirement: "Stainless steel process pump",
  technical_compliance: "Commercial quote required",
  order_profile: "Germany",
  deep_prompt: "Find manufacturers",
  mandatory_requirements: [
    "Stainless steel process pump",
    "Commercial quote required",
  ],
  target_supplier_count: 1,
};
beforeEach(() => {
  requests = [];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  delete process.env.OPENROUTER_API_KEY;
  for (const name of modelVariables) delete process.env[name];
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  dispatch = () => respond(discovery());
  globalThis.fetch = async (target, options) => {
    if (String(target).endsWith("/endpoints"))
      return new Response(
        JSON.stringify({
          data: {
            endpoints: [
              {
                tag: String(target).includes("/google/")
                  ? "google-ai-studio"
                  : "openai",
                supported_parameters: [
                  "structured_outputs",
                  "reasoning",
                  "max_tokens",
                ],
              },
            ],
          },
        }),
      );
    if (String(target).includes("/generation?"))
      return new Response(
        JSON.stringify({
          data: {
            id: "generation-test",
            model: requests.at(-1)?.model ?? "openai/gpt-5.2",
            provider_name: "OpenAI",
            is_byok: true,
            upstream_inference_cost: 0.02,
          },
        }),
      );
    if (String(target).endsWith("/models/user"))
      return new Response(
        JSON.stringify({
          data: ["google/gemini-3.8-flash", "openai/gpt-5.2"].map((id) => ({
            id,
            supported_parameters: [
              "structured_outputs",
              "reasoning",
              ...(id.startsWith("openai/")
                ? ["max_completion_tokens"]
                : ["max_tokens"]),
            ],
          })),
        }),
      );
    assert.equal(
      String(target),
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const body = JSON.parse(options.body);
    requests.push(body);
    if (
      body.response_format?.json_schema?.name === "matchbase_live_synthesis"
    ) {
      const input = JSON.parse(body.messages[1].content);
      return respond(
        {
          summary: "Evidence-constrained comparative synthesis.",
          ranked_candidates: input.candidates.map((candidate) => ({
            candidate_id: candidate.candidate_id,
            comparison_reasoning:
              "Primary evidence supports conditional product fit.",
            remaining_validation: ["Confirm commercial quote"],
            recommended_next_action: "Request current quotation.",
            contradiction_claim_ids: [],
          })),
        },
        [],
      );
    }
    return dispatch(body);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries({
    MATCHBASE_OPENROUTER_API_KEY: originalKey,
    OPENROUTER_API_KEY: originalFallback,
    ...originalModels,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("live fails without a server credential and never returns fixtures", async () => {
  delete process.env.MATCHBASE_OPENROUTER_API_KEY;
  await assert.rejects(
    executeDualLaneResearch(intake, { mode: "live" }),
    /MB-503-LIVE-CREDENTIAL/,
  );
  assert.equal(requests.length, 0);
});
test("live requires five actual verification calls after both native web discovery lanes", async () => {
  const events = [];
  const result = await executeDualLaneResearch(intake, {
    mode: "live",
    on_checkpoint: async (event) => events.push(event),
  });
  assert.equal(requests.length, 8);
  assert.equal(result.verification_loops_completed, 5);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].entity_basis, "live_verified");
  assert.equal(result.candidates[0].commercial.price_min, undefined);
  assert.equal(
    result.candidates[0].assessment.mandatory_constraint_results[1].satisfied,
    false,
  );
  assert.equal(result.candidates[0].assessment.fit_band, "Potential Fit");
  assert.ok(result.claims.length > 0);
  assert.ok(result.evidence_sources[0].supports_claim_ids.length > 0);
  assert.equal(
    events.filter(
      (event) => event.phase === "verification" && event.state === "completed",
    ).length,
    5,
  );
  assert.ok(
    requests.slice(0, 7).every((body) => body.plugins[0].engine === "native"),
  );
  assert.equal(requests[7].plugins, undefined);
  assert.equal(result.synthesis_result.model, "openai/gpt-5.2");
  assert.ok(requests.every((body) => body.reasoning.effort === "high"));
  assert.ok(requests.every((body) => body.temperature === undefined));
  assert.ok(
    requests
      .filter((body) => body.model.startsWith("openai/"))
      .every(
        (body) => body.max_tokens && body.max_completion_tokens === undefined,
      ),
  );
  assert.equal(result.total_input_tokens, 80);
  assert.equal(result.usage_complete, true);
});
test("provider prose or unannotated links cannot become live verified suppliers", async () => {
  dispatch = () => respond(discovery(), []);
  await assert.rejects(
    executeDualLaneResearch(intake, { mode: "live" }),
    /MB-422-LIVE-EVIDENCE/,
  );
  assert.equal(requests.length, 2);
});
test("mismatched quotations exclude companies instead of laundering source URLs", async () => {
  const invalid = structuredClone(candidate);
  invalid.identity.quote = "A claim absent from the source";
  dispatch = () => respond(discovery({ candidates: [invalid] }));
  const result = await executeDualLaneResearch(intake, { mode: "live" });
  assert.equal(result.candidates.length, 0);
  assert.match(result.excluded_candidates[0].reason, /Corporate identity/);
  assert.equal(result.verification_loops_completed, 5);
  assert.equal(result.stop_reason, "evidence_exhausted");
});
test("adaptive verification stops at fifteen actual loops and never pads a shortlist", async () => {
  dispatch = () => respond(discovery({ evidence_exhausted: false }));
  const result = await executeDualLaneResearch(
    { ...intake, target_supplier_count: 20 },
    { mode: "live" },
  );
  assert.equal(result.verification_loops_completed, 15);
  assert.equal(requests.length, 18);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.stop_reason, "loop_limit");
});
test("transport errors redact provider bodies and preserve a failed checkpoint", async () => {
  const events = [];
  dispatch = () =>
    new Response("Sensitive echoed provider content", { status: 429 });
  await assert.rejects(
    runLiveCompletion(
      {
        model: "openai/gpt-5.2",
        messages: [{ role: "user", content: "Test" }],
      },
      { phase: "test", loop: 1 },
      { on_checkpoint: (event) => events.push(event) },
    ),
    /HTTP 429/,
  );
  assert.equal(events.at(-1).state, "failed");
  assert.ok(!JSON.stringify(events).includes("Sensitive echoed"));
});
test("known OpenAI hosted-web permission denial has a safe nonretryable diagnosis", async () => {
  const rawMessage =
    "Tool 'web_search_preview' disabled for this organization. You can enable it here: https://platform.openai.com/settings/organization/data-controls/hosted-tools . private-organization-and-secret-sentinel";
  dispatch = () =>
    new Response(
      JSON.stringify({
        error: {
          metadata: { raw: JSON.stringify({ error: { message: rawMessage } }) },
        },
      }),
      { status: 400 },
    );
  const events = [];
  await assert.rejects(
    runLiveCompletion(
      {
        model: "openai/gpt-5.2",
        messages: [{ role: "user", content: "Research the request." }],
      },
      { phase: "advisory", loop: 1, require_web: true },
      { on_checkpoint: (event) => events.push(event) },
    ),
    (error) => {
      assert.match(error.message, /MB-403-LIVE-WEB-PERMISSION/);
      assert.match(error.message, /OpenAI organization permissions disable/);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(events.at(-1).state, "failed");
  assert.doesNotMatch(
    JSON.stringify(events),
    /private-organization-and-secret-sentinel/,
  );
});

test("related generic provider errors are not mislabeled as organization hosted-web permission failures", async () => {
  for (const [model, body] of [
    [
      "openai/gpt-5.2",
      "Tool web_search_preview unsupported; consult hosted-tools.",
    ],
    [
      "openai/gpt-5.2",
      "Tool web_search_preview disabled for this project; consult hosted-tools.",
    ],
    [
      "openai/gpt-5.2",
      "Tool web_search_preview disabled for this organization.",
    ],
    [
      "google/gemini-3.8-flash",
      "Tool web_search_preview disabled for this organization; consult hosted-tools.",
    ],
  ]) {
    dispatch = () => new Response(body, { status: 400 });
    await assert.rejects(
      callOpenRouterCompletion({
        model,
        messages: [{ role: "user", content: "Research the request." }],
      }),
      (error) => {
        assert.equal(error.code, "MB-502-LIVE-PROVIDER");
        assert.doesNotMatch(error.message, /MB-403-LIVE-WEB-PERMISSION/);
        return true;
      },
    );
  }
  assert.equal(requests.length, 4);
});

test("missing provider token and cost usage is explicit rather than estimated", async () => {
  dispatch = () => respond("{}", [], { usage: {} });
  const result = await callOpenRouterCompletion({
    model: "openai/gpt-5.2",
    messages: [{ role: "user", content: "Test" }],
  });
  assert.equal(result.usage_reported, false);
  assert.equal(result.cost_reported, false);
  assert.equal(result.input_tokens, 0);
  assert.equal(result.cost_usd, 0);
});
test("structured output decoder rejects missing required fields and invalid numeric values", () => {
  assert.throws(
    () =>
      parseLiveJson(
        '{"count":2}',
        objectSchema({
          count: { type: "integer", maximum: 1 },
          title: { type: "string" },
        }),
      ),
    /MB-422-LIVE-SCHEMA/,
  );
  assert.throws(
    () => parseLiveJson("not JSON", objectSchema({})),
    /MB-422-LIVE-SCHEMA/,
  );
  assert.equal(safePublicEvidenceUrl("http://127.0.0.1/internal"), null);
  assert.equal(
    safePublicEvidenceUrl("https://user:password@provider.com"),
    null,
  );
  assert.deepEqual(
    parseLiveJson(
      '```json\n{"title":"A quoted } brace"}\n```\n[1] Native citation',
      objectSchema({ title: { type: "string" } }),
    ),
    { title: "A quoted } brace" },
  );
});
test("advisory executes exactly three native web loops and prompt generation never searches", async () => {
  dispatch = (body) =>
    body.response_format?.json_schema?.name === "matchbase_research_prompt"
      ? respond(
          {
            prompt_text: "Inspect supplier primary evidence.",
            discovery_criteria: ["Stainless steel process pump"],
            evidence_thresholds: ["Official identity and product citation"],
            target_supplier_count: 20,
          },
          [],
        )
      : respond(
          "Evidence-backed product application advisory. Current quote remains unknown; confirm before procurement.\n\nA controller label named canonical_snapshot is not a certification. Confirm 24 V DC and 3-5 bar before procurement. Supported voltage options [24, 48] V require verification.",
        );
  const gateway = new LivePreparationModelGateway();
  const approved = {
    revision_id: randomUUID(),
    english_translation: "Exact buyer-approved request.",
    product_category: "Pumps",
    product_name: "Process pumps",
    key_specifications: ["Stainless steel"],
    approved_at: new Date().toISOString(),
    canonical_snapshot: {
      fact_ids: ["internal-fact-id"],
      revision_id: randomUUID(),
    },
  };
  const classification = {
    classification_id: randomUUID(),
    scheme: "CUSTOM_MATCHBASE",
    code: "UNCLASSIFIED",
    version: "1",
    level: "category",
    label: "Pumps",
    description: "Provisional",
    is_primary: true,
    confidence: "low",
    assigned_at: new Date().toISOString(),
  };
  const advisory = await gateway.generateAdvisoryLoops(
    approved,
    classification,
  );
  assert.match(advisory.loop1_trade_lane, /product application advisory/);
  assert.deepEqual(advisory.sourcing_risks, []);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((body) => body.plugins[0].engine === "native"));
  assert.match(advisory.loop2_regulatory, /\n\nA controller label/);
  assert.deepEqual(
    advisory.sources.map((source) => source.url),
    [url],
  );
  for (const request of requests) {
    const context = JSON.parse(request.messages[1].content);
    assert.equal(context.approved_request_text, approved.english_translation);
    assert.ok(!request.messages[1].content.includes("internal-fact-id"));
    assert.equal(context.canonical_snapshot, undefined);
    assert.equal(context.approved_request, undefined);
    assert.equal(context.prior_advisory, undefined);
  }
  assert.equal(
    JSON.parse(requests[1].messages[1].content).earlier_briefings[0],
    advisory.loop1_trade_lane,
  );
  const generated = await gateway.generateDeepResearchPrompt(
    approved,
    advisory,
    classification,
  );
  assert.equal(requests.length, 4);
  assert.equal(requests[3].plugins, undefined);
  assert.ok(generated.prompt_text.includes(approved.english_translation));
});
test("advisory rejects request-envelope echoes before publication while retaining raw provider audit", async () => {
  const approved = {
    revision_id: randomUUID(),
    english_translation: "A stainless steel process pump, 24 V DC, 3-5 bar.",
    product_category: "Pumps",
    product_name: "Process pump",
    key_specifications: ["24 V DC", "3-5 bar"],
    approved_at: new Date().toISOString(),
    canonical_snapshot: { fact_ids: ["original-fact-id"] },
  };
  const before = structuredClone(approved);
  const classification = {
    scheme: "CUSTOM_MATCHBASE",
    code: "UNCLASSIFIED",
    label: "Pumps",
    confidence: "low",
  };
  for (const raw of [
    'Approved request (verbatim; unchanged)\n```json\n{"canonical_snapshot":{"fact_ids":["original-fact-id"]},"prior_advisory":["Earlier full text"]}\n```\nCheck the official approval registry.',
    'Approved request: {"canonical_snapshot":{"fact_ids":["original-fact-id"]}}\nCheck the official approval registry.',
    '{"approved_request_text":"A stainless steel process pump, 24 V DC, 3-5 bar.","earlier_briefings":["Earlier full text"]}\nCheck the official approval registry.',
    'Current findings:\n```json\n{"analysis":"Check the official approval registry."}\n```',
    '{"analysis":"Check the official approval registry."}',
    '[{"analysis":"Check the official approval registry."}]',
  ]) {
    requests = [];
    const events = [];
    dispatch = () =>
      respond(requests.length === 1 ? "Confirm current product scope." : raw);
    const gateway = new LivePreparationModelGateway({
      on_checkpoint: (event) => events.push(event),
    });
    await assert.rejects(
      gateway.generateAdvisoryLoops(approved, classification),
      (error) => {
        assert.equal(error.code, "MB-422-LIVE-ADVISORY-FORMAT");
        assert.equal(error.retryable, false);
        assert.ok(!error.message.includes("original-fact-id"));
        return true;
      },
    );
    assert.equal(requests.length, 2);
    const rawAudit = events.find(
      (event) => event.loop === 2 && event.state === "completed",
    );
    assert.equal(rawAudit.response_content, raw);
    assert.equal(rawAudit.response_truncated, false);
    assert.deepEqual(rawAudit.evidence_urls, [url]);
    assert.deepEqual(approved, before);
  }
});
test("demonstration mode reports zero actual verification loops and no provider usage", async () => {
  const result = await executeDualLaneResearch(intake, {
    mode: "demonstration",
  });
  assert.equal(requests.length, 0);
  assert.equal(result.verification_loops_completed, 0);
  assert.equal(result.total_input_tokens, 0);
  assert.equal(result.lane_g_result.live_api_invoked, false);
});
test("public supplier price and supplier-claimed certification retain source provenance", async () => {
  const text = `${quote} Public list price: 1250 EUR per unit. Sales email: sales@verified-manufacturer.com. Supplier declaration: CE pressure equipment conformity.`;
  const enriched = structuredClone(candidate);
  enriched.facts = [
    {
      field_path: "commercial.price_min",
      value: "1250",
      claim_type: "pricing",
      source_urls: [url],
      quote: "Public list price: 1250 EUR per unit.",
    },
    {
      field_path: "commercial.currency",
      value: "EUR",
      claim_type: "pricing",
      source_urls: [url],
      quote: "Public list price: 1250 EUR per unit.",
    },
    {
      field_path: "commercial.unit",
      value: "unit",
      claim_type: "pricing",
      source_urls: [url],
      quote: "Public list price: 1250 EUR per unit.",
    },
    {
      field_path: "contacts.sales_email",
      value: "sales@verified-manufacturer.com",
      claim_type: "identity",
      source_urls: [url],
      quote: "Sales email: sales@verified-manufacturer.com.",
    },
    {
      field_path: "contacts.phone",
      value: "+123456789",
      claim_type: "identity",
      source_urls: [url],
      quote: "Sales email: sales@verified-manufacturer.com.",
    },
  ];
  enriched.certifications = [
    {
      name: "CE",
      issuer: null,
      certificate_number: null,
      scope: "Pressure equipment conformity",
      status: "unknown",
      valid_from: null,
      valid_until: null,
      source_urls: [url],
      quote: "Supplier declaration: CE pressure equipment conformity.",
    },
  ];
  dispatch = () =>
    respond(
      discovery({
        candidates: [enriched],
        evidence: [
          {
            url,
            title: "Official company catalog",
            publisher: "Acme Industrial",
            source_type: "official_website",
            excerpt: text,
          },
        ],
      }),
      [
        {
          type: "url_citation",
          url_citation: {
            url,
            title: "Official company catalog",
            content: text,
          },
        },
      ],
    );
  const result = await executeDualLaneResearch(intake, { mode: "live" });
  const supplier = result.candidates[0];
  assert.equal(supplier.commercial.price_min, 1250);
  assert.equal(supplier.commercial.currency, "EUR");
  assert.match(supplier.commercial.price_type, /Public supplier indication/);
  assert.equal(
    supplier.contacts.sales_email,
    "sales@verified-manufacturer.com",
  );
  assert.equal(supplier.contacts.phone, undefined);
  assert.equal(supplier.certifications[0].verification_status, "claimed");
  assert.ok(
    result.claims.some(
      (claim) =>
        claim.claim_type === "compliance" &&
        claim.status === "supplier_claimed",
    ),
  );
});
test("Step1 uses a real structured translation call and rejects invented source references", async () => {
  const original = {
    product_requirement: "Industrial pump",
    technical_compliance: "Stainless steel",
    order_profile: "Germany",
  };
  const payload = {
    original_language: "en",
    english_translation: "Industrial pump. Stainless steel. Germany.",
    product_category: "Process equipment",
    product_name: "Industrial pump",
    explicit_requirements: Object.entries(original).map(
      ([source_box, value]) => ({
        source_box,
        source_text_reference: value,
        normalized_value: value,
        requirement_level: "mandatory",
        comparison_operator: "requires",
        concept: source_box,
        value: null,
        unit: null,
        jurisdiction: null,
        lower_bound: null,
        upper_bound: null,
        duration: null,
        supplier_role: null,
        evidence_qualifier: null,
      }),
    ),
    ambiguities: [],
    unknowns: [],
    suggested_clarifications: [],
    classification: {
      scheme: "CUSTOM_MATCHBASE",
      code: "UNCLASSIFIED",
      version: "1",
      jurisdiction: "Unknown",
      level: "category",
      label: "Industrial pumps",
      description: "Provisional category",
    },
  };
  dispatch = () => respond(payload, []);
  const gateway = new LivePreparationModelGateway();
  const interpretation = await gateway.extractAndInterpret(original);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].plugins, undefined);
  assert.equal(interpretation.ledger.requirements.length, 3);
  assert.equal(interpretation.classification.confidence, "low");
  payload.explicit_requirements[0].source_text_reference =
    "This phrase never appeared";
  await assert.rejects(
    gateway.extractAndInterpret(original),
    /MB-422-LIVE-LINEAGE/,
  );
});
test("model-written excerpt and proof cannot self-verify without retrieved source content", async () => {
  const annotationWithoutContent = {
    type: "url_citation",
    url_citation: { url, title: "Official catalog" },
  };
  dispatch = () => respond(discovery(), [annotationWithoutContent]);
  const result = await executeDualLaneResearch(intake, { mode: "live" });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.evidence_sources.length, 0);
  assert.match(
    result.excluded_candidates[0].reason,
    /primary native-search evidence/,
  );
});
test("bounded primary retrieval is cached per execution and content hashes reach checkpoints", async () => {
  const annotationWithoutContent = {
    type: "url_citation",
    url_citation: { url, title: "Official catalog" },
  };
  dispatch = () => respond(discovery(), [annotationWithoutContent]);
  let retrievals = 0;
  const hash = createHash("sha256").update(quote).digest("hex");
  const result = await executeDualLaneResearch(intake, {
    mode: "live",
    source_retriever: async (sourceUrl) => {
      retrievals++;
      return {
        url: sourceUrl,
        text: quote,
        content_sha256: hash,
        retrieved_at: new Date().toISOString(),
      };
    },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(retrievals, 1);
  assert.ok(
    result.checkpoints.some(
      (checkpoint) =>
        checkpoint.phase === "source_retrieval" &&
        checkpoint.content_sha256 === hash,
    ),
  );
});
