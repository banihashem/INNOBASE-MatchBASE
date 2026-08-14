import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./dashboard-source-policy.mjs";

export const EXTERNAL_CLOSURE_SCHEMA = "matchbase.external-closure/v1";
export const EXPECTED_REPOSITORY = "banihashem/INNOBASE-MatchBASE";
export const MANAGEMENT_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const ANCHORED_VALIDATION_SHA256 =
  "C515E7E9F97D869404ED2D9C7AB3A5150D68B692261E7A2DE33B4BFE5976C4D3";
const ANCHORED_ROLE2_AUDIT_SHA256 =
  "4AAD383752ACA2FB51EA4A5CA5BCDE6FC4B8BAC7A7B2AA39C035DE0A04D9745E";
const ANCHORED_COMMIT = "dcfc44b0eb5ffaa5fc3af9b64f1cb9f2df2460ad";
const ANCHORED_TREE = "1a58415215dfae7c318f31a83d479ed579936a56";
const ANCHORED_RUN_ID = 31829362742;
const ANCHORED_JOB_ID = 94861065649;

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

function validateEvidenceSource(source, { anchorOnly, managementRoot }) {
  assertClosedObject(
    source,
    new Set(["kind", "path", "sha256", "method"]),
    "External closure source",
  );
  if (
    source.kind !== "management_artifact" ||
    typeof source.path !== "string" ||
    !win32.isAbsolute(source.path) ||
    !sha256Pattern.test(source.sha256) ||
    typeof source.method !== "string" ||
    !source.method.trim()
  ) {
    throw new Error("External closure source is incomplete or unverified.");
  }
  if (anchorOnly) return null;
  const root = realpathSync(managementRoot);
  const path = resolve(source.path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("External closure source must be a regular file.");
  const realPath = realpathSync(path);
  if (!isPathWithinRoot(root, realPath))
    throw new Error("External closure source escapes the management root.");
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
    .find((line) => line.startsWith("MATCHBASE_EXTERNAL_CLOSURE_V1: "));
  if (!marker)
    throw new Error(
      "Successor closure source lacks its machine-readable identity.",
    );
  let attestation;
  try {
    attestation = JSON.parse(
      marker.slice("MATCHBASE_EXTERNAL_CLOSURE_V1: ".length),
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
}

export function validateExternalClosure(
  value,
  {
    anchorOnly = false,
    managementRoot = MANAGEMENT_ROOT,
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
      "predecessorFailures",
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
  const closureSourceText = validateEvidenceSource(value.source, {
    anchorOnly,
    managementRoot,
  });
  bindClosureIdentityToSource(value, closureSourceText, anchorOnly);
  if (anchorOnly && value.source.sha256 !== ANCHORED_VALIDATION_SHA256)
    throw new Error("Hosted closure validation anchor hash mismatch.");

  if (
    !Array.isArray(value.predecessorFailures) ||
    value.predecessorFailures.length === 0
  )
    throw new Error("External closure must preserve predecessor failures.");
  const predecessorIds = new Set();
  for (const failure of value.predecessorFailures) {
    assertClosedObject(
      failure,
      new Set(["runId", "jobId", "conclusion", "commit"]),
      "Predecessor failure",
    );
    positiveInteger(failure.runId, "Predecessor runId");
    positiveInteger(failure.jobId, "Predecessor jobId");
    if (
      failure.conclusion !== "failure" ||
      !commitPattern.test(failure.commit) ||
      failure.commit === value.commit
    )
      throw new Error("Predecessor failure identity is invalid.");
    const key = `${failure.runId}:${failure.jobId}`;
    if (predecessorIds.has(key))
      throw new Error("Duplicate predecessor failure.");
    predecessorIds.add(key);
  }

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
    value.role2.major !== 3 ||
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
    { anchorOnly, managementRoot },
  );
  if (anchorOnly && value.role2.auditSha256 !== ANCHORED_ROLE2_AUDIT_SHA256)
    throw new Error("Role 2 audit anchor hash mismatch.");
  const defectIds = value.role2.defects.map(({ id }) => id);
  if (
    new Set(defectIds).size !== 3 ||
    !["S1-L1-D001", "S1-L1-D002", "S1-L1-D003"].every((id) =>
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
      !["OPEN", "CORRECTED_PENDING_ROLE2"].includes(defect.status) ||
      typeof defect.title !== "string" ||
      !defect.title.trim()
    )
      throw new Error("Role 2 defect state is invalid.");
  }
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
