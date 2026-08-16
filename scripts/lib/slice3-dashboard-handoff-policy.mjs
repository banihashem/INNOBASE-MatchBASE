import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./dashboard-source-policy.mjs";
import { SLICE3_BLOCKER_CODES } from "./slice3-dashboard-policy.mjs";

export const SLICE3_HANDOFF_SCHEMA =
  "matchbase.slice3-dashboard-handoff-policy/v1";
export const SLICE3_SUCCESSOR_SCHEMA =
  "matchbase.slice3-repository-release-successor/v1";
export const SLICE3_REPORT_MARKER_SCHEMA =
  "matchbase.slice3-role2-loop1-report-marker/v1";
export const HOSTED_OBSERVATION_SCHEMA =
  "matchbase.github-hosted-observation/v1";
export const SLICE3_HANDOFF_VIEWS = Object.freeze([
  "portfolio",
  "gates",
  "backlog",
  "decisions",
  "risks",
  "requirements",
  "tests",
  "defects",
  "deployments",
  "costs",
  "agents",
  "loops",
  "evidence",
]);

const SHA256 = /^[A-F0-9]{64}$/u;
const GIT_ID = /^[a-f0-9]{40}$/u;
const MANAGEMENT_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const HISTORICAL = Object.freeze([
  [
    31912344570,
    95079230396,
    "bd144bf178ac29c509379a66e72c8a771a8e44ad",
    "6bba37c7812c2bd51861ca9c90bdc39d1cb7d1c8",
    "failure",
    "UBUNTU_AGENT_POLICY_HISTORICAL_WINDOWS_SOURCE_DEREFERENCE",
  ],
  [
    31913523573,
    95081989651,
    "b992d371c467c3e185cc07bb5ac08fb8f38bf864",
    "4d29c6cf1e2b044a9b6838c8ef5bf0cbc1010019",
    "success",
    "ROLE2_REJECTED_FOUR_MAJOR_CORRECTIONS_REQUIRED",
  ],
  [
    31917590965,
    95091993135,
    "305569c390a59a14e6ca4ded4f1ac589e1c2397b",
    "c76b61c3c8756a7b84a93877ce4144c2929f8b62",
    "failure",
    "UBUNTU_SLICE3_HANDOFF_LOG_PREFIX_WINDOWS_SOURCE_DEREFERENCE",
  ],
]);
const LEDGER_KEYS = Object.freeze([
  "providerCalls",
  "billableCalls",
  "credentialWrites",
  "liveOauth",
  "gcp",
  "cloudflare",
  "dns",
  "deployment",
  "realUserData",
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
      `${label} is incomplete, duplicated, reordered, extra, or substituted.`,
    );
}

function identity(item) {
  return [
    item.runId,
    item.jobId,
    item.commit,
    item.tree,
    item.conclusion,
    item.reason,
  ].join("/");
}

function validateHosted(item, label) {
  closed(
    item,
    ["runId", "jobId", "commit", "tree", "conclusion", "reason"],
    label,
  );
  if (
    !Number.isSafeInteger(item.runId) ||
    !Number.isSafeInteger(item.jobId) ||
    !GIT_ID.test(item.commit) ||
    !GIT_ID.test(item.tree) ||
    !["success", "failure"].includes(item.conclusion) ||
    typeof item.reason !== "string" ||
    !item.reason
  )
    throw new Error(`${label} identity is invalid.`);
}

function validateRole2(value, label) {
  closed(value, ["status", "acceptanceClaimed", "defects"], label);
  if (value.status !== "FAIL" || value.acceptanceClaimed !== false)
    throw new Error(`${label} lifecycle is invalid.`);
  if (!Array.isArray(value.defects) || value.defects.length !== 4)
    throw new Error(`${label} defect set is invalid.`);
  value.defects.forEach((defect, index) =>
    closed(defect, ["id", "status"], `${label} defect ${index}`),
  );
  exactArray(
    value.defects.map(({ id, status }) => `${id}/${status}`),
    ["D001", "D002", "D003", "D004"].map(
      (id) => `${id}/CORRECTED_PENDING_ROLE2`,
    ),
    `${label} corrected defects`,
  );
}

