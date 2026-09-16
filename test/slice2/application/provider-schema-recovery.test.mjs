import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  runLiveCompletion,
  selectApprovedStructuredRecovery,
  withLiveStageBudget,
} from "../../../packages/application/dist/openrouter-model-policy.js";
import { classifyProviderHttpFailure } from "../../../packages/application/dist/provider-http-failure.js";

const scope = "MB-UX-QUALITY-001 L12";
const primary = "google/gemini-3.8-flash";
const alternate = "openai/gpt-5.2";
const schema = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};
const schemaError =
  "The input schema is too complex for serving. private-response-sentinel";
const errorBody = (message) => ({
  error: {
    code: 400,
    message: "Provider returned error",
    metadata: {
      provider_name: "Google AI Studio",
      is_byok: true,
      raw: JSON.stringify({
        error: { code: 400, message, status: "INVALID_ARGUMENT" },
      }),
    },
  },
});
const runtimeName = (name) =>
  /^(?:MATCHBASE_|OPENROUTER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS)$|OPENAI_API_KEY$|GOOGLE_API_KEY$|GEMINI_API_KEY$)/.test(
    name,
  );

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
  const providers = {
    [primary]: { tag: "google-ai-studio", name: "Google AI Studio" },
    [alternate]: { tag: "openai", name: "OpenAI" },
  };
  const rates = Object.entries(providers).map(([model, provider]) => ({
    model,
    provider: provider.tag,
    provider_display_name: provider.name,
    billing_mode:
      model === alternate && settings.crossBilling
        ? "openrouter_credits"
        : "byok",
    input_usd_per_token: 0.000001,
    output_usd_per_token: 0.000002,
    request_usd: 0,
    web_search_usd: 0,
    reasoning: true,
    structured_outputs: true,
    source_url: `https://openrouter.ai/api/v1/models/${model}/endpoints`,
  }));
  const calls = [],
    events = [],
    guards = [];
  const parameters = ["max_tokens", "structured_outputs", "reasoning"];
  t.mock.method(globalThis, "fetch", async (target, options = {}) => {
    const url = new URL(String(target));
    assert.equal(
      url.origin,
      "https://openrouter.ai",
      "No real or unmocked endpoint is allowed",
    );
    if (url.pathname === "/api/v1/models/user")
      return Response.json({
        data: Object.keys(providers).map((id) => ({
          id,
          supported_parameters: parameters,
        })),
      });
    for (const [model, provider] of Object.entries(providers))
      if (url.pathname === `/api/v1/models/${model}/endpoints`)
        return Response.json({
          data: {
            endpoints: [
              {
                tag: provider.tag,
                model_id: model,
                provider_name: provider.name,
                name: `${provider.name} | ${model}`,
                status: 0,
                supported_parameters: parameters,
              },
            ],
          },
        });
    assert.equal(url.pathname, "/api/v1/chat/completions");
    assert.equal(options.method, "POST");
    const request = JSON.parse(options.body);
    calls.push(request);
    if (calls.length === 1 || settings.alternateFails)
      return Response.json(
        settings.body ?? errorBody(settings.message ?? schemaError),
        {
          status: settings.status ?? 400,
        },
      );
    assert.equal(calls.length, 2, "Only the one approved alternative may run");
    const provider = providers[request.model];
    return Response.json({
      id: `schema-recovery-${calls.length}`,
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
          message: { content: '{"summary":"Evidence-focused plan"}' },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        cost: 0,
        cost_details: { upstream_inference_cost: 0.001 },
      },
    });
  });
  const budget = withLiveStageBudget({
    automatic_recovery_attempts: settings.attempts ?? 3,
    approved_rates: rates,
    approved_model_fallbacks: settings.noAlternative
      ? {}
      : { [primary]: [alternate] },
    before_call: async (request, web) => guards.push([request.model, web]),
    on_checkpoint: async (event) => {
      events.push(event);
      await settings.onCheckpoint?.(event);
    },
    ...(settings.signal ? { signal: settings.signal } : {}),
  });
  const request = {
    model: primary,
    messages: [
      {
        role: "user",
        content: "Create a research plan from synthetic saved references.",
      },
    ],
    ...(settings.textRequest
      ? {}
      : {
          response_format: {
            type: "json_schema",
            json_schema: { name: "research_focus_plan", strict: true, schema },
          },
        }),
    max_tokens: 500,
  };
  const context = {
    phase: "research_focus_analysis",
    loop: 3,
    max_loops: 5,
    require_web: false,
  };
  return {
    calls,
    events,
    guards,
    budget,
    request,
    context,
    run: (options = budget.options) =>
      runLiveCompletion(request, context, options),
  };
}

