import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const LOCAL_SCOPE = Object.freeze([
  ["BUILD-SLICE-1-LOCAL", "SLICE-1"],
  ["BUILD-SLICE-2-LOCAL", "SLICE-2"],
  ["ARTIFACT-SLICE-1-LOCAL-VALIDATION", "SLICE-1"],
  ["ARTIFACT-SLICE-2-LOCAL-VALIDATION", "SLICE-2"],
  ["PROV-SLICE-1-LOCAL", "SLICE-1"],
  ["PROV-SLICE-2-LOCAL", "SLICE-2"],
]);

const LOCAL_SCOPE_BY_ID = new Map(LOCAL_SCOPE);
const LOCAL_SCOPE_IDS = LOCAL_SCOPE.map(([id]) => id);
const SHA256 = /^[A-F0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new Error(`${label} contains an omitted, extra, or unknown field.`);
}

function exactSource(actual, expected, label) {
  exactKeys(
    actual,
    ["sourceId", "path", "sha256", "observedAt"],
    `${label} source`,
  );
  for (const key of ["sourceId", "path", "sha256", "observedAt"])
    if (actual[key] !== expected[key])
      throw new Error(`${label} source identity was substituted.`);
}

function closureRole2Status(slice, closure) {
  return slice === "SLICE-1" ? closure.role2Status : closure.role2.status;
}

function historicalSummary(slice, candidate, closure) {
  return `The local uncommitted ${slice.replace("SLICE-", "Slice ")} candidate based on ${candidate.baseCommit} was historical evidence and was superseded by hosted success ${closure.commit}, run ${closure.runId}, job ${closure.jobId}.`;
}

function provenanceBySlice(artifactIndex) {
  const provenance = artifactIndex.provenance ?? [];
  const ids = provenance.map(({ id }) => id);
  if (
    JSON.stringify(ids) !==
    JSON.stringify([
      "PROV-SLICE-0-001",
      "PROV-SLICE-1-LOCAL",
      "PROV-SLICE-2-LOCAL",
    ])
  )
    throw new Error(
      "Dashboard provenance order contains an omission, duplicate, substitution, or extra record.",
    );

  const artifacts = new Map(
    (artifactIndex.artifacts ?? []).map((item) => [item.id, item]),
  );
  return new Map(
    ["SLICE-1", "SLICE-2"].map((slice) => {
      const item = provenance.find(({ id }) => id === `PROV-${slice}-LOCAL`);
      exactKeys(
        item,
        ["id", "status", "historicalCandidate"],
        `${item?.id ?? slice} provenance`,
      );
      if (item.status !== "SUPERSEDED")
        throw new Error(`${item.id} must be SUPERSEDED.`);
      exactKeys(
        item.historicalCandidate,
        slice === "SLICE-2"
          ? [
              "kind",
              "baseCommit",
              "hostedCandidateCommit",
              "evidencePath",
              "evidenceGitObject",
              "evidenceSha256",
            ]
          : ["kind", "baseCommit", "evidencePath", "evidenceSha256"],
        `${item.id} historical candidate`,
      );
      const candidate = item.historicalCandidate;
      if (
        candidate.kind !== "LOCAL_UNCOMMITTED" ||
        !COMMIT.test(candidate.baseCommit) ||
        !SHA256.test(candidate.evidenceSha256)
      )
        throw new Error(`${item.id} historical candidate identity is invalid.`);
      if (
        slice === "SLICE-2" &&
        (!COMMIT.test(candidate.hostedCandidateCommit ?? "") ||
          !COMMIT.test(candidate.evidenceGitObject ?? ""))
      )
        throw new Error(`${item.id} immutable Git identity is invalid.`);
      const artifact = artifacts.get(`ARTIFACT-${slice}-LOCAL-VALIDATION`);
      if (artifact?.path !== candidate.evidencePath)
        throw new Error(`${item.id} historical evidence identity is stale.`);
      if (slice === "SLICE-1" && artifact.sha256 !== candidate.evidenceSha256)
        throw new Error(`${item.id} historical evidence identity is stale.`);
      return [slice, candidate];
    }),
  );
}

