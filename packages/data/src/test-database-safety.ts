import type { PoolConfig } from "pg";

const safetyMessage =
  "Unsafe test database refused before connection. Tests require a loopback disposable database and MATCHBASE_DISPOSABLE_TEST_DATABASE_URL; the user database matchbase_slice1 is never a test target.";

function refuse(): never {
  // Never include a URL, credentials, or caller-supplied configuration in this error.
  throw new Error(safetyMessage);
}

function identity(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return refuse();
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      !/^[a-z][a-z0-9_]*$/u.test(database) ||
      database === "matchbase_slice1"
    )
      return refuse();
    return {
      host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
      port: url.port || "5432",
      user: decodeURIComponent(url.username),
      database,
    };
  } catch {
    return refuse();
  }
}

/** Test-only connection boundary. Normal application and migration behavior is unchanged. */
export function assertDisposableTestDatabase(
  config: PoolConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  processArguments: readonly string[] = process.argv,
): void {
  const isTest =
    Boolean(environment.NODE_TEST_CONTEXT) ||
    environment.VITEST === "true" ||
    environment.VITEST === "1" ||
    environment.MATCHBASE_TEST_DATABASE_GUARD === "required" ||
    Boolean(environment.MATCHBASE_DISPOSABLE_TEST_DATABASE_URL) ||
    processArguments.some((argument) =>
      /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(argument),
    );
  if (!isTest) return;

  const target = identity(config.connectionString);
  const disposable = identity(
    environment.MATCHBASE_DISPOSABLE_TEST_DATABASE_URL,
  );
  const fixture =
    ["fixture", "local_fixture_only"].includes(disposable.database) &&
    disposable.user === "fixture";
  if (!fixture && disposable.database !== "matchbase_test") return refuse();
  if (
    target.host !== disposable.host ||
    target.port !== disposable.port ||
    target.user !== disposable.user
  )
    return refuse();
  const ownedDatabase =
    target.database === disposable.database ||
    (!fixture &&
      (target.database === "postgres" ||
        /^matchbase_[a-z0-9_]+_[a-f0-9]{32}$/u.test(target.database)));
  if (!ownedDatabase) return refuse();
  // Avoid alternate pg configuration fields changing a reviewed connection identity.
  if (
    (config.host !== undefined && config.host !== target.host) ||
    (config.port !== undefined && String(config.port) !== target.port) ||
    (config.database !== undefined && config.database !== target.database) ||
    (config.user !== undefined && config.user !== target.user)
  )
    return refuse();
}