export function validateSlice3HandoffPolicy(value) {
  closed(
    value,
    [
      "schemaVersion",
      "repository",
      "successorOverlayEnvironmentVariable",
      "successorOverlaySchemaVersion",
      "historicalHosted",
      "immutableLogPrefix",
      "blockerCodes",
      "blockedAcceptance",
      "role2",
    ],
    "Slice 3 dashboard handoff policy",
  );
  if (
    value.schemaVersion !== SLICE3_HANDOFF_SCHEMA ||
    value.repository !== "banihashem/INNOBASE-MatchBASE" ||
    value.successorOverlayEnvironmentVariable !==
      "MATCHBASE_SLICE3_REPOSITORY_RELEASE_OVERLAY" ||
    value.successorOverlaySchemaVersion !== SLICE3_SUCCESSOR_SCHEMA
  )
    throw new Error("Slice 3 dashboard handoff policy identity is stale.");
  value.historicalHosted?.forEach((item, index) =>
    validateHosted(item, `Slice 3 historical hosted entry ${index}`),
  );
  exactArray(
    value.historicalHosted?.map(identity),
    HISTORICAL.map((item) => item.join("/")),
    "Slice 3 historical hosted order",
  );
  closed(
    value.immutableLogPrefix,
    ["path", "prefixBytes", "prefixSha256"],
    "Slice 3 immutable log prefix",
  );
  if (
    value.immutableLogPrefix.path !==
      `${MANAGEMENT_ROOT}\\PRODUCT_MANAGEMENT_LOOP_LOG.md` ||
    value.immutableLogPrefix.prefixBytes !== 201811 ||
    value.immutableLogPrefix.prefixSha256 !==
      "33C3C5ABE713FC4E23DC3C0ADE079540EABCB0AE55BFEB4D0C5E501B7E90E5F2"
  )
    throw new Error("Slice 3 immutable log prefix identity is stale.");
  exactArray(
    value.blockerCodes,
    SLICE3_BLOCKER_CODES,
    "Slice 3 handoff blockers",
  );
  exactArray(
    value.blockedAcceptance,
    ["S3-AC-003", "S3-AC-019"],
    "Slice 3 blocked acceptance",
  );
  validateRole2(value.role2, "Slice 3 Role 2");
  return value;
}

export function verifySlice3LogPrefix(
  policy,
  {
    managementRoot = MANAGEMENT_ROOT,
    regularSourceResolver,
    regularSourceRoot = managementRoot,
  } = {},
) {
  validateSlice3HandoffPolicy(policy);
  return verifyImmutableLogPrefixSource(policy.immutableLogPrefix, {
    identityRoot: MANAGEMENT_ROOT,
    regularSourceResolver,
    regularSourceRoot,
  });
}

export function verifyImmutableLogPrefixSource(
  source,
  {
    identityRoot = MANAGEMENT_ROOT,
    regularSourceResolver,
    regularSourceRoot = identityRoot,
  } = {},
) {
  closed(
    source,
    ["path", "prefixBytes", "prefixSha256"],
    "Slice 3 immutable log prefix source",
  );
  if (
    !win32.isAbsolute(source.path) ||
    !win32.isAbsolute(identityRoot) ||
    !Number.isSafeInteger(source.prefixBytes) ||
    source.prefixBytes < 1 ||
    !SHA256.test(source.prefixSha256)
  )
    throw new Error("Slice 3 immutable log prefix source identity is invalid.");
  const relative = win32.relative(identityRoot, source.path);
  if (
    !relative ||
    win32.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${win32.sep}`)
  )
    throw new Error("Slice 3 loop log escapes its declared Windows root.");
  if (regularSourceResolver && typeof regularSourceResolver !== "function")
    throw new Error("Slice 3 loop log resolver must be callable.");
  if (!regularSourceRoot)
    throw new Error("Slice 3 loop log resolver requires a fixture root.");
  const root = realpathSync(regularSourceRoot);
  const path = resolve(
    regularSourceResolver
      ? regularSourceResolver(source, { identityRoot, relative })
      : resolve(regularSourceRoot, ...relative.split(/[\\/]+/u)),
  );
  if (!isPathWithinRoot(root, path))
    throw new Error("Slice 3 loop log resolver escaped its fixture root.");
  if (!existsSync(path)) throw new Error("Slice 3 loop log source is missing.");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("Slice 3 loop log must be a regular file.");
  const real = realpathSync(path);
  if (!isPathWithinRoot(root, real))
    throw new Error("Slice 3 loop log escapes the management root.");
  if (stat.size < source.prefixBytes)
    throw new Error("Slice 3 loop log is shorter than its immutable prefix.");
  const bytes = Buffer.alloc(source.prefixBytes);
  const descriptor = openSync(real, "r");
  try {
    if (readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length)
      throw new Error("Slice 3 loop log prefix could not be read exactly.");
  } finally {
    closeSync(descriptor);
  }
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (digest !== source.prefixSha256)
    throw new Error("Slice 3 loop log immutable prefix hash mismatch.");
}

function validateManagementSource(source, label) {
  closed(source, ["path", "sha256"], label);
  if (
    !win32.isAbsolute(source.path) ||
    !SHA256.test(source.sha256) ||
    !win32.basename(source.path)
  )
    throw new Error(`${label} identity is invalid.`);
  const relative = win32.relative(MANAGEMENT_ROOT, source.path);
  if (
    !relative ||
    win32.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${win32.sep}`)
  )
    throw new Error(`${label} escapes the management root.`);
}

