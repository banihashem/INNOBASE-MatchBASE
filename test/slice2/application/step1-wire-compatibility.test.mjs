import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import {
  LIVE_STEP1_SCHEMA,
  LivePreparationModelGateway,
} from "../../../packages/application/dist/live-preparation.js";
import { runLiveCompletion } from "../../../packages/application/dist/openrouter-model-policy.js";

const scope = "MB-UX-QUALITY-002 L09";
const model = "openai/gpt-5.2";
const intake = {
  product_requirement:
    "Transport machinery from Qingdao to Lekki; no reverse lane.",
  technical_compliance: "",
  order_profile: "",
};
function payload(source = intake) {
  return {
    original_language: "en",
    english_translation:
      "Transport machinery from Qingdao to Lekki; no reverse lane.",
    product_category: "Freight services",
    product_name: "Ocean transport",
    explicit_requirements: Object.entries(source)
      .filter(([, text]) => text.trim())
      .map(([source_box, text]) => ({
        source_box,
        source_text_reference: text,
        normalized_value: "Preserve the requested direction and exclusions.",
        requirement_level: "mandatory",
        comparison_operator: "requires",
        concept: "transport",
        value: null,
        unit: null,
        jurisdiction: null,
        lower_bound: null,
        upper_bound: null,
        duration: null,
        supplier_role: null,
        evidence_qualifier: null,
      })),
    ambiguities: [],
    unknowns: [],
    suggested_clarifications: [],
    classification: {
      scheme: "CUSTOM_MATCHBASE",
      code: "UNCLASSIFIED",
      version: "1",
      jurisdiction: "Unknown",
      level: "category",
      label: "Freight services",
      description: "Provisional category",
    },
  };
}

// A deliberately restricted endpoint contract, not a claim about the production
// rejection's unretained wording or all GPT-5.2 endpoints. R1 models the
// case-specific singleton-enum hypothesis; actual endpoint qualification is separate.
function admitStructuralSchema(schema) {
  const supported = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "const",
    "items",
  ]);
  for (const keyword of Object.keys(schema)) {
    if (!supported.has(keyword))
      throw new Error(`Unsupported schema keyword: ${keyword}`);
  }
  if (Object.hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length < 2)
      throw new Error("Singleton schema enums are not permitted");
  }
  if (Object.hasOwn(schema, "const")) {
    assert.equal(schema.type, "string");
    assert.equal(typeof schema.const, "string");
    assert.equal(Object.hasOwn(schema, "enum"), false);
  }
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
    );
    for (const child of Object.values(schema.properties))
      admitStructuralSchema(child);
  }
  if (schema.type === "array") admitStructuralSchema(schema.items);
}
const runtimeName = (name) =>
  /^(MATCHBASE_|OPENROUTER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS)$|OPENAI_API_KEY$|GOOGLE_API_KEY$|GEMINI_API_KEY$)/u.test(
    name,
  );

