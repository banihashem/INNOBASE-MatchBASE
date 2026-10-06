import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import {
  LIVE_STEP1_SCHEMA,
  LivePreparationModelGateway,
  parseLiveStep1Interpretation,
} from "../../../packages/application/dist/live-preparation.js";
import { runLiveCompletion } from "../../../packages/application/dist/openrouter-model-policy.js";

const scope = "MB-UX-QUALITY-002 L10";
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
// rejection's unretained wording or all GPT-5.2 endpoints. Newline string-enum
// rejection is a conditional hypothesis; actual endpoint qualification is separate.
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
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.some(
        (value) =>
          typeof value === "string" && /[\r\n\u2028\u2029]/u.test(value),
      )
    )
      throw new Error("Newline string enum literals are not permitted");
  }
  if (Object.hasOwn(schema, "const")) {
    assert.equal(schema.type, "string");
    assert.equal(typeof schema.const, "string");
    assert.equal(Object.hasOwn(schema, "enum"), false);
    if (/[\r\n\u2028\u2029]/u.test(schema.const))
      throw new Error("Newline string const literals are not permitted");
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
function wirePayload(canonical, catalogue) {
  return {
    ...canonical,
    explicit_requirements: canonical.explicit_requirements.map(
      ({ source_text_reference, ...requirement }) => ({
        ...requirement,
        source_reference_id:
          catalogue.find(
            (entry) => entry.source_text_reference === source_text_reference,
          )?.source_reference_id ?? 999,
      }),
    ),
  };
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
    responseWire: null,
    raw: null,
    beforeRespond: async () => {},
    replies: [],
    addresses: [],
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
      await state.beforeRespond(body);
      const catalogue =
        JSON.parse(body.messages.at(-1).content).reference_catalog ?? [];
      const canonical =
        typeof state.response === "function"
          ? state.response(body)
          : state.response;
      const reply = state.responseWire ?? wirePayload(canonical, catalogue);
      const content = state.raw ?? JSON.stringify(reply);
      state.replies.push(content);
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
            message: { content },
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
    state.addresses.push(String(target));
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
  const catalogue = JSON.parse(request.messages[1].content).reference_catalog;
  assert.deepEqual(
    catalogue.map((entry) => entry.source_text_reference),
    [
      source.product_requirement,
      "  حمل به Lekki؛ مسیر معکوس نه.",
      "20.5 tonnes per container.  ",
    ],
  );
  assert.deepEqual(
    schema.properties.explicit_requirements.items.properties
      .source_reference_id,
    { type: "integer", enum: [1, 2, 3] },
  );
  assert.equal(
    schema.properties.explicit_requirements.items.properties
      .source_text_reference,
    undefined,
  );
  assert.equal(
    request.response_format.json_schema.name,
    "matchbase_step1_reference_ids_v1",
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

test(`${scope} four-line five-reference wire rejects newline enums over HTTP and decodes the full original box from an ID`, async (t) => {
  const source = {
    ...intake,
    product_requirement:
      "Cargo machinery.\nQingdao to Lekki.\n20.5 tonnes per shipment.\nNo reverse lane; A OR B",
  };
  assert.equal(source.product_requirement.length, 84);
  assert.equal(source.product_requirement.split("\n").length, 4);
  const f = await endpoint(t, source);
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
    enum: [
      source.product_requirement,
      ...source.product_requirement.split("\n"),
    ],
  };
  assert.equal(Buffer.byteLength(JSON.stringify(previous)), 2275);
  await assert.rejects(
    runLiveCompletion(
      {
        model,
        messages: [{ role: "user", content: JSON.stringify(source) }],
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
  const result = await f.gateway.extractAndInterpret(source);
  assert.deepEqual(f.statuses, [400, 200]);
  const corrected = f.requests[1].response_format.json_schema.schema;
  delete oldProperties.source_text_reference;
  oldProperties.source_reference_id = {
    type: "integer",
    enum: [1, 2, 3, 4, 5],
  };
  previous.properties.explicit_requirements.items.required =
    Object.keys(oldProperties);
  assert.deepEqual(
    corrected,
    previous,
    "Only the reference field and its required name change",
  );
  assert.equal(
    result.explicit_requirements[0].source_text_reference,
    source.product_requirement,
  );
  assert.equal(
    result.ledger.requirements[0].source_span_or_reference,
    source.product_requirement,
  );
  assert.equal(JSON.stringify(LIVE_STEP1_SCHEMA), canonicalBefore);
  assert.equal(f.requests[1].max_tokens, 16000);
  assert.deepEqual(f.guards, [
    [model, false],
    [model, false],
  ]);
  assert.match(
    f.requests[1].messages[0].content,
    /Select each source_reference_id from the supplied reference_catalog/,
  );
  assert.doesNotMatch(f.requests[1].messages[0].content, /schema enum/);
});

test(`${scope} numeric singleton preserves mixed-script bytes and deduplicated source-box identity`, async (t) => {
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
        .explicit_requirements.items.properties.source_reference_id,
      { type: "integer", enum: [1] },
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

test(`${scope} numeric references reject a reference belonging to another populated box`, async (t) => {
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
      .explicit_requirements.items.properties.source_reference_id,
    { type: "integer", enum: [1, 2, 3] },
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
      "MB-422-LIVE-SCHEMA",
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

test(`${scope} malformed numeric wire is rejected after a retained raw receipt without another dispatch`, async (t) => {
  const f = await endpoint(t);
  const valid = wirePayload(payload(), [
    {
      source_reference_id: 1,
      source_text_reference: intake.product_requirement,
    },
  ]);
  const cases = [
    ...[
      0,
      -1,
      2,
      999,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
      true,
      {},
      [],
    ].map((id) => [
      `invalid ID ${JSON.stringify(id)}`,
      (value) => {
        value.explicit_requirements[0].source_reference_id = id;
      },
    ]),
    [
      "missing ID",
      (value) => {
        delete value.explicit_requirements[0].source_reference_id;
      },
    ],
    [
      "old string instead of ID",
      (value) => {
        delete value.explicit_requirements[0].source_reference_id;
        value.explicit_requirements[0].source_text_reference =
          intake.product_requirement;
      },
    ],
    [
      "both fields",
      (value) => {
        value.explicit_requirements[0].source_text_reference =
          intake.product_requirement;
      },
    ],
    [
      "extra field",
      (value) => {
        value.explicit_requirements[0].source_box_override = "order_profile";
      },
    ],
  ];
  for (const [label, mutate] of cases) {
    f.responseWire = structuredClone(valid);
    mutate(f.responseWire);
    const before = f.requests.length;
    await assert.rejects(
      f.gateway.extractAndInterpret(intake),
      { code: "MB-422-LIVE-SCHEMA" },
      label,
    );
    assert.equal(f.requests.length, before + 1, label);
    const receipt = f.events.findLast((event) => event.state === "completed");
    assert.equal(receipt.response_content, JSON.stringify(f.responseWire));
    assert.equal(receipt.response_content, f.replies.at(-1));
    assert.equal(receipt.provider_receipt_received, true);
    assert.equal(receipt.cost_usd, 0.01);
    assert.equal(receipt.upstream_inference_cost, 0.02);
  }
  for (const raw of [
    "{",
    "[]",
    '{"explicit_requirements":[{"source_reference_id":1e999}]}',
  ]) {
    f.raw = raw;
    await assert.rejects(f.gateway.extractAndInterpret(intake), {
      code: "MB-422-LIVE-SCHEMA",
    });
    assert.equal(
      f.events.findLast((event) => event.state === "completed")
        .response_content,
      raw,
    );
  }
  assert.equal(f.requests.length, cases.length + 3);
  assert.ok(f.statuses.every((status) => status === 200));
});

test(`${scope} all admitted line endings and full boxes round-trip without modifying historical string replay`, async (t) => {
  const source = {
    ...intake,
    product_requirement:
      "  حمل 🚢 Qingdao → Lekki.\r\n20.5 tonnes; A OR B.\rNo reverse lane.\n20.5 tonnes; A OR B.\u2028Keep words exact.\u2029  Last line.  ",
  };
  const expected = [
    source.product_requirement,
    "  حمل 🚢 Qingdao → Lekki.",
    "20.5 tonnes; A OR B.",
    "No reverse lane.",
    "Keep words exact.",
    "  Last line.  ",
  ];
  const f = await endpoint(t, source);
  const originalPayload = payload(source);
  f.response = {
    ...originalPayload,
    explicit_requirements: expected.map((text) => ({
      ...originalPayload.explicit_requirements[0],
      source_text_reference: text,
    })),
  };
  const result = await f.gateway.extractAndInterpret(source);
  const envelope = JSON.parse(f.requests[0].messages[1].content);
  assert.deepEqual(envelope.original_intake, source);
  assert.equal(envelope.reference_catalog_version, "step1-source-ids.v1");
  assert.deepEqual(
    envelope.reference_catalog.map((entry) => entry.source_text_reference),
    expected,
  );
  assert.deepEqual(
    envelope.reference_catalog.map((entry) => entry.source_boxes),
    expected.map(() => ["product_requirement"]),
  );
  assert.deepEqual(
    result.explicit_requirements.map((entry) => entry.source_text_reference),
    expected,
  );
  assert.deepEqual(
    result.ledger.requirements.map((entry) => entry.source_span_or_reference),
    expected,
  );
  const ids = {
    requirement_ids: result.explicit_requirements.map(
      (entry) => entry.requirement_id,
    ),
    ledger_id: result.ledger.ledger_id,
    classification_id: result.classification.classification_id,
    assigned_at: result.classification.assigned_at,
  };
  assert.deepEqual(
    parseLiveStep1Interpretation(JSON.stringify(f.response), source, ids),
    result,
  );
  const historical = structuredClone(f.response);
  historical.explicit_requirements[0].source_text_reference = "Qingdao → Lekki";
  assert.equal(
    parseLiveStep1Interpretation(JSON.stringify(historical), source, ids)
      .explicit_requirements[0].source_text_reference,
    "Qingdao → Lekki",
  );
  assert.throws(
    () => parseLiveStep1Interpretation(f.replies[0], source, ids),
    { code: "MB-422-LIVE-SCHEMA" },
    "Historical canonical recovery must not silently accept numeric wire receipts",
  );
  assert.equal(f.requests.length, 1);
});

test(`${scope} source-box coverage and exact catalogue membership are stricter than substring coincidence`, async (t) => {
  const source = {
    ...intake,
    technical_compliance: "covered equipment",
    order_profile: "Use covered equipment for shipment.",
  };
  const f = await endpoint(t, source);
  f.response.explicit_requirements.pop();
  await assert.rejects(f.gateway.extractAndInterpret(source), {
    code: "MB-422-LIVE-LINEAGE",
  });
  f.response = payload(source);
  f.response.explicit_requirements[2].source_text_reference =
    source.technical_compliance;
  await assert.rejects(
    f.gateway.extractAndInterpret(source),
    { code: "MB-422-LIVE-LINEAGE" },
    "A substring in another box is not an admitted whole-box or line for that box",
  );
  assert.equal(f.requests.length, 2);
});

test(`${scope} snapshot and catalogue are request-local across mutation and opposite completion order`, async (t) => {
  const sourceA = {
    ...intake,
    product_requirement: "Original A.\nNo substitution.",
  };
  const preservedA = structuredClone(sourceA);
  const sourceB = {
    ...intake,
    product_requirement: "Independent B.\nDo not reuse A.",
  };
  const f = await endpoint(t);
  let enteredA;
  let releaseA;
  const receivedA = new Promise((resolve) => {
    enteredA = resolve;
  });
  const holdA = new Promise((resolve) => {
    releaseA = resolve;
  });
  f.beforeRespond = async (body) => {
    if (
      JSON.parse(body.messages[1].content).original_intake
        .product_requirement === preservedA.product_requirement
    ) {
      enteredA();
      await holdA;
    }
  };
  f.response = (body) =>
    payload(JSON.parse(body.messages[1].content).original_intake);
  const pendingA = f.gateway.extractAndInterpret(sourceA);
  await receivedA;
  sourceA.product_requirement = "Mutated after dispatch.";
  sourceA.order_profile = "Injected order.";
  const resultB = await f.gateway.extractAndInterpret(sourceB);
  releaseA();
  const resultA = await pendingA;
  assert.equal(
    resultA.explicit_requirements[0].source_text_reference,
    preservedA.product_requirement,
  );
  assert.equal(
    resultB.explicit_requirements[0].source_text_reference,
    sourceB.product_requirement,
  );
  assert.equal(resultA.explicit_requirements.length, 1);
  assert.equal(
    resultA.ledger.requirements[0].source_text,
    preservedA.product_requirement,
  );
  assert.notEqual(resultA.ledger.intake_hash, resultB.ledger.intake_hash);
  assert.equal(f.requests.length, 2);
  const envelopes = f.requests.map((request) =>
    JSON.parse(request.messages[1].content),
  );
  assert.deepEqual(
    envelopes.map((value) =>
      value.reference_catalog.map((entry) => entry.source_reference_id),
    ),
    [
      [1, 2, 3],
      [1, 2, 3],
    ],
  );
  assert.deepEqual(envelopes[0].original_intake, preservedA);
});

test(`${scope} complete encoded catalogue capacity and reference limits fail before capability access`, async (t) => {
  const f = await endpoint(t);
  const catalogueOverflow = {
    ...intake,
    product_requirement: "x".repeat(79000),
  };
  assert.ok(
    Buffer.byteLength(JSON.stringify(catalogueOverflow)) + 512 < 160000,
  );
  for (const source of [
    { ...intake, product_requirement: " \r\n \u2028 " },
    { ...intake, product_requirement: "x".repeat(160000) },
    catalogueOverflow,
    {
      ...intake,
      product_requirement: Array.from(
        { length: 240 },
        (_, i) => `Line ${i}`,
      ).join("\n"),
    },
  ]) {
    await assert.rejects(f.gateway.extractAndInterpret(source), {
      code: "MB-422-PREPARATION-INPUT",
    });
    assert.equal(f.addresses.length, 0);
  }
  const boundary = {
    ...intake,
    product_requirement: Array.from(
      { length: 239 },
      (_, i) => `Line ${i}`,
    ).join("\n"),
  };
  f.response = payload(boundary);
  await f.gateway.extractAndInterpret(boundary);
  const request = f.requests[0];
  assert.equal(
    JSON.parse(request.messages[1].content).reference_catalog.length,
    240,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(request)) + 512 < 160000);
  assert.equal(request.max_tokens, 16000);
});
