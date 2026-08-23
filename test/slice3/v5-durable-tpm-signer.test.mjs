import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  __testOnlyAtomicPublishEnvelope,
  __testOnlyAssertSameUnsignedInputs,
  __testOnlyNormalizeAndVerifyP1363,
  __testOnlyRunBoundedChild,
  __testOnlyVerifyAndRecordPublishedPair,
  __testOnlyWriteTerminalEvidence,
  S3_DURABLE_SIGNER_TEST_SURFACE,
} from "../../scripts/lib/slice3-v5-durable-tpm-signer.mjs";
import {
  sha256,
  V5_TPM_CONTRACT,
} from "../../scripts/lib/slice3-v5-role2-tpm-verifier.mjs";

const signerSource = await readFile(
  "scripts/lib/slice3-v5-durable-tpm-signer.mjs",
  "utf8",
);
const bindingSource = await readFile(
  "scripts/lib/slice3-v5-role2-source-binding.mjs",
  "utf8",
);
const cliSource = await readFile(
  "scripts/sign-slice3-v5-s3-durable.mjs",
  "utf8",
);

test("S3 durable signer fixes the exact S3 identity and signature domain", () => {
  assert.equal(
    V5_TPM_CONTRACT.decisionId,
    "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S3",
  );
  assert.equal(V5_TPM_CONTRACT.sessionId, "v5-DFF5A5718703A502AAF5EA9C");
  assert.match(signerSource, /PO-001-S3-V5-CREDENTIAL-GET-S3/u);
  assert.equal(
    S3_DURABLE_SIGNER_TEST_SURFACE.attemptRoot.endsWith(
      V5_TPM_CONTRACT.sessionId,
    ),
    true,
  );
});

