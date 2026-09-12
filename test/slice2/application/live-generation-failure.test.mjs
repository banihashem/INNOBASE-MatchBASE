import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  callOpenRouterCompletion,
  runLiveCompletion,
} from "../../../packages/application/dist/openrouter-model-policy.js";

const scope = "MB-UX-QUALITY-001 L08";
const redactedMarker = "private-provider-payload-must-not-be-retained";
const parameters = ["max_tokens", "reasoning", "structured_outputs"];

function fixture(t, settings = {}) {
  const credit = settings.credit === true;
  const model = credit ? "deepseek/deepseek-v3.2" : "google/gemini-3.8-flash";
  const provider = credit ? "novita" : "google-ai-studio";
  const providerName = credit ? "NovitaAI" : "Google AI Studio";
  const names = Object.keys(process.env).filter((name) =>
    /^(?:MATCHBASE_|OPENROUTER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS)$)/.test(
      name,
    ),
  );
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  t.after(() => {
    delete process.env.MATCHBASE_OPENROUTER_API_KEY;
    delete process.env.MATCHBASE_PROVIDER_GOOGLE;
    for (const [name, value] of Object.entries(previous))
      process.env[name] = value;
  });
  const calls = [];
  const reads = [];
  const events = [];
  const guards = [];
  const rate = {
    model,
    provider,
    provider_display_name: providerName,
    billing_mode: "openrouter_credits",
    input_usd_per_token: 0.000001,
    output_usd_per_token: 0.000002,
    request_usd: 0,
    web_search_usd: 0,
    reasoning: true,
    source_url: `https://openrouter.ai/api/v1/models/${model}/endpoints`,
  };
  const completed = (attempt) => ({
    id: `gen-failure-fixture-${attempt}`,
    model,
    provider: providerName,
    openrouter_metadata: {
      is_byok: !credit,
      endpoints: {
        available: [{ selected: true, model, provider: providerName }],
      },
    },
    choices: [
      {
        finish_reason: "stop",
        message: { content: "A supplier lead requires further verification." },
      },
    ],
    usage: {
      prompt_tokens: attempt * 10,
      completion_tokens: attempt * 20,
      cost: attempt * 0.01,
      ...(!credit
        ? { cost_details: { upstream_inference_cost: attempt * 0.02 } }
        : {}),
    },
  });
  const metadata = (id) => ({
    id,
    model,
    provider_name: providerName,
    is_byok: !credit,
    total_cost: 0.01,
    ...(!credit ? { upstream_inference_cost: 0.02 } : {}),
    finish_reason: "error",
    native_finish_reason: "RECITATION",
  });
  t.mock.method(globalThis, "fetch", async (target, options = {}) => {
    const url = new URL(String(target));
    assert.equal(url.origin, "https://openrouter.ai");
    if (url.pathname === "/api/v1/models/user") {
      assert.equal(options.method ?? "GET", "GET");
      return Response.json({
        data: [{ id: model, supported_parameters: parameters }],
      });
    }
    if (url.pathname === "/api/v1/endpoints/zdr") {
      assert.equal(options.method ?? "GET", "GET");
      return Response.json({ data: [{ model_id: model, tag: provider }] });
    }
    if (url.pathname === `/api/v1/models/${model}/endpoints`) {
      assert.equal(options.method ?? "GET", "GET");
      return Response.json({
        data: {
          endpoints: [
            {
              tag: provider,
              model_id: model,
              name: `${providerName} | ${model}`,
              provider_name: providerName,
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
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      const id = url.searchParams.get("id");
      assert.ok(calls.some((call) => call.generation_id === id));
      reads.push(id);
      return settings.generation
        ? settings.generation(metadata(id), options)
        : Response.json({ data: metadata(id) });
    }
    assert.equal(url.pathname, "/api/v1/chat/completions");
    assert.equal(options.method, "POST");
    const request = JSON.parse(options.body);
    const response = completed(calls.length + 1);
    calls.push({ request, generation_id: response.id });
    return settings.completion
      ? settings.completion(response, calls.length)
      : Response.json(response);
  });
  const request = {
    model,
    messages: [
      { role: "user", content: "Find independently evidenced leads." },
    ],
    ...(credit ? { approved_rate: rate } : {}),
  };
  const options = {
    automatic_recovery_attempts: 3,
    ...(credit ? { approved_rates: [rate] } : {}),
    before_call: async (call) => guards.push(call.model),
    on_checkpoint: (event) => events.push(event),
  };
  return {
    calls,
    reads,
    events,
    guards,
    model,
    provider,
    request,
    options,
    run: () =>
      runLiveCompletion(
        request,
        { phase: credit ? "discovery_deepseek" : "discovery_gemini", loop: 1 },
        options,
      ),
  };
}

function failedGeneration(body, error, placement = "top") {
  body.choices[0].finish_reason = "error";
  if (placement === "choice") body.choices[0].error = error;
  else body.error = error;
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

function assertNoRawDiagnostics(error, events) {
  const retained = JSON.stringify({
    message: error?.message,
    response: error?.audited_response,
    provider_failure: error?.provider_failure,
    events,
  });
  assert.equal(retained.includes(redactedMarker), false);
}

test(`${scope} a typed transient generation error retries only its model with a separate guard, charge and checkpoint per attempt`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) =>
      attempt < 3
        ? failedGeneration(body, {
            metadata: {
              error_type:
                attempt === 1 ? "provider_overloaded" : "rate_limit_exceeded",
              raw: redactedMarker,
            },
            message: redactedMarker,
          })
        : Response.json(body),
  });
  const result = await f.run();
  assert.ok(result.text);
  assert.deepEqual(f.guards, [f.model, f.model, f.model]);
  assert.equal(f.calls.length, 3);
  assert.equal(f.reads.length, 0);
  for (const { request } of f.calls) {
    assert.equal(request.model, f.model);
    assert.deepEqual(request.provider.only, [f.provider]);
    assert.equal(request.provider.allow_fallbacks, false);
  }
  const terminal = f.events.filter((event) => event.state !== "started");
  assert.equal(terminal.length, 3);
  assert.equal(new Set(terminal.map((event) => event.request_id)).size, 3);
  assert.equal(
    new Set(terminal.map((event) => event.provider_generation_id)).size,
    3,
  );
  assert.deepEqual(
    terminal.map((event) => event.recovery_attempt),
    [1, 2, 3],
  );
  assert.deepEqual(
    terminal.map((event) => event.recovery_scheduled),
    [true, true, false],
  );
  assert.deepEqual(
    terminal.map((event) => event.cost_usd),
    [0.01, 0.02, 0.03],
  );
  assert.deepEqual(
    terminal.map((event) => event.output_tokens),
    [20, 40, 60],
  );
  assert.deepEqual(
    terminal.map((event) => event.is_byok),
    [true, true, true],
  );
  assert.deepEqual(
    terminal.slice(0, 2).map((event) => event.response_failure_kind),
    ["provider_error", "provider_error"],
  );
  assert.deepEqual(
    terminal.slice(0, 2).map((event) => event.provider_error_type),
    ["provider_overloaded", "rate_limit_exceeded"],
  );
  assertNoRawDiagnostics(undefined, f.events);
});

test(`${scope} repeated typed transient errors stop at the approved three attempts`, async (t) => {
  const f = fixture(t, {
    completion: (body) =>
      failedGeneration(body, {
        metadata: { error_type: "provider_unavailable" },
      }),
  });
  f.options.automatic_recovery_attempts = 99;
  const error = await failure(f.run());
  assert.equal(error.retryable, true);
  assert.equal(f.calls.length, 3);
  assert.equal(f.guards.length, 3);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
  assert.equal(f.events.at(-1).response_failure_kind, "provider_error");
});

test(`${scope} choice-level transient errors retain approved credit accounting and retry eligibility`, async (t) => {
  const f = fixture(t, {
    credit: true,
    completion: (body, attempt) =>
      attempt === 1
        ? failedGeneration(
            body,
            { metadata: { error_type: "provider_overloaded" } },
            "choice",
          )
        : Response.json(body),
  });
  const result = await f.run();
  assert.equal(f.calls.length, 2);
  assert.equal(f.reads.length, 0);
  assert.equal(result.is_byok, false);
  assert.equal(result.cost_usd, 0.02);
  const failed = f.events.find((event) => event.state === "failed");
  assert.equal(failed.response_failure_kind, "provider_error");
  assert.equal(failed.provider_error_type, "provider_overloaded");
  assert.equal(failed.approved_billing_mode, "openrouter_credits");
  assert.equal(failed.is_byok, false);
  assert.equal(failed.cost_usd, 0.01);
  assert.equal(failed.upstream_inference_cost, null);
});

test(`${scope} missing spending guard prevents replay of a typed transient generation error`, async (t) => {
  const f = fixture(t, {
    completion: (body) =>
      failedGeneration(body, {
        metadata: { error_type: "provider_overloaded" },
      }),
  });
  delete f.options.before_call;
  await failure(f.run());
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
});

for (const [errorType, expectedKind] of [
  ["authentication", "incomplete_response"],
  ["permission_denied", "incomplete_response"],
  ["payment_required", "incomplete_response"],
  ["content_policy_violation", "refusal"],
  ["refusal", "refusal"],
])
  test(`${scope} typed ${errorType} wins over an embedded HTTP500 and is never replayed`, async (t) => {
    const f = fixture(t, {
      completion: (body) =>
        failedGeneration(body, {
          code: 500,
          metadata: { error_type: errorType, raw: redactedMarker },
          message: redactedMarker,
        }),
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.guards.length, 1);
    assert.equal(f.events.at(-1).response_failure_kind, expectedKind);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
    assertNoRawDiagnostics(error, f.events);
  });

for (const errorType of [
  "authentication",
  "payment_required",
  "content_policy_violation",
])
  test(`${scope} an HTTP500 transport envelope with typed ${errorType} remains terminal`, async (t) => {
    const f = fixture(t, {
      completion: () =>
        Response.json(
          {
            error: {
              code: 500,
              message: redactedMarker,
              metadata: { error_type: errorType, raw: redactedMarker },
            },
          },
          { status: 500 },
        ),
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reads.length, 0);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
    assertNoRawDiagnostics(error, f.events);
  });

for (const placement of ["top", "choice"])
  test(`${scope} terminal ${placement} diagnostics defeat a transient sibling diagnostic`, async (t) => {
    const f = fixture(t, {
      completion: (body) => {
        const transient = { code: 503, metadata: { error_type: "server" } };
        const terminal = {
          code: 500,
          metadata: { error_type: "authentication" },
        };
        body.error = placement === "top" ? terminal : transient;
        body.choices[0].error = placement === "choice" ? terminal : transient;
        body.choices[0].finish_reason = "error";
        return Response.json(body);
      },
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).response_failure_kind, "incomplete_response");
    assert.equal(f.events.at(-1).provider_error_type, "authentication");
  });

test(`${scope} a message refusal cannot be retried as an empty generation`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].message = { content: "", refusal: redactedMarker };
      return Response.json(body);
    },
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 0);
  assert.equal(f.events.at(-1).response_failure_kind, "refusal");
  assertNoRawDiagnostics(error, f.events);
});

