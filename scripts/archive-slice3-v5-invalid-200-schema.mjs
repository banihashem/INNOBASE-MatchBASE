import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PM_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const SIGNING_ROOT = join(PM_ROOT, ".slice3-v5-signing");
const STATE_ROOT = join(PM_ROOT, ".slice3-live-qualification-state");
const REPLAY_ROOT = join(PM_ROOT, ".role2-signing-replay-registry");
const REASON_CODE = "V5-INVALID-200-SCHEMA-001";
const SESSION_ID = "v5-53676308BAD073D07FFC88B8";
const NONCE = "B5E913955E9D6F0812DEB32E03771901";
const ARCHIVE_ROOT = join(SIGNING_ROOT, "archive", REASON_CODE);
const LOCK_PATH = join(SIGNING_ROOT, `.${REASON_CODE}.archive.lock`);
const REQUIREMENTS = Object.freeze({
  path: join(
    PM_ROOT,
    "ROLE2_V5_SUCCESSOR_REQUIREMENTS_AFTER_INVALID_200_SCHEMA_V1.md",
  ),
  bytes: 24_178,
  sha256: "A028A2AEFCA11F0002906F7483821C039E9AD82B272DA5235B531A426AC7E98A",
});
const PRE_SIGN_AUDIT = Object.freeze({
  path: join(
    PM_ROOT,
    "ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_3_V5_SUCCESSOR_PRE_SIGN_LOOP_1.md",
  ),
  bytes: 8_810,
  sha256: "3A441F168500E36FEF7B23C56A4974694AC4CD18AFC886DD564C72108FB8D22F",
});

const members = Object.freeze(
  [
    Object.freeze({
      id: "payload",
      sourcePath: join(
        SIGNING_ROOT,
        "V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION_PAYLOAD.json",
      ),
      archiveName: `CONSUMED_SESSION_${SESSION_ID}_PAYLOAD.json`,
      bytes: 13_886,
      sha256:
        "1B1BF7632DFCE078E3ED04D4AC8872C90CC2CF5EB88E8EAC16E0B2F09DF1888C",
    }),
    Object.freeze({
      id: "signature",
      sourcePath: join(
        SIGNING_ROOT,
        "V5_OPENROUTER_CREDENTIAL_GET_AUTHORIZATION_SIGNATURE.json",
      ),
      archiveName: `CONSUMED_SESSION_${SESSION_ID}_SIGNATURE.json`,
      bytes: 407,
      sha256:
        "557C7BC34DDBAF0258446F2F88AEABB832B43233AFEA8FDA3994F8CDE567BBC0",
    }),
    Object.freeze({
      id: "authorization",
      sourcePath: join(STATE_ROOT, SESSION_ID, "00-authorization.json"),
      archiveName: `CONSUMED_SESSION_${SESSION_ID}_00_AUTHORIZATION.json`,
      bytes: 923,
      sha256:
        "0C18263EACD3DBB28F4E9D8A9CF93B670BF4CC0A9D1486AB23BB66AC078AB3C2",
    }),
    Object.freeze({
      id: "reservation",
      sourcePath: join(STATE_ROOT, SESSION_ID, "01-key-get-reserved.json"),
      archiveName: `CONSUMED_SESSION_${SESSION_ID}_01_KEY_GET_RESERVED.json`,
      bytes: 538,
      sha256:
        "0BDE7D0E0EF168B2799B6A9B62D8AE083DA1BB70F8D5EB7647B2EE5ED0B82F5B",
    }),
    Object.freeze({
      id: "result",
      sourcePath: join(STATE_ROOT, SESSION_ID, "02-key-get-result.json"),
      archiveName: `CONSUMED_SESSION_${SESSION_ID}_02_KEY_GET_RESULT.json`,
      bytes: 975,
      sha256:
        "9A15DB8E2EC0EACB4A12B42DD9E12EF59DA85002BC186CB1DA2F256B7EFDE07B",
    }),
    Object.freeze({
      id: "replayRegistry",
      sourcePath: join(REPLAY_ROOT, "consumed-v5.jsonl"),
      archiveName: "REPLAY_REGISTRY_AFTER_V4_CONSUMPTION.jsonl",
      bytes: 671,
      sha256:
        "E28CE25E057EFF410BDCD0812CFC3E43BD6ECBE520DBC07FE1C31BAFA4057A87",
    }),
  ].map((member) =>
    Object.freeze({
      ...member,
      archivePath: join(ARCHIVE_ROOT, member.archiveName),
    }),
  ),
);

