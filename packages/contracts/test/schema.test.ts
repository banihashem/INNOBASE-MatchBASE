import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  generateContractSchemas,
  serializeContractSchemas,
} from "../src/schema.js";

test("generates the committed v1 schema bundle byte-for-byte", async () => {
  const artifactPath = fileURLToPath(
    new URL("../../schemas/v1/contracts.schema.json", import.meta.url),
  );
  assert.equal(
    await readFile(artifactPath, "utf8"),
    serializeContractSchemas(),
  );
});

test("uses closed objects for every generated top-level contract", () => {
  const bundle = generateContractSchemas() as {
    schemas: Record<string, { additionalProperties?: boolean }>;
  };
  for (const schema of Object.values(bundle.schemas)) {
    assert.equal(schema.additionalProperties, false);
  }
});
