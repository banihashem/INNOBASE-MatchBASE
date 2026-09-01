import assert from "node:assert/strict";
import test from "node:test";

import {
  isTransientDatabaseConnectionFailure,
  workerCycleFailureEvent,
  workerDatabaseRuntimePolicy,
  workerSchemaIsReady,
} from "../../../packages/application/dist/index.js";
import { MIGRATIONS } from "../../../packages/data/dist/index.js";

test("worker database policy separates a resilient connection timeout from the readiness probe", () => {
  assert.deepEqual(workerDatabaseRuntimePolicy({}), {
    connectionTimeoutMilliseconds: 10_000,
    probeTimeoutMilliseconds: 5_000,
  });
  assert.deepEqual(
    workerDatabaseRuntimePolicy({
      MATCHBASE_WORKER_DB_CONNECTION_TIMEOUT_MS: "12000",
      MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS: "7000",
    }),
    {
      connectionTimeoutMilliseconds: 12_000,
      probeTimeoutMilliseconds: 7_000,
    },
  );
  assert.throws(
    () =>
      workerDatabaseRuntimePolicy({
        MATCHBASE_WORKER_DB_CONNECTION_TIMEOUT_MS: "999",
      }),
    /between 1000 and 30000/iu,
  );
  assert.throws(
    () =>
      workerDatabaseRuntimePolicy({
        MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS: "15001",
      }),
    /between 100 and 15000/iu,
  );
});

test("worker schema readiness requires the complete ordered migration registry", async () => {
  const migrationIds = MIGRATIONS.map(({ id }) => id);
  const database = (ids) => ({
    async query(text) {
      if (text.includes("to_regclass")) return { rows: [{ present: true }] };
      if (text.includes("SELECT migration_id"))
        return { rows: ids.map((migration_id) => ({ migration_id })) };
      throw new Error(`Unexpected query: ${text}`);
    },
  });
  assert.equal(await workerSchemaIsReady(database(migrationIds)), true);
  assert.equal(
    await workerSchemaIsReady(database(migrationIds.slice(0, -1))),
    false,
  );
  assert.equal(
    await workerSchemaIsReady(
      database([migrationIds[1], migrationIds[0], ...migrationIds.slice(2)]),
    ),
    false,
  );
});

test("worker classifies transient database failures through wrapped causes without widening to provider timeouts", () => {
  const connectionTimeout = Object.assign(
    new Error("Connection terminated due to connection timeout"),
    { code: "ETIMEDOUT" },
  );
  assert.equal(isTransientDatabaseConnectionFailure(connectionTimeout), true);
  assert.equal(
    isTransientDatabaseConnectionFailure(
      new Error("source discovery wrapper", { cause: connectionTimeout }),
    ),
    true,
  );
  assert.equal(
    isTransientDatabaseConnectionFailure(
      Object.assign(new Error("connection exception"), { code: "08006" }),
    ),
    true,
  );
  assert.equal(
    isTransientDatabaseConnectionFailure(
      new Error("Provider request exceeded its governed timeout"),
    ),
    false,
  );
  assert.equal(
    isTransientDatabaseConnectionFailure(
      Object.assign(new Error("Provider socket timed out"), {
        code: "ETIMEDOUT",
      }),
    ),
    false,
  );
});

test("worker failure records carry Cloud Logging ERROR severity", () => {
  assert.deepEqual(
    workerCycleFailureEvent({
      category: "worker_cycle_failed",
      detail: "Connection terminated",
    }),
    {
      severity: "ERROR",
      event: "matchbase.worker.cycle_failed",
      category: "worker_cycle_failed",
      detail: "Connection terminated",
    },
  );
});
