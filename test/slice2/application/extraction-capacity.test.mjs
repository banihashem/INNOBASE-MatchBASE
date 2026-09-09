import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { extractNativeDiscoveryPayload } from "../../../packages/application/dist/live-evidence-extraction.js";
import { createRoundCallGuard } from "../../../packages/application/dist/consultant-research-cost.js";
import {
  LIVE_DISCOVERY_SCHEMA,
  assembleLiveSuppliers,
  ingestLiveEvidence,
} from "../../../packages/application/dist/live-supplier-evidence.js";

const INDEX = "matchbase_native_candidate_index";
const BATCH = "matchbase_native_evidence_extraction";
const criteria = Object.freeze(["Industrial pumps", "Active license required"]);
const context = {
  phase: "verification",
  loop: 2,
  max_loops: 15,
  mandatory_criteria: criteria,
};
function dataset(count) {
  const registryUrl = "https://registry.example.com/licenses";
  const records = Array.from({ length: count }, (_, position) => {
    const name = `Aster Supplier ${String(position + 1).padStart(2, "0")}`;
    const url = `https://supplier-${position + 1}.example.com/capabilities`;
    const quote = `${name} manufactures industrial pumps.`;
    const license = `${name} holds an active forwarding license.`;
    const source = `${quote}\n${Array.from({ length: 12 }, (_, n) => `Specification ${n + 1}: value ${n + 1}.`).join("\n")}`;
    const proof = { status: "verified", source_urls: [url], quote };
    return {
      name,
      url,
      quote,
      license,
      source,
      candidate: {
        legal_name: name,
        country: "Unknown",
        headquarters: "Unknown",
        website: new URL(url).origin,
        supplier_type: "manufacturer",
        manufacturer_status: "direct_manufacturer",
        identity: proof,
        product_name: "Industrial pumps",
        product_family: "Pumps",
        product_origin: "Unknown",
        product: proof,
        facts: Array.from({ length: 12 }, (_, n) => ({
          field_path: `specifications.dimension_${n + 1}`,
          value: `value ${n + 1}`,
          claim_type: "product_spec",
          source_urls: [url],
          quote: `Specification ${n + 1}: value ${n + 1}.`,
        })),
        certifications: [],
        constraints: [
          { constraint: criteria[0], dimension: "product", ...proof },
          {
            constraint: criteria[1],
            dimension: "compliance",
            status: "verified",
            source_urls: [registryUrl],
            quote: license,
          },
        ],
        unknowns: ["Current quotation"],
        risks: [],
      },
    };
  });
  const native = {
    model: "google/gemini-3.8-flash",
    text: records
      .map((record) => `${record.source}\n${record.license}`)
      .join("\n\n"),
    citations: [
      ...records.map((record) => ({
        url: record.url,
        title: record.name,
        content: record.source,
      })),
      {
        url: registryUrl,
        title: "License registry",
        content: records.map((record) => record.license).join("\n"),
      },
    ],
    input_tokens: 10,
    output_tokens: 20,
    latency_ms: 1,
    cost_usd: 0.01,
    live_api_invoked: true,
  };
  const index = {
    candidates: records.map((record) => ({
      legal_name: record.name,
      anchor_quote: record.quote,
      source_urls: [record.url, registryUrl],
    })),
    remaining_gaps: ["Current quotation"],
    evidence_exhausted: true,
    summary: "Existing native observations only.",
  };
  const batch = (names) => {
    const selected = records.filter((record) => names.includes(record.name));
    return {
      candidates: structuredClone(selected.map((record) => record.candidate)),
      evidence: selected.flatMap((record) => [
        {
          url: record.url,
          title: record.name,
          publisher: record.name,
          source_type: "official_website",
          excerpt: record.source,
        },
        {
          url: registryUrl,
          title: "License registry",
          publisher: "Registry",
          source_type: "official_registry",
          excerpt: record.license,
        },
      ]),
      remaining_gaps: ["Current quotation"],
      evidence_exhausted: true,
      summary: "Full records for the assigned batch.",
    };
  };
  return { records, registryUrl, native, index, batch };
}
function fixture(t, dispatch) {
  const settings = {
    MATCHBASE_OPENROUTER_API_KEY: randomUUID(),
    OPENROUTER_API_KEY: undefined,
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
  };
  const prior = Object.fromEntries(
    Object.keys(settings).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [
          {
            id: "openai/gpt-5.2",
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
    calls.push(body);
    const generation = `capacity-fixture-${calls.length}`;
    const payload = await dispatch(body, options.signal);
    return Response.json({
      id: generation,
      model: body.model,
      openrouter_metadata: {
        is_byok: true,
        endpoints: {
          available: [
            { selected: true, model: body.model, provider: "OpenAI" },
          ],
        },
      },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              typeof payload === "string" ? payload : JSON.stringify(payload),
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://invented.example.com",
                  title: "Extraction-only annotation",
                  content: "Not native evidence.",
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
  });
  return calls;
}
const schemaName = (body) => body.response_format.json_schema.name;
const input = (body) => JSON.parse(body.messages[1].content);

test("MB-UX-LIVE-001 L10 citation-heavy discovery fits the approved allowance without losing notes or citation identities", async (t) => {
  const data = dataset(10);
  data.native.text = data.native.text.padEnd(20953, " ");
  while (data.native.citations.length < 71)
    data.native.citations.push({
      url: `https://other-${data.native.citations.length}.example.com/evidence`,
      title: "Additional cited source",
      content: "Public source excerpt.",
    });
  for (const citation of data.native.citations)
    citation.content = citation.content.padEnd(6000, "x");
  const original = structuredClone(data.native);
  const maxInput = 240000;
  const guard = createRoundCallGuard({
    mode: "live",
    research_models: [],
    extraction_model: "openai/gpt-5.2",
    synthesis_model: "openai/gpt-5.2",
    max_calls: 9,
    max_input_tokens_per_call: maxInput,
    max_output_tokens_per_call: 12000,
    rates: [{ model: "openai/gpt-5.2", provider: "openai" }],
  });
  const calls = fixture(t, async (body) => {
    assert.ok(
      Buffer.byteLength(JSON.stringify(body.messages), "utf8") + 512 <=
        maxInput,
    );
    assert.equal(body.max_tokens, 12000);
    assert.equal(
      input(body).native_research_notes,
      schemaName(body) === INDEX ? original.text : undefined,
    );
    assert.deepEqual(input(body).buyer_mandatory_criteria, criteria);
    if (schemaName(body) === INDEX) {
      assert.deepEqual(
        input(body).native_citations.map((c) => c.url),
        original.citations.map((c) => c.url),
      );
      assert.match(input(body).evidence_excerpt_notice, /shortened/);
      assert.equal(body.reasoning.effort, "low");
      return data.index;
    }
    assert.equal(body.reasoning.effort, "low");
    return data.batch(input(body).assigned_candidate_names);
  });
  const result = await extractNativeDiscoveryPayload(
    data.native,
    "openai/gpt-5.2",
    { ...context, candidate_limit: 10 },
    {
      max_input_bytes: maxInput,
      max_output_tokens: 12000,
      reasoning_effort: "high",
      before_call: guard,
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(result.parsed.candidates.length, 10);
  assert.deepEqual(data.native, original);
});

test("MB-UX-LIVE-001 L10 oversized immutable notes preserve the allowance failure before any paid call", async (t) => {
  const data = dataset(1);
  data.native.text = data.native.text.padEnd(250000, "x");
  const calls = fixture(t, async () =>
    assert.fail("No paid completion is permitted"),
  );
  const checkpoints = [];
  await assert.rejects(
    extractNativeDiscoveryPayload(data.native, "openai/gpt-5.2", context, {
      max_input_bytes: 240000,
      max_output_tokens: 12000,
      before_call: createRoundCallGuard({
        mode: "live",
        research_models: [],
        extraction_model: "openai/gpt-5.2",
        synthesis_model: "openai/gpt-5.2",
        max_calls: 9,
        max_input_tokens_per_call: 240000,
        max_output_tokens_per_call: 12000,
        rates: [{ model: "openai/gpt-5.2", provider: "openai" }],
      }),
      on_checkpoint: (checkpoint) => checkpoints.push(checkpoint),
    }),
    { code: "MB-409-ROUND-ALLOWANCE" },
  );
  assert.equal(calls.length, 0);
  assert.equal(checkpoints.at(-1).dispatched, false);
  assert.match(checkpoints.at(-1).error, /MB-409-ROUND-ALLOWANCE/);
});

test("MB-UX-LIVE-001 L05 twenty rich records use bounded batches and account for every completion", async (t) => {
  const data = dataset(20);
  const original = structuredClone(data.native);
  let active = 0;
  let peak = 0;
  const calls = fixture(t, async (body) => {
    assert.equal(body.plugins, undefined);
    assert.deepEqual(input(body).buyer_mandatory_criteria, criteria);
    assert.equal(
      input(body).native_research_notes,
      schemaName(body) === INDEX ? original.text : undefined,
    );
    if (schemaName(body) === INDEX) return data.index;
    assert.equal(schemaName(body), BATCH);
    assert.equal(body.max_tokens, 24000);
    const names = input(body).assigned_candidate_names;
    assert.ok(names.length <= 5);
    assert.deepEqual(
      body.response_format.json_schema.schema.properties.candidates.items,
      {
        ...LIVE_DISCOVERY_SCHEMA.properties.candidates.items,
        properties: {
          ...LIVE_DISCOVERY_SCHEMA.properties.candidates.items.properties,
          legal_name: { type: "string", enum: names },
        },
      },
    );
    assert.equal(
      body.response_format.json_schema.schema.properties.candidates.maxItems,
      names.length,
    );
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return data.batch(names);
  });
  const events = [];
  const outputs = await Promise.all(
    [1, 2].map(() =>
      extractNativeDiscoveryPayload(data.native, "openai/gpt-5.2", context, {
        on_checkpoint: (event) => events.push(event),
      }),
    ),
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(calls.length, 10);
  for (const body of calls) {
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.max_completion_tokens ?? body.max_tokens, 24000);
  }
  for (const output of outputs) {
    assert.equal(output.results.length, 5);
    assert.equal(
      output.results.reduce((sum, result) => sum + result.input_tokens, 0),
      50,
    );
    assert.equal(
      output.results.reduce((sum, result) => sum + result.output_tokens, 0),
      100,
    );
    assert.equal(output.parsed.candidates.length, 20);
    assert.deepEqual(
      output.parsed.candidates,
      data.records.map((record) => record.candidate),
    );
    assert.ok(output.results.every((result) => result.is_byok));
  }
  assert.equal(
    events.filter((event) => event.state === "completed").length,
    10,
  );
  assert.ok(
    events.every(
      (event) =>
        event.request_timeout_ms === 600000 &&
        event.loop === 2 &&
        event.native_web === false,
    ),
  );
  assert.deepEqual(data.native, original);
  assert.equal(LIVE_DISCOVERY_SCHEMA.properties.candidates.maxItems, 40);
});

test("MB-UX-LIVE-001 L06 candidate index deduplicates grounded names and rejects absent names before batches", async (t) => {
  const data = dataset(1);
  let roster = {
    ...data.index,
    candidates: [data.index.candidates[0], data.index.candidates[0]],
  };
  const calls = fixture(t, (body) =>
    schemaName(body) === INDEX
      ? roster
      : data.batch(input(body).assigned_candidate_names),
  );
  const output = await extractNativeDiscoveryPayload(
    data.native,
    "openai/gpt-5.2",
    context,
  );
  assert.equal(output.parsed.candidates.length, 1);
  assert.equal(calls.length, 2);
  for (const bad of [
    {
      ...data.index,
      candidates: [
        { ...data.index.candidates[0], legal_name: "Invented Supplier" },
      ],
    },
    { candidates: [] },
  ]) {
    roster = bad;
    const count = calls.length;
    await assert.rejects(
      extractNativeDiscoveryPayload(data.native, "openai/gpt-5.2", context),
      (error) =>
        ["MB-422-LIVE-INDEX", "MB-422-LIVE-SCHEMA"].includes(error.code),
    );
    assert.equal(calls.length, count + 1);
  }
});

test("MB-UX-LIVE-001 L06 grounded index repairs are audited without granting new evidence", async (t) => {
  const data = dataset(1);
  const uncited = "https://invented.example.com/about";
  data.index.candidates[0].anchor_quote = `"${data.records[0].name} is independently certified."`;
  data.index.candidates[0].source_urls.push(uncited);
  const events = [];
  fixture(t, (body) => {
    if (schemaName(body) === INDEX) return data.index;
    assert.ok(
      input(body).native_citations.every(
        (citation) => citation.url !== uncited,
      ),
    );
    return data.batch(input(body).assigned_candidate_names);
  });
  const output = await extractNativeDiscoveryPayload(
    data.native,
    "openai/gpt-5.2",
    context,
    { on_checkpoint: (event) => events.push(event) },
  );
  const indexed = events.find(
    (event) => event.phase.endsWith("_index") && event.state === "completed",
  );
  assert.deepEqual(indexed.index_validation.discarded_source_urls, [uncited]);
  assert.deepEqual(indexed.index_validation.reanchored_names, [
    data.records[0].name,
  ]);
  assert.equal(events.filter((event) => event.state === "completed").length, 2);
  assert.equal(output.results.length, 2);
  assert.ok(
    indexed.response_content.includes("independently certified"),
    "Raw model audit remains immutable.",
  );
  assert.ok(!output.parsed.evidence.some((item) => item.url === uncited));
  assert.equal(output.parsed.candidates[0].certifications.length, 0);
});

test("MB-UX-LIVE-001 L05 batches reject missing duplicate or unassigned names", async (t) => {
  const data = dataset(2);
  let mutate = (payload) => payload;
  const calls = fixture(t, (body) => {
    if (schemaName(body) === INDEX) return data.index;
    const names = input(body).assigned_candidate_names;
    const schema =
      body.response_format.json_schema.schema.properties.candidates;
    assert.deepEqual(schema.items.properties.legal_name.enum, names);
    assert.equal(schema.minItems, names.length);
    assert.equal(schema.maxItems, names.length);
    return mutate(data.batch(names));
  });
  for (const change of [
    (payload) => ({ ...payload, candidates: payload.candidates.slice(0, 1) }),
    (payload) => ({
      ...payload,
      candidates: [payload.candidates[0], payload.candidates[0]],
    }),
    (payload) => ({
      ...payload,
      candidates: [
        { ...payload.candidates[0], legal_name: "Unassigned Company" },
        payload.candidates[1],
      ],
    }),
  ]) {
    mutate = change;
    const events = [];
    await assert.rejects(
      extractNativeDiscoveryPayload(data.native, "openai/gpt-5.2", context, {
        on_checkpoint: (event) => events.push(event),
      }),
      (error) =>
        ["MB-422-LIVE-SCHEMA", "MB-422-LIVE-EXTRACTION-SCOPE"].includes(
          error.code,
        ),
    );
    const failed = events.find((event) => event.state === "failed");
    assert.ok(failed.response_content);
    assert.equal(failed.input_tokens, 10);
    assert.equal(failed.is_byok, true);
  }
  assert.equal(calls.length, 6);
});

test("MB-UX-LIVE-001 L05 malformed active batch cancels its sibling and queued work without poisoning capacity", async (t) => {
  const data = dataset(16);
  let recover = false;
  let completeFirst;
  let siblingAborted = false;
  const calls = fixture(t, (body, signal) => {
    if (schemaName(body) === INDEX) return data.index;
    if (recover) return data.batch(input(body).assigned_candidate_names);
    if (input(body).batch_index === 1)
      return new Promise((resolve) => {
        completeFirst = resolve;
      });
    assert.equal(input(body).batch_index, 2);
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          siblingAborted = true;
          reject(signal.reason);
        },
        { once: true },
      );
      completeFirst('{"candidates":[');
    });
  });
  await assert.rejects(
    extractNativeDiscoveryPayload(data.native, "openai/gpt-5.2", context),
    (error) => error.code === "MB-422-LIVE-SCHEMA",
  );
  assert.equal(siblingAborted, true);
  assert.equal(calls.length, 3);
  recover = true;
  const next = await extractNativeDiscoveryPayload(
    data.native,
    "openai/gpt-5.2",
    context,
  );
  assert.equal(next.parsed.candidates.length, 16);
  assert.equal(next.results.length, 5);
});

test("MB-UX-LIVE-001 L05 caller cancellation stops active and queued extraction batches", async (t) => {
  const data = dataset(16);
  const controller = new AbortController();
  let running = 0;
  let aborted = 0;
  const calls = fixture(t, (body, signal) => {
    if (schemaName(body) === INDEX) return data.index;
    return new Promise((_resolve, reject) => {
      running++;
      signal.addEventListener(
        "abort",
        () => {
          aborted++;
          reject(signal.reason);
        },
        { once: true },
      );
      if (running === 2)
        queueMicrotask(() => controller.abort("Private cancellation reason"));
    });
  });
  await assert.rejects(
    extractNativeDiscoveryPayload(data.native, "openai/gpt-5.2", context, {
      signal: controller.signal,
    }),
    (error) =>
      error.code === "MB-503-LIVE-TRANSPORT" &&
      !error.message.includes("Private"),
  );
  assert.equal(aborted, 2);
  assert.equal(calls.length, 3);
});

test("MB-UX-LIVE-001 L05 shared registry evidence survives batches without permitting stitched or extraction-only proof", async (t) => {
  const data = dataset(6);
  fixture(t, (body) =>
    schemaName(body) === INDEX
      ? data.index
      : data.batch(input(body).assigned_candidate_names),
  );
  const extracted = await extractNativeDiscoveryPayload(
    data.native,
    "openai/gpt-5.2",
    context,
  );
  const evidence = new Map();
  ingestLiveEvidence(extracted.parsed, data.native.citations, evidence);
  const assembled = assembleLiveSuppliers(
    extracted.parsed.candidates,
    criteria,
    evidence,
    20,
  );
  assert.equal(assembled.candidates.length, 6);
  assert.ok(
    assembled.candidates.every((candidate) =>
      candidate.assessment.mandatory_constraint_results.every(
        (check) => check.satisfied,
      ),
    ),
  );
  const published = assembled.evidence_sources.find(
    (source) => source.source_url === data.registryUrl,
  );
  for (const record of data.records)
    assert.ok(published.excerpt_summary.includes(record.license));
  assert.match(published.excerpt_summary, /Verified excerpt 1:/);
  assert.equal(evidence.get(data.registryUrl).verified_excerpts.length, 6);
  const stitched = structuredClone(extracted.parsed.candidates[0]);
  stitched.constraints[1].quote = `${data.records[0].license}\n${data.records[1].license}`;
  const checked = assembleLiveSuppliers([stitched], criteria, evidence, 20);
  assert.equal(
    checked.candidates[0].assessment.mandatory_constraint_results[1].satisfied,
    false,
  );
  const foreign = structuredClone(extracted.parsed);
  foreign.evidence.push({
    url: "https://invented.example.com",
    title: "Invented",
    publisher: "Invented",
    source_type: "official_registry",
    excerpt: "Not native evidence.",
  });
  ingestLiveEvidence(foreign, data.native.citations, evidence);
  assert.equal(evidence.has("https://invented.example.com"), false);
});

test("MB-UX-LIVE-001 L05 conflicting shared source types cannot promote earlier certification evidence", () => {
  const data = dataset(1);
  const record = data.records[0];
  const url = `${new URL(record.url).origin}/certifications`;
  const claimed = `${record.name} claims ISO 9001 certification.`;
  const later = `${record.name} lists a separate license record.`;
  const citations = [
    ...data.native.citations,
    { url, title: "Certification statements", content: `${claimed}\n${later}` },
  ];
  const candidate = structuredClone(record.candidate);
  candidate.certifications = [
    {
      name: "ISO 9001",
      issuer: null,
      certificate_number: null,
      scope: "Industrial pumps",
      status: "unknown",
      valid_from: null,
      valid_until: null,
      source_urls: [url],
      quote: claimed,
    },
  ];
  for (const sourceType of ["official_website", "trade_directory"]) {
    for (const reverse of [false, true]) {
      const evidence = new Map();
      ingestLiveEvidence(data.batch([record.name]), citations, evidence);
      const entries = [
        {
          url,
          title: "Supplier statement",
          publisher: record.name,
          source_type: sourceType,
          excerpt: claimed,
        },
        {
          url,
          title: "Later classification",
          publisher: record.name,
          source_type: "official_registry",
          excerpt: later,
        },
      ];
      if (reverse) entries.reverse();
      for (const entry of entries)
        ingestLiveEvidence(
          {
            candidates: [],
            evidence: [entry],
            remaining_gaps: [],
            evidence_exhausted: false,
            summary: "",
          },
          citations,
          evidence,
        );
      assert.equal(evidence.get(url).source.source_type, sourceType);
      const assembled = assembleLiveSuppliers(
        [candidate],
        criteria,
        evidence,
        20,
      );
      assert.equal(assembled.candidates.length, 1);
      const certification = assembled.candidates[0].certifications[0];
      if (sourceType === "official_website") {
        assert.equal(certification.verification_status, "claimed");
        assert.equal(
          assembled.claims.find(
            (claim) => claim.field_path === "certifications",
          ).status,
          "supplier_claimed",
        );
        assert.equal(
          assembled.evidence_sources.find((source) => source.source_url === url)
            .source_type,
          "official_website",
        );
      } else {
        assert.equal(certification, undefined);
        assert.equal(
          assembled.claims.some(
            (claim) => claim.field_path === "certifications",
          ),
          false,
        );
      }
    }
  }
});
