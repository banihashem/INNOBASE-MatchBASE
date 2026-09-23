import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createIsolatedUnitTestEnvironment } from "../../scripts/run-isolated-unit-tests.mjs";

test("MB-UX-GOV-004 L01 unit tests ignore host runtime and provider configuration", () => {
  const isolated = createIsolatedUnitTestEnvironment({
    DATABASE_URL: "postgresql://runtime-user-database",
    MATCHBASE_DATABASE_URL: "postgresql://runtime-user-database",
    MATCHBASE_PROVIDER_ANTHROPIC: "anthropic",
    MATCHBASE_MODEL_SYNTHESIS: "provider/model",
    MATCHBASE_OPENROUTER_API_KEY: "must-not-reach-tests",
    MatchBase_Provider_OpenAi: "openai",
    MatchBase_OpenRouter_Api_Key: "must-not-reach-tests-either",
    OPENROUTER_API_KEY: "must-not-reach-tests",
    PATH: "fixture-path",
  });

  assert.deepEqual(isolated, {
    PATH: "fixture-path",
  });
});

test("MB-UX-GOV-004 L01 unit tests retain an explicitly guarded disposable database", () => {
  const isolated = createIsolatedUnitTestEnvironment({
    DATABASE_URL: "postgresql://postgres@127.0.0.1:55432/matchbase_test",
    MATCHBASE_DATABASE_URL:
      "postgresql://postgres@127.0.0.1:55432/matchbase_test",
    MATCHBASE_DISPOSABLE_TEST_DATABASE_URL:
      "postgresql://postgres@127.0.0.1:55432/matchbase_test",
    MATCHBASE_TEST_DATABASE_GUARD: "required",
  });

  assert.equal(isolated.MATCHBASE_TEST_DATABASE_GUARD, "required");
  assert.equal(
    isolated.MATCHBASE_DISPOSABLE_TEST_DATABASE_URL,
    "postgresql://postgres@127.0.0.1:55432/matchbase_test",
  );
});

test("MB-UX-GOV-004 L01 runtime images retain source identity labels", () => {
  const localDockerfile = readFileSync("Dockerfile.local", "utf8");
  const productionDockerfile = readFileSync("Dockerfile", "utf8");
  const launcher = readFileSync(
    "deployment/local/Manage-LocalDocker.ps1",
    "utf8",
  );

  for (const content of [localDockerfile, productionDockerfile]) {
    assert.match(content, /org\.opencontainers\.image\.version/);
    assert.match(content, /org\.opencontainers\.image\.revision/);
    assert.match(content, /com\.innobase\.matchbase\.source-state/);
  }
  for (const argument of [
    "MATCHBASE_PRODUCT_VERSION",
    "MATCHBASE_SOURCE_REVISION",
    "MATCHBASE_SOURCE_STATE",
  ])
    assert.match(launcher, new RegExp(`--build-arg [^\\n]*${argument}`));
});

test("MB-UX-GOV-004 L01 governed build paths supply exact source identity", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const publisher = readFileSync(
    "deployment/gcp/Publish-StagingImages.ps1",
    "utf8",
  );
  const buildGuide = readFileSync("deployment/gcp/README.md", "utf8");
  const historyScanner = readFileSync(
    "scripts/secret-history-scan.mjs",
    "utf8",
  );

  assert.match(dockerfile, /Image source identity is incomplete/);
  assert.match(publisher, /ConvertFrom-Json\)\.version/);
  assert.match(publisher, /_PRODUCT_VERSION=\$productVersion/);
  assert.equal(
    (buildGuide.match(/MATCHBASE_SOURCE_REVISION=\$sourceRevision/g) ?? [])
      .length,
    2,
  );
  assert.match(historyScanner, /maximumBatchBytes = 16 \* 1024 \* 1024/);
});
