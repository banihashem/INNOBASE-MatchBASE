import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// MB-UX-DEV-004 L01: existing local server only; never migrate, seed or start a worker.
const baseURL =
  process.env.MATCHBASE_BROWSER_BASE_URL ?? "http://127.0.0.1:3000";
const target = new URL(baseURL);
if (
  !/^https?:$/.test(target.protocol) ||
  !/^(localhost|127\.0\.0\.1|10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(
    target.hostname,
  )
)
  throw new Error(
    "Consultant browser scenarios require an explicitly local server.",
  );

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "consultant-experience.spec.mjs",
  outputDir:
    process.env.MATCHBASE_BROWSER_OUTPUT_DIR ??
    join(tmpdir(), "MatchBASE-DEV004-browser"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: "line",
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
