import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  link,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  initializeOneUseCredentialLedger,
  validateOneUseCredentialLedger,
} from "../../scripts/lib/slice3-v5-one-use-ledger.mjs";
import { createOneUseOpaqueCapabilityRegistry } from "../../scripts/lib/slice3-v5-capability-registry.mjs";
import { pathToFileURL } from "node:url";
import {
  readExactRegularContainedSource,
  verifyImmutableV5PredecessorLedger,
} from "../../scripts/lib/slice3-v5-source-verifier.mjs";
import {
  assessCurrentV5Disposition,
  consumeV5CredentialGateCapability,
  createV5SourceBinding,
  executeCurrentV5CredentialGate,
  reduceV5CredentialResponse,
  slice3V5QualificationConstants,
} from "../../scripts/lib/slice3-live-qualification-v5.mjs";

function response(body, status = 200, headers = {}) {
  const result = new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    {
      status,
      headers: { "content-type": "application/json", ...headers },
    },
  );
  Object.defineProperty(result, "url", {
    value: "https://openrouter.ai/api/v1/key",
    writable: true,
    configurable: true,
  });
  return result;
}

function keyData(overrides = {}) {
  return {
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_monthly: 0,
    byok_usage_weekly: 0,
    creator_user_id: null,
    expires_at: null,
    include_byok_in_limit: false,
    is_free_tier: false,
    is_management_key: false,
    is_provisioning_key: false,
    label: "discard",
    limit: null,
    limit_remaining: 1,
    limit_reset: null,
    rate_limit: { requests: -1, interval: "legacy", note: "discard" },
    usage: 0,
    usage_daily: 0,
    usage_monthly: 0,
    usage_weekly: 0,
    ...overrides,
  };
}

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function temporaryState() {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v5-ledger-"));
  return { root, sessionId: "v5-0123456789ABCDEF01234567" };
}

function events(sessionId) {
  const authorizationEvent = {
    schemaVersion: "matchbase.slice3-v5-authorization/v2",
    authorizationId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S2",
    sessionId,
    sourceAttestationDigest: "A".repeat(64),
    role2PayloadSha256: "B".repeat(64),
    role2SignatureSha256: "C".repeat(64),
    role2ReplayIdentitySha256: "D".repeat(64),
    role2KeyId: "ROLE2-PO001-S3-V5-TPM-ECDSA-P256-0AED3F3F66C077CB",
    role2Nonce: "E".repeat(32),
    repositoryCommit: "a".repeat(40),
    repositoryTree: "b".repeat(40),
    originMain: "a".repeat(40),
    observedAt: "2026-08-22T00:00:00.000Z",
    maxCredentialGets: 1,
    modelPosts: 0,
    searchCalls: 0,
    activation: false,
  };
  return {
    authorizationEvent,
    reservationEvent: {
      schemaVersion: "matchbase.slice3-v5-key-get-reservation/v2",
      authorizationId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S2",
      sessionId,
      authorizationDigest: sha256(`${JSON.stringify(authorizationEvent)}\n`),
      replayRecordSha256: "F".repeat(64),
      observedAt: "2026-08-22T00:00:01.000Z",
      callNumber: 1,
      endpoint: "https://openrouter.ai/api/v1/key",
      method: "GET",
      retries: 0,
      fallbacks: 0,
      redirects: 0,
      allocationConsumed: true,
      activation: false,
    },
  };
}

function terminalResult(created, overrides = {}) {
  const sanitizedEnvelope = {
    endpointCapability: "OPENROUTER_KEY_STATUS_READ",
    httpStatus: null,
    callOccurred: false,
    urlValid: false,
    contentTypeValid: false,
    schemaValid: false,
    paidCredential: null,
    failureClass: "CREDENTIAL_READ_OR_PRE_SEND_FAILURE",
    responseBodyPersisted: false,
    rawHeadersPersisted: false,
    decisionDiagnostics: [],
  };
  return {
    schemaVersion: "matchbase.slice3-v5-credential-result/v2",
    disposition: "BLOCKED_CREDENTIAL",
    sanitizedEnvelope,
    sanitizedEnvelopeDigest: sha256(JSON.stringify(sanitizedEnvelope)),
    allocationConsumed: true,
    credentialGets: 0,
    modelPosts: 0,
    searchCalls: 0,
    metadataGets: 0,
    retries: 0,
    fallbacks: 0,
    billableCalls: 0,
    providerQualificationCalls: 0,
    accountMutations: 0,
    cloudMutations: 0,
    deploymentMutations: 0,
    externalMutations: 0,
    activation: false,
    terminal: true,
    observedAt: "2026-08-22T00:00:02.000Z",
    authorizationDigest: created.authorizationDigest,
    reservationDigest: created.reservationDigest,
    ...overrides,
  };
}

