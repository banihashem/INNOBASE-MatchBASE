import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateLocalConfig } from "./config.mjs";

const helper = fileURLToPath(
  new URL("./LocalRuntimeEnvironment.ps1", import.meta.url),
);
const launcher = readFileSync(
  new URL("./Manage-LocalDocker.ps1", import.meta.url),
  "utf8",
);
const isolatedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|PROGRAMFILES|PROGRAMFILES\(X86\)|TEMP|TMP)$/i.test(
      name,
    ),
  ),
);
const shell = [
  "pwsh",
  ...(process.platform === "win32" ? ["powershell"] : []),
].find(
  (binary) =>
    spawnSync(
      binary,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"],
      {
        env: isolatedEnvironment,
        timeout: 10000,
        windowsHide: true,
      },
    ).status === 0,
);
function evaluateHelper(source) {
  const script = `$ErrorActionPreference = 'Stop'\n. '${helper.replaceAll("'", "''")}'\n${source}`;
  const result = spawnSync(
    shell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      env: isolatedEnvironment,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

test("MB-UX-QUALITY-001 L07 the launcher uses the shared import and test isolation boundaries", () => {
  assert.match(
    launcher,
    /\. \(Join-Path \$PSScriptRoot 'LocalRuntimeEnvironment\.ps1'\)/,
  );
  assert.match(launcher, /\$runtime = Get-LocalRuntimeEnvironment/);
  assert.match(launcher, /Get-LocalTestEnvironmentNames -ExistingNames/);
});

test(
  "MB-UX-QUALITY-001 L07 actual PowerShell import preserves model/provider overrides and User precedence without reading live credentials",
  {
    skip: shell
      ? false
      : "PowerShell is unavailable; host qualification executes this boundary",
  },
  () => {
    const result = evaluateHelper(`
    $requests = [System.Collections.Generic.List[string]]::new()
    $userValues = @{
      MATCHBASE_MODEL_GEMINI = 'google/gemini-user-choice'
      MATCHBASE_PROVIDER_DEEPSEEK = 'deepseek'
    }
    $processValues = @{
      MATCHBASE_DATABASE_URL = 'postgresql://postgres:5432/matchbase_slice1'
      MATCHBASE_DIGEST_KEY = 'synthetic-local-test-material-32-bytes'
      MATCHBASE_MODEL_GEMINI = 'google/gemini-process-choice'
      MATCHBASE_MODEL_OPENAI = 'openai/qualified-model'
      MATCHBASE_MODEL_PREPARATION = 'google/gemini-user-choice'
      MATCHBASE_MODEL_SYNTHESIS = 'openai/qualified-model'
      MATCHBASE_PROVIDER_GOOGLE = 'google-ai-studio'
      MATCHBASE_PROVIDER_OPENAI = 'openai'
      MATCHBASE_PROVIDER_ANTHROPIC = 'anthropic'
      MATCHBASE_PROVIDER_DEEPSEEK = 'ignored-process-route'
      MATCHBASE_PROVIDER_XAI = 'xai'
      MATCHBASE_PROVIDER_ROUTES = '{}'
      NEXT_PUBLIC_MATCHBASE_MODEL_GEMINI = 'must-not-import'
      MATCHBASE_GEMINI_API_KEY = 'must-not-import'
      DEEPSEEK_API_KEY = 'must-not-import'
      MATCHBASE_MODEL_UNREVIEWED = 'must-not-import'
    }
    $reader = {
      param($name, $target)
      $requests.Add($target + ':' + $name)
      if ($target -eq 'User') { return $userValues[$name] }
      return $processValues[$name]
    }
    $runtime = Get-LocalRuntimeEnvironment -ReadEnvironment $reader
    @{ runtime = $runtime; requested = @($requests) } | ConvertTo-Json -Depth 4 -Compress
  `);
    assert.equal(
      result.runtime.MATCHBASE_MODEL_GEMINI,
      "google/gemini-user-choice",
    );
    assert.equal(result.runtime.MATCHBASE_PROVIDER_DEEPSEEK, "deepseek");
    assert.equal(
      result.runtime.MATCHBASE_MODEL_OPENAI,
      "openai/qualified-model",
    );
    assert.equal(
      result.runtime.MATCHBASE_MODEL_PREPARATION,
      "google/gemini-user-choice",
    );
    assert.equal(
      result.runtime.MATCHBASE_MODEL_SYNTHESIS,
      "openai/qualified-model",
    );
    for (const family of ["GOOGLE", "OPENAI", "ANTHROPIC", "DEEPSEEK", "XAI"])
      assert.equal(
        typeof result.runtime[`MATCHBASE_PROVIDER_${family}`],
        "string",
      );
    assert.equal(result.runtime.MATCHBASE_OPENROUTER_API_KEY, undefined);
    assert.equal(
      result.requested.includes("Process:MATCHBASE_MODEL_GEMINI"),
      false,
    );
    for (const name of [
      "NEXT_PUBLIC_MATCHBASE_MODEL_GEMINI",
      "MATCHBASE_GEMINI_API_KEY",
      "DEEPSEEK_API_KEY",
      "MATCHBASE_MODEL_UNREVIEWED",
    ])
      assert.equal(
        result.requested.some((entry) => entry.endsWith(`:${name}`)),
        false,
      );
    const config = {
      ...result.runtime,
      DATABASE_URL: result.runtime.MATCHBASE_DATABASE_URL,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_OIDC_SIMULATOR: "true",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_ORIGIN: "http://localhost:3000",
    };
    assert.deepEqual(validateLocalConfig(config), config);
  },
);

test(
  "MB-UX-QUALITY-001 L07 Build isolation removes every model override and provider setting while preserving ordinary process settings",
  {
    skip: shell
      ? false
      : "PowerShell is unavailable; host qualification executes this boundary",
  },
  () => {
    const existing = [
      "MATCHBASE_MODEL_GEMINI",
      "MATCHBASE_MODEL_OPENAI",
      "MATCHBASE_MODEL_PREPARATION",
      "MATCHBASE_MODEL_SYNTHESIS",
      "MATCHBASE_MODEL_FUTURE",
      "MATCHBASE_PROVIDER_GOOGLE",
      "MATCHBASE_PROVIDER_OPENAI",
      "MATCHBASE_PROVIDER_ANTHROPIC",
      "MATCHBASE_PROVIDER_DEEPSEEK",
      "MATCHBASE_PROVIDER_XAI",
      "MATCHBASE_PROVIDER_ROUTES",
      "MATCHBASE_OPENROUTER_API_KEY",
      "OPENROUTER_API_KEY",
      "DEEPSEEK_API_KEY",
      "PGHOST",
      "PGPASSWORD",
      "PATH",
      "SYSTEMROOT",
      "NODE_ENV",
    ];
    const literal = existing.map((name) => `'${name}'`).join(",");
    const actual = evaluateHelper(
      `@(Get-LocalTestEnvironmentNames -ExistingNames @(${literal})) | ConvertTo-Json -Compress`,
    );
    for (const name of existing.filter(
      (name) => !["PATH", "SYSTEMROOT", "NODE_ENV"].includes(name),
    ))
      assert.ok(actual.includes(name), `${name} must be cleared before tests`);
    for (const name of ["PATH", "SYSTEMROOT", "NODE_ENV"])
      assert.equal(actual.includes(name), false);
    assert.ok(actual.includes("MATCHBASE_DISPOSABLE_TEST_DATABASE_URL"));
    assert.equal(actual.length, new Set(actual).size);
  },
);
