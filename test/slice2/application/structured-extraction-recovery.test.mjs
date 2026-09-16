import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { extractNativeCandidateScope } from "../../../packages/application/dist/live-evidence-extraction.js";
import {
  LiveResearchError,
  researchCompletionInput,
  runLiveCompletion,
} from "../../../packages/application/dist/openrouter-model-policy.js";
import { researchStageHash } from "../../../packages/application/dist/research-stage-executor.js";
import {
  objectSchema,
  parseLiveJson,
  validateJsonSchema,
} from "../../../packages/application/dist/live-json-schema.js";

const scope = "MB-UX-QUALITY-001 L10";
const primary = "anthropic/claude-sonnet-4.6";
const alternate = "deepseek/deepseek-v3.2";
const providers = {
  [primary]: { tag: "anthropic", name: "Anthropic" },
  [alternate]: { tag: "novita", name: "NovitaAI" },
};
const parameters = ["max_tokens", "reasoning", "structured_outputs"];
const invalidResponseMarker = "UNTRUSTED_INVALID_RESPONSE_DO_NOT_REPLAY";
const sourceUrl = "https://aster-industrial.com/capabilities";
const company = "Aster Industrial Services";
const quote = `${company} provides industrial pump maintenance.`;
const runtimeName = (name) =>
  /^(?:MATCHBASE_|OPENROUTER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS)$|OPENAI_API_KEY$|GOOGLE_API_KEY$|GEMINI_API_KEY$)/.test(
    name,
  );

function rate(model, changes = {}) {
  return {
    model,
    provider: providers[model].tag,
    provider_display_name: providers[model].name,
    billing_mode: "openrouter_credits",
    input_usd_per_token: 0.000001,
    output_usd_per_token: 0.000002,
    request_usd: 0,
    web_search_usd: 0,
    reasoning: true,
    structured_outputs: true,
    source_url: `https://openrouter.ai/api/v1/models/${model}/endpoints`,
    ...changes,
  };
}

function validIndex() {
  return {
    candidates: [
      {
        legal_name: company,
        anchor_quote: quote,
        source_urls: [sourceUrl],
      },
    ],
    remaining_gaps: ["A current supplier quotation remains unavailable."],
    evidence_exhausted: false,
    summary: "One company is named in the supplied source evidence.",
  };
}

function invalidIndex() {
  const { evidence_exhausted: omitted, ...index } = validIndex();
  assert.equal(omitted, false);
  return `\`\`\`json\n${JSON.stringify({
    ...index,
    remaining_gaps: invalidResponseMarker,
    evidence_exhaustion: "More source research is required.",
  })}\n\`\`\``;
}

