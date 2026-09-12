import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  LiveResearchError,
  runLiveCompletion,
  withLiveStageBudget,
} from "../../../packages/application/dist/openrouter-model-policy.js";

const scope = "MB-UX-QUALITY-001 L09";
const primary = "google/gemini-3.8-flash";
const alternate = "openai/gpt-5.2";
const parameters = ["max_tokens", "reasoning", "structured_outputs"];
const providers = {
  [primary]: { tag: "google-ai-studio", name: "Google AI Studio" },
  [alternate]: { tag: "openai", name: "OpenAI" },
  "deepseek/deepseek-v3.2": { tag: "novita", name: "NovitaAI" },
};
const runtimeName = (name) =>
  /^(?:MATCHBASE_|OPENROUTER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS)$)/.test(
    name,
  );

function rate(model, changes = {}) {
  return {
    model,
    provider: providers[model].tag,
    provider_display_name: providers[model].name,
    billing_mode: "byok",
    input_usd_per_token: 0.000001,
    output_usd_per_token: 0.000002,
    request_usd: 0,
    web_search_usd: 0.01,
    reasoning: true,
    structured_outputs: true,
    source_url: `https://openrouter.ai/api/v1/models/${model}/endpoints`,
    ...changes,
  };
}

function fixture(t, settings = {}) {
  const previous = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => runtimeName(name)),
  );
  for (const name of Object.keys(previous)) delete process.env[name];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  t.after(() => {
    for (const name of Object.keys(process.env))
      if (runtimeName(name)) delete process.env[name];
    Object.assign(process.env, previous);
  });
  const calls = [];
  const reads = [];
  const guards = [];
  const events = [];
  const prices = settings.rates ?? [rate(primary), rate(alternate)];
  const response = (request, attempt) => {
    const provider = providers[request.model];
    return {
      id: `gen-model-fallback-${attempt}`,
      model: request.model,
      provider: provider.name,
      openrouter_metadata: {
        is_byok: true,
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
            content: "An independently sourced research lead is available.",
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://verified-research-provider.com/research-services",
                  title: "Research services",
                  content: "Primary market research and regulatory analysis.",
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        cost: attempt * 0.01,
        cost_details: { upstream_inference_cost: attempt * 0.02 },
      },
    };
  };
  t.mock.method(globalThis, "fetch", async (target, options = {}) => {
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
    if (url.pathname === "/api/v1/generation") {
      assert.equal(options.method, "GET");
      reads.push(url.searchParams.get("id"));
      return Response.json({ error: { code: 503 } }, { status: 503 });
    }
    assert.equal(url.pathname, "/api/v1/chat/completions");
    assert.equal(options.method, "POST");
    const request = JSON.parse(options.body);
    calls.push(request);
    const body = response(request, calls.length);
    return settings.completion
      ? settings.completion(body, calls.length, request)
      : Response.json(body);
  });
  const budget = withLiveStageBudget({
    automatic_recovery_attempts: settings.attempts ?? 3,
    approved_rates: prices,
    approved_model_fallbacks: settings.fallbacks ?? { [primary]: [alternate] },
    approved_search_engines: {
      [primary]: "native",
      [alternate]: "exa",
      "deepseek/deepseek-v3.2": "exa",
      ...settings.engines,
    },
    before_call: async (request, web) => {
      guards.push({ request, web });
      await settings.before_call?.(request, web);
    },
    on_checkpoint: async (event) => {
      events.push(event);
      await settings.on_checkpoint?.(event);
    },
    ...(settings.signal ? { signal: settings.signal } : {}),
  });
  const request = {
    model: primary,
    max_tokens: 500,
    messages: [{ role: "user", content: "Find market research providers." }],
  };
  const context = {
    phase: "follow_up_research",
    loop: 3,
    max_loops: 5,
    require_web: true,
  };
  return {
    calls,
    reads,
    guards,
    events,
    budget,
    run: () => runLiveCompletion(request, context, budget.options),
  };
}

function malfunction(body, native = "MALFORMED_FUNCTION_CALL") {
  body.choices[0].finish_reason = "error";
  body.choices[0].native_finish_reason = native;
  body.choices[0].message.content = "Partial response must not be accepted.";
  body.choices[0].message.annotations = [];
  return Response.json(body);
}

async function failure(promise) {
  let captured;
  await assert.rejects(promise, (error) => {
    captured = error;
    return true;
  });
  return captured;
}

