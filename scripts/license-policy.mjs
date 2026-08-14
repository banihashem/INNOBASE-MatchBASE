import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const pnpmEntry = process.env.npm_execpath;
const command = pnpmEntry ? process.execPath : "pnpm";
const args = pnpmEntry
  ? [pnpmEntry, "licenses", "list", "--json"]
  : ["licenses", "list", "--json"];
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

const reviewedPackageLicenses = new Map([
  ["LGPL-3.0-or-later", new Set(["@img/sharp-libvips-linux-x64@1.3.2"])],
]);

export function validateLicenseInventory(inventory) {
  const observed = Object.keys(inventory);
  const unreviewed = observed.filter((license) => {
    if (reviewed.has(license)) return false;
    const allowedPackages = reviewedPackageLicenses.get(license);
    const packages = inventory[license];
    if (!allowedPackages || !Array.isArray(packages) || packages.length === 0) {
      return true;
    }
    return packages.some(
      (entry) =>
        !Array.isArray(entry.versions) ||
        entry.versions.length === 0 ||
        entry.versions.some(
          (version) => !allowedPackages.has(`${entry.name}@${version}`),
        ),
    );
  });
  if (unreviewed.length) {
    throw new Error(`Unreviewed dependency licenses: ${unreviewed.join(", ")}`);
  }
  return observed.length;
}

function main() {
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
  const observedCount = validateLicenseInventory(inventory);
  console.log(
    `license policy: PASS (${observedCount} reviewed license expressions)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
