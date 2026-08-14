import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectionPool } from "./database.js";
import { inTransaction } from "./database.js";

export const FOUNDATION_MIGRATION_ID = "0001_slice_1_foundation";

function migrationPath(direction: "up" | "down"): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(
    here,
    "..",
    "migrations",
    `${FOUNDATION_MIGRATION_ID}.${direction}.sql`,
  );
}

async function migrationSql(direction: "up" | "down"): Promise<string> {
  return readFile(migrationPath(direction), "utf8");
}

export async function migrateUp(pool: ConnectionPool): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS matchbase_schema_migration (
        migration_id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await client.query(
      "LOCK TABLE matchbase_schema_migration IN EXCLUSIVE MODE",
    );
    const existing = await client.query<{ migration_id: string }>(
      "SELECT migration_id FROM matchbase_schema_migration WHERE migration_id = $1",
      [FOUNDATION_MIGRATION_ID],
    );
    if (existing.rowCount === 1) return false;
    await client.query(await migrationSql("up"));
    await client.query(
      "INSERT INTO matchbase_schema_migration (migration_id) VALUES ($1)",
      [FOUNDATION_MIGRATION_ID],
    );
    return true;
  });
}

export async function migrateDown(pool: ConnectionPool): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const table = await client.query<{ present: boolean }>(
      `SELECT to_regclass('public.matchbase_schema_migration') IS NOT NULL AS present`,
    );
    if (!table.rows[0]?.present) return false;
    await client.query(
      "LOCK TABLE matchbase_schema_migration IN EXCLUSIVE MODE",
    );
    const existing = await client.query<{ migration_id: string }>(
      "SELECT migration_id FROM matchbase_schema_migration WHERE migration_id = $1",
      [FOUNDATION_MIGRATION_ID],
    );
    if (existing.rowCount !== 1) return false;
    await client.query(await migrationSql("down"));
    await client.query(
      "DELETE FROM matchbase_schema_migration WHERE migration_id = $1",
      [FOUNDATION_MIGRATION_ID],
    );
    return true;
  });
}