function fixture(t, settings = {}) {
  // All network access is intercepted before the extraction operation. The
  // fixture has no database/server entrypoint and never loads runtime config.
  const previous = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => runtimeName(name)),
  );
  for (const name of Object.keys(previous)) delete process.env[name];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  t.after(() => {
    for (const name of Object.keys(process.env))
      if (runtimeName(name)) delete process.env[name];
    Object.assign(process.env, previous);
  });
  const native = {
    model: primary,
    text: `${quote} No current quotation was supplied. Further verification is required.`,
    citations: [
      {
        url: sourceUrl,
        title: "Aster Industrial Services capabilities",
        content: quote,
      },
    ],
    input_tokens: 30,
    output_tokens: 40,
    latency_ms: 1,
    cost_usd: 0.01,
    live_api_invoked: true,
  };
  const originalNative = structuredClone(native);
  const context = {
    phase: "verification",
    loop: 4,
    max_loops: 5,
    mandatory_criteria: ["Industrial pump maintenance"],
  };
  const calls = [];
  const guards = [];
  const events = [];
  const rates = settings.rates ?? [rate(primary), rate(alternate)];
  const options = {
    automatic_recovery_attempts: settings.attempts ?? 3,
    approved_rates: rates,
    approved_model_fallbacks: settings.fallbacks ?? { [primary]: [alternate] },
    // Search approval is deliberately present; extraction must not use it.
    approved_search_engines: { [primary]: "exa", [alternate]: "exa" },
    max_input_bytes: settings.max_input_bytes ?? 240000,
    max_output_tokens: 20000,
    before_call: async (request, web) => {
      guards.push({ request, web });
      await settings.before_call?.(request, web);
    },
    on_checkpoint: async (event) => {
      events.push(event);
      await settings.on_checkpoint?.(event);
    },
    ...(settings.signal ? { signal: settings.signal } : {}),
  };
  if (settings.no_guard) delete options.before_call;
  t.mock.method(globalThis, "fetch", async (target, requestOptions = {}) => {
    const url = new URL(String(target));
    assert.equal(url.origin, "https://openrouter.ai");
    if (url.pathname === "/api/v1/models/user")
      return Response.json({
        data: Object.keys(providers).map((id) => ({
          id,
          supported_parameters: parameters,
        })),
      });
    if (url.pathname === "/api/v1/endpoints/zdr")
      return Response.json({
        data: Object.entries(providers).map(([model_id, provider]) => ({
          model_id,
          tag: provider.tag,
        })),
      });
    for (const [model, provider] of Object.entries(providers)) {
      if (url.pathname === `/api/v1/models/${model}/endpoints`)
        return Response.json({
          data: {
            endpoints: [
              {
                tag: provider.tag,
                model_id: model,
                name: `${provider.name} | ${model}`,
                provider_name: provider.name,
                status: 0,
                supported_parameters: parameters,
                pricing: { prompt: "0.000001", completion: "0.000002" },
              },
            ],
          },
        });
    }
    assert.equal(url.pathname, "/api/v1/chat/completions");
    assert.equal(requestOptions.method, "POST");
    const request = JSON.parse(requestOptions.body);
    calls.push(request);
    const payload = settings.payload
      ? await settings.payload(calls.length, request)
      : calls.length === 1
        ? invalidIndex()
        : validIndex();
    if (payload instanceof Response) return payload;
    const provider = providers[request.model];
    const approvedRate = rates.find((entry) => entry.model === request.model);
    return Response.json({
      id: `gen-structured-recovery-${calls.length}`,
      model: request.model,
      provider: provider.name,
      openrouter_metadata: {
        is_byok: approvedRate?.billing_mode === "byok",
        endpoints: {
          available: [
            { selected: true, model: request.model, provider: provider.name },
          ],
        },
      },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              typeof payload === "string" ? payload : JSON.stringify(payload),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: calls.length * 0.01,
      },
    });
  });
  return {
    native,
    originalNative,
    calls,
    guards,
    events,
    options,
    run: () => extractNativeCandidateScope(native, primary, context, options),
  };
}

const messageText = (request) =>
  request.messages.map((message) => message.content).join("\n");
const dispatchedEvents = (f) =>
  f.events.filter((event) => event.dispatched && event.state !== "started");

function retainedStages() {
  const records = new Map();
  return {
    records,
    async load(manifest) {
      return records.get(manifest.operation_key) ?? null;
    },
    async commit(manifest, result) {
      records.set(
        manifest.operation_key,
        structuredClone({ manifest, result }),
      );
    },
  };
}

test("MB-ARCH-IMPLEMENT-001 L01 validated extraction resumes without a second provider request", async (t) => {
  const f = fixture(t, { payload: () => validIndex() });
  const store = retainedStages();
  f.options.stage_store = store;
  const first = await f.run();
  const resumed = await f.run();
  assert.deepEqual(resumed, first);
  assert.equal(f.calls.length, 1);
  assert.equal(store.records.size, 1);
  assert.equal(
    [...store.records.values()][0].manifest.qualification,
    "validated_extraction",
  );
  const reuse = f.events.find(
    (event) => event.stage === "retained_stage_reuse",
  );
  assert.equal(reuse.dispatched, false);
  assert.equal(reuse.cost_usd, undefined);
});

test("MB-ARCH-IMPLEMENT-001 L01 source changes beyond context excerpts invalidate saved extraction", async (t) => {
  const f = fixture(t, { payload: () => validIndex() });
  f.options.stage_store = retainedStages();
  f.native.citations[0].content += " ".repeat(6500) + "Original terminal fact";
  await f.run();
  f.native.citations[0].content += " corrected";
  await f.run();
  assert.equal(f.calls.length, 2);
});