test(`${scope} a true empty completed generation retains cost before bounded recovery`, async (t) => {
  const f = fixture(t, {
    completion: (body, attempt) => {
      if (attempt === 1) body.choices[0].message.content = "   ";
      return Response.json(body);
    },
  });
  await f.run();
  const failed = f.events.find((event) => event.state === "failed");
  assert.equal(f.calls.length, 2);
  assert.equal(f.reads.length, 0);
  assert.equal(failed.response_failure_kind, "empty_response");
  assert.equal(failed.cost_usd, 0.01);
  assert.equal(failed.recovery_scheduled, true);
});

test(`${scope} native cancellation cannot be reclassified as output allowance exhaustion`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].finish_reason = "length";
      body.choices[0].native_finish_reason = "CANCELLED";
      return Response.json(body);
    },
  });
  const error = await failure(f.run());
  assert.equal(error.code, "MB-502-LIVE-RESPONSE");
  assert.equal(error.retryable, false);
  assert.equal(
    error.audited_response.response_failure_kind,
    "incomplete_response",
  );
  assert.equal(f.calls.length, 1);
});

test(`${scope} native RECITATION is retained as a refusal without metadata reads or billed retry`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].finish_reason = "error";
      body.choices[0].native_finish_reason = "RECITATION";
      return Response.json(body);
    },
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 0);
  assert.equal(error.audited_response.native_finish_reason, "RECITATION");
  assert.equal(error.audited_response.response_failure_kind, "refusal");
  assert.equal(error.audited_response.provider_error_type, "recitation");
  assert.equal(f.events.at(-1).native_finish_reason, "RECITATION");
  assert.equal(f.events.at(-1).response_failure_kind, "refusal");
  assert.equal(f.events.at(-1).provider_error_type, "recitation");
  assert.equal(f.events.at(-1).recovery_scheduled, false);
  assert.equal(
    f.events.at(-1).response_content,
    "A supplier lead requires further verification.",
  );
  assert.equal(f.events.at(-1).upstream_inference_cost, 0.02);
});

