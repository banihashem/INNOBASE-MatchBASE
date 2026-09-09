import { createPool, type ConnectionPool } from "@matchbase/data";

let poolInstance: ConnectionPool | null = null;

export function getAppDatabasePool(): ConnectionPool {
  if (!poolInstance) {
    const connectionString =
      process.env.MATCHBASE_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "Database configuration missing: set MATCHBASE_DATABASE_URL or DATABASE_URL.",
      );
    }
    poolInstance = createPool({ connectionString, max: 10 });
  }
  return poolInstance;
}
