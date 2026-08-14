import { describe, expect, it } from "vitest";
import { loadWebConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://synthetic.invalid/matchbase",
  MATCHBASE_DIGEST_KEY: "synthetic-config-key-material-32-bytes",
  MATCHBASE_ORIGIN: "https://matchbase.example.test",
};

describe("production identity configuration", () => {
  it("refuses simulator, fixtures, or incomplete Google credentials", () => {
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_ENVIRONMENT: "production",
        MATCHBASE_OIDC_SIMULATOR: "true",
      }),
    ).toThrow(/Production startup refused/);
    expect(() =>
      loadWebConfig({ ...base, MATCHBASE_ENVIRONMENT: "production" }),
    ).toThrow(/Google OIDC configuration is incomplete/);
  });

  it("constructs a production Google adapter configuration without enabling fixtures", () => {
    expect(
      loadWebConfig({
        ...base,
        MATCHBASE_ENVIRONMENT: "production",
        GOOGLE_CLIENT_ID: "client-id-fixture",
        GOOGLE_CLIENT_SECRET: "client-secret-fixture",
        GOOGLE_REDIRECT_URI:
          "https://matchbase.example.test/auth/google/callback",
      }),
    ).toMatchObject({
      environment: "production",
      oidcSimulatorEnabled: false,
      syntheticFixtureEnabled: false,
      googleClientId: "client-id-fixture",
    });
  });
});
