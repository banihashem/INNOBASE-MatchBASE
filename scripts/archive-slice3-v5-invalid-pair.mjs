import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PM_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const SIGNING_ROOT = join(PM_ROOT, ".slice3-v5-signing");
const REASON_CODE = "V5-HOSTED-TIME-BINDING-001";
const INVALID_SESSION_ID = "v5-968A9D69D38203E2E8B1375A";
const INVALID_NONCE = "16C743A6706C922C45383A161D5E9EC7";
const ARCHIVE_ROOT = join(SIGNING_ROOT, "archive", REASON_CODE);
const LOCK_PATH = join(SIGNING_ROOT, `.${REASON_CODE}.archive.lock`);
const AUTHORIZATION = Object.freeze({
  path: join(
    PM_ROOT,
    "ROLE2_V5_SUCCESSOR_AUTHORIZATION_REQUIREMENTS_AFTER_HOSTED_TIME_BINDING_FAILURE.md",
  ),
  bytes: 10_171,
  sha256: "84BE0EADC0E27886B7B13E5211999F1BD2557D435A843C33A7CC1D86368C97FE",
});
const ABORT = Object.freeze({
  path: join(
    PM_ROOT,
    "ROLE2_V5_PRE_SIGN_ABORT_HOSTED_TIME_BINDING_2026-08-22.md",
  ),
  bytes: 2_342,
  sha256: "897F9CC0DE146FE50A8D21D758A8BD212F2740E8F39B3E4C992DBC312BE46DC9",
});
const TERMINAL_AUDIT = Object.freeze({
  path: join(
    PM_ROOT,
    "ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN.md",
  ),
  bytes: 8_847,
  sha256: "D947ED74204868C0AA24DD3C04BABD399062B837C46E2FF8AAB029CBC606610C",
});
const PRELIMINARY_AUDIT_SHA256 =
  "8A4D37EC45D560135110F8FD2A9DDB18408054B000A0FFF9624ADD0AEDEA2C27";
const ARCHIVE_AUDIT = Object.freeze({
  path: join(
    PM_ROOT,
    "ROLE3_SLICE_3_V5_INVALID_PAIR_FORENSIC_ARCHIVE_AUDIT_2026-08-22.json",
  ),
  bytes: 2_053,
  sha256: "9221C3A297DA7BE4D7C9E0CBE0DAD61F72F89B340658AA9687C8F83DE6F46A1D",
});
const PAIR = Object.freeze([
  Object.freeze({
    id: "payload",
    sourcePath: join(
      SIGNING_ROOT,
      "V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION_PAYLOAD.json",
    ),
    archivePath: join(
      ARCHIVE_ROOT,
      `INVALID_SESSION_${INVALID_SESSION_ID}_PAYLOAD.json`,
    ),
    bytes: 13_317,
    sha256: "092DD4345C6C2C773588F138D21584588E29D2CCB1942A2596483CF053DB0CF4",
  }),
  Object.freeze({
    id: "signature",
    sourcePath: join(
      SIGNING_ROOT,
      "V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION_SIGNATURE.json",
    ),
    archivePath: join(
      ARCHIVE_ROOT,
      `INVALID_SESSION_${INVALID_SESSION_ID}_SIGNATURE.json`,
    ),
    bytes: 407,
    sha256: "55AA88224249D105CBC97C0D4EF6828ED32240EC4ABF35D186E1680F29A0D1D0",
  }),
]);
const MANIFEST_PATH = join(
  ARCHIVE_ROOT,
  `INVALID_SESSION_${INVALID_SESSION_ID}_MANIFEST.json`,
);

const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();

function assertExactArgv() {
  if (
    process.argv.length !== 3 ||
    !new Set(["--execute", "--verify"]).has(process.argv[2])
  )
    throw new Error(
      "V5 forensic archive requires exactly --execute or --verify.",
    );
  return process.argv[2];
}

function assertNoWindowsReparse(path) {
  if (process.platform !== "win32")
    throw new Error("V5 forensic archive is restricted to canonical Windows.");
  const command =
    "$item=Get-Item -LiteralPath $env:MATCHBASE_ARCHIVE_CHECK_PATH -Force; " +
    "if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 9}";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      env: { ...process.env, MATCHBASE_ARCHIVE_CHECK_PATH: path },
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error(
      "V5 forensic archive path is reparse-backed or unavailable.",
    );
}

async function assertCanonicalDirectory(path, expectedPath) {
  const item = await lstat(path);
  if (
    !item.isDirectory() ||
    item.isSymbolicLink() ||
    resolve(path) !== expectedPath ||
    (await realpath(path)) !== expectedPath
  )
    throw new Error("V5 forensic archive directory identity is invalid.");
  assertNoWindowsReparse(path);
}

