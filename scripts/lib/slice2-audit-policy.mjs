const SHA256 = /^[A-F0-9]{64}$/u;

export const SLICE2_AUDIT_IDS = Object.freeze([
  "S2-AUDIT-SECURITY-PRIVACY",
  "S2-AUDIT-DATA-MIGRATION",
  "S2-AUDIT-AI-EVIDENCE",
  "S2-AUDIT-QA-ACCESSIBILITY",
  "S2-AUDIT-SRE-COST",
  "S2-AUDIT-REPOSITORY-RELEASE",
  "S2-AUDIT-INTEGRATION-CRITIC",
]);

export function mergeSlice2ChangedPaths({
  committedPaths,
  workingPaths,
  untrackedPaths,
}) {
  for (const paths of [committedPaths, workingPaths, untrackedPaths])
    if (
      !Array.isArray(paths) ||
      paths.some(
        (path) =>
          typeof path !== "string" ||
          !path ||
          path.includes("\\") ||
          path.startsWith("/") ||
          path.split("/").includes(".."),
      )
    )
      throw new Error("Slice 2 Git changed paths are invalid.");

  return [
    ...new Set([...committedPaths, ...workingPaths, ...untrackedPaths]),
  ].sort();
}

const AUDIT_KEYS = Object.freeze([
  "candidateAggregateSha256",
  "candidateManifestSha256",
  "critical",
  "id",
  "major",
  "method",
  "minor",
  "status",
]);

export function validateSlice2AuditBindings(
  audits,
  candidateManifestSha256,
  candidateAggregateSha256,
) {
  if (
    !SHA256.test(candidateManifestSha256) ||
    !SHA256.test(candidateAggregateSha256) ||
    !Array.isArray(audits) ||
    audits.length !== SLICE2_AUDIT_IDS.length
  )
    throw new Error("Slice 2 audit binding identity is invalid.");

  for (const [index, audit] of audits.entries()) {
    if (
      audit === null ||
      typeof audit !== "object" ||
      Array.isArray(audit) ||
      JSON.stringify(Object.keys(audit).sort()) !== JSON.stringify(AUDIT_KEYS)
    )
      throw new Error("Slice 2 audit record schema is not closed.");
    const critic = index === SLICE2_AUDIT_IDS.length - 1;
    if (
      audit.id !== SLICE2_AUDIT_IDS[index] ||
      (critic
        ? !["PENDING", "PASS"].includes(audit.status)
        : audit.status !== "PASS") ||
      audit.critical !== 0 ||
      audit.major !== 0 ||
      audit.minor !== 0 ||
      typeof audit.method !== "string" ||
      !audit.method.trim() ||
      audit.candidateManifestSha256 !== candidateManifestSha256 ||
      audit.candidateAggregateSha256 !== candidateAggregateSha256
    )
      throw new Error(
        "Slice 2 audits are incomplete, reordered, or bound to different candidate bytes.",
      );
  }
}
