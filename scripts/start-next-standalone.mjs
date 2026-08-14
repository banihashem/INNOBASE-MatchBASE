import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneWebRoot = join(
  repositoryRoot,
  "apps",
  "web",
  ".next",
  "standalone",
  "apps",
  "web",
);
const serverPath = join(standaloneWebRoot, "server.js");
const assetManifestPath = join(standaloneWebRoot, ".standalone-assets.json");

await Promise.all([stat(serverPath), stat(assetManifestPath)]).catch(() => {
  throw new Error(
    "Packaged Next standalone output is missing. Run the @matchbase/web build first.",
  );
});

process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = "3010";
process.stdout.write(
  `MatchBASE standalone runtime pid=${process.pid} host=127.0.0.1 port=3010\n`,
);
await import(pathToFileURL(serverPath).href);