const MANIFEST_PATH = join(
  ARCHIVE_ROOT,
  `CONSUMED_SESSION_${SESSION_ID}_MANIFEST.json`,
);

const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();

function exactArgs() {
  if (
    process.argv.length !== 3 ||
    !new Set(["--execute", "--verify-pre-audit"]).has(process.argv[2])
  )
    throw new Error(
      "V5 invalid-200 archive requires exactly --execute or --verify-pre-audit.",
    );
  return process.argv[2];
}

function assertNoWindowsReparse(path) {
  if (process.platform !== "win32")
    throw new Error("V5 invalid-200 archive is canonical-Windows only.");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$i=Get-Item -LiteralPath $env:MATCHBASE_ARCHIVE_PATH -Force; if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 9}",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, MATCHBASE_ARCHIVE_PATH: path },
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error("V5 invalid-200 archive path is reparse-backed.");
}

async function assertDirectory(path, expected = path) {
  const item = await lstat(path);
  if (
    !item.isDirectory() ||
    item.isSymbolicLink() ||
    resolve(path) !== expected ||
    (await realpath(path)) !== expected
  )
    throw new Error("V5 invalid-200 archive directory identity failed.");
  assertNoWindowsReparse(path);
}

async function checkedBytes(path, expected) {
  const pathBefore = await lstat(path);
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== 1 ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error("V5 invalid-200 archive requires a checked regular file.");
  assertNoWindowsReparse(path);
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    const bytes = await readFile(handle);
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.nlink !== 1 ||
      pathAfter.nlink !== 1 ||
      bytes.length !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    )
      throw new Error("V5 invalid-200 archive source bytes drifted.");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function createDurable(path, bytes) {
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
    schemaVersion: "matchbase.slice3-v5-consumed-terminal-archive/v1",
    reasonCode: REASON_CODE,
    sessionId: SESSION_ID,
    nonce: NONCE,
    decisionId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET",
    requirements: REQUIREMENTS,
    preSignAudit: PRE_SIGN_AUDIT,
    members: members.map(
      ({ id, sourcePath, archivePath, bytes, sha256: digest }) => ({
        id,
        sourcePath,
        archivePath,
        bytes,
        sha256: digest,
      }),
    ),
    detachedAuthorization: {
      publicSignatureSha256:
        "05C137125D5AEAF7574C0AD7EC772AE9E637772AC5706CC51A93AE3A04C8538B",
      replayIdentitySha256:
        "E57C1E18C286322D04D9B242DA51445A764AA77793EDAFC3AED1C950F1E4A857",
    },
    terminalResult: {
      disposition: "BLOCKED_CREDENTIAL",
      httpStatus: 200,
      failureClass: "INVALID_200_SCHEMA",
      sanitizedEnvelopeSha256:
        "6C2C5193549E6D23674B219AE186113AB18419013CA153CBF05C14855340FF39",
      allocationConsumed: true,
      credentialGets: 1,
      modelPosts: 0,
      searchCalls: 0,
      billableCalls: 0,
      providerQualificationCalls: 0,
      metadataGets: 0,
      rawResponseBodyPersisted: false,
      rawHeadersPersisted: false,
      externalMutations: 0,
      activation: false,
      terminal: true,
    },
    replayState: {
      bytes: 671,
      sha256:
        "E28CE25E057EFF410BDCD0812CFC3E43BD6ECBE520DBC07FE1C31BAFA4057A87",
      recordCount: 1,
      lastSequence: 1,
      recordSha256:
        "D1D0EE0DE2A545D0395427565EB154E0F7B70D93265BF42C3E013D8A705765EB",
      previousRecordSha256: null,
    },
    sourceFilesMutated: 0,
    credentialReads: 0,
    networkSends: 0,
    providerCalls: 0,
    replayAppends: 0,
    externalMutations: 0,
    immutableAfterIndependentAudit: true,
  };
}

