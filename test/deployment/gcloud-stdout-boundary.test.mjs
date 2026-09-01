import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const helper = fileURLToPath(
  new URL("../../deployment/gcp/Invoke-GcloudStdout.ps1", import.meta.url),
);
const fixture = fileURLToPath(
  new URL("./fixtures/gcloud-stream-fixture.mjs", import.meta.url),
);
const quoted = (value) => `'${value.replaceAll("'", "''")}'`;

test("JSON stdout remains parseable when successful gcloud writes informational stderr", () => {
  const command = `. ${quoted(helper)}; Invoke-GcloudStdout -Executable node -Arguments @(${quoted(fixture)},'success')`;
  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-Command", command],
    { cwd: root, encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output), { name: "closed" });
  assert.doesNotMatch(output, /Encryption|Repository Size/u);
});

test("nonzero gcloud fails with bounded stderr and never returns stdout", () => {
  const command = `. ${quoted(helper)}; Invoke-GcloudStdout -Executable node -Arguments @(${quoted(fixture)},'failure') -MaximumDiagnosticCharacters 512`;
  assert.throws(
    () =>
      execFileSync("powershell", ["-NoProfile", "-Command", command], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      }),
    (error) => {
      const diagnostic = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      return (
        /gcloud failed \(7\)/u.test(diagnostic) &&
        /permission denied/u.test(diagnostic) &&
        !/must-not-be-used/u.test(diagnostic) &&
        !/x{1000}/u.test(diagnostic)
      );
    },
  );
});
