import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

for (const mode of ["reject", "stall"])
  test(`L05 real worker contains original failure before ${mode} diagnostic store`, async () => {
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        fileURLToPath(
          new URL("./fixtures/incident-worker-boundary.mjs", import.meta.url),
        ),
        mode,
      ],
      {
        timeout: 10_000,
        maxBuffer: 16_384,
        windowsHide: true,
        env: Object.fromEntries(
          ["SystemRoot", "WINDIR", "TEMP", "TMP"]
            .filter((key) => process.env[key])
            .map((key) => [key, process.env[key]]),
        ),
      },
    );
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.marked, 1);
    assert.equal(observed.finished, 1);
    assert.equal(observed.heartbeatCleared, true);
    assert.equal(observed.connects, 1);
  });
