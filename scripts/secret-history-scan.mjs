import { spawnSync } from "node:child_process";

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/u,
];

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    shell: false,
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 6 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Git history inventory failed.");
  return result.stdout;
}

const objects = new Map();
for (const line of git(["rev-list", "--objects", "--all"]).split(/\r?\n/u)) {
  if (!line) continue;
  const separator = line.indexOf(" ");
  const hash = separator === -1 ? line : line.slice(0, separator);
  const path = separator === -1 ? "(unmapped)" : line.slice(separator + 1);
  if (!objects.has(hash)) objects.set(hash, path);
}
let blobs = 0;
const findings = [];
for (const [hash, path] of objects) {
  if (git(["cat-file", "-t", hash]).trim() !== "blob") continue;
  const size = Number(git(["cat-file", "-s", hash]).trim());
  if (!Number.isFinite(size) || size > 5 * 1024 * 1024) continue;
  const bytes = git(["cat-file", "blob", hash], { encoding: null });
  if (bytes.includes(0)) continue;
  blobs += 1;
  const value = bytes.toString("utf8");
  if (patterns.some((pattern) => pattern.test(value)))
    findings.push(`${hash} ${path}`);
}
if (findings.length)
  throw new Error(
    `Potential secrets in Git history objects:\n${findings.join("\n")}`,
  );
process.stdout.write(
  `secret history scan: PASS (${blobs} unique text blobs)\n`,
);