function verifyManagementSource(
  source,
  { managementRoot = MANAGEMENT_ROOT, sourceResolver } = {},
) {
  const bytes = sourceResolver
    ? sourceResolver(source)
    : (() => {
        const root = realpathSync(managementRoot);
        const relative = win32.relative(MANAGEMENT_ROOT, source.path);
        const path = resolve(managementRoot, ...relative.split(/[\\/]+/u));
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || !stat.isFile())
          throw new Error("Slice 3 successor source must be a regular file.");
        const real = realpathSync(path);
        if (!isPathWithinRoot(root, real))
          throw new Error(
            "Slice 3 successor source escapes the management root.",
          );
        return readFileSync(real);
      })();
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
    throw new Error(
      "Slice 3 successor source resolver returned invalid bytes.",
    );
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (digest !== source.sha256)
    throw new Error("Slice 3 successor source hash mismatch.");
  return Buffer.from(bytes);
}

function validateCandidateIdentity(value, label) {
  closed(value, ["manifestSha256", "aggregateSha256", "fileCount"], label);
  if (
    !SHA256.test(value.manifestSha256) ||
    !SHA256.test(value.aggregateSha256) ||
    !Number.isSafeInteger(value.fileCount) ||
    value.fileCount < 1
  )
    throw new Error(`${label} is invalid.`);
}

function validateReportMarker(bytes, overlay) {
  const text = bytes.toString("utf8");
  const matches = [
    ...text.matchAll(
      /^<!-- MATCHBASE_SLICE3_ROLE2_LOOP1_RELEASE (\{.*\}) -->$/gmu,
    ),
  ];
  if (matches.length !== 1)
    throw new Error(
      "Slice 3 correction report marker is missing or duplicated.",
    );
  let marker;
  try {
    marker = JSON.parse(matches[0][1]);
  } catch {
    throw new Error("Slice 3 correction report marker is invalid JSON.");
  }
  closed(
    marker,
    [
      "schemaVersion",
      "repository",
      "successor",
      "candidate",
      "repositoryRelease",
      "slice3Overall",
      "liveQualification",
      "role2",
    ],
    "Slice 3 correction report marker",
  );
  validateHosted(marker.successor, "Slice 3 correction report successor");
  validateCandidateIdentity(
    marker.candidate,
    "Slice 3 correction report candidate",
  );
  validateRole2(marker.role2, "Slice 3 correction report Role 2");
  if (
    marker.schemaVersion !== SLICE3_REPORT_MARKER_SCHEMA ||
    marker.repository !== overlay.repository ||
    identity(marker.successor) !== identity(overlay.successor) ||
    JSON.stringify(marker.candidate) !== JSON.stringify(overlay.candidate) ||
    marker.repositoryRelease !== overlay.repositoryRelease ||
    marker.slice3Overall !== overlay.slice3Overall ||
    marker.liveQualification !== overlay.liveQualification ||
    JSON.stringify(marker.role2) !== JSON.stringify(overlay.role2)
  )
    throw new Error(
      "Slice 3 correction report marker is stale or substituted.",
    );
}

