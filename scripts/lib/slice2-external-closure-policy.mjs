import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./dashboard-source-policy.mjs";

export const SLICE2_EXTERNAL_CLOSURE_SCHEMA =
  "matchbase.slice2-external-closure/v3";
export const SLICE2_AUDIT_IDS = Object.freeze([
  "S2-AUDIT-SECURITY-PRIVACY",
  "S2-AUDIT-DATA-MIGRATION",
  "S2-AUDIT-AI-EVIDENCE",
  "S2-AUDIT-QA-ACCESSIBILITY",
  "S2-AUDIT-SRE-COST",
  "S2-AUDIT-REPOSITORY-RELEASE",
  "S2-AUDIT-INTEGRATION-CRITIC",
]);
export const SLICE2_MANAGEMENT_ROOT =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
export const SLICE2_REPOSITORY_ROOT =
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE";

const SHA256 = /^[A-F0-9]{64}$/u;
const GIT_ID = /^[a-f0-9]{40}$/u;
const CURRENT = Object.freeze({
  repository: "banihashem/INNOBASE-MatchBASE",
  commit: "0c9b24e0281f195aac240a10d115c570b903c5da",
  tree: "b734676c6d2a16daa16d1c83648595a11395b605",
  runId: 31892595424,
  jobId: 95031000541,
  sourceSha256:
    "6DD97F28A10B29A49E3A83F5FBC092FEC9BA73F9458F166A65CC466523D129A1",
  auditSha256:
    "5599BAE3BEB3F9C7A978253FA623A4841389E809247F36DC909142D10E0EC085",
  auditObject: "4d74050888edc3ac42d49107bef7833a73c28c7d",
  manifestSha256:
    "D14B84B858C667CA31E1640FF7505BB24B44E9D86CB4B1367918EA481AD0A9FA",
  aggregateSha256:
    "5DE817B7BDBA1E4CF421E47C6E2D474F8E6A924B620407684013C37CAD9B767E",
  role2Sha256:
    "551391A0EE4AF9D73248372DB6A3BF9AA9E903C7EC6858883BE5271DD43B5C70",
});
const HISTORICAL = Object.freeze({
  repository: CURRENT.repository,
  commit: "58ed065f8a8e2ac5c60812b13cd4607c1a8d9cb6",
  tree: "358606112d663ac15e2e065557cbbed6f00cae86",
  runId: 31867699009,
  jobId: 94971277544,
  conclusion: "success",
  reason: "ROLE2_REJECTED_THREE_MAJOR_DEFECTS",
  observedAt: "2026-08-15T10:08:43+04:00",
});
const EXPECTED_PREDECESSORS = Object.freeze([
  [
    31866040582,
    94967154804,
    "e81fb9894f3ce1e37c4ec03989987f8d7b920671",
    "1f8bcb7e153497d875b14364cfb1a870fe5cff87",
    "failure",
    "CLEAN_CHECKOUT_CHANGED_SET_RECONCILIATION",
  ],
  [
    31866796215,
    94969070935,
    "0dce5b0c369055d84310c8d8d7545749cf7f8e3c",
    "956d8857c6a670b7d98ebb5393d03b1da48f52a1",
    "failure",
    "UBUNTU_200_PERCENT_TEXT_OVERFLOW",
  ],
  [
    HISTORICAL.runId,
    HISTORICAL.jobId,
    HISTORICAL.commit,
    HISTORICAL.tree,
    HISTORICAL.conclusion,
    HISTORICAL.reason,
  ],
  [
    31873727149,
    94986166204,
    "ac729b1081d4125afe0677b895e93f8f3747c65b",
    "8dcb4447c01b6e1879075ba7bde97773308ef5a2",
    "success",
    "PRE_LIFECYCLE_CORRECTION_CLOSURE",
  ],
  [
    31875408324,
    94990271627,
    "2b9d2686ba02f7f0435a56213d4ee4e274bfc4bb",
    "293949e3a447df986a9e2c4f44cd1a9a6d492f54",
    "failure",
    "ANCHOR_ONLY_CI_LIFECYCLE_PARITY",
  ],
  [
    31877307591,
    94994841309,
    "0d0585d8d610df9594a5445fc1f00421bacf0a6d",
    "f1f7d9692a89326e26c7a0b2e9406b8934e4b782",
    "failure",
    "QUOTA_DECISION_CLOCK_BEFORE_ACCOUNT_LOCK",
  ],
  [
    31878810882,
    94998368632,
    "5e1bf6dc4f7a573220bc74210b65cb9c18401159",
    "1c41f4a68c0f8c448a9ad0216003c3dfc494cbc9",
    "success",
    "ROLE2_REJECTED_TWO_MAJOR_DEFECTS",
  ],
  [
    31884237075,
    95011068050,
    "865bc91a55abba2c20b6951a32061c9a448a9285",
    "f0422bf46e01446116b42205523a2dc7d53609d0",
    "success",
    "PRE_TIMEOUT_CORRECTION_CLOSURE",
  ],
  [
    31886484933,
    95016417693,
    "e87f73e3bd740ae3e72e9886884c1570d9cec50a",
    "96b678707906d39db13cc6e56a72b09ca1dcf67e",
    "failure",
    "ANCHOR_ONLY_CI_AUDIT_SOURCE_PARITY",
  ],
  [
    31888215566,
    95020492397,
    "71df2efe5aef78f3e7f8b2a9b784b77c4d00473f",
    "cb934371ff505da432c15891fab32700e89615e9",
    "failure",
    "POSIX_HOSTED_CLOSURE_TEST_WINDOWS_SOURCE_PATH",
  ],
  [
    31889097732,
    95022584258,
    "7efae9e3ff73fdd814cc414de06cdbfcde22abc7",
    "94610d59c7739cb86423d508f0706745ddc0c4df",
    "failure",
    "SHALLOW_HOSTED_CLOSURE_TEST_GIT_OBJECT_UNAVAILABLE",
  ],
  [
    31889908697,
    95024542251,
    "33762f0aa1bb97c1aaf98bbd665a90464562eddb",
    "1d68f6ac935b686a11ff00382742b765442068b8",
    "failure",
    "UBUNTU_DASHBOARD_390PX_OVERFLOW",
  ],
  [
    31891114910,
    95027409962,
    "869181bdf862641c3892fd640ecbbee663739e21",
    "ae931cb977393c2a55f31f041cf642a34a8060bd",
    "failure",
    "HOSTED_STANDARD_MULTI_SCENARIO_TIMEOUT",
  ],
]);
const SUCCESSOR_PREDECESSOR = Object.freeze([
  CURRENT.runId,
  CURRENT.jobId,
  CURRENT.commit,
  CURRENT.tree,
  "success",
  "PRE_SELF_BOUND_CLOSURE_POLICY",
]);
const ACCEPTANCE_IDS = Object.freeze([
  "L2-C1-AT-01",
  "L2-C1-AT-02",
  "L2-C1-AT-03",
  "L2-C1-AT-04",
  "L2-C2-AT-01",
  "L2-C2-AT-02",
  "L2-C3-AT-01",
  "L2-C3-AT-02",
  "L2-C3-AT-03",
]);

