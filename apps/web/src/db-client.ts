import { createPool, type ConnectionPool } from "@matchbase/data";

let poolInstance: ConnectionPool | null = null;

export function getAppDatabasePool(): ConnectionPool {
  if (!poolInstance) {
    const conn =
      process.env.DATABASE_URL ??
      process.env.MATCHBASE_DATABASE_URL ??
      "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";
    poolInstance = createPool({ connectionString: conn, max: 10 });
  }
  return poolInstance;
}
