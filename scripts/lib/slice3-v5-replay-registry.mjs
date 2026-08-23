import { open, lstat, realpath, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  rfc8785Canonicalize,
  sha256,
  V5_TPM_CONTRACT,
} from "./slice3-v5-role2-tpm-verifier.mjs";

const RECORD_KEYS = Object.freeze([
  "schemaVersion",
  "sequence",
  "workspaceClaim",
  "decisionId",
  "sessionId",
  "nonce",
  "keyId",
  "payloadSha256",
  "registryPreSignSha256",
  "previousRecordSha256",
  "observedAt",
  "recordSha256",
]);
const CORE_KEYS = Object.freeze(RECORD_KEYS.slice(0, -1));
const SHA256 = /^[A-F0-9]{64}$/u;
const UTC_SECOND =
  /^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u;
const PREDECESSOR = Object.freeze({
  sequence: 1,
  decisionId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET",
  sessionId: "v5-53676308BAD073D07FFC88B8",
  nonce: "B5E913955E9D6F0812DEB32E03771901",
  payloadSha256:
    "1B1BF7632DFCE078E3ED04D4AC8872C90CC2CF5EB88E8EAC16E0B2F09DF1888C",
  registryPreSignSha256:
    "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
  previousRecordSha256: null,
  observedAt: "2026-08-23T08:32:50Z",
  recordSha256:
    "D1D0EE0DE2A545D0395427565EB154E0F7B70D93265BF42C3E013D8A705765EB",
});

const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);

function canonicalUtc(value) {
  if (typeof value !== "string" || !UTC_SECOND.test(value)) return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().replace(".000Z", "Z") === value
  );
}

export function validateV5ReplayRegistryBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1_048_576)
    throw new Error("V5 replay registry is not bounded bytes.");
  if (bytes.length === 0)
    throw new Error("V5 replay registry empty rollback is forbidden.");
  if (bytes.at(-1) !== 0x0a)
    throw new Error("V5 replay registry is not LF-terminated JSONL.");
  const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  const lines = text.slice(0, -1).split("\n");
  const records = [];
  let previousRecordSha256 = null;
  for (const [index, line] of lines.entries()) {
    if (!line || line.includes("\r"))
      throw new Error("V5 replay registry line encoding is invalid.");
    const record = JSON.parse(line);
    if (!exactKeys(record, RECORD_KEYS))
      throw new Error("V5 replay registry record is not closed or ordered.");
    const core = Object.fromEntries(CORE_KEYS.map((key) => [key, record[key]]));
    const expectedRecordSha256 = sha256(
      Buffer.from(rfc8785Canonicalize(core), "utf8"),
    );
    const predecessorValid =
      index === 0 &&
      record.sequence === PREDECESSOR.sequence &&
      record.decisionId === PREDECESSOR.decisionId &&
      record.sessionId === PREDECESSOR.sessionId &&
      record.nonce === PREDECESSOR.nonce &&
      record.payloadSha256 === PREDECESSOR.payloadSha256 &&
      record.registryPreSignSha256 === PREDECESSOR.registryPreSignSha256 &&
      record.previousRecordSha256 === PREDECESSOR.previousRecordSha256 &&
      record.observedAt === PREDECESSOR.observedAt &&
      record.recordSha256 === PREDECESSOR.recordSha256;
    const successorValid =
      index === 1 &&
      record.sequence === 2 &&
      record.decisionId === V5_TPM_CONTRACT.decisionId &&
      record.sessionId === V5_TPM_CONTRACT.sessionId &&
      record.nonce === V5_TPM_CONTRACT.nonce &&
      record.registryPreSignSha256 === V5_TPM_CONTRACT.replayPreSignSha256 &&
      record.previousRecordSha256 === V5_TPM_CONTRACT.replayPreSignTailSha256;
    if (
      record.schemaVersion !== "matchbase.role2-v5-replay-consumption/v1" ||
      record.sequence !== index + 1 ||
      record.workspaceClaim !== V5_TPM_CONTRACT.workspaceClaim ||
      record.keyId !== V5_TPM_CONTRACT.keyId ||
      !SHA256.test(record.payloadSha256) ||
      !SHA256.test(record.registryPreSignSha256) ||
      record.previousRecordSha256 !== previousRecordSha256 ||
      !canonicalUtc(record.observedAt) ||
      record.recordSha256 !== expectedRecordSha256 ||
      (!predecessorValid && !successorValid)
    )
      throw new Error("V5 replay registry hash chain is invalid.");
    records.push(Object.freeze(record));
    previousRecordSha256 = record.recordSha256;
  }
  const identities = records.map(
    ({ workspaceClaim, decisionId, sessionId, nonce, keyId }) =>
      `${workspaceClaim}\0${decisionId}\0${sessionId}\0${nonce}\0${keyId}`,
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("V5 replay registry contains a duplicate identity.");
  return Object.freeze({
    records: Object.freeze(records),
    digest: sha256(bytes),
    byteLength: bytes.length,
    lastRecordSha256: previousRecordSha256,
  });
}

