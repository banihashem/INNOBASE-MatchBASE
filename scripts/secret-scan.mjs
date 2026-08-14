import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inspectRepositoryCandidate,
  repositoryCandidateFiles,
} from "./lib/repository-files.mjs";

const root = resolve(".");
const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
const patterns = [
  new RegExp(
    `${privateKeyMarker.slice(0, 11)}(?:RSA |EC |OPENSSH |DSA )?${privateKeyMarker.slice(11)}`,
  ),
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/,
];
const findings = [];
let scanned = 0;

for (const relativePath of repositoryCandidateFiles(root)) {
  const { path, stat } = inspectRepositoryCandidate(root, relativePath);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  scanned += 1;
  const value = bytes.toString("utf8");
  if (patterns.some((pattern) => pattern.test(value)))
    findings.push(relativePath);
}

if (findings.length)
  throw new Error(`Potential secrets:\n${findings.join("\n")}`);
console.log(`secret scan: PASS (${scanned} Git candidate files)`);