export function validateHistoricalProvenanceIndex(artifactIndex) {
  const candidates = provenanceBySlice(artifactIndex);
  for (const [id, slice] of LOCAL_SCOPE) {
    const collection = id.startsWith("BUILD-")
      ? artifactIndex.builds
      : id.startsWith("ARTIFACT-")
        ? artifactIndex.artifacts
        : artifactIndex.provenance;
    const matches = (collection ?? []).filter((item) => item.id === id);
    if (matches.length !== 1) throw new Error(`${id} must occur exactly once.`);
    if (matches[0].status !== "SUPERSEDED")
      throw new Error(`${id} must be SUPERSEDED after hosted closure.`);
    if (!candidates.has(slice))
      throw new Error(`${id} lacks its historical candidate identity.`);
  }
  return candidates;
}

function git(repoRoot, args, encoding) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`Historical Git object lookup failed: ${args[0]}.`);
  return result.stdout;
}

export function validateSlice2HistoricalGitObject(
  artifactIndex,
  closure,
  { repoRoot = process.cwd() } = {},
) {
  const candidate =
    validateHistoricalProvenanceIndex(artifactIndex).get("SLICE-2");
  if (
    candidate.hostedCandidateCommit !== closure.commit ||
    closure.conclusion !== "success"
  )
    throw new Error(
      "Slice 2 historical candidate is not the exact superseding hosted commit.",
    );
  const resolvedObject = String(
    git(
      repoRoot,
      [
        "rev-parse",
        `${candidate.hostedCandidateCommit}:${candidate.evidencePath}`,
      ],
      "utf8",
    ),
  ).trim();
  if (resolvedObject !== candidate.evidenceGitObject)
    throw new Error("Slice 2 historical Git object was substituted.");
  const bytes = git(
    repoRoot,
    ["cat-file", "blob", candidate.evidenceGitObject],
    undefined,
  );
  if (
    createHash("sha256").update(bytes).digest("hex").toUpperCase() !==
    candidate.evidenceSha256
  )
    throw new Error(
      "Slice 2 historical Git-object bytes do not match SHA-256.",
    );
  const evidenceObservedAt = Date.parse(
    JSON.parse(bytes.toString("utf8")).observedAt,
  );
  const commitObservedAt = Date.parse(
    String(
      git(
        repoRoot,
        ["show", "-s", "--format=%cI", candidate.hostedCandidateCommit],
        "utf8",
      ),
    ).trim(),
  );
  const closureObservedAt = Date.parse(closure.observedAt);
  if (
    [evidenceObservedAt, commitObservedAt, closureObservedAt].some(
      Number.isNaN,
    ) ||
    evidenceObservedAt > commitObservedAt ||
    commitObservedAt > closureObservedAt
  )
    throw new Error(
      "Slice 2 historical provenance violates temporal causality.",
    );
  return candidate;
}

