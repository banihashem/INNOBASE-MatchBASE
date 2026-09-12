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

test("MB-UX-QUALITY-001 L07 all five provider families and supported model overrides reach the local runtime", () => {
  const overrides = {
    MATCHBASE_PROVIDER_GOOGLE: "google-ai-studio",
    MATCHBASE_PROVIDER_OPENAI: "openai",
    MATCHBASE_PROVIDER_ANTHROPIC: "anthropic",
    MATCHBASE_PROVIDER_DEEPSEEK: "deepseek",
    MATCHBASE_PROVIDER_XAI: "xai",
    MATCHBASE_PROVIDER_ROUTES: '{"deepseek":"deepseek"}',
    MATCHBASE_MODEL_GEMINI: "google/gemini-qualified",
    MATCHBASE_MODEL_OPENAI: "openai/qualified-model",
    MATCHBASE_MODEL_PREPARATION: "google/gemini-qualified",
    MATCHBASE_MODEL_SYNTHESIS: "deepseek/qualified-model",
  };
  const config = { ...fixture, ...overrides };
  assert.deepEqual(validateLocalConfig(config), config);
  for (const name of Object.keys(overrides))
    assert.throws(() =>
      validateLocalConfig({ ...config, [name]: ["invalid"] }),
    );
});

test("MB-UX-QUALITY-001 L07 model parity never admits public settings, direct credentials or arbitrary model variables", () => {
  for (const name of [
    "NEXT_PUBLIC_MATCHBASE_MODEL_GEMINI",
    "MATCHBASE_GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
    "MATCHBASE_MODEL_UNREVIEWED",
    "MATCHBASE_PROVIDER_UNREVIEWED",
    "OPENROUTER_API_KEY",
  ])
    assert.throws(() =>
      validateLocalConfig({ ...fixture, [name]: "not-admitted" }),
    );
});
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

test("MB-UX-OPS-002 L02 LAN origins allow private IPv4 but reject public and malformed origins", () => {
  for (const host of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.168.40",
  ])
    assert.doesNotThrow(() =>
      validateLocalConfig({
        ...fixture,
        MATCHBASE_ORIGIN: `http://${host}:3000`,
      }),
    );
  for (const origin of [
    "http://0.0.0.0:3000",
    "http://8.8.8.8:3000",
    "http://172.15.0.1:3000",
    "http://172.32.0.1:3000",
    "http://169.254.1.1:3000",
    "http://example.com:3000",
    "http://[::]:3000",
    "http://192.168.1.1:3000/path",
    "http://192.168.1.1:3000?next=external",
    "http://192.168.1.1:3000#fragment",
    "http://user:password@192.168.1.1:3000",
  ])
    assert.throws(() =>
      validateLocalConfig({ ...fixture, MATCHBASE_ORIGIN: origin }),
    );
});
