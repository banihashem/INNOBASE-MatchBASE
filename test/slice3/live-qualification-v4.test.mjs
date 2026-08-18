import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GeminiV4OutputError,
  assessCurrentV4Disposition,
  buildGeminiV4QualificationRequest,
  createV4SourceBinding,
  deriveV4TerminalFailure,
  executeCurrentV4PreCall,
  exerciseV4ExclusiveInitializerForTest,
  parseGeminiV4Candidate,
  reduceCredentialResponseForV4,
  slice3V4QualificationConstants,
  verifyImmutableV3Ledger,
  verifyV4PrecallAbsenceAt,
} from "../../scripts/lib/slice3-live-qualification-v4.mjs";
import * as v4Module from "../../scripts/lib/slice3-live-qualification-v4.mjs";

const canonicalState =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state";
const v3Names = slice3V4QualificationConstants.v3Manifest.map(
  ({ name }) => name,
);

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

async function copyV3(targetRoot) {
  const source = join(canonicalState, "session-19AD2D3117AF9064AF90F879");
  const target = join(targetRoot, "session-19AD2D3117AF9064AF90F879");
  await mkdir(target, { recursive: true });
  for (const name of v3Names) {
    await copyFile(join(source, name), join(target, name));
  }
  return target;
}

test("current V4 source binding remains credential-blocked without a session", async () => {
  const binding = await createV4SourceBinding();
  const result = assessCurrentV4Disposition(binding);
  assert.deepEqual(result, {
    schemaVersion: "slice3-live-qualification-precall.v4",
    disposition: "BLOCKED_CREDENTIAL",
    authorizationId:
      "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-18-V4",
    sessionId: "session-3DD21321009BFABD87CB1904",
    credentialPreflightHttpStatus: 401,
    credentialRead: false,
    additionalAuthorizationGets: 0,
    providerModelPosts: 0,
    billableCalls: 0,
    sessionCreated: false,
    activation: false,
  });
  assert.equal(
    (await readdir(canonicalState)).includes(result.sessionId),
    false,
  );
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return response({ data: { is_free_tier: false } });
  };
  try {
    assert.deepEqual(await executeCurrentV4PreCall(binding), result);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
  assert.equal("probeOpenRouterCredentialForV4" in v4Module, false);
  assert.equal("initializeV4SessionWithCapability" in v4Module, false);
  assert.equal("appendV4TerminalFailure" in v4Module, false);
});

test("forged and detached V4 source bindings cannot assess or execute", async () => {
  const genuine = await createV4SourceBinding();
  const forged = { ...genuine };
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
});

test("immutable V3 binding rejects extra, missing, and changed bytes", async () => {
  for (const kind of ["extra", "missing", "changed"]) {
    const { root } = await fixture();
    try {
      const session = await copyV3(root);
      assert.equal(
        (await verifyImmutableV3Ledger(root)).ledgerDigest,
        "3030B12726EB31DA43BBEBD19E9D5C0E819AB5857371FBC843CF3F7D759F7BC8",
      );
      if (kind === "extra")
        await writeFile(join(session, "extra.json"), "{}\n");
      if (kind === "missing") await rm(join(session, v3Names[2]));
      if (kind === "changed") {
        await appendFile(join(session, v3Names[2]), " ");
      }
      await assert.rejects(verifyImmutableV3Ledger(root), /V3 ledger/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
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
