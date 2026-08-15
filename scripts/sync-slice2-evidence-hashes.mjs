import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const path = resolve(root, "evidence/slice2/local-validation.json");
const evidence = JSON.parse(readFileSync(path, "utf8"));
for (const artifact of evidence.artifacts) {
  artifact.sha256 = createHash("sha256")
    .update(readFileSync(resolve(root, artifact.path)))
    .digest("hex")
    .toUpperCase();
}
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(
  `slice2 evidence hashes: ${evidence.artifacts.length} artifacts synchronized`,
);
