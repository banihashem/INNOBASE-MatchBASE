import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./dashboard-source-policy.mjs";

export const SLICE2_EXTERNAL_CLOSURE_SCHEMA =
  "matchbase.slice2-external-closure/v1";
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
const EXPECTED_REPOSITORY = "banihashem/INNOBASE-MatchBASE";
const SHA256 = /^[A-F0-9]{64}$/u;
const GIT_ID = /^[a-f0-9]{40}$/u;
const ANCHOR = Object.freeze({
  commit: "58ed065f8a8e2ac5c60812b13cd4607c1a8d9cb6",
  tree: "358606112d663ac15e2e065557cbbed6f00cae86",
  runId: 31867699009,
  jobId: 94971277544,
  sourceSha256:
    "63A88216B18FF696DCF7084C9D86EABA53523CFAD93400639AF222BEC16A4725",
  auditSourceSha256:
    "152B60D766D6796BD265CA8EE82D3B75203372BA2191ECAF37EC426BCE05FC03",
});

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
    throw new Error(`${label} is incomplete, duplicated, or reordered.`);
}

function sourceText(source, options, label) {
  closed(source, ["kind", "path", "sha256", "method"], label);
  if (
    !["management_artifact", "repository_artifact"].includes(source.kind) ||
    !win32.isAbsolute(source.path) ||
    !SHA256.test(source.sha256) ||
    typeof source.method !== "string" ||
    !source.method.trim()
  )
    throw new Error(`${label} is invalid.`);
  if (options.anchorOnly) return null;
  const configuredRoot =
    source.kind === "management_artifact"
      ? options.managementRoot
      : options.repositoryRoot;
  const root = realpathSync(configuredRoot);
  const path = resolve(source.path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${label} must be a regular file.`);
  const real = realpathSync(path);
  if (!isPathWithinRoot(root, real))
    throw new Error(`${label} escapes its configured root.`);
  const bytes = readFileSync(real);
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (digest !== source.sha256) throw new Error(`${label} hash mismatch.`);
  return bytes.toString("utf8");
}

function validatePredecessors(predecessors, current) {
  if (!Array.isArray(predecessors) || predecessors.length < 2)
    throw new Error("Slice 2 predecessor history is incomplete.");
  let priorRunId = 0;
  const identities = new Set();
  for (const predecessor of predecessors) {
    closed(
      predecessor,
      ["runId", "jobId", "commit", "tree", "conclusion", "reason"],
      "Slice 2 predecessor",
    );
    if (
      !Number.isSafeInteger(predecessor.runId) ||
      !Number.isSafeInteger(predecessor.jobId) ||
      predecessor.runId <= priorRunId ||
      !GIT_ID.test(predecessor.commit) ||
      !GIT_ID.test(predecessor.tree) ||
      !["failure", "success"].includes(predecessor.conclusion) ||
      !/^[A-Z0-9_]+$/u.test(predecessor.reason) ||
      predecessor.runId === current.runId ||
      predecessor.jobId === current.jobId ||
      predecessor.commit === current.commit
    )
      throw new Error("Slice 2 predecessor identity is invalid.");
    priorRunId = predecessor.runId;
    const identity = `${predecessor.runId}/${predecessor.jobId}/${predecessor.commit}`;
    if (identities.has(identity))
      throw new Error("Slice 2 predecessor identity is duplicated.");
    identities.add(identity);
  }
}

function validateCandidate(candidate) {
  closed(
    candidate,
    ["manifestPath", "manifestSha256", "aggregateSha256", "fileCount"],
    "Slice 2 closure candidate",
  );
  if (
    candidate.manifestPath !== "evidence/slice2/candidate-manifest.json" ||
    !SHA256.test(candidate.manifestSha256) ||
    !SHA256.test(candidate.aggregateSha256) ||
    !Number.isSafeInteger(candidate.fileCount) ||
    candidate.fileCount <= 0
  )
    throw new Error("Slice 2 closure candidate identity is invalid.");
}

function validateRole2(role2, ready) {
  closed(
    role2,
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
    !win32.isAbsolute(role2.auditPath) ||
    !SHA256.test(role2.auditSha256) ||
    role2.disposition !== "PENDING_ROLE2_CORRECTION_REAUDIT" ||
    role2.critical !== 0 ||
    role2.minor !== 0 ||
    !Array.isArray(role2.defects) ||
    role2.defects.length !== 3
  )
    throw new Error("Slice 2 Role 2 state is invalid.");
  const expectedIds = ["S2-R2-D001", "S2-R2-D002", "S2-R2-D003"];
  exactArray(
    role2.defects.map(({ id }) => id),
    expectedIds,
    "Slice 2 Role 2 defects",
  );
  for (const defect of role2.defects) {
    closed(defect, ["id", "severity", "status", "title"], "Role 2 defect");
    if (
      defect.severity !== "major" ||
      defect.status !== (ready ? "CORRECTED_PENDING_ROLE2" : "OPEN") ||
      typeof defect.title !== "string" ||
      !defect.title.trim()
    )
      throw new Error("Slice 2 Role 2 defect lifecycle is invalid.");
  }
  if (
    role2.status !== (ready ? "PENDING" : "FAIL") ||
    role2.major !== (ready ? 0 : 3)
  )
    throw new Error("Slice 2 Role 2 disposition is inconsistent.");
}

function validateLifecycle(value) {
  const ready = value.role3Disposition === "READY_FOR_ROLE2";
  if (!ready && value.role3Disposition !== "CORRECTION_IN_PROGRESS")
    throw new Error("Slice 2 Role 3 disposition is invalid.");
  validateRole2(value.role2, ready);
  closed(value.gates, ["S2-G2", "S2-G9"], "Slice 2 closure gates");
  closed(
    value.acceptance,
    ["S2-AC-016", "S2-AC-023", "S2-AC-030", "S2-AC-032", "S2-AC-033"],
    "Slice 2 closure acceptance",
  );
  for (const gate of ["S2-G2", "S2-G9"])
    if (value.gates[gate] !== (ready ? "PASS" : "REOPENED"))
      throw new Error("Slice 2 closure gate lifecycle is stale.");
  for (const id of ["S2-AC-016", "S2-AC-023", "S2-AC-030", "S2-AC-032"])
    if (value.acceptance[id] !== (ready ? "PASS" : "FAIL"))
      throw new Error("Slice 2 acceptance lifecycle is stale.");
  if (value.acceptance["S2-AC-033"] !== (ready ? "PASS" : "REOPENED"))
    throw new Error("Slice 2 hosted acceptance lifecycle is stale.");
  return ready;
}

function validateAuditLedger(text, value) {
  if (typeof text !== "string")
    throw new Error("Slice 2 audit ledger is unavailable.");
  let evidence;
  try {
    evidence = JSON.parse(text);
  } catch {
    throw new Error("Slice 2 audit ledger is invalid JSON.");
  }
  const audits = evidence.independentAudits;
  exactArray(
    audits?.map(({ id }) => id),
    SLICE2_AUDIT_IDS,
    "Slice 2 audit ledger",
  );
  for (const audit of audits) {
    if (
      audit.status !== "PASS" ||
      audit.critical !== 0 ||
      audit.major !== 0 ||
      audit.minor !== 0 ||
      audit.candidateManifestSha256 !== value.candidate.manifestSha256 ||
      audit.candidateAggregateSha256 !== value.candidate.aggregateSha256
    )
      throw new Error("Slice 2 audit ledger is stale or differently bound.");
  }
}

function bindMarker(text, value) {
  if (value.source.sha256 === ANCHOR.sourceSha256) {
    if (
      value.commit !== ANCHOR.commit ||
      value.tree !== ANCHOR.tree ||
      value.runId !== ANCHOR.runId ||
      value.jobId !== ANCHOR.jobId
    )
      throw new Error(
        "Historical Slice 2 closure source attests another identity.",
      );
    return;
  }
  if (typeof text !== "string")
    throw new Error("Slice 2 successor closure source is unavailable.");
  const prefix = "MATCHBASE_SLICE2_EXTERNAL_CLOSURE_V1: ";
  const line = text.split(/\r?\n/u).find((item) => item.startsWith(prefix));
  if (!line) throw new Error("Slice 2 successor closure marker is missing.");
  let marker;
  try {
    marker = JSON.parse(line.slice(prefix.length));
  } catch {
    throw new Error("Slice 2 successor closure marker is invalid JSON.");
  }
  const expected = structuredClone(value);
  delete expected.source;
  delete expected.auditSource;
  if (JSON.stringify(marker) !== JSON.stringify(expected))
    throw new Error(
      "Slice 2 successor closure marker does not match overlay facts.",
    );
}

export function validateSlice2ExternalClosure(
  value,
  {
    anchorOnly = false,
    managementRoot = SLICE2_MANAGEMENT_ROOT,
    repositoryRoot = SLICE2_REPOSITORY_ROOT,
  } = {},
) {
  closed(
    value,
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
    value.repository !== EXPECTED_REPOSITORY ||
    !GIT_ID.test(value.commit) ||
    !GIT_ID.test(value.tree) ||
    value.workflow !== "ci" ||
    !Number.isSafeInteger(value.runId) ||
    !Number.isSafeInteger(value.jobId) ||
    value.runId <= 0 ||
    value.jobId <= 0 ||
    value.conclusion !== "success" ||
    typeof value.observedAt !== "string" ||
    Number.isNaN(Date.parse(value.observedAt))
  )
    throw new Error("Slice 2 external closure identity is invalid.");
  const anchoredSource = value.source?.sha256 === ANCHOR.sourceSha256;
  const anchoredAuditSource =
    value.auditSource?.sha256 === ANCHOR.auditSourceSha256;
  if (
    value.source?.kind !== "management_artifact" ||
    win32.basename(value.source.path) !==
      (anchoredSource
        ? "ROLE3_IMPLEMENTATION_VALIDATION_PO_001_SLICE_2.md"
        : "ROLE3_CORRECTION_VALIDATION_PO_001_SLICE_2_ROLE2_LOOP_1.md") ||
    value.source.method !==
      (anchoredSource
        ? "Authenticated hosted Slice 2 closure recorded by Role 3"
        : "Authenticated hosted Slice 2 correction closure recorded by Role 3") ||
    value.auditSource?.kind !== "repository_artifact" ||
    win32.basename(value.auditSource.path) !==
      (anchoredAuditSource
        ? "slice2-rejected-candidate-attestation-v1.json"
        : "local-validation.json") ||
    value.auditSource.method !==
      (anchoredAuditSource
        ? "Immutable rejected-candidate discipline audit attestation"
        : "Exact frozen-candidate discipline audit ledger") ||
    win32.basename(value.role2?.auditPath ?? "") !==
      "ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_2.md"
  )
    throw new Error("Slice 2 closure source identity is invalid.");
  if (
    anchorOnly &&
    (value.commit !== ANCHOR.commit ||
      value.tree !== ANCHOR.tree ||
      value.runId !== ANCHOR.runId ||
      value.jobId !== ANCHOR.jobId ||
      value.source?.sha256 !== ANCHOR.sourceSha256 ||
      value.auditSource?.sha256 !== ANCHOR.auditSourceSha256)
  )
    throw new Error("Slice 2 hosted closure does not match its CI anchor.");
  validatePredecessors(value.predecessors, value);
  validateCandidate(value.candidate);
  exactArray(value.audits, SLICE2_AUDIT_IDS, "Slice 2 audit identities");
  validateLifecycle(value);
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
  const options = { anchorOnly, managementRoot, repositoryRoot };
  const closureText = sourceText(
    value.source,
    options,
    "Slice 2 closure source",
  );
  const auditText = sourceText(
    value.auditSource,
    options,
    "Slice 2 audit source",
  );
  sourceText(
    {
      kind: "management_artifact",
      path: value.role2.auditPath,
      sha256: value.role2.auditSha256,
      method: "Independent Slice 2 Role 2 audit",
    },
    options,
    "Slice 2 Role 2 source",
  );
  bindMarker(closureText, value);
  if (!anchorOnly) validateAuditLedger(auditText, value);
  return value;
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
    sourceId: "matchbase://slice2-external-closure/audits",
    path: value.auditSource.path,
    sha256: value.auditSource.sha256,
    observedAt: value.observedAt,
  };
}

export function slice2Role2SourceRef(value) {
  return {
    sourceId: "matchbase://slice2-external-closure/role2-audit",
    path: value.role2.auditPath,
    sha256: value.role2.auditSha256,
    observedAt: value.observedAt,
  };
}
