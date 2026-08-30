import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
} from "@matchbase/ai-evidence";
import {
  consultantProjectionConfigFromEnvironment,
  createPool,
} from "@matchbase/data";
import { MatchBaseApplication } from "./service.js";
import type { PersistedTier, RequestContext } from "./types.js";
import { probeDatabaseReadiness, WorkerReadiness } from "./worker-readiness.js";

const databaseUrl = process.env.DATABASE_URL;
const digestKeyText = process.env.MATCHBASE_DIGEST_KEY;
const environment = process.env.MATCHBASE_ENVIRONMENT;
const fixtureEnabled = process.env.MATCHBASE_SYNTHETIC_FIXTURE === "true";
if (
  !databaseUrl ||
  !digestKeyText ||
  Buffer.byteLength(digestKeyText) < 32 ||
  !fixtureEnabled ||
  !["local", "test"].includes(environment ?? "")
) {
  throw new Error("Synthetic worker configuration is invalid or prohibited.");
}

const digestKey = Buffer.from(digestKeyText, "utf8");
const databaseProbeTimeoutText =
  process.env.MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS ?? "1000";
if (!/^\d+$/u.test(databaseProbeTimeoutText)) {
  throw new Error("Synthetic worker database probe timeout is invalid.");
}
const databaseProbeTimeoutMs = Number(databaseProbeTimeoutText);
if (databaseProbeTimeoutMs < 100 || databaseProbeTimeoutMs > 5_000) {
  throw new Error(
    "Synthetic worker database probe timeout must be between 100 and 5000 milliseconds.",
  );
}
const pool = createPool({
  connectionString: databaseUrl,
  max: 4,
  connectionTimeoutMillis: databaseProbeTimeoutMs,
  query_timeout: databaseProbeTimeoutMs,
});
const application = new MatchBaseApplication({
  pool,
  privacyKey: digestKey,
  canonicalizer: new DeterministicFixtureCanonicalizer({
    digestKey,
    digestKeyId: "synthetic-worker-v1",
    languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
  }),
  consultantProjectionConfig: consultantProjectionConfigFromEnvironment(
    process.env,
  ),
});
const delayMs = Math.max(
  0,
  Math.min(
    Number(process.env.MATCHBASE_SYNTHETIC_WORKER_DELAY_MS ?? 300),
    5_000,
  ),
);
let stopping = false;
let nextCycle: NodeJS.Timeout | undefined;
const readiness = new WorkerReadiness();

async function work(): Promise<void> {
  if (stopping) return;
  try {
    if (
      !(await probeDatabaseReadiness(pool, readiness, databaseProbeTimeoutMs))
    ) {
      return;
    }
    const queued = await pool.query<{
      run_id: string;
      account_id: string;
      requested_by_user_id: string;
      tier: PersistedTier;
    }>(
      `SELECT rr.run_id, rr.account_id, rr.requested_by_user_id, g.tier
         FROM research_run rr
         JOIN LATERAL (
           SELECT tier FROM entitlement_grant
            WHERE account_id = rr.account_id
              AND user_id = rr.requested_by_user_id
              AND effective_from <= clock_timestamp()
              AND (effective_to IS NULL OR effective_to > clock_timestamp())
              AND revoked_at IS NULL
            ORDER BY effective_from DESC, created_at DESC LIMIT 1
         ) g ON true
        WHERE rr.state = 'queued'
        ORDER BY rr.queued_at, rr.run_id
        LIMIT 1`,
    );
    const row = queued.rows[0];
    if (row) {
      if (delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      const context: RequestContext = {
        accountId: row.account_id,
        userId: row.requested_by_user_id,
        tier: row.tier,
        adminSubRoles: [],
        correlationId: randomUUID(),
        deploymentId: "slice1-local-worker",
      };
      await application.executeSyntheticRun(context, row.run_id, "three");
    }
  } catch {
    readiness.markUnready("database_operation_failed");
  } finally {
    if (!stopping) nextCycle = setTimeout(() => void work(), 50);
  }
}

if (
  process.env.MATCHBASE_WORKER_HEALTH_PORT !== undefined &&
  process.env.MATCHBASE_WORKER_HEALTH_PORT !== "3011"
) {
  throw new Error("Synthetic worker health port must be exactly 3011.");
}
const healthPort = 3011;
const server = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  const snapshot = readiness.snapshot();
  response
    .writeHead(snapshot.status === "ready" ? 200 : 503, {
      "Content-Type": "application/json",
    })
    .end(JSON.stringify(snapshot));
});
server.listen(healthPort, "127.0.0.1", () => void work());

async function shutdown(): Promise<void> {
  stopping = true;
  readiness.markUnready("shutdown");
  if (nextCycle) clearTimeout(nextCycle);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
}

function requestShutdown(): void {
  void shutdown().catch(() => {
    process.exitCode = 1;
  });
}

process.once("SIGTERM", requestShutdown);
process.once("SIGINT", requestShutdown);
