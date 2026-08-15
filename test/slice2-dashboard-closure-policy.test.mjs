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
      records: Object.entries(closure.gates).map(([id, status]) =>
        record(id, status),
      ),
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