const ledgerValidation = Object.freeze({
  authorizationId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S2",
  sessionId: "v5-0123456789ABCDEF01234567",
  sourceAttestationDigest: "A".repeat(64),
  role2PayloadSha256: "B".repeat(64),
  role2SignatureSha256: "C".repeat(64),
  role2ReplayIdentitySha256: "D".repeat(64),
  role2KeyId: "ROLE2-PO001-S3-V5-TPM-ECDSA-P256-0AED3F3F66C077CB",
  role2Nonce: "E".repeat(32),
  replayRecordSha256: "F".repeat(64),
});

async function exerciseInertV5StateMachine({
  stateRoot,
  attestationAtMint = "A".repeat(64),
  attestationBeforeReservation = "A".repeat(64),
  readCredential,
  fetchOnce,
}) {
  if (attestationAtMint !== attestationBeforeReservation)
    throw new Error("test-only source attestation drift");
  const sessionId = ledgerValidation.sessionId;
  const created = await initializeOneUseCredentialLedger({
    stateRoot,
    sessionId,
    ...events(sessionId),
  });
  let sendState = "NOT_SENT";
  let responseStatus = null;
  let evidence;
  try {
    const credential = await readCredential();
    sendState = "UNKNOWN_AFTER_SEND";
    const result = await fetchOnce("https://openrouter.ai/api/v1/key", {
      method: "GET",
      redirect: "error",
      credential,
    });
    sendState = "RESPONSE_RECEIVED";
    responseStatus = result.status;
    evidence = await reduceV5CredentialResponse(result);
  } catch {
    const sanitizedEnvelope = {
      endpointCapability: "OPENROUTER_KEY_STATUS_READ",
      httpStatus: responseStatus,
      callOccurred:
        sendState === "NOT_SENT"
          ? false
          : sendState === "RESPONSE_RECEIVED"
            ? true
            : null,
      urlValid: sendState === "RESPONSE_RECEIVED",
      contentTypeValid: sendState === "RESPONSE_RECEIVED",
      schemaValid: false,
      paidCredential: null,
      failureClass:
        sendState === "NOT_SENT"
          ? "CREDENTIAL_READ_OR_PRE_SEND_FAILURE"
          : sendState === "RESPONSE_RECEIVED"
            ? "RESPONSE_REDUCTION_FAILURE"
            : "UNKNOWN_TRANSPORT_TIMEOUT_OR_REDIRECT",
      responseBodyPersisted: false,
      rawHeadersPersisted: false,
      decisionDiagnostics: [],
    };
    evidence = terminalResult(created, {
      sanitizedEnvelope,
      sanitizedEnvelopeDigest: sha256(JSON.stringify(sanitizedEnvelope)),
      credentialGets:
        sendState === "NOT_SENT"
          ? 0
          : sendState === "RESPONSE_RECEIVED"
            ? 1
            : null,
    });
  }
  const terminal = {
    ...evidence,
    observedAt: "2026-08-22T00:00:02.000Z",
    authorizationDigest: created.authorizationDigest,
    reservationDigest: created.reservationDigest,
  };
  await writeFile(
    join(created.sessionDirectory, "02-key-get-result.json"),
    `${JSON.stringify(terminal)}\n`,
  );
  return validateOneUseCredentialLedger(
    created.sessionDirectory,
    ledgerValidation,
  );
}

