export const PREDECESSOR_FAILURE_SCHEMA = "matchbase.predecessor-failures/v1";

const commitPattern = /^[a-f0-9]{40}$/u;
const reasonPattern = /^[A-Z][A-Z0-9_]{2,79}$/u;

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer.`);
}

export function predecessorFailureKey(value) {
  return `${value.runId}:${value.jobId}:${value.commit}:${value.conclusion}`;
}

export function validatePredecessorFailures(
  failures,
  { currentRunId, currentJobId, currentCommit } = {},
) {
  if (!Array.isArray(failures) || failures.length === 0)
    throw new Error("Predecessor failure collection must be non-empty.");
  const runIds = new Set();
  const jobIds = new Set();
  const pairs = new Set();
  let priorRunId = 0;
  for (const failure of failures) {
    if (!hasExactKeys(failure, ["runId", "jobId", "commit", "conclusion"]))
      throw new Error("Predecessor failure schema is not closed.");
    positiveInteger(failure.runId, "Predecessor runId");
    positiveInteger(failure.jobId, "Predecessor jobId");
    if (!commitPattern.test(failure.commit))
      throw new Error("Predecessor commit must be lower-case 40-hex.");
    if (failure.conclusion !== "failure")
      throw new Error("Predecessor conclusion must be failure.");
    if (failure.runId <= priorRunId)
      throw new Error(
        "Predecessor failures must be in strictly ascending runId order.",
      );
    priorRunId = failure.runId;
    const pair = `${failure.runId}:${failure.jobId}`;
    if (
      runIds.has(failure.runId) ||
      jobIds.has(failure.jobId) ||
      pairs.has(pair)
    )
      throw new Error("Predecessor failure identities must be unique.");
    if (
      failure.runId === currentRunId ||
      failure.jobId === currentJobId ||
      failure.commit === currentCommit
    )
      throw new Error("Predecessor failure reuses the successful identity.");
    runIds.add(failure.runId);
    jobIds.add(failure.jobId);
    pairs.add(pair);
  }
  return failures;
}

export function validatePredecessorReasons(reasons, failures) {
  if (!Array.isArray(reasons) || reasons.length !== failures.length)
    throw new Error("Every predecessor failure must have one reason.");
  for (let index = 0; index < reasons.length; index += 1) {
    const reason = reasons[index];
    if (!hasExactKeys(reason, ["runId", "reasonCode"]))
      throw new Error("Predecessor reason schema is not closed.");
    positiveInteger(reason.runId, "Predecessor reason runId");
    if (
      reason.runId !== failures[index].runId ||
      !reasonPattern.test(reason.reasonCode)
    )
      throw new Error(
        "Predecessor reasons must match failures in canonical order.",
      );
  }
  return reasons;
}

export function validatePredecessorAttestation(
  value,
  { currentRunId, currentJobId, currentCommit } = {},
) {
  if (!hasExactKeys(value, ["schemaVersion", "failures", "reasons"]))
    throw new Error("Predecessor attestation schema is not closed.");
  if (value.schemaVersion !== PREDECESSOR_FAILURE_SCHEMA)
    throw new Error("Predecessor attestation schema is unsupported.");
  validatePredecessorFailures(value.failures, {
    currentRunId,
    currentJobId,
    currentCommit,
  });
  validatePredecessorReasons(value.reasons, value.failures);
  return value;
}

export function assertExactPredecessorHistory(
  actualFailures,
  actualReasons,
  expectedFailures,
  expectedReasons,
) {
  const canonicalFailures = (failures) =>
    failures.map(({ runId, jobId, commit, conclusion }) => ({
      runId,
      jobId,
      commit,
      conclusion,
    }));
  const canonicalReasons = (reasons) =>
    reasons.map(({ runId, reasonCode }) => ({ runId, reasonCode }));
  if (
    JSON.stringify(canonicalFailures(actualFailures)) !==
      JSON.stringify(canonicalFailures(expectedFailures)) ||
    JSON.stringify(canonicalReasons(actualReasons)) !==
      JSON.stringify(canonicalReasons(expectedReasons))
  )
    throw new Error(
      "Predecessor failure history does not match its attestation.",
    );
}
