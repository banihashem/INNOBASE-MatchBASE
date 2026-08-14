import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(repositoryRoot, "apps", "web");
const standaloneRoot = join(webRoot, ".next", "standalone");
const standaloneWebRoot = join(standaloneRoot, "apps", "web");
const manifestEntries = [];

function assertInsideStandalone(path) {
  const relativePath = relative(standaloneRoot, path);
  if (
    relativePath === "" ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Path escapes the standalone artifact: ${path}`);
  }
}

function assertInsideRepository(path) {
  const relativePath = relative(repositoryRoot, path);
  if (
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Dependency link escapes the repository: ${path}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function unlinkWithRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      await unlink(path);
      return;
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (error?.code !== "EPERM" && error?.code !== "EBUSY") throw error;
      lastError = error;
      await delay(20 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function treeFingerprint(root) {
  const hash = createHash("sha256");
  async function visit(path, relativePath) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Materialized dependency contains a symlink: ${path}`);
    }
    if (metadata.isDirectory()) {
      hash.update(`d\0${relativePath}\n`);
      const entries = await readdir(path, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const entry of entries) {
        await visit(
          join(path, entry.name),
          relativePath ? `${relativePath}/${entry.name}` : entry.name,
        );
      }
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`Unsupported materialized dependency entry: ${path}`);
    }
    hash.update(`f\0${relativePath}\0${metadata.size}\0`);
    hash.update(await readFile(path));
    hash.update("\n");
  }
  await visit(root, "");
  return hash.digest("hex");
}

async function finalizeMaterialization(temporary, destination) {
  let lastError;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EEXIST", "ENOTEMPTY"].includes(error?.code)) {
        throw error;
      }
      lastError = error;
      const destinationMetadata = await lstatIfPresent(destination);
      if (destinationMetadata) {
        if (destinationMetadata.isSymbolicLink()) {
          throw new Error(
            `Standalone materialization destination became a symlink: ${destination}`,
          );
        }
        const [temporaryFingerprint, destinationFingerprint] =
          await Promise.all([
            treeFingerprint(temporary),
            treeFingerprint(destination),
          ]);
        if (temporaryFingerprint !== destinationFingerprint) {
          throw new Error(
            `Standalone materialization collision has different content: ${destination}`,
          );
        }
        await rm(temporary, { recursive: true, force: false });
        return;
      }
      await delay(20 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function copyRegularTree(sourceRoot, destinationRoot) {
  if (!(await exists(sourceRoot))) {
    await mkdir(destinationRoot, { recursive: true });
    return;
  }

  async function visit(sourceDirectory, destinationDirectory) {
    await mkdir(destinationDirectory, { recursive: true });
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const source = join(sourceDirectory, entry.name);
      const destination = join(destinationDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Standalone asset source contains a symlink: ${source}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(source, destination);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `Standalone asset source is not a regular file: ${source}`,
        );
      }
      await copyFile(source, destination);
      const bytes = await readFile(destination);
      manifestEntries.push({
        path: relative(standaloneWebRoot, destination).split(sep).join("/"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      });
    }
  }

  await visit(sourceRoot, destinationRoot);
}

async function copyDereferenced(
  source,
  destination,
  activeSources = new Set(),
) {
  const sourceMetadata = await lstat(source);
  if (sourceMetadata.isSymbolicLink()) {
    const linkTarget = await readlink(source);
    const resolvedTarget = resolve(dirname(source), linkTarget);
    assertInsideRepository(resolvedTarget);
    if (activeSources.has(resolvedTarget)) {
      throw new Error(`Cyclic standalone dependency link: ${source}`);
    }
    const nextActive = new Set(activeSources);
    nextActive.add(resolvedTarget);
    await copyDereferenced(resolvedTarget, destination, nextActive);
    return;
  }
  if (sourceMetadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      await copyDereferenced(
        join(source, entry.name),
        join(destination, entry.name),
        activeSources,
      );
    }
    await chmod(destination, sourceMetadata.mode);
    return;
  }
  if (!sourceMetadata.isFile()) {
    throw new Error(`Unsupported standalone dependency entry: ${source}`);
  }
  await copyFile(source, destination);
  await chmod(destination, sourceMetadata.mode);
}

async function findPhysicalSymlinks(root) {
  const links = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) links.push(path);
      else if (entry.isDirectory()) await visit(path);
    }
  }
  await visit(root);
  return links;
}

async function materializeDependencySymlinks() {
  const links = await findPhysicalSymlinks(standaloneRoot);
  for (const link of links) {
    assertInsideStandalone(link);
    const suffix = createHash("sha256")
      .update(relative(standaloneRoot, link))
      .digest("hex")
      .slice(0, 12);
    const temporary = `${link}.materialize-${suffix}`;
    assertInsideStandalone(temporary);
    const staleMetadata = await lstatIfPresent(temporary);
    if (staleMetadata) {
      if (staleMetadata.isSymbolicLink()) {
        throw new Error(
          `Stale standalone materialization path is a symlink: ${temporary}`,
        );
      }
      await rm(temporary, { recursive: true, force: false });
    }
    await copyDereferenced(link, temporary);
    await unlinkWithRetry(link);
    await finalizeMaterialization(temporary, link);
  }
  return links.length;
}

async function copyHoistedDependencyClosure() {
  const sourceRoot = join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "node_modules",
  );
  const destinationRoot = join(standaloneWebRoot, "node_modules");
  const packageIdentifiers = [];
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      throw new Error(`Unexpected hoisted dependency entry: ${entry.name}`);
    }
    if (entry.name.startsWith("@")) {
      const scopeSource = join(sourceRoot, entry.name);
      const scopedPackages = await readdir(scopeSource, {
        withFileTypes: true,
      });
      scopedPackages.sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
      );
      for (const scopedPackage of scopedPackages) {
        if (!scopedPackage.isDirectory()) {
          throw new Error(
            `Unexpected scoped dependency entry: ${entry.name}/${scopedPackage.name}`,
          );
        }
        await copyDereferenced(
          join(scopeSource, scopedPackage.name),
          join(destinationRoot, entry.name, scopedPackage.name),
        );
        packageIdentifiers.push(`${entry.name}/${scopedPackage.name}`);
      }
      continue;
    }
    await copyDereferenced(
      join(sourceRoot, entry.name),
      join(destinationRoot, entry.name),
    );
    packageIdentifiers.push(entry.name);
  }
  return packageIdentifiers;
}

const serverPath = join(standaloneWebRoot, "server.js");
if (!(await exists(serverPath))) {
  throw new Error(`Next standalone server is missing: ${serverPath}`);
}

await copyRegularTree(
  join(webRoot, "public"),
  join(standaloneWebRoot, "public"),
);
await copyRegularTree(
  join(webRoot, ".next", "static"),
  join(standaloneWebRoot, ".next", "static"),
);
const materializedLinks = await materializeDependencySymlinks();
const runtimePackages = await copyHoistedDependencyClosure();
const remainingLinks = await findPhysicalSymlinks(standaloneRoot);
if (remainingLinks.length > 0) {
  throw new Error(
    `Standalone dependency closure retains ${remainingLinks.length} symbolic links.`,
  );
}
manifestEntries.sort((left, right) =>
  left.path.localeCompare(right.path, "en"),
);
await writeFile(
  join(standaloneWebRoot, ".standalone-assets.json"),
  `${JSON.stringify(
    { schemaVersion: 1, files: manifestEntries, runtimePackages },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(
  `Packaged ${manifestEntries.length} regular assets, materialized ${materializedLinks} dependency links, and hoisted ${runtimePackages.length} runtime packages for 127.0.0.1:3010.\n`,
);
