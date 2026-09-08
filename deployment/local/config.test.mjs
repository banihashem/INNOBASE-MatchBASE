import assert from "node:assert/strict";
import test from "node:test";
import { validateLocalConfig } from "./config.mjs";
const fixture = {
  MATCHBASE_ENVIRONMENT: "test",
  MATCHBASE_OIDC_SIMULATOR: "true",
  MATCHBASE_SYNTHETIC_FIXTURE: "true",
  MATCHBASE_ORIGIN: "http://localhost:3000",
  MATCHBASE_DATABASE_URL: "postgresql://postgres:5432/matchbase_slice1",
  DATABASE_URL: "postgresql://postgres:5432/matchbase_slice1",
  MATCHBASE_DIGEST_KEY: "synthetic-local-test-material-32-bytes",
};
test("MB-UX-OPS-002 L01 local containers reject production identity or external configuration", () => {
  assert.deepEqual(validateLocalConfig(fixture), fixture);
  for (const override of [
    { MATCHBASE_ENVIRONMENT: "production" },
    { MATCHBASE_OIDC_SIMULATOR: "false" },
    { MATCHBASE_ORIGIN: "https://example.com" },
    { MATCHBASE_DATABASE_URL: "postgresql://external.invalid/db" },
    { DATABASE_URL: "postgresql://different.invalid/db" },
    { NEXT_PUBLIC_OPENROUTER_API_KEY: "synthetic" },
    { NODE_OPTIONS: "--import=untrusted.mjs" },
    { MATCHBASE_DIGEST_KEY: "short" },
  ])
    assert.throws(() => validateLocalConfig({ ...fixture, ...override }));
});