test(
  "current V5 source binding is pending and execution is network inert",
  { skip: process.platform !== "win32" },
  async () => {
    const binding = await createV5SourceBinding();
    const disposition = assessCurrentV5Disposition(binding);
    assert.match(disposition.sourceAttestationDigest, /^[A-F0-9]{64}$/u);
    assert.deepEqual(
      { ...disposition, sourceAttestationDigest: "DIGEST" },
      {
        schemaVersion: "matchbase.slice3-v5-source-binding/v1",
        authorizationId: "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S2",
        sessionId: "v5-6092A20EE13791B32198C4B6",
        disposition: "PRE_EXECUTION_PENDING",
        reason: "ROLE2_ACCEPTANCE_PAYLOAD_ABSENT",
        sourceAttestationDigest: "DIGEST",
        credentialGets: 0,
        modelPosts: 0,
        searchCalls: 0,
        activation: false,
      },
    );
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error("network forbidden");
    };
    try {
      assert.equal(
        (await executeCurrentV5CredentialGate(binding)).disposition,
        "PRE_EXECUTION_PENDING",
      );
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "noncanonical hosts reject production V5 binding before fetch or state",
  { skip: process.platform === "win32" },
  async () => {
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error("FETCH_CALLED");
    };
    try {
      await assert.rejects(
        createV5SourceBinding(),
        /canonical repository root/u,
      );
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

test("current V5 bytes pin the TPM public authority but reject absent acceptance", () => {
  assert.equal(slice3V5QualificationConstants.role2PublicKeyPinned, true);
  assert.equal(
    slice3V5QualificationConstants.role2SigningRevocationDigest,
    "D38D03154C6C87576DEED07EB97A3557271D47E79EE4227D7005CFE7140A1665",
  );
  assert.throws(
    () => consumeV5CredentialGateCapability(Object.freeze({})),
    /invalid or consumed/u,
  );
  assert.throws(
    () => consumeV5CredentialGateCapability(null),
    /invalid or consumed/u,
  );
});

test("opaque credential capability is same-object, one-use, and clone/forgery safe", () => {
  const registry = createOneUseOpaqueCapabilityRegistry();
  const capability = registry.mint({ disposition: "PASS" });
  assert.deepEqual(registry.consume(capability), { disposition: "PASS" });
  assert.throws(() => registry.consume(capability), /invalid or consumed/u);
  assert.throws(
    () => registry.consume(Object.freeze({})),
    /invalid or consumed/u,
  );
  const second = registry.mint({ disposition: "PASS" });
  assert.throws(() => registry.consume({ ...second }), /invalid or consumed/u);
});

test(
  "forged, cloned, and replayed bindings cannot execute",
  { skip: process.platform !== "win32" },
  async () => {
    const binding = await createV5SourceBinding();
    await assert.rejects(
      executeCurrentV5CredentialGate({ ...binding }),
      /source capability/u,
    );
    assert.throws(
      () => assessCurrentV5Disposition({ ...binding }),
      /source capability/u,
    );
    assert.equal(
      (await executeCurrentV5CredentialGate(binding)).credentialGets,
      0,
    );
    assert.equal(
      (await executeCurrentV5CredentialGate(binding)).credentialGets,
      0,
    );
  },
);

test("V5 constants close the one-GET, zero-model allocation", () => {
  assert.equal(
    slice3V5QualificationConstants.endpoint,
    "https://openrouter.ai/api/v1/key",
  );
  assert.equal(slice3V5QualificationConstants.maxCredentialGets, 1);
  assert.equal(slice3V5QualificationConstants.maxModelPosts, 0);
  assert.equal(slice3V5QualificationConstants.maxSearchCalls, 0);
  assert.equal(slice3V5QualificationConstants.timeoutMs, 10_000);
  assert.equal(slice3V5QualificationConstants.maxResponseBytes, 32_768);
  assert.equal(slice3V5QualificationConstants.ledgers.length, 3);
  assert.equal(slice3V5QualificationConstants.v4Sources.length, 4);
});

test("one-use ledger writes authorization then reservation exactly once", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const created = await initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
  });
  assert.deepEqual((await readdir(created.sessionDirectory)).sort(), [
    "00-authorization.json",
    "01-key-get-reserved.json",
  ]);
  await writeFile(
    join(created.sessionDirectory, "02-key-get-result.json"),
    `${JSON.stringify(terminalResult(created))}\n`,
  );
  assert.equal(
    (
      await validateOneUseCredentialLedger(
        created.sessionDirectory,
        ledgerValidation,
      )
    ).result.credentialGets,
    0,
  );
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: state.sessionId,
      ...events(state.sessionId),
    }),
    /already consumed/u,
  );
});

