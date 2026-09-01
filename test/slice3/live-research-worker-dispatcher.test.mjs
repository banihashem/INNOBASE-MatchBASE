import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveResearchExecutionService,
  QualifiedLiveResearchWorkerDispatcher,
} from "../../packages/application/dist/index.js";
import { LIVE_WORKER_FIXTURE_POLICY } from "./fixtures/live-worker-runtime.mjs";

const policyId = "00000000-0000-4000-8000-000000000201";
const accountId = "00000000-0000-4000-8000-000000000202";
const userId = "00000000-0000-4000-8000-000000000203";

function work(runId, tier) {
  return {
    run_id: runId,
    account_id: accountId,
    requested_by_user_id: userId,
    tier_at_submission: tier,
  };
}

function fixture(rows, now = "2026-09-01T00:00:00.000Z") {
  const calls = [];
  const executed = [];
  const pool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("FROM research_route_policy"))
        return {
          rows: [{ research_route_policy_id: policyId }],
          rowCount: 1,
        };
      if (text.includes("FROM research_run r")) {
        assert.match(
          text,
          /tier_at_submission IN \('demo','standard','consultant'\)/u,
        );
        assert.match(text, /research_mode='qualified_live_research'/u);
        return { rows, rowCount: rows.length };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const dispatcher = new QualifiedLiveResearchWorkerDispatcher({
    pool,
    policy: LIVE_WORKER_FIXTURE_POLICY,
    outputSchema: {},
    now: () => new Date(now),
    serviceFactory: (selected, exactPolicyId) => {
      assert.equal(exactPolicyId, policyId);
      const service = new LiveResearchExecutionService({});
      service.execute = async (input) => {
        executed.push({ selected, input });
        return {};
      };
      return service;
    },
  });
  return { calls, dispatcher, executed };
}

test("dispatches a queued Consultant qualified-live run through the existing live execution service", async () => {
  const runId = "00000000-0000-4000-8000-000000000204";
  const current = fixture([work(runId, "consultant")]);
  assert.equal(await current.dispatcher.readiness(), true);

  assert.deepEqual(
    await current.dispatcher.dispatchNext(new AbortController().signal),
    [runId],
  );
  assert.equal(current.executed.length, 1);
  assert.deepEqual(current.executed[0].selected, {
    runId,
    accountId,
    userId,
    tier: "consultant",
  });
  assert.equal(
    current.executed[0].input.executionId,
    `LIVE:${LIVE_WORKER_FIXTURE_POLICY.policyVersion}:${runId}`,
  );
});

test("worker readiness and dispatch close when route-policy evidence expires", async () => {
  const current = fixture(
    [work("00000000-0000-4000-8000-000000000208", "demo")],
    "2026-09-15T00:00:00.001Z",
  );
  assert.equal(await current.dispatcher.readiness(), false);
  assert.deepEqual(
    await current.dispatcher.dispatchNext(new AbortController().signal),
    [],
  );
  assert.equal(current.calls.length, 0);
  assert.equal(current.executed.length, 0);
});

test("preserves Demo and Standard dispatch while adding Consultant selection", async () => {
  const rows = [
    work("00000000-0000-4000-8000-000000000205", "demo"),
    work("00000000-0000-4000-8000-000000000206", "standard"),
    work("00000000-0000-4000-8000-000000000207", "consultant"),
  ];
  const current = fixture(rows);

  assert.deepEqual(
    await current.dispatcher.dispatchNext(new AbortController().signal),
    rows.map((row) => row.run_id),
  );
  assert.deepEqual(
    current.executed.map((entry) => entry.selected.tier),
    ["demo", "standard", "consultant"],
  );
  const selection = current.calls.find((call) =>
    call.text.includes("FROM research_run r"),
  );
  assert.deepEqual(selection.values, [3]);
});
