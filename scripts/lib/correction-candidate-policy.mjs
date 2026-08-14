import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const shaPattern = /^[A-F0-9]{64}$/u;
const excluded = new Set([
  "evidence/slice1/correction-loop-1-candidate.json",
  "evidence/slice1/correction-loop-2-candidate.json",
  "evidence/slice1/local-validation.json",
  "governance/agents.json",
  "governance/artifact-index.json",
]);
const loop1ExpectedPaths = [
  "apps/web/package.json",
  "apps/web/src/authorization-matrix.postgres.test.ts",
  "apps/web/src/fetch-runtime.ts",
  "apps/web/src/runtime.ts",
  "apps/web/vitest.config.ts",
  "config/protected-management-history.v1.json",
  "governance/external-closure-anchor-v1.json",
  "package.json",
  "packages/application/src/authorization.ts",
  "packages/application/src/index.ts",
  "packages/application/src/service.ts",
  "packages/application/src/types.ts",
  "packages/auth/package.json",
  "packages/auth/src/index.ts",
  "packages/auth/test/auth.test.ts",
  "packages/contracts/src/index.ts",
  "packages/contracts/src/v1/authorization.ts",
  "packages/data/package.json",
  "packages/data/src/authorization.ts",
  "packages/data/src/index.ts",
  "pnpm-lock.yaml",
  "scripts/generate-dashboard-ci-snapshot.mjs",
  "scripts/generate-dashboard-snapshot.mjs",
  "scripts/lib/correction-candidate-policy.mjs",
  "scripts/lib/dashboard-closure-policy.mjs",
  "scripts/lib/dashboard-source-policy.mjs",
  "scripts/lib/external-closure-policy.mjs",
  "scripts/lib/protected-management-history.mjs",
  "scripts/lib/semantic-dashboard.mjs",
  "scripts/prepare-dashboard-snapshot.mjs",
  "scripts/validate-dashboard-snapshot.mjs",
  "scripts/validate-protected-baseline.mjs",
  "scripts/validate-slice1-evidence.mjs",
  "scripts/validate-slice1-local.mjs",
  "test/correction-candidate-policy.test.mjs",
  "test/dashboard-closure-policy.test.mjs",
  "test/external-closure-policy.test.mjs",
  "test/protected-management-history.test.mjs",
  "test/semantic-dashboard.test.mjs",
  "test/slice1/api/application-postgres.test.mjs",
  "test/snapshot-path-policy.test.mjs",
];
const loop2ExpectedPaths = [
  "apps/dashboard/src/styles.css",
  "governance/external-closure-anchor-v1.json",
  "governance/predecessor-failures-v1.json",
  "scripts/generate-dashboard-ci-snapshot.mjs",
  "scripts/generate-dashboard-snapshot.mjs",
  "scripts/lib/correction-candidate-policy.mjs",
  "scripts/lib/dashboard-closure-policy.mjs",
  "scripts/lib/external-closure-policy.mjs",
  "scripts/lib/predecessor-failure-policy.mjs",
  "scripts/lib/semantic-dashboard.mjs",
  "scripts/validate-dashboard-snapshot.mjs",
  "scripts/validate-slice1-evidence.mjs",
  "test/browser/dashboard.spec.mjs",
  "test/correction-candidate-policy.test.mjs",
  "test/dashboard-closure-policy.test.mjs",
  "test/external-closure-policy.test.mjs",
  "test/predecessor-failure-policy.test.mjs",
  "test/semantic-dashboard.test.mjs",
];
const expectedPathsByCandidate = new Map([
  ["PO-001-SLICE-1-LOOP-1", loop1ExpectedPaths],
  ["PO-001-SLICE-1-LOOP-2", loop2ExpectedPaths],
]);

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function hashFile(path) {
  return createHash("sha256")
    .update(readFileSync(path))
    .digest("hex")
    .toUpperCase();
}

export function correctionCandidateAggregate(entries) {
  const hash = createHash("sha256");
  for (const entry of entries)
    hash.update(`${entry.path}\0${entry.sha256}\n`, "utf8");
  return hash.digest("hex").toUpperCase();
}

export function validateCorrectionCandidate(value, { repoRoot = "." } = {}) {
  const root = realpathSync(repoRoot);
  const expectedPaths = expectedPathsByCandidate.get(value?.candidateId);
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "candidateId",
      "algorithm",
      "fileCount",
      "aggregateSha256",
      "files",
    ]) ||
    value?.schemaVersion !== 1 ||
    !expectedPaths ||
    value?.algorithm !== "SHA256(PATH_NUL_SHA256_LF)" ||
    value.fileCount !== expectedPaths.length ||
    !Array.isArray(value.files) ||
    value.files.length !== value.fileCount ||
    !shaPattern.test(value.aggregateSha256 ?? "")
  )
    throw new Error("Correction candidate manifest schema is invalid.");
  const paths = value.files.map(({ path }) => path);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== expectedPaths[index])
  )
    throw new Error("Correction candidate paths must equal the frozen set.");
  for (const entry of value.files) {
    if (
      !hasExactKeys(entry, ["path", "sha256"]) ||
      typeof entry.path !== "string" ||
      isAbsolute(entry.path) ||
      entry.path.includes("\\") ||
      entry.path.split("/").includes("..") ||
      excluded.has(entry.path) ||
      !shaPattern.test(entry.sha256 ?? "")
    )
      throw new Error(
        "Correction candidate entry is invalid or self-referential.",
      );
    const path = resolve(root, entry.path);
    const difference = relative(root, path);
    if (
      difference === ".." ||
      difference.startsWith(`..${sep}`) ||
      isAbsolute(difference)
    )
      throw new Error("Correction candidate path escapes the repository.");
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(
        `Correction candidate path is not a regular file: ${entry.path}`,
      );
    if (hashFile(realpathSync(path)) !== entry.sha256)
      throw new Error(`Correction candidate hash mismatch: ${entry.path}`);
  }
  if (correctionCandidateAggregate(value.files) !== value.aggregateSha256)
    throw new Error("Correction candidate aggregate mismatch.");
  return value;
}
