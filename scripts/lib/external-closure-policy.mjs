import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./dashboard-source-policy.mjs";
import {
  assertExactPredecessorHistory,
  validatePredecessorAttestation,
  validatePredecessorFailures,
  validatePredecessorReasons,
} from "./predecessor-failure-policy.mjs";

export const EXTERNAL_CLOSURE_SCHEMA = "matchbase.external-closure/v2";
export const EXPECTED_REPOSITORY = "banihashem/INNOBASE-MatchBASE";
export const MANAGEMENT_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
export const REPOSITORY_ROOT =
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE";
const ANCHORED_VALIDATION_SHA256 =
  "6DCF84EAEF0AE0723DF427795AF39ED22145534136DA21958D4ED47E65FF9EB8";
const ANCHORED_ROLE2_AUDIT_SHA256 =
  "5BADF31B4BF8A6E84EF73F2162EC6C03F0DDB3EBC9F6AF49AD7A52E13D729362";
const ANCHORED_PREDECESSOR_SOURCE_SHA256 =
  "36C97BA82BB61FE4368649EFE2B45EB3918A3F2FE394021B352C610B5393E592";
const ANCHORED_PREDECESSOR_SOURCE = Object.freeze({
  kind: "repository_artifact",
  path: `${REPOSITORY_ROOT}\\governance\\predecessor-failures-v1.json`,
  method:
    "Versioned repository attestation of exact authenticated failed workflow identities",
});
const ANCHORED_COMMIT = "20045ee79c9ee8474a7570ac9b530ec3ab28743b";
const ANCHORED_TREE = "2652ab2f78aea8adfe86319780cef9d49a7c0506";
const ANCHORED_RUN_ID = 31843338726;
const ANCHORED_JOB_ID = 94904668210;
const ANCHORED_PREDECESSOR_FAILURES = [
  {
    runId: 31828022521,
    jobId: 94856743504,
    commit: "edd721df00fa14d048e36d76bbe5366841a6a672",
    conclusion: "failure",
  },
  {
    runId: 31839133155,
    jobId: 94891988899,
    commit: "9ba20d0e60992b844d036a32d8e1bae8934f291c",
    conclusion: "failure",
  },
  {
    runId: 31841980355,
    jobId: 94900624954,
    commit: "23c932c4b731e02976e86cf23f25f49a0653b242",
    conclusion: "failure",
  },
  {
    runId: 31848282665,
    jobId: 94919022117,
    commit: "d44fc5305473725600237f0de40d8e66568cb3b7",
    conclusion: "failure",
  },
];
const ANCHORED_PREDECESSOR_REASONS = [
  { runId: 31828022521, reasonCode: "UNREVIEWED_LGPL_LICENSE_POLICY" },
  { runId: 31839133155, reasonCode: "POSIX_SOURCE_PATH_MISCLASSIFICATION" },
  {
    runId: 31841980355,
    reasonCode: "EXTERNAL_CLOSURE_IDENTITY_REJECTION_ORDER",
  },
  { runId: 31848282665, reasonCode: "DASHBOARD_MOBILE_OVERFLOW" },
];

