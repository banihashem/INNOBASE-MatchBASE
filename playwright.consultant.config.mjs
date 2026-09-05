import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "product-consultant-v2-*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 30_000,
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    baseURL: "http://localhost:3000",
  },
});