test(`${scope} malformed Gemini generation uses the named priced same-billing alternative with its search engine and audited identity`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) =>
      attempt === 1 ? malfunction(body) : Response.json(body),
  });
  const result = await f.run();
  assert.equal(result.model, alternate);
  assert.equal(result.requested_model, alternate);
  assert.equal(result.requested_provider, "openai");
  assert.equal(result.actual_provider, "OpenAI");
  assert.equal(result.is_byok, true);
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, alternate],
  );
  assert.deepEqual(
    f.guards.map(({ request, web }) => [request.model, web]),
    [
      [primary, true],
      [alternate, true],
    ],
  );
  assert.deepEqual(f.calls[0].plugins, [{ id: "web", engine: "native" }]);
  assert.deepEqual(f.calls[1].plugins, [
    { id: "web", engine: "exa", max_results: 8, mode: "auto" },
  ]);
  assert.deepEqual(f.guards[1].request.plugins, f.calls[1].plugins);
  assert.deepEqual(f.calls[1].provider.only, ["openai"]);
  assert.equal(f.calls[1].provider.allow_fallbacks, false);
  assert.deepEqual(f.calls[1].provider.max_price, {
    prompt: 1,
    completion: 2,
    request: 0,
  });
  const terminal = f.events.filter((event) => event.state !== "started");
  assert.deepEqual(
    terminal.map((event) => event.state),
    ["failed", "completed"],
  );
  assert.deepEqual(
    terminal.map((event) => event.requested_model),
    [primary, alternate],
  );
  assert.deepEqual(
    terminal.map((event) => event.actual_model),
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
  assert.deepEqual(
    terminal.map((event) => event.upstream_inference_cost),
    [0.02, 0.04],
  );
  assert.equal(terminal[0].provider_error_type, "malformed_function_call");
  assert.equal(terminal[0].response_failure_kind, "provider_error");
  assert.equal(terminal[0].recovery_scheduled, true);
  assert.ok(terminal[0].message.includes(alternate));
  assert.ok(terminal[0].recovery_message.includes(alternate));
  assert.equal(terminal[0].recovery_next_model, alternate);
  assert.equal(terminal[1].recovery_original_model, primary);
  assert.equal(terminal[1].native_web, false);
  assert.equal(new Set(terminal.map((event) => event.request_id)).size, 2);
  assert.equal(
    new Set(terminal.map((event) => event.provider_generation_id)).size,
    2,
  );
  assert.equal(f.budget.remaining(), 1);
  assert.equal(f.reads.length, 0);
});

test(`${scope} unexpected tool generation can use the approved alternative`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) =>
      attempt === 1
        ? malfunction(body, "UNEXPECTED_TOOL_CALL")
        : Response.json(body),
  });
  await f.run();
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, alternate],
  );
  assert.equal(
    f.events.find((event) => event.state === "failed").provider_error_type,
    "unexpected_tool_call",
  );
});

for (const kind of ["transport", "empty", "provider_overloaded"])
  test(`${scope} ${kind} failure can use only the approved alternative`, async (t) => {
    const f = fixture(t, {
      completion: (body, attempt) => {
        if (attempt !== 1) return Response.json(body);
        if (kind === "transport")
          throw new TypeError("Mocked transport closed.");
        if (kind === "empty") body.choices[0].message.content = " ";
        else {
          body.choices[0].finish_reason = "error";
          body.choices[0].error = { metadata: { error_type: kind } };
        }
        return Response.json(body);
      },
    });
    await f.run();
    assert.deepEqual(
      f.calls.map((call) => call.model),
      [primary, alternate],
    );
    assert.equal(f.guards.length, 2);
  });

for (const [name, settings] of [
  ["legacy approval without a fallback", { fallbacks: {} }],
  ["unpriced alternate", { rates: [rate(primary)] }],
  [
    "fallback listed for another primary",
    { fallbacks: { [alternate]: [primary] } },
  ],
  [
    "multiple alternatives outside the single-substitute contract",
    { fallbacks: { [primary]: [alternate, "deepseek/deepseek-v3.2"] } },
  ],
  [
    "mixed billing mode",
    {
      rates: [
        rate(primary),
        rate("deepseek/deepseek-v3.2", { billing_mode: "openrouter_credits" }),
      ],
      fallbacks: { [primary]: ["deepseek/deepseek-v3.2"] },
    },
  ],
])
  test(`${scope} ${name} never authorizes model substitution`, async (t) => {
    const f = fixture(t, {
      ...settings,
      completion: (body, attempt) =>
        attempt === 1 ? malfunction(body) : Response.json(body),
    });
    await f.run();
    assert.deepEqual(
      f.calls.map((call) => call.model),
      [primary, primary],
    );
    assert.deepEqual(
      f.guards.map(({ request }) => request.model),
      [primary, primary],
    );
  });

