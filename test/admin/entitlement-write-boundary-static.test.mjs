import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const writer = join(root, "packages/data/src/admin-entitlements.ts");
const mutation =
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:entitlement_grant|admin_role_grant)\b/giu;

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.isFile() &&
      extname(path) === ".ts" &&
      !path.endsWith(".test.ts") &&
      path !== writer
      ? [path]
      : [];
  });
}

test("entitlement writes exist only in the audited data primitive", () => {
  const violations = [
    join(root, "packages/application/src"),
    join(root, "apps/web/src"),
    join(root, "packages/data/src"),
  ]
    .flatMap(sources)
    .flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(mutation)].map((match) => ({
        file: relative(root, path),
        statement: match[0],
      })),
    );
  assert.deepEqual(violations, []);
});
