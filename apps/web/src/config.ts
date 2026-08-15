import {
  assertRuntimeIdentityPolicy,
  type RuntimeEnvironment,
} from "@matchbase/auth";
import { isAbsolute } from "node:path";

export interface WebConfig {
  environment: RuntimeEnvironment;
  origin: string;
  deploymentId: string;
  databaseUrl: string;
  oidcSimulatorEnabled: boolean;
  syntheticFixtureEnabled: boolean;
  liveResearchEnabled?: boolean;
  testLivePolicyPath?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleAuthorizationEndpoint?: string;
  googleTokenEndpoint?: string;
  googleIssuer?: string;
  googleJwksUri?: string;
  googleRedirectUri?: string;
  digestKey: Buffer;
  port: number;
}

function enabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function loadWebConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebConfig {
  const runtime = (environment.MATCHBASE_ENVIRONMENT ??
    "local") as RuntimeEnvironment;
  if (!["local", "test", "production"].includes(runtime))
    throw new Error("Invalid runtime environment.");
  const oidcSimulatorEnabled = enabled(environment.MATCHBASE_OIDC_SIMULATOR);
  const syntheticFixtureEnabled = enabled(
    environment.MATCHBASE_SYNTHETIC_FIXTURE,
  );
  const liveResearchEnabled = enabled(
    environment.MATCHBASE_LIVE_RESEARCH_ENABLED,
  );
  const testLivePolicyPath = environment.MATCHBASE_TEST_LIVE_POLICY_PATH;
  if (testLivePolicyPath && runtime !== "test") {
    throw new Error("Test live policy override is prohibited outside test.");
  }
  if (testLivePolicyPath && !isAbsolute(testLivePolicyPath)) {
    throw new Error("Test live policy override must be an absolute path.");
  }
  assertRuntimeIdentityPolicy({
    environment: runtime,
    oidcSimulatorEnabled,
    syntheticFixtureEnabled,
  });
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const digestKeyText = environment.MATCHBASE_DIGEST_KEY;
  if (!digestKeyText || Buffer.byteLength(digestKeyText) < 32) {
    throw new Error("MATCHBASE_DIGEST_KEY must contain at least 32 bytes.");
  }
  if (
    runtime === "production" &&
    (!environment.GOOGLE_CLIENT_ID ||
      !environment.GOOGLE_CLIENT_SECRET ||
      !environment.GOOGLE_REDIRECT_URI)
  ) {
    throw new Error("Production Google OIDC configuration is incomplete.");
  }
  return {
    environment: runtime,
    origin: environment.MATCHBASE_ORIGIN ?? "https://localhost:3000",
    deploymentId: environment.MATCHBASE_DEPLOYMENT_ID ?? "local-unreleased",
    databaseUrl,
    oidcSimulatorEnabled,
    syntheticFixtureEnabled,
    liveResearchEnabled,
    ...(testLivePolicyPath ? { testLivePolicyPath } : {}),
    ...(environment.GOOGLE_CLIENT_ID
      ? { googleClientId: environment.GOOGLE_CLIENT_ID }
      : {}),
    ...(environment.GOOGLE_CLIENT_SECRET
      ? { googleClientSecret: environment.GOOGLE_CLIENT_SECRET }
      : {}),
    ...(environment.GOOGLE_REDIRECT_URI
      ? { googleRedirectUri: environment.GOOGLE_REDIRECT_URI }
      : {}),
    googleAuthorizationEndpoint:
      environment.GOOGLE_AUTHORIZATION_ENDPOINT ??
      "https://accounts.google.com/o/oauth2/v2/auth",
    googleTokenEndpoint:
      environment.GOOGLE_TOKEN_ENDPOINT ??
      "https://oauth2.googleapis.com/token",
    googleIssuer: environment.GOOGLE_ISSUER ?? "https://accounts.google.com",
    googleJwksUri:
      environment.GOOGLE_JWKS_URI ??
      "https://www.googleapis.com/oauth2/v3/certs",
    digestKey: Buffer.from(digestKeyText, "utf8"),
    port: Number(environment.PORT ?? 3000),
  };
}