async function checkedRegularBytes(path, expected) {
  const beforePath = await lstat(path);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1 ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error(
      "V5 forensic archive source is not a canonical regular file.",
    );
  assertNoWindowsReparse(path);
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1)
      throw new Error("V5 forensic archive source handle identity is invalid.");
    const bytes = await readFile(handle);
    const after = await handle.stat();
    const afterPath = await lstat(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.dev !== afterPath.dev ||
      after.ino !== afterPath.ino ||
      after.nlink !== 1 ||
      afterPath.nlink !== 1 ||
      bytes.length !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    )
      throw new Error("V5 forensic archive source bytes drifted.");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function durableCreateNew(path, bytes) {
  const handle = await open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_SYNC,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function manifestValue() {
  return {
    schemaVersion: "matchbase.slice3-v5-invalid-signing-pair-archive/v1",
    reasonCode: REASON_CODE,
    invalidSessionId: INVALID_SESSION_ID,
    invalidNonce: INVALID_NONCE,
    authorization: AUTHORIZATION,
    pair: PAIR.map(({ id, sourcePath, archivePath, bytes, sha256 }) => ({
      id,
      sourcePath,
      archivePath,
      bytes,
      sha256,
    })),
    abort: ABORT,
    preliminaryAuditSha256: PRELIMINARY_AUDIT_SHA256,
    terminalAudit: TERMINAL_AUDIT,
    publicSignatureSha256:
      "CA6E1760DD419BFFFE0DCB5EF05C30655785F1C70BBC0983D563346B6CF0829B",
    cryptographicStatus: "VALID_ONLY_FOR_INVALID_ATTEMPTED_PAYLOAD",
    currentSourceAcceptance: "FAIL",
    immutableAfterIndependentAudit: true,
    operationLedger: {
      sourceFilesMutated: 0,
      credentialReads: 0,
      networkSends: 0,
      replayReservations: 0,
      providerCalls: 0,
      externalMutations: 0,
    },
  };
}

async function verifyArchive({ requireAudit = true } = {}) {
  await assertCanonicalDirectory(SIGNING_ROOT, SIGNING_ROOT);
  await assertCanonicalDirectory(dirname(ARCHIVE_ROOT), dirname(ARCHIVE_ROOT));
  await assertCanonicalDirectory(ARCHIVE_ROOT, ARCHIVE_ROOT);
  if (requireAudit)
    await checkedRegularBytes(ARCHIVE_AUDIT.path, ARCHIVE_AUDIT);
  for (const source of PAIR) {
    await checkedRegularBytes(source.archivePath, source);
  }
  const expectedManifest = Buffer.from(
    `${JSON.stringify(manifestValue(), null, 2)}\n`,
    "utf8",
  );
  const manifest = await checkedRegularBytes(MANIFEST_PATH, {
    bytes: expectedManifest.length,
    sha256: sha256(expectedManifest),
  });
  if (!manifest.equals(expectedManifest))
    throw new Error("V5 forensic archive manifest semantics drifted.");
  return Object.freeze({
    archiveRoot: ARCHIVE_ROOT,
    manifestPath: MANIFEST_PATH,
    manifestBytes: manifest.length,
    manifestSha256: sha256(manifest),
  });
}

async function executeArchive() {
  await assertCanonicalDirectory(PM_ROOT, PM_ROOT);
  await assertCanonicalDirectory(SIGNING_ROOT, SIGNING_ROOT);
  const [authorizationBytes, abortBytes, terminalAuditBytes, ...pairBytes] =
    await Promise.all([
      checkedRegularBytes(AUTHORIZATION.path, AUTHORIZATION),
      checkedRegularBytes(ABORT.path, ABORT),
      checkedRegularBytes(TERMINAL_AUDIT.path, TERMINAL_AUDIT),
      ...PAIR.map((source) => checkedRegularBytes(source.sourcePath, source)),
    ]);
  if (
    !authorizationBytes.length ||
    !abortBytes.length ||
    !terminalAuditBytes.length
  )
    throw new Error("V5 forensic archive authority source is empty.");
  const lock = await open(LOCK_PATH, "wx", 0o600);
  let writeStarted = false;
  let succeeded = false;
  try {
    await lock.sync();
    await mkdir(dirname(ARCHIVE_ROOT));
    await assertCanonicalDirectory(
      dirname(ARCHIVE_ROOT),
      dirname(ARCHIVE_ROOT),
    );
    await mkdir(ARCHIVE_ROOT);
    await assertCanonicalDirectory(ARCHIVE_ROOT, ARCHIVE_ROOT);
    for (let index = 0; index < PAIR.length; index += 1) {
      writeStarted = true;
      await durableCreateNew(PAIR[index].archivePath, pairBytes[index]);
      await checkedRegularBytes(PAIR[index].archivePath, PAIR[index]);
    }
    const manifestBytes = Buffer.from(
      `${JSON.stringify(manifestValue(), null, 2)}\n`,
      "utf8",
    );
    await durableCreateNew(MANIFEST_PATH, manifestBytes);
    await checkedRegularBytes(MANIFEST_PATH, {
      bytes: manifestBytes.length,
      sha256: sha256(manifestBytes),
    });
    const result = await verifyArchive({ requireAudit: false });
    succeeded = true;
    return result;
  } catch (error) {
    if (!writeStarted) {
      await lock.close();
      await rm(LOCK_PATH, { force: true });
    }
    throw error;
  } finally {
    if (writeStarted) {
      await lock.close();
      if (succeeded) await rm(LOCK_PATH, { force: true });
    }
  }
}

const mode = assertExactArgv();
const result =
  mode === "--execute" ? await executeArchive() : await verifyArchive();
console.log(
  `slice3 v5 forensic archive: PASS (${result.manifestBytes} bytes; ${result.manifestSha256})`,
);
