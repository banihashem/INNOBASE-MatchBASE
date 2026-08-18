import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import {
  GeminiV4OutputError,
  assessCurrentV4Disposition,
  buildGeminiV4QualificationRequest,
  deriveV4TerminalFailure,
  executeCurrentV4PreCall,
  exerciseV4ExclusiveInitializerForTest,
  parseGeminiV4Candidate,
  reduceCredentialResponseForV4,
  slice3V4QualificationConstants,
  verifyV4PrecallAbsenceAt,
} from "../../scripts/lib/slice3-live-qualification-v4.mjs";
import * as v4Module from "../../scripts/lib/slice3-live-qualification-v4.mjs";

const v3Names = slice3V4QualificationConstants.v3Manifest.map(
  ({ name }) => name,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

async function readContainedRegularFixtureFile(path, root) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink()) {
    throw new Error("Fixture source is not a regular file.");
  }
  const fileReal = await realpath(path);
  const rel = relative(rootReal, fileReal);
  if (!rel || rel.startsWith("..") || resolve(rootReal, rel) !== fileReal) {
    throw new Error("Fixture source escaped its root.");
  }
  return readFile(fileReal);
}

async function verifyV4SourceFixture(options) {
  const pmReal = await realpath(options.pmRoot);
  const stateItem = await lstat(options.stateRoot);
  if (!stateItem.isDirectory() || stateItem.isSymbolicLink()) {
    throw new Error("Fixture state root is not a regular directory.");
  }
  const stateReal = await realpath(options.stateRoot);
  const stateRel = relative(pmReal, stateReal);
  if (
    !stateRel ||
    stateRel.startsWith("..") ||
    resolve(pmReal, stateRel) !== stateReal
  ) {
    throw new Error("Fixture state root escaped its management root.");
  }
  const [ownerBytes, preflightBytes, policyBytes] = await Promise.all([
    readContainedRegularFixtureFile(options.ownerFile, options.pmRoot),
    readContainedRegularFixtureFile(options.preflightFile, options.pmRoot),
    readContainedRegularFixtureFile(
      options.policyFile,
      dirname(options.policyFile),
    ),
  ]);
  if (
    sha256(ownerBytes) !== options.expectedOwnerDigest ||
    sha256(preflightBytes) !== options.expectedPreflightDigest ||
    sha256(policyBytes) !== options.expectedPolicyDigest
  ) {
    throw new Error("Fixture source binding drifted.");
  }
  const session = join(stateReal, "session-19AD2D3117AF9064AF90F879");
  const names = (await readdir(session)).sort();
  const expectedNames = options.expectedV3Manifest.map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("Fixture V3 ledger file set drifted.");
  }
  const manifest = [];
  for (const expected of options.expectedV3Manifest) {
    const bytes = await readContainedRegularFixtureFile(
      join(session, expected.name),
      session,
    );
    const digest = sha256(bytes);
    if (digest !== expected.digest)
      throw new Error("Fixture V3 ledger drifted.");
    manifest.push({ name: expected.name, digest });
  }
  if (sha256(JSON.stringify(manifest)) !== options.expectedV3LedgerDigest) {
    throw new Error("Fixture V3 ledger manifest drifted.");
  }
  JSON.parse(preflightBytes.toString("utf8"));
  if (!ownerBytes.includes("SLICE3_V4_AUTHORIZATION")) {
    throw new Error("Fixture authorization marker is absent.");
  }
  return Object.freeze({
    schemaVersion: "slice3-live-qualification-source-fixture-verification.v4",
    authorizationId:
      "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-18-V4",
    sessionId: "session-3DD21321009BFABD87CB1904",
    currentDisposition: "BLOCKED_CREDENTIAL",
    activation: false,
  });
}

function validOutput(overrides = {}) {
  return {
    fixtureId: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
    answer: "Reserved for documentation.",
    sourceSummary: "IANA public source.",
    ...overrides,
  };
}

function candidate(parts) {
  return { content: { parts } };
}

function response(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v4-"));
  const credentialFile = join(root, "credentials.txt");
  await writeFile(
    credentialFile,
    "MATCHBASE_GEMINI_API_KEY=fixture-direct\nMATCHBASE_OPENROUTER_API_KEY=fixture-router\n",
  );
  return { root, credentialFile };
}

