import { defineConfig } from "@playwright/test";
import base from "./playwright.consultant-experience.config.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// MB-UX-DEV-004 L02. Reuse local-only target validation; never start a server.
export default defineConfig({
  ...base,
  testMatch: "research-options.spec.mjs",
  outputDir:
    process.env.MATCHBASE_BROWSER_OUTPUT_DIR ??
    join(tmpdir(), "MatchBASE-DEV004-L02-browser"),
});
