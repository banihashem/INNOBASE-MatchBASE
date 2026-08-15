import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  slice2DashboardAuditSourceRef,
  slice2HistoricalLocalClosure,
  validateSlice2ExternalClosure,
} from "../scripts/lib/slice2-external-closure-policy.mjs";

const anchor = JSON.parse(
  readFileSync("governance/slice2-external-closure-anchor-v1.json", "utf8"),
);

test("accepts the exact v2 Loop 2 anchor locally and in ANCHOR_ONLY_CI", () => {
  assert.equal(
    validateSlice2ExternalClosure(structuredClone(anchor)).role2.status,
    "PENDING",
  );
  assert.equal(
    validateSlice2ExternalClosure(structuredClone(anchor), { anchorOnly: true })
      .role3Disposition,
    "READY_FOR_ROLE2",
  );
  assert.deepEqual(slice2HistoricalLocalClosure(anchor), {
    repository: "banihashem/INNOBASE-MatchBASE",
    commit: "58ed065f8a8e2ac5c60812b13cd4607c1a8d9cb6",
    tree: "358606112d663ac15e2e065557cbbed6f00cae86",
    runId: 31867699009,
    jobId: 94971277544,
    conclusion: "success",
    observedAt: "2026-08-15T10:08:43+04:00",
    source: {
      method:
        "Exact historical predecessor from the versioned Slice 2 closure anchor",
    },
    role2: { status: "FAIL" },
  });
});

test("derives one fail-closed audit source policy for local and CI snapshots", () => {
  const local = slice2DashboardAuditSourceRef(anchor);
  assert.equal(
    local.sourceId,
    "matchbase://slice2-external-closure/audits-git-object-attestation",
  );
  assert.equal(local.path, anchor.source.path);
  assert.equal(local.sha256, anchor.source.sha256);

  const ciAnchor = {
    sourceId:
      "matchbase://ci-snapshot/governance/slice2-external-closure-anchor-v1.json",
    path: "C:\\repo\\governance\\slice2-external-closure-anchor-v1.json",
    sha256: "A".repeat(64),
    observedAt: anchor.observedAt,
  };
  assert.deepEqual(
    slice2DashboardAuditSourceRef(anchor, {
      anchorOnly: true,
      anchorSourceRef: ciAnchor,
    }),
    ciAnchor,
  );
  for (const mutation of [
    (value) => (value.sha256 = "f".repeat(64)),
    (value) => (value.observedAt = "2026-08-15T00:00:00Z"),
    (value) => delete value.path,
    (value) => (value.sourceId = 7),
  ]) {
    const forged = structuredClone(ciAnchor);
    mutation(forged);
    assert.throws(() =>
      slice2DashboardAuditSourceRef(anchor, {
        anchorOnly: true,
        anchorSourceRef: forged,
      }),
    );
  }
  assert.throws(() =>
    slice2DashboardAuditSourceRef(anchor, { anchorOnly: true }),
  );
});

test("rejects stale loop, source, audit, candidate, lifecycle, and unknown keys", () => {
  const mutations = [
    (v) => (v.schemaVersion = "matchbase.slice2-external-closure/v1"),
    (v) => (v.closureLoop = "ROLE2_LOOP_1"),
    (v) => delete v.closureLoop,
    (v) => (v.commit = "f".repeat(40)),
    (v) => (v.tree = "f".repeat(40)),
    (v) => (v.runId += 1),
    (v) => (v.jobId += 1),
    (v) => (v.source.path = "C:\\outside\\forged.md"),
    (v) => (v.source.sha256 = "F".repeat(64)),
    (v) => (v.source.method = "forged"),
    (v) => (v.source.unknown = true),
    (v) => (v.auditSource.kind = "repository_artifact"),
    (v) => (v.auditSource.path = "evidence/slice1/local-validation.json"),
    (v) => (v.auditSource.sha256 = "F".repeat(64)),
    (v) => (v.auditSource.commit = "f".repeat(40)),
    (v) => (v.auditSource.gitObject = "f".repeat(40)),
    (v) => (v.auditSource.unknown = true),
    (v) => (v.candidate.manifestSha256 = "F".repeat(64)),
    (v) => (v.candidate.aggregateSha256 = "F".repeat(64)),
    (v) => (v.candidate.fileCount = 108),
    (v) => (v.role3Disposition = "CORRECTION_IN_PROGRESS"),
    (v) => (v.role2.status = "PASS"),
    (v) => (v.role2.disposition = "PENDING_ROLE2_CORRECTION_REAUDIT"),
    (v) => (v.role2.auditSha256 = "F".repeat(64)),
    (v) => (v.role2.defects[0].status = "OPEN"),
    (v) => v.role2.defects.pop(),
    (v) => v.audits.reverse(),
    (v) => (v.gates["S2-G2"] = "BLOCKED"),
    (v) => (v.acceptance["L2-C2-AT-01"] = "PENDING"),
    (v) => (v.acceptance.UNKNOWN = "PASS"),
    (v) => (v.externalMutations.dns = "NONE"),
    (v) => (v.unknown = true),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = structuredClone(anchor);
    mutate(value);
    assert.throws(
      () => validateSlice2ExternalClosure(value, { anchorOnly: true }),
      `mutation ${index} must fail closed`,
    );
  }
});

test("rejects predecessor omission, duplicate, reorder, substitution, and current-as-history", () => {
  const mutations = [
    (v) => v.predecessors.pop(),
    (v) => v.predecessors.push(structuredClone(v.predecessors[0])),
    (v) => v.predecessors.reverse(),
    (v) => (v.predecessors[2].commit = v.commit),
    (v) => (v.predecessors[2].runId = v.runId),
    (v) => (v.predecessors[2].reason = "FORGED_REASON"),
    (v) => (v.predecessors[2].unknown = true),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = structuredClone(anchor);
    mutate(value);
    assert.throws(
      () => validateSlice2ExternalClosure(value, { anchorOnly: true }),
      `predecessor mutation ${index} must fail closed`,
    );
  }
});

test("rejects historical temporal inversion", () => {
  const value = structuredClone(anchor);
  value.observedAt = "2026-08-15T08:00:00+04:00";
  assert.throws(
    () => slice2HistoricalLocalClosure(value),
    /temporal causality/u,
  );
});