export function projectHistoricalLocalRecord(
  item,
  artifactIndex,
  {
    artifactIndexSourceRef,
    candidateSourceRefs,
    slice1Closure,
    slice1ClosureSourceRef,
    slice2Closure,
    slice2ClosureSourceRef,
  },
) {
  const slice = LOCAL_SCOPE_BY_ID.get(item.id);
  if (!slice) return null;
  const candidate = validateHistoricalProvenanceIndex(artifactIndex).get(slice);
  const closure = slice === "SLICE-1" ? slice1Closure : slice2Closure;
  const closureSourceRef =
    slice === "SLICE-1" ? slice1ClosureSourceRef : slice2ClosureSourceRef;
  const candidateSourceRef = candidateSourceRefs[slice];
  if (
    !closure ||
    closure.conclusion !== "success" ||
    !COMMIT.test(closure.commit) ||
    !COMMIT.test(closure.tree) ||
    !Number.isSafeInteger(closure.runId) ||
    !Number.isSafeInteger(closure.jobId)
  )
    throw new Error(`${item.id} lacks an exact hosted superseding closure.`);
  const candidatePath = String(candidateSourceRef?.path ?? "")
    .replaceAll("/", "\\")
    .toLowerCase();
  const expectedPath = candidate.evidencePath
    .replaceAll("/", "\\")
    .toLowerCase();
  if (
    candidatePath !== expectedPath &&
    !candidatePath.endsWith(`\\${expectedPath}`)
  )
    throw new Error(`${item.id} lacks exact historical evidence bytes.`);
  const currentArtifact = artifactIndex.artifacts.find(
    ({ id }) => id === `ARTIFACT-${slice}-LOCAL-VALIDATION`,
  );
  if (candidateSourceRef?.sha256 !== currentArtifact.sha256)
    throw new Error(`${item.id} current evidence path observation is stale.`);

  return {
    id: item.id,
    title: item.id,
    summary: historicalSummary(slice, candidate, closure),
    status: "HISTORICAL",
    facts: {
      lifecycleStatus: "SUPERSEDED",
      historyDisposition: "HISTORICAL",
      slice,
      historicalCandidateKind: candidate.kind,
      historicalBaseCommit: candidate.baseCommit,
      ...(slice === "SLICE-2"
        ? {
            historicalHostedCandidateCommit: candidate.hostedCandidateCommit,
            historicalEvidenceGitObject: candidate.evidenceGitObject,
          }
        : {}),
      historicalEvidencePath: candidate.evidencePath,
      historicalEvidenceSha256: candidate.evidenceSha256,
      historicalEvidenceMethod:
        slice === "SLICE-2"
          ? "Git object bytes at exact hosted candidate commit and path; SHA-256 verified"
          : "SHA-256 indexed local validation evidence",
      currentEvidencePath: candidate.evidencePath,
      currentEvidenceObservedSha256: currentArtifact.sha256,
      currentEvidencePurpose: "PATH_EXISTENCE_AND_CONTAINMENT_ONLY",
      supersedingRepository: closure.repository,
      supersedingCommit: closure.commit,
      supersedingTree: closure.tree,
      supersedingRunId: closure.runId,
      supersedingJobId: closure.jobId,
      supersedingConclusion: closure.conclusion,
      supersedingSourceMethod: closure.source.method,
      supersedingRole2Status: closureRole2Status(slice, closure),
      currentGateCounted: false,
      currentAcceptanceCounted: false,
      evidenceIntegrity: "VERIFIED",
    },
    sourceRefs: [
      { ...artifactIndexSourceRef },
      { ...candidateSourceRef },
      { ...closureSourceRef },
    ],
  };
}

export function validateDashboardHistoricalProvenance(
  views,
  artifactIndex,
  options,
) {
  const candidates = validateHistoricalProvenanceIndex(artifactIndex);
  const evidence = views.evidence?.records ?? [];
  const scoped = evidence.filter((record) => LOCAL_SCOPE_BY_ID.has(record.id));
  if (
    JSON.stringify(scoped.map(({ id }) => id)) !==
    JSON.stringify(LOCAL_SCOPE_IDS)
  )
    throw new Error(
      "Historical dashboard records contain an omission, duplicate, reorder, substitution, or extra record.",
    );
  for (const record of scoped) {
    const slice = LOCAL_SCOPE_BY_ID.get(record.id);
    const expected = projectHistoricalLocalRecord(
      { id: record.id },
      artifactIndex,
      options,
    );
    exactKeys(
      record,
      ["id", "title", "summary", "status", "facts", "sourceRefs"],
      record.id,
    );
    exactKeys(record.facts, Object.keys(expected.facts), `${record.id} facts`);
    if (
      record.status !== "HISTORICAL" ||
      record.facts.lifecycleStatus !== "SUPERSEDED" ||
      record.facts.historyDisposition !== "HISTORICAL" ||
      record.facts.currentGateCounted !== false ||
      record.facts.currentAcceptanceCounted !== false ||
      record.facts.evidenceIntegrity !== "VERIFIED" ||
      record.summary !== expected.summary ||
      JSON.stringify(record.facts) !== JSON.stringify(expected.facts)
    )
      throw new Error(`${record.id} historical lifecycle is contradictory.`);
    if (record.sourceRefs.length !== 3)
      throw new Error(`${record.id} source set is incomplete or duplicated.`);
    record.sourceRefs.forEach((source, index) =>
      exactSource(source, expected.sourceRefs[index], record.id),
    );
    if (!candidates.has(slice))
      throw new Error(`${record.id} historical candidate was substituted.`);
  }

  for (const [view, value] of Object.entries(views)) {
    if (view === "evidence") continue;
    if (
      (value.records ?? []).some((record) => LOCAL_SCOPE_BY_ID.has(record.id))
    )
      throw new Error("Historical provenance was counted as a current record.");
  }
}

export const HISTORICAL_LOCAL_RECORD_IDS = Object.freeze(LOCAL_SCOPE_IDS);
