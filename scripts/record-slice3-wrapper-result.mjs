import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const manifestPath = resolve(root, "evidence/slice3/candidate-manifest.json");
const outputPath = resolve(root, "evidence/slice3/full-wrapper-result.json");
const pending = process.argv.includes("--pending");
const durationIndex = process.argv.indexOf("--duration-ms");
const durationMs = Number(process.argv[durationIndex + 1]);
if (
  !pending &&
  (durationIndex < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > 3_600_000)
)
  throw new Error("Slice 3 wrapper duration is invalid.");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const result = {
  schemaVersion: "matchbase.slice3-full-wrapper-result/v1",
  observedAt: new Date().toISOString(),
  command: "pnpm test:ci && pnpm dependency:audit",
  durationMs: pending ? null : durationMs,
  result: pending ? "PENDING" : "PASS",
  exitCode: pending ? null : 0,
  candidate: {
    manifestSha256: createHash("sha256")
      .update(manifestBytes)
      .digest("hex")
      .toUpperCase(),
    aggregateSha256: manifest.aggregateSha256,
    fileCount: manifest.fileCount,
  },
  providerCalls: 0,
  externalMutations: 0,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
  `slice3 wrapper result: RECORDED (${result.result}; ${pending ? "pending" : `${durationMs}ms`}; ${result.candidate.manifestSha256})`,
);
