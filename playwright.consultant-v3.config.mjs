import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: /product-consultant-v3-agentic\.spec\.mjs/u,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    headless: true,
  },
});
