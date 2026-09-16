import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradeSyntheticObservations,
  readCandidateObservations,
  MAX_OBSERVATION_BYTES,
} from "../../deployment/incident-repair/evaluation.mjs";

const execute = promisify(execFile);
const probe = fileURLToPath(
  new URL(
    "../../deployment/incident-repair/fixtures/candidate-probe.mjs",
    import.meta.url,
  ),
);
async function runCandidate(source) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "matchbase-evaluation-test-"),
  );
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  try {
    const candidate = path.join(directory, "candidate.mjs");
    await writeFile(candidate, source);
    return await execute(process.execPath, [probe, candidate], {
      timeout: 1500,
      maxBuffer: MAX_OBSERVATION_BYTES,
      windowsHide: true,
      env: Object.fromEntries(
        ["SystemRoot", "WINDIR", "TEMP", "TMP"]
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      ),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("L05 oracle grades data outside the candidate process", async () => {
  const correct = await runCandidate(
    "export function attemptsAllowed(value) { return value; }",
  );
  assert.equal(gradeSyntheticObservations(correct.stdout), true);
  const incorrect = await runCandidate(
    "export function attemptsAllowed(value) { return value + 1; }",
  );
  assert.equal(gradeSyntheticObservations(incorrect.stdout), false);
});

test("L05 candidate assertion mutation cannot change external acceptance", async () => {
  const result = await runCandidate(
    "import assert from 'node:assert/strict'; assert.equal = () => {}; export function attemptsAllowed() { return 999; }",
  );
  assert.equal(gradeSyntheticObservations(result.stdout), false);
  assert.throws(() => assert.equal(999, 1));
});

test("L05 early successful exit and success-string spoof do not grant acceptance", async () => {
  for (const source of [
    "process.exit(0);",
    "console.log('Protected synthetic acceptance passed'); process.exit(0);",
  ]) {
    const result = await runCandidate(source);
    assert.throws(() => gradeSyntheticObservations(result.stdout));
  }
});

test("L05 oversized output and stalled candidate are terminated", async () => {
  await assert.rejects(
    runCandidate("process.stdout.write('x'.repeat(20000));"),
    (error) => error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  );
  await assert.rejects(
    runCandidate("setInterval(() => {}, 1000); await new Promise(() => {});"),
    (error) => error.killed === true,
  );
});

test("L05 malformed, duplicated and authority-bearing outputs are rejected", () => {
  const good = {
    version: "candidate-observations.v1",
    observations: [0, 1, 3, 5, 12, 24].map((value, index) => ({
      case_id: `case-${index}`,
      value,
    })),
  };
  assert.equal(
    readCandidateObservations(JSON.stringify(good)).observations.length,
    6,
  );
  const duplicate = structuredClone(good);
  duplicate.observations[1].case_id = "case-0";
  const objectValue = structuredClone(good);
  objectValue.observations[0].value = { valueOf: 0 };
  for (const value of [
    duplicate,
    objectValue,
    { ...good, accepted: true },
    { ...good, observations: good.observations.slice(1) },
  ])
    assert.throws(() => gradeSyntheticObservations(JSON.stringify(value)));
  assert.throws(() =>
    readCandidateObservations(" ".repeat(MAX_OBSERVATION_BYTES + 1)),
  );
});
