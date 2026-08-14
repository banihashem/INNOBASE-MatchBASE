import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

const SHA256_PATTERN = /^[A-F0-9]{64}$/u;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export function aggregateProtectedEntries(entries) {
  const aggregate = createHash("sha256");
  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  )) {
    aggregate.update(`${entry.path}\0${entry.sha256}\n`);
  }
  return aggregate.digest("hex").toUpperCase();
}

function canonicalIdentity(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path === path.normalize("NFC") &&
    !path.includes("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    path !== "." &&
    path !== ".." &&
    !path.endsWith(".") &&
    !path.endsWith(" ") &&
    !isAbsolute(path) &&
    !win32.isAbsolute(path)
  );
}

export function validateManagementManifestBytes(bytes, expected) {
  if (!Buffer.isBuffer(bytes))
    throw new Error("Protected management manifest bytes are required.");
  if (sha256(bytes) !== expected.manifestSha256)
    throw new Error("Protected management manifest identity/hash mismatch.");

  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Protected management manifest is not valid JSON.");
  }

  if (
    manifest.schemaVersion !== 1 ||
    manifest.manifestId !== expected.manifestId ||
    manifest.rootIdentity !== expected.rootIdentity ||
    manifest.pathSemantics !==
      "Unicode-NFC, case-sensitive, root-relative POSIX identity" ||
    manifest.aggregateAlgorithm !==
      "SHA256(sorted(relativePath + NUL + uppercaseFileSha256 + LF))" ||
    manifest.fileCount !== expected.fileCount ||
    manifest.legacyAggregateSha256 !== expected.legacyAggregateSha256 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== expected.fileCount
  ) {
    throw new Error("Protected management manifest contract mismatch.");
  }

  const exactIdentities = new Set();
  const foldedIdentities = new Set();
  let previousPath;
  for (const entry of manifest.files) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !canonicalIdentity(entry.path) ||
      typeof entry.sha256 !== "string" ||
      !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw new Error("Protected management manifest entry is invalid.");
    }
    if (exactIdentities.has(entry.path))
      throw new Error("Protected management manifest duplicates an identity.");
    const folded = entry.path.toLocaleLowerCase("en-US");
    if (foldedIdentities.has(folded))
      throw new Error("Protected management manifest has a case collision.");
    if (
      previousPath !== undefined &&
      previousPath.localeCompare(entry.path, "en") >= 0
    ) {
      throw new Error(
        "Protected management manifest entries are not canonical.",
      );
    }
    exactIdentities.add(entry.path);
    foldedIdentities.add(folded);
    previousPath = entry.path;
  }

  if (
    aggregateProtectedEntries(manifest.files) !== expected.legacyAggregateSha256
  ) {
    throw new Error("Protected management legacy aggregate mismatch.");
  }
  return manifest;
}

function insideRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export async function verifyProtectedManagementHistory(rootPath, manifest) {
  const resolvedRoot = resolve(rootPath);
  const rootMetadata = await lstat(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory())
    throw new Error("Protected management root must be a physical directory.");
  const physicalRoot = await realpath(resolvedRoot);

  const declaredByFoldedIdentity = new Map(
    manifest.files.map((entry) => [
      entry.path.toLocaleLowerCase("en-US"),
      entry,
    ]),
  );
  const directoryEntries = await readdir(resolvedRoot, {
    withFileTypes: true,
  });
  const matchedIdentities = new Set();
  for (const entry of directoryEntries) {
    const folded = entry.name.normalize("NFC").toLocaleLowerCase("en-US");
    const declared = declaredByFoldedIdentity.get(folded);
    if (!declared) continue;
    if (entry.name !== declared.path || matchedIdentities.has(folded))
      throw new Error(
        `Protected management case collision or identity mismatch: ${entry.name}`,
      );
    matchedIdentities.add(folded);
  }

  const protectedPhysicalPaths = new Set();
  const protectedHashes = new Set();
  for (const entry of manifest.files) {
    if (!matchedIdentities.has(entry.path.toLocaleLowerCase("en-US")))
      throw new Error(`Protected management file is missing: ${entry.path}`);
    const candidate = resolve(resolvedRoot, entry.path);
    if (!insideRoot(resolvedRoot, candidate))
      throw new Error(
        `Protected management path escapes its root: ${entry.path}`,
      );
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink())
      throw new Error(`Protected management symlink refused: ${entry.path}`);
    if (!metadata.isFile())
      throw new Error(
        `Protected management identity is not a file: ${entry.path}`,
      );
    if (metadata.nlink !== 1)
      throw new Error(`Protected management hard link refused: ${entry.path}`);
    const physicalPath = await realpath(candidate);
    if (!insideRoot(physicalRoot, physicalPath))
      throw new Error(
        `Protected management path escapes its root: ${entry.path}`,
      );
    const actualSha256 = sha256(await readFile(candidate));
    if (actualSha256 !== entry.sha256)
      throw new Error(`Protected management hash mismatch: ${entry.path}`);
    protectedPhysicalPaths.add(physicalPath.toLocaleLowerCase("en-US"));
    protectedHashes.add(actualSha256);
  }

  let newArtifactCount = 0;
  for (const entry of directoryEntries) {
    if (declaredByFoldedIdentity.has(entry.name.toLocaleLowerCase("en-US")))
      continue;
    const candidate = resolve(resolvedRoot, entry.name);
    if (!insideRoot(resolvedRoot, candidate))
      throw new Error(
        `Management artifact path escapes its root: ${entry.name}`,
      );
    if (entry.isSymbolicLink()) {
      const physicalPath = await realpath(candidate);
      if (protectedPhysicalPaths.has(physicalPath.toLocaleLowerCase("en-US"))) {
        throw new Error(
          `New management artifact aliases protected history: ${entry.name}`,
        );
      }
    } else if (entry.isFile()) {
      const candidateSha256 = sha256(await readFile(candidate));
      if (protectedHashes.has(candidateSha256))
        throw new Error(
          `New management artifact duplicates protected history: ${entry.name}`,
        );
    }
    newArtifactCount += 1;
  }

  return { fileCount: manifest.files.length, newArtifactCount };
}
