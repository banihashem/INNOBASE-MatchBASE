// MB-SEC-DEPENDENCIES-001 L05: isolated production-shaped standalone qualification.
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const repositoryRoot = resolve(import.meta.dirname, "../../..");
export const admissionFixture =
  "synthetic-origin-admission-key-material-32-bytes";
export const noEgressPreload = pathToFileURL(
  resolve(import.meta.dirname, "standalone-no-egress.mjs"),
).href;

export function isolatedCommandEnvironment(source = process.env) {
  const allowed = new Set([
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "PATHEXT",
    "COMSPEC",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase())),
  );
}

export function pinnedPnpmCommand(argumentsList, source = process.env) {
  assert.ok(
    source.npm_execpath && isAbsolute(source.npm_execpath),
    "Invoke standalone qualification through the pinned pnpm run command.",
  );
  const entry = realpathSync(source.npm_execpath);
  const packageRoot = resolve(dirname(entry), "..");
  assert.ok(
    ["pnpm.cjs", "pnpm.mjs"].some(
      (name) => entry === resolve(packageRoot, "bin", name),
    ),
    "Unexpected pnpm entrypoint.",
  );
  const actual = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  );
  const expected = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  ).packageManager;
  assert.equal(`${actual.name}@${actual.version}`, expected);
  return {
    command: process.execPath,
    arguments: [entry, ...argumentsList],
    environment: {
      ...isolatedCommandEnvironment(source),
      npm_execpath: entry,
      // pnpm 11.19.0 sets this exact sentinel for scripts after checking dependencies.
      // Restore its nested-run policy without accepting inherited pnpm configuration.
      pnpm_config_verify_deps_before_run: "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  };
}

export function standaloneFixtureEnvironment(
  deploymentId,
  source = process.env,
) {
  return {
    ...isolatedCommandEnvironment(source),
    NODE_OPTIONS: `--import=${noEgressPreload}`,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/local_fixture_only",
    MATCHBASE_DATABASE_URL:
      "postgresql://fixture:fixture@127.0.0.1:1/local_fixture_only",
    MATCHBASE_DISPOSABLE_TEST_DATABASE_URL:
      "postgresql://fixture:fixture@127.0.0.1:1/local_fixture_only",
    MATCHBASE_TEST_DATABASE_GUARD: "required",
    MATCHBASE_ENVIRONMENT: "production",
    MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
    MATCHBASE_OIDC_SIMULATOR: "false",
    MATCHBASE_SYNTHETIC_FIXTURE: "false",
    MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
    MATCHBASE_DIGEST_KEY: "local-synthetic-digest-key-32-bytes-minimum",
    MATCHBASE_DEPLOYMENT_ID: deploymentId,
    MATCHBASE_IMAGE_DIGEST: deploymentId,
    GOOGLE_CLIENT_ID: "client-id-fixture",
    GOOGLE_CLIENT_SECRET: "client-secret-fixture",
    GOOGLE_REDIRECT_URI:
      "https://matchbase-staging.innobase.app/auth/google/callback",
    MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
    MATCHBASE_ORIGIN_ADMISSION_KEY: admissionFixture,
    MATCHBASE_GEMINI_API_KEY: "gemini-canonicalization-test-key",
  };
}
