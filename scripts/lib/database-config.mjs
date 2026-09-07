export function resolveScriptDatabaseUrl(environment = process.env) {
  const connectionString =
    environment.MATCHBASE_DATABASE_URL?.trim() ||
    environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Database configuration missing: set MATCHBASE_DATABASE_URL or DATABASE_URL.",
    );
  }
  return connectionString;
}

export function assertLocalDatabaseUrl(connectionString) {
  const refusal =
    "Reset refused: target database must use a configured local PostgreSQL host.";
  let target;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error(refusal);
  }
  // `postgres` is the local database service declared in compose.yaml.
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !localHosts.has(target.hostname.toLowerCase()) ||
    target.searchParams.has("host") ||
    target.searchParams.has("hostaddr")
  ) {
    throw new Error(refusal);
  }
}
