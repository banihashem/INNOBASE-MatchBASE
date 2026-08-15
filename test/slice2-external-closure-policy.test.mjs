import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SLICE2_AUDIT_IDS,
  validateSlice2ExternalClosure,
} from "../scripts/lib/slice2-external-closure-policy.mjs";

const anchor = JSON.parse(
  readFileSync("governance/slice2-external-closure-anchor-v1.json", "utf8"),
);
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

function readyFixture() {
  const root = mkdtempSync(join(tmpdir(), "matchbase-s2-closure-"));
  const management = join(root, "management");
  const repository = join(root, "repository");
  const evidenceDirectory = join(repository, "evidence", "slice2");
  mkdirSync(management);
  mkdirSync(evidenceDirectory, { recursive: true });
  const value = structuredClone(anchor);
  value.commit = "a".repeat(40);
  value.tree = "b".repeat(40);
  value.runId = 31870000001;
  value.jobId = 94980000001;
  value.observedAt = "2026-08-16T00:00:00.000Z";
  value.predecessors.push({
    runId: anchor.runId,
    jobId: anchor.jobId,
    commit: anchor.commit,
    tree: anchor.tree,
    conclusion: "success",
    reason: "ROLE2_REJECTED_THREE_MAJOR_DEFECTS",
  });
  value.candidate = {
    manifestPath: "evidence/slice2/candidate-manifest.json",
    manifestSha256: "C".repeat(64),
    aggregateSha256: "D".repeat(64),
    fileCount: 91,
  };
  value.role3Disposition = "READY_FOR_ROLE2";
  value.role2.status = "PENDING";
  value.role2.major = 0;
  value.role2.defects.forEach((defect) => {
    defect.status = "CORRECTED_PENDING_ROLE2";
  });
  value.gates = { "S2-G2": "PASS", "S2-G9": "PASS" };
  value.acceptance = Object.fromEntries(
    Object.keys(value.acceptance).map((id) => [id, "PASS"]),
  );
  const role2Path = join(
    management,
    "ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_2.md",
  );
  const role2 = "immutable role2 audit\n";
  writeFileSync(role2Path, role2);
  value.role2.auditPath = role2Path;
  value.role2.auditSha256 = hash(role2);
  const evidencePath = join(evidenceDirectory, "local-validation.json");
  const evidence = `${JSON.stringify({
    independentAudits: SLICE2_AUDIT_IDS.map((id) => ({
      id,
      status: "PASS",
      critical: 0,
      major: 0,
      minor: 0,
      candidateManifestSha256: value.candidate.manifestSha256,
      candidateAggregateSha256: value.candidate.aggregateSha256,
    })),
  })}\n`;
  writeFileSync(evidencePath, evidence);
  value.auditSource = {
    kind: "repository_artifact",
    path: evidencePath,
    sha256: hash(evidence),
    method: "Exact frozen-candidate discipline audit ledger",
  };
  const reportPath = join(
    management,
    "ROLE3_CORRECTION_VALIDATION_PO_001_SLICE_2_ROLE2_LOOP_1.md",
  );
  value.source = {
    kind: "management_artifact",
    path: reportPath,
    sha256: "0".repeat(64),
    method:
      "Authenticated hosted Slice 2 correction closure recorded by Role 3",
  };
  const marker = structuredClone(value);
  delete marker.source;
  delete marker.auditSource;
  const report = `MATCHBASE_SLICE2_EXTERNAL_CLOSURE_V1: ${JSON.stringify(marker)}\n`;
  writeFileSync(reportPath, report);
  value.source.sha256 = hash(report);
  return { value, management, repository, reportPath, evidencePath };
}

test("accepts the exact repository anchor and a fully source-bound ready successor", () => {
  assert.equal(
    validateSlice2ExternalClosure(structuredClone(anchor), {
      anchorOnly: true,
    }).role2.status,
    "FAIL",
  );
  const fixture = readyFixture();
  assert.equal(
    validateSlice2ExternalClosure(fixture.value, {
      managementRoot: fixture.management,
      repositoryRoot: fixture.repository,
    }).role3Disposition,
    "READY_FOR_ROLE2",
  );
});

test("rejects stale identity, tuple, source, audit, and lifecycle mutations", () => {
  const mutations = [
    (value) => (value.commit = "f".repeat(40)),
    (value) => (value.runId += 1),
    (value) => (value.jobId += 1),
    (value) => value.predecessors.pop(),
    (value) => value.predecessors.push(structuredClone(value.predecessors[0])),
    (value) => value.predecessors.reverse(),
    (value) => (value.predecessors[0].runId += 9),
    (value) => (value.predecessors[0].jobId += 9),
    (value) => (value.predecessors[0].commit = "e".repeat(40)),
    (value) => (value.predecessors[0].tree = "e".repeat(40)),
    (value) => (value.predecessors[0].conclusion = "success"),
    (value) => (value.predecessors[0].reason = "FORGED_REASON"),
    (value) => (value.predecessors[0].unknown = true),
    (value) => value.audits.pop(),
    (value) => value.audits.reverse(),
    (value) => (value.audits[0] = "FORGED_AUDIT"),
    (value) => (value.candidate.aggregateSha256 = "E".repeat(64)),
    (value) => (value.source.path = "C:\\outside\\forged.md"),
    (value) => (value.source.sha256 = "E".repeat(64)),
    (value) => (value.source.method = "Forged method"),
    (value) => (value.auditSource.sha256 = "E".repeat(64)),
    (value) => (value.gates["S2-G2"] = "BLOCKED"),
    (value) => (value.acceptance["S2-AC-032"] = "PENDING"),
    (value) => (value.role2.status = "PASS"),
    (value) => (value.role2.defects[0].status = "OPEN"),
    (value) => (value.unknown = true),
  ];
  for (const mutate of mutations) {
    const fixture = readyFixture();
    mutate(fixture.value);
    assert.throws(() =>
      validateSlice2ExternalClosure(fixture.value, {
        managementRoot: fixture.management,
        repositoryRoot: fixture.repository,
      }),
    );
  }
});

test("rejects same-count audit substitution and unknown marker facts", () => {
  const fixture = readyFixture();
  const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
  evidence.independentAudits[0].id = "FORGED_SAME_COUNT_AUDIT";
  const evidenceText = `${JSON.stringify(evidence)}\n`;
  writeFileSync(fixture.evidencePath, evidenceText);
  fixture.value.auditSource.sha256 = hash(evidenceText);
  assert.throws(() =>
    validateSlice2ExternalClosure(fixture.value, {
      managementRoot: fixture.management,
      repositoryRoot: fixture.repository,
    }),
  );

  const markerFixture = readyFixture();
  const marker = structuredClone(markerFixture.value);
  delete marker.source;
  delete marker.auditSource;
  marker.unknown = "FORGED";
  const report = `MATCHBASE_SLICE2_EXTERNAL_CLOSURE_V1: ${JSON.stringify(marker)}\n`;
  writeFileSync(markerFixture.reportPath, report);
  markerFixture.value.source.sha256 = hash(report);
  assert.throws(() =>
    validateSlice2ExternalClosure(markerFixture.value, {
      managementRoot: markerFixture.management,
      repositoryRoot: markerFixture.repository,
    }),
  );
});
