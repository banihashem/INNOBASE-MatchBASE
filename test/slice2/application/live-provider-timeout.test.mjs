import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  callOpenRouterCompletion,
  runLiveCompletion,
  waitForLiveRecovery,
  withLiveStageBudget,
} from "../../../packages/application/dist/openrouter-model-policy.js";

const request = {
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Read-only research deadline fixture." }],
};
function completedResponse(body) {
  return Response.json({
    id: "deadline-fixture-generation",
    model: body.model,
    openrouter_metadata: {
      is_byok: true,
      endpoints: {
        available: [{ selected: true, model: body.model, provider: "OpenAI" }],
      },
    },
    choices: [
      {
        finish_reason: "stop",
        message: {
          content:
            "The retrieved registry supplies no evidence of an eligible supplier.",
          annotations: [
            {
              type: "url_citation",
              url_citation: {
                url: "https://registry.example.com/scope",
                title: "Registry scope",
                content: "No supplier entries.",
              },
            },
          ],
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
}
function providerFixture(t, completion = (body) => completedResponse(body)) {
  const values = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    OPENROUTER_API_KEY: undefined,
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const deadlines = [];
  const calls = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    const controller = new AbortController();
    deadlines.push({ milliseconds, controller });
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [
          {
            id: request.model,
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
    assert.equal(body.timeout_ms, undefined);
    assert.equal(body.request_timeout_ms, undefined);
    calls.push({
      body,
      signal: options.signal,
      deadline: deadlines.at(-1),
      dispatcher: options.dispatcher,
    });
    return completion(body, options.signal, options);
  });
  return { deadlines, calls };
}

test("MB-UX-LIVE-001 L15 transient stage recovery repeats only the failed call with separate audited IDs", async (t) => {
  let count = 0;
  const fixture = providerFixture(t, (body) =>
    ++count < 3
      ? new Response("Temporary service failure", {
          status: count === 1 ? 503 : 429,
        })
      : completedResponse(body),
  );
  const events = [];
  let guards = 0;
  const result = await runLiveCompletion(
    request,
    { phase: "synthesis", loop: 1 },
    {
      automatic_recovery_attempts: 3,
      before_call: async () => {
        guards++;
      },
      on_checkpoint: (event) => events.push(event),
    },
  );
  assert.ok(result.text);
  assert.equal(fixture.calls.length, 3);
  assert.equal(guards, 3);
  assert.equal(new Set(events.map((e) => e.request_id)).size, 3);
  assert.deepEqual(
    events.filter((e) => e.state === "failed").map((e) => e.recovery_scheduled),
    [true, true],
  );
  assert.equal(events.at(-1).recovery_attempt, 3);
  assert.equal(events.at(-1).state, "completed");
});

test("MB-UX-LIVE-001 L15 legacy plans and retry flags without a spending guard never replay calls", async (t) => {
  const fixture = providerFixture(
    t,
    () => new Response("Unavailable", { status: 503 }),
  );
  for (const options of [
    { before_call: async () => {} },
    { automatic_recovery_attempts: 3 },
  ]) {
    await assert.rejects(
      runLiveCompletion(request, { phase: "synthesis", loop: 1 }, options),
      { code: "MB-502-LIVE-PROVIDER" },
    );
  }
  assert.equal(fixture.calls.length, 2);
});

test("MB-UX-LIVE-001 L15 transport and structural retry layers share a three-call stage budget", async (t) => {
  let count = 0;
  const fixture = providerFixture(t, (body) =>
    ++count === 1 || count === 3
      ? new Response("Unavailable", { status: 503 })
      : completedResponse(body),
  );
  const budget = withLiveStageBudget({
    automatic_recovery_attempts: 3,
    before_call: async () => {},
  });
  await runLiveCompletion(
    request,
    { phase: "synthesis", loop: 1 },
    budget.options,
  );
  assert.equal(budget.remaining(), 1);
  // The outer schema validator requests another attempt after the first
  // successful transport returned malformed JSON. Only one call remains.
  await assert.rejects(
    runLiveCompletion(request, { phase: "synthesis", loop: 1 }, budget.options),
    { code: "MB-409-STAGE-ALLOWANCE" },
  );
  assert.equal(budget.remaining(), 0);
  assert.equal(fixture.calls.length, 3);
});

test("MB-UX-LIVE-001 L15 stage budget fences concurrent dispatch and preserves legacy eligibility", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const budget = withLiveStageBudget({ before_call: async () => pending });
  const first = budget.options.before_call(request, false);
  await assert.rejects(budget.options.before_call(request, false), {
    code: "MB-409-STAGE-ALLOWANCE",
  });
  release();
  await first;
  assert.equal(budget.remaining(), 0);
  assert.equal(
    withLiveStageBudget({ automatic_recovery_attempts: 3 }).options.before_call,
    undefined,
  );
});

test("MB-UX-LIVE-001 L15 repeated temporary failure stops at three audited attempts", async (t) => {
  const fixture = providerFixture(
    t,
    () => new Response("Unavailable", { status: 503 }),
  );
  const events = [];
  await assert.rejects(
    runLiveCompletion(
      request,
      { phase: "verification", loop: 2 },
      {
        automatic_recovery_attempts: 99,
        before_call: async () => {},
        on_checkpoint: (event) => events.push(event),
      },
    ),
    { code: "MB-502-LIVE-PROVIDER" },
  );
  assert.equal(fixture.calls.length, 3);
  assert.equal(events.at(-1).recovery_scheduled, false);
  assert.equal(events.at(-1).state, "failed");
  assert.deepEqual(
    events
      .filter((event) => event.state === "failed")
      .map((event) => event.recovery_attempt),
    [1, 2, 3],
  );
});

test("MB-UX-LIVE-001 L15 retry allowance exhaustion cannot send another provider request", async (t) => {
  const fixture = providerFixture(
    t,
    () => new Response("Unavailable", { status: 503 }),
  );
  let attempts = 0;
  await assert.rejects(
    runLiveCompletion(
      request,
      { phase: "synthesis", loop: 1 },
      {
        automatic_recovery_attempts: 3,
        before_call: async () => {
          if (++attempts > 1) throw new Error("Lease or allowance unavailable");
        },
      },
    ),
    { code: "MB-503-LIVE-CHECKPOINT" },
  );
  assert.equal(fixture.calls.length, 1);
});

test("MB-UX-LIVE-001 L15 terminal provider restrictions and refusal are never retried", async (t) => {
  let kind = 0;
  const fixture = providerFixture(t, (body) => {
    if (kind === 0)
      return new Response("Unauthorized API key", { status: 503 });
    if (kind === 1) return new Response("Insufficient credit", { status: 429 });
    if (kind === 2) return new Response("Forbidden", { status: 403 });
    return Response.json({
      id: "refused",
      model: body.model,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [
            { selected: true, model: body.model, provider: "OpenAI" },
          ],
        },
      },
      choices: [{ finish_reason: "content_filter", message: { content: "" } }],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        cost: 0,
        cost_details: { upstream_inference_cost: 0 },
      },
    });
  });
  for (kind = 0; kind < 4; kind++) {
    await assert.rejects(
      runLiveCompletion(
        request,
        { phase: "synthesis", loop: 1 },
        { automatic_recovery_attempts: 3, before_call: async () => {} },
      ),
    );
  }
  assert.equal(fixture.calls.length, 4);
});

test("MB-UX-LIVE-001 L15 cancelling a scheduled retry prevents another paid call", async (t) => {
  const fixture = providerFixture(
    t,
    () => new Response("Unavailable", { status: 503 }),
  );
  const controller = new AbortController();
  await assert.rejects(
    runLiveCompletion(
      request,
      { phase: "synthesis", loop: 1 },
      {
        automatic_recovery_attempts: 3,
        before_call: async () => {},
        signal: controller.signal,
        on_checkpoint: (event) => {
          if (event.state === "failed") controller.abort();
        },
      },
    ),
  );
  assert.equal(fixture.calls.length, 1);
  const waiting = new AbortController();
  const promise = waitForLiveRecovery({ signal: waiting.signal }, 1);
  waiting.abort();
  await assert.rejects(promise);
});

test("MB-UX-LIVE-001 L04 research deadlines are bounded and phase-specific without changing the provider wire format", async (t) => {
  const fixture = providerFixture(t);
  const phases = [
    "step1_translation",
    "step2_advisory",
    "step3_prompt",
    "discovery_gemini",
    "discovery_openai",
    "discovery_deepseek",
    "discovery_anthropic",
    "discovery_xai",
    "discovery_additional_6",
    "verification",
    "discovery_gemini_extraction",
    "discovery_openai_extraction",
    "discovery_deepseek_extraction_index",
    "discovery_deepseek_extraction_batch",
    "discovery_gemini_extraction_recovery",
    "verification_extraction",
    "synthesis",
  ];
  for (const phase of phases) {
    const events = [];
    const expected = phase.startsWith("step") ? 180000 : 600000;
    await runLiveCompletion(
      request,
      { phase, loop: 1 },
      { on_checkpoint: (event) => events.push(event) },
    );
    assert.equal(fixture.calls.at(-1).deadline.milliseconds, expected);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.request_timeout_ms === expected));
    assert.equal(events.at(-1).state, "completed");
  }
  await callOpenRouterCompletion(request);
  assert.equal(fixture.calls.at(-1).deadline.milliseconds, 180000);
  const events = [];
  await runLiveCompletion(
    { ...request, timeout_ms: 45000 },
    { phase: "verification", loop: 2 },
    { on_checkpoint: (event) => events.push(event) },
  );
  assert.equal(fixture.calls.at(-1).deadline.milliseconds, 45000);
  assert.ok(events.every((event) => event.request_timeout_ms === 45000));
  assert.equal(fixture.calls.length, phases.length + 2);
  assert.ok(fixture.calls.every((call) => call.dispatcher.destroyed));
  assert.equal(
    new Set(fixture.calls.map((call) => call.dispatcher)).size,
    phases.length + 2,
  );
});

