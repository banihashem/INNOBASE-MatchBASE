import test from "node:test";
import assert from "node:assert/strict";
import { withBoundedResearchIncidentStore } from "../../../packages/data/dist/consultant-research-incidents.js";
import { createPool } from "../../../packages/data/dist/database.js";
import { randomUUID } from "node:crypto";

test("L05 incident writes receive transaction-local timeouts and release a healthy connection", async () => {
  const queries = [],
    releases = [];
  const pool = {
    connect: async () => ({
      query: async (sql) => {
        queries.push(sql);
        return { rows: [] };
      },
      release: (destroy) => releases.push(destroy),
    }),
  };
  assert.equal(
    await withBoundedResearchIncidentStore(pool, async (client) => {
      await client.query("SELECT 1");
      return "saved";
    }),
    "saved",
  );
  assert.deepEqual(queries, [
    "BEGIN",
    "SET LOCAL statement_timeout = '750ms'",
    "SET LOCAL lock_timeout = '250ms'",
    "SELECT 1",
    "COMMIT",
  ]);
  assert.deepEqual(releases, [false]);
});

test("L05 stalled incident query is destroyed at the total deadline", async () => {
  const releases = [];
  let rejectHeld;
  const pool = {
    connect: async () => ({
      query: async (sql) =>
        sql === "SELECT held"
          ? new Promise((_, reject) => {
              rejectHeld = reject;
            })
          : { rows: [] },
      release: (destroy) => {
        releases.push(destroy);
        rejectHeld?.(new Error("Socket destroyed"));
      },
    }),
  };
  await assert.rejects(
    withBoundedResearchIncidentStore(pool, (client) =>
      client.query("SELECT held"),
    ),
    /deadline exceeded/,
  );
  assert.deepEqual(releases, [true]);
});

test("L05 timed-out pool acquisition cannot accumulate waits and destroys the late client", async () => {
  let resolveConnection,
    attempts = 0;
  const releases = [];
  const pool = {
    connect: () => {
      attempts++;
      return new Promise((resolve) => {
        resolveConnection = resolve;
      });
    },
  };
  await assert.rejects(
    withBoundedResearchIncidentStore(pool, async () => {}),
    /connection deadline/,
  );
  await assert.rejects(
    withBoundedResearchIncidentStore(pool, async () => {}),
    /unavailable/,
  );
  assert.equal(attempts, 1);
  resolveConnection({
    query: async () => assert.fail("Late client must not query"),
    release: (destroy) => releases.push(destroy),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(releases, [true]);
});

test("L05 rejected incident query destroys the transaction without replacing its error", async () => {
  const original = new Error("Synthetic incident failure");
  const releases = [];
  const pool = {
    connect: async () => ({
      query: async () => {
        throw original;
      },
      release: (destroy) => releases.push(destroy),
    }),
  };
  await assert.rejects(
    withBoundedResearchIncidentStore(pool, async () => {}),
    (error) => error === original,
  );
  assert.deepEqual(releases, [true]);
});

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
(database ? test : test.skip)(
  "L05 actual PostgreSQL cancels slow diagnostics and lock waits",
  async () => {
    const name = `incident_${randomUUID().replaceAll("-", "")}`;
    const pool = createPool({
      connectionString: database,
      max: 3,
      application_name: name,
    });
    let locked;
    try {
      await assert.rejects(
        withBoundedResearchIncidentStore(pool, (client) =>
          client.query("SELECT pg_sleep(10)"),
        ),
        (error) => error.code === "57014",
      );
      await pool.query(`CREATE TABLE ${name}(value int)`);
      locked = await pool.connect();
      await locked.query("BEGIN");
      await locked.query(`LOCK TABLE ${name} IN ACCESS EXCLUSIVE MODE`);
      await assert.rejects(
        withBoundedResearchIncidentStore(pool, (client) =>
          client.query(`INSERT INTO ${name}(value) VALUES(1)`),
        ),
        (error) => error.code === "55P03",
      );
      await locked.query("ROLLBACK");
      locked.release();
      locked = undefined;
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS total FROM ${name}`)).rows[0]
          .total,
        0,
      );
      const retained = await pool.query(
        "SELECT count(*)::int AS total FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid() AND state='active'",
        [name],
      );
      assert.equal(retained.rows[0].total, 0);
    } finally {
      if (locked) {
        await locked.query("ROLLBACK");
        locked.release();
      }
      await pool.query(`DROP TABLE IF EXISTS ${name}`);
      await pool.end();
    }
  },
);
