import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finalizeQualifiedRoutePolicy } from "../../scripts/qualify-slice3-live.mjs";
import {
  createDurableQualificationSession,
  executeAuthorizedQualification,
  initializeQualificationSessionDirectory,
  isQualificationAuthorizationBinding,
  SLICE3_LIVE_QUALIFICATION_CONSTANTS,
} from "../../scripts/lib/slice3-live-qualification-runner.mjs";

const policy = JSON.parse(
  await readFile(
    new URL(
      "../../config/slice3/research-route-policy.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

const forgedBinding = Object.freeze({
  authorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId,
  ownerDecisionDigest: "A".repeat(64),
  policyDigest: "B".repeat(64),
  consumedV1LedgerDigest: "C".repeat(64),
  consumedV2LedgerDigest: "D".repeat(64),
  v1AuthorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.v1AuthorizationId,
  v2AuthorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.v2AuthorizationId,
  preCallManifestDigest:
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedPreCallStateDigest,
  restartPolicy: "NON_RESUMABLE_NEW_ALLOCATION_REQUIRED",
  maxCalls: 2,
  maxCostUsd: 100,
});

test("plain authorization bindings cannot mint a durable V3 session", async () => {
  const parent = await mkdtemp(join(tmpdir(), "matchbase-v2-forged-"));
  const stateDirectory = join(parent, "state");
  try {
    assert.equal(isQualificationAuthorizationBinding(forgedBinding), false);
    await assert.rejects(
      createDurableQualificationSession({
        stateDirectory,
        routeIds: policy.routes.map((route) => route.routeId),
        authorizationBinding: forgedBinding,
      }),
      /source-anchored authorization capability/iu,
    );
    await assert.rejects(access(stateDirectory));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("prepopulated V3 PASS ledger is rejected without mutation", async () => {
  const stateDirectory = await mkdtemp(
    join(tmpdir(), "matchbase-v3-prepopulated-"),
  );
  const sessionId = SLICE3_LIVE_QUALIFICATION_CONSTANTS.sessionId;
  const sessionDirectory = join(stateDirectory, sessionId);
  const names = [
    "00-authorization.json",
    "01-reserved.json",
    "01-result.json",
    "02-reserved.json",
    "02-result.json",
    "03-final.json",
  ];
  try {
    await mkdir(sessionDirectory);
    for (const name of names) {
      await writeFile(
        join(sessionDirectory, name),
        `${JSON.stringify({ forged: true, name })}\n`,
        "utf8",
      );
    }
    const before = await Promise.all(
      names.map(async (name) => [
        name,
        await readFile(join(sessionDirectory, name), "utf8"),
      ]),
    );
    await assert.rejects(
      initializeQualificationSessionDirectory({
        stateDirectory,
        sessionId,
        authorization: { forged: false },
      }),
      /non-resumable|not absent/iu,
    );
    const after = await Promise.all(
      names.map(async (name) => [
        name,
        await readFile(join(sessionDirectory, name), "utf8"),
      ]),
    );
    assert.deepEqual(after, before);
    assert.deepEqual((await readdir(stateDirectory)).sort(), [sessionId]);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("exclusive parent authorization lock admits exactly one V3 initializer", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "matchbase-v3-race-"));
  const sessionId = SLICE3_LIVE_QUALIFICATION_CONSTANTS.sessionId;
  const authorization = { authorizationId: "V3-TEST" };
  try {
    const outcomes = await Promise.allSettled([
      initializeQualificationSessionDirectory({
        stateDirectory,
        sessionId,
        authorization,
      }),
      initializeQualificationSessionDirectory({
        stateDirectory,
        sessionId,
        authorization,
      }),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "rejected").length,
      1,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(stateDirectory, sessionId, "00-authorization.json"),
          "utf8",
        ),
      ),
      authorization,
    );
    assert.deepEqual((await readdir(stateDirectory)).sort(), [sessionId]);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("V3 restart and pre-call manifest drift fail closed", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "matchbase-v3-restart-"));
  const sessionId = SLICE3_LIVE_QUALIFICATION_CONSTANTS.sessionId;
  const authorization = { authorizationId: "V3-TEST" };
  try {
    await initializeQualificationSessionDirectory({
      stateDirectory,
      sessionId,
      authorization,
    });
    await assert.rejects(
      initializeQualificationSessionDirectory({
        stateDirectory,
        sessionId,
        authorization,
      }),
      /non-resumable|not absent/iu,
    );
    const manifest = SLICE3_LIVE_QUALIFICATION_CONSTANTS.preCallManifest;
    assert.equal(
      sha256(JSON.stringify(manifest)),
      SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedPreCallStateDigest,
    );
    assert.notEqual(
      sha256(
        JSON.stringify({
          ...manifest,
          v3SessionState: "PRESENT",
        }),
      ),
      SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedPreCallStateDigest,
    );
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("forged READY preflight is rejected before credential or state access", async () => {
  let posts = 0;
  await assert.rejects(
    executeAuthorizedQualification({
      policy,
      policyFile: "C:\\does-not-exist\\policy.json",
      ownerDecisionFile: "C:\\does-not-exist\\owner.json",
      stateDirectory: "C:\\does-not-exist\\state",
      credentialFile: "C:\\does-not-exist\\keys.md",
      preflight: {
        schemaVersion: "slice3-live-qualification-preflight.v4",
        disposition: "READY_TO_QUALIFY",
        authorizationBinding: forgedBinding,
      },
      budget: { maxCalls: 2, maxCostUsd: 100 },
      fetchImpl: async () => {
        posts += 1;
        throw new Error("must not execute");
      },
    }),
    /not source-anchored|authorization/iu,
  );
  assert.equal(posts, 0);
});

test("policy activation rejects fabricated PASS state and detached attestations", () => {
  assert.throws(
    () =>
      finalizeQualifiedRoutePolicy({
        policy,
        qualificationAttestation: {
          schemaVersion: "slice3-live-qualification-attestation.v3",
          authorizationId: SLICE3_LIVE_QUALIFICATION_CONSTANTS.authorizationId,
          ledgerDigest: "A".repeat(64),
          stateDigest: "B".repeat(64),
          state: { finalized: true },
        },
        finalizedAt: "2026-08-16T00:00:00.000Z",
      }),
    /ledger-backed attestation/iu,
  );
});

test("replacement signal and reviewed owner decision digest are exact", () => {
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.v3AuthorizationSignal,
    "I_AUTHORIZE_TWO_REPLACEMENT_BILLABLE_SYNTHETIC_CALLS_V3",
  );
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.ownerDecisionDigest,
    "B112BF95B40F06787568F71207D6A0A5A1C9F022F9C6F5BB1353D212127FA362",
  );
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.sessionId,
    "session-19AD2D3117AF9064AF90F879",
  );
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedPolicyDigest,
    "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23",
  );
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedConsumedV1LedgerDigest,
    "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8",
  );
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedConsumedV2LedgerDigest,
    "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748",
  );
  assert.equal(
    SLICE3_LIVE_QUALIFICATION_CONSTANTS.expectedPreCallStateDigest,
    "3093D90B8C1AEC943A2914C1D110AE3FCE836FFCC07FC4187F08BE9F0AADAB89",
  );
});
