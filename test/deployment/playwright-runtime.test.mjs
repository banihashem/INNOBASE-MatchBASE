import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("MB-UX-PILOT-001 L01 frozen Playwright closure imports outside the repository", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "matchbase-pilot-playwright-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../scripts/package-playwright-runtime.mjs",
          import.meta.url,
        ),
      ),
      root,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const requireRuntime = createRequire(join(root, "runtime.cjs"));
  const expected = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ).devDependencies["@playwright/test"];
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    const manifest = requireRuntime.resolve(`${name}/package.json`);
    assert.ok(
      (await realpath(manifest)).startsWith(`${await realpath(root)}${sep}`),
    );
    assert.equal(requireRuntime(`${name}/package.json`).version, expected);
  }
  assert.equal(
    typeof requireRuntime("@playwright/test").chromium.launch,
    "function",
  );
});
