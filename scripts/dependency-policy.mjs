import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inspectRepositoryCandidate,
  repositoryCandidateFiles,
} from "./lib/repository-files.mjs";

const root = resolve(".");
const manifestPaths = repositoryCandidateFiles(root).filter(
  (path) =>
    path === "package.json" ||
    /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path),
);
const manifests = manifestPaths.map((path) => ({
  path,
  value: JSON.parse(
    readFileSync(inspectRepositoryCandidate(root, path).path, "utf8"),
  ),
}));
if (!manifests.some(({ path }) => path === "package.json")) {
  throw new Error("Repository root package.json is missing.");
}
const rootManifest = manifests.find(
  ({ path }) => path === "package.json",
).value;
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
    const pinnedExternal = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(
      String(version),
    );
    const pinnedWorkspace =
      String(name).startsWith("@matchbase/") && version === "workspace:*";
    if (!pinnedExternal && !pinnedWorkspace) {
      throw new Error(`Unpinned dependency in ${path}: ${name}@${version}`);
    }
  }
}

console.log(
  `dependency policy: PASS (${dependencyCount} pinned dependencies across ${manifests.length} manifests)`,
);