test("MB-UX-LIVE-001 L04 native completion can finish after the shorter preparation deadline expires", async (t) => {
  const pending = [];
  let announceReady;
  const ready = new Promise((resolve) => {
    announceReady = resolve;
  });
  const fixture = providerFixture(
    t,
    (body, signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        pending.push({ body, signal, resolve });
        if (pending.length === 2) announceReady();
      }),
  );
  const preparation = runLiveCompletion(request, {
    phase: "step1_translation",
    loop: 1,
  }).then(
    () => assert.fail("Preparation should expire at its own deadline."),
    (error) => error,
  );
  const events = [];
  const research = runLiveCompletion(
    request,
    { phase: "discovery_openai", loop: 1, require_web: true },
    { on_checkpoint: (event) => events.push(event) },
  );
  await ready;
  fixture.deadlines
    .find((entry) => entry.milliseconds === 180000)
    .controller.abort(
      new DOMException("Fixture preparation deadline", "TimeoutError"),
    );
  const expired = await preparation;
  assert.equal(expired.code, "MB-503-LIVE-TRANSPORT");
  assert.match(expired.message, /exceeded the 180000 ms timeout/);
  const native = pending.find(
    (entry) => entry.body.plugins?.[0]?.engine === "native",
  );
  assert.equal(native.signal.aborted, false);
  native.resolve(completedResponse(native.body));
  const result = await research;
  assert.equal(result.is_byok, true);
  assert.equal(result.citations.length, 1);
  assert.equal(events.at(-1).state, "completed");
  assert.equal(events.at(-1).request_timeout_ms, 600000);
  assert.equal(fixture.calls.length, 2);
});