function closed(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} schema is not closed.`);
}

function exactArray(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  )
    throw new Error(
      `${label} is incomplete, duplicated, reordered, or substituted.`,
    );
}

export function verifyRegularManagementSource(
  source,
  {
    managementRoot = SLICE2_MANAGEMENT_ROOT,
    sourceRoot = SLICE2_MANAGEMENT_ROOT,
  } = {},
) {
  if (
    !source ||
    typeof source !== "object" ||
    !win32.isAbsolute(source.path) ||
    !SHA256.test(source.sha256)
  )
    throw new Error("Management source identity is invalid.");
  const relative = win32.relative(sourceRoot, source.path);
  if (
    relative.length === 0 ||
    win32.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${win32.sep}`)
  )
    throw new Error("Management source escapes its declared Windows root.");
  const root = realpathSync(managementRoot);
  const path = resolve(managementRoot, ...relative.split(/[\\/]+/u));
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("Management source must be a regular file.");
  const real = realpathSync(path);
  if (!isPathWithinRoot(root, real))
    throw new Error("Management source escapes its configured root.");
  const bytes = readFileSync(real);
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (digest !== source.sha256)
    throw new Error("Management source hash mismatch.");
  return bytes.toString("utf8");
}

function regularSource(
  source,
  { anchorOnly, managementRoot, regularSourceResolver },
  label,
) {
  closed(source, ["kind", "path", "sha256", "method"], label);
  if (
    source.kind !== "management_artifact" ||
    !win32.isAbsolute(source.path) ||
    !SHA256.test(source.sha256) ||
    !source.method
  )
    throw new Error(`${label} is invalid.`);
  if (anchorOnly) return null;
  return (regularSourceResolver ?? verifyRegularManagementSource)(source, {
    managementRoot,
    sourceRoot: SLICE2_MANAGEMENT_ROOT,
    label,
  });
}