async function endpoint(t, source = intake) {
  const saved = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => runtimeName(name)),
  );
  for (const name of Object.keys(saved)) delete process.env[name];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  process.env.MATCHBASE_MODEL_PREPARATION = model;
  const state = {
    requests: [],
    statuses: [],
    events: [],
    guards: [],
    response: payload(source),
    reject: false,
  };
  const errors = [];
  const parameters = ["structured_outputs", "reasoning", "max_tokens"];
  const server = createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.url === "/api/v1/models/user")
        return send(200, {
          data: [{ id: model, supported_parameters: parameters }],
        });
      if (request.url === `/api/v1/models/${model}/endpoints`)
        return send(200, {
          data: {
            endpoints: [
              {
                tag: "openai",
                provider_name: "OpenAI",
                supported_parameters: parameters,
              },
            ],
          },
        });
      assert.equal(request.url, "/api/v1/chat/completions");
      assert.equal(request.method, "POST");
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      state.requests.push(body);
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.provider.require_parameters, true);
      assert.equal(body.provider.allow_fallbacks, false);
      assert.deepEqual(body.provider.only, ["openai"]);
      assert.equal(body.model, model);
      assert.equal(body.plugins, undefined);
      try {
        admitStructuralSchema(body.response_format.json_schema.schema);
        if (state.reject) throw new Error("Unsupported schema feature");
      } catch (error) {
        state.statuses.push(400);
        return send(400, {
          error: {
            code: 400,
            type: "invalid_request_error",
            message: `Invalid schema for response_format: ${error.message} is not supported.`,
          },
        });
      }
      state.statuses.push(200);
      return send(200, {
        id: randomUUID(),
        model,
        openrouter_metadata: {
          is_byok: true,
          endpoints: {
            available: [{ selected: true, model, provider: "OpenAI" }],
          },
        },
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(state.response) },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 40,
          cost: 0.01,
          cost_details: { upstream_inference_cost: 0.02 },
        },
      });
    } catch (error) {
      errors.push(error);
      send(500, { error: { message: "Controlled endpoint assertion failed" } });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const transport = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (target, options) => {
    const url = new URL(String(target));
    assert.equal(
      url.origin,
      "https://openrouter.ai",
      "Unrecognized endpoint must never use real network transport",
    );
    return transport(`${origin}${url.pathname}`, options);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const name of Object.keys(process.env))
      if (runtimeName(name)) delete process.env[name];
    Object.assign(process.env, saved);
    assert.deepEqual(errors, []);
  });
  state.options = {
    automatic_recovery_attempts: 3,
    preparation_recovery: true,
    before_call: async (request, web) =>
      state.guards.push([request.model, web]),
    on_checkpoint: async (event) => state.events.push(event),
  };
  state.gateway = new LivePreparationModelGateway(state.options);
  return state;
}

test(`${scope} actual Step1 wire passes a structural-only HTTP endpoint without changing canonical rules`, async (t) => {
  const source = {
    ...intake,
    product_requirement:
      "  حمل به Lekki؛ مسیر معکوس نه.\r\n20.5 tonnes per container.  ",
  };
  const before = JSON.stringify(LIVE_STEP1_SCHEMA);
  const f = await endpoint(t, source);
  const result = await f.gateway.extractAndInterpret(source);
  assert.deepEqual(f.statuses, [200]);
  assert.deepEqual(f.guards, [[model, false]]);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  const schema = request.response_format.json_schema.schema;
  assert.deepEqual(
    schema.properties.explicit_requirements.items.properties
      .source_text_reference.enum,
    [
      source.product_requirement,
      "  حمل به Lekki؛ مسیر معکوس نه.",
      "20.5 tonnes per container.  ",
    ],
  );
  assert.deepEqual(
    schema.properties.explicit_requirements.items.properties.value.type,
    ["string", "null"],
  );
  assert.equal(request.max_tokens, 16000);
  assert.equal(JSON.stringify(LIVE_STEP1_SCHEMA), before);
  assert.equal(LIVE_STEP1_SCHEMA.properties.english_translation.minLength, 1);
  assert.equal(LIVE_STEP1_SCHEMA.properties.explicit_requirements.minItems, 1);
  assert.equal(
    LIVE_STEP1_SCHEMA.properties.explicit_requirements.maxItems,
    120,
  );
  assert.equal(
    result.ledger.requirements[0].source_span_or_reference,
    source.product_requirement,
  );
  assert.equal(result.classification.confidence, "low");
  assert.equal(result.model_suggestions.length, 0);
});

test(`${scope} canonical wire is rejected over HTTP and corrected wire succeeds without retry or route change`, async (t) => {
  const f = await endpoint(t);
  const legacy = structuredClone(LIVE_STEP1_SCHEMA);
  legacy.properties.explicit_requirements.items.properties.source_text_reference =
    { type: "string", enum: [intake.product_requirement] };
  await assert.rejects(
    runLiveCompletion(
      {
        model,
        messages: [{ role: "user", content: JSON.stringify(intake) }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "matchbase_step1",
            strict: true,
            schema: legacy,
          },
        },
        max_tokens: 16000,
      },
      { phase: "step1_translation", loop: 1 },
      f.options,
    ),
    { code: "MB-502-LIVE-PROVIDER" },
  );
  assert.deepEqual(f.statuses, [400]);
  const failure = f.events.find((event) => event.state === "failed");
  assert.deepEqual(failure.provider_http_failure, {
    http_status: 400,
    request_format: "json_schema",
    category: "schema_compatibility",
    schema_issue: "unsupported_feature",
  });
  assert.equal(failure.provider_dispatch_rejected, true);
  assert.equal(failure.provider_receipt_received, false);
  assert.equal(failure.recovery_scheduled, false);
  await f.gateway.extractAndInterpret(intake);
  assert.deepEqual(f.statuses, [400, 200]);
  assert.deepEqual(f.guards, [
    [model, false],
    [model, false],
  ]);
});

