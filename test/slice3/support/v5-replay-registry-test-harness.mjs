import { open, lstat, realpath, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateV5ReplayRegistryBytes } from "../../../scripts/lib/slice3-v5-replay-registry.mjs";
import {
  rfc8785Canonicalize,
  sha256,
} from "../../../scripts/lib/slice3-v5-role2-tpm-verifier.mjs";

async function checked(path) {
  const root = dirname(path);
  const rootItem = await lstat(root);
  if (
    !rootItem.isDirectory() ||
    rootItem.isSymbolicLink() ||
    (await realpath(root)) !== resolve(root)
  )
    throw new Error("test replay root is invalid");
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    const pathItem = await lstat(path);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      !pathItem.isFile() ||
      pathItem.isSymbolicLink() ||
      pathItem.nlink !== 1 ||
      before.dev !== pathItem.dev ||
      before.ino !== pathItem.ino
    )
      throw new Error("test replay file is invalid");
    return handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function inspectV5ReplayRegistryAt(path, identity) {
  const validated = validateV5ReplayRegistryBytes(await checked(path));
  return {
    ...validated,
    identityUsed: validated.records.some(
      (record) =>
        record.sessionId === identity.sessionId ||
        record.nonce === identity.nonce,
    ),
  };
}

export async function reserveV5ReplayIdentityAt({
  registryPath,
  replayIdentity,
  payloadSha256,
  observedAt,
}) {
  const lockPath = `${registryPath}.lock`;
  const lock = await open(lockPath, "wx");
  try {
    const bytes = await checked(registryPath);
    const validated = validateV5ReplayRegistryBytes(bytes);
    if (
      validated.digest !== replayIdentity.registryPreSignSha256 ||
      validated.records.some(
        (record) =>
          record.sessionId === replayIdentity.sessionId ||
          record.nonce === replayIdentity.nonce,
      )
    )
      throw new Error("test replay identity is stale or consumed");
    const core = {
      schemaVersion: "matchbase.role2-v5-replay-consumption/v1",
      sequence: validated.records.length + 1,
      workspaceClaim: replayIdentity.workspaceClaim,
      decisionId: replayIdentity.decisionId,
      sessionId: replayIdentity.sessionId,
      nonce: replayIdentity.nonce,
      keyId: replayIdentity.keyId,
      payloadSha256,
      registryPreSignSha256: replayIdentity.registryPreSignSha256,
      previousRecordSha256: validated.lastRecordSha256,
      observedAt,
    };
    const record = {
      ...core,
      recordSha256: sha256(Buffer.from(rfc8785Canonicalize(core), "utf8")),
    };
    const handle = await open(registryPath, "r+");
    try {
      const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
      await handle.write(line, 0, line.length, bytes.length);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return record;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function verifyV5ReplayReservationAt(path, recordSha256) {
  const validated = validateV5ReplayRegistryBytes(await checked(path));
  const record = validated.records.at(-1);
  if (record?.recordSha256 !== recordSha256)
    throw new Error("test replay reservation is stale");
  return record;
}
