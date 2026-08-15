import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConnectionPool,
  Queryable,
  TransactionClient,
} from "./database.js";
import { inTransaction } from "./database.js";

export const FOUNDATION_MIGRATION_ID = "0001_slice_1_foundation";
export const STANDARD_WORKSPACE_MIGRATION_ID =
  "0002_slice_2_standard_workspace";
export const LIVE_RESEARCH_MIGRATION_ID = "0003_slice_3_live_research";

export interface MigrationDefinition {
  readonly id: string;
}

export const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  Object.freeze({ id: FOUNDATION_MIGRATION_ID }),
  Object.freeze({ id: STANDARD_WORKSPACE_MIGRATION_ID }),
  Object.freeze({ id: LIVE_RESEARCH_MIGRATION_ID }),
]);

export const LATEST_MIGRATION_ID =
  MIGRATIONS.at(-1)?.id ?? FOUNDATION_MIGRATION_ID;

export interface MigrationStatus {
  readonly latestMigrationId: string;
  readonly appliedMigrationIds: readonly string[];
  readonly pendingMigrationIds: readonly string[];
  readonly unknownMigrationIds: readonly string[];
  readonly ready: boolean;
}

function migrationPath(migrationId: string, direction: "up" | "down"): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "migrations", `${migrationId}.${direction}.sql`);
}

async function migrationSql(
  migrationId: string,
  direction: "up" | "down",
): Promise<string> {
  return readFile(migrationPath(migrationId, direction), "utf8");
}

async function ensureMigrationTable(client: TransactionClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS matchbase_schema_migration (
      migration_id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function appliedIds(client: Queryable): Promise<string[]> {
  const present = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.matchbase_schema_migration') IS NOT NULL AS present`,
  );
  if (!present.rows[0]?.present) return [];
  const result = await client.query<{ migration_id: string }>(
    "SELECT migration_id FROM matchbase_schema_migration ORDER BY applied_at, migration_id",
  );
  return result.rows.map((row) => row.migration_id);
}

function assertOrderedPrefix(ids: readonly string[]): void {
  const known = new Set(MIGRATIONS.map((migration) => migration.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown database migrations: ${unknown.join(", ")}`);
  }
  const expected = MIGRATIONS.slice(0, ids.length).map(
    (migration) => migration.id,
  );
  if (ids.some((id, index) => id !== expected[index])) {
    throw new Error("Database migrations are not an ordered registry prefix");
  }
}

export async function getMigrationStatus(
  pool: ConnectionPool,
): Promise<MigrationStatus> {
  const ids = await appliedIds(pool);
  const known = new Set(MIGRATIONS.map((migration) => migration.id));
  const unknownMigrationIds = ids.filter((id) => !known.has(id));
  const appliedMigrationIds = ids.filter((id) => known.has(id));
  const pendingMigrationIds = MIGRATIONS.map(
    (migration) => migration.id,
  ).filter((id) => !appliedMigrationIds.includes(id));
  const ordered = appliedMigrationIds.every(
    (id, index) => MIGRATIONS[index]?.id === id,
  );
  return {
    latestMigrationId: LATEST_MIGRATION_ID,
    appliedMigrationIds,
    pendingMigrationIds,
    unknownMigrationIds,
    ready:
      unknownMigrationIds.length === 0 &&
      ordered &&
      pendingMigrationIds.length === 0,
  };
}

export async function migrateUp(pool: ConnectionPool): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    await ensureMigrationTable(client);
    await client.query(
      "LOCK TABLE matchbase_schema_migration IN EXCLUSIVE MODE",
    );
    const existing = await appliedIds(client);
    assertOrderedPrefix(existing);
    let changed = false;
    for (const migration of MIGRATIONS.slice(existing.length)) {
      await client.query(await migrationSql(migration.id, "up"));
      await client.query(
        "INSERT INTO matchbase_schema_migration (migration_id) VALUES ($1)",
        [migration.id],
      );
      changed = true;
    }
    return changed;
  });
}

export async function migrateDownLatest(
  pool: ConnectionPool,
): Promise<string | null> {
  return inTransaction(pool, async (client) => {
    const existing = await appliedIds(client);
    if (existing.length === 0) return null;
    assertOrderedPrefix(existing);
    await client.query(
      "LOCK TABLE matchbase_schema_migration IN EXCLUSIVE MODE",
    );
    const migrationId = existing.at(-1);
    if (!migrationId) return null;
    await client.query(await migrationSql(migrationId, "down"));
    await client.query(
      "DELETE FROM matchbase_schema_migration WHERE migration_id = $1",
      [migrationId],
    );
    return migrationId;
  });
}

export async function migrateDown(pool: ConnectionPool): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const existing = await appliedIds(client);
    if (existing.length === 0) return false;
    assertOrderedPrefix(existing);
    await client.query(
      "LOCK TABLE matchbase_schema_migration IN EXCLUSIVE MODE",
    );
    for (const migrationId of [...existing].reverse()) {
      await client.query(await migrationSql(migrationId, "down"));
      await client.query(
        "DELETE FROM matchbase_schema_migration WHERE migration_id = $1",
        [migrationId],
      );
    }
    return true;
  });
}

/** Explicit alias for the legacy full teardown used by isolated test databases. */
export const migrateAllDown = migrateDown;
