const SHA256 = /^[A-F0-9]{64}$/u;
export const SLICE3_WRAPPER_COMMAND = "pnpm test:ci && pnpm dependency:audit";

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

export function validateSlice3WrapperResult(wrapper, evidence, wrapperSha256) {
  closed(
    wrapper,
    [
      "schemaVersion",
      "observedAt",
      "command",
      "durationMs",
      "result",
      "exitCode",
      "candidate",
      "providerCalls",
      "externalMutations",
    ],
    "Slice 3 wrapper result",
  );
  closed(
    wrapper.candidate,
    ["manifestSha256", "aggregateSha256", "fileCount"],
    "Slice 3 wrapper candidate",
  );
  closed(
    evidence?.localGate?.fullWrapper,
    ["command", "durationMs", "result", "observedAt", "sourceRef"],
    "Slice 3 wrapper evidence",
  );
  closed(
    evidence.localGate.fullWrapper.sourceRef,
    ["path", "sha256"],
    "Slice 3 wrapper source",
  );
  const expected = {
    command: SLICE3_WRAPPER_COMMAND,
    durationMs: wrapper.durationMs,
    result: wrapper.result,
    observedAt: wrapper.observedAt,
    sourceRef: {
      path: "evidence/slice3/full-wrapper-result.json",
      sha256: wrapperSha256,
    },
  };
  if (
    wrapper.schemaVersion !== "matchbase.slice3-full-wrapper-result/v1" ||
    wrapper.command !== SLICE3_WRAPPER_COMMAND ||
    !["PENDING", "PASS"].includes(wrapper.result) ||
    (wrapper.result === "PASS" &&
      (!Number.isSafeInteger(wrapper.durationMs) ||
        wrapper.durationMs < 1 ||
        wrapper.durationMs > 3_600_000 ||
        wrapper.exitCode !== 0)) ||
    (wrapper.result === "PENDING" &&
      (wrapper.durationMs !== null || wrapper.exitCode !== null)) ||
    wrapper.providerCalls !== 0 ||
    wrapper.externalMutations !== 0 ||
    !Number.isFinite(Date.parse(wrapper.observedAt)) ||
    Date.parse(wrapper.observedAt) > Date.parse(evidence.observedAt) ||
    !SHA256.test(wrapperSha256) ||
    JSON.stringify(wrapper.candidate) !==
      JSON.stringify({
        manifestSha256: evidence.candidate.manifestSha256,
        aggregateSha256: evidence.candidate.aggregateSha256,
        fileCount: evidence.candidate.fileCount,
      }) ||
    JSON.stringify(evidence.localGate.fullWrapper) !== JSON.stringify(expected)
  )
    throw new Error("Slice 3 full-wrapper result binding is stale or invalid.");
  return wrapper;
}
