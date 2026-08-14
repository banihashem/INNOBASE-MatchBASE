#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { buildArtifactSnapshot, serializeArtifactSnapshot } from "./indexer.js";
import type { IndexerConfig } from "./types.js";

async function main(): Promise<void> {
  const [configArgument, outputArgument] = process.argv.slice(2);
  if (configArgument === undefined || outputArgument === undefined) {
    throw new Error(
      "usage: matchbase-artifact-index <absolute-config.json> <absolute-output.json>",
    );
  }
  if (!isAbsolute(configArgument) || !isAbsolute(outputArgument)) {
    throw new Error("config and output paths must be absolute");
  }
  const configPath = resolve(configArgument);
  const outputPath = resolve(outputArgument);
  const config = JSON.parse(
    await readFile(configPath, "utf8"),
  ) as IndexerConfig;
  const snapshot = await buildArtifactSnapshot(config);
  await writeFile(outputPath, serializeArtifactSnapshot(snapshot), {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(`${snapshot.snapshotId}\n`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "unknown indexer failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
