import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPool } from "../../../packages/data/dist/index.js";
import { dropDrainedRecoveryDatabase } from "../support/recovery-database-cleanup.mjs";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;

async function waitForObservedDrain(draining, cleanup) {
  await Promise.race([
    draining,
    cleanup.then(() => {
      assert.fail(
        "Cleanup completed before an active backend drain was observed.",
      );
    }),
  ]);
}

(database ? test : test.skip)(
  "MB-UX-PILOT-001 L01 cleanup waits for delayed socket shutdown without terminating the backend",
  async () => {
    const databaseName = `matchbase_recovery_${randomUUID().replaceAll("-", "")}`;
    const admin = createPool({ connectionString: database, max: 1 });
    let pool;
    let created = false;
    let finishSocket;
    let cleanup;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const isolated = new URL(database);
      isolated.pathname = `/${databaseName}`;
      pool = createPool({ connectionString: isolated.href, max: 1 });
      const errors = [];
      pool.on("error", (error) => errors.push(error));
      const client = await pool.connect();
      await client.query("SELECT 1");
      const originalEnd = client.connection.end.bind(client.connection);
      let shutdownRequested = false;
      // Hold only this owned test connection's protocol shutdown to expose the pool race.
      client.connection.end = () => {
        shutdownRequested = true;
      };
      finishSocket = originalEnd;
      client.release();
      await pool.end();
      assert.equal(shutdownRequested, true);
      const backend = await admin.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1",
        [databaseName],
      );
      assert.equal(
        backend.rows[0].n,
        1,
        "pool.end resolves while the server connection remains",
      );

      let observedDrain;
      const draining = new Promise((resolve) => {
        observedDrain = resolve;
      });
      const tracedAdmin = {
        async query(sql, values) {
          const result = await admin.query(sql, values);
          if (
            sql.includes("pg_stat_activity") &&
            result.rows[0].connections > 0
          )
            observedDrain();
          return result;
        },
      };
      let cleanupFinished = false;
      cleanup = dropDrainedRecoveryDatabase(tracedAdmin, databaseName).then(
        () => {
          cleanupFinished = true;
        },
      );
      await waitForObservedDrain(draining, cleanup);
      assert.equal(
        cleanupFinished,
        false,
        "cleanup must await server-side drain",
      );
      finishSocket();
      finishSocket = undefined;
      await cleanup;
      created = false;
      assert.equal(
        errors.length,
        0,
        "cleanup must not generate a PostgreSQL administrator-shutdown error",
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM pg_database WHERE datname=$1",
            [databaseName],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      try {
        finishSocket?.();
        if (pool && !pool.ending) await pool.end();
        if (cleanup) await cleanup;
        else if (created)
          await dropDrainedRecoveryDatabase(admin, databaseName);
      } finally {
        await admin.end();
      }
    }
  },
);

test("MB-UX-PILOT-001 L01 cleanup rejects unrelated database names before querying", async () => {
  const admin = {
    query() {
      throw new Error("Database access must not occur");
    },
  };
  for (const name of [
    "postgres",
    "matchbase_slice1",
    "matchbase_recovery_invalid",
    'matchbase_recovery_";DROP DATABASE postgres;--',
  ]) {
    await assert.rejects(dropDrainedRecoveryDatabase(admin, name), {
      code: "ERR_ASSERTION",
    });
  }
});

test("MB-UX-PILOT-001 L01 cleanup deadline fails without forced termination or drop", async () => {
  const databaseName = `matchbase_recovery_${randomUUID().replaceAll("-", "")}`;
  const queries = [];
  const admin = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("current_database"))
        return { rows: [{ database_name: "postgres" }] };
      return { rows: [{ connections: 1 }] };
    },
  };
  await assert.rejects(
    dropDrainedRecoveryDatabase(admin, databaseName, {
      timeoutMs: 10,
      pollIntervalMs: 5,
    }),
    /connections did not drain/,
  );
  assert.ok(
    queries
      .filter(({ sql }) => sql.includes("pg_stat_activity"))
      .every(({ values }) => values.length === 1 && values[0] === databaseName),
  );
  assert.ok(queries.every(({ sql }) => !/DROP|terminate|FORCE/.test(sql)));
});

test(
  "MB-UX-PILOT-001 L01 drain barrier propagates early cleanup failure and reaches finally",
  { timeout: 1_000 },
  async () => {
    const failure = new Error("Injected catalog query failure");
    let released = false;
    const neverObserved = new Promise(() => {});
    await assert.rejects(
      async () => {
        try {
          await waitForObservedDrain(neverObserved, Promise.reject(failure));
        } finally {
          released = true;
        }
      },
      (error) => error === failure,
    );
    assert.equal(released, true);
  },
);

test(
  "MB-UX-PILOT-001 L01 drain barrier rejects cleanup completion before observation",
  { timeout: 1_000 },
  async () => {
    const neverObserved = new Promise(() => {});
    await assert.rejects(
      waitForObservedDrain(neverObserved, Promise.resolve()),
      /Cleanup completed before an active backend drain was observed/,
    );
  },
);