function gitAuditText(
  source,
  { anchorOnly, repositoryRoot, gitAuditResolver, value },
) {
  closed(
    source,
    ["kind", "path", "sha256", "method", "commit", "gitObject"],
    "Slice 2 audit source",
  );
  if (
    source.kind !== "repository_git_object" ||
    source.path !== "evidence/slice2/local-validation.json" ||
    source.commit !== value.commit ||
    !GIT_ID.test(source.gitObject) ||
    !SHA256.test(source.sha256) ||
    source.method !==
      "Exact frozen-candidate discipline audit ledger from successor Git object"
  )
    throw new Error("Slice 2 audit source identity is invalid.");
  if (anchorOnly) return null;
  if (gitAuditResolver)
    return gitAuditResolver(source, {
      repositoryRoot,
      expectedCommit: value.commit,
      expectedGitObject: source.gitObject,
    });
  const resolved = spawnSync(
    "git",
    ["rev-parse", `${source.commit}:${source.path}`],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (resolved.status !== 0 || resolved.stdout.trim() !== source.gitObject)
    throw new Error("Slice 2 audit Git object does not match commit and path.");
  const blob = spawnSync("git", ["cat-file", "blob", source.gitObject], {
    cwd: repositoryRoot,
  });
  if (blob.status !== 0)
    throw new Error("Slice 2 audit Git object is unavailable.");
  const digest = createHash("sha256")
    .update(blob.stdout)
    .digest("hex")
    .toUpperCase();
  if (digest !== source.sha256)
    throw new Error("Slice 2 audit Git object hash mismatch.");
  return blob.stdout.toString("utf8");
}

function validatePredecessors(predecessors, value) {
  const expected =
    value.commit === CURRENT.commit
      ? EXPECTED_PREDECESSORS
      : [...EXPECTED_PREDECESSORS, SUCCESSOR_PREDECESSOR];
  exactArray(
    predecessors?.map((item) =>
      [
        item.runId,
        item.jobId,
        item.commit,
        item.tree,
        item.conclusion,
        item.reason,
      ].join("/"),
    ),
    expected.map((item) => item.join("/")),
    "Slice 2 predecessor history",
  );
  for (const predecessor of predecessors)
    closed(
      predecessor,
      ["runId", "jobId", "commit", "tree", "conclusion", "reason"],
      "Slice 2 predecessor",
    );
}

function validateReportMarkers(text, value) {
  if (text === null || text === undefined) return;
  if (typeof text !== "string")
    throw new Error(
      "Slice 2 closure report resolver returned invalid content.",
    );
  const markers = [
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
  ];
  if (markers.some((marker) => !text.includes(marker)))
    throw new Error(
      "Slice 2 closure report is missing an exact identity marker.",
    );
}

function validateHostedObservation(text, value) {
  if (text === null || text === undefined) return;
  let observation;
  try {
    observation = JSON.parse(text);
  } catch {
    throw new Error("Slice 2 hosted observation is invalid JSON.");
  }
  closed(
    observation,
    [
      "schemaVersion",
      "repository",
      "commit",
      "tree",
      "workflow",
      "runId",
      "jobId",
      "conclusion",
      "observedAt",
      "runUrl",
      "jobUrl",
    ],
    "Slice 2 hosted observation",
  );
  const runUrl = `https://github.com/${value.repository}/actions/runs/${value.runId}`;
  if (
    observation.schemaVersion !== "matchbase.github-hosted-observation/v1" ||
    observation.repository !== value.repository ||
    observation.commit !== value.commit ||
    observation.tree !== value.tree ||
    observation.workflow !== value.workflow ||
    observation.runId !== value.runId ||
    observation.jobId !== value.jobId ||
    observation.conclusion !== value.conclusion ||
    observation.observedAt !== value.observedAt ||
    observation.runUrl !== runUrl ||
    observation.jobUrl !== `${runUrl}/job/${value.jobId}`
  )
    throw new Error("Slice 2 hosted observation is stale or substituted.");
}

function verifyCommitTree(
  value,
  { anchorOnly, repositoryRoot, gitCommitResolver },
) {
  if (anchorOnly) return;
  const actual = gitCommitResolver
    ? gitCommitResolver(value, { repositoryRoot })
    : spawnSync("git", ["rev-parse", `${value.commit}^{tree}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
  const tree =
    typeof actual === "string"
      ? actual.trim()
      : actual?.status === 0
        ? actual.stdout.trim()
        : "";
  if (tree !== value.tree)
    throw new Error(
      "Slice 2 closure commit/tree identity is unavailable or stale.",
    );
}

function validateAuditLedger(text, value) {
  let evidence;
  try {
    evidence = JSON.parse(text);
  } catch {
    throw new Error("Slice 2 audit ledger is invalid JSON.");
  }
  exactArray(
    evidence?.independentAudits?.map(({ id }) => id),
    SLICE2_AUDIT_IDS,
    "Slice 2 audit ledger",
  );
  for (const audit of evidence.independentAudits) {
    closed(
      audit,
      [
        "id",
        "status",
        "critical",
        "major",
        "minor",
        "candidateManifestSha256",
        "candidateAggregateSha256",
        "method",
      ],
      "Slice 2 audit entry",
    );
    if (
      audit.status !== "PASS" ||
      audit.critical !== 0 ||
      audit.major !== 0 ||
      audit.minor !== 0 ||
      !audit.method ||
      audit.candidateManifestSha256 !== value.candidate.manifestSha256 ||
      audit.candidateAggregateSha256 !== value.candidate.aggregateSha256
    )
      throw new Error("Slice 2 audit ledger is stale or differently bound.");
  }
}

export function validateSlice2ExternalClosure(
  value,
  {
    anchorOnly = false,
    managementRoot = SLICE2_MANAGEMENT_ROOT,
    repositoryRoot = SLICE2_REPOSITORY_ROOT,
    regularSourceResolver,
    gitAuditResolver,
    gitCommitResolver,
  } = {},
) {
  closed(
    value,
    [
      "schemaVersion",
      "closureLoop",
      "repository",
      "commit",
      "tree",
      "workflow",
      "runId",
      "jobId",
      "conclusion",
      "observedAt",
      "source",
      "hostedSource",
      "auditSource",
      "predecessors",
      "candidate",
      "role3Disposition",
      "role2",
      "audits",
      "gates",
      "acceptance",
      "externalMutations",
    ],
    "Slice 2 external closure",
  );
  if (
    value.schemaVersion !== SLICE2_EXTERNAL_CLOSURE_SCHEMA ||
    value.closureLoop !== "ROLE2_LOOP_2" ||
    value.repository !== CURRENT.repository ||
    !GIT_ID.test(value.commit) ||
    !GIT_ID.test(value.tree) ||
    value.workflow !== "ci" ||
    !Number.isSafeInteger(value.runId) ||
    value.runId <= 0 ||
    !Number.isSafeInteger(value.jobId) ||
    value.jobId <= 0 ||
    value.conclusion !== "success" ||
    Number.isNaN(Date.parse(value.observedAt))
  )
    throw new Error("Slice 2 external closure identity is invalid or stale.");
  if (
    value.source?.kind !== "management_artifact" ||
    !/^ROLE3_CORRECTION_VALIDATION_PO_001_SLICE_2_ROLE2_LOOP_2_V[23]\.md$/u.test(
      win32.basename(value.source.path),
    ) ||
    value.source.method !==
      "Authenticated hosted Slice 2 Role 2 Loop 2 correction closure recorded by Role 3"
  )
    throw new Error("Slice 2 closure source identity is invalid.");
  const reportText = regularSource(
    value.source,
    { anchorOnly, managementRoot, regularSourceResolver },
    "Slice 2 closure source",
  );
  if (
    value.hostedSource?.kind !== "management_artifact" ||
    !/^ROLE3_GITHUB_HOSTED_OBSERVATION_PO_001_SLICE_2_ROLE2_LOOP_2_V[23]\.json$/u.test(
      win32.basename(value.hostedSource.path),
    ) ||
    value.hostedSource.method !==
      "Authenticated GitHub Actions hosted observation recorded by Role 3"
  )
    throw new Error("Slice 2 hosted source identity is invalid.");
  const hostedText = regularSource(
    value.hostedSource,
    { anchorOnly, managementRoot, regularSourceResolver },
    "Slice 2 hosted source",
  );
  const auditText = gitAuditText(value.auditSource, {
    anchorOnly,
    repositoryRoot,
    gitAuditResolver,
    value,
  });
  validatePredecessors(value.predecessors, value);
  closed(
    value.candidate,
    ["manifestPath", "manifestSha256", "aggregateSha256", "fileCount"],
    "Slice 2 candidate",
  );
  if (
    value.candidate.manifestPath !==
      "evidence/slice2/candidate-manifest.json" ||
    !SHA256.test(value.candidate.manifestSha256) ||
    !SHA256.test(value.candidate.aggregateSha256) ||
    !Number.isSafeInteger(value.candidate.fileCount) ||
    value.candidate.fileCount <= 0
  )
    throw new Error("Slice 2 candidate identity is invalid.");
  closed(
    value.role2,
    [
      "status",
      "disposition",
      "auditPath",
      "auditSha256",
      "critical",
      "major",
      "minor",
      "defects",
    ],
    "Slice 2 Role 2 state",
  );
  if (
    value.role3Disposition !== "READY_FOR_ROLE2" ||
    value.role2.status !== "PENDING" ||
    value.role2.disposition !== "PENDING_ROLE2_LOOP_2_REAUDIT" ||
    win32.basename(value.role2.auditPath) !==
      "ROLE2_INDEPENDENT_REAUDIT_PO_001_SLICE_2_LOOP_1.md" ||
    value.role2.auditSha256 !== CURRENT.role2Sha256 ||
    value.role2.critical !== 0 ||
    value.role2.major !== 0 ||
    value.role2.minor !== 0
  )
    throw new Error("Slice 2 Role 2 lifecycle is invalid.");
  exactArray(
    value.role2.defects?.map(({ id }) => id),
    ["S2-R2-L1-D001", "S2-R2-L1-D002"],
    "Slice 2 Role 2 defects",
  );
  for (const defect of value.role2.defects) {
    closed(
      defect,
      ["id", "severity", "status", "title"],
      "Slice 2 Role 2 defect",
    );
    if (
      defect.severity !== "major" ||
      defect.status !== "CORRECTED_PENDING_ROLE2" ||
      !defect.title
    )
      throw new Error("Slice 2 Role 2 defect lifecycle is invalid.");
  }
  regularSource(
    {
      kind: "management_artifact",
      path: value.role2.auditPath,
      sha256: value.role2.auditSha256,
      method: "Independent Slice 2 Role 2 Loop 1 re-audit",
    },
    { anchorOnly, managementRoot, regularSourceResolver },
    "Slice 2 Role 2 source",
  );
  exactArray(value.audits, SLICE2_AUDIT_IDS, "Slice 2 audit identities");
  closed(value.gates, ["S2-G2", "S2-G9"], "Slice 2 gates");
  if (value.gates["S2-G2"] !== "PASS" || value.gates["S2-G9"] !== "PASS")
    throw new Error("Slice 2 gates are stale.");
  closed(value.acceptance, ACCEPTANCE_IDS, "Slice 2 acceptance");
  if (ACCEPTANCE_IDS.some((id) => value.acceptance[id] !== "PASS"))
    throw new Error("Slice 2 acceptance is stale.");
  closed(
    value.externalMutations,
    ["gcp", "cloudflare", "deployment", "liveOauth", "liveProviders"],
    "Slice 2 external mutation state",
  );
  if (
    value.externalMutations.gcp !== "NONE" ||
    value.externalMutations.cloudflare !== "NONE" ||
    ["deployment", "liveOauth", "liveProviders"].some(
      (key) => value.externalMutations[key] !== "NOT_STARTED",
    )
  )
    throw new Error("Slice 2 closure claims prohibited external mutation.");
  if (!anchorOnly) validateAuditLedger(auditText, value);
  validateReportMarkers(reportText, value);
  validateHostedObservation(hostedText, value);
  verifyCommitTree(value, {
    anchorOnly,
    repositoryRoot,
    gitCommitResolver,
  });
  return value;
}

export function slice2HistoricalLocalClosure(value) {
  validatePredecessors(value.predecessors, value);
  if (Date.parse(HISTORICAL.observedAt) >= Date.parse(value.observedAt))
    throw new Error("Slice 2 historical closure violates temporal causality.");
  return {
    repository: HISTORICAL.repository,
    commit: HISTORICAL.commit,
    tree: HISTORICAL.tree,
    runId: HISTORICAL.runId,
    jobId: HISTORICAL.jobId,
    conclusion: HISTORICAL.conclusion,
    observedAt: HISTORICAL.observedAt,
    source: {
      method:
        "Exact historical predecessor from the versioned Slice 2 closure anchor",
    },
    role2: { status: "FAIL" },
  };
}

export function slice2ClosureSourceRef(value) {
  return {
    sourceId: "matchbase://slice2-external-closure/role3-validation",
    path: value.source.path,
    sha256: value.source.sha256,
    observedAt: value.observedAt,
  };
}

export function slice2AuditSourceRef(value) {
  return {
    sourceId:
      "matchbase://slice2-external-closure/audits-git-object-attestation",
    path: value.source.path,
    sha256: value.source.sha256,
    observedAt: value.observedAt,
  };
}

export function slice2DashboardAuditSourceRef(
  value,
  { anchorOnly = false, anchorSourceRef } = {},
) {
  if (!anchorOnly) return slice2AuditSourceRef(value);
  if (
    !anchorSourceRef ||
    typeof anchorSourceRef.sourceId !== "string" ||
    typeof anchorSourceRef.path !== "string" ||
    !SHA256.test(anchorSourceRef.sha256) ||
    anchorSourceRef.observedAt !== value.observedAt
  )
    throw new Error("Slice 2 CI audit anchor source identity is invalid.");
  return { ...anchorSourceRef };
}

export function slice2Role2SourceRef(value) {
  return {
    sourceId: "matchbase://slice2-external-closure/role2-audit",
    path: value.role2.auditPath,
    sha256: value.role2.auditSha256,
    observedAt: value.observedAt,
  };
}