async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v4-source-"));
  const pmRoot = join(root, "management");
  const stateRoot = join(pmRoot, ".slice3-live-qualification-state");
  const session = join(stateRoot, "session-19AD2D3117AF9064AF90F879");
  const policyRoot = join(root, "repository", "config", "slice3");
  const ownerFile = join(
    pmRoot,
    "OWNER_DECISION_AND_ROLE2_ALLOCATION_PO_001_SLICE_3_LIVE_QUALIFICATION_V4.md",
  );
  const preflightFile = join(
    pmRoot,
    "ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json",
  );
  const policyFile = join(policyRoot, "research-route-policy.v1.json");
  await mkdir(session, { recursive: true });
  await mkdir(policyRoot, { recursive: true });

  const authorization = {
    schemaVersion: "slice3-live-qualification-allocation.v4",
    allocationId: "S3-V4-HOST-NEUTRAL-TEST",
    authorizationId:
      "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-18-V4",
    authorizationSignal:
      "I_AUTHORIZE_TWO_REPLACEMENT_BILLABLE_SYNTHETIC_CALLS_V4",
    sessionId: "session-3DD21321009BFABD87CB1904",
    maxCalls: 2,
    maxCostUsd: 100,
    retries: 0,
    fallbacks: 0,
    syntheticOnly: true,
    restartPolicy: "NON_RESUMABLE_NEW_ALLOCATION_REQUIRED",
    policyDigest: slice3V4QualificationConstants.policyDigest,
    consumedV1LedgerDigest:
      "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8",
    consumedV2LedgerDigest:
      "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748",
    consumedV3LedgerDigest: slice3V4QualificationConstants.v3LedgerDigest,
    credentialPreflightDigest:
      slice3V4QualificationConstants.credentialPreflightDigest,
    currentDisposition: "BLOCKED_CREDENTIAL",
    providerModelPosts: 0,
    v4SessionState: "ABSENT",
    activation: false,
  };
  const ownerBytes = Buffer.from(
    `# Host-neutral V4 fixture\n\n<!--SLICE3_V4_AUTHORIZATION:${JSON.stringify(authorization)}-->\n`,
  );
  const sanitizedEnvelope = {
    endpointCapability: "OPENROUTER_KEY_STATUS_READ",
    httpStatus: 401,
    callOccurred: true,
    responseBodyPersisted: false,
    rawHeadersPersisted: false,
  };
  const preflight = {
    schemaVersion: "slice3-openrouter-credential-preflight.v1",
    observationSource: "OWNER_MEASURED_CURRENT_FACT",
    endpoint: "https://openrouter.ai/api/v1/key",
    method: "GET",
    sanitizedEnvelope,
    sanitizedEnvelopeDigest: sha256(JSON.stringify(sanitizedEnvelope)),
    disposition: "BLOCKED_CREDENTIAL",
    providerModelPosts: 0,
    billableCalls: 0,
    additionalAuthorizationGets: 0,
    requestIdDigest: null,
    errorCode: null,
    errorType: null,
    costState: "unknown",
    costAmountUsd: null,
    credentialValuePersisted: false,
    credentialValueDisclosed: false,
    rawResponsePersisted: false,
    recordedAt: "2026-08-18T00:00:00.000Z",
  };
  const preflightBytes = Buffer.from(`${JSON.stringify(preflight)}\n`);
  const policyBytes = Buffer.from('{"fixture":"host-neutral"}\n');
  await writeFile(ownerFile, ownerBytes);
  await writeFile(preflightFile, preflightBytes);
  await writeFile(policyFile, policyBytes);

  const expectedV3Manifest = [];
  for (const [index, name] of v3Names.entries()) {
    const bytes = Buffer.from(
      `${JSON.stringify({ schemaVersion: "fixture.v3", index: index + 1 })}\n`,
    );
    await writeFile(join(session, name), bytes);
    expectedV3Manifest.push({ name, digest: sha256(bytes) });
  }
  const options = {
    pmRoot,
    stateRoot,
    ownerFile,
    preflightFile,
    policyFile,
    expectedOwnerDigest: sha256(ownerBytes),
    expectedPreflightDigest: sha256(preflightBytes),
    expectedPolicyDigest: sha256(policyBytes),
    expectedV3Manifest,
    expectedV3LedgerDigest: sha256(JSON.stringify(expectedV3Manifest)),
  };
  return { root, stateRoot, session, ownerFile, preflightFile, options };
}

