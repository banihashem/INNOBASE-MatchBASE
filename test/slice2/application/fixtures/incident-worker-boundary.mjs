import { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  recordResearchIncident,
  withBoundedResearchIncidentStore,
} from "../../../../packages/data/dist/consultant-research-incidents.js";

const mode = process.argv[2];
const original = new Error("Original synthetic provider failure");
const job = Object.fromEntries(
  [
    "account_id",
    "user_profile_id",
    "run_id",
    "execution_id",
    "classification_id",
    "job_id",
    "lease_token",
  ].map((key) => [key, randomUUID()]),
);
Object.assign(job, { stage: "research", mode: "fixture" });
const state = {
  marked: 0,
  finished: 0,
  heartbeatCleared: false,
  releases: [],
  connects: 0,
};
const timer = { unref() {} };
globalThis.setInterval = () => timer;
globalThis.clearInterval = () => {
  state.heartbeatCleared = true;
};
mock.module("../../../../packages/data/dist/index.js", {
  namedExports: {
    claimConsultantWorkflowJob: async () => job,
    failExpiredConsultantWorkflowJobs: async () => {},
    finishConsultantWorkflowJob: async () => {
      state.finished++;
    },
    renewConsultantWorkflowJobLease: async () => true,
    recordResearchIncident,
    withBoundedResearchIncidentStore,
  },
});
mock.module("../../../../packages/application/dist/consultant-v3-service.js", {
  namedExports: {
    executeConsultantWorkflowResearch: async () => {
      throw original;
    },
    generateApprovedConsultantPreparation: async () =>
      assert.fail("Unexpected prepare"),
    getOrRestoreWorkflowSession: async () => ({
      execution_id: job.execution_id,
    }),
    markConsultantWorkflowFailed: async (_db, _run, _stage, error) => {
      assert.equal(error, original);
      state.marked++;
    },
  },
});
const { runNextConsultantWorkflowJob } =
  await import("../../../../packages/application/dist/consultant-workflow-worker.js");
let rejectHeld;
const db = {
  connect: async () => {
    state.connects++;
    // Observe actual ordering at the first optional diagnostic operation.
    assert.equal(state.marked, 1);
    assert.equal(state.finished, 1);
    assert.equal(state.heartbeatCleared, true);
    if (mode === "reject")
      throw new Error("Synthetic unavailable diagnostic pool");
    return {
      query: async (sql) => {
        if (sql.includes("AS uncertain"))
          return new Promise((_, reject) => {
            rejectHeld = reject;
          });
        return { rows: [] };
      },
      release: (destroy) => {
        state.releases.push(destroy);
        rejectHeld?.(new Error("Destroyed stalled socket"));
      },
    };
  },
};
assert.equal(await runNextConsultantWorkflowJob(db), true);
assert.equal(state.marked, 1);
assert.equal(state.finished, 1);
assert.equal(state.heartbeatCleared, true);
assert.deepEqual(state.releases, mode === "reject" ? [] : [true]);
console.log(JSON.stringify(state));
