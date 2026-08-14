import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPaths = [
  "package.json",
  "apps/dashboard/package.json",
  "packages/artifact-indexer/package.json",
];
const manifests = manifestPaths.map((path) => ({
  path,
  value: JSON.parse(readFileSync(resolve(path), "utf8")),
}));
const rootManifest = manifests[0].value;
if (!rootManifest.private || rootManifest.license !== "UNLICENSED") {
  throw new Error(
    "Repository root must remain private and UNLICENSED pending owner/counsel decision.",
  );
}

let dependencyCount = 0;
for (const { path, value } of manifests) {
  if (!value.private) throw new Error(`${path} must remain private.`);
  const dependencies = {
    ...value.dependencies,
    ...value.devDependencies,
  };
  for (const [name, version] of Object.entries(dependencies)) {
    dependencyCount += 1;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version))) {
      throw new Error(`Unpinned dependency in ${path}: ${name}@${version}`);
    }
  }
}

console.log(
  `dependency policy: PASS (${dependencyCount} pinned dependencies across ${manifests.length} manifests)`,
);