test("MB-ARCH-IMPLEMENT-001 L01 a corrupted saved extraction stops without replaying paid work", async (t) => {
  const f = fixture(t, { payload: () => validIndex() });
  const store = retainedStages();
  f.options.stage_store = store;
  await f.run();
  const record = [...store.records.values()][0];
  delete record.result.parsed.evidence_exhausted;
  await assert.rejects(f.run(), { code: "MB-409-STAGE-INTEGRITY" });
  assert.equal(f.calls.length, 1);
});

test("MB-ARCH-IMPLEMENT-001 L01 admission receives exact effective requests and stable repair identity", async (t) => {
  const f = fixture(t);
  const admitted = [];
  f.options.admit_call = async (request, web, admission) => {
    assert.equal(web, false);
    assert.equal(admission.request_id, request.request_id);
    assert.equal(
      admission.effective_request_sha256,
      researchStageHash(researchCompletionInput(request)),
    );
    assert.deepEqual(request.reasoning, { effort: "low", exclude: true });
    admitted.push(admission);
  };
  await f.run();
  assert.equal(admitted.length, 2);
  assert.equal(admitted[0].stage_key, admitted[1].stage_key);
  assert.notEqual(admitted[0].operation_key, admitted[1].operation_key);
  assert.notEqual(admitted[0].request_id, admitted[1].request_id);
});

test("MB-ARCH-IMPLEMENT-001 L01 rejected atomic admission never dispatches", async (t) => {
  const f = fixture(t, { payload: () => validIndex() });
  f.options.admit_call = async () => {
    throw new LiveResearchError(
      "MB-409-ROUND-ALLOWANCE",
      "No authority remains.",
    );
  };
  await assert.rejects(f.run(), { code: "MB-409-ROUND-ALLOWANCE" });
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.events.some((event) => event.dispatched),
    false,
  );
});

test("MB-ARCH-IMPLEMENT-001 L01 a received invalid JSON response is distinguished from an unknown dispatch", async (t) => {
  const f = fixture(t, { attempts: 1, payload: () => invalidIndex() });
  await assert.rejects(f.run(), { code: "MB-422-LIVE-SCHEMA" });
  const failed = f.events.find(
    (event) => event.dispatched && event.state === "failed",
  );
  assert.equal(failed.provider_receipt_received, true);
  assert.equal(failed.provider_dispatch_rejected, false);
});

test("MB-ARCH-IMPLEMENT-001 L01 transport errors cannot fabricate a receipt using cost or generation fields", async (t) => {
  const f = fixture(t, {
    attempts: 1,
    payload: () => {
      throw Object.assign(new Error("Transport unavailable"), {
        cost_usd: 1,
        provider_generation_id: "not-a-receipt",
      });
    },
  });
  await assert.rejects(f.run(), { code: "MB-503-LIVE-TRANSPORT" });
  const failed = f.events.find(
    (event) => event.dispatched && event.state === "failed",
  );
  assert.equal(failed.provider_receipt_received, false);
  assert.equal(failed.provider_dispatch_rejected, false);
});

for (const status of [400, 429, 408, 500]) {
  test(`MB-ARCH-IMPLEMENT-001 L01 HTTP ${status} preserves explicit dispatch certainty`, async (t) => {
    const f = fixture(t, {
      attempts: 1,
      payload: () =>
        Response.json(
          { error: { code: status, message: "Request failed." } },
          { status },
        ),
    });
    await assert.rejects(f.run(), { code: "MB-502-LIVE-PROVIDER" });
    const failed = f.events.find(
      (event) => event.dispatched && event.state === "failed",
    );
    assert.equal(failed.provider_receipt_received, false);
    assert.equal(
      failed.provider_dispatch_rejected,
      [400, 429].includes(status),
    );
  });
}

