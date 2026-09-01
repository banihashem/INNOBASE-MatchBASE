import {
  assertRuntimeIdentityPolicy,
  type RuntimeEnvironment,
} from "@matchbase/auth";
import {
  consultantProjectionConfigFromEnvironment,
  type ConsultantProjectionConfigRelease,
} from "@matchbase/data";
import { isAbsolute } from "node:path";

export interface WebConfig {
  environment: RuntimeEnvironment;
  deploymentEnvironment?: "staging" | "production";
  deploymentTarget?:
    "staging" | "staging-eu" | "staging-eu-canary" | "production";
  origin: string;
  deploymentId: string;
  imageDigest?: string;
  databaseUrl: string;
  oidcSimulatorEnabled: boolean;
  syntheticFixtureEnabled: boolean;
  liveResearchEnabled?: boolean;
  liveResearchCredentialsVerified?: boolean;
  testLivePolicyPath?: string;
  geminiApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleAuthorizationEndpoint?: string;
  googleTokenEndpoint?: string;
  googleIssuer?: string;
  googleJwksUri?: string;
  googleRedirectUri?: string;
  artifactGcsBucket?: string;
  artifactMaximumBytes?: number;
  originAdmissionKey?: Buffer;
  digestKey: Buffer;
  consultantProjectionConfig?: ConsultantProjectionConfigRelease;
  port: number;
}

const PRODUCTION_TARGETS = Object.freeze({
  staging: Object.freeze({
    deploymentEnvironment: "staging" as const,
    origin: "https://matchbase-staging.innobase.app",
    artifactBucket: "innobase-matchbase-stg-artifacts",
  }),
  "staging-eu": Object.freeze({
    deploymentEnvironment: "staging" as const,
    origin: "https://matchbase-staging.innobase.app",
    artifactBucket: "innobase-matchbase-stg-eu-artifacts",
  }),
  "staging-eu-canary": Object.freeze({
    deploymentEnvironment: "staging" as const,
    origin: "https://matchbase-staging-eu-canary.innobase.app",
    artifactBucket: "innobase-matchbase-stg-eu-artifacts",
  }),
  production: Object.freeze({
    deploymentEnvironment: "production" as const,
    origin: "https://matchbase.innobase.app",
    artifactBucket: "innobase-matchbase-artifacts",
  }),
});

function enabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function closedBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be exactly true or false.`);
}

function assertProductionIdentityEndpoints(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const origin = new URL(environment.MATCHBASE_ORIGIN ?? "");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Production origin must be an HTTPS origin.");
  }
  if (
    environment.GOOGLE_REDIRECT_URI !==
    new URL("/auth/google/callback", origin).toString()
  ) {
    throw new Error("Production Google redirect URI must match the origin.");
  }
  const fixed = {
    GOOGLE_AUTHORIZATION_ENDPOINT:
      "https://accounts.google.com/o/oauth2/v2/auth",
    GOOGLE_TOKEN_ENDPOINT: "https://oauth2.googleapis.com/token",
    GOOGLE_ISSUER: "https://accounts.google.com",
    GOOGLE_JWKS_URI: "https://www.googleapis.com/oauth2/v3/certs",
  } as const;
  for (const [name, expected] of Object.entries(fixed)) {
    const configured = environment[name];
    if (configured !== undefined && configured !== expected) {
      throw new Error(`Production ${name} override is prohibited.`);
    }
  }
}

export function loadWebConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebConfig {
  const runtime = (environment.MATCHBASE_ENVIRONMENT ??
    "local") as RuntimeEnvironment;
  if (!["local", "test", "production"].includes(runtime))
    throw new Error("Invalid runtime environment.");
  if (environment.NODE_ENV === "production" && runtime !== "production") {
    throw new Error(
      "Production Node runtime requires MATCHBASE_ENVIRONMENT=production.",
    );
  }
  const oidcSimulatorEnabled = enabled(environment.MATCHBASE_OIDC_SIMULATOR);
  const syntheticFixtureEnabled = enabled(
    environment.MATCHBASE_SYNTHETIC_FIXTURE,
  );
  const liveResearchEnabled = enabled(
    environment.MATCHBASE_LIVE_RESEARCH_ENABLED,
  );
  const liveResearchCredentialsVerified = closedBoolean(
    "MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED",
    environment.MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED,
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
  if (runtime === "production") assertProductionIdentityEndpoints(environment);
  if (runtime === "production" && !environment.MATCHBASE_ARTIFACT_GCS_BUCKET) {
    throw new Error("Production artifact GCS configuration is incomplete.");
  }
  if (runtime === "production" && !environment.MATCHBASE_GEMINI_API_KEY) {
    throw new Error(
      "Production Gemini canonicalization configuration is incomplete.",
    );
  }
  if (runtime === "production" && environment.MATCHBASE_OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API keys are prohibited in the web runtime.");
  }
  const originAdmissionKeyText = environment.MATCHBASE_ORIGIN_ADMISSION_KEY;
  if (
    runtime === "production" &&
    (!originAdmissionKeyText || Buffer.byteLength(originAdmissionKeyText) < 32)
  ) {
    throw new Error("Production origin admission configuration is incomplete.");
  }
  let deploymentEnvironment: "staging" | "production" | undefined;
  let deploymentTarget:
    "staging" | "staging-eu" | "staging-eu-canary" | "production" | undefined;
  if (runtime === "production") {
    const targetName = environment.MATCHBASE_DEPLOYMENT_ENVIRONMENT;
    if (targetName !== "staging" && targetName !== "production") {
      throw new Error(
        "Production deployment environment is invalid or missing.",
      );
    }
    deploymentEnvironment = targetName;
    const selectedTarget =
      environment.MATCHBASE_DEPLOYMENT_TARGET ?? targetName;
    if (
      selectedTarget !== "staging" &&
      selectedTarget !== "staging-eu" &&
      selectedTarget !== "staging-eu-canary" &&
      selectedTarget !== "production"
    ) {
      throw new Error("Production deployment target is invalid.");
    }
    deploymentTarget = selectedTarget;
    const target = PRODUCTION_TARGETS[selectedTarget];
    if (
      target.deploymentEnvironment !== targetName ||
      environment.MATCHBASE_ORIGIN !== target.origin ||
      environment.MATCHBASE_ARTIFACT_GCS_BUCKET !== target.artifactBucket
    ) {
      throw new Error("Production runtime is outside the closed target map.");
    }
    const deploymentId = environment.MATCHBASE_DEPLOYMENT_ID ?? "";
    const imageDigest = environment.MATCHBASE_IMAGE_DIGEST ?? "";
    if (!/^sha256:[a-f0-9]{64}$/u.test(deploymentId)) {
      throw new Error(
        "Production deployment ID must be an immutable SHA-256 digest.",
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(imageDigest)) {
      throw new Error(
        "Production image identity must be an immutable SHA-256 digest.",
      );
    }
    if (deploymentId !== imageDigest) {
      throw new Error(
        "Production deployment identity must match the deployed image digest.",
      );
    }
  }
  const artifactMaximumBytes = Number(
    environment.MATCHBASE_ARTIFACT_MAXIMUM_BYTES ?? 8 * 1_024 * 1_024,
  );
  if (
    !Number.isSafeInteger(artifactMaximumBytes) ||
    artifactMaximumBytes < 1 ||
    artifactMaximumBytes > 8 * 1_024 * 1_024
  ) {
    throw new Error("Artifact byte limit is outside the memory-safe bound.");
  }
  return {
    environment: runtime,
    ...(deploymentEnvironment ? { deploymentEnvironment } : {}),
    ...(deploymentTarget ? { deploymentTarget } : {}),
    origin: environment.MATCHBASE_ORIGIN ?? "https://localhost:3000",
    deploymentId: environment.MATCHBASE_DEPLOYMENT_ID ?? "local-unreleased",
    ...(environment.MATCHBASE_IMAGE_DIGEST
      ? { imageDigest: environment.MATCHBASE_IMAGE_DIGEST }
      : {}),
    databaseUrl,
    oidcSimulatorEnabled,
    syntheticFixtureEnabled,
    liveResearchEnabled,
    liveResearchCredentialsVerified,
    ...(testLivePolicyPath ? { testLivePolicyPath } : {}),
    ...(environment.MATCHBASE_GEMINI_API_KEY
      ? { geminiApiKey: environment.MATCHBASE_GEMINI_API_KEY }
      : {}),
    ...(environment.GOOGLE_CLIENT_ID
      ? { googleClientId: environment.GOOGLE_CLIENT_ID }
      : {}),
    ...(environment.GOOGLE_CLIENT_SECRET
      ? { googleClientSecret: environment.GOOGLE_CLIENT_SECRET }
      : {}),
    ...(environment.GOOGLE_REDIRECT_URI
      ? { googleRedirectUri: environment.GOOGLE_REDIRECT_URI }
      : {}),
    ...(environment.MATCHBASE_ARTIFACT_GCS_BUCKET
      ? { artifactGcsBucket: environment.MATCHBASE_ARTIFACT_GCS_BUCKET }
      : {}),
    artifactMaximumBytes,
    ...(originAdmissionKeyText
      ? { originAdmissionKey: Buffer.from(originAdmissionKeyText, "utf8") }
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
    consultantProjectionConfig:
      consultantProjectionConfigFromEnvironment(environment),
    port: Number(environment.PORT ?? 3000),
  };
}