test("host-neutral V4 source fixtures verify without minting a capability", async () => {
  const source = await sourceFixture();
  try {
    const fixtureResult = await verifyV4SourceFixture(source.options);
    assert.equal(
      fixtureResult.schemaVersion,
      "slice3-live-qualification-source-fixture-verification.v4",
    );
    assert.equal(fixtureResult.currentDisposition, "BLOCKED_CREDENTIAL");
    assert.equal(
      (await readdir(source.stateRoot)).includes(fixtureResult.sessionId),
      false,
    );
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return response({ data: { is_free_tier: false } });
    };
    try {
      assert.throws(
        () => assessCurrentV4Disposition(fixtureResult),
        /capability/iu,
      );
      await assert.rejects(
        executeCurrentV4PreCall(fixtureResult),
        /capability/iu,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalls, 0);
    assert.equal("probeOpenRouterCredentialForV4" in v4Module, false);
    assert.equal("initializeV4SessionWithCapability" in v4Module, false);
    assert.equal("appendV4TerminalFailure" in v4Module, false);
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});

test("forged and detached V4 source bindings cannot assess or execute", async () => {
  const source = await sourceFixture();
  try {
    const inert = await verifyV4SourceFixture(source.options);
    const forged = { ...inert };
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("must not execute");
    };
    try {
      assert.throws(() => assessCurrentV4Disposition(forged), /capability/iu);
      await assert.rejects(executeCurrentV4PreCall(forged), /capability/iu);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});

test("immutable V3 binding rejects extra, missing, and changed bytes", async () => {
  for (const kind of ["extra", "missing", "changed"]) {
    const source = await sourceFixture();
    try {
      await verifyV4SourceFixture(source.options);
      if (kind === "extra")
        await writeFile(join(source.session, "extra.json"), "{}\n");
      if (kind === "missing") await rm(join(source.session, v3Names[2]));
      if (kind === "changed") {
        await appendFile(join(source.session, v3Names[2]), " ");
      }
      await assert.rejects(
        verifyV4SourceFixture(source.options),
        /V3 ledger/iu,
      );
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  }
});

test("host-neutral source fixtures reject traversal, nonregular, missing, and hash drift", async () => {
  for (const kind of ["traversal", "nonregular", "missing", "hash"]) {
    const source = await sourceFixture();
    try {
      if (kind === "traversal") {
        const outside = join(source.root, "outside-owner.md");
        await writeFile(outside, await readFile(source.ownerFile));
        source.options.ownerFile = outside;
      }
      if (kind === "nonregular") {
        await rm(source.ownerFile);
        await mkdir(source.ownerFile);
      }
      if (kind === "missing") await rm(source.preflightFile);
      if (kind === "hash") await appendFile(source.preflightFile, " ");
      await assert.rejects(
        verifyV4SourceFixture(source.options),
        /escaped|regular file|ENOENT|source binding/iu,
      );
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  }
});

test("host-neutral fixtures reject outside, traversal, missing, and linked state roots", async () => {
  for (const kind of ["outside", "traversal", "missing", "linked"]) {
    const source = await sourceFixture();
    try {
      if (kind === "outside" || kind === "traversal") {
        const outside = join(source.root, `${kind}-state`);
        await rename(source.stateRoot, outside);
        source.options.stateRoot =
          kind === "traversal"
            ? join(source.options.pmRoot, "..", `${kind}-state`)
            : outside;
      }
      if (kind === "missing") {
        source.options.stateRoot = join(source.options.pmRoot, "missing-state");
      }
      if (kind === "linked") {
        const alias = join(source.options.pmRoot, "linked-state");
        await symlink(source.stateRoot, alias, "junction");
        source.options.stateRoot = alias;
      }
      await assert.rejects(
        verifyV4SourceFixture(source.options),
        /escaped|regular directory|ENOENT/iu,
      );
    } finally {
      await rm(source.root, { recursive: true, force: true });
    }
  }
});

test("V4 pre-call absence check rejects a session, authorization lock, or run lock", async () => {
  for (const suffix of ["", ".authorization.lock", ".run.lock"]) {
    const { root } = await fixture();
    const path = join(root, `session-3DD21321009BFABD87CB1904${suffix}`);
    try {
      assert.equal((await verifyV4PrecallAbsenceAt(root)).runLockAbsent, true);
      if (suffix === "") await mkdir(path);
      else await writeFile(path, "held\n");
      await assert.rejects(
        verifyV4PrecallAbsenceAt(root),
        /session or lock state/iu,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("exclusive initializer rejects aliases and never removes a foreign race winner", async () => {
  const { root } = await fixture();
  const alias = `${root}-alias`;
  try {
    await symlink(root, alias, "junction");
    await assert.rejects(
      exerciseV4ExclusiveInitializerForTest({ stateRoot: alias }),
      /identity|alias/iu,
    );
    const foreignMarker = join(
      root,
      "session-3DD21321009BFABD87CB1904",
      "foreign.txt",
    );
    await assert.rejects(
      exerciseV4ExclusiveInitializerForTest({
        stateRoot: root,
        afterLock: async ({ sessionDirectory }) => {
          await mkdir(sessionDirectory);
          await writeFile(foreignMarker, "foreign\n");
        },
      }),
      /appeared/iu,
    );
    assert.equal(await readFile(foreignMarker, "utf8"), "foreign\n");
    assert.equal(
      (await readdir(root)).includes(
        "session-3DD21321009BFABD87CB1904.authorization.lock",
      ),
      false,
    );
  } finally {
    await rm(alias, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("exclusive initializer rejects a run-lock race under authorization lock", async () => {
  const { root } = await fixture();
  try {
    await assert.rejects(
      exerciseV4ExclusiveInitializerForTest({
        stateRoot: root,
        afterLock: async ({ runLockPath }) => {
          await writeFile(runLockPath, "foreign-run-lock\n");
        },
      }),
      /run lock appeared/iu,
    );
    assert.equal(
      await readFile(
        join(root, "session-3DD21321009BFABD87CB1904.run.lock"),
        "utf8",
      ),
      "foreign-run-lock\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Gemini V4 request spells the exact closed contract with provider-compatible enum", () => {
  const request = buildGeminiV4QualificationRequest({
    path: "gemini_direct",
    providerId: "google",
    requestedModelId: "gemini-3.6-flash",
    expectedServedModelId: "gemini-3.6-flash",
  });
  const body = JSON.parse(request.body);
  assert.deepEqual(
    body.generationConfig.responseJsonSchema.properties.fixtureId.enum,
    ["S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN"],
  );
  assert.equal(
    "const" in body.generationConfig.responseJsonSchema.properties.fixtureId,
    false,
  );
  assert.deepEqual(body.generationConfig.responseJsonSchema.required, [
    "fixtureId",
    "answer",
    "sourceSummary",
  ]);
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.deepEqual(
    Object.keys(body.generationConfig.responseJsonSchema).sort(),
    ["additionalProperties", "properties", "required", "type"],
  );
  assert.deepEqual(
    Object.keys(body.generationConfig.responseJsonSchema.properties).sort(),
    ["answer", "fixtureId", "sourceSummary"],
  );
  assert.equal(body.generationConfig.maxOutputTokens, 2048);
  assert.match(
    body.contents[0].parts[0].text,
    /exactly these keys: fixtureId, answer, sourceSummary/u,
  );
  assert.match(request.requestDigest, /^[A-F0-9]{64}$/u);
});

test("Gemini V4 accepts one final JSON text after thought and signature parts", () => {
  const result = parseGeminiV4Candidate(
    candidate([
      { thought: true, text: "private reasoning is not retained" },
      { thoughtSignature: "signature-only" },
      { text: JSON.stringify(validOutput()) },
    ]),
  );
  assert.equal(result.telemetry.partCount, 3);
  assert.equal(result.telemetry.thoughtPartCount, 1);
  assert.equal(result.telemetry.signatureOnlyPartCount, 1);
  assert.equal(result.telemetry.finalTextPartCount, 1);
  assert.match(result.telemetry.textDigest, /^[A-F0-9]{64}$/u);
  assert.equal(result.telemetry.rawTextPersisted, false);
  assert.deepEqual(result.content, validOutput());
});

test("Gemini V4 emits exact typed closed-output failures", () => {
  const cases = [
    [candidate([]), "TEXT_ABSENT"],
    [candidate([{}]), "OUTPUT_KEYS"],
    [candidate([{ thought: false }]), "OUTPUT_KEYS"],
    [candidate([{}, { text: JSON.stringify(validOutput()) }]), "OUTPUT_KEYS"],
    [
      candidate([{ thought: false }, { text: JSON.stringify(validOutput()) }]),
      "OUTPUT_KEYS",
    ],
    [candidate([{ thought: true, text: "reasoning" }]), "TEXT_ABSENT"],
    [
      candidate([
        { text: JSON.stringify(validOutput()) },
        { text: JSON.stringify(validOutput()) },
      ]),
      "TEXT_PART_CARDINALITY",
    ],
    [candidate([{ text: "x".repeat(32_769) }]), "TEXT_LIMIT"],
    [candidate([{ text: "```json\n{}\n```" }]), "JSON_SYNTAX"],
    [candidate([{ text: "not-json" }]), "JSON_SYNTAX"],
    [
      candidate([{ text: JSON.stringify({ ...validOutput(), extra: true }) }]),
      "OUTPUT_KEYS",
    ],
    [
      candidate([
        { text: JSON.stringify({ answer: "a", sourceSummary: "s" }) },
      ]),
      "OUTPUT_KEYS",
    ],
    [
      candidate([
        { text: JSON.stringify(validOutput({ fixtureId: "neighbor" })) },
      ]),
      "FIXTURE",
    ],
    [
      candidate([{ text: JSON.stringify(validOutput({ answer: "" })) }]),
      "ANSWER",
    ],
    [
      candidate([
        { text: JSON.stringify(validOutput({ answer: "a".repeat(501) })) },
      ]),
      "ANSWER",
    ],
    [
      candidate([
        { text: JSON.stringify(validOutput({ sourceSummary: " summary " })) },
      ]),
      "SOURCE_SUMMARY",
    ],
    [candidate([{ text: "{}", executableCode: "forbidden" }]), "OUTPUT_KEYS"],
  ];
  for (const [input, phase] of cases) {
    assert.throws(
      () => parseGeminiV4Candidate(input),
      (error) => {
        assert.ok(error instanceof GeminiV4OutputError);
        assert.equal(error.phase, phase);
        assert.equal(error.telemetry.rawTextPersisted, false);
        assert.equal("text" in error.telemetry, false);
        return true;
      },
    );
  }
  assert.doesNotThrow(() =>
    parseGeminiV4Candidate(
      candidate([
        {
          text: JSON.stringify(
            validOutput({
              answer: "a".repeat(500),
              sourceSummary: "s".repeat(500),
            }),
          ),
        },
      ]),
    ),
  );
});

test("non-2xx and malformed credential envelopes reduce to closed digest-only evidence", async () => {
  const scenarios = [
    response(
      { error: { code: "invalid_api_key", message: "secret-shaped" } },
      401,
    ),
    response({ error: { type: "forbidden", message: "Bearer hidden" } }, 403),
    response("redirect", 302),
    response("not-json", 200),
  ];
  for (const scenario of scenarios) {
    const record = await reduceCredentialResponseForV4(scenario);
    assert.equal(record.disposition, "BLOCKED_CREDENTIAL");
    assert.equal(record.providerModelPosts, 0);
    assert.equal(record.credentialValuePersisted, false);
    assert.equal(JSON.stringify(record).includes("secret-shaped"), false);
    assert.equal(JSON.stringify(record).includes("Bearer hidden"), false);
    assert.equal(
      record.sanitizedEnvelopeDigest,
      createHash("sha256")
        .update(JSON.stringify(record.sanitizedEnvelope))
        .digest("hex")
        .toUpperCase(),
    );
  }
  const ready = await reduceCredentialResponseForV4(
    response({ data: { is_free_tier: false } }),
  );
  assert.deepEqual(Object.keys(ready).sort(), [
    "costAmountUsd",
    "costState",
    "credentialValuePersisted",
    "disposition",
    "providerModelPosts",
    "sanitizedEnvelopeDigest",
    "schemaVersion",
  ]);
  assert.equal(ready.disposition, "READY_TO_INITIALIZE");
  assert.match(ready.sanitizedEnvelopeDigest, /^[A-F0-9]{64}$/u);
});

test("credential envelope reader enforces declared and streamed byte caps", async () => {
  await assert.rejects(
    reduceCredentialResponseForV4(
      new Response("{}", {
        status: 401,
        headers: { "content-length": "32769" },
      }),
    ),
    /declared bound/iu,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(20_000));
      controller.enqueue(new Uint8Array(20_000));
      controller.close();
    },
  });
  await assert.rejects(
    reduceCredentialResponseForV4(new Response(stream, { status: 401 })),
    /streamed bound/iu,
  );
  const hanging = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    reduceCredentialResponseForV4(new Response(hanging, { status: 401 }), {
      timeoutMs: 5,
    }),
    /timed out/iu,
  );
});

function resultRecord(
  callNumber,
  terminalDisposition,
  costState,
  costAmountUsd,
) {
  return {
    digest: String(callNumber).repeat(64),
    event: {
      schemaVersion: "slice3-live-qualification-result-event.v4",
      authorizationId:
        "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-18-V4",
      sessionId: "session-3DD21321009BFABD87CB1904",
      callNumber,
      terminalDisposition,
      costState,
      costAmountUsd,
      activation: false,
    },
  };
}

test("terminal failure accounting is derived from exact ordered result records", () => {
  const partial = deriveV4TerminalFailure([
    resultRecord(1, "FAIL", "conservative_estimate", 0.0241835),
  ]);
  assert.equal(partial.callsConsumed, 1);
  assert.equal(partial.expiredUnusedSlots, 1);
  assert.equal(partial.aggregateCostState, "known_partial_total");
  assert.equal(partial.activation, false);
  assert.equal(Object.isFrozen(partial.resultDigests), true);
  const complete = deriveV4TerminalFailure([
    resultRecord(1, "PASS", "provider_reported", 0.01),
    resultRecord(2, "FAIL", "provider_reported", 0.02),
  ]);
  assert.equal(complete.aggregateCostState, "known_total");
  assert.equal(complete.knownCostUsd, 0.03);
  assert.throws(
    () =>
      deriveV4TerminalFailure([
        resultRecord(1, "FAIL", "provider_reported", 101),
      ]),
    /cost cap/iu,
  );
  assert.throws(
    () =>
      deriveV4TerminalFailure([
        resultRecord(2, "FAIL", "provider_reported", 1),
      ]),
    /identity/iu,
  );
  const unknown = deriveV4TerminalFailure([
    resultRecord(1, "FAIL", "unknown", null),
  ]);
  assert.equal(unknown.aggregateCostState, "contains_unknown");
  assert.equal(unknown.unknownCostCalls, 1);
  assert.throws(
    () =>
      deriveV4TerminalFailure([
        resultRecord(1, "PASS", "provider_reported", 0.01),
      ]),
    /failure/iu,
  );
  assert.throws(
    () => deriveV4TerminalFailure([resultRecord(1, "FAIL", "unknown", 0.01)]),
    /unknown V4 cost/iu,
  );
});

test("test-only session harness exposes a one-use capability-bound terminal closure", async () => {
  const { root } = await fixture();
  try {
    const harness = await exerciseV4ExclusiveInitializerForTest({
      stateRoot: root,
    });
    const event = resultRecord(
      1,
      "FAIL",
      "conservative_estimate",
      0.0241835,
    ).event;
    const digest = await harness.appendResult(event);
    const terminal = await harness.terminalizeFailure();
    assert.deepEqual(terminal.resultDigests, [digest]);
    assert.equal(terminal.activation, false);
    assert.equal(
      JSON.parse(
        await readFile(
          join(harness.sessionDirectory, "99-terminal-failure.json"),
          "utf8",
        ),
      ).disposition,
      "FAIL",
    );
    await assert.rejects(harness.terminalizeFailure(), /capability/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