test("MB-UX-LIVE-001 L04 scoped dispatcher works with native fetch and controls actual header and body deadlines", async (t) => {
  const nativeFetch = globalThis.fetch;
  const wireBody = await completedResponse(request).text();
  let mode = "success";
  const server = createServer((_request, response) => {
    if (mode === "body") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
    }
    const timer = setTimeout(
      () => response.end(wireBody),
      mode === "success" ? 10 : 1500,
    );
    response.on("close", () => clearTimeout(timer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  const fixture = providerFixture(t, (_body, _signal, options) =>
    nativeFetch(url, options),
  );
  const result = await callOpenRouterCompletion({
    ...request,
    timeout_ms: 600000,
  });
  assert.equal(result.is_byok, true);
  for (const stalled of ["headers", "body"]) {
    mode = stalled;
    await assert.rejects(
      callOpenRouterCompletion({ ...request, timeout_ms: 25 }),
      (error) => {
        assert.equal(error.code, "MB-503-LIVE-TRANSPORT");
        assert.match(error.message, /exceeded the 25 ms timeout/);
        return true;
      },
    );
    assert.equal(fixture.calls.at(-1).signal.aborted, false);
  }
  assert.equal(fixture.calls.length, 3);
  assert.ok(fixture.calls.every((call) => call.dispatcher.destroyed));
});

test("MB-UX-LIVE-001 L04 research expiry emits its actual deadline and does not retry automatically", async (t) => {
  let fixture;
  fixture = providerFixture(
    t,
    (_body, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        queueMicrotask(() =>
          fixture.deadlines
            .find((entry) => entry.milliseconds === 600000)
            .controller.abort(
              new DOMException("Sensitive timeout details", "TimeoutError"),
            ),
        );
      }),
  );
  const events = [];
  await assert.rejects(
    runLiveCompletion(
      request,
      { phase: "discovery_openai_extraction", loop: 1 },
      { on_checkpoint: (event) => events.push(event) },
    ),
    (error) => {
      assert.equal(error.code, "MB-503-LIVE-TRANSPORT");
      assert.equal(error.retryable, true);
      assert.match(error.message, /exceeded the 600000 ms timeout/);
      assert.ok(!error.message.includes("Sensitive"));
      return true;
    },
  );
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(
    events.map((event) => event.state),
    ["started", "failed"],
  );
  assert.ok(events.every((event) => event.request_timeout_ms === 600000));
  assert.equal(events[1].request_id, events[0].request_id);
  assert.match(events[1].error, /600000 ms timeout/);
});

test("MB-UX-LIVE-001 L04 either caller signal cancels research with a distinct safe diagnostic", async (t) => {
  let activeController;
  const fixture = providerFixture(
    t,
    (_body, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        queueMicrotask(() =>
          activeController.abort("Private caller cancellation reason"),
        );
      }),
  );
  for (const source of ["request", "options"]) {
    const requestController = new AbortController();
    const optionsController = new AbortController();
    activeController =
      source === "request" ? requestController : optionsController;
    const events = [];
    await assert.rejects(
      runLiveCompletion(
        { ...request, signal: requestController.signal },
        { phase: "verification", loop: 3 },
        {
          signal: optionsController.signal,
          on_checkpoint: (event) => events.push(event),
        },
      ),
      (error) => {
        assert.equal(error.code, "MB-503-LIVE-TRANSPORT");
        assert.equal(error.retryable, false);
        assert.match(error.message, /cancelled by caller/);
        assert.ok(!error.message.includes("Private"));
        assert.ok(!error.message.includes("timed out"));
        return true;
      },
    );
    assert.equal(events.at(-1).state, "failed");
    assert.equal(events.at(-1).request_timeout_ms, 600000);
    assert.equal(
      fixture.deadlines.filter((entry) => entry.milliseconds === 600000).at(-1)
        .controller.signal.aborted,
      false,
    );
  }
  assert.equal(fixture.calls.length, 2);
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort("Private preflight reason");
  await assert.rejects(
    callOpenRouterCompletion({ ...request, signal: alreadyCancelled.signal }),
    /cancelled by caller/,
  );
  assert.equal(fixture.calls.length, 2);
});

test("MB-UX-LIVE-001 L04 invalid timeout overrides are rejected before a provider request", async (t) => {
  const fixture = providerFixture(t);
  for (const timeout_ms of [
    0,
    -1,
    0.5,
    600001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    "600000",
  ]) {
    await assert.rejects(
      callOpenRouterCompletion({ ...request, timeout_ms }),
      (error) => error.code === "MB-422-LIVE-TIMEOUT",
    );
    const events = [];
    await assert.rejects(
      runLiveCompletion(
        { ...request, timeout_ms },
        { phase: "verification", loop: 1 },
        { on_checkpoint: (event) => events.push(event) },
      ),
      (error) => error.code === "MB-422-LIVE-TIMEOUT",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].state, "failed");
  }
  assert.equal(fixture.calls.length, 0);
  for (const timeout_ms of [1, 600000])
    await callOpenRouterCompletion({ ...request, timeout_ms });
  assert.equal(fixture.calls.length, 2);
});
test("MB-UX-LIVE-001 L07 retains finish and reasoning counts when provider exhausts output budget", async (t) => {
  providerFixture(t, (body) => {
    const response = completedResponse(body);
    return response.json().then((data) => {
      data.choices[0].finish_reason = "length";
      data.usage.completion_tokens = 24000;
      data.usage.completion_tokens_details = { reasoning_tokens: 21000 };
      return Response.json(data);
    });
  });
  const events = [];
  await assert.rejects(
    runLiveCompletion(
      { ...request, max_tokens: 24000 },
      {
        phase: "verification_extraction_index",
        loop: 2,
        reasoning_effort: "low",
      },
      { on_checkpoint: (event) => events.push(event) },
    ),
    (error) => error.code === "MB-422-LIVE-OUTPUT-LIMIT",
  );
  const failed = events.at(-1);
  assert.equal(failed.state, "failed");
  assert.equal(failed.finish_reason, "length");
  assert.equal(failed.reasoning_tokens, 21000);
  assert.equal(failed.output_tokens, 24000);
  assert.equal(failed.reasoning_effort, "low");
  assert.equal(failed.is_byok, true);
});
