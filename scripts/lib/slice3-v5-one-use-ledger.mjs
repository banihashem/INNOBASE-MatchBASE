import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function durableExclusiveWrite(path, bytes) {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const item = await handle.stat();
    const pathItem = await lstat(path);
    if (
      !item.isFile() ||
      item.nlink !== 1 ||
      !pathItem.isFile() ||
      pathItem.isSymbolicLink() ||
      pathItem.nlink !== 1 ||
      item.dev !== pathItem.dev ||
      item.ino !== pathItem.ino ||
      item.size !== Buffer.byteLength(bytes)
    )
      throw new Error("Credential ledger durable write identity is invalid.");
  } finally {
    await handle.close();
  }
}

export async function initializeOneUseCredentialLedger({
  stateRoot,
  sessionId,
  authorizationEvent,
  reservationEvent,
  afterLock,
  buildEventsAfterLock,
  executeWhileLocked,
}) {
  const root = resolve(stateRoot);
  const item = await lstat(root);
  if (
    !item.isDirectory() ||
    item.isSymbolicLink() ||
    (await realpath(root)) !== root
  )
    throw new Error("Credential ledger state root is not canonical.");
  if (!/^v5-[A-F0-9]{24}$/u.test(sessionId))
    throw new Error("Credential ledger session identity is invalid.");
  const sessionDirectory = join(root, sessionId);
  const authorizationLock = `${sessionDirectory}.authorization.lock`;
  const runLock = `${sessionDirectory}.run.lock`;
  const lock = await open(authorizationLock, "wx");
  let runLockHandle;
  let created = false;
  let completed = false;
  try {
    if (!(await absent(sessionDirectory)) || !(await absent(runLock)))
      throw new Error("Credential ledger allocation was already consumed.");
    runLockHandle = await open(runLock, "wx");
    await afterLock?.({
      sessionDirectory,
      authorizationLock,
      authorizationLockHandle: lock,
      runLock,
      runLockHandle,
    });
    const lockedEvents = await buildEventsAfterLock?.({
      sessionDirectory,
      authorizationLock,
      authorizationLockHandle: lock,
      runLock,
      runLockHandle,
    });
    const finalAuthorizationEvent =
      lockedEvents?.authorizationEvent ?? authorizationEvent;
    const finalReservationEvent =
      lockedEvents?.reservationEvent ?? reservationEvent;
    if (!finalAuthorizationEvent || !finalReservationEvent)
      throw new Error("Credential ledger locked events are absent.");
    if (!(await absent(sessionDirectory)))
      throw new Error("Credential ledger allocation was already consumed.");
    await mkdir(sessionDirectory);
    created = true;
    const authorizationBytes = `${JSON.stringify(finalAuthorizationEvent)}\n`;
    const authorizationDigest = sha256(authorizationBytes);
    if (finalReservationEvent.authorizationDigest !== authorizationDigest)
      throw new Error("Credential ledger authorization hash chain is invalid.");
    const reservationBytes = `${JSON.stringify(finalReservationEvent)}\n`;
    const reservationDigest = sha256(reservationBytes);
    await durableExclusiveWrite(
      join(sessionDirectory, "00-authorization.json"),
      authorizationBytes,
    );
    await durableExclusiveWrite(
      join(sessionDirectory, "01-key-get-reserved.json"),
      reservationBytes,
    );
    const initialized = Object.freeze({
      sessionDirectory,
      authorizationLock,
      runLock,
      authorizationDigest,
      reservationDigest,
    });
    const execution = await executeWhileLocked?.({
      ...initialized,
      authorizationLockHandle: lock,
      runLockHandle,
    });
    if (executeWhileLocked && execution?.terminalWritten !== true)
      throw new Error("Credential ledger execution did not terminalize.");
    completed = true;
    return Object.freeze({ ...initialized, execution });
  } catch (error) {
    // A created ledger is intentionally retained: any partial write consumes V5.
    if (!created) throw error;
    throw new Error(
      "Credential ledger initialization failed after consumption.",
      {
        cause: error,
      },
    );
  } finally {
    await runLockHandle?.close();
    await lock.close();
    if (!created || completed) {
      await rm(runLock, { force: true });
      await rm(authorizationLock, { force: true });
    }
  }
}

