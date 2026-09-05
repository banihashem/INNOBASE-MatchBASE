import { defineConfig } from "@playwright/test";

const testDeploymentId = `slice1-playwright-${process.pid}-${Date.now()}`;

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 20_000,
  use: { browserName: "chromium", channel: "chrome", headless: true },
  projects: [
    {
      name: "dashboard",
      testMatch: /dashboard\.spec\.mjs/u,
      use: { baseURL: "http://127.0.0.1:4317" },
    },
    {
      name: "product-reference",
      testMatch:
        /product-(?:(?:(?:live|standard|qualified)-)?reference-path|admin-(?:entitlements|requests)|consultant-result|consultant-v2-uat)\.spec\.mjs/u,
      use: { baseURL: "http://127.0.0.1:3010" },
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter @matchbase/dashboard exec vite --host 127.0.0.1 --port 4317 --strictPort",
      url: "http://127.0.0.1:4317",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "pnpm --filter @matchbase/data migrate && pnpm --filter @matchbase/data seed:local && pnpm --filter @matchbase/web exec next dev -H 127.0.0.1 -p 3010",
      url: "http://127.0.0.1:3010",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        MATCHBASE_DATABASE_URL: process.env.DATABASE_URL ?? "",
        MATCHBASE_ENVIRONMENT: "test",
        MATCHBASE_OIDC_SIMULATOR: "true",
        MATCHBASE_SYNTHETIC_FIXTURE: "true",
        MATCHBASE_ORIGIN: "http://127.0.0.1:3010",
        MATCHBASE_DEPLOYMENT_ID: testDeploymentId,
        MATCHBASE_DIGEST_KEY: process.env.MATCHBASE_DIGEST_KEY ?? "",
      },
    },
    {
      command: "pnpm --filter @matchbase/application worker:synthetic",
      url: "http://127.0.0.1:3011/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        MATCHBASE_ENVIRONMENT: "test",
        MATCHBASE_SYNTHETIC_FIXTURE: "true",
        MATCHBASE_DIGEST_KEY: process.env.MATCHBASE_DIGEST_KEY ?? "",
        MATCHBASE_DEPLOYMENT_ID: testDeploymentId,
        MATCHBASE_WORKER_HEALTH_PORT: "3011",
        MATCHBASE_SYNTHETIC_WORKER_DELAY_MS: "1500",
      },
    },
  ],
});
