import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

export async function readExactRegularContainedSource(path, root, digest) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1)
    throw new Error("V5 source is not a regular file.");
  const fileReal = await realpath(path);
  const difference = relative(rootReal, fileReal);
  if (
    !difference ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference) ||
    resolve(rootReal, difference) !== fileReal
  )
    throw new Error("V5 source escaped containment.");
  const handle = await open(fileReal, "r");
  let bytes;
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== item.dev ||
      before.ino !== item.ino
    )
      throw new Error("V5 source identity changed before checked read.");
    bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.nlink !== 1 ||
      pathAfter.nlink !== 1 ||
      pathAfter.isSymbolicLink()
    )
      throw new Error("V5 source identity changed during checked read.");
  } finally {
    await handle.close();
  }
  if (digest !== null && sha256(bytes) !== digest)
    throw new Error("V5 immutable source drifted.");
  return bytes;
}

export async function verifyImmutableV5PredecessorLedger({
  stateRoot,
  sessionId,
  expectedDigest,
  expectedFiles,
}) {
  const directory = join(stateRoot, sessionId);
  const names = (await readdir(directory)).sort();
  const expectedNames = expectedFiles.map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(expectedNames))
    throw new Error("V5 predecessor ledger file set drifted.");
  const manifest = [];
  for (const expected of expectedFiles) {
    const bytes = await readExactRegularContainedSource(
      join(directory, expected.name),
      directory,
      expected.digest,
    );
    manifest.push({ name: expected.name, digest: sha256(bytes) });
  }
  const digest = sha256(JSON.stringify(manifest));
  if (digest !== expectedDigest)
    throw new Error("V5 predecessor ledger digest drifted.");
  return Object.freeze({ sessionId, digest });
}
