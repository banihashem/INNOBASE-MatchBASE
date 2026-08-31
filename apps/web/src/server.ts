import { createServer } from "node:http";
import {
  ConsultantResultApplication,
  MatchBaseApplication,
  StandardWorkspaceApplication,
} from "@matchbase/application";
import {
  createPool,
  DEFAULT_CONSULTANT_PROJECTION_CONFIG,
} from "@matchbase/data";
import { loadWebConfig } from "./config";
import { createWebRuntime } from "./runtime";
import { loadServerOwnedResearchAdmission } from "./server-owned-research-admission";
import { createRuntimeCanonicalizer } from "./canonicalization-runtime";

const config = loadWebConfig();
if (config.environment === "production") {
  throw new Error(
    "Legacy HTTP runtime is prohibited in production; use the packaged Next standalone runtime.",
  );
}
const pool = createPool({ connectionString: config.databaseUrl, max: 20 });
const canonicalizer = createRuntimeCanonicalizer(config);
const application = new MatchBaseApplication({
  pool,
  canonicalizer,
  canonicalizationBudgetMs: 20_000,
  privacyKey: config.digestKey,
  researchAdmission: loadServerOwnedResearchAdmission(config),
  consultantProjectionConfig:
    config.consultantProjectionConfig ?? DEFAULT_CONSULTANT_PROJECTION_CONFIG,
});
const standardApplication = new StandardWorkspaceApplication({
  pool,
  privacyKey: config.digestKey,
  consultantProjectionConfig:
    config.consultantProjectionConfig ?? DEFAULT_CONSULTANT_PROJECTION_CONFIG,
});
const consultantResultApplication = new ConsultantResultApplication(pool);
const listener = createWebRuntime({
  config,
  pool,
  application,
  standardApplication,
  consultantResultApplication,
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