test(`${scope} an opaque finish error reads its own generation once and retains RECITATION without replay`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].finish_reason = "error";
      return Response.json(body);
    },
    generation: (metadata) =>
      Response.json({
        data: {
          ...metadata,
          message: redactedMarker,
          metadata: { raw: redactedMarker },
        },
      }),
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.deepEqual(f.reads, [f.calls[0].generation_id]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).native_finish_reason, "RECITATION");
  assert.equal(f.events.at(-1).response_failure_kind, "refusal");
  assert.equal(f.events.at(-1).is_byok, true);
  assertNoRawDiagnostics(error, f.events);
});

test(`${scope} explicit policy or permission blocks cannot become recitation-only continuation`, async (t) => {
  for (const errorType of [
    "content_policy_violation",
    "permission_denied",
    "rate_limit_exceeded",
  ]) {
    const f = fixture(t, {
      completion: (body) => {
        body.choices[0].finish_reason = "error";
        body.choices[0].native_finish_reason = "RECITATION";
        body.choices[0].error = {
          code: 403,
          metadata: { error_type: errorType },
        };
        return Response.json(body);
      },
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.notEqual(error.audited_response.provider_error_type, "recitation");
    assert.equal(f.calls.length, 1);
    assert.doesNotMatch(error.message, /stopped this response for recitation/);
  }
});

for (const [field, value] of [
  ["id", "gen-unrelated-request"],
  ["model", "google/unapproved-model"],
  ["provider_name", "OpenAI"],
  ["is_byok", false],
])
  test(`${scope} ${field} drift in diagnostic generation metadata stops recovery`, async (t) => {
    const f = fixture(t, {
      completion: (body) => {
        body.choices[0].finish_reason = "error";
        return Response.json(body);
      },
      generation: (metadata) =>
        Response.json({ data: { ...metadata, [field]: value } }),
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.match(
      error.code,
      /^MB-502-LIVE-(?:PROVIDER-DRIFT|BYOK-REQUIRED|BILLING-DRIFT)$/,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.reads.length, 1);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
  });

for (const [name, generation] of [
  ["HTTP404", () => new Response("Not available", { status: 404 })],
  ["HTTP503", () => new Response("Unavailable", { status: 503 })],
  [
    "transport rejection",
    () => {
      throw new TypeError(redactedMarker);
    },
  ],
])
  test(`${scope} ${name} diagnostic metadata cannot authorize automatic paid replay`, async (t) => {
    const f = fixture(t, {
      completion: (body) => {
        body.choices[0].finish_reason = "error";
        return Response.json(body);
      },
      generation,
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reads.length, 1);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
    assertNoRawDiagnostics(error, f.events);
  });

for (const [name, diagnostic] of [
  [
    "error type despite HTTP500",
    { metadata: { error_type: redactedMarker }, code: 500 },
  ],
  ["text code", { code: redactedMarker }],
  ["category", { category: redactedMarker }],
  ["numeric code", { code: 999, message: "Please retry " + redactedMarker }],
])
  test(`${scope} an unknown ${name} fails closed and is sanitized`, async (t) => {
    const f = fixture(t, {
      completion: (body) => failedGeneration(body, diagnostic),
      generation: (metadata) =>
        Response.json({ data: { ...metadata, native_finish_reason: "OTHER" } }),
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).response_failure_kind, "incomplete_response");
    assert.equal(f.events.at(-1).provider_error_type, "unknown");
    assert.equal(f.events.at(-1).recovery_scheduled, false);
    assertNoRawDiagnostics(error, f.events);
  });

test(`${scope} unknown native finish values are not retained or interpreted as permission to retry`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].finish_reason = "error";
      body.choices[0].native_finish_reason = redactedMarker;
      return Response.json(body);
    },
    generation: (metadata) =>
      Response.json({
        data: { ...metadata, native_finish_reason: redactedMarker },
      }),
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assertNoRawDiagnostics(error, f.events);
});

test(`${scope} successful audited calls do not add diagnostic generation traffic`, async (t) => {
  const f = fixture(t);
  const result = await callOpenRouterCompletion(f.request);
  assert.equal(result.is_byok, true);
  assert.equal(result.finish_reason, "stop");
  assert.equal(result.response_failure_kind, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 0);
});

for (const errorType of ["server", "timeout"])
  test(`${scope} typed ${errorType} is a transient audited provider failure`, async (t) => {
    const f = fixture(t, {
      completion: (body) =>
        failedGeneration(body, { metadata: { error_type: errorType } }),
    });
    const error = await failure(callOpenRouterCompletion(f.request));
    assert.equal(error.retryable, true);
    assert.equal(
      error.audited_response.response_failure_kind,
      "provider_error",
    );
    assert.equal(error.audited_response.provider_error_type, errorType);
    assert.equal(error.audited_response.cost_usd, 0.01);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reads.length, 0);
  });

test(`${scope} caller cancellation during diagnostic lookup never schedules a billed retry`, async (t) => {
  const controller = new AbortController();
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].finish_reason = "error";
      return Response.json(body);
    },
    generation: () => {
      controller.abort(new Error(redactedMarker));
      throw controller.signal.reason;
    },
  });
  f.request.signal = controller.signal;
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
  assertNoRawDiagnostics(error, f.events);
});

