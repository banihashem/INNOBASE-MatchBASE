import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { trackedIgnoredFiles } from "./lib/repository-files.mjs";
import { verifyTierProjectionBoundary } from "./lib/tier-projection-boundary.mjs";

const root = resolve(".");
const forbidden = new Set([
  "00_Authoritative_Sources",
  "01_Product_Management",
  "02_Product_Research_and_Planning",
  ".cw17_backup",
  ".role2_tmp",
  ".role3_work",
  ".work",
]);
const forbiddenExtensions = new Set([
  ".pdf",
  ".docx",
  ".env",
  ".pem",
  ".p12",
  ".pfx",
]);
const violations = [];
const pinnedPublicMaterial = new Map([
  [
    `config${sep}slice3${sep}role2-v5-tpm-ecdsa-p256-public.pem`,
    "5897804885924CE5499494F9D00471A6B1D918671B6D17F7206C6007AFCDF1E4",
  ],
]);
for (const path of trackedIgnoredFiles(root)) {
  violations.push(`${path} (tracked path is ignored by policy)`);
}

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (name === ".git" || name === "node_modules") continue;
    const path = resolve(directory, name);
    const rel = relative(root, path);
    const first = rel.split(sep)[0];
    if (forbidden.has(first)) violations.push(rel);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      violations.push(`${rel} (symbolic links and junctions are prohibited)`);
      continue;
    }
    const real = realpathSync(path);
    const realDifference = relative(realpathSync(root), real);
    if (
      realDifference === ".." ||
      realDifference.startsWith(`..${sep}`) ||
      isAbsolute(realDifference)
    ) {
      violations.push(`${rel} (resolves outside repository)`);
      continue;
    }
    if (stat.isDirectory()) walk(path);
    else {
      const lower = name.toLowerCase();
      if (
        [...forbiddenExtensions].some((ext) => lower.endsWith(ext)) &&
        !lower.endsWith(".env.example") &&
        !(
          pinnedPublicMaterial.has(rel) &&
          createHash("sha256")
            .update(readFileSync(path))
            .digest("hex")
            .toUpperCase() === pinnedPublicMaterial.get(rel)
        )
      )
        violations.push(rel);
      if (/^(license|copying)(\.|$)/i.test(name))
        violations.push(`${rel} (licensing decision required)`);
    }
  }
}

walk(root);
for (const violation of verifyTierProjectionBoundary(root))
  violations.push(`${violation} (tier projection boundary)`);
if (violations.length)
  throw new Error(`Boundary violations:\n${violations.join("\n")}`);
console.log("boundaries: PASS");
