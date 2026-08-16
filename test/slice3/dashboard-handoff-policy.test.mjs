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
  HOSTED_OBSERVATION_SCHEMA,
  SLICE3_REPORT_MARKER_SCHEMA,
  SLICE3_HANDOFF_VIEWS,
  applySlice3HandoffProjection,
  removeMutableSlice3LoopLogRecords,
  slice3HandoffSourceRef,
  validateSlice3HandoffDashboard,
  validateSlice3HandoffPolicy,
  validateSlice3SuccessorOverlay,
  verifyImmutableLogPrefixSource,
} from "../../scripts/lib/slice3-dashboard-handoff-policy.mjs";

const policyPath = "governance/slice3-dashboard-handoff-policy-v1.json";
const policyBytes = readFileSync(policyPath);
const policy = validateSlice3HandoffPolicy(JSON.parse(policyBytes));
const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();
const successorFixture = {
  runId: 31920000001,
  jobId: 95100000001,
  commit: "1111111111111111111111111111111111111111",
  tree: "2222222222222222222222222222222222222222",
  conclusion: "success",
  reason: "CORRECTED_REPOSITORY_RELEASE",
};
const candidateFixture = {
  manifestSha256: "A".repeat(64),
  aggregateSha256: "B".repeat(64),
  fileCount: 31,
};
const role2Fixture = {
  status: "FAIL",
  acceptanceClaimed: false,
  defects: structuredClone(policy.role2.defects),
};
const reportMarker = {
  schemaVersion: SLICE3_REPORT_MARKER_SCHEMA,
  repository: "banihashem/INNOBASE-MatchBASE",
  successor: successorFixture,
  candidate: candidateFixture,
  repositoryRelease: "PASS",
  slice3Overall: "BLOCKED_PREREQUISITE",
  liveQualification: "BLOCKED_PREREQUISITE",
  role2: role2Fixture,
};
const reportBytes = Buffer.from(
  `# Slice 3 Role 2 Loop 1 correction\n\n<!-- MATCHBASE_SLICE3_ROLE2_LOOP1_RELEASE ${JSON.stringify(reportMarker)} -->\n`,
  "utf8",
);
const hostedBytes = Buffer.from(
  `${JSON.stringify(
    {
      schemaVersion: HOSTED_OBSERVATION_SCHEMA,
      repository: "banihashem/INNOBASE-MatchBASE",
      commit: successorFixture.commit,
      tree: successorFixture.tree,
      workflow: "ci",
      runId: successorFixture.runId,
      jobId: successorFixture.jobId,
      conclusion: "success",
      observedAt: "2026-08-16T03:59:00.000Z",
      runUrl: `https://github.com/banihashem/INNOBASE-MatchBASE/actions/runs/${successorFixture.runId}`,
      jobUrl: `https://github.com/banihashem/INNOBASE-MatchBASE/actions/runs/${successorFixture.runId}/job/${successorFixture.jobId}`,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const sourceBytes = new Map([
  [
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_CORRECTION_VALIDATION_PO_001_SLICE_3_ROLE2_LOOP_1.md",
    reportBytes,
  ],
  [
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_GITHUB_HOSTED_OBSERVATION_PO_001_SLICE_3_ROLE2_LOOP_1.json",
    hostedBytes,
  ],
]);

function exactOverlay() {
  return {
    schemaVersion: "matchbase.slice3-repository-release-successor/v1",
    observedAt: "2026-08-16T04:00:00.000Z",
    repository: "banihashem/INNOBASE-MatchBASE",
    successor: structuredClone(successorFixture),
    predecessors: structuredClone(policy.historicalHosted),
    candidate: structuredClone(candidateFixture),
    repositoryRelease: "PASS",
    slice3Overall: "BLOCKED_PREREQUISITE",
    liveQualification: "BLOCKED_PREREQUISITE",
    blockerCodes: [...policy.blockerCodes],
    blockedAcceptance: [...policy.blockedAcceptance],
    externalMutationLedger: {
      providerCalls: 0,
      billableCalls: 0,
      credentialWrites: 0,
      liveOauth: 0,
      gcp: 0,
      cloudflare: 0,
      dns: 0,
      deployment: 0,
      realUserData: 0,
    },
    role2: structuredClone(role2Fixture),
    reportSource: {
      path: [...sourceBytes.keys()][0],
      sha256: digest(reportBytes),
    },
    hostedSource: {
      path: [...sourceBytes.keys()][1],
      sha256: digest(hostedBytes),
    },
  };
}

function validateOverlay(value = exactOverlay(), options = {}) {
  return validateSlice3SuccessorOverlay(value, policy, {
    sourceResolver: (source) => {
      const bytes = sourceBytes.get(source.path);
      if (!bytes) throw new Error("fixture source missing");
      return bytes;
    },
    gitTreeResolver: () => value.successor.tree,
    ...options,
  });
}

function blankViews() {
  return Object.fromEntries(
    SLICE3_HANDOFF_VIEWS.map((name) => [name, { records: [] }]),
  );
}

function logPrefixFixture() {
  const root = mkdtempSync(join(tmpdir(), "matchbase-s3-log-prefix-"));
  const reports = join(root, "history");
  const path = join(reports, "PRODUCT_MANAGEMENT_LOOP_LOG.md");
  const prefix = Buffer.from(
    "immutable Slice 3 management log prefix\n",
    "utf8",
  );
  mkdirSync(reports);
  writeFileSync(path, Buffer.concat([prefix, Buffer.from("new append\n")]));
  return {
    root,
    path,
    prefix,
    source: {
      path: `${String.raw`C:\INNOBASE\MatchBASE\01_Product_Management`}\\history\\PRODUCT_MANAGEMENT_LOOP_LOG.md`,
      prefixBytes: prefix.length,
      prefixSha256: digest(prefix),
    },
  };
}

test("validates the closed handoff policy without dereferencing a host-specific path", () => {
  assert.equal(validateSlice3HandoffPolicy(policy), policy);
  assert.equal(
    policy.immutableLogPrefix.path,
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\PRODUCT_MANAGEMENT_LOOP_LOG.md",
  );
});

test("resolves the Windows log identity through a contained POSIX or Windows fixture", () => {
  const value = logPrefixFixture();
  try {
    assert.doesNotThrow(() =>
      verifyImmutableLogPrefixSource(value.source, {
        regularSourceRoot: value.root,
        regularSourceResolver: () => value.path,
      }),
    );
    assert.doesNotThrow(() =>
      verifyImmutableLogPrefixSource(value.source, {
        regularSourceRoot: value.root,
        regularSourceResolver: () =>
          process.platform === "win32"
            ? value.path.replaceAll("/", "\\")
            : value.path.replaceAll("\\", "/"),
      }),
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects missing, nonregular, traversal, hash, and prefix-length substitutions", () => {
  const value = logPrefixFixture();
  try {
    const options = (resolver) => ({
      regularSourceRoot: value.root,
      regularSourceResolver: resolver,
    });
    assert.throws(
      () =>
        verifyImmutableLogPrefixSource(
          value.source,
          options(() => join(value.root, "missing.md")),
        ),
      /source is missing/u,
    );
    assert.throws(
      () =>
        verifyImmutableLogPrefixSource(
          value.source,
          options(() => value.root),
        ),
      /regular file/u,
    );
    assert.throws(
      () =>
        verifyImmutableLogPrefixSource(
          value.source,
          options(() => join(value.root, "..", "outside.md")),
        ),
      /escaped its fixture root/u,
    );
    assert.throws(
      () =>
        verifyImmutableLogPrefixSource(
          { ...value.source, prefixSha256: "F".repeat(64) },
          options(() => value.path),
        ),
      /hash mismatch/u,
    );
    assert.throws(
      () =>
        verifyImmutableLogPrefixSource(
          { ...value.source, prefixBytes: value.prefix.length + 100 },
          options(() => value.path),
        ),
      /shorter/u,
    );
    assert.throws(
      () =>
        verifyImmutableLogPrefixSource(
          {
            ...value.source,
            path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\..\\outside.md",
          },
          options(() => value.path),
        ),
      /declared Windows root/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("validates an exact source-bound successor without host-specific fixture paths", () => {
  const value = exactOverlay();
  assert.equal(validateOverlay(value), value);
});

test("rejects successor schema, lifecycle, history, blocker, and same-count substitutions", () => {
  const mutations = [
    (value) => {
      value.unknown = true;
    },
    (value) => {
      value.predecessors.reverse();
    },
    (value) => {
      value.predecessors[0].jobId += 1;
    },
    (value) => {
      value.predecessors.pop();
    },
    (value) => {
      value.blockerCodes[0] = "SUBSTITUTED";
    },
    (value) => {
      value.blockedAcceptance.reverse();
    },
    (value) => {
      value.role2.status = "PENDING";
    },
    (value) => {
      value.role2.defects[0].unknown = true;
    },
    (value) => {
      value.candidate.fileCount += 1;
    },
    (value) => {
      value.externalMutationLedger.providerCalls = 1;
    },
    (value) => {
      value.successor.reason = "STALE";
    },
  ];
  for (const mutate of mutations) {
    const value = exactOverlay();
    mutate(value);
    assert.throws(() => validateOverlay(value));
  }
});

test("rejects source hash, path traversal, unavailable bytes, tree, and anchor-only substitution", () => {
  const badHash = exactOverlay();
  badHash.reportSource.sha256 = "A".repeat(64);
  assert.throws(() => validateOverlay(badHash), /hash/iu);

  const traversal = exactOverlay();
  traversal.reportSource.path =
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\..\\outside.md";
  assert.throws(() => validateOverlay(traversal), /management root/iu);

  const missing = exactOverlay();
  missing.reportSource.path =
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\missing.md";
  assert.throws(() => validateOverlay(missing), /missing/iu);

  const tree = exactOverlay();
  assert.throws(
    () => validateOverlay(tree, { gitTreeResolver: () => "3".repeat(40) }),
    /tree identity/iu,
  );

  assert.throws(
    () => validateOverlay(exactOverlay(), { anchorOnly: true }),
    /anchor-only/iu,
  );
});

test("rejects arbitrary report and incomplete or substituted hosted observations", () => {
  const arbitraryReport = exactOverlay();
  const arbitraryBytes = Buffer.from("bounded report without marker\n", "utf8");
  arbitraryReport.reportSource.sha256 = digest(arbitraryBytes);
  assert.throws(
    () =>
      validateOverlay(arbitraryReport, {
        sourceResolver: (source) =>
          source.path === arbitraryReport.reportSource.path
            ? arbitraryBytes
            : hostedBytes,
      }),
    /report marker/iu,
  );

  const incompleteHosted = exactOverlay();
  const incompleteBytes = Buffer.from('{"conclusion":"success"}\n', "utf8");
  incompleteHosted.hostedSource.sha256 = digest(incompleteBytes);
  assert.throws(
    () =>
      validateOverlay(incompleteHosted, {
        sourceResolver: (source) =>
          source.path === incompleteHosted.hostedSource.path
            ? incompleteBytes
            : reportBytes,
      }),
    /hosted observation/iu,
  );

  const substitutedHosted = exactOverlay();
  const parsed = JSON.parse(hostedBytes);
  parsed.jobId += 1;
  const substitutedBytes = Buffer.from(`${JSON.stringify(parsed)}\n`, "utf8");
  substitutedHosted.hostedSource.sha256 = digest(substitutedBytes);
  assert.throws(
    () =>
      validateOverlay(substitutedHosted, {
        sourceResolver: (source) =>
          source.path === substitutedHosted.hostedSource.path
            ? substitutedBytes
            : reportBytes,
      }),
    /stale or substituted/iu,
  );
});

test("projects the exact successor and blocked lifecycle across all thirteen views", () => {
  const successor = validateOverlay();
  const views = blankViews();
  views.gates.records.push({ id: "S3-G5", sourceRefs: [] });
  const policyRef = slice3HandoffSourceRef(
    policyPath,
    policyBytes,
    successor.observedAt,
  );
  const successorBytes = Buffer.from(JSON.stringify(successor), "utf8");
  const successorRef = slice3HandoffSourceRef(
    "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\successor.json",
    successorBytes,
    successor.observedAt,
    "successor",
  );
  applySlice3HandoffProjection(views, policy, policyRef, {
    successor,
    successorSourceRef: successorRef,
  });
  assert.doesNotThrow(() =>
    validateSlice3HandoffDashboard(views, policy, policyRef, {
      successor,
      successorSourceRef: successorRef,
    }),
  );
  for (const view of Object.values(views))
    assert.equal(
      view.records.filter(({ id }) => id.startsWith("S3-HANDOFF-")).length,
      1,
    );
});

test("rejects omitted, duplicated, stale, error-integrity, source, and mutable-log dashboard records", () => {
  const policyRef = slice3HandoffSourceRef(
    policyPath,
    policyBytes,
    "2026-08-16T04:00:00.000Z",
  );
  const makeViews = () => {
    const views = blankViews();
    views.gates.records.push({ id: "S3-G5", sourceRefs: [] });
    applySlice3HandoffProjection(views, policy, policyRef);
    return views;
  };
  const mutations = [
    (views) => {
      views.portfolio.records = [];
    },
    (views) => {
      views.portfolio.records.push(structuredClone(views.portfolio.records[0]));
    },
    (views) => {
      views.portfolio.records[0].facts.role2Status = "PENDING";
    },
    (views) => {
      views.portfolio.records[0].facts.evidenceIntegrity = "ERROR";
    },
    (views) => {
      views.portfolio.records[0].sourceRefs[0].sha256 = "B".repeat(64);
    },
    (views) => {
      views.portfolio.records[0].sourceRefs.push({
        path: policy.immutableLogPrefix.path,
      });
    },
  ];
  for (const mutate of mutations) {
    const views = makeViews();
    mutate(views);
    assert.throws(() =>
      validateSlice3HandoffDashboard(views, policy, policyRef),
    );
  }

  const views = blankViews();
  views.portfolio.records.push({
    id: "MUTABLE-LOG",
    sourceRefs: [{ path: policy.immutableLogPrefix.path }],
  });
  removeMutableSlice3LoopLogRecords(views, policy);
  assert.equal(views.portfolio.records.length, 0);
});