test("concurrent reservation has one winner and no second slot", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const locked = new Promise((resolve) => {
    entered = resolve;
  });
  const first = initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
    afterLock: async () => {
      entered();
      await held;
    },
  });
  await locked;
  const second = initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
  });
  release();
  const settled = await Promise.allSettled([first, second]);
  assert.equal(
    settled.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(settled.filter(({ status }) => status === "rejected").length, 1);
});

test("foreign/prepopulated session is never removed", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const directory = join(state.root, state.sessionId);
  await mkdir(directory);
  await writeFile(join(directory, "foreign.txt"), "preserve\n");
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: state.sessionId,
      ...events(state.sessionId),
    }),
    /already consumed/u,
  );
  assert.equal(
    await readFile(join(directory, "foreign.txt"), "utf8"),
    "preserve\n",
  );
});

test("crash after durable reservation is non-resumable and validator rejects nonterminal ledger", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const created = await initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
  });
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: state.sessionId,
      ...events(state.sessionId),
    }),
    /already consumed/u,
  );
  await assert.rejects(
    validateOneUseCredentialLedger(created.sessionDirectory, ledgerValidation),
    /file set/u,
  );
});

test("terminal ledger validator rejects reservation and result hash substitutions", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const created = await initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
  });
  const resultPath = join(created.sessionDirectory, "02-key-get-result.json");
  await writeFile(resultPath, `${JSON.stringify(terminalResult(created))}\n`);
  await validateOneUseCredentialLedger(
    created.sessionDirectory,
    ledgerValidation,
  );
  const tampered = JSON.parse(await readFile(resultPath, "utf8"));
  tampered.reservationDigest = "0".repeat(64);
  await writeFile(resultPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(
    validateOneUseCredentialLedger(created.sessionDirectory, ledgerValidation),
    /hash chain/u,
  );
});

test("terminal ledger validator rejects session/file symlinks and hardlinks", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const created = await initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
  });
  const resultPath = join(created.sessionDirectory, "02-key-get-result.json");
  await writeFile(resultPath, `${JSON.stringify(terminalResult(created))}\n`);
  const alias = `${created.sessionDirectory}-alias`;
  await symlink(created.sessionDirectory, alias, "junction");
  await assert.rejects(
    validateOneUseCredentialLedger(alias, ledgerValidation),
    /session identity/u,
  );
  await rm(alias);
  const original = join(state.root, "result-original");
  await rename(resultPath, original);
  await symlink(original, resultPath, "file");
  await assert.rejects(
    validateOneUseCredentialLedger(created.sessionDirectory, ledgerValidation),
    /escaped containment/u,
  );
  await rm(resultPath);
  await link(original, resultPath);
  await assert.rejects(
    validateOneUseCredentialLedger(created.sessionDirectory, ledgerValidation),
    /escaped containment/u,
  );
});

test("test-only inert accepted state machine sends one exact GET and writes a validated terminal PASS", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  let fetches = 0;
  const ledger = await exerciseInertV5StateMachine({
    stateRoot: state.root,
    readCredential: async () => "fixture-only",
    fetchOnce: async (url, options) => {
      fetches += 1;
      assert.equal(url, "https://openrouter.ai/api/v1/key");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      return response({ data: keyData() });
    },
  });
  assert.equal(fetches, 1);
  assert.equal(
    ledger.result.disposition,
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
  );
  assert.equal(ledger.result.credentialGets, 1);
});

test("test-only inert state machine rejects post-mint drift before state, credential read, or fetch", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  let reads = 0;
  let fetches = 0;
  await assert.rejects(
    exerciseInertV5StateMachine({
      stateRoot: state.root,
      attestationBeforeReservation: "B".repeat(64),
      readCredential: async () => {
        reads += 1;
      },
      fetchOnce: async () => {
        fetches += 1;
      },
    }),
    /attestation drift/u,
  );
  assert.equal(reads, 0);
  assert.equal(fetches, 0);
  assert.deepEqual(await readdir(state.root), []);
});

test("test-only inert state machine terminalizes parser and response-reduction failures with exact call counts", async (t) => {
  for (const phase of ["parser", "reducer"]) {
    const state = await temporaryState();
    t.after(() => rm(state.root, { recursive: true, force: true }));
    let fetches = 0;
    const ledger = await exerciseInertV5StateMachine({
      stateRoot: state.root,
      readCredential: async () => {
        if (phase === "parser") throw new Error("fixture parser failure");
        return "fixture-only";
      },
      fetchOnce: async () => {
        fetches += 1;
        return response("x".repeat(32_769));
      },
    });
    assert.equal(fetches, phase === "parser" ? 0 : 1);
    assert.equal(ledger.result.credentialGets, phase === "parser" ? 0 : 1);
    assert.equal(
      ledger.result.sanitizedEnvelope.failureClass,
      phase === "parser"
        ? "CREDENTIAL_READ_OR_PRE_SEND_FAILURE"
        : "RESPONSE_REDUCTION_FAILURE",
    );
  }
});

