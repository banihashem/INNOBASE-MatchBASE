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
    // null requests bytes; coalescing it to UTF-8 makes includes(0) match digit "0".
    encoding: options.encoding === undefined ? "utf8" : options.encoding,
    input: options.input,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Git history inventory failed.");
  return result.stdout;
}

function chunks(values, maximumCount, maximumBytes) {
  const result = [];
  let current = [];
  let currentBytes = 0;
  for (const value of values) {
    if (
      current.length > 0 &&
      (current.length >= maximumCount ||
        currentBytes + value.size > maximumBytes)
    ) {
      result.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(value);
    currentBytes += value.size;
  }
  if (current.length > 0) result.push(current);
  return result;
}

function readBatchBlobs(entries) {
  const output = git(["cat-file", "--batch"], {
    encoding: null,
    input: `${entries.map(({ hash }) => hash).join("\n")}\n`,
    maxBuffer:
      entries.reduce((total, { size }) => total + size, 0) +
      entries.length * 128,
  });
  let offset = 0;
  return entries.map((entry) => {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1)
      throw new Error("Git blob batch header is incomplete.");
    const header = output.subarray(offset, headerEnd).toString("ascii");
    const [hash, type, rawSize] = header.split(" ");
    const size = Number(rawSize);
    if (hash !== entry.hash || type !== "blob" || size !== entry.size)
      throw new Error("Git blob batch identity changed during history scan.");
    const start = headerEnd + 1;
    const end = start + size;
    if (end >= output.length || output[end] !== 0x0a)
      throw new Error("Git blob batch content is incomplete.");
    offset = end + 1;
    return { ...entry, bytes: output.subarray(start, end) };
  });
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
const objectEntries = [...objects].map(([hash, path]) => ({ hash, path }));
const inventory = git(
  ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
  { input: `${objectEntries.map(({ hash }) => hash).join("\n")}\n` },
).trimEnd();
const inventoryLines = inventory ? inventory.split(/\r?\n/u) : [];
if (inventoryLines.length !== objectEntries.length)
  throw new Error("Git history inventory is incomplete.");
const eligible = inventory
  ? inventoryLines.flatMap((line, index) => {
      const [hash, type, rawSize] = line.split(" ");
      const size = Number(rawSize);
      const expected = objectEntries[index];
      if (!expected || expected.hash !== hash)
        throw new Error("Git history inventory changed during secret scan.");
      if (type !== "blob" || !Number.isFinite(size) || size > 5 * 1024 * 1024)
        return [];
      return [{ ...expected, size }];
    })
  : [];
const maximumBatchBytes = 16 * 1024 * 1024;
for (const batch of chunks(eligible, 128, maximumBatchBytes)) {
  for (const { hash, path, bytes } of readBatchBlobs(batch)) {
    if (bytes.includes(0)) continue;
    blobs += 1;
    const value = bytes.toString("utf8");
    if (patterns.some((pattern) => pattern.test(value)))
      findings.push(`${hash} ${path}`);
  }
}
if (findings.length)
  throw new Error(
    `Potential secrets in Git history objects:\n${findings.join("\n")}`,
  );
process.stdout.write(
  `secret history scan: PASS (${blobs} unique text blobs)\n`,
);
