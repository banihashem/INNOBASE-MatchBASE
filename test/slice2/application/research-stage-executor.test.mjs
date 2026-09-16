import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createResearchStageManifest,
  executeResearchStage,
  researchStageHash,
} from "../../../packages/application/dist/research-stage-executor.js";
import { researchRecoveryDisposition } from "../../../packages/application/dist/research-recovery-policy.js";
import { createRoundCallGuard } from "../../../packages/application/dist/consultant-research-cost.js";

const scope = "MB-ARCH-IMPLEMENT-001 L01";
test(`${scope} atomic admission replaces only the local count and retains model and capacity gates`, async () => {
  const plan = {
    mode: "demonstration",
    round_number: 1,
    research_models: ["approved/model"],
    extraction_model: "approved/model",
    synthesis_model: "approved/model",
    rates: [],
    max_calls: 1,
    max_input_tokens_per_call: 1024,
    max_output_tokens_per_call: 20,
  };
  const request = {
    model: "approved/model",
    messages: [{ role: "user", content: "Evidence" }],
    max_tokens: 10,
  };
  await assert.rejects(createRoundCallGuard(plan, 1)(request, false), {
    code: "MB-409-ROUND-ALLOWANCE",
  });
  const guard = createRoundCallGuard(plan, 1, { atomic_admission: true });
  await guard(request, false);
  await assert.rejects(
    guard({ ...request, model: "unapproved/model" }, false),
    { code: "MB-409-ROUND-MODEL" },
  );
  await assert.rejects(guard({ ...request, max_tokens: 21 }, false), {
    code: "MB-409-ROUND-ALLOWANCE",
  });
  await assert.rejects(
    guard(
      { ...request, messages: [{ role: "user", content: "x".repeat(2000) }] },
      false,
    ),
    { code: "MB-409-ROUND-ALLOWANCE" },
  );
});
const manifest = (changes = {}) =>
  createResearchStageManifest({
    stage_kind: "discovery:1:provider_response",
    qualification: "received_unvalidated",
    input: {
      notes: "Full original source.",
      citations: [{ url: "https://example.com/source", content: "evidence" }],
    },
    policy: {
      prompt: "version one",
      model: "approved/model",
      validator: "transport.v1",
    },
    ...changes,
  });

test(`${scope} manifests distinguish evidence and validation authority without key-order noise`, () => {
  assert.equal(
    researchStageHash({ a: 1, b: 2 }),
    researchStageHash({ b: 2, a: 1 }),
  );
  assert.notEqual(
    manifest().operation_key,
    manifest({ qualification: "validated_extraction" }).operation_key,
  );
  assert.notEqual(
    manifest().operation_key,
    manifest({ policy: { validator: "transport.v2" } }).operation_key,
  );
  assert.notEqual(
    manifest().operation_key,
    manifest({ input: { notes: "Changed original source." } }).operation_key,
  );
  assert.throws(() => researchStageHash({ count: Infinity }));
});

test(`${scope} a committed full receipt survives restart and is revalidated without another operation`, async () => {
  let record;
  let calls = 0;
  let validations = 0;
  const full = { text: "x".repeat(210000), source: "q".repeat(8000) };
  const store = {
    async load() {
      return record ?? null;
    },
    async commit(manifest, result) {
      record = structuredClone({ manifest, result });
    },
  };
  const run = () =>
    executeResearchStage({
      manifest: manifest(),
      store,
      execute: async () => {
        calls++;
        return full;
      },
      validate: (value) => {
        validations++;
        assert.equal(value.source.length, 8000);
        return value;
      },
    });
  assert.deepEqual(await run(), full);
  const resumed = await run();
  resumed.source = "caller mutation";
  assert.equal(record.result.source.length, 8000);
  assert.equal(record.result.text.length, 210000);
  assert.equal(calls, 1);
  assert.equal(validations, 2);
});

test(`${scope} corrupt or mis-scoped artifacts never become a paid retry`, async () => {
  for (const wrongManifest of [true, false]) {
    let calls = 0;
    const record = {
      manifest: wrongManifest
        ? manifest({ qualification: "validated_extraction" })
        : manifest(),
      result: { broken: true },
    };
    await assert.rejects(
      executeResearchStage({
        manifest: manifest(),
        store: {
          async load() {
            return record;
          },
          async commit() {
            assert.fail("No write expected");
          },
        },
        execute: async () => {
          calls++;
          return {};
        },
        validate: () => {
          throw new Error("Private diagnostic must not escape");
        },
      }),
      (error) => {
        assert.equal(error.code, "MB-409-STAGE-INTEGRITY");
        assert.doesNotMatch(error.message, /Private diagnostic/);
        return true;
      },
    );
    assert.equal(calls, 0);
  }
});

test(`${scope} cancelled work cannot load or publish a stage and commit failure remains terminal`, async () => {
  const cancellation = new AbortController();
  let commits = 0;
  const store = {
    async load() {
      return null;
    },
    async commit() {
      commits++;
    },
  };
  await assert.rejects(
    executeResearchStage({
      manifest: manifest(),
      store,
      signal: cancellation.signal,
      execute: async () => {
        cancellation.abort(new Error("Cancelled"));
        return { accepted: true };
      },
      validate: (value) => value,
    }),
    /Cancelled/,
  );
  assert.equal(commits, 0);
  let loaded = false;
  await assert.rejects(
    executeResearchStage({
      manifest: manifest(),
      signal: cancellation.signal,
      store: {
        ...store,
        async load() {
          loaded = true;
          return null;
        },
      },
      execute: async () => ({}),
      validate: (value) => value,
    }),
    /Cancelled/,
  );
  assert.equal(loaded, false);
  let calls = 0;
  await assert.rejects(
    executeResearchStage({
      manifest: manifest(),
      store: {
        ...store,
        async commit() {
          throw new Error("Fence revoked");
        },
      },
      execute: async () => {
        calls++;
        return {};
      },
      validate: (value) => value,
    }),
    /Fence revoked/,
  );
  assert.equal(calls, 1);
});

test(`${scope} recovery distinguishes ambiguous dispatch and mandatory authority stops`, () => {
  assert.equal(
    researchRecoveryDisposition({
      code: "MB-503-LIVE-TRANSPORT",
      dispatched: true,
      retryable: true,
    }),
    "outcome_unknown",
  );
  assert.equal(
    researchRecoveryDisposition({
      code: "MB-503-LIVE-TRANSPORT",
      dispatched: false,
      retryable: true,
    }),
    "bounded_retry",
  );
  assert.equal(
    researchRecoveryDisposition({
      code: "MB-502-LIVE-PROVIDER",
      retryable: true,
      provider_failure_category: "billing",
    }),
    "blocked_by_authority",
  );
  assert.equal(
    researchRecoveryDisposition({
      code: "MB-409-ROUND-ALLOWANCE",
      retryable: true,
    }),
    "blocked_by_authority",
  );
  assert.equal(
    researchRecoveryDisposition({ code: "MB-422-LIVE-JSON" }),
    "bounded_content_repair",
  );
  assert.equal(
    researchRecoveryDisposition({ code: "unknown" }),
    "incident_required",
  );
  assert.equal(
    researchRecoveryDisposition({
      code: "execution-lease-lost",
      retryable: true,
    }),
    "cancelled",
  );
});
