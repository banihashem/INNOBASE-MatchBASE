import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: /consultant-live-ui\.spec\.mjs/u,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
});
