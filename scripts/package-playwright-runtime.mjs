import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

// MB-UX-PILOT-001 L01: use the frozen dependency closure, never a second install.
const destination = process.argv[2];
if (!destination)
  throw new Error("A Playwright runtime output path is required.");
let requirePackage = createRequire(import.meta.url);
for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
  const manifest = requirePackage.resolve(`${name}/package.json`);
  const target = join(resolve(destination), "node_modules", name);
  await mkdir(dirname(target), { recursive: true });
  await cp(dirname(manifest), target, { recursive: true, dereference: true });
  requirePackage = createRequire(manifest);
}
