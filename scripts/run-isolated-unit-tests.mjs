import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const retainedTestVariables = new Set([
  "MATCHBASE_ENVIRONMENT",
  "MATCHBASE_OIDC_SIMULATOR",
  "MATCHBASE_ORIGIN",
  "MATCHBASE_SYNTHETIC_FIXTURE",
]);

const retainedDatabaseVariables = new Set([
  "DATABASE_URL",
  "MATCHBASE_CONSULTANT_TEST_DATABASE_URL",
  "MATCHBASE_DATABASE_URL",
  "MATCHBASE_DISPOSABLE_TEST_DATABASE_URL",
  "MATCHBASE_TEST_DATABASE_GUARD",
]);

const externalProviderVariables = new Set([
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
]);

export function createIsolatedUnitTestEnvironment(source = process.env) {
  const environment = {};
  const normalizedSource = new Map(
    Object.entries(source).map(([name, value]) => [name.toUpperCase(), value]),
  );
  const retainDisposableDatabase =
    normalizedSource.get("MATCHBASE_TEST_DATABASE_GUARD") === "required" &&
    typeof normalizedSource.get("MATCHBASE_DISPOSABLE_TEST_DATABASE_URL") ===
      "string" &&
    normalizedSource.get("MATCHBASE_DISPOSABLE_TEST_DATABASE_URL").length > 0;
  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toUpperCase();
    if (
      retainedDatabaseVariables.has(normalizedName) &&
      !retainDisposableDatabase
    )
      continue;
    const isMatchBaseRuntimeSetting =
      normalizedName.startsWith("MATCHBASE_") &&
      !retainedTestVariables.has(normalizedName) &&
      !retainedDatabaseVariables.has(normalizedName);
    if (
      isMatchBaseRuntimeSetting ||
      externalProviderVariables.has(normalizedName)
    )
      continue;
    environment[name] = value;
  }
  return environment;
}

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const environment = createIsolatedUnitTestEnvironment();
  const pnpmEntryPoint = environment.npm_execpath;
  if (!pnpmEntryPoint)
    throw new Error("pnpm must invoke the isolated unit-test runner.");
  run(
    process.execPath,
    [pnpmEntryPoint, "-r", "--workspace-concurrency=1", "--if-present", "test"],
    environment,
  );
  run(
    process.execPath,
    [
      "--test",
      "deployment/local/*.test.mjs",
      "test/local-model/*.test.mjs",
      "test/incident-repair/*.test.mjs",
    ],
    environment,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
