import { createServer } from "node:http";
import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
  type CanonicalizationCapability,
} from "@matchbase/ai-evidence";
import {
  MatchBaseApplication,
  StandardWorkspaceApplication,
} from "@matchbase/application";
import { createPool } from "@matchbase/data";
import { loadWebConfig } from "./config";
import { createWebRuntime } from "./runtime";

const config = loadWebConfig();
const pool = createPool({ connectionString: config.databaseUrl, max: 20 });
const canonicalizer: CanonicalizationCapability = config.syntheticFixtureEnabled
  ? new DeterministicFixtureCanonicalizer({
      digestKey: config.digestKey,
      digestKeyId: "runtime-v1",
      languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
    })
  : {
      capabilityId: "CAP-TRANSLATE",
      async canonicalize() {
        throw new Error("No approved canonicalization route is configured.");
      },
    };
const application = new MatchBaseApplication({
  pool,
  canonicalizer,
  privacyKey: config.digestKey,
});
const standardApplication = new StandardWorkspaceApplication({
  pool,
  privacyKey: config.digestKey,
});
const listener = createWebRuntime({
  config,
  pool,
  application,
  standardApplication,
});
const server = createServer(
  (request, response) => void listener(request, response),
);

server.listen(config.port, "0.0.0.0");

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
