import { verify } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  rfc8785Canonicalize,
  sha256,
  validateV5Role2Envelope,
  V5_TPM_CONTRACT,
} from "./slice3-v5-role2-tpm-verifier.mjs";
import {
  loadCurrentPinnedV5Acceptance,
  verifyCurrentPinnedV5UnsignedPayload,
} from "./slice3-v5-role2-source-binding.mjs";

const P256_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);
const P256_HALF_ORDER = P256_ORDER / 2n;
const SIGNATURE_DOMAIN = Buffer.from(
  "INNOBASE-MATCHBASE\0ROLE2\0PO-001-S3-V5-CREDENTIAL-GET-S3\0ECDSA-P256-SHA256\0V1\0",
  "utf8",
);
const POWERSHELL_PATH =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const POWERSHELL_SHA256 =
  "7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5";
const ATTEMPT_PARENT =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-v5-signing-attempts";
const DEFAULT_ATTEMPT_ROOT = join(ATTEMPT_PARENT, V5_TPM_CONTRACT.sessionId);
const OUTPUT_LIMIT = 4_096;
const TIMEOUT_MS = 120_000;

const canonicalUtcSecond = (ms) =>
  new Date(Math.floor(ms / 1_000) * 1_000).toISOString().replace(".000Z", "Z");

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function durableExclusiveJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const handle = await open(path, "wx", 0o600);
  let handleItem;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    handleItem = await handle.stat();
  } finally {
    await handle.close();
  }
  await assertSameRegularPath(path, handleItem);
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

async function assertSameRegularPath(path, handleItem) {
  const pathItem = await lstat(path);
  if (
    !handleItem?.isFile() ||
    handleItem.nlink !== 1 ||
    !pathItem.isFile() ||
    pathItem.isSymbolicLink() ||
    pathItem.nlink !== 1 ||
    handleItem.dev !== pathItem.dev ||
    handleItem.ino !== pathItem.ino
  )
    throw new Error("S3 signer evidence path identity drifted.");
}

async function checkedCanonicalDirectory(path) {
  const item = await lstat(path);
  if (
    !item.isDirectory() ||
    item.isSymbolicLink() ||
    resolve(path) !== path ||
    (await realpath(path)) !== path
  )
    throw new Error("S3 signer directory identity is invalid.");
}

async function establishAttemptRoot(attemptRoot) {
  if (
    attemptRoot !== DEFAULT_ATTEMPT_ROOT ||
    dirname(attemptRoot) !== ATTEMPT_PARENT
  )
    throw new Error("S3 signer attempt path is not the governed identity.");
  try {
    await mkdir(ATTEMPT_PARENT, { recursive: false });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await checkedCanonicalDirectory(ATTEMPT_PARENT);
  await mkdir(attemptRoot, { recursive: false });
  await checkedCanonicalDirectory(attemptRoot);
}

async function verifyPinnedPowerShell() {
  const item = await lstat(POWERSHELL_PATH);
  if (
    !item.isFile() ||
    item.isSymbolicLink() ||
    resolve(POWERSHELL_PATH) !== POWERSHELL_PATH ||
    (await realpath(POWERSHELL_PATH)) !== POWERSHELL_PATH ||
    sha256(await readFile(POWERSHELL_PATH)) !== POWERSHELL_SHA256
  )
    throw new Error("S3 signer PowerShell identity drifted.");
}

function lowS(signature) {
  if (!Buffer.isBuffer(signature) || signature.length !== 64)
    throw new Error("S3 signer output is not a 64-byte P1363 signature.");
  const normalized = Buffer.from(signature);
  const r = BigInt(`0x${normalized.subarray(0, 32).toString("hex")}`);
  let s = BigInt(`0x${normalized.subarray(32).toString("hex")}`);
  if (r <= 0n || r >= P256_ORDER || s <= 0n || s >= P256_ORDER)
    throw new Error("S3 signer output contains an invalid P-256 scalar.");
  if (s > P256_HALF_ORDER) s = P256_ORDER - s;
  Buffer.from(s.toString(16).padStart(64, "0"), "hex").copy(normalized, 32);
  return normalized;
}

function signerArguments(payloadBytes, certificateBytes) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$payload=[Convert]::FromBase64String($args[0])",
    "$cerBytes=[Convert]::FromBase64String($args[1])",
    "$cer=[Security.Cryptography.X509Certificates.X509Certificate2]::new($cerBytes)",
    "$cert=Get-Item -LiteralPath ('Cert:\\CurrentUser\\My\\'+$cer.Thumbprint)",
    "$key=[Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($cert)",
    "$z=[char]0",
    "$domain=[Text.Encoding]::UTF8.GetBytes('INNOBASE-MATCHBASE'+$z+'ROLE2'+$z+'PO-001-S3-V5-CREDENTIAL-GET-S3'+$z+'ECDSA-P256-SHA256'+$z+'V1'+$z)",
    "$message=[byte[]]::new($domain.Length+$payload.Length)",
    "[Array]::Copy($domain,0,$message,0,$domain.Length)",
    "[Array]::Copy($payload,0,$message,$domain.Length,$payload.Length)",
    "try{$sig=$key.SignData($message,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.DSASignatureFormat]::IeeeP1363FixedFieldConcatenation)}finally{$key.Dispose();$cert.Dispose();$cer.Dispose()}",
    "$out=[Convert]::ToBase64String($sig).TrimEnd('=').Replace('+','-').Replace('/','_')",
    "[Console]::Out.Write($out)",
  ].join(";");
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
    payloadBytes.toString("base64"),
    certificateBytes.toString("base64"),
  ];
}

