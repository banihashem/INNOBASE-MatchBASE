import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertDisposableTestDatabase,
  createPool,
} from "../../../packages/data/dist/index.js";

const disposable = "postgresql://postgres@127.0.0.1:54329/matchbase_test";
const environment = {
  NODE_TEST_CONTEXT: "child-v8",
  MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: disposable,
};
const refused = /Unsafe test database refused before connection/;

test("MB-UX-QUALITY-001 L06 test connections cannot target the user database even with an explicit marker", () => {
  for (const url of [
    "postgresql://matchbase_test@localhost:55433/matchbase_slice1",
    "postgresql://postgres@127.0.0.1:54329/matchbase_slice1",
    "postgresql://postgres@127.0.0.1:54329/matchbase_%73lice1",
  ]) {
    assert.throws(
      () =>
        assertDisposableTestDatabase({ connectionString: url }, environment),
      refused,
    );
    assert.throws(
      () =>
        assertDisposableTestDatabase(
          { connectionString: url },
          { ...environment, MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: url },
        ),
      refused,
    );
  }
});

test("MB-UX-QUALITY-001 L06 test targets need an explicit owned endpoint and cannot use inherited pg settings", () => {
  for (const config of [
    {},
    { connectionString: disposable },
    { host: "127.0.0.1", database: "matchbase_test" },
  ])
    assert.throws(
      () =>
        assertDisposableTestDatabase(config, { NODE_TEST_CONTEXT: "child-v8" }),
      refused,
    );
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        {},
        { ...environment, PGDATABASE: "matchbase_test", PGHOST: "127.0.0.1" },
      ),
    refused,
  );
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        { connectionString: disposable.replace("54329", "55433") },
        environment,
      ),
    refused,
  );
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        { connectionString: disposable, database: "matchbase_slice1" },
        environment,
      ),
    refused,
  );
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        { connectionString: disposable, host: "remote.invalid" },
        environment,
      ),
    refused,
  );
});

test("MB-UX-QUALITY-001 L06 test endpoints reject remote hosts and URL connection overrides without leaking credentials", () => {
  const syntheticCredentialUrl = new URL(
    "postgresql://remote.invalid/private_database",
  );
  syntheticCredentialUrl.username = "sensitive-user";
  syntheticCredentialUrl.password = "sensitive-password";
  for (const value of [
    disposable.replace("127.0.0.1", "remote.invalid"),
    disposable.replace("127.0.0.1", "localhost.remote.invalid"),
    `${disposable}?host=remote.invalid`,
    `${disposable}?database=matchbase_slice1`,
    `${disposable}?hostaddr=127.0.0.1`,
    `${disposable}#ignored`,
    syntheticCredentialUrl.href,
  ]) {
    assert.throws(
      () =>
        assertDisposableTestDatabase(
          { connectionString: value },
          { ...environment, MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: value },
        ),
      (error) => {
        assert.match(error.message, refused);
        assert.doesNotMatch(
          error.message,
          /sensitive-user|sensitive-password|private_database|postgresql:/,
        );
        return true;
      },
    );
  }
});

test("MB-UX-QUALITY-001 L06 a named disposable database supports only its own generated child databases", () => {
  for (const name of [
    "matchbase_test",
    "postgres",
    "matchbase_recovery_0123456789abcdef0123456789abcdef",
    "matchbase_task074_0123456789abcdef0123456789abcdef",
  ])
    assert.doesNotThrow(() =>
      assertDisposableTestDatabase(
        { connectionString: disposable.replace("matchbase_test", name) },
        environment,
      ),
    );
  for (const name of [
    "matchbase_slice1",
    "production",
    "matchbase_recovery_existing",
    "template1",
  ])
    assert.throws(
      () =>
        assertDisposableTestDatabase(
          { connectionString: disposable.replace("matchbase_test", name) },
          environment,
        ),
      refused,
    );
});

test("MB-UX-QUALITY-001 L06 normal migration behavior remains unchanged while all supported test runners are guarded", () => {
  const user = {
    connectionString: "postgresql://runtime.invalid/matchbase_slice1",
  };
  assert.doesNotThrow(() =>
    assertDisposableTestDatabase(
      user,
      { MATCHBASE_ENVIRONMENT: "production" },
      ["node", "migration-cli.js"],
    ),
  );
  for (const testEnvironment of [
    { NODE_TEST_CONTEXT: "child-v8" },
    { VITEST: "true" },
    { VITEST: "1" },
    { MATCHBASE_TEST_DATABASE_GUARD: "required" },
  ])
    assert.throws(
      () => assertDisposableTestDatabase(user, testEnvironment),
      refused,
    );
});

test("MB-UX-QUALITY-001 L06 directly invoked test files and marker-inheriting child tools also fail closed", () => {
  for (const argumentsList of [
    ["node", "C:\\test\\combined-worker-postgres.test.mjs"],
    ["node", "/repo/test/browser/product.spec.mjs"],
  ])
    assert.throws(
      () =>
        assertDisposableTestDatabase(
          { connectionString: disposable },
          {},
          argumentsList,
        ),
      refused,
    );
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        { connectionString: disposable.replace("54329", "55433") },
        { MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: disposable },
        ["node", "worker.js"],
      ),
    refused,
  );
});

test("MB-UX-QUALITY-001 L06 declared loopback protocol fixtures remain available without admitting the user database", () => {
  for (const name of ["fixture", "local_fixture_only"]) {
    const connectionString = `postgresql://fixture:fixture@127.0.0.1:1/${name}`;
    assert.doesNotThrow(() =>
      assertDisposableTestDatabase(
        { connectionString },
        {
          ...environment,
          MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: connectionString,
        },
      ),
    );
  }
});

test("MB-UX-QUALITY-001 L06 factory and child processes refuse unsafe test configuration before any query", () => {
  assert.throws(
    () =>
      createPool({
        connectionString: "postgresql://runtime.invalid/matchbase_slice1",
      }),
    refused,
  );
  const factoryUrl = new URL(
    "../../../packages/data/dist/database.js",
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { createPool } from ${JSON.stringify(factoryUrl)}; try { createPool({ connectionString: process.env.DATABASE_URL }); process.exit(2); } catch (error) { if (!error.message.startsWith('Unsafe test database refused')) process.exit(3); process.stdout.write('REFUSED_BEFORE_CONNECTION'); }`,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT,
        DATABASE_URL:
          "postgresql://fixture:fixture@localhost:55433/matchbase_slice1",
        MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: disposable,
      },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "REFUSED_BEFORE_CONNECTION");
});

test("MB-UX-QUALITY-001 L06 each rollback regression enters through the guarded pool factory", async () => {
  for (const file of [
    "slice1/data/foundation-postgres.test.mjs",
    "slice2/data/standard-workspace-postgres.test.mjs",
    "slice2/api/standard-application-postgres.test.mjs",
    "slice2/application/combined-worker-postgres.test.mjs",
    "slice3/combined-live-worker-postgres.test.mjs",
    "slice3/data/p4-google-risc-receiver-postgres.test.mjs",
    "slice3/data/live-research-postgres.test.mjs",
    "slice3/data/p4-audit-integrity-postgres.test.mjs",
    "slice3/live-research-pipeline-identity-postgres.test.mjs",
    "slice3/live-research-application-postgres.test.mjs",
  ]) {
    const source = await readFile(
      new URL(`../../${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /createPool\(/, file);
    assert.doesNotMatch(source, /new (?:Pool|Client)\(/, file);
  }
});
