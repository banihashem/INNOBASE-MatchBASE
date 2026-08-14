import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { API_MINOR_VERSION } from "../../../packages/application/dist/index.js";

test("production startup loads the fail-closed identity policy", async () => {
  const [configuration, instrumentation] = await Promise.all([
    readFile(
      new URL("../../../apps/web/src/config.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../apps/web/instrumentation.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(configuration, /assertRuntimeIdentityPolicy/);
  assert.match(
    configuration,
    /environment:\s*runtime,\s*oidcSimulatorEnabled,\s*syntheticFixtureEnabled/u,
  );
  assert.match(
    configuration,
    /Production Google OIDC configuration is incomplete/,
  );
  assert.match(instrumentation, /loadWebConfig\(\)/);
});

test("Next production App Router exposes both API and auth route families", async () => {
  const [
    configuration,
    apiRoute,
    authRoute,
    dispatcher,
    packageMetadata,
    packager,
    standaloneStarter,
  ] = await Promise.all([
    readFile(
      new URL("../../../apps/web/next.config.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../apps/web/app/api/v1/[...segments]/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../../apps/web/app/auth/[...path]/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../apps/web/src/fetch-runtime.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../apps/web/package.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../scripts/package-next-standalone.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../scripts/start-next-standalone.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(configuration, /poweredByHeader: false/);
  assert.match(configuration, /reactStrictMode: true/);
  assert.match(configuration, /output:\s*["']standalone/);
  assert.match(apiRoute, /export const GET = handleRoute/);
  assert.match(apiRoute, /export const POST = handleRoute/);
  assert.match(authRoute, /export const GET = handleRoute/);
  for (const endpoint of [
    "/api/v1/health",
    "/api/v1/readiness",
    "/api/v1/me",
    "/api/v1/requests",
    "/api/v1/runs",
    "/auth/google/start",
    "/auth/google/callback",
    "/auth/logout",
    "/auth/simulator/start",
    "/auth/simulator/callback",
  ]) {
    assert.ok(dispatcher.includes(endpoint), `missing ${endpoint}`);
  }
  assert.match(dispatcher, /recordDisclosure/);
  assert.match(dispatcher, /auditDenied/);
  assert.match(dispatcher, /createGoogleOidcAdapter/);
  assert.match(packageMetadata, /package-next-standalone\.mjs/);
  assert.match(packageMetadata, /start-next-standalone\.mjs/);
  assert.doesNotMatch(packageMetadata, /next start/);
  assert.match(packager, /\.next["'], "static/);
  assert.match(packager, /"public"/);
  assert.match(packager, /entry\.isSymbolicLink\(\)/);
  assert.match(standaloneStarter, /process\.env\.HOSTNAME = "127\.0\.0\.1"/);
  assert.match(standaloneStarter, /process\.env\.PORT = "3010"/);
  assert.equal(API_MINOR_VERSION, "2026-08-14");
});

test("stable error envelope excludes stack, SQL and submitted source text", async () => {
  const source = await readFile(
    new URL("../../../apps/web/src/fetch-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /about:matchbase\/errors/);
  assert.match(source, /correlation_id/);
  assert.match(source, /retryable/);
  assert.doesNotMatch(
    source,
    /error\.stack|caught\.message|requestBody.*console/s,
  );
});