const sha256Pattern = /^[A-F0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
function assertClosedObject(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer.`);
}

function validateEvidenceSource(
  source,
  { anchorOnly, managementRoot, repositoryRoot },
) {
  assertClosedObject(
    source,
    new Set(["kind", "path", "sha256", "method"]),
    "External closure source",
  );
  if (
    !["management_artifact", "repository_artifact"].includes(source.kind) ||
    typeof source.path !== "string" ||
    !win32.isAbsolute(source.path) ||
    !sha256Pattern.test(source.sha256) ||
    typeof source.method !== "string" ||
    !source.method.trim()
  ) {
    throw new Error("External closure source is incomplete or unverified.");
  }
  if (anchorOnly) return null;
  const root = realpathSync(
    source.kind === "management_artifact" ? managementRoot : repositoryRoot,
  );
  const path = resolve(source.path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("External closure source must be a regular file.");
  const realPath = realpathSync(path);
  if (!isPathWithinRoot(root, realPath))
    throw new Error("External closure source escapes its configured root.");
  const bytes = readFileSync(realPath);
  const actual = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (actual !== source.sha256)
    throw new Error("External closure source hash mismatch.");
  return bytes.toString("utf8");
}

function bindClosureIdentityToSource(value, sourceText, anchorOnly) {
  const anchored = value.source.sha256 === ANCHORED_VALIDATION_SHA256;
  if (anchored) {
    if (
      value.commit !== ANCHORED_COMMIT ||
      value.tree !== ANCHORED_TREE ||
      value.runId !== ANCHORED_RUN_ID ||
      value.jobId !== ANCHORED_JOB_ID
    )
      throw new Error(
        "Historical closure source cannot attest another identity.",
      );
    return;
  }
  if (anchorOnly || typeof sourceText !== "string")
    throw new Error(
      "Successor closure source is unavailable for identity binding.",
    );
  const marker = sourceText
    .split(/\r?\n/u)
    .find((line) => line.startsWith("MATCHBASE_EXTERNAL_CLOSURE_V2: "));
  if (!marker)
    throw new Error(
      "Successor closure source lacks its machine-readable identity.",
    );
  let attestation;
  try {
    attestation = JSON.parse(
      marker.slice("MATCHBASE_EXTERNAL_CLOSURE_V2: ".length),
    );
  } catch {
    throw new Error("Successor closure identity attestation is invalid JSON.");
  }
  assertClosedObject(
    attestation,
    new Set([
      "repository",
      "commit",
      "tree",
      "workflow",
      "runId",
      "jobId",
      "conclusion",
      "predecessorFailures",
      "predecessorFailureReasons",
    ]),
    "Successor closure identity attestation",
  );
  for (const key of [
    "repository",
    "commit",
    "tree",
    "workflow",
    "runId",
    "jobId",
    "conclusion",
  ])
    if (attestation[key] !== value[key])
      throw new Error(`Successor closure ${key} does not match its source.`);
  validatePredecessorFailures(attestation.predecessorFailures, {
    currentRunId: value.runId,
    currentJobId: value.jobId,
    currentCommit: value.commit,
  });
  validatePredecessorReasons(
    attestation.predecessorFailureReasons,
    attestation.predecessorFailures,
  );
  assertExactPredecessorHistory(
    attestation.predecessorFailures,
    attestation.predecessorFailureReasons,
    value.predecessorFailures,
    value.predecessorFailureReasons,
  );
}

function bindPredecessorHistoryToSource(value, sourceText, anchorOnly) {
  if (anchorOnly) {
    for (const key of ["kind", "path", "method"])
      if (value.predecessorSource[key] !== ANCHORED_PREDECESSOR_SOURCE[key])
        throw new Error(`Hosted predecessor history anchor ${key} mismatch.`);
    if (value.predecessorSource.sha256 !== ANCHORED_PREDECESSOR_SOURCE_SHA256)
      throw new Error("Hosted predecessor history anchor hash mismatch.");
    assertExactPredecessorHistory(
      value.predecessorFailures,
      value.predecessorFailureReasons,
      ANCHORED_PREDECESSOR_FAILURES,
      ANCHORED_PREDECESSOR_REASONS,
    );
    return;
  }
  if (typeof sourceText !== "string")
    throw new Error("Predecessor history source is unavailable.");
  let attestation;
  try {
    if (value.predecessorSource.kind === "repository_artifact") {
      attestation = validatePredecessorAttestation(JSON.parse(sourceText), {
        currentRunId: value.runId,
        currentJobId: value.jobId,
        currentCommit: value.commit,
      });
      assertExactPredecessorHistory(
        attestation.failures,
        attestation.reasons,
        value.predecessorFailures,
        value.predecessorFailureReasons,
      );
      return;
    }
    const marker = sourceText
      .split(/\r?\n/u)
      .find((line) => line.startsWith("MATCHBASE_EXTERNAL_CLOSURE_V2: "));
    if (!marker) throw new Error("missing marker");
    attestation = JSON.parse(
      marker.slice("MATCHBASE_EXTERNAL_CLOSURE_V2: ".length),
    );
  } catch {
    throw new Error("Predecessor history attestation is invalid.");
  }
  validatePredecessorFailures(attestation.predecessorFailures, {
    currentRunId: value.runId,
    currentJobId: value.jobId,
    currentCommit: value.commit,
  });
  validatePredecessorReasons(
    attestation.predecessorFailureReasons,
    attestation.predecessorFailures,
  );
  assertExactPredecessorHistory(
    attestation.predecessorFailures,
    attestation.predecessorFailureReasons,
    value.predecessorFailures,
    value.predecessorFailureReasons,
  );
}

function rejectAnchoredIdentityDivergence(value) {
  if (
    value.source?.sha256 === ANCHORED_VALIDATION_SHA256 &&
    (value.commit !== ANCHORED_COMMIT ||
      value.tree !== ANCHORED_TREE ||
      value.runId !== ANCHORED_RUN_ID ||
      value.jobId !== ANCHORED_JOB_ID)
  )
    throw new Error(
      "Historical closure source cannot attest another identity.",
    );
}

export function validateExternalClosure(
  value,
  {
    anchorOnly = false,
    managementRoot = MANAGEMENT_ROOT,
    repositoryRoot = REPOSITORY_ROOT,
    expectedRepository = EXPECTED_REPOSITORY,
  } = {},
) {
  assertClosedObject(
    value,
    new Set([
      "schemaVersion",
      "repository",
      "commit",
      "tree",
      "workflow",
      "runId",
      "jobId",
      "conclusion",
      "observedAt",
      "source",
      "predecessorSource",
      "predecessorFailures",
      "predecessorFailureReasons",
      "role2",
      "closureStatus",
      "role2Status",
      "externalMutations",
    ]),
    "External closure",
  );
  if (value.schemaVersion !== EXTERNAL_CLOSURE_SCHEMA)
    throw new Error("External closure schema is unsupported.");
  if (value.repository !== expectedRepository)
    throw new Error("External closure repository mismatch.");
  if (!commitPattern.test(value.commit) || !commitPattern.test(value.tree))
    throw new Error("External closure commit or tree is invalid.");
  if (
    anchorOnly &&
    (value.commit !== ANCHORED_COMMIT ||
      value.tree !== ANCHORED_TREE ||
      value.runId !== ANCHORED_RUN_ID ||
      value.jobId !== ANCHORED_JOB_ID)
  )
    throw new Error("Hosted closure identity does not match its CI anchor.");
  if (value.workflow !== "ci")
    throw new Error("External closure workflow mismatch.");
  positiveInteger(value.runId, "External closure runId");
  positiveInteger(value.jobId, "External closure jobId");
  if (value.conclusion !== "success")
    throw new Error("External closure is not successful.");
  if (
    typeof value.observedAt !== "string" ||
    Number.isNaN(Date.parse(value.observedAt))
  )
    throw new Error("External closure observation time is invalid.");
  rejectAnchoredIdentityDivergence(value);
  if (value.source?.kind !== "management_artifact")
    throw new Error("External closure identity requires management evidence.");
  const closureSourceText = validateEvidenceSource(value.source, {
    anchorOnly,
    managementRoot,
    repositoryRoot,
  });
  bindClosureIdentityToSource(value, closureSourceText, anchorOnly);
  if (anchorOnly && value.source.sha256 !== ANCHORED_VALIDATION_SHA256)
    throw new Error("Hosted closure validation anchor hash mismatch.");

  validatePredecessorFailures(value.predecessorFailures, {
    currentRunId: value.runId,
    currentJobId: value.jobId,
    currentCommit: value.commit,
  });
  validatePredecessorReasons(
    value.predecessorFailureReasons,
    value.predecessorFailures,
  );
  const predecessorSourceText = validateEvidenceSource(
    value.predecessorSource,
    { anchorOnly, managementRoot, repositoryRoot },
  );
  bindPredecessorHistoryToSource(value, predecessorSourceText, anchorOnly);

  assertClosedObject(
    value.role2,
    new Set([
      "status",
      "disposition",
      "auditPath",
      "auditSha256",
      "critical",
      "major",
      "minor",
      "defects",
    ]),
    "Role 2 closure",
  );
  if (
    value.role2.status !== "FAIL" ||
    value.role2.disposition !== "PENDING_ROLE2_CORRECTION_REAUDIT" ||
    !win32.isAbsolute(value.role2.auditPath) ||
    !sha256Pattern.test(value.role2.auditSha256) ||
    value.role2.critical !== 0 ||
    value.role2.major !== 1 ||
    value.role2.minor !== 0 ||
    !Array.isArray(value.role2.defects) ||
    value.role2.defects.length !== 3
  )
    throw new Error("Role 2 correction-loop state is invalid.");
  validateEvidenceSource(
    {
      kind: "management_artifact",
      path: value.role2.auditPath,
      sha256: value.role2.auditSha256,
      method: "Independent Role 2 correction-loop audit",
    },
    { anchorOnly, managementRoot, repositoryRoot },
  );
  if (anchorOnly && value.role2.auditSha256 !== ANCHORED_ROLE2_AUDIT_SHA256)
    throw new Error("Role 2 audit anchor hash mismatch.");
  const defectIds = value.role2.defects.map(({ id }) => id);
  if (
    new Set(defectIds).size !== 3 ||
    !["S1-L1-D001", "S1-L1-D003", "S1-L1-RD002"].every((id) =>
      defectIds.includes(id),
    )
  )
    throw new Error("Role 2 defect identities are incomplete.");
  for (const defect of value.role2.defects) {
    assertClosedObject(
      defect,
      new Set(["id", "severity", "status", "title"]),
      "Role 2 defect",
    );
    if (
      defect.severity !== "major" ||
      !["OPEN", "CORRECTED_PENDING_ROLE2", "CLOSED_BY_ROLE2"].includes(
        defect.status,
      ) ||
      typeof defect.title !== "string" ||
      !defect.title.trim()
    )
      throw new Error("Role 2 defect state is invalid.");
  }
  const defectStatus = new Map(
    value.role2.defects.map(({ id, status }) => [id, status]),
  );
  if (
    defectStatus.get("S1-L1-D001") !== "CLOSED_BY_ROLE2" ||
    defectStatus.get("S1-L1-D003") !== "CLOSED_BY_ROLE2" ||
    !["OPEN", "CORRECTED_PENDING_ROLE2"].includes(
      defectStatus.get("S1-L1-RD002"),
    )
  )
    throw new Error("Role 2 defect closure states are inconsistent.");
  if (
    value.closureStatus !== "HOSTED_VERIFIED" ||
    value.role2Status !== "PENDING_ROLE2"
  )
    throw new Error("External closure disposition is invalid.");
  assertClosedObject(
    value.externalMutations,
    new Set(["gcp", "cloudflare", "deployment", "liveOauth", "liveProviders"]),
    "External mutation state",
  );
  if (
    value.externalMutations.gcp !== "NONE" ||
    value.externalMutations.cloudflare !== "NONE" ||
    ["deployment", "liveOauth", "liveProviders"].some(
      (key) => value.externalMutations[key] !== "NOT_STARTED",
    )
  )
    throw new Error("External closure claims prohibited mutation.");
  return value;
}

export function externalClosureSourceRef(value) {
  return {
    sourceId: "matchbase://external-closure/role3-validation",
    path: value.source.path,
    sha256: value.source.sha256,
    observedAt: value.observedAt,
  };
}

export function externalClosureRole2SourceRef(value) {
  return {
    sourceId: "matchbase://external-closure/role2-audit",
    path: value.role2.auditPath,
    sha256: value.role2.auditSha256,
    observedAt: value.observedAt,
  };
}

export function externalClosurePredecessorSourceRef(value) {
  return {
    sourceId: "matchbase://external-closure/predecessor-failures",
    path: value.predecessorSource.path,
    sha256: value.predecessorSource.sha256,
    observedAt: value.observedAt,
  };
}
