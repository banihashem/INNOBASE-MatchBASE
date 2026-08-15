import { spawnSync } from "node:child_process";

const databasePassword = "local-synthetic-db-only";
const databaseUrl = `postgresql://matchbase_test:${databasePassword}@127.0.0.1:55432/matchbase_slice1`;
const environment = {
  ...process.env,
  MATCHBASE_TEST_DATABASE_PASSWORD: databasePassword,
  DATABASE_URL: databaseUrl,
  MATCHBASE_DATABASE_URL: databaseUrl,
  MATCHBASE_ENVIRONMENT: "test",
  MATCHBASE_OIDC_SIMULATOR: "true",
  MATCHBASE_SYNTHETIC_FIXTURE: "true",
  MATCHBASE_ORIGIN: "http://127.0.0.1:3010",
  MATCHBASE_DIGEST_KEY: "local-synthetic-digest-key-32-bytes-minimum",
};
delete environment.CI;
delete environment.MATCHBASE_EXTERNAL_EVIDENCE_MODE;

const run = (command, arguments_, options = {}) => {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${arguments_.join(" ")} failed with exit code ${result.status}.`,
    );
};
const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) throw new Error("pnpm execution path is unavailable.");
const pnpm = (...arguments_) =>
  run(process.execPath, [pnpmEntrypoint, ...arguments_]);

let composeStarted = false;
try {
  pnpm("install", "--frozen-lockfile");
  run("docker", ["compose", "config", "--quiet"]);
  run("docker", ["compose", "down", "--remove-orphans"]);
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  composeStarted = true;
  pnpm("build");
  pnpm("--filter", "@matchbase/data", "migrate");
  pnpm("--filter", "@matchbase/data", "seed:local");
  pnpm("test:ci");
  pnpm("dependency:audit");
  pnpm("slice2:evidence:check");
  pnpm("snapshot:verify-sources");
  console.log("slice2 local validation: PASS");
} finally {
  if (composeStarted) run("docker", ["compose", "down", "--remove-orphans"]);
}
