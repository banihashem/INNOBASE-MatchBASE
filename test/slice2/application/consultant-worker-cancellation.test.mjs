import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { runNextConsultantWorkflowJob } from "../../../packages/application/dist/consultant-workflow-worker.js";

function fixture(t) {
  const names = [
    "MATCHBASE_OPENROUTER_API_KEY",
    "OPENROUTER_API_KEY",
    "MATCHBASE_PROVIDER_GOOGLE",
    "MATCHBASE_PROVIDER_OPENAI",
    "MATCHBASE_MODEL_GEMINI",
    "MATCHBASE_MODEL_OPENAI",
    "MATCHBASE_MODEL_PREPARATION",
    "MATCHBASE_MODEL_SYNTHESIS",
  ];
  const originalEnvironment = new Map(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  t.after(() => {
    for (const [name, value] of originalEnvironment)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });

  const identity = {
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
  };
  const job = {
    ...identity,
    job_id: randomUUID(),
    lease_token: randomUUID(),
    stage: "research",
    mode: "live",
    status: "running",
  };
  const session = {
    ...identity,
    session_id: randomUUID(),
    current_state: "research_dispatching",
    original_intake: {
      ...identity,
      product_requirement: "Industrial pumps",
      technical_compliance: "",
      order_profile: "",
    },
    approved_request_revision: {
      revision_id: randomUUID(),
      english_translation: "Industrial pumps",
      product_name: "Industrial pumps",
      product_category: "Pumps",
      key_specifications: ["Industrial pumps"],
    },
    deep_prompt_revision: {
      is_approved: true,
      prompt_text:
        "Research industrial pump manufacturers using primary sources.",
      discovery_criteria: ["Industrial pumps"],
    },
    workflow_metadata: {
      mode: "live",
      classification_id: identity.classification_id,
    },
    created_at: new Date(),
    updated_at: new Date(),
  };
  const state = {
    renew: "valid",
    renewals: 0,
    writes: [],
    finished: [],
    requests: [],
    heartbeat: null,
    heartbeatCleared: false,
  };
  const timer = { unref() {} };
  t.mock.method(globalThis, "setInterval", (callback, delay) => {
    assert.equal(delay, 20_000);
    state.heartbeat = callback;
    return timer;
  });
  t.mock.method(globalThis, "clearInterval", (value) => {
    assert.equal(value, timer);
    state.heartbeatCleared = true;
  });

  // Real worker, service, orchestrator and transport code run against only these
  // controlled SQL and HTTP boundaries. No database or provider connection is opened.
  const db = {
    async query(sql, params = []) {
      if (sql.startsWith("WITH expired AS")) return { rows: [] };
      if (sql.includes("SET status='running', lease_token"))
        return { rows: [job] };
      if (sql.includes("SET lease_until=")) {
        state.renewals += 1;
        if (state.renew === "error")
          throw new Error("Synthetic lease database error");
        return {
          rows: state.renew === "valid" ? [{ job_id: job.job_id }] : [],
        };
      }
      if (sql.startsWith("SELECT * FROM consultant_workflow_session"))
        return { rows: [session] };
      if (sql.includes("SET status=$3, error_code=$4")) {
        state.finished.push(params);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO consultant_workflow_event")) {
        state.writes.push({ type: "event", phase: params[5] });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO consultant_workflow_session")) {
        state.writes.push({ type: "session", state: params[4] });
        return { rows: [] };
      }
      assert.fail(`Unexpected SQL boundary: ${sql.slice(0, 90)}`);
    },
  };
  t.mock.method(globalThis, "fetch", async (target, options) => {
    const url = String(target);
    if (url.endsWith("/models/user"))
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
    if (url.endsWith("/endpoints"))
      return Response.json({
        data: {
          endpoints: [
            {
              tag: url.includes("/google/") ? "google-ai-studio" : "openai",
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
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.plugins[0].engine, "native");
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const abort = () => reject(signal.reason);
      const release = () => {
        signal.removeEventListener("abort", abort);
        resolve(
          Response.json(
            { error: { message: "Synthetic upstream failure" } },
            { status: 502 },
          ),
        );
      };
      state.requests.push({ signal, release });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  });
  t.after(() => state.requests.forEach(({ release }) => release()));
  return { db, state };
}

async function waitForBothLanes(state) {
  for (let turn = 0; turn < 80 && state.requests.length < 2; turn += 1)
    await setImmediate();
  assert.equal(
    state.requests.length,
    2,
    "Both native requests must be pending before lease changes.",
  );
}

test("MB-UX-LIVE-001 L04 healthy lease keeps pending native requests active without an automatic retry", async (t) => {
  const { db, state } = fixture(t);
  const running = runNextConsultantWorkflowJob(db);
  await waitForBothLanes(state);
  const previousRenewals = state.renewals;
  state.heartbeat();
  await setImmediate();
  assert.ok(state.renewals > previousRenewals);
  assert.ok(state.requests.every(({ signal }) => !signal.aborted));

  for (const request of state.requests) request.release();
  assert.equal(await running, true);
  assert.ok(state.requests.every(({ signal }) => !signal.aborted));
  assert.equal(state.requests.length, 2);
  assert.equal(state.finished.length, 1);
  assert.equal(state.finished[0][2], "failed");
  assert.ok(state.writes.some((write) => write.state === "workflow_failed"));
  assert.ok(state.heartbeatCleared);
});

for (const renewal of ["invalid", "error"])
  test(`MB-UX-LIVE-001 L04 ${renewal} heartbeat cancels both pending lanes without stale-owner writes`, async (t) => {
    const { db, state } = fixture(t);
    const running = runNextConsultantWorkflowJob(db);
    await waitForBothLanes(state);
    const writesBeforeLoss = state.writes.length;
    state.renew = renewal;
    state.heartbeat();

    assert.equal(await running, true);
    for (const { signal } of state.requests) {
      assert.ok(signal.aborted);
      assert.equal(signal.reason.code, "execution-lease-lost");
    }
    assert.equal(state.requests.length, 2);
    assert.equal(state.writes.length, writesBeforeLoss);
    assert.equal(state.finished.length, 0);
    assert.ok(state.heartbeatCleared);
  });

test("MB-UX-LIVE-001 L04 checkpoint renewal failure aborts sibling I/O before stale failure publication", async (t) => {
  const { db, state } = fixture(t);
  const running = runNextConsultantWorkflowJob(db);
  await waitForBothLanes(state);
  const writesBeforeLoss = state.writes.length;
  state.renew = "error";
  // A provider response enters the normal failure checkpoint before the next heartbeat.
  state.requests[0].release();

  assert.equal(await running, true);
  assert.ok(state.requests[1].signal.aborted);
  assert.equal(state.requests[1].signal.reason.code, "execution-lease-lost");
  assert.equal(state.requests.length, 2);
  assert.equal(state.writes.length, writesBeforeLoss);
  assert.equal(state.finished.length, 0);
  assert.ok(state.heartbeatCleared);
});
