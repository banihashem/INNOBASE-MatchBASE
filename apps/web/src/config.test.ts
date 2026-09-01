import { describe, expect, it } from "vitest";
import { consultantProjectionConfigSha256 } from "@matchbase/data";
import { loadWebConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://synthetic.invalid/matchbase",
  MATCHBASE_DIGEST_KEY: "synthetic-config-key-material-32-bytes",
  MATCHBASE_ORIGIN: "https://matchbase.example.test",
};

describe("production identity configuration", () => {
  it("refuses a production Node runtime when MatchBASE identity is omitted or local", () => {
    expect(() => loadWebConfig({ ...base, NODE_ENV: "production" })).toThrow(
      /requires MATCHBASE_ENVIRONMENT=production/u,
    );
    expect(() =>
      loadWebConfig({
        ...base,
        NODE_ENV: "production",
        MATCHBASE_ENVIRONMENT: "test",
      }),
    ).toThrow(/requires MATCHBASE_ENVIRONMENT=production/u);
  });
  it("enforces the memory-safe artifact bound", () => {
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_ARTIFACT_MAXIMUM_BYTES: String(8 * 1_024 * 1_024 + 1),
      }),
    ).toThrow(/memory-safe bound/u);
    expect(
      loadWebConfig({
        ...base,
        MATCHBASE_ARTIFACT_MAXIMUM_BYTES: String(8 * 1_024 * 1_024),
      }).artifactMaximumBytes,
    ).toBe(8 * 1_024 * 1_024);
  });
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
        MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
        MATCHBASE_DEPLOYMENT_ID: `sha256:${"a".repeat(64)}`,
        MATCHBASE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
        MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
        GOOGLE_CLIENT_ID: "client-id-fixture",
        GOOGLE_CLIENT_SECRET: "client-secret-fixture",
        GOOGLE_REDIRECT_URI:
          "https://matchbase-staging.innobase.app/auth/google/callback",
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
        MATCHBASE_ORIGIN_ADMISSION_KEY:
          "synthetic-origin-admission-key-material-32-bytes",
        MATCHBASE_GEMINI_API_KEY: "gemini-canonicalization-test-key",
      }),
    ).toMatchObject({
      environment: "production",
      oidcSimulatorEnabled: false,
      syntheticFixtureEnabled: false,
      googleClientId: "client-id-fixture",
      artifactGcsBucket: "innobase-matchbase-stg-artifacts",
    });
  });

  it("refuses production startup without an artifact GCS bucket", () => {
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_ENVIRONMENT: "production",
        GOOGLE_CLIENT_ID: "client-id-fixture",
        GOOGLE_CLIENT_SECRET: "client-secret-fixture",
        GOOGLE_REDIRECT_URI:
          "https://matchbase.example.test/auth/google/callback",
      }),
    ).toThrow(/artifact GCS configuration is incomplete/iu);
  });

  it("requires direct Gemini and refuses OpenRouter in the production web runtime", () => {
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_ENVIRONMENT: "production",
        MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
        MATCHBASE_DEPLOYMENT_ID: `sha256:${"a".repeat(64)}`,
        MATCHBASE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
        MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
        GOOGLE_CLIENT_ID: "client-id-fixture",
        GOOGLE_CLIENT_SECRET: "client-secret-fixture",
        GOOGLE_REDIRECT_URI:
          "https://matchbase-staging.innobase.app/auth/google/callback",
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
        MATCHBASE_ORIGIN_ADMISSION_KEY:
          "synthetic-origin-admission-key-material-32-bytes",
      }),
    ).toThrow(/Gemini canonicalization configuration is incomplete/iu);
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_ENVIRONMENT: "production",
        MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
        MATCHBASE_DEPLOYMENT_ID: `sha256:${"a".repeat(64)}`,
        MATCHBASE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
        MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
        GOOGLE_CLIENT_ID: "client-id-fixture",
        GOOGLE_CLIENT_SECRET: "client-secret-fixture",
        GOOGLE_REDIRECT_URI:
          "https://matchbase-staging.innobase.app/auth/google/callback",
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
        MATCHBASE_ORIGIN_ADMISSION_KEY:
          "synthetic-origin-admission-key-material-32-bytes",
        MATCHBASE_GEMINI_API_KEY: "gemini-canonicalization-test-key",
        MATCHBASE_OPENROUTER_API_KEY: "prohibited-provider-key",
      }),
    ).toThrow(/OpenRouter API keys are prohibited in the web runtime/iu);
  });

  it("binds production identity to the exact HTTPS origin and Google endpoints", () => {
    const production = {
      ...base,
      MATCHBASE_ENVIRONMENT: "production",
      MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
      MATCHBASE_DEPLOYMENT_ID: `sha256:${"a".repeat(64)}`,
      MATCHBASE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
      MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
      GOOGLE_CLIENT_ID: "client-id-fixture",
      GOOGLE_CLIENT_SECRET: "client-secret-fixture",
      GOOGLE_REDIRECT_URI:
        "https://matchbase-staging.innobase.app/auth/google/callback",
      MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
      MATCHBASE_ORIGIN_ADMISSION_KEY:
        "synthetic-origin-admission-key-material-32-bytes",
      MATCHBASE_GEMINI_API_KEY: "gemini-canonicalization-test-key",
    };
    expect(() =>
      loadWebConfig({
        ...production,
        GOOGLE_REDIRECT_URI:
          "https://another.example.test/auth/google/callback",
      }),
    ).toThrow(/redirect URI must match the origin/iu);
    expect(() =>
      loadWebConfig({
        ...production,
        GOOGLE_TOKEN_ENDPOINT: "https://attacker.example/token",
      }),
    ).toThrow(/GOOGLE_TOKEN_ENDPOINT override is prohibited/iu);
    expect(() =>
      loadWebConfig({
        ...production,
        MATCHBASE_ORIGIN: "http://matchbase.example.test",
        GOOGLE_REDIRECT_URI:
          "http://matchbase.example.test/auth/google/callback",
      }),
    ).toThrow(/HTTPS origin/iu);
    expect(() =>
      loadWebConfig({
        ...production,
        MATCHBASE_DEPLOYMENT_ID: "local-unreleased",
      }),
    ).toThrow(/immutable SHA-256 digest/iu);
    expect(() =>
      loadWebConfig({
        ...production,
        MATCHBASE_IMAGE_DIGEST: undefined,
      }),
    ).toThrow(/image identity must be an immutable SHA-256 digest/iu);
    expect(() =>
      loadWebConfig({
        ...production,
        MATCHBASE_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(/must match the deployed image digest/iu);
    expect(() =>
      loadWebConfig({
        ...production,
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-artifacts",
      }),
    ).toThrow(/closed target map/iu);
  });

  it("admits the EU Staging bucket only through the explicit closed deployment target", () => {
    const staging = {
      ...base,
      MATCHBASE_ENVIRONMENT: "production",
      MATCHBASE_DEPLOYMENT_ENVIRONMENT: "staging",
      MATCHBASE_DEPLOYMENT_ID: `sha256:${"a".repeat(64)}`,
      MATCHBASE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
      MATCHBASE_ORIGIN: "https://matchbase-staging.innobase.app",
      GOOGLE_CLIENT_ID: "client-id-fixture",
      GOOGLE_CLIENT_SECRET: "client-secret-fixture",
      GOOGLE_REDIRECT_URI:
        "https://matchbase-staging.innobase.app/auth/google/callback",
      MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-artifacts",
      MATCHBASE_ORIGIN_ADMISSION_KEY:
        "synthetic-origin-admission-key-material-32-bytes",
      MATCHBASE_GEMINI_API_KEY: "gemini-canonicalization-test-key",
    };
    expect(
      loadWebConfig({
        ...staging,
        MATCHBASE_DEPLOYMENT_TARGET: "staging-eu",
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-eu-artifacts",
      }),
    ).toMatchObject({
      deploymentEnvironment: "staging",
      deploymentTarget: "staging-eu",
      artifactGcsBucket: "innobase-matchbase-stg-eu-artifacts",
    });
    expect(
      loadWebConfig({
        ...staging,
        MATCHBASE_DEPLOYMENT_TARGET: "staging-eu-canary",
        MATCHBASE_ORIGIN: "https://matchbase-staging-eu-canary.innobase.app",
        GOOGLE_REDIRECT_URI:
          "https://matchbase-staging-eu-canary.innobase.app/auth/google/callback",
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-eu-artifacts",
      }),
    ).toMatchObject({
      deploymentEnvironment: "staging",
      deploymentTarget: "staging-eu-canary",
      origin: "https://matchbase-staging-eu-canary.innobase.app",
      artifactGcsBucket: "innobase-matchbase-stg-eu-artifacts",
    });
    expect(() =>
      loadWebConfig({
        ...staging,
        MATCHBASE_ARTIFACT_GCS_BUCKET: "innobase-matchbase-stg-eu-artifacts",
      }),
    ).toThrow(/closed target map/iu);
    expect(() =>
      loadWebConfig({
        ...staging,
        MATCHBASE_DEPLOYMENT_TARGET: "staging-eu",
      }),
    ).toThrow(/closed target map/iu);
    expect(() =>
      loadWebConfig({
        ...staging,
        MATCHBASE_DEPLOYMENT_TARGET: "production",
      }),
    ).toThrow(/closed target map/iu);
    expect(() =>
      loadWebConfig({
        ...staging,
        MATCHBASE_DEPLOYMENT_TARGET: "eu-west-unknown",
      }),
    ).toThrow(/deployment target is invalid/iu);
  });
});

describe("live research credential-verification marker", () => {
  it("defaults false and accepts only exact closed boolean values", () => {
    expect(loadWebConfig({ ...base }).liveResearchCredentialsVerified).toBe(
      false,
    );
    expect(
      loadWebConfig({
        ...base,
        MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED: "true",
      }).liveResearchCredentialsVerified,
    ).toBe(true);
    expect(
      loadWebConfig({
        ...base,
        MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED: "false",
      }).liveResearchCredentialsVerified,
    ).toBe(false);
  });

  it.each(["1", "TRUE", "yes", "", " true "])(
    "rejects non-canonical marker value %j",
    (value) => {
      expect(() =>
        loadWebConfig({
          ...base,
          MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED: value,
        }),
      ).toThrow(/must be exactly true or false/iu);
    },
  );
});

describe("Consultant result soft cap", () => {
  it("defaults to 20 and accepts a server-owned integer at or above 3", () => {
    expect(loadWebConfig({ ...base }).consultantProjectionConfig).toMatchObject(
      {
        softCap: 20,
        version: "consultant-soft-cap.default-20.v1",
      },
    );
    expect(
      loadWebConfig({
        ...base,
        MATCHBASE_CONSULTANT_RESULT_SOFT_CAP: "7",
        MATCHBASE_CONSULTANT_PROJECTION_CONFIG_ID:
          "00000000-0000-4000-8000-000000000777",
        MATCHBASE_CONSULTANT_PROJECTION_CONFIG_VERSION: "test-cap-7.v1",
        MATCHBASE_CONSULTANT_PROJECTION_CONFIG_SHA256:
          consultantProjectionConfigSha256(7).toString("hex"),
      }).consultantProjectionConfig,
    ).toMatchObject({ softCap: 7, version: "test-cap-7.v1" });
  });

  it("fails closed when a custom cap lacks immutable release identity", () => {
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_CONSULTANT_RESULT_SOFT_CAP: "7",
      }),
    ).toThrow(/requires an ID, version, and SHA-256/iu);
  });

  it.each(["2", "3.5", "NaN", ""])("rejects invalid value %s", (value) => {
    expect(() =>
      loadWebConfig({
        ...base,
        MATCHBASE_CONSULTANT_RESULT_SOFT_CAP: value,
      }),
    ).toThrow(/integer of at least 3/iu);
  });
});