test("MB-ARCH-IMPLEMENT-001 L01 a web receipt remains full and unvalidated across restart", async (t) => {
  const longText = quote + " x".repeat(110000);
  const f = fixture(t, {
    payload: () =>
      Response.json({
        id: "gen-retained-native-receipt",
        model: primary,
        provider: "Anthropic",
        openrouter_metadata: {
          is_byok: false,
          endpoints: {
            available: [
              { selected: true, model: primary, provider: "Anthropic" },
            ],
          },
        },
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: longText,
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    url: sourceUrl,
                    title: company,
                    content: quote,
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 500, cost: 0.03 },
      }),
  });
  const store = retainedStages();
  const options = { ...f.options, stage_store: store, web_engine: "exa" };
  const run = () =>
    runLiveCompletion(
      {
        model: primary,
        messages: [{ role: "user", content: "Find evidence." }],
      },
      { phase: "discovery", loop: 1, require_web: true },
      options,
    );
  const first = await run();
  const resumed = await run();
  assert.equal(resumed.text.length, longText.length);
  assert.deepEqual(resumed, first);
  assert.equal(f.calls.length, 1);
  assert.equal(
    [...store.records.values()][0].manifest.qualification,
    "received_unvalidated",
  );
});

function assertExtractionOnly(f) {
  assert.ok(f.calls.length > 0);
  assert.ok(f.guards.every(({ web }) => web === false));
  for (const request of f.calls) {
    assert.equal(request.plugins, undefined);
    assert.equal(request.tools, undefined);
    assert.equal(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.strict, true);
    assert.equal(
      request.response_format.json_schema.name,
      "matchbase_native_candidate_index",
    );
    assert.ok(request.max_tokens <= 20000);
    assert.match(messageText(request), /evidence_exhausted/);
    assert.match(messageText(request), /boolean/);
    assert.match(messageText(request), /remaining_gaps/);
    assert.match(messageText(request), /array/);
    assert.ok(!messageText(request).includes(invalidResponseMarker));
    assert.ok(
      Buffer.byteLength(JSON.stringify(request.messages), "utf8") + 512 <=
        f.options.max_input_bytes,
    );
  }
  assert.deepEqual(f.native, f.originalNative);
}

test(`${scope} malformed Anthropic index repairs with the approved DeepSeek model and retained evidence only`, async (t) => {
  const f = fixture(t);
  const output = await f.run();
  assert.deepEqual(output.parsed, validIndex());
  assert.equal(output.result.model, alternate);
  assert.equal(output.result.requested_model, alternate);
  assert.equal(output.result.requested_provider, providers[alternate].tag);
  assert.equal(output.result.actual_provider, providers[alternate].name);
  assert.equal(output.result.approved_billing_mode, "openrouter_credits");
  assert.equal(output.result.is_byok, false);
  assert.deepEqual(
    f.calls.map((request) => request.model),
    [primary, alternate],
  );
  assert.deepEqual(
    f.calls.map((request) => request.provider.only),
    [[providers[primary].tag], [providers[alternate].tag]],
  );
  assert.ok(
    f.calls.every((request) => request.provider.allow_fallbacks === false),
  );
  assert.ok(f.calls.every((request) => request.provider.zdr === true));
  assert.notEqual(messageText(f.calls[0]), messageText(f.calls[1]));
  assert.match(messageText(f.calls[1]), /repair|previous|validation|invalid/i);
  const terminal = dispatchedEvents(f);
  assert.deepEqual(
    terminal.map((event) => event.state),
    ["failed", "completed"],
  );
  assert.deepEqual(
    terminal.map((event) => event.requested_model),
    [primary, alternate],
  );
  assert.deepEqual(
    terminal.map((event) => event.recovery_attempt),
    [1, 2],
  );
  assert.deepEqual(
    terminal.map((event) => event.cost_usd),
    [0.01, 0.02],
  );
  assert.equal(terminal[0].error, "MB-422-LIVE-SCHEMA");
  assert.equal(new Set(terminal.map((event) => event.request_id)).size, 2);
  assertExtractionOnly(f);
});

