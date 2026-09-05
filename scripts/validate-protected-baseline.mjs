import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep, win32 } from "node:path";
import {
  validateManagementManifestBytes,
  verifyProtectedManagementHistory,
} from "./lib/protected-management-history.mjs";

const MANAGEMENT_MANIFEST_EXPECTED = Object.freeze({
  manifestSha256:
    "5796E23E3937C19C1E5202453AB1D85B7F253EDD619C7C40E1DAE84E67E3437D",
  manifestId: "matchbase-protected-management-history-v1",
  rootIdentity: "01_Product_Management",
  fileCount: 36,
  legacyAggregateSha256:
    "BE407DA2BB59084F208AE6247B0CFFB0391CEEA021F480B64A9392F066F64803",
});

const baseline = JSON.parse(
  await readFile(
    new URL("../evidence/slice1/protected-baseline.json", import.meta.url),
    "utf8",
  ),
);
const managementManifestBytes = await readFile(
  new URL("../config/protected-management-history.v1.json", import.meta.url),
);
const managementManifest = validateManagementManifestBytes(
  managementManifestBytes,
  MANAGEMENT_MANIFEST_EXPECTED,
);
const anchorOnly =
  process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI";
if (anchorOnly && process.env.CI !== "true")
  throw new Error("Protected anchor-only mode is restricted to CI=true.");

function validSha(value) {
  return typeof value === "string" && /^[A-F0-9]{64}$/u.test(value);
}

const FORWARD_PLANNING_DOCS = new Set([
  "MATCHBASE_PRODUCT_DEVELOPMENT_BASELINE.md",
  "CONSULTANT_DEEP_RESEARCH_OUTPUT_V2_SPEC.md",
  "CONSULTANT_TIER_AGENTIC_RESEARCH_AND_UX_SPEC.md",
]);

async function inventory(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw new Error(`Protected source symlink refused: ${path}`);
      if (metadata.isDirectory()) await walk(path);
      else if (metadata.isFile()) {
        const rel = relative(root, path).replaceAll(sep, "/");
        if (FORWARD_PLANNING_DOCS.has(rel)) continue;
        files.push(path);
      }
    }
  }
  await walk(root);
  files.sort((left, right) =>
    relative(root, left)
      .replaceAll(sep, "/")
      .localeCompare(relative(root, right).replaceAll(sep, "/"), "en"),
  );
  const aggregate = createHash("sha256");
  for (const path of files) {
    const relativePath = relative(root, path).replaceAll(sep, "/");
    const sha = createHash("sha256")
      .update(await readFile(path))
      .digest("hex")
      .toUpperCase();
    aggregate.update(`${relativePath}\0${sha}\n`);
  }
  return { count: files.length, sha: aggregate.digest("hex").toUpperCase() };
}

if (!Array.isArray(baseline.roots) || baseline.roots.length !== 3)
  throw new Error("Protected baseline roots are invalid.");
const rootsById = new Map();
for (const root of baseline.roots) {
  if (
    !["authoritative", "planning", "managementHistory"].includes(root.id) ||
    !win32.isAbsolute(root.path) ||
    !Number.isInteger(root.fileCount) ||
    root.fileCount < 1 ||
    !validSha(root.aggregateSha256)
  )
    throw new Error("Protected baseline anchor is invalid.");
  if (rootsById.has(root.id))
    throw new Error(`Protected baseline root is duplicated: ${root.id}`);
  rootsById.set(root.id, root);
}

for (const id of ["authoritative", "planning"]) {
  const root = rootsById.get(id);
  if (!root) throw new Error(`Protected baseline root is missing: ${id}`);
  if (!anchorOnly) {
    const actual = await inventory(root.path);
    if (actual.count !== root.fileCount || actual.sha !== root.aggregateSha256)
      throw new Error(`Protected baseline mismatch: ${root.id}`);
  }
}

const managementRoot = rootsById.get("managementHistory");
if (
  !managementRoot ||
  managementRoot.fileCount !== managementManifest.fileCount ||
  managementRoot.aggregateSha256 !== managementManifest.legacyAggregateSha256 ||
  win32.basename(win32.normalize(managementRoot.path)) !==
    managementManifest.rootIdentity
) {
  throw new Error("Protected management baseline/manifest mismatch.");
}
if (!anchorOnly)
  await verifyProtectedManagementHistory(
    managementRoot.path,
    managementManifest,
  );

const log = baseline.appendOnlyLog;
if (
  !win32.isAbsolute(log.path) ||
  !Number.isInteger(log.prefixBytes) ||
  !validSha(log.prefixSha256)
)
  throw new Error("Append-only log anchor is invalid.");
if (!anchorOnly) {
  const handle = await open(log.path, "r");
  try {
    const buffer = Buffer.alloc(log.prefixBytes);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== buffer.length)
      throw new Error("Append-only log is shorter than its protected prefix.");
    const sha = createHash("sha256").update(buffer).digest("hex").toUpperCase();
    if (sha !== log.prefixSha256)
      throw new Error("Append-only log prefix mismatch.");
  } finally {
    await handle.close();
  }
}
process.stdout.write(
  `protected baseline: PASS (${anchorOnly ? "MANIFEST_ANCHOR_CI" : "EXACT_LOCAL_SHA256"}; 14 authoritative, 67 planning, 36 explicit management-history files)\n`,
);
