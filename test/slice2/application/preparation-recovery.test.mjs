import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { LivePreparationModelGateway } from "../../../packages/application/dist/live-preparation.js";
import { LiveResearchError } from "../../../packages/application/dist/openrouter-model-policy.js";

const models = ["google/gemini-3.8-flash", "openai/gpt-5.2"];
const source = "https://example.com/official-product-scope";
const approved = {
  revision_id: "approved-revision",
  english_translation:
    "Industrial potassium hydroxide. FOB / CIF / EXW are options without a final selection. ISO 9001 or an applicable standard is required.",
  product_category: "Industrial chemicals",
  product_name: "Potassium hydroxide",
  key_specifications: [],
  approved_at: "2026-09-11T00:00:00.000Z",
};
const classification = {
  scheme: "HS",
  code: "281520",
  label: "Potassium hydroxide",
  confidence: "low",
};

function fixture(t, dispatch) {
  const saved = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(MATCHBASE_|OPENROUTER_)/.test(key),
    ),
  );
  for (const key of Object.keys(saved)) delete process.env[key];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  const validation = [];
  globalThis.fetch = async (target, options) => {
    const address = String(target);
    if (address.endsWith("/models/user"))
      return Response.json({
        data: models.map((id) => ({
          id,
          supported_parameters: [
            "structured_outputs",
            "reasoning",
            "max_tokens",
          ],
        })),
      });
    if (address.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: address.includes("/google/") ? "google-ai-studio" : "openai",
              provider_name: address.includes("/google/")
                ? "Google AI Studio"
                : "OpenAI",
              supported_parameters: [
                "structured_outputs",
                "reasoning",
                "max_tokens",
              ],
            },
          ],
        },
      });
    assert.equal(
      address,
      "https://openrouter.ai/api/v1/chat/completions",
      "No unmocked network operation is permitted",
    );
    const body = JSON.parse(options.body);
    requests.push(body);
    return dispatch(body, requests.length);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env))
      if (/^(MATCHBASE_|OPENROUTER_)/.test(key)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  const gateway = (extra = {}) =>
    new LivePreparationModelGateway({
      preparation_recovery: true,
      automatic_recovery_attempts: 3,
      before_call: async () => {},
      on_checkpoint: (event) => events.push(event),
      on_preparation_checkpoint: (event) => validation.push(event),
      ...extra,
    });
  return { requests, events, validation, gateway };
}