export async function validateOneUseCredentialLedger(
  sessionDirectory,
  {
    authorizationId,
    sessionId,
    sourceAttestationDigest,
    role2PayloadSha256,
    role2SignatureSha256,
    role2ReplayIdentitySha256,
    role2KeyId,
    role2Nonce,
    replayRecordSha256,
  },
) {
  const sessionItem = await lstat(sessionDirectory);
  if (
    !sessionItem.isDirectory() ||
    sessionItem.isSymbolicLink() ||
    (await realpath(sessionDirectory)) !== resolve(sessionDirectory)
  )
    throw new Error("V5 credential ledger session identity is invalid.");
  const names = (await readdir(sessionDirectory)).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify([
      "00-authorization.json",
      "01-key-get-reserved.json",
      "02-key-get-result.json",
    ])
  )
    throw new Error("V5 credential ledger file set is invalid.");
  const rootReal = await realpath(sessionDirectory);
  const readClosed = async (name) => {
    const path = join(sessionDirectory, name);
    const item = await lstat(path);
    const fileReal = await realpath(path);
    const difference = relative(rootReal, fileReal);
    if (
      !item.isFile() ||
      item.isSymbolicLink() ||
      item.nlink !== 1 ||
      !difference ||
      difference.startsWith("..") ||
      resolve(rootReal, difference) !== fileReal
    )
      throw new Error("V5 credential ledger file escaped containment.");
    return readFile(fileReal);
  };
  const authorizationBytes = await readClosed(names[0]);
  const reservationBytes = await readClosed(names[1]);
  const resultBytes = await readClosed(names[2]);
  const authorization = JSON.parse(authorizationBytes.toString("utf8"));
  const reservation = JSON.parse(reservationBytes.toString("utf8"));
  const result = JSON.parse(resultBytes.toString("utf8"));
  const authorizationDigest = sha256(authorizationBytes);
  const reservationDigest = sha256(reservationBytes);
  const exactKeys = (value, keys) =>
    JSON.stringify(Object.keys(value ?? {}).sort()) ===
    JSON.stringify([...keys].sort());
  const zeroFields = [
    "modelPosts",
    "searchCalls",
    "metadataGets",
    "retries",
    "fallbacks",
    "billableCalls",
    "providerQualificationCalls",
    "accountMutations",
    "cloudMutations",
    "deploymentMutations",
    "externalMutations",
  ];
  const times = [
    Date.parse(authorization.observedAt),
    Date.parse(reservation.observedAt),
    Date.parse(result.observedAt),
  ];
  const envelope = result.sanitizedEnvelope;
  const blockedTupleValid =
    result.disposition === "BLOCKED_CREDENTIAL" &&
    envelope?.paidCredential === null &&
    ((envelope.failureClass === "CREDENTIAL_READ_OR_PRE_SEND_FAILURE" &&
      result.credentialGets === 0 &&
      envelope.callOccurred === false &&
      envelope.httpStatus === null &&
      envelope.urlValid === false &&
      envelope.contentTypeValid === false &&
      envelope.schemaValid === false) ||
      (envelope.failureClass === "UNKNOWN_TRANSPORT_TIMEOUT_OR_REDIRECT" &&
        result.credentialGets === null &&
        envelope.callOccurred === null &&
        envelope.httpStatus === null &&
        envelope.urlValid === false &&
        envelope.contentTypeValid === false &&
        envelope.schemaValid === false) ||
      (envelope.failureClass === "RESPONSE_REDUCTION_FAILURE" &&
        result.credentialGets === 1 &&
        envelope.callOccurred === true &&
        Number.isInteger(envelope.httpStatus) &&
        envelope.schemaValid === false) ||
      (envelope.failureClass === "HTTP_401" &&
        result.credentialGets === 1 &&
        envelope.callOccurred === true &&
        envelope.httpStatus === 401 &&
        envelope.urlValid === true &&
        envelope.schemaValid === false) ||
      (envelope.failureClass === "HTTP_403" &&
        result.credentialGets === 1 &&
        envelope.callOccurred === true &&
        envelope.httpStatus === 403 &&
        envelope.urlValid === true &&
        envelope.schemaValid === false) ||
      (envelope.failureClass === "REDIRECT_RESPONSE" &&
        result.credentialGets === 1 &&
        envelope.callOccurred === true &&
        envelope.httpStatus >= 300 &&
        envelope.httpStatus < 400) ||
      (envelope.failureClass === "INVALID_200_SCHEMA" &&
        result.credentialGets === 1 &&
        envelope.callOccurred === true &&
        envelope.httpStatus === 200 &&
        envelope.schemaValid === false) ||
      (envelope.failureClass === "OTHER_HTTP_STATUS" &&
        result.credentialGets === 1 &&
        envelope.callOccurred === true &&
        Number.isInteger(envelope.httpStatus) &&
        envelope.httpStatus !== 200 &&
        envelope.httpStatus !== 401 &&
        envelope.httpStatus !== 403 &&
        !(envelope.httpStatus >= 300 && envelope.httpStatus < 400) &&
        envelope.schemaValid === false));
  if (
    !exactKeys(authorization, [
      "schemaVersion",
      "authorizationId",
      "sessionId",
      "sourceAttestationDigest",
      "role2PayloadSha256",
      "role2SignatureSha256",
      "role2ReplayIdentitySha256",
      "role2KeyId",
      "role2Nonce",
      "repositoryCommit",
      "repositoryTree",
      "originMain",
      "observedAt",
      "maxCredentialGets",
      "modelPosts",
      "searchCalls",
      "activation",
    ]) ||
    !exactKeys(reservation, [
      "schemaVersion",
      "authorizationId",
      "sessionId",
      "authorizationDigest",
      "replayRecordSha256",
      "observedAt",
      "callNumber",
      "endpoint",
      "method",
      "retries",
      "fallbacks",
      "redirects",
      "allocationConsumed",
      "activation",
    ]) ||
    !exactKeys(result, [
      "schemaVersion",
      "disposition",
      "sanitizedEnvelope",
      "sanitizedEnvelopeDigest",
      "allocationConsumed",
      "credentialGets",
      "modelPosts",
      "searchCalls",
      "metadataGets",
      "retries",
      "fallbacks",
      "billableCalls",
      "providerQualificationCalls",
      "accountMutations",
      "cloudMutations",
      "deploymentMutations",
      "externalMutations",
      "activation",
      "terminal",
      "observedAt",
      "authorizationDigest",
      "reservationDigest",
    ]) ||
    !exactKeys(result.sanitizedEnvelope, [
      "endpointCapability",
      "httpStatus",
      "callOccurred",
      "urlValid",
      "contentTypeValid",
      "schemaValid",
      "paidCredential",
      "failureClass",
      "responseBodyPersisted",
      "rawHeadersPersisted",
    ]) ||
    authorization.schemaVersion !== "matchbase.slice3-v5-authorization/v1" ||
    reservation.schemaVersion !==
      "matchbase.slice3-v5-key-get-reservation/v1" ||
    result.schemaVersion !== "matchbase.slice3-v5-credential-result/v1" ||
    authorization.authorizationId !== authorizationId ||
    authorization.sessionId !== sessionId ||
    authorization.sourceAttestationDigest !== sourceAttestationDigest ||
    authorization.role2PayloadSha256 !== role2PayloadSha256 ||
    authorization.role2SignatureSha256 !== role2SignatureSha256 ||
    authorization.role2ReplayIdentitySha256 !== role2ReplayIdentitySha256 ||
    authorization.role2KeyId !== role2KeyId ||
    authorization.role2Nonce !== role2Nonce ||
    authorization.authorizationId !== reservation.authorizationId ||
    authorization.sessionId !== reservation.sessionId ||
    !/^[A-F0-9]{64}$/u.test(authorization.sourceAttestationDigest) ||
    !/^[a-f0-9]{40}$/u.test(authorization.repositoryCommit) ||
    !/^[a-f0-9]{40}$/u.test(authorization.repositoryTree) ||
    authorization.originMain !== authorization.repositoryCommit ||
    authorization.maxCredentialGets !== 1 ||
    authorization.modelPosts !== 0 ||
    authorization.searchCalls !== 0 ||
    authorization.activation !== false ||
    reservation.authorizationDigest !== authorizationDigest ||
    reservation.replayRecordSha256 !== replayRecordSha256 ||
    reservation.callNumber !== 1 ||
    reservation.endpoint !== "https://openrouter.ai/api/v1/key" ||
    reservation.method !== "GET" ||
    reservation.retries !== 0 ||
    reservation.fallbacks !== 0 ||
    reservation.redirects !== 0 ||
    reservation.allocationConsumed !== true ||
    reservation.activation !== false ||
    result.authorizationDigest !== authorizationDigest ||
    result.reservationDigest !== reservationDigest ||
    !new Set([
      "BLOCKED_CREDENTIAL",
      "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
    ]).has(result.disposition) ||
    sha256(JSON.stringify(result.sanitizedEnvelope)) !==
      result.sanitizedEnvelopeDigest ||
    result.sanitizedEnvelope.endpointCapability !==
      "OPENROUTER_KEY_STATUS_READ" ||
    result.sanitizedEnvelope.responseBodyPersisted !== false ||
    result.sanitizedEnvelope.rawHeadersPersisted !== false ||
    ![0, 1, null].includes(result.credentialGets) ||
    zeroFields.some((field) => result[field] !== 0) ||
    result.terminal !== true ||
    result.allocationConsumed !== true ||
    result.activation !== false ||
    times.some((time) => !Number.isFinite(time)) ||
    times[0] > times[1] ||
    times[1] > times[2] ||
    !new Set([
      null,
      "HTTP_401",
      "HTTP_403",
      "REDIRECT_RESPONSE",
      "INVALID_200_SCHEMA",
      "OTHER_HTTP_STATUS",
      "CREDENTIAL_READ_OR_PRE_SEND_FAILURE",
      "RESPONSE_REDUCTION_FAILURE",
      "UNKNOWN_TRANSPORT_TIMEOUT_OR_REDIRECT",
    ]).has(result.sanitizedEnvelope.failureClass) ||
    (result.disposition ===
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION"
      ? result.credentialGets !== 1 ||
        result.sanitizedEnvelope.callOccurred !== true ||
        result.sanitizedEnvelope.httpStatus !== 200 ||
        result.sanitizedEnvelope.urlValid !== true ||
        result.sanitizedEnvelope.contentTypeValid !== true ||
        result.sanitizedEnvelope.schemaValid !== true ||
        result.sanitizedEnvelope.paidCredential !== true ||
        result.sanitizedEnvelope.failureClass !== null
      : !blockedTupleValid)
  )
    throw new Error(
      "V5 credential ledger hash chain or terminal state is invalid.",
    );
  return Object.freeze({
    authorization,
    reservation,
    result,
    authorizationDigest,
    reservationDigest,
    resultDigest: sha256(resultBytes),
  });
}

export async function validateOneUseCredentialReservation(
  sessionDirectory,
  { authorizationDigest, reservationDigest },
) {
  const names = (await readdir(sessionDirectory)).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify(["00-authorization.json", "01-key-get-reserved.json"])
  )
    throw new Error("V5 durable one-use reservation file set is invalid.");
  const rootReal = await realpath(sessionDirectory);
  const digests = [];
  for (const name of names) {
    const path = join(sessionDirectory, name);
    const item = await lstat(path);
    const fileReal = await realpath(path);
    const difference = relative(rootReal, fileReal);
    if (
      !item.isFile() ||
      item.isSymbolicLink() ||
      item.nlink !== 1 ||
      !difference ||
      difference.startsWith("..") ||
      resolve(rootReal, difference) !== fileReal
    )
      throw new Error("V5 durable one-use reservation escaped containment.");
    digests.push(sha256(await readFile(fileReal)));
  }
  if (digests[0] !== authorizationDigest || digests[1] !== reservationDigest)
    throw new Error("V5 durable one-use reservation digest drifted.");
  return Object.freeze({ authorizationDigest, reservationDigest });
}
