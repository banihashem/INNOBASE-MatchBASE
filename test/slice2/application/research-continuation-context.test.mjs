import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { executeDualLaneResearch } from "../../../packages/application/dist/dual-lane-orchestrator.js";
import { createRoundCallGuard } from "../../../packages/application/dist/consultant-research-cost.js";
import { researchLeadKey } from "../../../packages/application/dist/research-review.js";

for (const scenario of [
  "legacy",
  "native-length",
  "native-no-citations",
  "synthesis-json",
  "synthesis-exhausted",
  "mixed-native",
  "focused",
])
  test(`MB-UX-LIVE-001 L15 retained-source publication with ${scenario}`, async (t) => {
    const model = "openai/gpt-5.2";
    const env = {
      MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
      MATCHBASE_PROVIDER_OPENAI: "openai",
    };
    const previousEnv = Object.fromEntries(
      Object.keys(env).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, env);
    t.after(() => {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const name = "Aster Network Trading LLC";
    const contactUrl = "https://aster-network.example.com/contact";
    const productUrl = "https://aster-network.example.com/products/lmx24";
    const manufacturerUrl =
      "https://vertex-networking.example.com/datasheets/lmx24";
    const unsupportedUrl = "https://unrelated-seller.example.com/contacts";
    const identityQuote = `${name} is an IT equipment seller in Dubai, United Arab Emirates.`;
    const productQuote = `${name} sells the LMX24 unmanaged network switch.`;
    const email = "sales@aster-network.example.com";
    const contactQuote = `Sales email: ${email}.`;
    const contactText = `${identityQuote}\n${contactQuote}`;
    const manufacturerText =
      "Vertex Networking manufactures the LMX24 unmanaged 24-port Gigabit network switch.";
    const fetched = (url, text) => ({
      url,
      text,
      content_sha256: createHash("sha256").update(text).digest("hex"),
      retrieved_at: "2026-09-09T00:00:00Z",
    });
    const unknownProof = { status: "unknown", source_urls: [], quote: "" };
    const criterion = "Supplier offers an unmanaged network switch.";
    const legacyCandidate = {
      legal_name: name,
      country: "Unknown",
      headquarters: "Unknown",
      website: "https://aster-network.example.com",
      supplier_type: "trading_company",
      manufacturer_status: "trader_distributor",
      identity: unknownProof,
      product_name: "LMX24 unmanaged network switch",
      product_family: "Network switches",
      product_origin: "Unknown",
      product: unknownProof,
      facts: [],
      certifications: [],
      constraints: [
        { constraint: criterion, dimension: "product", ...unknownProof },
      ],
      unknowns: ["", "Current quotation"],
      risks: [""],
    };
    // This is the historical failure shape: retrieval succeeded but no extraction
    // evidence was accepted, and native_citations did not yet exist in the schema.
    const continuation = {
      ...(scenario === "focused"
        ? {
            indexed_leads: [
              {
                lead_id: researchLeadKey(name),
                name,
                anchor_quote: identityQuote,
                source_urls: [contactUrl],
                first_seen_round: 1,
                last_seen_round: 1,
              },
            ],
          }
        : {}),
      roster: [["aster-network.example.com", legacyCandidate]],
      evidence: [],
      retrieved: [
        [contactUrl, fetched(contactUrl, contactText)],
        [productUrl, fetched(productUrl, productQuote)],
      ],
      remaining_gaps: [
        "Seller identity and product evidence remain unconfirmed",
      ],
    };
    const originalContinuation = structuredClone(continuation);
    const plan = {
      mode: "live",
      version: "research-round.v1",
      round_number: 2,
      ...(scenario === "focused"
        ? {
            focus_analysis_required: true,
            follow_up: {
              question:
                "RAW_FOLLOW_UP_DO_NOT_FORWARD: verify this seller's current offer",
              lead_ids: [researchLeadKey(name)],
            },
          }
        : {}),
      depth: "deep",
      title: "Review saved seller sources",
      purpose:
        "Resolve seller identity and product evidence before commercial refinements",
      focus_requirements: ["Seller identity and product evidence"],
      research_models: [model],
      extraction_model: model,
      synthesis_model: model,
      search_engine: "exa",
      candidate_limit_per_search: 20,
      max_calls: scenario === "legacy" ? 4 : 12,
      ...(scenario === "legacy" ? {} : { automatic_recovery_attempts: 3 }),
      max_input_tokens_per_call: 240000,
      max_output_tokens_per_call: 20000,
      rates: [
        {
          model,
          provider: "openai",
          reasoning: true,
          input_usd_per_token: 0.00000175,
          output_usd_per_token: 0.000014,
          request_usd: 0,
          web_search_usd: 0.01,
        },
      ],
    };
    const requests = [];
    let nativeAttempts = 0,
      synthesisAttempts = 0;
    const retrievals = [];
    let indexSeen = false,
      batchSeen = false;
    const proof = (url, quote) => ({
      status: "verified",
      source_urls: [url],
      quote,
    });
    const finalCandidate = {
      ...legacyCandidate,
      identity: proof(contactUrl, identityQuote),
      product: proof(productUrl, productQuote),
      constraints: [
        {
          constraint: criterion,
          dimension: "product",
          ...proof(productUrl, productQuote),
        },
      ],
      facts: [
        {
          field_path: "contacts.sales_email",
          value: email,
          claim_type: "identity",
          source_urls: [contactUrl],
          quote: contactQuote,
        },
        {
          field_path: "contacts.export_email",
          value: "invented@unrelated-seller.example.com",
          claim_type: "identity",
          source_urls: [unsupportedUrl],
          quote: "invented@unrelated-seller.example.com",
        },
      ],
    };
    const payload = {
      candidates: [finalCandidate],
      evidence: [
        {
          url: contactUrl,
          title: "Company and contact",
          publisher: name,
          source_type: "official_website",
          excerpt: contactText,
        },
        {
          url: productUrl,
          title: "LMX24 product offering",
          publisher: name,
          source_type: "official_website",
          excerpt: productQuote,
        },
        {
          url: unsupportedUrl,
          title: "Uncited fabricated source",
          publisher: "Unknown",
          source_type: "official_website",
          excerpt: "invented@unrelated-seller.example.com",
        },
      ],
      remaining_gaps: ["Current quotation"],
      evidence_exhausted: true,
      summary:
        "One seller has retained primary identity and product evidence; quotation remains unknown.",
    };
    t.mock.method(globalThis, "fetch", async (target, options = {}) => {
      const url = String(target);
      if (url.endsWith("/models/user"))
        return Response.json({
          data: [
            {
              id: model,
              supported_parameters: [
                "structured_outputs",
                "reasoning",
                "max_tokens",
              ],
            },
          ],
        });
      if (url.endsWith("/endpoints"))
        return Response.json({
          data: {
            endpoints: [
              {
                tag: "openai",
                model_id: model,
                supported_parameters: [
                  "structured_outputs",
                  "reasoning",
                  "max_tokens",
                ],
              },
            ],
          },
        });
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(options.body);
      requests.push(body);
      const input = JSON.parse(body.messages[1].content);
      const schema = body.response_format?.json_schema?.name;
      let result,
        annotations = [];
      if (!schema) {
        if (scenario === "focused") {
          assert.equal(
            requests[0].response_format.json_schema.name,
            "research_focus_plan",
          );
          assert.ok(
            !JSON.stringify(body).includes("RAW_FOLLOW_UP_DO_NOT_FORWARD"),
          );
          assert.equal(
            input.focused_research_plan.objective,
            "Verify the saved seller and current offer",
          );
        }
        nativeAttempts++;
        if (scenario === "mixed-native" && nativeAttempts === 1)
          return new Response("temporary", { status: 503 });
        assert.equal(body.plugins[0].engine, "exa");
        assert.equal(input.current_roster[0].legal_name, name);
        result =
          "Only the manufacturer's LMX24 technical page was cited in this round. It contains no seller contact or sales entity evidence.";
        annotations = [
          {
            type: "url_citation",
            url_citation: {
              url: manufacturerUrl,
              title: "Manufacturer datasheet",
              content: manufacturerText,
            },
          },
        ];
      } else if (schema === "research_focus_plan") {
        assert.equal(
          body.plugins,
          undefined,
          "Planning must not perform a web search",
        );
        assert.ok(
          input.buyer_follow_up.question.includes(
            "RAW_FOLLOW_UP_DO_NOT_FORWARD",
          ),
        );
        assert.equal(input.prior_leads[0].name, name);
        assert.ok(input.prior_dossiers[0].findings_excerpt.includes(name));
        assert.equal(input.source_inventory.length, 2);
        result = {
          objective: "Verify the saved seller and current offer",
          question_summary: "Investigate seller evidence",
          priority_lead_ids: [researchLeadKey(name)],
          search_tasks: ["Inspect official identity and dated offers"],
          evidence_gaps: ["Current quotation"],
          scope_notes: ["Keep the approved product requirement"],
        };
      } else if (schema === "matchbase_native_candidate_index") {
        if (scenario === "focused")
          assert.deepEqual(input.priority_candidate_names, [name]);
        indexSeen = true;
        const citations = new Map(
          input.native_citations.map((citation) => [
            citation.url,
            citation.content_excerpt,
          ]),
        );
        assert.ok(
          citations.get(contactUrl)?.includes(identityQuote),
          "Index must see the actual previously fetched seller identity",
        );
        assert.ok(
          citations.get(contactUrl)?.includes(email),
          "Index must retain the seller contact source",
        );
        assert.ok(citations.get(productUrl)?.includes(productQuote));
        assert.ok(citations.has(manufacturerUrl));
        result = {
          candidates: [
            {
              legal_name: name,
              anchor_quote: identityQuote,
              source_urls: [contactUrl, productUrl],
            },
          ],
          remaining_gaps: ["Current quotation"],
          evidence_exhausted: true,
          summary: "Retained seller sources support an existing candidate.",
        };
      } else if (schema === "matchbase_native_evidence_extraction") {
        batchSeen = true;
        assert.deepEqual(input.assigned_candidate_names, [name]);
        assert.equal(
          input.native_research_notes,
          undefined,
          "Research commentary must not become proof authority in detailed extraction",
        );
        const citations = new Map(
          input.native_citations.map((citation) => [
            citation.url,
            citation.content_excerpt,
          ]),
        );
        assert.ok(citations.get(contactUrl)?.includes(identityQuote));
        assert.ok(citations.get(contactUrl)?.includes(contactQuote));
        assert.ok(citations.get(productUrl)?.includes(productQuote));
        assert.equal(citations.has(unsupportedUrl), false);
        result = payload;
      } else {
        assert.equal(schema, "matchbase_live_synthesis");
        assert.equal(
          input.candidates.length,
          1,
          "Legacy seller evidence must reach publication rather than another empty result",
        );
        assert.equal(input.candidates[0].contacts.sales_email, email);
        assert.equal(input.candidates[0].contacts.export_email, undefined);
        assert.ok(
          input.sources.every((source) => source.source_url !== unsupportedUrl),
        );
        synthesisAttempts++;
        result = {
          summary:
            "One conditional seller retained; current quotation remains unknown.",
          ranked_candidates: input.candidates.map((candidate) => ({
            candidate_id: candidate.candidate_id,
            comparison_reasoning:
              "Primary identity and exact offering are retained.",
            remaining_validation: ["Request a current quotation"],
            recommended_next_action: "Review the saved seller dossier.",
            contradiction_claim_ids: [],
          })),
        };
      }
      if (
        schema === "matchbase_live_synthesis" &&
        (scenario === "synthesis-exhausted" ||
          (scenario === "synthesis-json" && synthesisAttempts === 1))
      )
        result = { summary: "invalid response" };
      if (!schema && scenario === "native-no-citations" && nativeAttempts === 1)
        annotations = [];
      return Response.json({
        id: `continuation-fixture-${requests.length}`,
        model,
        openrouter_metadata: {
          is_byok: true,
          endpoints: {
            available: [{ selected: true, model, provider: "OpenAI" }],
          },
        },
        choices: [
          {
            finish_reason:
              !schema &&
              ((scenario === "native-length" && nativeAttempts === 1) ||
                (scenario === "mixed-native" && nativeAttempts === 2))
                ? "length"
                : "stop",
            message: {
              content:
                typeof result === "string" ? result : JSON.stringify(result),
              annotations,
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          cost: 0,
          cost_details: { upstream_inference_cost: 0.01 },
        },
      });
    });
    const result = await executeDualLaneResearch(
      {
        product_requirement: "LMX24 unmanaged network switch",
        technical_compliance: "Current quotation required",
        order_profile: "Seller serving Dubai",
        deep_prompt: "Review the approved saved sources.",
        mandatory_requirements: [criterion],
        target_supplier_count: 20,
      },
      {
        mode: "live",
        round_plan: plan,
        ...(scenario === "legacy" ? {} : { automatic_recovery_attempts: 3 }),
        continuation,
        web_engine: "exa",
        max_output_tokens: plan.max_output_tokens_per_call,
        before_call: createRoundCallGuard(plan),
        source_retriever: async (url) => {
          retrievals.push(url);
          assert.equal(
            url,
            manufacturerUrl,
            "Previously fetched seller sources must not be discarded and fetched again",
          );
          return fetched(url, manufacturerText);
        },
      },
    );
    assert.ok(indexSeen && batchSeen);
    assert.equal(
      requests.length,
      scenario === "legacy"
        ? 4
        : ["synthesis-exhausted", "mixed-native"].includes(scenario)
          ? 6
          : 5,
      "Only the failing stage repeats; successful search, index and extraction are retained",
    );
    assert.equal(
      requests.filter(
        (body) =>
          body.response_format?.json_schema?.name ===
          "matchbase_native_candidate_index",
      ).length,
      1,
    );
    assert.equal(
      requests.filter(
        (body) =>
          body.response_format?.json_schema?.name ===
          "matchbase_native_evidence_extraction",
      ).length,
      1,
    );
    if (scenario === "synthesis-exhausted") {
      assert.equal(synthesisAttempts, 3);
      assert.equal(result.synthesis_result.live_api_invoked, false);
      assert.ok(
        result.coverage_gaps.some((gap) =>
          gap.includes("AI comparison is incomplete"),
        ),
      );
    }
    if (scenario === "mixed-native") {
      assert.equal(nativeAttempts, 3);
      assert.equal(result.usage_complete, false);
    } else
      assert.ok(
        Math.abs(result.total_cost_usd - requests.length * 0.01) < 1e-9,
      );
    assert.deepEqual(retrievals, [manufacturerUrl]);
    assert.equal(result.stop_reason, "user_review");
    if (scenario === "focused") {
      assert.equal(
        result.continuation.focus_analysis.objective,
        "Verify the saved seller and current offer",
      );
      assert.equal(
        result.continuation.collected_responses.length,
        requests.length,
      );
      assert.equal(result.continuation.indexed_leads[0].first_seen_round, 1);
      assert.equal(result.continuation.indexed_leads[0].last_seen_round, 2);
    }
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].legal_name, name);
    assert.equal(result.candidates[0].contacts.sales_email, email);
    assert.equal(result.candidates[0].contacts.export_email, undefined);
    assert.ok(
      result.candidates[0].assessment.limiting_gaps.every((gap) => gap.trim()),
    );
    assert.ok(
      result.candidates[0].assessment.risk_flags.every((risk) => risk.trim()),
    );
    const urls = new Set(
      result.continuation.native_citations.map((citation) => citation.url),
    );
    assert.deepEqual(urls, new Set([contactUrl, productUrl, manufacturerUrl]));
    assert.ok(
      result.evidence_sources.every((source) =>
        [contactUrl, productUrl].includes(source.source_url),
      ),
    );
    assert.ok(
      result.claims.every((claim) => !claim.claim_text.includes("invented@")),
    );
    assert.deepEqual(
      continuation,
      originalContinuation,
      "Continuing research never mutates the saved prior round object",
    );
  });
