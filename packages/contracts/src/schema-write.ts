import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serializeContractSchemas } from "./schema.js";

const artifactPath = fileURLToPath(
  new URL("../../schemas/v1/contracts.schema.json", import.meta.url),
);
await writeFile(artifactPath, serializeContractSchemas(), "utf8");
console.log(`contract schemas: GENERATED (${artifactPath})`);