test(`${scope} typed authentication takes priority over RECITATION and cannot authorize partial-result recovery`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].native_finish_reason = "RECITATION";
      return failedGeneration(body, {
        metadata: { error_type: "authentication" },
      });
    },
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 0);
  assert.equal(f.events.at(-1).response_failure_kind, "incomplete_response");
  assert.equal(f.events.at(-1).provider_error_type, "authentication");
});

test(`${scope} native cancellation takes priority over message refusal`, async (t) => {
  const f = fixture(t, {
    completion: (body) => {
      body.choices[0].finish_reason = "error";
      body.choices[0].native_finish_reason = "CANCELLED";
      body.choices[0].message.refusal = redactedMarker;
      return Response.json(body);
    },
  });
  const error = await failure(f.run());
  assert.equal(error.retryable, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reads.length, 0);
  assert.equal(f.events.at(-1).native_finish_reason, "CANCELLED");
  assert.equal(f.events.at(-1).response_failure_kind, "incomplete_response");
  assertNoRawDiagnostics(error, f.events);
});

for (const nativeReason of ["MAX_TOKENS", "OTHER"])
  test(`${scope} normalized stop cannot hide the native ${nativeReason} incomplete state`, async (t) => {
    const f = fixture(t, {
      completion: (body) => {
        body.choices[0].native_finish_reason = nativeReason;
        return Response.json(body);
      },
    });
    const error = await failure(f.run());
    assert.equal(error.retryable, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reads.length, 0);
    assert.equal(f.events.at(-1).native_finish_reason, nativeReason);
    assert.equal(f.events.at(-1).response_failure_kind, "incomplete_response");
  });
