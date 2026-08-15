import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  slice2DashboardAuditSourceRef,
  slice2HistoricalLocalClosure,
  validateSlice2ExternalClosure,
  verifyRegularManagementSource,
} from "../scripts/lib/slice2-external-closure-policy.mjs";

const anchor = JSON.parse(
  readFileSync("governance/slice2-external-closure-anchor-v1.json", "utf8"),
);

function exactAuditLedger(value) {
  return JSON.stringify({
    independentAudits: value.audits.map((id) => ({
      id,
      status: "PASS",
      critical: 0,
      major: 0,
      minor: 0,
      candidateManifestSha256: value.candidate.manifestSha256,
      candidateAggregateSha256: value.candidate.aggregateSha256,
      method: "Injected exact immutable-audit unit fixture",
    })),
  });
}

function exactReport(value = anchor) {
  return [
    `Commit: \`${value.commit}\``,
    `Tree: \`${value.tree}\``,
    `Run: \`${value.runId}\``,
    `Job: \`${value.jobId}\``,
    `Candidate manifest SHA-256: \`${value.candidate.manifestSha256}\``,
    `Candidate aggregate SHA-256: \`${value.candidate.aggregateSha256}\``,
    `Candidate files: \`${value.candidate.fileCount}\``,
    `commit \`${value.auditSource.commit}\`, blob \`${value.auditSource.gitObject}\`, SHA-256 \`${value.auditSource.sha256}\``,
    "`READY_FOR_ROLE2`",
    "`PENDING_ROLE2_LOOP_2_REAUDIT`",
  ].join("\n");
}

function exactHostedObservation(value = anchor) {
  const runUrl = `https://github.com/${value.repository}/actions/runs/${value.runId}`;
  return JSON.stringify({
    schemaVersion: "matchbase.github-hosted-observation/v1",
    repository: value.repository,
    commit: value.commit,
    tree: value.tree,
    workflow: value.workflow,
    runId: value.runId,
    jobId: value.jobId,
    conclusion: value.conclusion,
    observedAt: value.observedAt,
    runUrl,
    jobUrl: `${runUrl}/job/${value.jobId}`,
  });
}

function exactLocalResolvers(value = anchor) {
  const sources = new Map([
    [value.source.path, [value.source.sha256, exactReport(value)]],
    [
      value.hostedSource.path,
      [value.hostedSource.sha256, exactHostedObservation(value)],
    ],
    [value.role2.auditPath, [value.role2.auditSha256, "role2"]],
  ]);
  return {
    regularSourceResolver(source) {
      const expected = sources.get(source.path);
      if (!expected || expected[0] !== source.sha256)
        throw new Error("substituted source");
      return expected[1];
    },
    gitAuditResolver(source) {
      assert.deepEqual(source, value.auditSource);
      return exactAuditLedger(value);
    },
    gitCommitResolver(candidate) {
      assert.equal(candidate.commit, value.commit);
      return value.tree;
    },
  };
}

