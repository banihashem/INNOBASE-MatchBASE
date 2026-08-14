import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const generator =
  process.env.CI === "true"
    ? "scripts/generate-dashboard-ci-snapshot.mjs"
    : "scripts/generate-dashboard-snapshot.mjs";
const result = spawnSync(process.execPath, [resolve(generator)], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(
    `Dashboard generator failed with exit code ${result.status}.`,
  );
