import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serializeContractSchemas } from "./schema.js";

const artifactPath = fileURLToPath(
  new URL("../../schemas/v1/contracts.schema.json", import.meta.url),
);
const actual = await readFile(artifactPath, "utf8");
if (actual !== serializeContractSchemas()) {
  throw new Error(`Contract schema artifact is stale: ${artifactPath}`);
}
console.log(`contract schemas: PASS (${artifactPath})`);
