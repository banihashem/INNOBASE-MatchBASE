import { spawnSync } from "node:child_process";

const pnpmEntry = process.env.npm_execpath;
const command = pnpmEntry ? process.execPath : "pnpm";
const args = pnpmEntry
  ? [pnpmEntry, "licenses", "list", "--json"]
  : ["licenses", "list", "--json"];
const result = spawnSync(command, args, {
  encoding: "utf8",
  shell: false,
});
if (result.status !== 0) {
  throw new Error(
    result.stderr || result.error?.message || "License inventory failed.",
  );
}
const inventory = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
const reviewed = new Set([
  "MIT",
  "BSD-3-Clause",
  "WTFPL",
  "MIT-0",
  "Apache-2.0",
  "Python-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "ISC",
  "MPL-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "0BSD",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "(MIT OR CC0-1.0)",
]);
const observed = Object.keys(inventory);
const unreviewed = observed.filter((license) => !reviewed.has(license));
if (unreviewed.length) {
  throw new Error(`Unreviewed dependency licenses: ${unreviewed.join(", ")}`);
}
console.log(
  `license policy: PASS (${observed.length} reviewed license expressions)`,
);