test("test-only inert state machine validates every closed HTTP failure tuple", async (t) => {
  const cases = [
    [401, { error: {} }, "HTTP_401"],
    [403, { error: {} }, "HTTP_403"],
    [302, { data: keyData() }, "REDIRECT_RESPONSE"],
    [200, { data: keyData({ is_free_tier: true }) }, "UNPAID_CREDENTIAL"],
    [500, { error: {} }, "OTHER_HTTP_STATUS"],
  ];
  for (const [status, body, failureClass] of cases) {
    const state = await temporaryState();
    t.after(() => rm(state.root, { recursive: true, force: true }));
    const ledger = await exerciseInertV5StateMachine({
      stateRoot: state.root,
      readCredential: async () => "fixture-only",
      fetchOnce: async () => response(body, status),
    });
    assert.equal(ledger.result.sanitizedEnvelope.failureClass, failureClass);
    assert.equal(ledger.result.credentialGets, 1);
  }
});

test("race appearing under lock is rejected and retained", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const directory = join(state.root, state.sessionId);
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: state.sessionId,
      ...events(state.sessionId),
      afterLock: async () => {
        await mkdir(directory);
        await writeFile(join(directory, "race.txt"), "retain\n");
      },
    }),
    /already consumed/u,
  );
  assert.equal(await readFile(join(directory, "race.txt"), "utf8"), "retain\n");
});

test("authorization and run locks remain held across after-lock, reservation, and terminal transition", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const order = [];
  const created = await initializeOneUseCredentialLedger({
    stateRoot: state.root,
    sessionId: state.sessionId,
    ...events(state.sessionId),
    afterLock: async ({ authorizationLock, runLock }) => {
      order.push("after-lock");
      assert.equal((await lstat(authorizationLock)).isFile(), true);
      assert.equal((await lstat(runLock)).isFile(), true);
    },
    executeWhileLocked: async ({
      sessionDirectory,
      authorizationLock,
      runLock,
      authorizationDigest,
      reservationDigest,
    }) => {
      order.push("execute-while-locked");
      assert.equal((await lstat(authorizationLock)).isFile(), true);
      assert.equal((await lstat(runLock)).isFile(), true);
      await writeFile(
        join(sessionDirectory, "02-key-get-result.json"),
        `${JSON.stringify(
          terminalResult({ authorizationDigest, reservationDigest }),
        )}\n`,
      );
      return { terminalWritten: true };
    },
  });
  assert.deepEqual(order, ["after-lock", "execute-while-locked"]);
  await assert.rejects(lstat(created.authorizationLock), { code: "ENOENT" });
  await assert.rejects(lstat(created.runLock), { code: "ENOENT" });
});

test("a crash after durable reservation retains both locks and forbids restart", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: state.sessionId,
      ...events(state.sessionId),
      executeWhileLocked: async () => {
        throw new Error("synthetic crash after reservation");
      },
    }),
    /initialization failed after consumption/u,
  );
  const sessionDirectory = join(state.root, state.sessionId);
  assert.equal(
    (await lstat(`${sessionDirectory}.authorization.lock`)).isFile(),
    true,
  );
  assert.equal((await lstat(`${sessionDirectory}.run.lock`)).isFile(), true);
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: state.sessionId,
      ...events(state.sessionId),
    }),
  );
});

test("noncanonical root, symlink root, and invalid session are rejected", async (t) => {
  const state = await temporaryState();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: join(state.root, "missing"),
      sessionId: state.sessionId,
      ...events(state.sessionId),
    }),
  );
  await assert.rejects(
    initializeOneUseCredentialLedger({
      stateRoot: state.root,
      sessionId: "../escape",
      ...events(state.sessionId),
    }),
    /session identity/u,
  );
});

