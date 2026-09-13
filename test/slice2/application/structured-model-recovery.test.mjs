import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LiveResearchError,
  selectApprovedStructuredRecovery,
  withLiveStageBudget,
} from "../../../packages/application/dist/openrouter-model-policy.js";

const scope = "MB-UX-QUALITY-001 L10";
const primary = "anthropic/claude-sonnet-5";
const alternate = "deepseek/deepseek-v4-pro";
const other = "openai/gpt-5.2";
const malformed = () =>
  new LiveResearchError("MB-422-LIVE-SCHEMA", "Invalid JSON schema.");
const runtimeName = (name) =>
  /^(?:MATCHBASE_|OPENROUTER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS)$|OPENAI_API_KEY$|GOOGLE_API_KEY$|GEMINI_API_KEY$)/.test(
    name,
  );

function rate(model, changes = {}) {
  return {
    model,
    provider: model === primary ? "amazon-bedrock" : "ionstream",
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

function fixture(t, changes = {}) {
  const previous = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => runtimeName(name)),
  );
  for (const name of Object.keys(previous)) delete process.env[name];
  t.after(() => {
    for (const name of Object.keys(process.env))
      if (runtimeName(name)) delete process.env[name];
    Object.assign(process.env, previous);
  });
  t.mock.method(globalThis, "fetch", () => {
    assert.fail(
      "A model-selection helper must never dispatch network requests.",
    );
  });
  let guarded = 0;
  const options = {
    automatic_recovery_attempts: 3,
    before_call: async () => {
      guarded++;
    },
    approved_rates: Object.freeze([
      Object.freeze(rate(primary)),
      Object.freeze(rate(alternate)),
    ]),
    approved_model_fallbacks: Object.freeze({
      [primary]: Object.freeze([alternate]),
    }),
    ...changes,
  };
  const budget = withLiveStageBudget(options);
  return {
    options: budget.options,
    remaining: budget.remaining,
    guarded: () => guarded,
    consume: (model = primary) =>
      budget.options.before_call({ model, messages: [] }, false),
  };
}

for (const code of ["MB-422-LIVE-SCHEMA", "MB-422-LIVE-JSON"]) {
  test(`${scope} local ${code} selects only the priced structural alternative`, async (t) => {
    const f = fixture(t);
    await f.consume();
    const before = JSON.stringify({
      rates: f.options.approved_rates,
      fallbacks: f.options.approved_model_fallbacks,
    });
    assert.deepEqual(
      selectApprovedStructuredRecovery(
        primary,
        new LiveResearchError(code, "Invalid output."),
        f.options,
      ),
      {
        original_model: primary,
        next_model: alternate,
      },
    );
    assert.equal(
      f.options.stage_recovery_state.replacements.get(primary),
      alternate,
    );
    assert.equal(f.remaining(), 2);
    assert.equal(f.guarded(), 1);
    assert.equal(
      JSON.stringify({
        rates: f.options.approved_rates,
        fallbacks: f.options.approved_model_fallbacks,
      }),
      before,
    );
  });
}

test(`${scope} selected alternative persists without resetting the three-call stage allowance`, async (t) => {
  const f = fixture(t);
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), f.options),
    undefined,
  );
  await f.consume();
  const first = selectApprovedStructuredRecovery(
    primary,
    malformed(),
    f.options,
  );
  await f.consume(alternate);
  assert.deepEqual(
    selectApprovedStructuredRecovery(primary, malformed(), f.options),
    first,
  );
  assert.equal(f.remaining(), 1);
  await f.consume(alternate);
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), f.options),
    undefined,
  );
  assert.equal(f.remaining(), 0);
  assert.equal(f.guarded(), 3);
  await assert.rejects(f.consume(alternate), /MB-409-STAGE-ALLOWANCE/);
  assert.equal(f.guarded(), 3);
});