test(`${scope} historical approval without a substitute retries the original model with schema repair guidance`, async (t) => {
  const f = fixture(t, { fallbacks: {} });
  const output = await f.run();
  assert.deepEqual(output.parsed, validIndex());
  assert.deepEqual(
    f.calls.map((request) => request.model),
    [primary, primary],
  );
  assert.notEqual(messageText(f.calls[0]), messageText(f.calls[1]));
  assert.match(messageText(f.calls[1]), /repair|previous|validation|invalid/i);
  assertExtractionOnly(f);
});

for (const [label, settings] of [
  ["unpriced substitute", { rates: [rate(primary)] }],
  [
    "substitute requiring another billing mode",
    { rates: [rate(primary), rate(alternate, { billing_mode: "byok" })] },
  ],
  [
    "substitute without structured output support",
    { rates: [rate(primary), rate(alternate, { structured_outputs: false })] },
  ],
])
  test(`${scope} ${label} cannot replace the approved extraction model`, async (t) => {
    const f = fixture(t, settings);
    await f.run();
    assert.deepEqual(
      f.calls.map((request) => request.model),
      [primary, primary],
    );
    assertExtractionOnly(f);
  });

for (const order of ["structural-transport", "transport-structural"])
  test(`${scope} ${order} failures share exactly three extraction dispatches`, async (t) => {
    const f = fixture(t, {
      payload: (attempt) => {
        if (
          (order === "structural-transport" && attempt === 2) ||
          (order === "transport-structural" && attempt === 1)
        )
          throw new TypeError("Mocked extraction connection failure.");
        return invalidIndex();
      },
    });
    await assert.rejects(
      f.run(),
      (error) => error.code === "MB-422-LIVE-SCHEMA",
    );
    assert.deepEqual(
      f.calls.map((request) => request.model),
      [primary, alternate, alternate],
    );
    assert.equal(f.guards.length, 3);
    assert.equal(
      f.events.filter((event) => event.state === "started").length,
      3,
    );
    assert.equal(dispatchedEvents(f).at(-1).recovery_attempt, 3);
    assertExtractionOnly(f);
  });

test(`${scope} invalid JSON stays invalid after the full recovery allowance`, async (t) => {
  const f = fixture(t, { payload: () => '{ "candidates": [' });
  await assert.rejects(f.run(), (error) => error.code === "MB-422-LIVE-SCHEMA");
  assert.deepEqual(
    f.calls.map((request) => request.model),
    [primary, alternate, alternate],
  );
  assert.equal(
    dispatchedEvents(f).filter((event) => event.state === "completed").length,
    0,
  );
  assertExtractionOnly(f);
});

test(`${scope} a single approved attempt cannot silently acquire a repair attempt`, async (t) => {
  const f = fixture(t, { attempts: 1 });
  await assert.rejects(f.run(), (error) => error.code === "MB-422-LIVE-SCHEMA");
  assert.deepEqual(
    f.calls.map((request) => request.model),
    [primary],
  );
  assert.equal(f.guards.length, 1);
  assert.equal(dispatchedEvents(f).at(-1).recovery_scheduled, false);
  assertExtractionOnly(f);
});

test(`${scope} a retry option without a spending guard cannot dispatch credit-funded extraction`, async (t) => {
  const f = fixture(t, { no_guard: true });
  await assert.rejects(
    f.run(),
    (error) => error.code === "MB-409-ROUND-BILLING",
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.guards.length, 0);
});

test(`${scope} schema recovery cannot manufacture a company absent from original evidence`, async (t) => {
  const f = fixture(t, {
    payload: (attempt) =>
      attempt === 1
        ? invalidIndex()
        : {
            ...validIndex(),
            candidates: [
              {
                legal_name: "Invented Unrelated Supplier",
                anchor_quote:
                  "Invented Unrelated Supplier offers every requirement.",
                source_urls: ["https://invented-unrelated-supplier.com/about"],
              },
            ],
          },
  });
  await assert.rejects(f.run(), (error) => error.code === "MB-422-LIVE-INDEX");
  assert.equal(f.calls.length, 3);
  assert.equal(
    dispatchedEvents(f).filter((event) => event.state === "completed").length,
    0,
  );
  assertExtractionOnly(f);
});