test("host-neutral source verifier rejects traversal, symlink, tamper, missing, and ledger substitutions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v5-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.json");
  await writeFile(source, "{}\n");
  const digest = sha256(await readFile(source));
  assert.equal(
    (await readExactRegularContainedSource(source, root, digest)).toString(),
    "{}\n",
  );
  await assert.rejects(
    readExactRegularContainedSource(join(root, "missing"), root, digest),
  );
  await writeFile(source, '{"changed":true}\n');
  await assert.rejects(
    readExactRegularContainedSource(source, root, digest),
    /drifted/u,
  );
  const outside = join(root, "..", `v5-outside-${Date.now()}.json`);
  await writeFile(outside, "{}\n");
  t.after(() => rm(outside, { force: true }));
  await assert.rejects(
    readExactRegularContainedSource(
      outside,
      root,
      sha256(await readFile(outside)),
    ),
    /escaped/u,
  );
  const link = join(root, "link.json");
  await symlink(outside, link, "file");
  await assert.rejects(
    readExactRegularContainedSource(
      link,
      root,
      sha256(await readFile(outside)),
    ),
    /regular file/u,
  );

  const stateRoot = join(root, "state");
  const sessionId = "v5-AAAAAAAAAAAAAAAAAAAAAAAA";
  const directory = join(stateRoot, sessionId);
  await mkdir(directory, { recursive: true });
  const names = [
    "00-authorization.json",
    "01-reserved.json",
    "01-result.json",
    "02-reserved.json",
    "02-result.json",
  ];
  for (const name of names) await writeFile(join(directory, name), `${name}\n`);
  const expectedFiles = names.map((name) => ({
    name,
    digest: sha256(Buffer.from(`${name}\n`)),
  }));
  const expectedDigest = sha256(JSON.stringify(expectedFiles));
  assert.equal(
    (
      await verifyImmutableV5PredecessorLedger({
        stateRoot,
        sessionId,
        expectedDigest,
        expectedFiles,
      })
    ).digest,
    expectedDigest,
  );
  await writeFile(join(directory, "01-result.json"), "changed\n");
  await assert.rejects(
    verifyImmutableV5PredecessorLedger({
      stateRoot,
      sessionId,
      expectedDigest,
      expectedFiles,
    }),
    /drifted/u,
  );
  await writeFile(join(directory, "extra.json"), "extra\n");
  await assert.rejects(
    verifyImmutableV5PredecessorLedger({
      stateRoot,
      sessionId,
      expectedDigest,
      expectedFiles,
    }),
    /file set/u,
  );
});

test(
  "an identical clean clone is rejected before credential, replay, state, or fetch",
  { skip: process.platform !== "win32" },
  async (t) => {
    const parent = await mkdtemp(join(tmpdir(), "matchbase-v5-clone-"));
    const clone = join(parent, "clone");
    t.after(() => rm(parent, { recursive: true, force: true }));
    const repository = resolve(".");
    assert.equal(
      spawnSync("git", [
        "clone",
        "--quiet",
        "--no-hardlinks",
        repository,
        clone,
      ]).status,
      0,
    );
    assert.equal(
      spawnSync(
        "git",
        [
          "remote",
          "set-url",
          "origin",
          "https://github.com/banihashem/INNOBASE-MatchBASE.git",
        ],
        { cwd: clone },
      ).status,
      0,
    );
    const replayPath =
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.role2-signing-replay-registry\\consumed-v5.jsonl";
    const sessionPath =
      "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state\\v5-6092A20EE13791B32198C4B6";
    const replayBefore = sha256(await readFile(replayPath));
    await assert.rejects(lstat(sessionPath), /ENOENT/u);
    const moduleUrl = pathToFileURL(
      resolve("scripts/lib/slice3-live-qualification-v5.mjs"),
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `globalThis.fetch=()=>{throw new Error("FETCH_CALLED")};const m=await import(${JSON.stringify(moduleUrl)});await m.createV5SourceBinding()`,
      ],
      { cwd: clone, encoding: "utf8" },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /canonical repository root/u);
    assert.doesNotMatch(child.stderr, /FETCH_CALLED/u);
    assert.equal(sha256(await readFile(replayPath)), replayBefore);
    await assert.rejects(lstat(sessionPath), /ENOENT/u);
  },
);

