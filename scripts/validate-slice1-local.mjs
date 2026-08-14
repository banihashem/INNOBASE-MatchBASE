import { spawnSync } from "node:child_process";

const databaseUser = "matchbase_test";
const databasePassword = "local-synthetic-db-only";
const databaseUrl = `postgresql://${databaseUser}:${databasePassword}@127.0.0.1:55432/matchbase_slice1`;
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

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  throw new Error("pnpm execution path is unavailable.");
}
const pnpm = (...arguments_) =>
  run(process.execPath, [pnpmEntrypoint, ...arguments_]);

pnpm("install", "--frozen-lockfile");
run("docker", ["compose", "up", "-d", "postgres"]);
pnpm("--filter", "@matchbase/data", "migrate");
pnpm("--filter", "@matchbase/data", "seed:local");
pnpm("test:ci");