test(`${scope} explicit Gemini schema rejection uses only its approved same-billing alternative`, async (t) => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.model, alternate);
  assert.equal(result.is_byok, true);
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, alternate],
  );
  assert.deepEqual(f.guards, [
    [primary, false],
    [alternate, false],
  ]);
  assert.equal(f.budget.remaining(), 1);
  assert.deepEqual(f.calls[1].provider.only, ["openai"]);
  assert.equal(f.calls[1].provider.allow_fallbacks, false);
  assert.equal(f.calls[1].plugins, undefined);
  const failed = f.events.find((event) => event.state === "failed");
  assert.deepEqual(failed.provider_http_failure, {
    http_status: 400,
    request_format: "json_schema",
    category: "schema_compatibility",
    schema_issue: "complexity",
  });
  assert.equal(failed.recovery_scheduled, true);
  assert.equal(failed.recovery_next_model, alternate);
  assert.equal(
    failed.request_schema_sha256,
    createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
  );
  assert.equal(
    failed.request_schema_bytes,
    Buffer.byteLength(JSON.stringify(schema)),
  );
  assert.doesNotMatch(
    JSON.stringify(f.events),
    /private-response-sentinel|INVALID_ARGUMENT/,
  );
});

test(`${scope} an outer focus owner performs one dispatch then selects the same bounded recovery`, async (t) => {
  const f = fixture(t);
  let caught;
  await assert.rejects(
    f.run({ ...f.budget.options, automatic_recovery_attempts: 1 }),
    (error) => {
      caught = error;
      return true;
    },
  );
  assert.equal(f.calls.length, 1);
  assert.deepEqual(
    selectApprovedStructuredRecovery(primary, caught, f.budget.options),
    {
      original_model: primary,
      next_model: alternate,
    },
  );
  const result = await f.run({
    ...f.budget.options,
    automatic_recovery_attempts: 1,
  });
  assert.equal(result.model, alternate);
  assert.equal(f.calls.length, 2);
  assert.equal(f.budget.remaining(), 1);
});

for (const [name, settings, category] of [
  ["generic HTTP400", { message: "Provider rejected the request" }, "unknown"],
  [
    "structured schema words in a text request",
    { textRequest: true },
    "unknown",
  ],
  [
    "missing approved alternative",
    { noAlternative: true },
    "schema_compatibility",
  ],
  ["cross-billing alternative", { crossBilling: true }, "schema_compatibility"],
  ["exhausted stage", { attempts: 1 }, "schema_compatibility"],
  [
    "authentication before schema",
    { message: `API key invalid. ${schemaError}` },
    "authentication",
  ],
  [
    "permission before schema",
    { message: `Permission denied. ${schemaError}` },
    "permission",
  ],
  [
    "billing before schema",
    { message: `Insufficient credits. ${schemaError}` },
    "billing",
  ],
  [
    "refusal before schema",
    { message: `Safety refusal. ${schemaError}` },
    "refusal",
  ],
  [
    "context limit before schema",
    { message: `Maximum context length exceeded. ${schemaError}` },
    "context_limit",
  ],
  ["HTTP403 before schema", { status: 403 }, "permission"],
]) {
  test(`${scope} ${name} remains terminal without blind retry`, async (t) => {
    const f = fixture(t, settings);
    await assert.rejects(f.run(), (error) => {
      assert.equal(error.retryable, false);
      assert.equal(error.provider_http_failure.category, category);
      assert.doesNotMatch(
        JSON.stringify(error),
        /private-response-sentinel|INVALID_ARGUMENT/,
      );
      return true;
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
  });
}

test(`${scope} a second schema rejection cannot extend or repeat the approved alternative`, async (t) => {
  const f = fixture(t, { alternateFails: true });
  await assert.rejects(f.run(), /structured-output schema/);
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary, alternate],
  );
  assert.equal(f.budget.remaining(), 1);
  assert.equal(f.events.at(-1).recovery_scheduled, false);
});

for (const [message, issue] of [
  ["response_schema has too many states for serving", "complexity"],
  ["Schema keyword maxLength is not supported", "unsupported_feature"],
  ["Invalid JSON schema for response_format", "invalid_schema"],
  [
    "Invalid JSON payload received. Unknown name maxLength at response_schema.properties: Cannot find field.",
    "unsupported_feature",
  ],
]) {
  test(`${scope} diagnostic retains the controlled ${issue} reason only`, () => {
    const diagnostic = classifyProviderHttpFailure(
      JSON.stringify(errorBody(message)),
      400,
      "json_schema",
    );
    assert.equal(diagnostic.category, "schema_compatibility");
    assert.equal(diagnostic.schema_issue, issue);
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      "category",
      "http_status",
      "request_format",
      "schema_issue",
    ]);
  });
}

test(`${scope} raw text and echoed request fields do not establish schema compatibility`, () => {
  for (const body of [
    schemaError,
    JSON.stringify({
      error: {
        message: "Bad request",
        request: { messages: [{ content: schemaError }] },
      },
    }),
  ])
    assert.equal(
      classifyProviderHttpFailure(body, 400, "json_schema").category,
      "unknown",
    );
});