test(`${scope} remaining HTTP schema rejection stays terminal after exactly one dispatch`, async (t) => {
  const f = await endpoint(t);
  f.reject = true;
  await assert.rejects(f.gateway.extractAndInterpret(intake), {
    code: "MB-502-LIVE-PROVIDER",
  });
  assert.deepEqual(f.statuses, [400]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.events.filter((event) => event.state === "failed").length, 1);
});

test(`${scope} R1 singleton enum rejection over HTTP is avoided by the same exact literal const`, async (t) => {
  const f = await endpoint(t);
  const canonicalBefore = JSON.stringify(LIVE_STEP1_SCHEMA);
  // Reconstruct the qualified pre-R1 structural wire, not the older bounded schema.
  const previous = structuredClone(LIVE_STEP1_SCHEMA);
  delete previous.properties.english_translation.minLength;
  delete previous.properties.product_name.minLength;
  delete previous.properties.explicit_requirements.minItems;
  delete previous.properties.explicit_requirements.maxItems;
  const oldProperties =
    previous.properties.explicit_requirements.items.properties;
  delete oldProperties.normalized_value.minLength;
  oldProperties.source_text_reference = {
    type: "string",
    enum: [intake.product_requirement],
  };
  await assert.rejects(
    runLiveCompletion(
      {
        model,
        messages: [{ role: "user", content: JSON.stringify(intake) }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "matchbase_step1",
            strict: true,
            schema: previous,
          },
        },
        max_tokens: 16000,
      },
      { phase: "step1_translation", loop: 1 },
      f.options,
    ),
    { code: "MB-502-LIVE-PROVIDER" },
  );
  assert.deepEqual(f.statuses, [400]);
  assert.equal(
    f.requests.length,
    1,
    "Definitive rejection cannot trigger a second dispatch",
  );
  assert.equal(
    f.events.find((event) => event.state === "failed")
      .provider_receipt_received,
    false,
  );
  const result = await f.gateway.extractAndInterpret(intake);
  assert.deepEqual(f.statuses, [400, 200]);
  const corrected = f.requests[1].response_format.json_schema.schema;
  oldProperties.source_text_reference = {
    type: "string",
    const: intake.product_requirement,
  };
  assert.deepEqual(
    corrected,
    previous,
    "Only the singleton reference representation changes",
  );
  assert.equal(
    result.explicit_requirements[0].source_text_reference,
    intake.product_requirement,
  );
  assert.equal(
    result.ledger.requirements[0].source_span_or_reference,
    intake.product_requirement,
  );
  assert.equal(JSON.stringify(LIVE_STEP1_SCHEMA), canonicalBefore);
  assert.equal(f.requests[1].max_tokens, 16000);
  assert.deepEqual(f.guards, [
    [model, false],
    [model, false],
  ]);
  assert.match(
    f.requests[1].messages[0].content,
    /match a supplied schema reference verbatim/,
  );
  assert.doesNotMatch(f.requests[1].messages[0].content, /schema enum/);
});

test(`${scope} R1 singleton const preserves mixed-script bytes and deduplicated source-box identity`, async (t) => {
  const literal =
    "  حمل Qingdao → Lekki؛ 20.5 tonnes; no reverse lane; A OR B.  ";
  const f = await endpoint(t);
  for (const selected of [
    ["product_requirement"],
    ["technical_compliance"],
    ["order_profile"],
    ["product_requirement", "technical_compliance", "order_profile"],
  ]) {
    const source = Object.fromEntries(
      Object.keys(intake).map((box) => [
        box,
        selected.includes(box) ? literal : "",
      ]),
    );
    f.response = payload(source);
    const result = await f.gateway.extractAndInterpret(source);
    assert.deepEqual(
      f.requests.at(-1).response_format.json_schema.schema.properties
        .explicit_requirements.items.properties.source_text_reference,
      { type: "string", const: literal },
    );
    assert.deepEqual(
      result.explicit_requirements.map((requirement) => requirement.source_box),
      selected,
    );
    assert.ok(
      result.explicit_requirements.every(
        (requirement) => requirement.source_text_reference === literal,
      ),
    );
  }
  assert.deepEqual(f.statuses, [200, 200, 200, 200]);
});

