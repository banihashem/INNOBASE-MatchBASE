import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(
  new URL(
    "../../deployment/gcp/Invoke-BoundedProvenanceProbe.ps1",
    import.meta.url,
  ),
);
const run = (body) =>
  spawnSync("pwsh", ["-NoProfile", "-Command", `. '${helper}'; ${body}`], {
    encoding: "utf8",
  });

test("probe six at t=15 is admitted without real sleep", () => {
  const result = run(
    '$script:probes=0; $script:delays=0; $value=Invoke-BoundedProvenanceProbe -Attempt { param($n) $script:probes++; if($n -eq 6){ return "admitted" }; return $null } -Delay { param($s) $script:delays++ }; "$value|$script:probes|$script:delays"',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "admitted|6|5");
});

test("timeout performs exactly 16 probes and 15 delays", () => {
  const result = run(
    '$script:probes=0; $script:delays=0; try { Invoke-BoundedProvenanceProbe -Attempt { param($n) $script:probes++; return $null } -Delay { param($s) $script:delays++ } } catch { "THREW|$script:probes|$script:delays|$($_.Exception.Message)" }',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^THREW\|16\|15\|.*45-second window/u);
});