test(`${scope} failing alternate cannot reset the original three-attempt stage ceiling`, async (t) => {
  const f = fixture(t, { completion: (body) => malfunction(body) });
  await failure(f.run());
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, alternate, alternate],
  );
  assert.equal(f.guards.length, 3);
  assert.equal(f.budget.remaining(), 0);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
  const terminal = await failure(f.run());
  assert.equal(terminal.code, "MB-409-STAGE-ALLOWANCE");
  assert.equal(f.calls.length, 3);
  assert.equal(f.guards.length, 3);
});

test(`${scope} outer structural retry keeps the chosen substitute and shares the original allowance`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) =>
      attempt === 1 ? malfunction(body) : Response.json(body),
  });
  await f.run();
  assert.equal(f.budget.remaining(), 1);
  await f.run();
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, alternate, alternate],
  );
  assert.equal(f.budget.remaining(), 0);
  assert.equal((await failure(f.run())).code, "MB-409-STAGE-ALLOWANCE");
  assert.equal(f.calls.length, 3);
});

test(`${scope} an outer retry exhausting the last two slots retains the final provider error without a fourth preflight`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) =>
      attempt === 1 ? Response.json(body) : malfunction(body),
  });
  await f.run();
  assert.equal(f.budget.remaining(), 2);
  const error = await failure(f.run());
  assert.equal(error.code, "MB-502-LIVE-RESPONSE");
  assert.equal(error.audited_response.requested_model, alternate);
  assert.equal(
    error.audited_response.provider_error_type,
    "malformed_function_call",
  );
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, primary, alternate],
  );
  assert.equal(f.guards.length, 3);
  assert.equal(f.events.filter((event) => event.state === "started").length, 3);
  assert.equal(f.events.filter((event) => event.state === "failed").length, 2);
  assert.equal(f.events.at(-1).recovery_attempt, 3);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
  assert.equal(f.budget.remaining(), 0);
});

for (const native of ["RECITATION", "SAFETY", "CANCELLED"])
  test(`${scope} ${native} does not dispatch any alternative`, async (t) => {
    const f = fixture(t, { completion: (body) => malfunction(body, native) });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.guards.length, 1);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
  });

test(`${scope} explicit content refusal overrides a simultaneous technical tool failure`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].message.refusal = "Content policy refusal.";
      return malfunction(body);
    },
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).response_failure_kind, "refusal");
});

for (const errorType of [
  "authentication",
  "payment_required",
  "permission_denied",
])
  test(`${scope} ${errorType} overrides a simultaneous technical tool failure`, async (t) => {
    const f = fixture(t, {
      completion: (body) => {
        body.error = { metadata: { error_type: errorType } };
        return malfunction(body);
      },
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).provider_error_type, errorType);
  });

test(`${scope} HTTP 403 cannot trigger an approved alternative`, async (t) => {
  const f = fixture(t, {
    completion: () =>
      Response.json(
        { error: { code: 403, message: "Access denied." } },
        { status: 403 },
      ),
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
});

test(`${scope} a substitute with a mismatched actual model remains an identity error`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) => {
      if (attempt === 1) return malfunction(body);
      body.model = "openai/unapproved-model";
      return Response.json(body);
    },
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
});

test(`${scope} rejecting the substitute spending guard stops before its provider dispatch`, async (t) => {
  const f = fixture(t, {
    completion: (body) => malfunction(body),
    before_call: (request) => {
      if (request.model === alternate)
        throw new LiveResearchError(
          "MB-409-ROUND-ALLOWANCE",
          "Approved spending ceiling reached.",
        );
    },
  });
  const error = await failure(f.run());
  assert.equal(error.code, "MB-409-ROUND-ALLOWANCE");
  assert.deepEqual(
    f.guards.map(({ request }) => request.model),
    [primary, alternate],
  );
  assert.deepEqual(
    f.calls.map((request) => request.model),
    [primary],
  );
  assert.equal(f.events.at(-1).dispatched, false);
});

test(`${scope} checkpoint persistence failure never becomes authority to substitute`, async (t) => {
  const f = fixture(t, {
    on_checkpoint: (event) => {
      if (event.state === "completed")
        throw new Error("Mocked checkpoint persistence failure.");
    },
  });
  const error = await failure(f.run());
  assert.equal(error.code, "MB-503-LIVE-CHECKPOINT");
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
});

test(`${scope} caller cancellation after failure prevents any substitute dispatch`, async (t) => {
  const controller = new AbortController();
  const f = fixture(t, {
    signal: controller.signal,
    completion: (body) => malfunction(body),
    on_checkpoint: (event) => {
      if (event.state === "failed")
        controller.abort(new Error("User stopped research."));
    },
  });
  await failure(f.run());
  assert.equal(f.calls.length, 1);
  assert.equal(f.guards.length, 1);
});
