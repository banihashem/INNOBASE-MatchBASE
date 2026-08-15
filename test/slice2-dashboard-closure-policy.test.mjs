import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSlice2DashboardClosure } from "../scripts/lib/slice2-dashboard-closure-policy.mjs";

const closure = JSON.parse(
  readFileSync("governance/slice2-external-closure-anchor-v1.json", "utf8"),
);
const closureSourceRef = {
  sourceId: "closure",
  path: closure.source.path,
  sha256: closure.source.sha256,
  observedAt: closure.observedAt,
};
const auditSourceRef = {
  sourceId: "audits",
  path: closure.auditSource.path,
  sha256: closure.auditSource.sha256,
  observedAt: closure.observedAt,
};
const facts = {
  repository: closure.repository,
  commit: closure.commit,
  tree: closure.tree,
  runId: closure.runId,
  jobId: closure.jobId,
  conclusion: closure.conclusion,
  role3Disposition: closure.role3Disposition,
  role2Status: closure.role2.status,
  candidateManifestSha256: closure.candidate.manifestSha256,
  candidateAggregateSha256: closure.candidate.aggregateSha256,
};
const ready = closure.role3Disposition === "READY_FOR_ROLE2";
const record = (
  id,
  lifecycleStatus,
  sourceRef = closureSourceRef,
  extra = {},
) => ({
  id,
  title: id,
  summary: id,
  status: "ACTIVE",
  facts: { lifecycleStatus, ...facts, ...extra },
  sourceRefs: [{ ...sourceRef }],
});

function views() {
  return {
    portfolio: { records: [record("SLICE-2", "IN_PROGRESS")] },
    gates: {
      records: [
        {
          ...record("S2-G1", ready ? "PASS" : "ACTIVE", auditSourceRef),
          status: ready ? "PASS" : "ACTIVE",
        },
        ...Object.entries(closure.gates).map(([id, status]) =>
          record(id, status),
        ),
      ],
    },
    tests: {
      records: Object.entries(closure.acceptance).map(([id, status]) =>
        record(id, status),
      ),
    },
    deployments: {
      records: [
        record("EXT-S2-GITHUB-CLOSURE", "PASS", closureSourceRef, {
          predecessorCount: closure.predecessors.length,
        }),
        ...closure.predecessors.map((item) =>
          record(
            `EXT-S2-GITHUB-PREDECESSOR-${item.runId}`,
            "PASS",
            closureSourceRef,
            { ...item, reasonCode: item.reason },
          ),
        ),
        { ...record("EXT-GCP", "BLOCKED"), status: "BLOCKED" },
        { ...record("EXT-CLOUDFLARE", "BLOCKED"), status: "BLOCKED" },
        { ...record("EXT-DEPLOYMENT", "NOT_STARTED"), status: "BLOCKED" },
      ],
    },
    defects: {
      records: closure.role2.defects.map((item) =>
        record(item.id, item.status, closureSourceRef, {
          role2Status: closure.role2.status,
          role2Disposition: closure.role2.disposition,
        }),
      ),
    },
    evidence: {
      records: closure.audits.map((id) =>
        record(id, "PASS", auditSourceRef, {
          critical: 0,
          major: 0,
          minor: 0,
        }),
      ),
    },
    agents: {
      records: [
        {
          ...record("AGENT-S2-ORCHESTRATOR", "PASS", auditSourceRef, {
            executionStatus: ready ? "COMPLETED" : "IN_PROGRESS",
            auditDisposition: ready ? "PASS" : "PENDING",
          }),
          status: ready ? "PASS" : "ACTIVE",
        },
      ],
    },
  };
}

const validate = (value) =>
  validateSlice2DashboardClosure(value, closure, {
    closureSourceRef,
    auditSourceRef,
  });

test("accepts exact current Slice 2 dashboard closure semantics", () => {
  assert.doesNotThrow(() => validate(views()));
});

