import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import test from "node:test";
import {
  isContainedDifference,
  validateTraceability,
} from "../scripts/lib/traceability-policy.mjs";

const hash = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "matchbase-trace-"));
  const repo = join(root, "repo");
  const management = join(root, "management");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(management, { recursive: true });
  writeFileSync(join(repo, "docs", "design.md"), "design");
  writeFileSync(join(management, "source.md"), "source");
  const chain = {
    id: "TRACE-1",
    sourceRefs: [
      { path: join(management, "source.md"), sha256: hash("source") },
    ],
    decisionRefs: [
      { path: join(management, "source.md"), sha256: hash("source") },
    ],
    requirementId: "REQ-1",
    riskIds: ["RISK-1"],
    designRefs: [{ path: "docs/design.md", sha256: hash("design") }],
    backlogIds: ["TASK-1"],
    testIds: ["TEST-1"],
    gateIds: ["AG2"],
    deploymentId: "DEPLOY-1",
  };
  const model = {
    requirements: [{ id: "REQ-1", traceabilityIds: ["TRACE-1"] }],
    risks: [{ id: "RISK-1", traceabilityIds: ["TRACE-1"] }],
    backlog: [
      {
        id: "TASK-1",
        requirementIds: ["REQ-1"],
        riskIds: ["RISK-1"],
        acceptanceTestIds: ["TEST-1"],
        gateIds: ["AG2"],
        deploymentId: "DEPLOY-1",
        traceabilityIds: ["TRACE-1"],
      },
    ],
    tests: [{ id: "TEST-1", traceabilityIds: ["TRACE-1"] }],
    gates: [{ id: "AG2", status: "PASS", traceabilityIds: ["TRACE-1"] }],
    deployments: [
      {
        id: "DEPLOY-1",
        reason: "local only",
        rollback: "remove output",
        traceabilityIds: ["TRACE-1"],
      },
    ],
    decisionSource: {
      path: join(management, "source.md"),
      sha256: hash("source"),
    },
  };
  return {
    document: { schemaVersion: 1, chains: [chain] },
    model,
    options: {
      repoRoot: repo,
      managementRoot: management,
      managementWindowsRoot: management,
      anchorOnly: false,
    },
  };
}

test("validates every source-to-deployment stage and exact evidence hash", () => {
  const value = fixture();
  assert.deepEqual(
    validateTraceability(value.document, value.model, value.options),
    { chains: 1, requirements: 1 },
  );
});

test("rejects a missing stage, unknown ID, or missing backlink", () => {
  const missing = fixture();
  missing.document.chains[0].testIds = [];
  assert.throws(() =>
    validateTraceability(missing.document, missing.model, missing.options),
  );

  const unknown = fixture();
  unknown.document.chains[0].gateIds = ["AG404"];
  assert.throws(() =>
    validateTraceability(unknown.document, unknown.model, unknown.options),
  );

  const backlink = fixture();
  backlink.model.backlog[0].traceabilityIds = [];
  assert.throws(() =>
    validateTraceability(backlink.document, backlink.model, backlink.options),
  );
});

test("rejects stale hashes and repository traversal", () => {
  const stale = fixture();
  stale.document.chains[0].designRefs[0].sha256 = "0".repeat(64);
  assert.throws(() =>
    validateTraceability(stale.document, stale.model, stale.options),
  );

  const traversal = fixture();
  traversal.document.chains[0].designRefs[0].path = "../outside.md";
  assert.throws(() =>
    validateTraceability(
      traversal.document,
      traversal.model,
      traversal.options,
    ),
  );
});

test("rejects missing risk, test, and deployment backlinks", () => {
  for (const field of ["risks", "tests", "deployments"]) {
    const value = fixture();
    value.model[field][0].traceabilityIds = [];
    assert.throws(() =>
      validateTraceability(value.document, value.model, value.options),
    );
  }
});

test("uses POSIX separators correctly for hosted Ubuntu containment", () => {
  assert.equal(
    isContainedDifference(posix.relative("/repo", "/repo/docs/design.md"), "/"),
    true,
  );
  assert.equal(
    isContainedDifference(posix.relative("/repo", "/outside/design.md"), "/"),
    false,
  );
});

test("rejects normalized Windows traversal hidden behind management prefix", () => {
  const value = fixture();
  const traversal =
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\..\\outside\\evil.md";
  value.document.chains[0].sourceRefs[0].path = traversal;
  value.document.chains[0].decisionRefs[0].path = traversal;
  value.model.decisionSource.path = traversal;
  value.options.anchorOnly = true;
  value.options.managementWindowsRoot =
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
  assert.throws(() =>
    validateTraceability(value.document, value.model, value.options),
  );
});