test("full unsigned source, repo, replay, state, and public materials are revalidated twice", () => {
  assert.equal(
    signerSource.match(/verifyCurrentPinnedV5UnsignedPayload\(/gu)?.length,
    2,
  );
  assert.match(bindingSource, /verifyPinnedV5PublicMaterials\(\)/u);
  assert.match(bindingSource, /verifyGovernanceSources\(payload\)/u);
  assert.match(bindingSource, /verifyAuthoritativeSourceSet/u);
  assert.match(bindingSource, /verifyCandidate\(payload\)/u);
  assert.match(bindingSource, /originMain !== head/u);
  assert.match(bindingSource, /inspectCanonicalV5ReplayRegistry/u);
  assert.match(
    bindingSource,
    /unsigned payload replay or state precondition drifted/u,
  );
});

test("PowerShell identity is absolute, hash-pinned, and never PATH-resolved", () => {
  assert.equal(
    S3_DURABLE_SIGNER_TEST_SURFACE.powershellPath,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.match(
    S3_DURABLE_SIGNER_TEST_SURFACE.powershellSha256,
    /^[A-F0-9]{64}$/u,
  );
  assert.match(
    signerSource,
    /sha256\(await readFile\(POWERSHELL_PATH\)\) !== POWERSHELL_SHA256/u,
  );
  assert.doesNotMatch(signerSource, /command = "pwsh"|spawn\("pwsh"/u);
});

test("PowerShell receives in-memory payload and CER bytes rather than reopening mutable paths", () => {
  assert.match(signerSource, /payloadBytes\.toString\("base64"\)/u);
  assert.match(signerSource, /certificateBytes\.toString\("base64"\)/u);
  assert.match(signerSource, /FromBase64String\(\$args\[0\]\)/u);
  assert.match(signerSource, /FromBase64String\(\$args\[1\]\)/u);
  assert.doesNotMatch(signerSource, /ReadAllBytes\('\$\{payloadPath/u);
});

test("bounded stdout and stderr capture kills on overflow before retaining beyond 4096", () => {
  assert.equal(S3_DURABLE_SIGNER_TEST_SURFACE.outputLimit, 4_096);
  assert.match(signerSource, /Math\.max\(0, OUTPUT_LIMIT - byteLength\)/u);
  assert.match(signerSource, /bytes\.subarray\(0, remaining\)/u);
  assert.match(signerSource, /if \(bytes\.length > remaining && !overflow\)/u);
  assert.match(signerSource, /onOverflow\(\)/u);
  assert.match(signerSource, /child\.kill\(\)/u);
});

test("signing retains the child through close and syncs both output files", () => {
  assert.match(signerSource, /child\.once\("close"/u);
  assert.match(
    signerSource,
    /await Promise\.all\(\[stdoutHandle\.sync\(\), stderrHandle\.sync\(\)\]\)/u,
  );
  assert.match(signerSource, /timedOut = true/u);
  assert.match(signerSource, /killRequested/u);
});

test("attempt root is exact, exclusive, canonical, and non-reparse", () => {
  assert.match(signerSource, /attemptRoot !== DEFAULT_ATTEMPT_ROOT/u);
  assert.match(signerSource, /mkdir\(attemptRoot, \{ recursive: false \}\)/u);
  assert.match(signerSource, /item\.isSymbolicLink\(\)/u);
  assert.match(signerSource, /await realpath\(path\)\) !== path/u);
});

test("attempt and terminal result evidence are exclusive and durable", () => {
  assert.match(signerSource, /open\(path, "wx", 0o600\)/u);
  assert.match(signerSource, /await handle\.sync\(\)/u);
  assert.match(signerSource, /attempt-start\.json/u);
  assert.match(signerSource, /attempt-result\.json/u);
  assert.match(signerSource, /attempt-invocation\.json/u);
  assert.match(signerSource, /child-start\.json/u);
  assert.match(signerSource, /published-pair-verification\.json/u);
  assert.match(signerSource, /invocationCount: 0/u);
  assert.match(signerSource, /invocationCount = 1/u);
  assert.match(signerSource, /handleItem\.nlink !== 1/u);
  assert.match(signerSource, /status: "TERMINAL_FAILURE"/u);
  assert.match(signerSource, /status: "PUBLISHED"/u);
});

test("envelope publication is complete, atomic, and hard-link no-overwrite", () => {
  assert.match(signerSource, /open\(temporary, "wx", 0o600\)/u);
  assert.match(signerSource, /await tempHandle\.sync\(\)/u);
  assert.match(signerSource, /await link\(temporary, envelopePath\)/u);
  assert.match(signerSource, /validateV5Role2Envelope/u);
});

test("P1363 output is low-S and pinned-key verified before second drift check and publish", () => {
  const normalizeIndex = signerSource.indexOf("const signature = lowS");
  const verifyIndex = signerSource.indexOf("!verify(", normalizeIndex);
  const secondCheck = signerSource.indexOf(
    "const after = await verifyCurrentPinnedV5UnsignedPayload",
    verifyIndex,
  );
  const publishIndex = signerSource.indexOf(
    "await atomicPublishEnvelope",
    secondCheck,
  );
  assert.ok(
    normalizeIndex > 0 &&
      verifyIndex > normalizeIndex &&
      secondCheck > verifyIndex &&
      publishIndex > secondCheck,
  );
  assert.match(signerSource, /P256_HALF_ORDER/u);
  assert.match(signerSource, /dsaEncoding: "ieee-p1363"/u);
});

test("pre-existing envelope and pre-existing attempt root block before spawn", () => {
  const envelopeCheck = signerSource.indexOf("envelope already exists");
  const attemptMkdir = signerSource.indexOf("await mkdir(attemptRoot");
  const executionIndex = signerSource.indexOf(
    "terminal = await runBoundedChild",
  );
  assert.ok(envelopeCheck > 0 && attemptMkdir > 0 && executionIndex > 0);
  assert.ok(
    signerSource.indexOf("await establishAttemptRoot") < executionIndex,
  );
  assert.doesNotMatch(signerSource, /force: true|recursive: true/u);
});

test("CLI is inert without the exact one-use argument and contains no provider path", () => {
  assert.match(cliSource, /--execute-once/u);
  assert.match(cliSource, /process\.argv\.length !== 3/u);
  assert.doesNotMatch(signerSource, /fetch\(|https:\/\//u);
  assert.doesNotMatch(signerSource, /MATCHBASE_OPENROUTER_API_KEY/u);
});

async function withTempRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "matchbase-s3-signer-test-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("behavior: stdout overflow kills, confirms close, and retains exactly 4096 bytes", async () => {
  await withTempRoot(async (root) => {
    const result = await __testOnlyRunBoundedChild({
      executable: process.execPath,
      args: [
        "-e",
        'process.stdout.write("x".repeat(8192));setInterval(()=>{},1000)',
      ],
      cwd: root,
      timeoutMs: 5_000,
      outputRoot: root,
    });
    assert.equal(result.terminal.overflow, true);
    assert.equal(result.terminal.killRequested, true);
    assert.equal(result.stdout.length, 4_096);
    assert.notEqual(result.terminal.signal, null);
  });
});

test("behavior: stderr overflow kills, confirms close, and retains exactly 4096 bytes", async () => {
  await withTempRoot(async (root) => {
    const result = await __testOnlyRunBoundedChild({
      executable: process.execPath,
      args: [
        "-e",
        'process.stderr.write("e".repeat(8192));setInterval(()=>{},1000)',
      ],
      cwd: root,
      timeoutMs: 5_000,
      outputRoot: root,
    });
    assert.equal(result.terminal.overflow, true);
    assert.equal(result.terminal.killRequested, true);
    assert.equal(result.stderr.length, 4_096);
    assert.notEqual(result.terminal.signal, null);
  });
});

test("behavior: timeout requests kill and waits for confirmed close", async () => {
  await withTempRoot(async (root) => {
    const result = await __testOnlyRunBoundedChild({
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: root,
      timeoutMs: 30,
      outputRoot: root,
    });
    assert.equal(result.terminal.timedOut, true);
    assert.equal(result.terminal.killRequested, true);
    assert.notEqual(result.terminal.signal, null);
  });
});

test("behavior: child PID and absolute executable identity are observed immediately on spawn", async () => {
  await withTempRoot(async (root) => {
    let childStart = null;
    const result = await __testOnlyRunBoundedChild({
      executable: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: root,
      timeoutMs: 1_000,
      outputRoot: root,
      onSpawn: async (identity) => {
        childStart = identity;
      },
    });
    assert.equal(Number.isSafeInteger(childStart.processId), true);
    assert.equal(childStart.executable, process.execPath);
    assert.equal(result.terminal.processId, childStart.processId);
    assert.equal(result.terminal.exitCode, 0);
  });
});

test("behavior: fast exit during delayed child-start persistence cannot lose close or end", async () => {
  await withTempRoot(async (root) => {
    const started = Date.now();
    const result = await Promise.race([
      __testOnlyRunBoundedChild({
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: root,
        timeoutMs: 2_000,
        outputRoot: root,
        onSpawn: async () =>
          new Promise((resolveDelay) => setTimeout(resolveDelay, 250)),
      }),
      new Promise((_, rejectTimeout) =>
        setTimeout(() => rejectTimeout(new Error("close event was lost")), 750),
      ),
    ]);
    assert.equal(result.terminal.exitCode, 0);
    assert.equal(result.terminal.timedOut, false);
    assert.ok(Date.now() - started < 750);
  });
});

test("behavior: child-start persistence failure kills and awaits the already-observed close", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      Promise.race([
        __testOnlyRunBoundedChild({
          executable: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
          cwd: root,
          timeoutMs: 2_000,
          outputRoot: root,
          onSpawn: async () => {
            throw new Error("fault-injected child-start persistence failure");
          },
        }),
        new Promise((_, rejectTimeout) =>
          setTimeout(
            () => rejectTimeout(new Error("child-start failure hung")),
            750,
          ),
        ),
      ]),
      /fault-injected child-start persistence failure/u,
    );
  });
});

test("behavior: child error and nonzero/stderr outcomes are closed and observable", async () => {
  await withTempRoot(async (root) => {
    const missingRoot = join(root, "missing");
    await mkdir(missingRoot);
    const missing = await __testOnlyRunBoundedChild({
      executable: join(root, "absent.exe"),
      args: [],
      cwd: root,
      timeoutMs: 1_000,
      outputRoot: missingRoot,
    });
    assert.equal(missing.terminal.processError, "Error");
    assert.notEqual(missing.terminal.exitCode, 0);
    const nonzeroRoot = join(root, "nonzero");
    await mkdir(nonzeroRoot);
    const nonzero = await __testOnlyRunBoundedChild({
      executable: process.execPath,
      args: ["-e", 'process.stderr.write("closed");process.exit(7)'],
      cwd: root,
      timeoutMs: 1_000,
      outputRoot: nonzeroRoot,
    });
    assert.equal(nonzero.terminal.exitCode, 7);
    assert.equal(nonzero.stderr.toString("utf8"), "closed");
  });
});

test("behavior: high-S normalizes and invalid P-256 scalars reject", () => {
  const order = BigInt(
    "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
  );
  const half = order / 2n;
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const message = Buffer.from("isolated-s3-signer-test", "utf8");
  const original = sign("sha256", message, {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const high = Buffer.from(original);
  const s = BigInt(`0x${high.subarray(32).toString("hex")}`);
  const highS = s > half ? s : order - s;
  Buffer.from(highS.toString(16).padStart(64, "0"), "hex").copy(high, 32);
  const normalized = __testOnlyNormalizeAndVerifyP1363({
    signature: high,
    message,
    publicKey,
  });
  assert.ok(BigInt(`0x${normalized.subarray(32).toString("hex")}`) <= half);
  assert.throws(
    () =>
      __testOnlyNormalizeAndVerifyP1363({
        signature: Buffer.alloc(64),
        message,
        publicKey,
      }),
    /invalid P-256 scalar/u,
  );
});

test("behavior: hard-link publication refuses overwrite and preserves recoverable first bytes", async () => {
  await withTempRoot(async (root) => {
    const path = join(root, "envelope.json");
    const first = Buffer.from("first-complete-envelope", "utf8");
    await __testOnlyAtomicPublishEnvelope(path, first);
    assert.deepEqual(await readFile(path), first);
    await assert.rejects(
      __testOnlyAtomicPublishEnvelope(path, Buffer.from("second", "utf8")),
      /EEXIST/u,
    );
    assert.deepEqual(await readFile(path), first);
  });
});

test("behavior: payload, PEM, or CER drift between checks blocks pre-publish equality", () => {
  const before = {
    payloadSha256: "A".repeat(64),
    publicKeyPem: Buffer.from("pem"),
    certificateBytes: Buffer.from("cer"),
  };
  __testOnlyAssertSameUnsignedInputs(before, {
    payloadSha256: before.payloadSha256,
    publicKeyPem: Buffer.from("pem"),
    certificateBytes: Buffer.from("cer"),
  });
  for (const drift of [
    { ...before, payloadSha256: "B".repeat(64) },
    { ...before, publicKeyPem: Buffer.from("other") },
    { ...before, certificateBytes: Buffer.from("other") },
  ])
    assert.throws(
      () => __testOnlyAssertSameUnsignedInputs(before, drift),
      /drifted before publish/u,
    );
});

test("behavior: durable terminal evidence is nlink1, recoverable, and no-overwrite", async () => {
  await withTempRoot(async (root) => {
    const path = join(root, "attempt-result.json");
    const value = {
      status: "TERMINAL_FAILURE",
      reason: "SETUP_FAILURE",
      invocationCount: 0,
      allocationConsumed: true,
    };
    const identity = await __testOnlyWriteTerminalEvidence(path, value);
    const bytes = await readFile(path);
    assert.equal(bytes.length, identity.bytes);
    assert.match(bytes.toString("utf8"), /"invocationCount": 0/u);
    await assert.rejects(
      __testOnlyWriteTerminalEvidence(path, value),
      /EEXIST/u,
    );
  });
});

test("behavior: published envelope survives lost result output and blocks any second publication", async () => {
  await withTempRoot(async (root) => {
    const envelope = join(root, "envelope.json");
    const evidence = join(root, "attempt-start.json");
    const bytes = Buffer.from('{"schemaVersion":"test-complete"}', "utf8");
    await __testOnlyWriteTerminalEvidence(evidence, {
      allocationConsumed: true,
      invocationCount: 1,
    });
    await __testOnlyAtomicPublishEnvelope(envelope, bytes);
    assert.deepEqual(await readFile(envelope), bytes);
    assert.match(
      await readFile(evidence, "utf8"),
      /"allocationConsumed": true/u,
    );
    await assert.rejects(
      __testOnlyAtomicPublishEnvelope(envelope, bytes),
      /EEXIST/u,
    );
  });
});

test("behavior: published pair is exactly reopened before durable PASS evidence", async () => {
  await withTempRoot(async (root) => {
    const verificationPath = join(root, "published-pair-verification.json");
    const payloadBytes = Buffer.from('{"payload":"exact"}', "utf8");
    const envelopeBytes = Buffer.from('{"envelope":"exact"}', "utf8");
    const before = {
      payloadBytes,
      payloadSha256: "A".repeat(64),
    };
    await __testOnlyVerifyAndRecordPublishedPair({
      verificationPath,
      before,
      envelopeBytes,
      now: () => Date.parse("2026-08-23T12:00:00Z"),
      loadSigned: async () => ({
        payloadBytes,
        payloadSha256: before.payloadSha256,
        envelopeBytes,
        envelopeSha256: sha256(envelopeBytes),
        replayIdentitySha256: "B".repeat(64),
        signatureSha256: "C".repeat(64),
      }),
    });
    const evidence = JSON.parse(await readFile(verificationPath, "utf8"));
    assert.equal(evidence.status, "PASS");
    assert.equal(evidence.fullSignedLoader, true);
    await assert.rejects(
      __testOnlyVerifyAndRecordPublishedPair({
        verificationPath: join(root, "drift.json"),
        before,
        envelopeBytes,
        now: Date.now,
        loadSigned: async () => ({
          payloadBytes: Buffer.from("drift"),
          payloadSha256: before.payloadSha256,
          envelopeBytes,
          envelopeSha256: "D".repeat(64),
        }),
      }),
      /failed exact signed-loader verification/u,
    );
  });
});

test("behavior: post-publish result-record failure leaves pair PASS and blocks restart", async () => {
  await withTempRoot(async (root) => {
    const envelopePath = join(root, "envelope.json");
    const verificationPath = join(root, "published-pair-verification.json");
    const resultPath = join(root, "attempt-result.json");
    const payloadBytes = Buffer.from("payload", "utf8");
    const envelopeBytes = Buffer.from("envelope", "utf8");
    await __testOnlyAtomicPublishEnvelope(envelopePath, envelopeBytes);
    await __testOnlyVerifyAndRecordPublishedPair({
      verificationPath,
      before: { payloadBytes, payloadSha256: "A".repeat(64) },
      envelopeBytes,
      now: Date.now,
      loadSigned: async () => ({
        payloadBytes,
        payloadSha256: "A".repeat(64),
        envelopeBytes,
        envelopeSha256: sha256(envelopeBytes),
        replayIdentitySha256: "B".repeat(64),
        signatureSha256: "C".repeat(64),
      }),
    });
    await writeFile(resultPath, "fault-injected-preexisting-result", {
      flag: "wx",
    });
    await assert.rejects(
      __testOnlyWriteTerminalEvidence(resultPath, { status: "PUBLISHED" }),
      /EEXIST/u,
    );
    assert.equal(
      JSON.parse(await readFile(verificationPath, "utf8")).status,
      "PASS",
    );
    assert.deepEqual(await readFile(envelopePath), envelopeBytes);
    await assert.rejects(
      __testOnlyAtomicPublishEnvelope(envelopePath, envelopeBytes),
      /EEXIST/u,
    );
  });
});