test("HTTP 200 is reduced to closed sanitized credential-gate PASS only", async () => {
  const result = await reduceV5CredentialResponse(
    response({
      data: keyData({
        label: "sensitive-account-label-not-for-evidence",
      }),
    }),
  );
  assert.equal(
    result.disposition,
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
  );
  assert.equal(result.allocationConsumed, true);
  assert.equal(result.credentialGets, 1);
  assert.equal(result.modelPosts, 0);
  assert.equal(result.searchCalls, 0);
  assert.equal(result.metadataGets, 0);
  assert.equal(result.activation, false);
  assert.equal(
    JSON.stringify(result).includes("sensitive-account-label"),
    false,
  );
  assert.equal("responseBodyDigest" in result.sanitizedEnvelope, false);
  assert.deepEqual(Object.keys(result).sort(), [
    "accountMutations",
    "activation",
    "allocationConsumed",
    "billableCalls",
    "cloudMutations",
    "credentialGets",
    "deploymentMutations",
    "disposition",
    "externalMutations",
    "fallbacks",
    "metadataGets",
    "modelPosts",
    "providerQualificationCalls",
    "retries",
    "sanitizedEnvelope",
    "sanitizedEnvelopeDigest",
    "schemaVersion",
    "searchCalls",
    "terminal",
  ]);
});

test("401, 403, malformed 200, and hostile error body remain sanitized blocked", async () => {
  for (const item of [
    response(
      {
        error: {
          code: "INVALID_KEY",
          type: "auth",
          message: "MATCHBASE_OPENROUTER_API_KEY=forbidden",
        },
      },
      401,
    ),
    response({ error: { code: "DENIED", type: "auth" } }, 403),
    response("not-json", 200),
    response({ data: { is_free_tier: true } }, 200),
    response({ data: { is_free_tier: false, unknown: "forbidden" } }, 200),
    response({ data: { is_free_tier: false } }, 200, {
      "content-type": "text/plain",
    }),
    response({ data: { is_free_tier: false } }, 302),
    Object.assign(response({ data: { is_free_tier: false } }), {
      url: "https://example.invalid/key",
    }),
  ]) {
    const result = await reduceV5CredentialResponse(item);
    assert.equal(result.disposition, "BLOCKED_CREDENTIAL");
    assert.equal(JSON.stringify(result).includes("forbidden"), false);
    assert.equal(JSON.stringify(result).includes("MATCHBASE_"), false);
    assert.equal(result.activation, false);
  }
});

test("declared and streamed oversized bodies fail closed", async () => {
  await assert.rejects(
    reduceV5CredentialResponse(
      response("{}", 200, { "content-length": "32769" }),
    ),
    /declared oversize/u,
  );
  await assert.rejects(
    reduceV5CredentialResponse(response("x".repeat(32_769))),
    /streamed oversize/u,
  );
});

test("slow response body is aborted by bounded timeout", async () => {
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  const pending = new Response(stream, { status: 200 });
  await assert.rejects(
    reduceV5CredentialResponse(pending, new AbortController(), {
      timeoutMs: 5,
    }),
    /timed out/u,
  );
});

test("production source has fixed native request and no injected fetch", async () => {
  const source = await readFile(
    "scripts/lib/slice3-live-qualification-v5.mjs",
    "utf8",
  );
  assert.match(source, /await fetch\(ENDPOINT/u);
  assert.equal(source.match(/await fetch\(ENDPOINT/gu)?.length, 1);
  assert.match(source, /method: "GET"/u);
  assert.match(source, /redirect: "error"/u);
  assert.doesNotMatch(source, /fetchImpl|sourceResolver|credentialFile:/u);
  assert.doesNotMatch(
    source,
    /generateContent|chat\/completions|google_search|while\s*\([^)]*fetch/iu,
  );
});

test("CLI execute mode remains inert while the Role2 acceptance is absent", () => {
  if (process.platform !== "win32") return;
  const run = spawnSync(
    process.execPath,
    ["scripts/qualify-slice3-live-v5.mjs", "--execute"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(run.status, 0);
  const result = JSON.parse(run.stdout);
  assert.equal(result.disposition, "PRE_EXECUTION_PENDING");
  assert.equal(result.credentialGets, 0);
  assert.equal(result.modelPosts, 0);
  for (const args of [["--unknown"], ["--execute", "--execute"]]) {
    const denied = spawnSync(
      process.execPath,
      ["scripts/qualify-slice3-live-v5.mjs", ...args],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /only one optional --execute/u);
  }
});