test("rejects omission, duplicate, reorder, substitution, and stale lifecycle", () => {
  const mutations = [
    (value) => value.gates.records.pop(),
    (value) =>
      value.tests.records.push(structuredClone(value.tests.records[0])),
    (value) => value.deployments.records.splice(1, 1),
    (value) =>
      value.deployments.records.splice(
        1,
        0,
        structuredClone(value.deployments.records[1]),
      ),
    (value) =>
      value.deployments.records.splice(
        1,
        2,
        value.deployments.records[2],
        value.deployments.records[1],
      ),
    (value) => (value.deployments.records[1].facts.runId += 1),
    (value) => (value.deployments.records[1].facts.jobId += 1),
    (value) => (value.deployments.records[1].facts.tree = "f".repeat(40)),
    (value) => (value.deployments.records[1].facts.reasonCode = "FORGED"),
    (value) => (value.tests.records[0].facts.lifecycleStatus = "PASS"),
    (value) =>
      (value.defects.records[0].facts.lifecycleStatus =
        "CORRECTED_PENDING_ROLE2"),
    (value) => (value.evidence.records[0].facts.major = 1),
    (value) =>
      (value.evidence.records[0].sourceRefs[0].sha256 = "F".repeat(64)),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = views();
    mutate(value);
    assert.throws(() => validate(value), `mutation ${index} must fail closed`);
  }
});

function readyFixture() {
  const readyClosure = structuredClone(closure);
  readyClosure.role3Disposition = "READY_FOR_ROLE2";
  readyClosure.role2.status = "PENDING";
  readyClosure.role2.disposition = "PENDING_ROLE2_CORRECTION_REAUDIT";
  readyClosure.role2.critical = 0;
  readyClosure.role2.major = 0;
  readyClosure.role2.minor = 0;
  for (const defect of readyClosure.role2.defects)
    defect.status = "CORRECTED_PENDING_ROLE2";
  readyClosure.gates = { "S2-G2": "PASS", "S2-G9": "PASS" };
  readyClosure.acceptance = Object.fromEntries(
    Object.keys(readyClosure.acceptance).map((id) => [id, "PASS"]),
  );

  const value = views();
  for (const view of Object.values(value)) {
    for (const item of view.records ?? []) {
      if (item.facts?.role3Disposition) {
        item.facts.role3Disposition = "READY_FOR_ROLE2";
        item.facts.role2Status = "PENDING";
      }
    }
  }
  value.portfolio.records[0].facts.lifecycleStatus = "READY_FOR_ROLE2";
  value.gates.records[0].facts.lifecycleStatus = "PASS";
  value.gates.records[0].status = "PASS";
  for (const item of value.gates.records.slice(1)) {
    item.facts.lifecycleStatus = "PASS";
    item.status = "PASS";
  }
  for (const item of value.tests.records) item.facts.lifecycleStatus = "PASS";
  for (const item of value.defects.records) {
    item.facts.lifecycleStatus = "CORRECTED_PENDING_ROLE2";
    item.facts.role2Status = "PENDING";
    item.facts.role2Disposition = "PENDING_ROLE2_CORRECTION_REAUDIT";
  }
  value.agents.records[0].facts.executionStatus = "COMPLETED";
  value.agents.records[0].facts.auditDisposition = "PASS";
  value.agents.records[0].status = "PASS";
  return { readyClosure, value };
}

test("requires terminal audit gate and orchestrator lifecycle on READY closure", () => {
  const exact = readyFixture();
  assert.doesNotThrow(() =>
    validateSlice2DashboardClosure(exact.value, exact.readyClosure, {
      closureSourceRef,
      auditSourceRef,
    }),
  );
  const mutations = [
    (value) => (value.gates.records[0].facts.lifecycleStatus = "ACTIVE"),
    (value) => (value.gates.records[0].status = "ACTIVE"),
    (value) => (value.agents.records[0].facts.executionStatus = "IN_PROGRESS"),
    (value) => (value.agents.records[0].facts.auditDisposition = "PENDING"),
    (value) => (value.agents.records[0].status = "ACTIVE"),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const candidate = readyFixture();
    mutate(candidate.value);
    assert.throws(
      () =>
        validateSlice2DashboardClosure(
          candidate.value,
          candidate.readyClosure,
          { closureSourceRef, auditSourceRef },
        ),
      `READY lifecycle mutation ${index} must fail closed`,
    );
  }
});