function validateHostedObservation(bytes, overlay) {
  let observation;
  try {
    observation = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Slice 3 hosted observation is invalid JSON.");
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
    "Slice 3 hosted observation",
  );
  const observedAtMs = Date.parse(observation.observedAt);
  if (
    observation.schemaVersion !== HOSTED_OBSERVATION_SCHEMA ||
    observation.repository !== overlay.repository ||
    observation.commit !== overlay.successor.commit ||
    observation.tree !== overlay.successor.tree ||
    observation.workflow !== "ci" ||
    observation.runId !== overlay.successor.runId ||
    observation.jobId !== overlay.successor.jobId ||
    observation.conclusion !== overlay.successor.conclusion ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs > Date.parse(overlay.observedAt) ||
    observation.runUrl !==
      `https://github.com/${overlay.repository}/actions/runs/${overlay.successor.runId}` ||
    observation.jobUrl !==
      `https://github.com/${overlay.repository}/actions/runs/${overlay.successor.runId}/job/${overlay.successor.jobId}`
  )
    throw new Error("Slice 3 hosted observation is stale or substituted.");
}

export function validateSlice3SuccessorOverlay(
  value,
  policy,
  {
    anchorOnly = false,
    repositoryRoot = process.cwd(),
    sourceResolver,
    gitTreeResolver,
  } = {},
) {
  validateSlice3HandoffPolicy(policy);
  if (anchorOnly)
    throw new Error(
      "Slice 3 successor overlay is forbidden in anchor-only CI.",
    );
  closed(
    value,
    [
      "schemaVersion",
      "observedAt",
      "repository",
      "successor",
      "predecessors",
      "candidate",
      "repositoryRelease",
      "slice3Overall",
      "liveQualification",
      "blockerCodes",
      "blockedAcceptance",
      "externalMutationLedger",
      "role2",
      "reportSource",
      "hostedSource",
    ],
    "Slice 3 successor overlay",
  );
  if (
    value.schemaVersion !== SLICE3_SUCCESSOR_SCHEMA ||
    value.repository !== policy.repository ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    value.repositoryRelease !== "PASS" ||
    value.slice3Overall !== "BLOCKED_PREREQUISITE" ||
    value.liveQualification !== "BLOCKED_PREREQUISITE"
  )
    throw new Error("Slice 3 successor overlay lifecycle is invalid.");
  validateHosted(value.successor, "Slice 3 successor");
  validateCandidateIdentity(value.candidate, "Slice 3 successor candidate");
  if (
    value.successor.conclusion !== "success" ||
    value.successor.reason !== "CORRECTED_REPOSITORY_RELEASE"
  )
    throw new Error("Slice 3 successor hosted identity is invalid.");
  value.predecessors?.forEach((item, index) =>
    validateHosted(item, `Slice 3 successor predecessor ${index}`),
  );
  exactArray(
    value.predecessors?.map(identity),
    policy.historicalHosted.map(identity),
    "Slice 3 successor predecessor history",
  );
  if (
    value.predecessors.some(
      (item) =>
        item.runId === value.successor.runId ||
        item.commit === value.successor.commit,
    )
  )
    throw new Error("Slice 3 successor duplicates a predecessor identity.");
  exactArray(
    value.blockerCodes,
    policy.blockerCodes,
    "Slice 3 successor blockers",
  );
  exactArray(
    value.blockedAcceptance,
    policy.blockedAcceptance,
    "Slice 3 successor blocked acceptance",
  );
  validateRole2(value.role2, "Slice 3 successor Role 2");
  if (
    JSON.stringify(value.role2.defects) !== JSON.stringify(policy.role2.defects)
  )
    throw new Error("Slice 3 successor Role 2 defects are stale.");
  closed(
    value.externalMutationLedger,
    LEDGER_KEYS,
    "Slice 3 external mutation ledger",
  );
  if (LEDGER_KEYS.some((key) => value.externalMutationLedger[key] !== 0))
    throw new Error("Slice 3 successor claims an external mutation.");
  validateManagementSource(
    value.reportSource,
    "Slice 3 successor report source",
  );
  validateManagementSource(
    value.hostedSource,
    "Slice 3 successor hosted source",
  );
  const reportBytes = verifyManagementSource(value.reportSource, {
    sourceResolver,
  });
  const hostedBytes = verifyManagementSource(value.hostedSource, {
    sourceResolver,
  });
  validateReportMarker(reportBytes, value);
  validateHostedObservation(hostedBytes, value);
  const resolved = gitTreeResolver
    ? gitTreeResolver(value.successor)
    : spawnSync("git", ["show", "-s", "--format=%T", value.successor.commit], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
  const tree =
    typeof resolved === "string"
      ? resolved.trim()
      : resolved?.status === 0
        ? resolved.stdout.trim()
        : "";
  if (tree !== value.successor.tree)
    throw new Error("Slice 3 successor commit/tree identity is stale.");
  return value;
}

export function slice3HandoffSourceRef(
  path,
  bytes,
  observedAt,
  kind = "policy",
) {
  return {
    sourceId: `matchbase://slice3/dashboard-handoff-${kind}`,
    path,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    observedAt,
  };
}

export function removeMutableSlice3LoopLogRecords(views, policy) {
  const target = win32.normalize(policy.immutableLogPrefix.path).toLowerCase();
  for (const view of Object.values(views))
    view.records = view.records.filter(
      (record) =>
        !record.sourceRefs?.some(
          (source) =>
            typeof source.path === "string" &&
            win32.normalize(source.path).toLowerCase() === target,
        ),
    );
  return views;
}

export function applySlice3HandoffProjection(
  views,
  policy,
  policySourceRef,
  { successor, successorSourceRef } = {},
) {
  validateSlice3HandoffPolicy(policy);
  const releaseClosed = Boolean(successor);
  const refs = releaseClosed
    ? [policySourceRef, successorSourceRef]
    : [policySourceRef];
  if (refs.some((ref) => !ref))
    throw new Error("Slice 3 handoff source reference is missing.");
  for (const viewName of SLICE3_HANDOFF_VIEWS) {
    const record = {
      id: `S3-HANDOFF-${viewName.toUpperCase()}`,
      title: "Slice 3 repository-release handoff",
      summary: releaseClosed
        ? "Repository release and hosted fixture CI pass; Slice 3 and live qualification remain blocked prerequisites; Role 2 remains failed pending re-audit of the four corrected defects."
        : "Corrected repository successor closure remains pending; Role 2 remains failed pending re-audit of the four corrected defects, and blocked prerequisites are preserved.",
      status: releaseClosed ? "PASS" : "ACTIVE",
      facts: {
        repositoryRelease: releaseClosed ? "PASS" : "PENDING_SUCCESSOR",
        slice3Overall: "BLOCKED_PREREQUISITE",
        liveQualification: "BLOCKED_PREREQUISITE",
        role2Status: "FAIL",
        role2Defects: structuredClone(policy.role2.defects),
        acceptanceClaimed: false,
        providerCalls: 0,
        externalMutations: 0,
        blockerCodes: [...policy.blockerCodes],
        blockedAcceptance: [...policy.blockedAcceptance],
        historicalHosted: policy.historicalHosted.map(identity),
        successor: releaseClosed ? identity(successor.successor) : "PENDING",
        logPrefixBytes: policy.immutableLogPrefix.prefixBytes,
        logPrefixSha256: policy.immutableLogPrefix.prefixSha256,
        logSourceMode: "IMMUTABLE_PREFIX_ONLY",
        evidenceIntegrity: "VERIFIED",
      },
      sourceRefs: structuredClone(refs),
    };
    const index = views[viewName].records.findIndex(
      ({ id }) => id === record.id,
    );
    if (index >= 0) views[viewName].records[index] = record;
    else views[viewName].records.push(record);
  }
  const g5 = views.gates.records.find(({ id }) => id === "S3-G5");
  if (g5) {
    g5.status = releaseClosed ? "PASS" : "ACTIVE";
    g5.summary = releaseClosed
      ? "The exact corrected successor commit and hosted fixture-only CI are source-verified and pass."
      : "The corrected successor commit and hosted fixture-only CI remain pending.";
    g5.facts = {
      ...g5.facts,
      lifecycleStatus: releaseClosed ? "PASS" : "PENDING",
      evidenceIntegrity: "VERIFIED",
    };
    g5.sourceRefs = structuredClone(refs);
  }
  return views;
}

export function validateSlice3HandoffDashboard(
  views,
  policy,
  policySourceRef,
  { successor, successorSourceRef } = {},
) {
  validateSlice3HandoffPolicy(policy);
  const expectedRefs = successor
    ? [policySourceRef, successorSourceRef]
    : [policySourceRef];
  const expectedFacts = successor ? identity(successor.successor) : "PENDING";
  for (const viewName of SLICE3_HANDOFF_VIEWS) {
    const id = `S3-HANDOFF-${viewName.toUpperCase()}`;
    const records = views[viewName].records.filter(
      (record) => record.id === id,
    );
    if (records.length !== 1)
      throw new Error(`Slice 3 ${viewName} handoff is omitted or duplicated.`);
    const record = records[0];
    exactArray(
      record.sourceRefs?.map((ref) => JSON.stringify(ref)),
      expectedRefs.map((ref) => JSON.stringify(ref)),
      `Slice 3 ${viewName} handoff sources`,
    );
    if (
      record.status !== (successor ? "PASS" : "ACTIVE") ||
      record.facts?.repositoryRelease !==
        (successor ? "PASS" : "PENDING_SUCCESSOR") ||
      record.facts?.successor !== expectedFacts ||
      record.facts?.slice3Overall !== "BLOCKED_PREREQUISITE" ||
      record.facts?.liveQualification !== "BLOCKED_PREREQUISITE" ||
      record.facts?.role2Status !== "FAIL" ||
      JSON.stringify(record.facts?.role2Defects) !==
        JSON.stringify(policy.role2.defects) ||
      record.facts?.acceptanceClaimed !== false ||
      record.facts?.providerCalls !== 0 ||
      record.facts?.externalMutations !== 0 ||
      record.facts?.evidenceIntegrity !== "VERIFIED" ||
      record.facts?.logSourceMode !== "IMMUTABLE_PREFIX_ONLY" ||
      record.facts?.logPrefixBytes !== policy.immutableLogPrefix.prefixBytes ||
      record.facts?.logPrefixSha256 !== policy.immutableLogPrefix.prefixSha256
    )
      throw new Error(`Slice 3 ${viewName} handoff lifecycle is stale.`);
    exactArray(
      record.facts.blockerCodes,
      policy.blockerCodes,
      `Slice 3 ${viewName} blockers`,
    );
    exactArray(
      record.facts.blockedAcceptance,
      policy.blockedAcceptance,
      `Slice 3 ${viewName} blocked acceptance`,
    );
    exactArray(
      record.facts.historicalHosted,
      policy.historicalHosted.map(identity),
      `Slice 3 ${viewName} hosted history`,
    );
  }
  const records = Object.values(views).flatMap(({ records }) => records);
  const g5 = views.gates.records.filter(({ id }) => id === "S3-G5");
  const mutableLogIdentity = win32
    .normalize(policy.immutableLogPrefix.path)
    .toLowerCase();
  if (
    g5.length !== 1 ||
    g5[0].status !== (successor ? "PASS" : "ACTIVE") ||
    g5[0].facts?.lifecycleStatus !== (successor ? "PASS" : "PENDING") ||
    g5[0].facts?.evidenceIntegrity !== "VERIFIED"
  )
    throw new Error("Slice 3 G5 handoff lifecycle is stale.");
  exactArray(
    g5[0].sourceRefs?.map((ref) => JSON.stringify(ref)),
    expectedRefs.map((ref) => JSON.stringify(ref)),
    "Slice 3 G5 handoff sources",
  );
  const mutableLogRecords = records.filter((record) =>
    record.sourceRefs?.some(
      ({ path }) =>
        typeof path === "string" &&
        win32.normalize(path).toLowerCase() === mutableLogIdentity,
    ),
  );
  if (mutableLogRecords.length > 0)
    throw new Error(
      `Slice 3 dashboard falsely source-binds the mutable full loop log: ${mutableLogRecords
        .map(({ id }) => id)
        .join(",")}`,
    );
}
