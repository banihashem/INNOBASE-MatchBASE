import assert from "node:assert/strict";
import test from "node:test";
import { validateDashboardClosure } from "../scripts/lib/dashboard-closure-policy.mjs";

const predecessorSourceRef = {
  sourceId: "matchbase://external-closure/predecessor-failures",
  path: "C:\\INNOBASE\\MatchBASE\\evidence\\predecessors.json",
  sha256: "D".repeat(64),
  observedAt: "2026-08-15T00:00:00.000Z",
};
const closure = {
  repository: "banihashem/INNOBASE-MatchBASE",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  runId: 100,
  jobId: 200,
  predecessorFailures: [
    { runId: 50, jobId: 60, commit: "c".repeat(40), conclusion: "failure" },
    { runId: 70, jobId: 80, commit: "d".repeat(40), conclusion: "failure" },
  ],
  predecessorFailureReasons: [
    { runId: 50, reasonCode: "FIRST_FAILURE" },
    { runId: 70, reasonCode: "SECOND_FAILURE" },
  ],
  role2: {
    defects: [
      { id: "S1-L1-D001", status: "CLOSED_BY_ROLE2" },
      { id: "S1-L1-D003", status: "CLOSED_BY_ROLE2" },
      { id: "S1-L1-RD002", status: "CORRECTED_PENDING_ROLE2" },
    ],
  },
};
const closureFacts = {
  repository: closure.repository,
  commit: closure.commit,
  tree: closure.tree,
  runId: closure.runId,
  jobId: closure.jobId,
  conclusion: "success",
  closureStatus: "HOSTED_VERIFIED",
  role2Status: "PENDING_ROLE2",
};
const record = (id, facts = closureFacts) => ({
  id,
  title: id,
  status: "ACTIVE",
  facts,
  sourceRefs: [],
});

function fixture() {
  return {
    gates: { records: [record("AG6")] },
    tests: { records: [record("S1-AC-022")] },
    deployments: {
      records: [
        record("EXT-GITHUB-CLOSURE", {
          ...closureFacts,
          predecessorFailureCount: 2,
        }),
        ...closure.predecessorFailures.map((failure, index) => ({
          ...record(`EXT-GITHUB-FAILURE-${failure.runId}`, {
            ...failure,
            reasonCode: closure.predecessorFailureReasons[index].reasonCode,
          }),
          sourceRefs: [structuredClone(predecessorSourceRef)],
        })),
      ],
    },
    evidence: { records: [record("EVIDENCE-S1-EXTERNAL-CLOSURE")] },
    defects: {
      records: closure.role2.defects.map(({ id, status }) => ({
        ...record(id, {
          lifecycleStatus: status,
          role2AuditStatus: "FAIL",
          role2Disposition: "PENDING_ROLE2_CORRECTION_REAUDIT",
        }),
        status: status === "CLOSED_BY_ROLE2" ? "PASS" : "ACTIVE",
      })),
    },
    loops: {
      records: [
        {
          ...record("PO-001-R2-S1-L2", {
            critical: 0,
            major: 1,
            minor: 0,
            disposition: "PENDING_ROLE2_CORRECTION_REAUDIT",
          }),
          status: "BLOCKED",
        },
      ],
    },
  };
}

const validate = (views) =>
  validateDashboardClosure(views, closure, { predecessorSourceRef });

test("accepts exact ordered predecessor records with exact sources", () => {
  assert.doesNotThrow(() => validate(fixture()));
});

for (const [name, mutate] of [
  ["count-only projection", (views) => views.deployments.records.splice(1)],
  ["missing failure", (views) => views.deployments.records.pop()],
  [
    "extra failure",
    (views) =>
      views.deployments.records.push(
        structuredClone(views.deployments.records[1]),
      ),
  ],
  [
    "reordered failures",
    (views) =>
      views.deployments.records.splice(
        1,
        2,
        views.deployments.records[2],
        views.deployments.records[1],
      ),
  ],
  ["changed run", (views) => (views.deployments.records[1].facts.runId += 1)],
  ["changed job", (views) => (views.deployments.records[1].facts.jobId += 1)],
  [
    "changed commit",
    (views) => (views.deployments.records[1].facts.commit = "e".repeat(40)),
  ],
  [
    "changed conclusion",
    (views) => (views.deployments.records[1].facts.conclusion = "success"),
  ],
  [
    "changed reason",
    (views) => (views.deployments.records[1].facts.reasonCode = "FORGED"),
  ],
  [
    "unmatched evidence hash",
    (views) =>
      (views.deployments.records[1].sourceRefs[0].sha256 = "0".repeat(64)),
  ],
  [
    "unmatched evidence path",
    (views) => (views.deployments.records[1].sourceRefs[0].path += ".forged"),
  ],
  [
    "unmatched evidence source ID",
    (views) =>
      (views.deployments.records[1].sourceRefs[0].sourceId += ".forged"),
  ],
  [
    "unmatched evidence observation",
    (views) =>
      (views.deployments.records[1].sourceRefs[0].observedAt =
        "2026-08-15T00:00:01.000Z"),
  ],
  [
    "extra evidence source",
    (views) =>
      views.deployments.records[1].sourceRefs.push(
        structuredClone(predecessorSourceRef),
      ),
  ],
  ["missing defect", (views) => views.defects.records.pop()],
  ["false Role 2 PASS", (views) => (views.loops.records[0].status = "PASS")],
]) {
  test(`rejects ${name}`, () => {
    const views = fixture();
    mutate(views);
    assert.throws(() => validate(views));
  });
}
