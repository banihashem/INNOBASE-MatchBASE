import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { suggestInterpretationCorrection } from "../../../packages/application/dist/interpretation-correction.js";
import { summarizeResearchCosts } from "../../../packages/application/dist/consultant-research-cost.js";

const good =
  "We need industrial tanks with storage capacity 100 liters. Preserve our custom packing note.";
const bad =
  "We need industrial tanks with storage capacity 200 liters. Preserve our custom packing note.";
const omitted = "We need industrial tanks. Preserve our custom packing note.";
const model = "openai/gpt-5.2";
function fixture(t, saved = bad) {
  const state = {
    reads: 0,
    writes: [],
    posts: [],
    onRead: null,
    onPost: null,
    row: {
      session_id: randomUUID(),
      account_id: randomUUID(),
      run_id: randomUUID(),
      user_profile_id: randomUUID(),
      current_state: "prep_step1_awaiting_approval",
      original_intake: {
        product_requirement: good,
        technical_compliance: "",
        order_profile: "",
      },
      draft_revision: { revision_id: randomUUID(), english_translation: saved },
      approved_request_revision: null,
      execution_id: randomUUID(),
      classification: { classification_id: randomUUID() },
      is_invalidated: false,
      workflow_metadata: {
        mode: "live",
        step1_interpretation: {
          english_translation: saved,
          is_approved: false,
        },
      },
      created_at: new Date(),
      updated_at: new Date(),
    },
    payload: {
      text: good,
      changes: [
        "Restore the explicitly requested 100-liter storage capacity; retain the packing note.",
      ],
    },
    upstream: 0.042,
    platform: 0.003,
    byok: true,
  };
  const names = [
    "MATCHBASE_OPENROUTER_API_KEY",
    "MATCHBASE_MODEL_PREPARATION",
    "MATCHBASE_PROVIDER_OPENAI",
  ];
  const old = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_MODEL_PREPARATION = model;
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  t.after(() => {
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(globalThis, "fetch", async (target, options = {}) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
      return Response.json({
        data: [
          {
            id: model,
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
              model_id: model,
              supported_parameters: [
                "structured_outputs",
                "reasoning",
                "max_tokens",
              ],
            },
          ],
        },
      });
    assert.equal(
      url,
      "https://openrouter.ai/api/v1/chat/completions",
      "No web research or unrelated endpoint is allowed",
    );
    state.posts.push(JSON.parse(options.body));
    await state.onPost?.();
    if (state.responseStatus && state.responseStatus !== 200)
      return Response.json(
        { error: { message: "Synthetic provider failure" } },
        { status: state.responseStatus },
      );
    return Response.json({
      id: `gen-correction-test-${state.posts.length}`,
      model,
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(state.payload) },
        },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 70,
        ...(state.platform === undefined ? {} : { cost: state.platform }),
        cost_details: { upstream_inference_cost: state.upstream },
      },
      openrouter_metadata: {
        requested: model,
        strategy: "direct",
        attempt: 1,
        is_byok: state.byok,
        endpoints: {
          available: [{ provider: "OpenAI", model, selected: true }],
        },
      },
    });
  });
  const db = {
    async query(sql, params) {
      if (sql.startsWith("SELECT * FROM consultant_workflow_session")) {
        state.reads++;
        await state.onRead?.();
        return {
          rows:
            state.row &&
            state.row.account_id === params[0] &&
            state.row.run_id === params[1]
              ? [structuredClone(state.row)]
              : [],
          rowCount: state.row ? 1 : 0,
        };
      }
      assert.match(
        sql,
        /^INSERT INTO consultant_(?:provider_call|workflow_event)/,
        "No source, approval, session, job, or result mutation is allowed",
      );
      state.writes.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
  state.invoke = (text = bad, overrides = {}) =>
    suggestInterpretationCorrection(
      db,
      overrides.accountId ?? state.row.account_id,
      overrides.userId ?? state.row.user_profile_id,
      overrides.runId ?? state.row.run_id,
      text,
    );
  state.costEvents = () =>
    state.writes
      .filter((write) =>
        write.sql.startsWith("INSERT INTO consultant_provider_call"),
      )
      .map((write) => ({
        execution_id: write.params[4],
        phase: write.params[6],
        detail: JSON.parse(write.params[7]),
      }));
  return state;
}

test("valid current wording returns unchanged without provider calls or state mutations", async (t) => {
  const s = fixture(t);
  const original = structuredClone(s.row);
  const result = await s.invoke(good);
  assert.equal(result.source, "current_interpretation");
  assert.equal(result.suggested_translation, good);
  assert.equal(result.original_translation, good);
  assert.deepEqual(result.changes, []);
  assert.equal(result.cost_usd, 0);
  assert.equal(result.fidelity.valid, true);
  assert.deepEqual(s.row, original);
  assert.equal(s.posts.length + s.writes.length, 0);
});

test("valid saved wording is offered as a free preview, preserving the user's current text", async (t) => {
  const s = fixture(t, good);
  const result = await s.invoke(omitted);
  assert.equal(result.source, "saved_interpretation");
  assert.equal(result.original_translation, omitted);
  assert.equal(result.suggested_translation, good);
  assert.equal(result.cost_usd, 0);
  assert.match(result.changes.join(" "), /may replace your edits/);
  assert.equal(s.posts.length + s.writes.length, 0);
  assert.equal(s.row.approved_request_revision, null);
});

test("ownership and bounded input checks reject without exposing or mutating a session", async (t) => {
  const s = fixture(t);
  for (const overrides of [
    { accountId: randomUUID() },
    { userId: randomUUID() },
    { runId: randomUUID() },
  ])
    await assert.rejects(
      s.invoke(bad, overrides),
      (error) => error.status === 404,
    );
  for (const input of ["", " ", "x".repeat(24001), null, {}])
    await assert.rejects(
      s.invoke(input),
      (error) => error.code === "MB-400-CORRECTION-INPUT",
    );
  assert.equal(s.posts.length + s.writes.length, 0);
});

test("approved, invalidated, cancelled, or nonpending requests cannot request corrections", async (t) => {
  const s = fixture(t);
  const baseline = structuredClone(s.row);
  for (const changes of [
    { current_state: "research_dispatching" },
    { approved_request_revision: { revision_id: randomUUID() } },
    { is_invalidated: true },
    { last_checkpoint: "user_cancelled" },
    {
      workflow_metadata: {
        ...baseline.workflow_metadata,
        step1_interpretation: { english_translation: bad, is_approved: true },
      },
    },
  ]) {
    s.row = { ...structuredClone(baseline), ...changes };
    await assert.rejects(
      s.invoke(),
      (error) => error.code === "MB-409-CORRECTION-STATE",
    );
  }
  assert.equal(s.posts.length + s.writes.length, 0);
});

test("AI correction makes one low-reasoning BYOK call and records complete preparation cost with original identities", async (t) => {
  const s = fixture(t);
  const original = structuredClone(s.row);
  const result = await s.invoke();
  assert.equal(result.source, "ai_correction");
  assert.equal(result.original_translation, bad);
  assert.equal(result.suggested_translation, good);
  assert.equal(result.fidelity.valid, true);
  assert.equal(result.cost_usd, 0.045);
  assert.deepEqual(s.row, original);
  assert.equal(s.posts.length, 1);
  const body = s.posts[0];
  assert.equal(body.reasoning.effort, "low");
  assert.deepEqual(body.provider.only, ["openai"]);
  assert.equal(body.provider.allow_fallbacks, false);
  assert.equal(body.plugins, undefined);
  assert.ok((body.max_tokens ?? body.max_completion_tokens) <= 8000);
  const input = JSON.parse(body.messages[1].content);
  assert.deepEqual(input.original_intake, original.original_intake);
  assert.equal(input.current_translation, bad);
  const events = s.costEvents();
  assert.ok(events.length >= 2);
  assert.equal(new Set(events.map((event) => event.detail.request_id)).size, 1);
  for (const write of s.writes.filter((write) =>
    write.sql.startsWith("INSERT INTO consultant_provider_call"),
  )) {
    assert.deepEqual(write.params.slice(1, 6), [
      original.account_id,
      original.user_profile_id,
      original.run_id,
      original.execution_id,
      original.classification.classification_id,
    ]);
    assert.equal(JSON.parse(write.params[7]).response_content, undefined);
  }
  const costs = summarizeResearchCosts(events);
  assert.equal(costs.preparation_usd, 0.045);
  assert.equal(costs.research_usd, 0);
  assert.equal(costs.calls, 1);
});

test("L03 repeated invalid suggestions exhaust three shared attempts and retain every billed call", async (t) => {
  const s = fixture(t);
  s.payload = { text: bad, changes: ["No actual repair."] };
  await assert.rejects(
    s.invoke(),
    (error) => error.code === "MB-422-CORRECTION-FIDELITY",
  );
  assert.equal(s.posts.length, 3);
  assert.equal(s.row.approved_request_revision, null);
  assert.equal(
    s.row.workflow_metadata.step1_interpretation.english_translation,
    bad,
  );
  assert.equal(
    summarizeResearchCosts(s.costEvents()).recorded_total_usd,
    0.135,
  );
  const feedback = JSON.parse(
    s.posts[1].messages[1].content,
  ).previous_attempt_feedback;
  assert.equal(feedback.code, "MB-422-CORRECTION-FIDELITY");
  assert.ok(feedback.mutated.length > 0);
  assert.match(feedback.rejected_response, /200 liters/);
  const validationEvents = s.writes
    .filter(
      (w) =>
        w.sql.startsWith("INSERT INTO consultant_workflow_event") &&
        w.params[5] === "step1_correction_validation",
    )
    .map((w) => JSON.parse(w.params[6]));
  assert.ok(validationEvents.every((e) => e.loop === 1));
  assert.deepEqual(
    validationEvents.map((e) => e.state),
    ["started", "retrying", "retrying", "failed"],
  );
});

test("L03 a rejected correction is automatically repaired without changing user edits or approvals", async (t) => {
  const s = fixture(t);
  const original = structuredClone(s.row);
  s.onPost = () => {
    s.payload = {
      text: s.posts.length === 1 ? bad : good,
      changes: ["Restore requested capacity."],
    };
  };
  const result = await s.invoke();
  assert.equal(result.suggested_translation, good);
  assert.equal(result.recovered, true);
  assert.equal(result.attempts_used, 2);
  assert.equal(result.cost_usd, 0.09);
  assert.deepEqual(s.row, original);
  const validations = s.writes
    .filter((w) => w.sql.startsWith("INSERT INTO consultant_workflow_event"))
    .map((w) => JSON.parse(w.params.at(-1)))
    .filter((e) => e.operation === "correction_validation");
  assert.deepEqual(
    validations.map((e) => e.state),
    ["started", "retrying", "completed"],
  );
  assert.ok(validations.every((e) => e.loop === 1));
});

test("L03 schema failures are repaired with feedback within the same three-call allowance", async (t) => {
  const s = fixture(t);
  s.onPost = () => {
    s.payload =
      s.posts.length < 3
        ? { wrong: "shape" }
        : { text: good, changes: ["Restored capacity."] };
  };
  const result = await s.invoke();
  assert.equal(result.attempts_used, 3);
  assert.equal(result.cost_usd, 0.135);
  assert.equal(
    JSON.parse(s.posts[1].messages[1].content).previous_attempt_feedback.code,
    "MB-422-LIVE-SCHEMA",
  );
});

test("L03 transport and fidelity recovery share a maximum of three provider calls", async (t) => {
  const s = fixture(t);
  s.onPost = () => {
    s.responseStatus = s.posts.length === 2 ? 503 : 200;
    s.payload = { text: bad, changes: ["Still wrong."] };
  };
  await assert.rejects(
    s.invoke(),
    (e) => e.code === "MB-422-CORRECTION-FIDELITY",
  );
  assert.equal(s.posts.length, 3);
  assert.equal(s.row.approved_request_revision, null);
});

test("L03 provider permission denials are not retried as response repair", async (t) => {
  const s = fixture(t);
  s.responseStatus = 403;
  await assert.rejects(s.invoke(), /403/);
  assert.equal(s.posts.length, 1);
});

test("L03 a state change after rejection prevents the next correction attempt", async (t) => {
  const s = fixture(t);
  s.payload = { text: bad, changes: ["Still wrong."] };
  s.onRead = () => {
    if (s.posts.length === 1) s.row.current_state = "prep_step1_approved";
  };
  await assert.rejects(s.invoke(), (e) => e.code === "MB-409-CORRECTION-STATE");
  assert.equal(s.posts.length, 1);
});

test("stale or approved sessions discard completed suggestions but preserve the provider charge", async (t) => {
  const s = fixture(t);
  s.onPost = () => {
    s.row.execution_id = randomUUID();
  };
  const originalExecution = s.row.execution_id;
  await assert.rejects(
    s.invoke(),
    (error) => error.code === "MB-409-CORRECTION-STALE",
  );
  const costs = summarizeResearchCosts(s.costEvents());
  assert.equal(costs.by_execution[originalExecution].recorded_usd, 0.045);
  assert.equal(costs.by_execution[s.row.execution_id], undefined);
  assert.equal(s.row.approved_request_revision, null);
});

test("a pre-dispatch approval change prevents the paid completion call", async (t) => {
  const s = fixture(t);
  s.onRead = () => {
    if (s.reads === 2) s.row.current_state = "prep_step1_approved";
  };
  await assert.rejects(
    s.invoke(),
    (error) => error.code === "MB-409-CORRECTION-STATE",
  );
  assert.equal(s.posts.length, 0);
  assert.equal(summarizeResearchCosts(s.costEvents()).calls, 0);
});

test("concurrent identical previews share one call; differing text cannot create another call", async (t) => {
  const s = fixture(t);
  let release, started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  s.onPost = () => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = s.invoke();
  await waiting;
  const second = s.invoke();
  await assert.rejects(
    s.invoke(omitted),
    (error) => error.code === "MB-409-CORRECTION-IN-PROGRESS",
  );
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(s.posts.length, 1);
  assert.equal(summarizeResearchCosts(s.costEvents()).calls, 1);
});

test("demonstration mode and missing accounting lineage never start an AI correction", async (t) => {
  const s = fixture(t);
  s.row.workflow_metadata.mode = "demonstration";
  await assert.rejects(
    s.invoke(),
    (error) => error.code === "MB-409-CORRECTION-LIVE-REQUIRED",
  );
  s.row.workflow_metadata.mode = "live";
  s.row.execution_id = null;
  await assert.rejects(
    s.invoke(),
    (error) => error.code === "MB-409-CORRECTION-LINEAGE",
  );
  assert.equal(s.posts.length + s.writes.length, 0);
});

test("missing cost metadata remains explicitly unknown while retaining recorded partial costs", async (t) => {
  const s = fixture(t);
  s.platform = undefined;
  const result = await s.invoke();
  assert.equal(result.cost_usd, null);
  const costs = summarizeResearchCosts(s.costEvents());
  assert.equal(costs.complete, false);
  assert.equal(costs.recorded_total_usd, 0.042);
  assert.equal(costs.unpriced_calls, 1);
});

test("non-BYOK responses are rejected and their billed cost remains recorded", async (t) => {
  const s = fixture(t);
  s.byok = false;
  await assert.rejects(s.invoke(), /BYOK/);
  assert.equal(s.posts.length, 1);
  assert.equal(s.row.approved_request_revision, null);
  assert.equal(s.costEvents().at(-1).detail.state, "failed");
  assert.equal(s.costEvents().at(-1).detail.cost_usd, 0.003);
});
