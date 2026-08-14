import assert from "node:assert/strict";
import test from "node:test";
import { validateDashboardClosure } from "../scripts/lib/dashboard-closure-policy.mjs";

const closure = {
  repository: "banihashem/INNOBASE-MatchBASE",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  runId: 100,
  jobId: 200,
  predecessorFailures: [{ runId: 50 }],
};
const closureFacts = {
  ...closure,
  conclusion: "success",
  closureStatus: "HOSTED_VERIFIED",
  role2Status: "PENDING_ROLE2",
};
delete closureFacts.predecessorFailures;
const record = (id, facts = closureFacts) => ({
  id,
  title: id,
  status: "ACTIVE",
  facts,
  sourceRefs: [],
});
function fixture() {
  const defectFacts = {
    lifecycleStatus: "OPEN",
    role2AuditStatus: "FAIL",
    role2Disposition: "PENDING_ROLE2_CORRECTION_REAUDIT",
  };
  return {
    gates: { records: [record("AG6")] },
    tests: { records: [record("S1-AC-022")] },
    deployments: {
      records: [
        record("EXT-GITHUB-CLOSURE", {
          ...closureFacts,
          predecessorFailures: 1,
        }),
      ],
    },
    evidence: { records: [record("EVIDENCE-S1-EXTERNAL-CLOSURE")] },
    defects: {
      records: ["S1-L1-D001", "S1-L1-D002", "S1-L1-D003"].map((id) => ({
        ...record(id, defectFacts),
        status: "ACTIVE",
      })),
    },
    loops: {
      records: [
        {
          ...record("PO-001-R2-S1-L1", {
            critical: 0,
            major: 3,
            minor: 0,
            disposition: "PENDING_ROLE2_CORRECTION_REAUDIT",
          }),
          status: "BLOCKED",
        },
      ],
    },
  };
}

test("accepts the exact authenticated hosted closure projection", () => {
  assert.doesNotThrow(() => validateDashboardClosure(fixture(), closure));
});

test("accepts corrected defects while Role 2 re-audit remains pending", () => {
  const views = fixture();
  for (const defect of views.defects.records)
    defect.facts.lifecycleStatus = "CORRECTED_PENDING_ROLE2";
  assert.doesNotThrow(() => validateDashboardClosure(views, closure));
});

for (const [name, mutate] of [
  ["commit", (views) => (views.gates.records[0].facts.commit = "c".repeat(40))],
  ["job", (views) => (views.tests.records[0].facts.jobId = 201)],
  ["status", (views) => (views.deployments.records[0].status = "PASS")],
  ["missing defect", (views) => views.defects.records.pop()],
  ["false Role 2 PASS", (views) => (views.loops.records[0].status = "PASS")],
]) {
  test(`rejects a ${name} divergence`, () => {
    const views = fixture();
    mutate(views);
    assert.throws(() => validateDashboardClosure(views, closure));
  });
}
