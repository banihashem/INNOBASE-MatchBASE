import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** pg-pool end may precede server-side socket shutdown in recovery and Admin fixtures. */
export async function dropDrainedRecoveryDatabase(
  admin,
  databaseName,
  { timeoutMs = 5_000, pollIntervalMs = 25 } = {},
) {
  // Callers must pass only their successfully created, per-test owned database.
  assert.match(databaseName, /^matchbase_(?:recovery|task074)_[a-f0-9]{32}$/);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  assert.ok(Number.isSafeInteger(pollIntervalMs) && pollIntervalMs > 0);
  const control = await admin.query(
    "SELECT current_database() AS database_name",
  );
  assert.notEqual(control.rows[0].database_name, databaseName);
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const remaining = await admin.query(
      "SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname=$1",
      [databaseName],
    );
    if (remaining.rows[0].connections === 0) break;
    if (performance.now() >= deadline) {
      throw new Error(
        "Owned test database connections did not drain before the cleanup deadline.",
      );
    }
    await delay(pollIntervalMs);
  }
  // Never terminate connections or fall back to a forced drop.
  await admin.query(`DROP DATABASE "${databaseName}"`);
}