function response(
  body,
  text = "Current official evidence describes product scope. Confirm the applicable certification and current quotation before procurement.",
  options = {},
) {
  return Response.json({
    id: randomUUID(),
    model: body.model,
    openrouter_metadata: {
      is_byok: options.byok ?? true,
      endpoints: {
        available: [
          {
            selected: true,
            model: body.model,
            provider: body.model.startsWith("google/")
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
          content: typeof text === "string" ? text : JSON.stringify(text),
          annotations:
            options.citations === false
              ? []
              : [
                  {
                    type: "url_citation",
                    url_citation: { url: source, title: "Official scope" },
                  },
                ],
        },
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 40,
      cost: 0.01,
      cost_details: { upstream_inference_cost: 0.02 },
    },
  });
}
function credentialFailure(options = {}) {
  return Response.json(
    {
      error: {
        message: "Provider rejected request",
        metadata: {
          provider_name: options.provider ?? "Google AI Studio",
          is_byok: options.byok ?? true,
          raw: JSON.stringify({
            error: {
              message: "API key not valid. Private credential sentinel.",
              status: "INVALID_ARGUMENT",
              details: [{ reason: "API_KEY_INVALID" }],
            },
          }),
        },
      },
    },
    { status: options.status ?? 400 },
  );
}

test("MB-UX-QUALITY-001 L04 a localized BYOK credential failure switches the same topic and retains all three topics", async (t) => {
  const f = fixture(t, (body) =>
    body.model.startsWith("google/") ? credentialFailure() : response(body),
  );
  const before = structuredClone(approved);
  const result = await f
    .gateway()
    .generateAdvisoryLoops(approved, classification);
  assert.equal(f.requests.length, 4);
  assert.deepEqual(
    f.requests.map((request) => request.model),
    [models[0], models[1], models[1], models[1]],
  );
  for (const body of f.requests) {
    assert.deepEqual(body.provider.only, [
      body.model.startsWith("google/") ? "google-ai-studio" : "openai",
    ]);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.equal(body.plugins[0].engine, "native");
    assert.equal(
      JSON.parse(body.messages[1].content).approved_request_text,
      approved.english_translation,
    );
  }
  const topics = f.requests.map(
    (body) => JSON.parse(body.messages[1].content).topic,
  );
  assert.equal(topics[0], topics[1]);
  assert.equal(new Set(topics).size, 3);
  assert.equal(
    JSON.parse(f.requests[2].messages[1].content).earlier_briefings[0],
    result.loop1_trade_lane,
  );
  const failed = f.events.find((event) => event.state === "failed");
  assert.equal(failed.recovery_scheduled, true);
  assert.equal(failed.recovery_attempt, 1);
  assert.equal(failed.max_recovery_attempts, 3);
  assert.equal(
    f.events
      .filter((event) => event.state === "completed")
      .reduce((sum, event) => sum + event.cost_usd, 0),
    0.03,
  );
  assert.equal(
    new Set(
      f.events
        .filter((event) => event.state === "completed")
        .map((event) => event.provider_generation_id),
    ).size,
    3,
  );
  assert.doesNotMatch(JSON.stringify(f.events), /Private credential sentinel/);
  assert.deepEqual(
    f.validation
      .filter((event) => event.loop === 1)
      .map((event) => event.state),
    ["started", "retrying", "completed"],
  );
  assert.deepEqual(approved, before);
});

test("MB-UX-QUALITY-001 L04 unscoped authentication, mismatched providers, credits and privacy never authorize substitution", async (t) => {
  for (const failure of [
    () => new Response("API key not accepted", { status: 400 }),
    () => credentialFailure({ status: 401 }),
    () => credentialFailure({ byok: false }),
    () => credentialFailure({ provider: "Unrelated Provider" }),
    () => new Response("Insufficient credits", { status: 402 }),
    () =>
      new Response("Account privacy policy is incompatible", { status: 400 }),
  ]) {
    await t.test("Terminal configuration failure", async (subtest) => {
      const f = fixture(subtest, failure);
      await assert.rejects(
        f.gateway().generateAdvisoryLoops(approved, classification),
      );
      assert.equal(f.requests.length, 1);
      assert.equal(f.events.at(-1).recovery_scheduled, false);
    });
  }
});

test("MB-UX-QUALITY-001 L04 no configured BYOK alternative preserves the failure without credit billing", async (t) => {
  const f = fixture(t, () => credentialFailure());
  delete process.env.MATCHBASE_PROVIDER_OPENAI;
  await assert.rejects(
    f.gateway().generateAdvisoryLoops(approved, classification),
    /provider credential is not accepted/,
  );
  assert.equal(f.requests.length, 1);
});

test("MB-UX-QUALITY-001 L04 recovery requires both explicit preparation enablement and a dispatch guard", async (t) => {
  for (const options of [
    { preparation_recovery: false },
    { before_call: undefined },
  ]) {
    await t.test("Legacy call remains single attempt", async (subtest) => {
      const f = fixture(subtest, () => credentialFailure());
      await assert.rejects(
        f.gateway(options).generateAdvisoryLoops(approved, classification),
      );
      assert.equal(f.requests.length, 1);
    });
  }
});

test("MB-UX-QUALITY-001 L04 transport, route replacement and format repair share one three-request topic budget", async (t) => {
  const f = fixture(t, (body, count) =>
    count === 1
      ? new Response("Temporary service unavailable", { status: 503 })
      : count === 2
        ? credentialFailure()
        : response(body, { internal_envelope: "not a briefing" }),
  );
  await assert.rejects(
    f.gateway().generateAdvisoryLoops(approved, classification),
    /MB-422-LIVE-ADVISORY-FORMAT/,
  );
  assert.equal(f.requests.length, 3);
  assert.deepEqual(
    f.events
      .filter((event) => event.state === "started")
      .map((event) => event.recovery_attempt),
    [1, 2, 3],
  );
  assert.equal(f.validation.at(-1).state, "failed");
  assert.equal(
    f.events.filter((event) => event.state === "completed").length,
    1,
    "Rejected prose retains provider accounting",
  );
});

test("MB-UX-QUALITY-001 L04 a format repair keeps completed topics instead of repeating them", async (t) => {
  const f = fixture(t, (body, count) =>
    response(
      body,
      count === 2
        ? '{"analysis":"invalid JSON envelope"}'
        : `Verified topic evidence ${count}.`,
    ),
  );
  const result = await f
    .gateway()
    .generateAdvisoryLoops(approved, classification);
  assert.equal(f.requests.length, 4);
  assert.equal(result.loop1_trade_lane, "Verified topic evidence 1.");
  assert.equal(result.loop2_regulatory, "Verified topic evidence 3.");
  assert.match(
    f.requests[2].messages.at(-1).content,
    /previous response did not pass/i,
  );
  assert.equal(
    JSON.parse(f.requests[2].messages[1].content).earlier_briefings[0],
    result.loop1_trade_lane,
  );
});

test("MB-UX-QUALITY-001 L04 missing citations exhaust the allowance without publishing a briefing", async (t) => {
  const f = fixture(t, (body) =>
    response(body, "Unsupported prose.", { citations: false }),
  );
  await assert.rejects(
    f.gateway().generateAdvisoryLoops(approved, classification),
    /MB-422-LIVE-EVIDENCE/,
  );
  assert.equal(f.requests.length, 3);
  assert.equal(
    f.events
      .filter((event) => event.state === "failed")
      .reduce((sum, event) => sum + event.cost_usd, 0),
    0.03,
  );
  assert.equal(f.validation.at(-1).state, "failed");
});

test("MB-UX-QUALITY-001 L04 cancellation after route failure prevents the next dispatch", async (t) => {
  const controller = new AbortController();
  const f = fixture(t, () => credentialFailure());
  await assert.rejects(
    f
      .gateway({
        signal: controller.signal,
        on_checkpoint: (event) => {
          f.events.push(event);
          if (event.state === "failed") controller.abort();
        },
      })
      .generateAdvisoryLoops(approved, classification),
  );
  assert.equal(f.requests.length, 1);
});

test("MB-UX-QUALITY-001 L04 an execution guard blocks replacement dispatch and cannot become content recovery", async (t) => {
  const f = fixture(t, () => credentialFailure());
  let guards = 0;
  await assert.rejects(
    f
      .gateway({
        before_call: async () => {
          if (++guards > 1)
            throw new LiveResearchError(
              "MB-409-PREPARATION-STALE",
              "The execution changed.",
            );
        },
      })
      .generateAdvisoryLoops(approved, classification),
    /MB-409-PREPARATION-STALE/,
  );
  assert.equal(f.requests.length, 1);
});

test("MB-UX-QUALITY-001 L04 prompt schema recovery does not search or change the approved request", async (t) => {
  const f = fixture(t, (body, count) =>
    response(
      body,
      count === 1
        ? "invalid JSON"
        : {
            prompt_text: "Inspect primary supplier evidence.",
            discovery_criteria: ["Potassium hydroxide"],
            evidence_thresholds: ["Primary citations"],
            target_supplier_count: 20,
          },
    ),
  );
  const result = await f
    .gateway()
    .generateDeepResearchPrompt(approved, {}, classification);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((request) => !request.plugins));
  assert.match(result.prompt_text, /FOB \/ CIF \/ EXW are options/);
  assert.deepEqual(
    f.validation.map((event) => event.state),
    ["started", "retrying", "completed"],
  );
});

test("MB-UX-QUALITY-001 L04 a research method cannot promote an approved certification alternative to a mandatory gate", async (t) => {
  for (const method of [
    "Mandatory certification: ISO 9001 for every supplier.",
    "Treat ISO9001 as the default mandatory check.",
    "Suppliers must hold ISO 9001 certification.",
    "Only include suppliers with ISO 9001 certification.",
    "Reject suppliers without ISO 9001 certification.",
    "ISO 9001 is required for admission.",
  ]) {
    await t.test(method, async (subtest) => {
      const f = fixture(subtest, (body) =>
        response(body, {
          prompt_text: `${approved.english_translation}\n\nResearch method:\n${method}`,
          discovery_criteria: [],
          evidence_thresholds: [],
          target_supplier_count: 20,
        }),
      );
      await assert.rejects(
        f.gateway().generateDeepResearchPrompt(approved, {}, classification),
        /MB-422-LIVE-PROMPT-FIDELITY/,
      );
      assert.equal(
        f.requests.length,
        3,
        "Certification repair shares the existing three-call ceiling",
      );
      assert.match(
        f.requests[1].messages.at(-1).content,
        /permits an applicable standard/,
      );
      assert.equal(f.validation.at(-1).state, "failed");
    });
  }
});

test("MB-UX-QUALITY-001 L04 neutral lookup, explicit alternatives and negated certification gates remain valid", async (t) => {
  const accepted = [
    "Inspect ISO 9001 certificate status and issuing-body records; record gaps without inferring compliance.",
    "Mandatory certification: ISO 9001 or an applicable industrial standard, according to the approved scope.",
    "ISO9001 or an equivalent applicable standard is required.",
    "Do not require ISO 9001 alone. Check the applicable alternative standard.",
    "Do not treat ISO9001 as a default mandatory gate.",
    "ISO 9001 is not mandatory where an applicable alternative standard qualifies.",
    "Determine whether ISO 9001 is required by the destination regulator.",
    'Example search queries: "ISO9001 mandatory supplier"; "manufacturer versus trader"; "FOB versus CIF".',
    "Suppliers must hold an applicable industrial standard or ISO 9001 certification.",
    "Check available ISO 9001 certificates and mandatory safety data sheets.",
  ];
  const f = fixture(t, (body) =>
    response(body, {
      prompt_text: accepted.join("\n"),
      discovery_criteria: [],
      evidence_thresholds: [],
      target_supplier_count: 20,
    }),
  );
  const result = await f
    .gateway()
    .generateDeepResearchPrompt(approved, {}, classification);
  assert.equal(f.requests.length, 1);
  for (const line of accepted) assert.ok(result.prompt_text.includes(line));
});

test("MB-UX-QUALITY-001 L04 lookup and alternative language cannot waive a separate certificate admission directive", async (t) => {
  for (const method of [
    'Search "ISO 9001 supplier" and only admit suppliers with ISO 9001.',
    "Determine whether ISO 9001 is required and only admit suppliers with ISO 9001.",
    "Suppliers must hold an applicable industrial standard or ISO 9001 certification, but only admit suppliers with ISO 9001.",
    "Do not treat ISO 9001 as mandatory and only admit suppliers with ISO 9001.",
  ]) {
    await t.test(method, async (subtest) => {
      const f = fixture(subtest, (body) =>
        response(body, {
          prompt_text: method,
          discovery_criteria: [],
          evidence_thresholds: [],
          target_supplier_count: 20,
        }),
      );
      await assert.rejects(
        f.gateway().generateDeepResearchPrompt(approved, {}, classification),
        /MB-422-LIVE-PROMPT-FIDELITY/,
      );
      assert.equal(f.requests.length, 3);
    });
  }
});

test("MB-UX-QUALITY-001 L04 unqualified ISO-only discovery and verification gates are repaired across generated fields", async (t) => {
  for (const fields of [
    {
      discovery_criteria: [
        "Supplier has ISO 9001 certification evidenced by a certificate scan/listing with traceable details (or, if absent, is captured as a near-match with the missing evidence noted)",
      ],
    },
    {
      evidence_thresholds: [
        "ISO 9001 must be supported by certificate-level details (certificate number and/or issuer and/or validity dates). A bare “ISO9001 certified” marketing claim without traceable details is insufficient for verified status",
      ],
    },
  ]) {
    await t.test(Object.keys(fields)[0], async (subtest) => {
      const f = fixture(subtest, (body) =>
        response(body, {
          prompt_text: "Research the approved request.",
          discovery_criteria: [],
          evidence_thresholds: [],
          target_supplier_count: 20,
          ...fields,
        }),
      );
      await assert.rejects(
        f.gateway().generateDeepResearchPrompt(approved, {}, classification),
        /MB-422-LIVE-PROMPT-FIDELITY/,
      );
      assert.equal(f.requests.length, 3);
    });
  }
});

test("MB-UX-QUALITY-001 L04 evidence quality for a conditional ISO claim does not become a supplier admission gate", async (t) => {
  const threshold =
    "When ISO 9001 is claimed, ISO 9001 must be supported by certificate-level details. An unsupported certificate claim cannot receive verified status; suppliers with an applicable alternative standard remain eligible.";
  const f = fixture(t, (body) =>
    response(body, {
      prompt_text: "Research the approved request.",
      discovery_criteria: [],
      evidence_thresholds: [threshold],
      target_supplier_count: 20,
    }),
  );
  const result = await f
    .gateway()
    .generateDeepResearchPrompt(approved, {}, classification);
  assert.equal(result.evidence_thresholds[0], threshold);
  assert.equal(f.requests.length, 1);
});

test("MB-UX-QUALITY-001 L04 certification threshold feedback repairs the method before wrapping approved text", async (t) => {
  const f = fixture(t, (body, count) =>
    response(body, {
      prompt_text: "Inspect primary supplier evidence.",
      discovery_criteria: [],
      evidence_thresholds: [
        count === 1
          ? "Required certification: ISO 9001"
          : "Check ISO 9001 or an applicable standard without imposing a default gate.",
      ],
      target_supplier_count: 20,
    }),
  );
  const result = await f
    .gateway()
    .generateDeepResearchPrompt(approved, {}, classification);
  assert.equal(f.requests.length, 2);
  assert.match(
    f.requests[1].messages.at(-1).content,
    /discovery\/evidence thresholds/,
  );
  assert.match(result.prompt_text, /^AUTHORITATIVE HUMAN-APPROVED REQUEST/);
  assert.equal(
    result.evidence_thresholds[0],
    "Check ISO 9001 or an applicable standard without imposing a default gate.",
  );
  assert.ok(f.requests.every((request) => !request.plugins));
});

test("MB-UX-QUALITY-001 L04 a genuinely mandatory approved certificate is not weakened by the alternative guard", async (t) => {
  const f = fixture(t, (body) =>
    response(body, {
      prompt_text: "Mandatory certification: ISO 9001.",
      discovery_criteria: [],
      evidence_thresholds: [],
      target_supplier_count: 20,
    }),
  );
  const mandatory = {
    ...approved,
    english_translation:
      "Industrial potassium hydroxide. ISO 9001 is required.",
  };
  const result = await f
    .gateway()
    .generateDeepResearchPrompt(mandatory, {}, classification);
  assert.match(result.prompt_text, /Mandatory certification: ISO 9001/);
  assert.equal(f.requests.length, 1);
});
