import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateV5ReplayRegistryBytes } from "../../scripts/lib/slice3-v5-replay-registry.mjs";
import { V5_TPM_CONTRACT } from "../../scripts/lib/slice3-v5-role2-tpm-verifier.mjs";
import {
  inspectV5ReplayRegistryAt,
  reserveV5ReplayIdentityAt,
} from "./support/v5-replay-registry-test-harness.mjs";

const BASELINE_PATH = "test/slice3/fixtures/v5-replay-predecessor-seq1.jsonl";

function identity() {
  return {
    workspaceClaim: V5_TPM_CONTRACT.workspaceClaim,
    canonicalNonClonedWorkspaceOnly: true,
    decisionId: V5_TPM_CONTRACT.decisionId,
    sessionId: V5_TPM_CONTRACT.sessionId,
    nonce: V5_TPM_CONTRACT.nonce,
    keyId: V5_TPM_CONTRACT.keyId,
    registryPath: V5_TPM_CONTRACT.replayRegistryPath,
    registryPreSignSha256: V5_TPM_CONTRACT.replayPreSignSha256,
    registryPreSignBytes: V5_TPM_CONTRACT.replayPreSignBytes,
    registryPreSignRecordCount: V5_TPM_CONTRACT.replayPreSignRecordCount,
    registryPreSignLastSequence: V5_TPM_CONTRACT.replayPreSignLastSequence,
    registryPreSignTailSha256: V5_TPM_CONTRACT.replayPreSignTailSha256,
    nonceAbsentBeforeSign: true,
  };
}

test("exact 671-byte predecessor is accepted and empty rollback is rejected", async () => {
  const baseline = await readFile(BASELINE_PATH);
  const value = validateV5ReplayRegistryBytes(baseline);
  assert.equal(value.byteLength, 671);
  assert.equal(
    value.digest,
    "E28CE25E057EFF410BDCD0812CFC3E43BD6ECBE520DBC07FE1C31BAFA4057A87",
  );
  assert.equal(value.records.length, 1);
  assert.equal(value.records[0].sequence, 1);
  assert.equal(
    value.lastRecordSha256,
    "D1D0EE0DE2A545D0395427565EB154E0F7B70D93265BF42C3E013D8A705765EB",
  );
  assert.throws(
    () => validateV5ReplayRegistryBytes(Buffer.alloc(0)),
    /empty rollback/u,
  );
  assert.throws(() => validateV5ReplayRegistryBytes(baseline.subarray(0, -1)));
});

test("successor reservation is one-winner sequence 2 and restart-safe", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "matchbase-v5-s2-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registryRoot = join(root, "registry");
  const registryPath = join(registryRoot, "consumed-v5.jsonl");
  await mkdir(registryRoot);
  await writeFile(registryPath, await readFile(BASELINE_PATH), { flag: "wx" });
  const input = {
    registryPath,
    replayIdentity: identity(),
    payloadSha256: "A".repeat(64),
    observedAt: "2026-08-23T09:00:00Z",
  };
  const attempts = await Promise.allSettled([
    reserveV5ReplayIdentityAt(input),
    reserveV5ReplayIdentityAt(input),
  ]);
  assert.equal(
    attempts.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.filter(({ status }) => status === "rejected").length,
    1,
  );
  const record = attempts.find(({ status }) => status === "fulfilled").value;
  assert.equal(record.sequence, 2);
  assert.equal(
    record.previousRecordSha256,
    V5_TPM_CONTRACT.replayPreSignTailSha256,
  );
  const terminal = await inspectV5ReplayRegistryAt(registryPath, identity());
  assert.equal(terminal.records.length, 2);
  assert.equal(terminal.identityUsed, true);
  await assert.rejects(reserveV5ReplayIdentityAt(input), /stale|consumed/u);
});

test("predecessor replacement, reordering, and successor identity drift are rejected", async () => {
  const baseline = await readFile(BASELINE_PATH, "utf8");
  const record = JSON.parse(baseline);
  for (const mutation of [
    { ...record, sessionId: V5_TPM_CONTRACT.sessionId },
    { ...record, sequence: 2 },
    { ...record, recordSha256: "F".repeat(64) },
  ])
    assert.throws(() =>
      validateV5ReplayRegistryBytes(
        Buffer.from(`${JSON.stringify(mutation)}\n`, "utf8"),
      ),
    );
});
