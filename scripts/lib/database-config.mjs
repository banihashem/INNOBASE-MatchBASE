import { assertDisposableTestDatabase } from "../../packages/data/dist/test-database-safety.js";

export function resolveScriptDatabaseUrl(
  environment = process.env,
  processArguments = process.argv,
) {
  const connectionString =
    environment.MATCHBASE_DATABASE_URL?.trim() ||
    environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Database configuration missing: set MATCHBASE_DATABASE_URL or DATABASE_URL.",
    );
  }
  const manualTest = processArguments.some((argument) =>
    /(?:^|[\\/])test-[^\\/]+\.mjs$/u.test(argument),
  );
  assertDisposableTestDatabase(
    { connectionString },
    manualTest
      ? { ...environment, MATCHBASE_TEST_DATABASE_GUARD: "required" }
      : environment,
    processArguments,
  );
  return connectionString;
}

// MB-UX-QUALITY-001 L06: manual HTTP tests must declare both owned test targets.
export function resolveScriptTestTargets(
  environment = process.env,
  request = globalThis.fetch,
) {
  const databaseUrl = resolveScriptDatabaseUrl(environment);
  const guardedEnvironment = {
    ...environment,
    MATCHBASE_TEST_DATABASE_GUARD: "required",
  };
  for (const target of [
    databaseUrl,
    environment.DATABASE_URL,
    environment.MATCHBASE_DATABASE_URL,
    environment.MATCHBASE_CONSULTANT_TEST_DATABASE_URL,
  ]) {
    if (target?.trim()) {
      assertDisposableTestDatabase(
        { connectionString: target },
        guardedEnvironment,
      );
    }
  }

  const refusal =
    "Unsafe test HTTP target refused before request. Set MATCHBASE_DISPOSABLE_TEST_BASE_URL to an isolated loopback HTTP origin on an explicit non-runtime port; BASE_URL must match when set.";
  function origin(value) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !url.port ||
        Number(url.port) < 1024 ||
        ["3000", "3001"].includes(url.port) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        throw new Error(refusal);
      }
      return url.origin;
    } catch {
      throw new Error(refusal);
    }
  }
  const baseUrl = origin(environment.MATCHBASE_DISPOSABLE_TEST_BASE_URL);
  if (
    environment.BASE_URL?.trim() &&
    origin(environment.BASE_URL) !== baseUrl
  ) {
    throw new Error(refusal);
  }

  function isOwnedRequest(value) {
    try {
      const url = new URL(value);
      return url.origin === baseUrl && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  return {
    databaseUrl,
    baseUrl,
    async createBrowserContext(browser) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      try {
        await context.route("**/*", async (route) => {
          const requestUrl = route.request().url();
          if (!isOwnedRequest(requestUrl))
            return route.abort("blockedbyclient");
          // Inspect redirects without following them; a local server can carry a
          // stale canonical runtime URL in its authentication configuration.
          const response = await route.fetch({ maxRedirects: 0 });
          const location = response.headers().location;
          if (response.status() >= 300 && response.status() < 400 && location) {
            let redirectUrl;
            try {
              redirectUrl = new URL(location, requestUrl).href;
            } catch {
              return route.abort("blockedbyclient");
            }
            if (!isOwnedRequest(redirectUrl))
              return route.abort("blockedbyclient");
          }
          return route.fulfill({ response });
        });
        // These tests use HTTP only; websocket traffic must not bypass routing.
        await context.routeWebSocket("**/*", (socket) => socket.close());
        return context;
      } catch (error) {
        await context.close();
        throw error;
      }
    },
    fetch(input, init) {
      let url;
      try {
        url = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
        );
      } catch {
        throw new Error(refusal);
      }
      if (!isOwnedRequest(url)) {
        throw new Error(refusal);
      }
      // Never follow a response redirect into the user's running product.
      return request(input, { ...init, redirect: "manual" });
    },
  };
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