test(`${scope} source URLs added by the repair model receive no evidence authority`, async (t) => {
  const inventedSource = "https://invented-unrelated-supplier.com/about";
  const f = fixture(t, {
    payload: (attempt) => {
      if (attempt === 1) return invalidIndex();
      const index = validIndex();
      index.candidates[0].source_urls.push(inventedSource);
      return index;
    },
  });
  const output = await f.run();
  assert.deepEqual(output.parsed.candidates[0].source_urls, [sourceUrl]);
  assert.deepEqual(
    dispatchedEvents(f).at(-1).index_validation.discarded_source_urls,
    [inventedSource],
  );
  assert.equal(f.calls.length, 2);
  assertExtractionOnly(f);
});

for (const status of [401, 402, 403])
  test(`${scope} HTTP ${status} never triggers structural repair or an alternative`, async (t) => {
    const f = fixture(t, {
      payload: () => Response.json({ error: { code: status } }, { status }),
    });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
    assert.equal(f.guards.length, 1);
    assert.equal(
      f.events.some((event) => event.stage === "extraction_recovery"),
      false,
    );
  });

test(`${scope} cancellation after invalid output prevents the replacement dispatch`, async (t) => {
  const controller = new AbortController();
  const f = fixture(t, {
    signal: controller.signal,
    on_checkpoint: (event) => {
      if (event.state === "failed")
        controller.abort(new Error("The user stopped research."));
    },
  });
  await assert.rejects(f.run());
  assert.equal(f.calls.length, 1);
  assert.equal(f.guards.length, 1);
});

test(`${scope} rejected spending guard prevents any substitute provider dispatch`, async (t) => {
  const f = fixture(t, {
    before_call: (request) => {
      if (request.model === alternate)
        throw new LiveResearchError(
          "MB-409-ROUND-ALLOWANCE",
          "Approved allowance exhausted.",
        );
    },
  });
  await assert.rejects(
    f.run(),
    (error) => error.code === "MB-409-ROUND-ALLOWANCE",
  );
  assert.deepEqual(
    f.calls.map((request) => request.model),
    [primary],
  );
  assert.deepEqual(
    f.guards.map(({ request }) => request.model),
    [primary, alternate],
  );
});

for (const state of ["failed", "completed"])
  test(`${scope} ${state} checkpoint persistence failure does not start another extraction`, async (t) => {
    const f = fixture(t, {
      payload: () => (state === "completed" ? validIndex() : invalidIndex()),
      on_checkpoint: (event) => {
        if (event.state === state)
          throw new Error("Mocked retained-checkpoint storage failure.");
      },
    });
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
    assert.equal(f.guards.length, 1);
  });

test(`${scope} a valid fenced index needs no recovery and retains the exact evidence scope`, async (t) => {
  const f = fixture(t, {
    payload: () => `\`\`\`json\n${JSON.stringify(validIndex())}\n\`\`\``,
  });
  const output = await f.run();
  assert.deepEqual(output.parsed, validIndex());
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.events.some((event) => event.stage === "extraction_recovery"),
    false,
  );
  assertExtractionOnly(f);
});

test(`${scope} missing required boolean reports its schema path without coercing an unrelated field`, () => {
  const schema = objectSchema({
    evidence_exhausted: { type: "boolean" },
  });
  assert.throws(
    () => parseLiveJson('{"evidence_exhaustion":"false"}', schema),
    (error) =>
      error.code === "MB-422-LIVE-SCHEMA" &&
      error.message.includes("response.evidence_exhausted"),
  );
  assert.throws(
    () => parseLiveJson('{"evidence_exhausted":"false"}', schema),
    (error) => error.code === "MB-422-LIVE-SCHEMA",
  );
});

test(`${scope} inherited properties cannot satisfy a required evidence field`, () => {
  const inherited = Object.create({ evidence_exhausted: true });
  assert.throws(
    () =>
      validateJsonSchema(
        inherited,
        objectSchema({ evidence_exhausted: { type: "boolean" } }),
      ),
    (error) =>
      error.code === "MB-422-LIVE-SCHEMA" &&
      error.message.includes("response.evidence_exhausted"),
  );
});