function captureBounded(stream, handle, onOverflow) {
  let byteLength = 0;
  let overflow = false;
  let writes = Promise.resolve();
  stream.on("data", (chunk) => {
    const bytes = Buffer.from(chunk);
    const remaining = Math.max(0, OUTPUT_LIMIT - byteLength);
    const retained = bytes.subarray(0, remaining);
    byteLength += retained.length;
    if (retained.length) writes = writes.then(() => handle.write(retained));
    if (bytes.length > remaining && !overflow) {
      overflow = true;
      onOverflow();
    }
  });
  return new Promise((resolveCapture, rejectCapture) => {
    stream.once("error", rejectCapture);
    stream.once("end", () =>
      writes.then(
        () => resolveCapture({ byteLength, overflow }),
        rejectCapture,
      ),
    );
  });
}

async function runBoundedChild({
  executable = POWERSHELL_PATH,
  args,
  cwd = dirname(V5_TPM_CONTRACT.payloadPath),
  timeoutMs = TIMEOUT_MS,
  stdoutHandle,
  stderrHandle,
  onSpawn = async () => {},
}) {
  let processError = null;
  let timedOut = false;
  let overflow = false;
  let killRequested = false;
  const child = spawn(executable, args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.once("error", (error) => {
    processError = error;
  });
  const requestKill = () => {
    killRequested = true;
    child.kill();
  };
  const stdoutCapture = captureBounded(child.stdout, stdoutHandle, () => {
    overflow = true;
    requestKill();
  });
  const stderrCapture = captureBounded(child.stderr, stderrHandle, () => {
    overflow = true;
    requestKill();
  });
  const timer = setTimeout(() => {
    timedOut = true;
    requestKill();
  }, timeoutMs);
  const closePromise = new Promise((resolveClose) => {
    child.once("close", (exitCode, signal) =>
      resolveClose({ exitCode, signal }),
    );
  });
  try {
    if (Number.isSafeInteger(child.pid))
      await onSpawn(
        Object.freeze({
          processId: child.pid,
          executable,
          executableSha256:
            executable === POWERSHELL_PATH ? POWERSHELL_SHA256 : null,
        }),
      );
  } catch (error) {
    requestKill();
    await closePromise;
    clearTimeout(timer);
    await Promise.all([stdoutCapture, stderrCapture]);
    await Promise.all([stdoutHandle.sync(), stderrHandle.sync()]);
    throw error;
  }
  const closed = await closePromise;
  clearTimeout(timer);
  const [stdout, stderr] = await Promise.all([stdoutCapture, stderrCapture]);
  await Promise.all([stdoutHandle.sync(), stderrHandle.sync()]);
  return Object.freeze({
    ...closed,
    processError: processError?.name ?? null,
    processId: Number.isSafeInteger(child.pid) ? child.pid : null,
    timedOut,
    overflow: overflow || stdout.overflow || stderr.overflow,
    killRequested,
    stdoutBytes: stdout.byteLength,
    stderrBytes: stderr.byteLength,
  });
}

async function atomicPublishEnvelope(envelopePath, envelopeBytes) {
  const temporary = `${envelopePath}.S3-COMPLETE-TEMP`;
  const tempHandle = await open(temporary, "wx", 0o600);
  try {
    await tempHandle.writeFile(envelopeBytes);
    await tempHandle.sync();
  } finally {
    await tempHandle.close();
  }
  try {
    await link(temporary, envelopePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  const published = await lstat(envelopePath);
  if (
    !published.isFile() ||
    published.isSymbolicLink() ||
    published.nlink !== 1
  )
    throw new Error("S3 published envelope path identity is invalid.");
}

async function verifyAndRecordPublishedPair({
  verificationPath,
  before,
  envelopeBytes,
  now,
  loadSigned = loadCurrentPinnedV5Acceptance,
}) {
  const signed = await loadSigned({ nowMs: now() });
  if (
    !signed ||
    signed.payloadSha256 !== before.payloadSha256 ||
    !signed.payloadBytes.equals(before.payloadBytes) ||
    signed.envelopeSha256 !== sha256(envelopeBytes) ||
    !signed.envelopeBytes.equals(envelopeBytes)
  )
    throw new Error(
      "S3 published pair failed exact signed-loader verification.",
    );
  await durableExclusiveJson(verificationPath, {
    schemaVersion: "matchbase.slice3-v5-s3-published-pair-verification/v1",
    status: "PASS",
    observedAt: canonicalUtcSecond(now()),
    payloadBytes: before.payloadBytes.length,
    payloadSha256: before.payloadSha256,
    envelopeBytes: envelopeBytes.length,
    envelopeSha256: sha256(envelopeBytes),
    replayIdentitySha256: signed.replayIdentitySha256,
    signatureSha256: signed.signatureSha256,
    fullSignedLoader: true,
  });
  return signed;
}

function assertSameUnsignedInputs(before, after) {
  if (
    after.payloadSha256 !== before.payloadSha256 ||
    !after.publicKeyPem.equals(before.publicKeyPem) ||
    !after.certificateBytes.equals(before.certificateBytes)
  )
    throw new Error(
      "S3 signer input or public identity drifted before publish.",
    );
}

export async function runDurableV5TpmSigning({ now = Date.now } = {}) {
  if (!(await absent(V5_TPM_CONTRACT.envelopePath)))
    throw new Error(
      "S3 envelope already exists; signing is terminally blocked.",
    );
  await verifyPinnedPowerShell();
  const before = await verifyCurrentPinnedV5UnsignedPayload({ nowMs: now() });
  await establishAttemptRoot(DEFAULT_ATTEMPT_ROOT);
  const stdoutPath = join(DEFAULT_ATTEMPT_ROOT, "stdout.bin");
  const stderrPath = join(DEFAULT_ATTEMPT_ROOT, "stderr.bin");
  const startPath = join(DEFAULT_ATTEMPT_ROOT, "attempt-start.json");
  const invocationPath = join(DEFAULT_ATTEMPT_ROOT, "attempt-invocation.json");
  const childStartPath = join(DEFAULT_ATTEMPT_ROOT, "child-start.json");
  const pairVerificationPath = join(
    DEFAULT_ATTEMPT_ROOT,
    "published-pair-verification.json",
  );
  const resultPath = join(DEFAULT_ATTEMPT_ROOT, "attempt-result.json");
  const startedAt = canonicalUtcSecond(now());
  let stdoutHandle;
  let stderrHandle;
  let terminal = null;
  let terminalReason = "SETUP_FAILURE";
  let invocationCount = 0;
  try {
    await durableExclusiveJson(startPath, {
      schemaVersion: "matchbase.slice3-v5-s3-tpm-signing-attempt/v1",
      decisionId: V5_TPM_CONTRACT.decisionId,
      sessionId: V5_TPM_CONTRACT.sessionId,
      nonce: V5_TPM_CONTRACT.nonce,
      payloadSha256: before.payloadSha256,
      startedAt,
      executablePath: POWERSHELL_PATH,
      executableSha256: POWERSHELL_SHA256,
      signatureDomainSha256: sha256(SIGNATURE_DOMAIN),
      invocationCount: 0,
      allocationConsumed: true,
    });
    stdoutHandle = await open(stdoutPath, "wx", 0o600);
    stderrHandle = await open(stderrPath, "wx", 0o600);
    await Promise.all([
      assertSameRegularPath(stdoutPath, await stdoutHandle.stat()),
      assertSameRegularPath(stderrPath, await stderrHandle.stat()),
    ]);
    await durableExclusiveJson(invocationPath, {
      schemaVersion: "matchbase.slice3-v5-s3-tpm-signing-invocation/v1",
      startedAt: canonicalUtcSecond(now()),
      executablePath: POWERSHELL_PATH,
      executableSha256: POWERSHELL_SHA256,
      invocationCount: 1,
    });
    invocationCount = 1;
    terminalReason = "PROCESS_FAILURE";
    terminal = await runBoundedChild({
      args: signerArguments(before.payloadBytes, before.certificateBytes),
      stdoutHandle,
      stderrHandle,
      onSpawn: async (childIdentity) => {
        await durableExclusiveJson(childStartPath, {
          schemaVersion: "matchbase.slice3-v5-s3-tpm-child-start/v1",
          observedAt: canonicalUtcSecond(now()),
          ...childIdentity,
          invocationCount: 1,
        });
      },
    });
    await Promise.all([
      assertSameRegularPath(stdoutPath, await stdoutHandle.stat()),
      assertSameRegularPath(stderrPath, await stderrHandle.stat()),
    ]);
    await Promise.all([stdoutHandle.close(), stderrHandle.close()]);
    stdoutHandle = null;
    stderrHandle = null;
    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath),
      readFile(stderrPath),
    ]);
    if (terminal.processError) terminalReason = "SPAWN_FAILURE";
    if (
      terminal.processError ||
      terminal.timedOut ||
      terminal.overflow ||
      terminal.exitCode !== 0 ||
      stderr.length !== 0
    )
      throw new Error("S3 TPM signing child did not terminate cleanly.");
    terminalReason = "OUTPUT_FAILURE";
    const encoded = stdout.toString("ascii");
    if (!/^[A-Za-z0-9_-]{86}$/u.test(encoded))
      throw new Error("S3 TPM signing stdout is not one canonical signature.");
    const signature = lowS(Buffer.from(encoded, "base64url"));
    if (
      !verify(
        "sha256",
        Buffer.concat([SIGNATURE_DOMAIN, before.payloadBytes]),
        { key: before.publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      )
    )
      throw new Error("S3 TPM signature failed pinned-key verification.");
    terminalReason = "PRE_PUBLISH_DRIFT";
    await verifyPinnedPowerShell();
    const after = await verifyCurrentPinnedV5UnsignedPayload({ nowMs: now() });
    assertSameUnsignedInputs(before, after);
    const replayIdentitySha256 = sha256(
      Buffer.from(rfc8785Canonicalize(before.payload.replayIdentity), "utf8"),
    );
    const envelope = {
      payloadSha256: before.payloadSha256,
      replayIdentitySha256,
      schemaVersion: "matchbase.role2-detached-signature/v6",
      sessionId: V5_TPM_CONTRACT.sessionId,
      signature: signature.toString("base64url"),
      signedAt: before.payload.issuedAt,
    };
    validateV5Role2Envelope(envelope, before.payload, before.payloadSha256);
    const envelopeBytes = Buffer.from(rfc8785Canonicalize(envelope), "utf8");
    terminalReason = "PUBLISH_FAILURE";
    await atomicPublishEnvelope(V5_TPM_CONTRACT.envelopePath, envelopeBytes);
    terminalReason = "POST_PUBLISH_PAIR_VERIFICATION_FAILURE";
    await verifyAndRecordPublishedPair({
      verificationPath: pairVerificationPath,
      before,
      envelopeBytes,
      now,
    });
    terminalReason = "RESULT_RECORD_FAILURE";
    await durableExclusiveJson(resultPath, {
      schemaVersion: "matchbase.slice3-v5-s3-tpm-signing-result/v1",
      status: "PUBLISHED",
      reason: null,
      startedAt,
      endedAt: canonicalUtcSecond(now()),
      process: terminal,
      payloadSha256: before.payloadSha256,
      envelopeBytes: envelopeBytes.length,
      envelopeSha256: sha256(envelopeBytes),
      signatureSha256: sha256(signature),
      allocationConsumed: true,
      invocationCount,
    });
    return Object.freeze({
      envelopeBytes: envelopeBytes.length,
      envelopeSha256: sha256(envelopeBytes),
      signatureSha256: sha256(signature),
      attemptRoot: DEFAULT_ATTEMPT_ROOT,
    });
  } catch (error) {
    if (stdoutHandle) await stdoutHandle.sync().catch(() => {});
    if (stderrHandle) await stderrHandle.sync().catch(() => {});
    await Promise.all([
      stdoutHandle?.close().catch(() => {}),
      stderrHandle?.close().catch(() => {}),
    ]);
    await durableExclusiveJson(resultPath, {
      schemaVersion: "matchbase.slice3-v5-s3-tpm-signing-result/v1",
      status: "TERMINAL_FAILURE",
      reason: terminalReason,
      errorName: error?.name ?? "Error",
      startedAt,
      endedAt: canonicalUtcSecond(now()),
      process: terminal,
      payloadSha256: before.payloadSha256,
      envelopePresent: !(await absent(V5_TPM_CONTRACT.envelopePath)),
      allocationConsumed: true,
      invocationCount,
    }).catch(() => {});
    throw error;
  }
}

export const S3_DURABLE_SIGNER_TEST_SURFACE = Object.freeze({
  outputLimit: OUTPUT_LIMIT,
  powershellPath: POWERSHELL_PATH,
  powershellSha256: POWERSHELL_SHA256,
  attemptParent: ATTEMPT_PARENT,
  attemptRoot: DEFAULT_ATTEMPT_ROOT,
  signatureDomainSha256: sha256(SIGNATURE_DOMAIN),
});

export async function __testOnlyRunBoundedChild({
  executable,
  args,
  cwd,
  timeoutMs,
  outputRoot,
  onSpawn,
}) {
  const stdoutPath = join(outputRoot, "stdout.bin");
  const stderrPath = join(outputRoot, "stderr.bin");
  const stdoutHandle = await open(stdoutPath, "wx", 0o600);
  const stderrHandle = await open(stderrPath, "wx", 0o600);
  try {
    const terminal = await runBoundedChild({
      executable,
      args,
      cwd,
      timeoutMs,
      stdoutHandle,
      stderrHandle,
      onSpawn,
    });
    return Object.freeze({
      terminal,
      stdout: await readFile(stdoutPath),
      stderr: await readFile(stderrPath),
    });
  } finally {
    await Promise.all([
      stdoutHandle.close().catch(() => {}),
      stderrHandle.close().catch(() => {}),
    ]);
  }
}

export function __testOnlyNormalizeAndVerifyP1363({
  signature,
  message,
  publicKey,
}) {
  const normalized = lowS(signature);
  if (
    !verify(
      "sha256",
      message,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      normalized,
    )
  )
    throw new Error("S3 test signature verification failed.");
  return normalized;
}

export async function __testOnlyAtomicPublishEnvelope(path, bytes) {
  await atomicPublishEnvelope(path, bytes);
}

export function __testOnlyAssertSameUnsignedInputs(before, after) {
  assertSameUnsignedInputs(before, after);
}

export async function __testOnlyWriteTerminalEvidence(path, value) {
  return durableExclusiveJson(path, value);
}

export async function __testOnlyVerifyAndRecordPublishedPair(input) {
  return verifyAndRecordPublishedPair(input);
}