test(`${scope} R1 multiple source references retain enum and reject a reference belonging to another populated box`, async (t) => {
  const source = {
    ...intake,
    technical_compliance: "Use covered equipment; no open deck.",
    order_profile: "One shipment, 20.5 tonnes.",
  };
  const f = await endpoint(t, source);
  const result = await f.gateway.extractAndInterpret(source);
  assert.equal(result.explicit_requirements.length, 3);
  assert.deepEqual(
    f.requests[0].response_format.json_schema.schema.properties
      .explicit_requirements.items.properties.source_text_reference,
    { type: "string", enum: Object.values(source) },
  );
  f.response = payload(source);
  f.response.explicit_requirements[0].source_text_reference =
    source.technical_compliance;
  await assert.rejects(f.gateway.extractAndInterpret(source), {
    code: "MB-422-LIVE-LINEAGE",
  });
  assert.deepEqual(
    f.statuses,
    [200, 200],
    "A permissive response cannot bypass source-box ownership",
  );
  assert.equal(f.requests.length, 2, "No billed repair loop");
});

test(`${scope} permissive HTTP response cannot bypass canonical bounds, required keys, extra fields or source lineage`, async (t) => {
  const f = await endpoint(t);
  const cases = [
    [
      "empty translation",
      (p) => (p.english_translation = ""),
      "MB-422-LIVE-SCHEMA",
    ],
    ["empty product", (p) => (p.product_name = ""), "MB-422-LIVE-SCHEMA"],
    [
      "empty normalization",
      (p) => (p.explicit_requirements[0].normalized_value = ""),
      "MB-422-LIVE-SCHEMA",
    ],
    [
      "no requirements",
      (p) => (p.explicit_requirements = []),
      "MB-422-LIVE-SCHEMA",
    ],
    [
      "too many requirements",
      (p) =>
        (p.explicit_requirements = Array.from({ length: 121 }, () =>
          structuredClone(p.explicit_requirements[0]),
        )),
      "MB-422-LIVE-SCHEMA",
    ],
    ["missing key", (p) => delete p.classification.code, "MB-422-LIVE-SCHEMA"],
    [
      "missing nullable key",
      (p) => delete p.explicit_requirements[0].unit,
      "MB-422-LIVE-SCHEMA",
    ],
    ["extra key", (p) => (p.approved = true), "MB-422-LIVE-SCHEMA"],
    [
      "invalid enum",
      (p) => (p.explicit_requirements[0].requirement_level = "optional"),
      "MB-422-LIVE-SCHEMA",
    ],
    [
      "invalid nullable value",
      (p) => (p.explicit_requirements[0].value = 12),
      "MB-422-LIVE-SCHEMA",
    ],
    [
      "unknown reference",
      (p) =>
        (p.explicit_requirements[0].source_text_reference = "invented source"),
      "MB-422-LIVE-LINEAGE",
    ],
    [
      "malformed reference",
      (p) => (p.explicit_requirements[0].source_text_reference = null),
      "MB-422-LIVE-SCHEMA",
    ],
    [
      "wrong source box",
      (p) => (p.explicit_requirements[0].source_box = "order_profile"),
      "MB-422-LIVE-LINEAGE",
    ],
    [
      "non-English translation",
      (p) => (p.english_translation = "متن"),
      "MB-422-LIVE-TRANSLATION",
    ],
  ];
  for (const [label, mutate, code] of cases) {
    f.response = payload();
    mutate(f.response);
    const calls = f.requests.length;
    await assert.rejects(
      f.gateway.extractAndInterpret(intake),
      { code },
      label,
    );
    assert.equal(
      f.requests.length,
      calls + 1,
      `${label}: no billed repair loop`,
    );
    assert.equal(
      f.statuses.at(-1),
      200,
      "Endpoint acceptance does not establish canonical validity",
    );
  }
  f.response = payload();
  f.response.explicit_requirements = Array.from({ length: 120 }, () =>
    structuredClone(f.response.explicit_requirements[0]),
  );
  const result = await f.gateway.extractAndInterpret(intake);
  assert.equal(result.explicit_requirements.length, 120);
});
