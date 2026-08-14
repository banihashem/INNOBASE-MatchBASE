import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EXPECTED_REPOSITORY,
  validateExternalClosure,
} from "../scripts/lib/external-closure-policy.mjs";

const anchor = JSON.parse(
  readFileSync("governance/external-closure-anchor-v1.json", "utf8"),
);
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();
const copy = () => structuredClone(anchor);

test("accepts the exact immutable hosted closure anchor", () => {
  assert.equal(
    validateExternalClosure(copy(), { anchorOnly: true }).repository,
    EXPECTED_REPOSITORY,
  );
});

test("binds a local management marker to success and every predecessor", () => {
  const root = mkdtempSync(join(tmpdir(), "matchbase-closure-"));
  const auditPath = join(root, "role2.md");
  const sourcePath = join(root, "role3.md");
  const audit = "independent audit\n";
  writeFileSync(auditPath, audit);
  const value = copy();
  value.source.kind = "management_artifact";
  value.source.path = sourcePath;
  value.predecessorSource = value.source;
  value.role2.auditPath = auditPath;
  value.role2.auditSha256 = hash(audit);
  const marker = {
    repository: value.repository,
    commit: value.commit,
    tree: value.tree,
    workflow: value.workflow,
    runId: value.runId,
    jobId: value.jobId,
    conclusion: value.conclusion,
    predecessorFailures: value.predecessorFailures,
    predecessorFailureReasons: value.predecessorFailureReasons,
  };
  const report = `MATCHBASE_EXTERNAL_CLOSURE_V2: ${JSON.stringify(marker)}\n`;
  writeFileSync(sourcePath, report);
  value.source.sha256 = hash(report);
  value.predecessorSource = { ...value.source };
  assert.equal(
    validateExternalClosure(value, {
      managementRoot: root,
      repositoryRoot: process.cwd(),
    }),
    value,
  );

  for (const collection of [
    "predecessorFailures",
    "predecessorFailureReasons",
  ]) {
    const forgedMarker = structuredClone(marker);
    forgedMarker[collection][0].unknown = "FORGED_EXTRA_FIELD";
    const forgedReport = `MATCHBASE_EXTERNAL_CLOSURE_V2: ${JSON.stringify(forgedMarker)}\n`;
    writeFileSync(sourcePath, forgedReport);
    const forgedValue = structuredClone(value);
    forgedValue.source.sha256 = hash(forgedReport);
    forgedValue.predecessorSource = { ...forgedValue.source };
    assert.throws(() =>
      validateExternalClosure(forgedValue, {
        managementRoot: root,
        repositoryRoot: process.cwd(),
      }),
    );
  }
  writeFileSync(sourcePath, report);

  for (const mutate of [
    (candidate) => (candidate.predecessorFailures[0].runId += 1),
    (candidate) => (candidate.predecessorFailures[0].jobId += 1),
    (candidate) => (candidate.predecessorFailures[0].commit = "f".repeat(40)),
    (candidate) => (candidate.predecessorFailures[0].conclusion = "success"),
    (candidate) => candidate.predecessorFailures.pop(),
    (candidate) => candidate.predecessorFailures.reverse(),
    (candidate) =>
      (candidate.predecessorFailureReasons[0].reasonCode = "FORGED_REASON"),
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.throws(() =>
      validateExternalClosure(candidate, {
        managementRoot: root,
        repositoryRoot: process.cwd(),
      }),
    );
  }
});

test("rejects anchored same-count substitution and malformed closure evidence", () => {
  const mutations = [
    (value) => (value.repository = "attacker/repository"),
    (value) => (value.commit = "0".repeat(40)),
    (value) => (value.tree = "not-a-tree"),
    (value) => (value.runId = 0),
    (value) => (value.jobId = -1),
    (value) => (value.conclusion = "failure"),
    (value) => (value.source.path = "relative-validation.md"),
    (value) => (value.source.sha256 = "0".repeat(64)),
    (value) => (value.predecessorFailures = []),
    (value) => (value.predecessorFailures[0].runId += 100),
    (value) => (value.predecessorFailures[0].jobId += 100),
    (value) => (value.predecessorFailures[0].commit = "f".repeat(40)),
    (value) => value.predecessorFailures.reverse(),
    (value) => (value.predecessorSource.kind = "management_artifact"),
    (value) =>
      (value.predecessorSource.path =
        "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\forged.md"),
    (value) => (value.predecessorSource.method = "Forged method"),
    (value) => (value.predecessorSource.sha256 = "0".repeat(64)),
    (value) => (value.role2.auditPath = "relative-audit.md"),
    (value) => (value.role2.major = 0),
    (value) => (value.role2Status = "PASS"),
  ];
  for (const mutate of mutations) {
    const value = copy();
    mutate(value);
    assert.throws(() => validateExternalClosure(value, { anchorOnly: true }));
  }
});