for (const [name, changes] of [
  ["a legacy approval without alternatives", { approved_model_fallbacks: {} }],
  [
    "an alternative listed for another primary",
    { approved_model_fallbacks: { [other]: [alternate] } },
  ],
  [
    "more than one alternative",
    { approved_model_fallbacks: { [primary]: [alternate, other] } },
  ],
  [
    "the original model as its own alternative",
    { approved_model_fallbacks: { [primary]: [primary] } },
  ],
  [
    "an alternative without an approved rate",
    { approved_rates: [rate(primary)] },
  ],
  ["a primary without an approved rate", { approved_rates: [rate(alternate)] }],
  [
    "a cross-billing alternative",
    {
      approved_rates: [
        rate(primary),
        rate(alternate, { billing_mode: "byok" }),
      ],
    },
  ],
  [
    "an endpoint without structured outputs",
    {
      approved_rates: [
        rate(primary),
        rate(alternate, { structured_outputs: false }),
      ],
    },
  ],
  [
    "an endpoint without required deep reasoning",
    {
      reasoning_effort: "high",
      approved_rates: [rate(primary), rate(alternate, { reasoning: false })],
    },
  ],
]) {
  test(`${scope} structured recovery rejects ${name}`, async (t) => {
    const f = fixture(t, changes);
    await f.consume();
    assert.equal(
      selectApprovedStructuredRecovery(primary, malformed(), f.options),
      undefined,
    );
    assert.equal(f.options.stage_recovery_state.replacements.size, 0);
    assert.equal(f.remaining(), 2);
  });
}

test(`${scope} low-reasoning extraction does not require an unrequested reasoning capability or web route`, async (t) => {
  const f = fixture(t, {
    approved_rates: [rate(primary), rate(alternate, { reasoning: false })],
  });
  await f.consume();
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), f.options)
      .next_model,
    alternate,
  );
});

for (const code of [
  "MB-422-LIVE-INDEX",
  "MB-422-LIVE-EXTRACTION-SCOPE",
  "MB-422-LIVE-EVIDENCE",
  "MB-422-LIVE-OUTPUT-LIMIT",
  "MB-503-LIVE-TRANSPORT",
  "MB-502-LIVE-PROVIDER",
  "MB-503-LIVE-CHECKPOINT",
  "MB-409-ROUND-ALLOWANCE",
  "MB-409-STAGE-ALLOWANCE",
  "MB-403-LIVE-POLICY",
  "MB-403-LIVE-BYOK",
]) {
  test(`${scope} structural helper never reclassifies ${code}`, async (t) => {
    const f = fixture(t);
    await f.consume();
    assert.equal(
      selectApprovedStructuredRecovery(
        primary,
        new LiveResearchError(code, "Do not replace this failure.", true),
        f.options,
      ),
      undefined,
    );
    assert.equal(f.options.stage_recovery_state.replacements.size, 0);
  });
}

test(`${scope} structural recovery requires a real error, guard, stage and live cancellation signal`, async (t) => {
  const abort = new AbortController();
  const f = fixture(t, { signal: abort.signal });
  await f.consume();
  assert.equal(
    selectApprovedStructuredRecovery(
      primary,
      { code: "MB-422-LIVE-SCHEMA" },
      f.options,
    ),
    undefined,
  );
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), {
      ...f.options,
      before_call: undefined,
    }),
    undefined,
  );
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), {
      ...f.options,
      stage_recovery_state: undefined,
    }),
    undefined,
  );
  abort.abort();
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), f.options),
    undefined,
  );
  assert.equal(f.options.stage_recovery_state.replacements.size, 0);
});

test(`${scope} structural recovery cannot replace an existing stage decision or form a model chain`, async (t) => {
  const f = fixture(t, {
    approved_rates: [rate(primary), rate(alternate), rate(other)],
    approved_model_fallbacks: { [primary]: [alternate], [alternate]: [other] },
  });
  await f.consume();
  const replacements = f.options.stage_recovery_state.replacements;
  replacements.set(primary, other);
  assert.equal(
    selectApprovedStructuredRecovery(primary, malformed(), f.options),
    undefined,
  );
  assert.equal(replacements.get(primary), other);
  replacements.set(primary, alternate);
  assert.equal(
    selectApprovedStructuredRecovery(alternate, malformed(), f.options),
    undefined,
  );
  assert.equal(replacements.has(alternate), false);
});