for (const [typed, category] of [
  ["UNAUTHENTICATED", "authentication"],
  ["PERMISSION_DENIED", "permission"],
  ["INSUFFICIENT_CREDITS", "billing"],
  ["CONTENT_POLICY_VIOLATION", "refusal"],
]) {
  test(`${scope} typed ${typed} metadata takes precedence over a schema message`, () => {
    for (const key of ["error_type", "provider_code", "error_code"]) {
      const body = errorBody(schemaError);
      body.error.metadata[key] = typed;
      assert.equal(
        classifyProviderHttpFailure(JSON.stringify(body), 400, "json_schema")
          .category,
        category,
      );
    }
    for (const key of ["code", "type", "status"]) {
      const body = errorBody(schemaError);
      body.error.metadata.raw = JSON.stringify({
        error: { message: schemaError, [key]: typed },
      });
      assert.equal(
        classifyProviderHttpFailure(JSON.stringify(body), 400, "json_schema")
          .category,
        category,
      );
    }
  });
}

test(`${scope} HTTP413 cannot become schema recovery`, () => {
  assert.equal(
    classifyProviderHttpFailure(
      JSON.stringify(errorBody(schemaError)),
      413,
      "json_schema",
    ).category,
    "context_limit",
  );
});

const verboseRestrictedBody = errorBody(schemaError.repeat(600));
verboseRestrictedBody.error.metadata.error_type = "PERMISSION_DENIED";
const numericRestrictedBody = errorBody(schemaError);
numericRestrictedBody.error.metadata.raw = JSON.stringify({
  error: { code: 403, message: schemaError },
});
const unknownPolicyBody = errorBody(schemaError);
unknownPolicyBody.error.metadata.provider_code = "ORGANIZATION_SECURITY_BLOCK";
const deepRestrictedBody = errorBody(schemaError);
deepRestrictedBody.error.metadata.raw = JSON.stringify({
  error: {
    message: schemaError,
    metadata: {
      raw: JSON.stringify({
        error: {
          metadata: {
            raw: JSON.stringify({
              error: {
                metadata: { raw: JSON.stringify({ error: { code: 403 } }) },
              },
            }),
          },
        },
      }),
    },
  },
});
const truncatedRawBody = errorBody(schemaError);
truncatedRawBody.error.metadata.raw =
  '{"error":{"message":"The input schema is too complex","code":';
const unknownDetailBody = errorBody(schemaError);
unknownDetailBody.error.details = [{ nested: { status: "PERMISSION_DENIED" } }];
const malformedMetadataBody = errorBody(schemaError);
malformedMetadataBody.error.message = schemaError;
malformedMetadataBody.error.metadata = [{ error_type: "PERMISSION_DENIED" }];

for (const [name, body, expectedCategory] of [
  [
    "verbose prose cannot hide typed permission metadata",
    verboseRestrictedBody,
    "permission",
  ],
  ["numeric upstream permission code", numericRestrictedBody, "permission"],
  ["unknown typed security code", unknownPolicyBody, "unknown"],
  ["diagnostics beyond the nesting bound", deepRestrictedBody, "unknown"],
  ["truncated nested diagnostic JSON", truncatedRawBody, "unknown"],
  ["unmodelled nested error details", unknownDetailBody, "unknown"],
  [
    "malformed array-shaped provider metadata",
    malformedMetadataBody,
    "unknown",
  ],
  [
    "message text beyond its complete-inspection allowance",
    errorBody(schemaError.repeat(600)),
    "unknown",
  ],
  [
    "response beyond the bounded parser allowance",
    errorBody(schemaError.repeat(1400)),
    "unknown",
  ],
]) {
  test(`${scope} ${name} cannot consume an alternative dispatch`, async (t) => {
    const f = fixture(t, { body });
    await assert.rejects(f.run(), (error) => {
      assert.equal(error.provider_http_failure.category, expectedCategory);
      assert.equal(error.retryable, false);
      assert.doesNotMatch(
        JSON.stringify(error),
        /private-response-sentinel|ORGANIZATION_SECURITY_BLOCK/,
      );
      return true;
    });
    assert.deepEqual(
      f.calls.map((call) => call.model),
      [primary],
    );
    assert.equal(f.budget.remaining(), 2);
    assert.equal(f.events.at(-1).recovery_scheduled, false);
  });
}

for (const [code, category] of [
  [401, "authentication"],
  [402, "billing"],
  [403, "permission"],
  [413, "context_limit"],
]) {
  test(`${scope} numeric upstream ${code} is classified before schema compatibility`, () => {
    const body = errorBody(schemaError);
    body.error.metadata.raw = JSON.stringify({
      error: { code, message: schemaError },
    });
    assert.equal(
      classifyProviderHttpFailure(JSON.stringify(body), 400, "json_schema")
        .category,
      category,
    );
  });
}

test(`${scope} checkpoint persistence failure cannot authorize the selected schema fallback`, async (t) => {
  const f = fixture(t, {
    onCheckpoint: async (event) => {
      if (event.state === "failed")
        throw new Error("Synthetic checkpoint persistence failure");
    },
  });
  await assert.rejects(f.run(), /checkpoint persistence failure/);
  assert.deepEqual(
    f.calls.map((call) => call.model),
    [primary],
  );
});