async function checkedRegistryBytes(path) {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error("V5 canonical replay registry file is absent.");
    throw error;
  }
  try {
    const before = await handle.stat();
    const item = await lstat(path);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      !item.isFile() ||
      item.isSymbolicLink() ||
      item.nlink !== 1 ||
      before.dev !== item.dev ||
      before.ino !== item.ino
    )
      throw new Error("V5 replay registry is not a checked regular file.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.nlink !== 1 ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino
    )
      throw new Error("V5 replay registry changed during checked read.");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function assertRegistryRoot(registryPath) {
  const registryRoot = dirname(registryPath);
  const rootItem = await lstat(registryRoot);
  if (
    !rootItem.isDirectory() ||
    rootItem.isSymbolicLink() ||
    (await realpath(registryRoot)) !== resolve(registryRoot)
  )
    throw new Error("V5 canonical replay registry root is invalid.");
  return registryRoot;
}

async function inspectV5ReplayRegistryAt(registryPath, replayIdentity) {
  await assertRegistryRoot(registryPath);
  const bytes = await checkedRegistryBytes(registryPath);
  const validated = validateV5ReplayRegistryBytes(bytes);
  const identityUsed = validated.records.some(
    (record) =>
      record.workspaceClaim === replayIdentity.workspaceClaim &&
      record.decisionId === replayIdentity.decisionId &&
      (record.sessionId === replayIdentity.sessionId ||
        record.nonce === replayIdentity.nonce),
  );
  return Object.freeze({ ...validated, identityUsed });
}

export async function inspectCanonicalV5ReplayRegistry(replayIdentity) {
  return inspectV5ReplayRegistryAt(
    V5_TPM_CONTRACT.replayRegistryPath,
    replayIdentity,
  );
}

async function reserveV5ReplayIdentityAt({
  registryPath,
  replayIdentity,
  payloadSha256,
  observedAt,
}) {
  await assertRegistryRoot(registryPath);
  const lockPath = `${registryPath}.lock`;
  const lock = await open(lockPath, "wx");
  let writeStarted = false;
  let completed = false;
  try {
    const bytes = await checkedRegistryBytes(registryPath);
    const validated = validateV5ReplayRegistryBytes(bytes);
    if (
      validated.digest !== replayIdentity.registryPreSignSha256 ||
      validated.records.some(
        (record) =>
          record.sessionId === replayIdentity.sessionId ||
          record.nonce === replayIdentity.nonce,
      )
    )
      throw new Error("V5 replay identity is stale or already consumed.");
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
    const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    const registry = await open(registryPath, "r+");
    try {
      const before = await registry.stat();
      const pathBefore = await lstat(registryPath);
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        !pathBefore.isFile() ||
        pathBefore.isSymbolicLink() ||
        pathBefore.nlink !== 1 ||
        before.dev !== pathBefore.dev ||
        before.ino !== pathBefore.ino
      )
        throw new Error("V5 replay reservation handle is not canonical.");
      const current = await registry.readFile();
      if (!current.equals(bytes))
        throw new Error("V5 replay registry changed under reservation lock.");
      writeStarted = true;
      const writeResult = await registry.write(
        line,
        0,
        line.length,
        bytes.length,
      );
      if (writeResult.bytesWritten !== line.length)
        throw new Error("V5 replay reservation write was partial.");
      await registry.sync();
      const after = await registry.stat();
      const pathAfter = await lstat(registryPath);
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.nlink !== 1 ||
        pathAfter.isSymbolicLink() ||
        !pathAfter.isFile() ||
        pathAfter.nlink !== 1 ||
        pathAfter.dev !== after.dev ||
        pathAfter.ino !== after.ino
      )
        throw new Error("V5 replay registry identity changed during append.");
    } finally {
      await registry.close();
    }
    const terminal = validateV5ReplayRegistryBytes(
      await checkedRegistryBytes(registryPath),
    );
    if (terminal.records.at(-1)?.recordSha256 !== record.recordSha256)
      throw new Error("V5 replay reservation did not persist exactly.");
    completed = true;
    return Object.freeze(record);
  } finally {
    await lock.close();
    if (!writeStarted || completed) await rm(lockPath, { force: true });
  }
}

export async function reserveCanonicalV5ReplayIdentity(input) {
  return reserveV5ReplayIdentityAt({
    registryPath: V5_TPM_CONTRACT.replayRegistryPath,
    ...input,
  });
}

async function verifyV5ReplayReservationAt(registryPath, recordSha256) {
  await assertRegistryRoot(registryPath);
  const validated = validateV5ReplayRegistryBytes(
    await checkedRegistryBytes(registryPath),
  );
  if (validated.records.at(-1)?.recordSha256 !== recordSha256)
    throw new Error("V5 durable replay reservation is missing or stale.");
  return validated.records.at(-1);
}

export async function verifyCanonicalV5ReplayReservation(recordSha256) {
  return verifyV5ReplayReservationAt(
    V5_TPM_CONTRACT.replayRegistryPath,
    recordSha256,
  );
}
