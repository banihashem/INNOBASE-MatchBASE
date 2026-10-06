import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  LivePreparationModelGateway,
  parseLiveStep1Interpretation,
} from "../../../packages/application/dist/live-preparation.js";

// MB-UX-QUALITY-002 L01: synthetic inputs; no retained customer payloads.
const source = {
  product_requirement: "Industrial mixer",
  technical_compliance:
    "  aterial: polished steel.\r\nSpeed: at least 70 rpm.  ",
  order_profile: "  \n",
};
function payload(intake = source) {
  return {
    original_language: "en",
    english_translation:
      "Industrial mixer. Material: polished steel. Speed: at least 70 rpm.",
    product_category: "Process equipment",
    product_name: "Industrial mixer",
    explicit_requirements: Object.entries(intake)
      .filter(([, text]) => text.trim())
      .map(([source_box, text]) => ({
        source_box,
        source_text_reference: text,
        normalized_value:
          source_box === "technical_compliance"
            ? "Material: polished steel. Speed: at least 70 rpm."
            : text,
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
      label: "Industrial mixers",
      description: "Provisional category",
    },
  };
}
function identity() {
  return {
    requirement_ids: Array.from({ length: 120 }, () => randomUUID()),
    ledger_id: randomUUID(),
    classification_id: randomUUID(),
    assigned_at: "2026-10-05T00:00:00.000Z",
  };
}
function fixture(t, result = payload()) {
  const saved = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(MATCHBASE_|OPENROUTER_)/.test(key),
    ),
  );
  for (const key of Object.keys(saved)) delete process.env[key];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  const requests = [];
  const addresses = [];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const address = String(target);
    addresses.push(address);
    if (address.endsWith("/models/user"))
      return Response.json({
        data: ["google/gemini-3.8-flash", "openai/gpt-5.2"].map((id) => ({
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
    assert.equal(address, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    requests.push(body);
    const catalogue = JSON.parse(body.messages[1].content).reference_catalog;
    const wireResult = {
      ...result,
      explicit_requirements: result.explicit_requirements.map(
        ({ source_text_reference, ...requirement }) => ({
          ...requirement,
          source_reference_id:
            catalogue.find(
              (entry) => entry.source_text_reference === source_text_reference,
            )?.source_reference_id ?? 999,
        }),
      ),
    };
    return Response.json({
      id: randomUUID(),
      model: body.model,
      openrouter_metadata: {
        is_byok: true,
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
          message: { content: JSON.stringify(wireResult) },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 40,
        cost: 0.01,
        cost_details: { upstream_inference_cost: 0.02 },
      },
    });
  });
  t.after(() => {
    for (const key of Object.keys(process.env))
      if (/^(MATCHBASE_|OPENROUTER_)/.test(key)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  return { requests, addresses, gateway: new LivePreparationModelGateway() };
}

test("MB-UX-QUALITY-002 L01 wire references preserve source typos, whitespace and every source line", async (t) => {
  const f = fixture(t);
  const result = await f.gateway.extractAndInterpret(source);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  const references = JSON.parse(
    request.messages[1].content,
  ).reference_catalog.map((entry) => entry.source_text_reference);
  assert.deepEqual(references, [
    source.product_requirement,
    source.technical_compliance,
    "  aterial: polished steel.",
    "Speed: at least 70 rpm.  ",
  ]);
  assert.match(
    request.messages[0].content,
    /Never translate or copyedit a source reference/,
  );
  assert.equal(request.plugins, undefined);
  assert.equal(
    result.explicit_requirements[1].source_text_reference,
    source.technical_compliance,
  );
  assert.equal(
    result.explicit_requirements[1].normalized_value,
    "Material: polished steel. Speed: at least 70 rpm.",
  );
  assert.equal(
    result.ledger.requirements[1].source_span_or_reference,
    source.technical_compliance,
  );
  const offline = parseLiveStep1Interpretation(
    JSON.stringify(payload()),
    source,
    {
      requirement_ids: result.explicit_requirements.map(
        (row) => row.requirement_id,
      ),
      ledger_id: result.ledger.ledger_id,
      classification_id: result.classification.classification_id,
      assigned_at: result.classification.assigned_at,
    },
  );
  assert.deepEqual(offline, result);
  assert.equal(f.requests.length, 1, "offline assembly cannot dispatch");
});

test("MB-UX-QUALITY-002 L01 historical exact substrings replay deterministically without provider I/O", (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Network forbidden");
  });
  const retained = payload();
  retained.explicit_requirements[1].source_text_reference = "polished steel";
  const original = structuredClone(retained);
  const ids = identity();
  const first = parseLiveStep1Interpretation(
    JSON.stringify(retained),
    source,
    ids,
  );
  assert.deepEqual(
    parseLiveStep1Interpretation(JSON.stringify(retained), source, ids),
    first,
  );
  assert.deepEqual(retained, original);
  assert.equal(
    first.explicit_requirements[1].source_text_reference,
    "polished steel",
  );
});

test("MB-UX-QUALITY-002 L01 local parsing rejects corrected, forged, wrong-box, blank and missing references", () => {
  for (const change of [
    (value) => {
      value.explicit_requirements[1].source_text_reference =
        "Material: polished steel.";
    },
    (value) => {
      value.explicit_requirements[1].source_text_reference =
        "Speed: at least 80 rpm.";
    },
    (value) => {
      value.explicit_requirements[1].source_box = "product_requirement";
    },
    (value) => {
      value.explicit_requirements[1].source_text_reference = "  ";
    },
    (value) => {
      value.explicit_requirements.pop();
    },
  ]) {
    const retained = payload();
    change(retained);
    assert.throws(
      () =>
        parseLiveStep1Interpretation(
          JSON.stringify(retained),
          source,
          identity(),
        ),
      { code: "MB-422-LIVE-LINEAGE" },
    );
  }
});

test("MB-UX-QUALITY-002 L01 offline replay retains schema and translation rejection", () => {
  const retained = payload();
  retained.english_translation = "\u0645\u062a\u0646";
  assert.throws(
    () =>
      parseLiveStep1Interpretation(
        JSON.stringify(retained),
        source,
        identity(),
      ),
    { code: "MB-422-LIVE-TRANSLATION" },
  );
  retained.english_translation = payload().english_translation;
  retained.explicit_requirements[0].normalized_value = "\u0645\u062a\u0646";
  assert.throws(
    () =>
      parseLiveStep1Interpretation(
        JSON.stringify(retained),
        source,
        identity(),
      ),
    { code: "MB-422-LIVE-TRANSLATION" },
  );
  delete retained.product_name;
  assert.throws(
    () =>
      parseLiveStep1Interpretation(
        JSON.stringify(retained),
        source,
        identity(),
      ),
    { code: "MB-422-LIVE-SCHEMA" },
  );
});

test("MB-UX-QUALITY-002 L10 unmatched provider reference IDs fail after one call without automatic billing retries", async (t) => {
  const retained = payload();
  retained.explicit_requirements[1].source_text_reference =
    "Material: polished steel.";
  const f = fixture(t, retained);
  await assert.rejects(f.gateway.extractAndInterpret(source), {
    code: "MB-422-LIVE-SCHEMA",
  });
  assert.equal(f.requests.length, 1);
});

test("MB-UX-QUALITY-002 L01 blank, excessive references and full request capacity fail before any network request", async (t) => {
  const f = fixture(t);
  for (const text of [
    " \r\n ",
    "x".repeat(160_000),
    "x".repeat(80_000),
    Array.from({ length: 241 }, (_, i) => `Requirement ${i}`).join("\n"),
  ]) {
    await assert.rejects(
      f.gateway.extractAndInterpret({
        product_requirement: text,
        technical_compliance: "",
        order_profile: "",
      }),
      { code: "MB-422-PREPARATION-INPUT" },
    );
  }
  assert.equal(f.addresses.length, 0);
});
