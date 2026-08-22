import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();

async function regularBytes(path, expected) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw new Error("unsafe regular file");
  const handle = await open(path, "r");
  try {
    const first = await handle.stat();
    const bytes = await readFile(handle);
    const second = await handle.stat();
    const after = await lstat(path);
    if (
      first.dev !== second.dev ||
      first.ino !== second.ino ||
      second.dev !== after.dev ||
      second.ino !== after.ino ||
      second.nlink !== 1 ||
      bytes.length !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    )
      throw new Error("archive byte drift");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function durableNew(path, bytes) {
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v5-archive-"));
  const signing = join(root, "signing");
  const archiveParent = join(signing, "archive");
  const archive = join(archiveParent, "reason");
  const sourcePayload = join(signing, "payload.json");
  const sourceSignature = join(signing, "signature.json");
  const payload = Buffer.from('{"payload":"invalid"}\n', "utf8");
  const signature = Buffer.from('{"signature":"invalid"}\n', "utf8");
  await mkdir(signing);
  await writeFile(sourcePayload, payload, { flag: "wx" });
  await writeFile(sourceSignature, signature, { flag: "wx" });
  return {
    root,
    signing,
    archiveParent,
    archive,
    lock: join(signing, ".archive.lock"),
    audit: join(root, "archive-audit.json"),
    manifest: join(archive, "manifest.json"),
    pair: [
      {
        source: sourcePayload,
        destination: join(archive, "payload.json"),
        bytes: payload.length,
        sha256: sha256(payload),
      },
      {
        source: sourceSignature,
        destination: join(archive, "signature.json"),
        bytes: signature.length,
        sha256: sha256(signature),
      },
    ],
  };
}

async function verifyFixture(
  value,
  { archiveOnly = false, requireAudit = false } = {},
) {
  const archive = await lstat(value.archive);
  if (!archive.isDirectory() || archive.isSymbolicLink())
    throw new Error("unsafe archive root");
  for (const pair of value.pair) {
    if (!archiveOnly) await regularBytes(pair.source, pair);
    await regularBytes(pair.destination, pair);
  }
  const manifest = await regularBytes(value.manifest, value.manifestExpected);
  JSON.parse(manifest.toString("utf8"));
  if (requireAudit) {
    const audit = await lstat(value.audit);
    if (!audit.isFile() || audit.isSymbolicLink() || audit.nlink !== 1)
      throw new Error("archive audit absent or unsafe");
  }
}

async function archiveFixture(value, { beforeCopy, failAfterFirst } = {}) {
  const lock = await open(value.lock, "wx");
  let wrote = false;
  let succeeded = false;
  try {
    const sourceBytes = await Promise.all(
      value.pair.map((pair) => regularBytes(pair.source, pair)),
    );
    if (beforeCopy) await beforeCopy(value);
    for (const pair of value.pair) await regularBytes(pair.source, pair);
    await mkdir(value.archiveParent);
    await mkdir(value.archive);
    for (let index = 0; index < value.pair.length; index += 1) {
      wrote = true;
      await durableNew(value.pair[index].destination, sourceBytes[index]);
      if (failAfterFirst && index === 0) throw new Error("injected crash");
    }
    const manifestBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: "test.archive/v1",
        pair: value.pair.map(({ destination, bytes, sha256 }) => ({
          destination,
          bytes,
          sha256,
        })),
      })}\n`,
      "utf8",
    );
    value.manifestExpected = {
      bytes: manifestBytes.length,
      sha256: sha256(manifestBytes),
    };
    await durableNew(value.manifest, manifestBytes);
    await verifyFixture(value);
    succeeded = true;
  } finally {
    await lock.close();
    if (!wrote || succeeded) await rm(value.lock, { force: true });
  }
}

async function withFixture(run) {
  const value = await fixture();
  try {
    await run(value);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
}

test("production archive CLI is fixed-path, exclusive, durable, and has no test mutator export", async () => {
  const source = await readFile(
    resolve("scripts/archive-slice3-v5-invalid-pair.mjs"),
    "utf8",
  );
  assert.match(source, /process\.argv\.length !== 3/u);
  assert.match(source, /constants\.O_EXCL/u);
  assert.match(source, /constants\.O_SYNC/u);
  assert.match(source, /await handle\.sync\(\)/u);
  assert.doesNotMatch(source, /export\s/u);
  assert.doesNotMatch(source, /process\.env\..*(ROOT|PATH)/u);
  assert.match(source, /verifyArchive\(\{ requireAudit: false \}\)/u);
  assert.match(source, /if \(requireAudit\)/u);
});

test("archive creates exact copies and manifest while preserving sources", async () =>
  withFixture(async (value) => {
    const before = await Promise.all(
      value.pair.map(({ source }) => readFile(source)),
    );
    await archiveFixture(value);
    await verifyFixture(value);
    for (let index = 0; index < value.pair.length; index += 1)
      assert.deepEqual(await readFile(value.pair[index].source), before[index]);
  }));

test("archive creation is noncircular and post-audit verification requires the audit", async () =>
  withFixture(async (value) => {
    await archiveFixture(value);
    await assert.rejects(
      verifyFixture(value, { requireAudit: true }),
      /ENOENT/u,
    );
    await writeFile(value.audit, "{}\n", { flag: "wx" });
    await verifyFixture(value, { requireAudit: true });
  }));

test("preexisting lock, archive root, or destination fails without overwrite", async () => {
  await withFixture(async (value) => {
    await writeFile(value.lock, "held", { flag: "wx" });
    await assert.rejects(archiveFixture(value), /EEXIST/u);
  });
  await withFixture(async (value) => {
    await mkdir(value.archiveParent);
    await mkdir(value.archive);
    await assert.rejects(archiveFixture(value), /EEXIST/u);
  });
  await withFixture(async (value) => {
    await mkdir(value.archiveParent);
    await mkdir(value.archive);
    await writeFile(value.pair[0].destination, "foreign", { flag: "wx" });
    await assert.rejects(archiveFixture(value), /EEXIST/u);
    assert.equal(await readFile(value.pair[0].destination, "utf8"), "foreign");
  });
});

test("source symlink, source hardlink, and destination hardlink fail closed", async () => {
  await withFixture(async (value) => {
    const original = value.pair[0].source;
    await rm(original);
    await symlink(value.pair[1].source, original, "file");
    await assert.rejects(archiveFixture(value), /unsafe regular file/u);
  });
  await withFixture(async (value) => {
    await link(value.pair[0].source, join(value.signing, "second-link"));
    await assert.rejects(archiveFixture(value), /unsafe regular file/u);
  });
  await withFixture(async (value) => {
    await archiveFixture(value);
    await link(value.pair[0].destination, join(value.archive, "second-link"));
    await assert.rejects(verifyFixture(value), /unsafe regular file/u);
  });
});

test("source drift before copy and manifest drift are rejected", async () => {
  await withFixture(async (value) => {
    await assert.rejects(
      archiveFixture(value, {
        beforeCopy: async () =>
          writeFile(value.pair[0].source, "changed", { flag: "w" }),
      }),
      /archive byte drift/u,
    );
  });
  await withFixture(async (value) => {
    await archiveFixture(value);
    await writeFile(value.manifest, "{}\n", { flag: "w" });
    await assert.rejects(verifyFixture(value), /archive byte drift/u);
  });
});

test("verify-only semantics read exact bytes without writes", async () =>
  withFixture(async (value) => {
    await archiveFixture(value);
    const before = await Promise.all(
      [value.manifest, ...value.pair.map(({ destination }) => destination)].map(
        async (path) => ({ path, bytes: await readFile(path) }),
      ),
    );
    await verifyFixture(value);
    const after = await Promise.all(
      before.map(async ({ path }) => readFile(path)),
    );
    assert.deepEqual(
      after,
      before.map(({ bytes }) => bytes),
    );
  }));

test("archive-only verification survives authorized source replacement and still rejects tamper", async () =>
  withFixture(async (value) => {
    await archiveFixture(value);
    for (const pair of value.pair) {
      await rm(pair.source);
      await writeFile(pair.source, "successor", { flag: "wx" });
    }
    await verifyFixture(value, { archiveOnly: true });
    await writeFile(value.pair[0].destination, "tampered", { flag: "w" });
    await assert.rejects(
      verifyFixture(value, { archiveOnly: true }),
      /archive byte drift/u,
    );
  }));

test("partial archive crash is terminal and retains the exclusive lock", async () =>
  withFixture(async (value) => {
    await assert.rejects(
      archiveFixture(value, { failAfterFirst: true }),
      /injected crash/u,
    );
    assert.equal((await lstat(value.lock)).isFile(), true);
    await assert.rejects(archiveFixture(value), /EEXIST/u);
    await assert.rejects(verifyFixture(value));
  }));
