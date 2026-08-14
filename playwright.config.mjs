import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 20_000,
  use: {
    baseURL: "http://127.0.0.1:4317",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command:
      "pnpm --filter @matchbase/dashboard exec vite --host 127.0.0.1 --port 4317 --strictPort",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
