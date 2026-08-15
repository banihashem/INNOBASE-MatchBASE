import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./dashboard-source-policy.mjs";

export const SLICE2_EXTERNAL_CLOSURE_SCHEMA =
  "matchbase.slice2-external-closure/v2";
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
const CURRENT = Object.freeze({
  repository: "banihashem/INNOBASE-MatchBASE",
  commit: "865bc91a55abba2c20b6951a32061c9a448a9285",
  tree: "f0422bf46e01446116b42205523a2dc7d53609d0",
  runId: 31884237075,
  jobId: 95011068050,
  sourceSha256:
    "0F7684A613BB7DA68AE1D5557D53E16A31BE29214C88F88C690359DE52185DC7",
  auditSha256:
    "62B8625EFC2539D83209BEA8A1E841067C891EF75E585975D2F60D4E8F81BCB5",
  auditObject: "4a6cd876d5f33d849e3ad34ab94997862e71b33c",
  manifestSha256:
    "B79BE7FF137CA8B7B16606BE08BC3BF9C36A729E3DA24EC90B6D2BEBE8824FF4",
  aggregateSha256:
    "F5C31E26F56196BF72EDF0CE7A56F9F0E99D88FB37B98D79F79B3F408BC0AAFE",
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
  const digest = createHash("sha256")
    .update(readFileSync(real))
    .digest("hex")
    .toUpperCase();
  if (digest !== source.sha256)
    throw new Error("Management source hash mismatch.");
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
  if (anchorOnly) return;
  (regularSourceResolver ?? verifyRegularManagementSource)(source, {
    managementRoot,
    sourceRoot: SLICE2_MANAGEMENT_ROOT,
    label,
  });
}

function gitAuditText(
  source,
  { anchorOnly, repositoryRoot, gitAuditResolver },
) {
  closed(
    source,
    ["kind", "path", "sha256", "method", "commit", "gitObject"],
    "Slice 2 audit source",
  );
  if (
    source.kind !== "repository_git_object" ||
    source.path !== "evidence/slice2/local-validation.json" ||
    source.commit !== CURRENT.commit ||
    source.gitObject !== CURRENT.auditObject ||
    source.sha256 !== CURRENT.auditSha256 ||
    source.method !==
      "Exact frozen-candidate discipline audit ledger from successor Git object"
  )
    throw new Error("Slice 2 audit source identity is invalid.");
  if (anchorOnly) return null;
  if (gitAuditResolver)
    return gitAuditResolver(source, {
      repositoryRoot,
      expectedCommit: CURRENT.commit,
      expectedGitObject: CURRENT.auditObject,
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

function validatePredecessors(predecessors) {
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
    EXPECTED_PREDECESSORS.map((item) => item.join("/")),
    "Slice 2 predecessor history",
  );
  for (const predecessor of predecessors)
    closed(
      predecessor,
      ["runId", "jobId", "commit", "tree", "conclusion", "reason"],
      "Slice 2 predecessor",
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
    value.commit !== CURRENT.commit ||
    value.tree !== CURRENT.tree ||
    value.workflow !== "ci" ||
    value.runId !== CURRENT.runId ||
    value.jobId !== CURRENT.jobId ||
    value.conclusion !== "success" ||
    Number.isNaN(Date.parse(value.observedAt))
  )
    throw new Error("Slice 2 external closure identity is invalid or stale.");
  if (
    value.source?.kind !== "management_artifact" ||
    win32.basename(value.source.path) !==
      "ROLE3_CORRECTION_VALIDATION_PO_001_SLICE_2_ROLE2_LOOP_2.md" ||
    value.source.sha256 !== CURRENT.sourceSha256 ||
    value.source.method !==
      "Authenticated hosted Slice 2 Role 2 Loop 2 correction closure recorded by Role 3"
  )
    throw new Error("Slice 2 closure source identity is invalid.");
  regularSource(
    value.source,
    { anchorOnly, managementRoot, regularSourceResolver },
    "Slice 2 closure source",
  );
  const auditText = gitAuditText(value.auditSource, {
    anchorOnly,
    repositoryRoot,
    gitAuditResolver,
  });
  validatePredecessors(value.predecessors);
  closed(
    value.candidate,
    ["manifestPath", "manifestSha256", "aggregateSha256", "fileCount"],
    "Slice 2 candidate",
  );
  if (
    value.candidate.manifestPath !==
      "evidence/slice2/candidate-manifest.json" ||
    value.candidate.manifestSha256 !== CURRENT.manifestSha256 ||
    value.candidate.aggregateSha256 !== CURRENT.aggregateSha256 ||
    value.candidate.fileCount !== 109
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
  return value;
}

export function slice2HistoricalLocalClosure(value) {
  validatePredecessors(value.predecessors);
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
