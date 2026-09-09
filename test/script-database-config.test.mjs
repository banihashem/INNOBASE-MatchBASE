import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertLocalDatabaseUrl,
  resolveScriptDatabaseUrl,
} from "../scripts/lib/database-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("script database configuration selects canonical before compatibility", () => {
  assert.equal(
    resolveScriptDatabaseUrl({
      MATCHBASE_DATABASE_URL: " postgresql://canonical.invalid/app ",
      DATABASE_URL: "postgresql://fallback.invalid/app",
    }),
    "postgresql://canonical.invalid/app",
  );
  for (const canonical of [undefined, "", " \t "]) {
    assert.equal(
      resolveScriptDatabaseUrl({
        MATCHBASE_DATABASE_URL: canonical,
        DATABASE_URL: " postgresql://fallback.invalid/app ",
      }),
      "postgresql://fallback.invalid/app",
    );
  }
});

test("script database configuration rejects missing or blank values", () => {
  for (const missing of [undefined, "", " \t "]) {
    assert.throws(
      () =>
        resolveScriptDatabaseUrl({
          MATCHBASE_DATABASE_URL: missing,
          DATABASE_URL: missing,
        }),
      /^Error: Database configuration missing: set MATCHBASE_DATABASE_URL or DATABASE_URL\.$/u,
    );
  }
});

test("reset permits only explicit local PostgreSQL hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "postgres"]) {
    for (const protocol of ["postgres", "postgresql"]) {
      assert.doesNotThrow(() =>
        assertLocalDatabaseUrl(`${protocol}://${host}:55432/synthetic`),
      );
    }
  }
});

test("reset rejects remote hosts, substring tricks and query host overrides", () => {
  for (const target of [
    "postgresql://remote.invalid/synthetic",
    "postgresql://localhost.remote.invalid/synthetic",
    "postgresql://127.0.0.1.remote.invalid/synthetic",
    "postgresql://remote.invalid/localhost",
    "postgresql://localhost@remote.invalid/synthetic",
    "postgresql://127.0.0.1/synthetic?host=remote.invalid",
    "postgresql://localhost/synthetic?hostaddr=192.0.2.1",
    "https://localhost/synthetic",
    "not-a-database-url",
  ]) {
    assert.throws(
      () => assertLocalDatabaseUrl(target),
      /^Error: Reset refused: target database must use a configured local PostgreSQL host\.$/u,
    );
  }
});

test("reset refuses either production or staging environment before database access", () => {
  for (const [nodeEnvironment, matchbaseEnvironment, refusedEnvironment] of [
    ["development", "production", "production"],
    ["development", "staging", "staging"],
    ["production", "test", "production"],
    ["staging", "test", "staging"],
  ]) {
    const environment = {
      ...process.env,
      NODE_ENV: nodeEnvironment,
      MATCHBASE_ENVIRONMENT: matchbaseEnvironment,
    };
    delete environment.MATCHBASE_DATABASE_URL;
    delete environment.DATABASE_URL;
    delete environment.MATCHBASE_OPENROUTER_API_KEY;
    delete environment.OPENROUTER_API_KEY;
    const result = spawnSync(
      process.execPath,
      [resolve(root, "scripts/reset-consultant-output-v2.mjs")],
      { cwd: root, env: environment, encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        `Reset refused: unsafe environment "${refusedEnvironment}".`,
      ),
    );
    assert.doesNotMatch(result.stderr, /Database configuration missing:/u);
  }
});

test("database scripts stop without configuration before writing fixtures or connecting", () => {
  const fixturePath = resolve(
    root,
    "test/fixtures/consultant-v2-golden-scenarios.json",
  );
  const fixtureBefore = readFileSync(fixturePath);
  const fixtureStatBefore = statSync(fixturePath, { bigint: true });
  const environment = { ...process.env };
  for (const name of [
    "MATCHBASE_DATABASE_URL",
    "DATABASE_URL",
    "MATCHBASE_OPENROUTER_API_KEY",
    "OPENROUTER_API_KEY",
  ]) {
    delete environment[name];
  }
  environment.NODE_ENV = "test";
  environment.MATCHBASE_ENVIRONMENT = "test";

  for (const script of [
    "invalidate-corrupt-run-938",
    "invalidate-corrupt-run-d0f8978a",
    "reset-consultant-output-v2",
    "seed-consultant-output-v2",
    "seed-consultant-output-v3",
    "test-consultant-v3-draft-isolation",
    "verify-consultant-output-v2-db",
    "verify-consultant-output-v3-db",
    "verify-consultant-v3-golden",
  ]) {
    const result = spawnSync(
      process.execPath,
      [resolve(root, `scripts/${script}.mjs`)],
      { cwd: root, env: environment, encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(result.error, undefined, script);
    assert.equal(result.status, 1, script);
    assert.match(result.stderr, /Database configuration missing:/u, script);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /postgres(?:ql)?:\/\//u,
      script,
    );
  }

  assert.deepEqual(readFileSync(fixturePath), fixtureBefore);
  assert.equal(
    statSync(fixturePath, { bigint: true }).mtimeNs,
    fixtureStatBefore.mtimeNs,
  );
});