test("accepts the exact v3 Loop 2 anchor locally and in ANCHOR_ONLY_CI", () => {
  const verified = [];
  assert.equal(
    validateSlice2ExternalClosure(structuredClone(anchor), {
      regularSourceResolver(source, { sourceRoot }) {
        assert.match(
          source.path,
          /^C:\\INNOBASE\\MatchBASE\\01_Product_Management\\/u,
        );
        assert.equal(
          sourceRoot,
          "C:\\INNOBASE\\MatchBASE\\01_Product_Management",
        );
        verified.push(source.path);
      },
      gitAuditResolver(source, { expectedCommit, expectedGitObject }) {
        assert.equal(source.commit, expectedCommit);
        assert.equal(source.gitObject, expectedGitObject);
        return exactAuditLedger(anchor);
      },
      gitCommitResolver(value) {
        assert.equal(value.commit, anchor.commit);
        return anchor.tree;
      },
    }).role2.status,
    "PENDING",
  );
  assert.deepEqual(verified, [
    anchor.source.path,
    anchor.hostedSource.path,
    anchor.role2.auditPath,
  ]);
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

test("accepts one post-hosted successor without a tracked identity edit", () => {
  const value = structuredClone(anchor);
  value.commit = "a".repeat(40);
  value.tree = "b".repeat(40);
  value.runId = 31900000001;
  value.jobId = 95100000001;
  value.observedAt = "2026-08-16T00:00:00Z";
  value.source.path = value.source.path.replace("_V2.md", "_V3.md");
  value.source.sha256 = "C".repeat(64);
  value.hostedSource.path = value.hostedSource.path.replace(
    "_V2.json",
    "_V3.json",
  );
  value.hostedSource.sha256 = "D".repeat(64);
  value.auditSource.commit = value.commit;
  value.auditSource.gitObject = "e".repeat(40);
  value.auditSource.sha256 = "F".repeat(64);
  value.candidate.manifestSha256 = "1".repeat(64);
  value.candidate.aggregateSha256 = "2".repeat(64);
  value.candidate.fileCount = 111;
  value.predecessors.push({
    runId: anchor.runId,
    jobId: anchor.jobId,
    commit: anchor.commit,
    tree: anchor.tree,
    conclusion: "success",
    reason: "PRE_SELF_BOUND_CLOSURE_POLICY",
  });
  assert.equal(
    validateSlice2ExternalClosure(value, exactLocalResolvers(value)).commit,
    value.commit,
  );
});

test("fails closed when the immutable audit Git object is unavailable", () => {
  const emptyRepository = mkdtempSync(join(tmpdir(), "matchbase-s2-shallow-"));
  try {
    assert.throws(
      () =>
        validateSlice2ExternalClosure(structuredClone(anchor), {
          repositoryRoot: emptyRepository,
          regularSourceResolver() {},
        }),
      /Git object/u,
    );
    assert.throws(() =>
      validateSlice2ExternalClosure(structuredClone(anchor), {
        regularSourceResolver() {},
        gitAuditResolver() {
          return JSON.stringify({ independentAudits: [] });
        },
      }),
    );
  } finally {
    rmSync(emptyRepository, { recursive: true, force: true });
  }
});

test("resolves Windows source identity inside a platform-neutral fixture root", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "matchbase-s2-source-"));
  try {
    mkdirSync(join(fixtureRoot, "reports"));
    const content = Buffer.from("immutable closure evidence\n", "utf8");
    writeFileSync(join(fixtureRoot, "reports", "closure.md"), content);
    const source = {
      path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\reports\\closure.md",
      sha256: createHash("sha256").update(content).digest("hex").toUpperCase(),
    };
    assert.doesNotThrow(() =>
      verifyRegularManagementSource(source, { managementRoot: fixtureRoot }),
    );
    assert.throws(() =>
      verifyRegularManagementSource(
        { ...source, path: "/tmp/reports/closure.md" },
        { managementRoot: fixtureRoot },
      ),
    );
    assert.throws(() =>
      verifyRegularManagementSource(
        {
          ...source,
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\..\\outside.md",
        },
        { managementRoot: fixtureRoot },
      ),
    );
    assert.throws(() =>
      verifyRegularManagementSource(
        {
          ...source,
          path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\reports",
        },
        { managementRoot: fixtureRoot },
      ),
    );
    assert.throws(() =>
      verifyRegularManagementSource(
        { ...source, sha256: "F".repeat(64) },
        { managementRoot: fixtureRoot },
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
    (v) => (v.hostedSource.path = "C:\\outside\\forged.json"),
    (v) => (v.hostedSource.sha256 = "F".repeat(64)),
    (v) => (v.hostedSource.method = "forged"),
    (v) => (v.hostedSource.unknown = true),
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
      () => validateSlice2ExternalClosure(value, exactLocalResolvers()),
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