async function verifyPreAudit() {
  await assertDirectory(SIGNING_ROOT, SIGNING_ROOT);
  await assertDirectory(dirname(ARCHIVE_ROOT), dirname(ARCHIVE_ROOT));
  await assertDirectory(ARCHIVE_ROOT, ARCHIVE_ROOT);
  for (const member of members) await checkedBytes(member.archivePath, member);
  const expected = Buffer.from(
    `${JSON.stringify(manifestValue(), null, 2)}\n`,
    "utf8",
  );
  const manifest = await checkedBytes(MANIFEST_PATH, {
    bytes: expected.length,
    sha256: sha256(expected),
  });
  if (!manifest.equals(expected))
    throw new Error("V5 invalid-200 archive manifest semantics drifted.");
  return Object.freeze({
    archiveRoot: ARCHIVE_ROOT,
    manifestPath: MANIFEST_PATH,
    manifestBytes: manifest.length,
    manifestSha256: sha256(manifest),
  });
}

async function executeArchive() {
  await Promise.all([
    assertDirectory(PM_ROOT, PM_ROOT),
    assertDirectory(SIGNING_ROOT, SIGNING_ROOT),
    assertDirectory(dirname(ARCHIVE_ROOT), dirname(ARCHIVE_ROOT)),
    assertDirectory(STATE_ROOT, STATE_ROOT),
    assertDirectory(join(STATE_ROOT, SESSION_ID), join(STATE_ROOT, SESSION_ID)),
    assertDirectory(REPLAY_ROOT, REPLAY_ROOT),
  ]);
  const authority = await Promise.all([
    checkedBytes(REQUIREMENTS.path, REQUIREMENTS),
    checkedBytes(PRE_SIGN_AUDIT.path, PRE_SIGN_AUDIT),
  ]);
  if (authority.some((bytes) => bytes.length === 0))
    throw new Error("V5 invalid-200 archive authority is empty.");
  const sourceBytes = await Promise.all(
    members.map((member) => checkedBytes(member.sourcePath, member)),
  );
  const lock = await open(LOCK_PATH, "wx", 0o600);
  let writeStarted = false;
  let completed = false;
  try {
    await lock.sync();
    await mkdir(ARCHIVE_ROOT);
    await assertDirectory(ARCHIVE_ROOT, ARCHIVE_ROOT);
    for (let index = 0; index < members.length; index += 1) {
      writeStarted = true;
      await createDurable(members[index].archivePath, sourceBytes[index]);
      await checkedBytes(members[index].archivePath, members[index]);
    }
    const manifest = Buffer.from(
      `${JSON.stringify(manifestValue(), null, 2)}\n`,
      "utf8",
    );
    await createDurable(MANIFEST_PATH, manifest);
    await checkedBytes(MANIFEST_PATH, {
      bytes: manifest.length,
      sha256: sha256(manifest),
    });
    const result = await verifyPreAudit();
    completed = true;
    return result;
  } catch (error) {
    if (!writeStarted) await rm(LOCK_PATH, { force: true });
    throw error;
  } finally {
    await lock.close();
    if (completed) await rm(LOCK_PATH, { force: true });
  }
}

const mode = exactArgs();
const result =
  mode === "--execute" ? await executeArchive() : await verifyPreAudit();
process.stdout.write(
  `${JSON.stringify({ status: "PASS_PRE_AUDIT", ...result })}\n`,
);
