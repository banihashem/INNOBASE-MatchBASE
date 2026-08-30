import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  consultantProjectionConfigFromEnvironment,
  createPool,
  recoverExpiredExecutionLeases,
} from "@matchbase/data";
import { StandardWorkspaceApplication } from "./standard-workspace.js";
import type { RequestContext } from "./types.js";
import { probeDatabaseReadiness, WorkerReadiness } from "./worker-readiness.js";

const databaseUrl = process.env.DATABASE_URL;
const digestKeyText = process.env.MATCHBASE_DIGEST_KEY;
const environment = process.env.MATCHBASE_ENVIRONMENT;
if (
  !databaseUrl ||
  !digestKeyText ||
  Buffer.byteLength(digestKeyText) < 32 ||
  process.env.MATCHBASE_SYNTHETIC_FIXTURE !== "true" ||
  !["local", "test"].includes(environment ?? "")
)
  throw new Error(
    "Standard synthetic worker configuration is invalid or prohibited.",
  );
const probeMs = Number(
  process.env.MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS ?? "1000",
);
if (!Number.isSafeInteger(probeMs) || probeMs < 100 || probeMs > 5_000)
  throw new Error("Synthetic worker database probe timeout is invalid.");
const pool = createPool({
  connectionString: databaseUrl,
  max: 4,
  connectionTimeoutMillis: probeMs,
});
const application = new StandardWorkspaceApplication({
  pool,
  privacyKey: digestKeyText,
  consultantProjectionConfig: consultantProjectionConfigFromEnvironment(
    process.env,
  ),
});
const readiness = new WorkerReadiness();
let stopping = false;
let nextCycle: NodeJS.Timeout | undefined;

async function work(): Promise<void> {
  if (stopping) return;
  try {
    if (!(await probeDatabaseReadiness(pool, readiness, probeMs))) return;
    if (!(await application.readiness())) {
      readiness.markUnready("schema_not_ready");
      return;
    }
    await recoverExpiredExecutionLeases(
      pool,
      randomUUID(),
      "slice2-local-worker",
    );
    const queued = await pool.query<{
      run_id: string;
      account_id: string;
      requested_by_user_id: string;
    }>(
      `SELECT rr.run_id,rr.account_id,rr.requested_by_user_id FROM research_run rr
        JOIN LATERAL (SELECT tier FROM entitlement_grant WHERE account_id=rr.account_id AND user_id=rr.requested_by_user_id AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) AND revoked_at IS NULL ORDER BY effective_from DESC,created_at DESC LIMIT 1) g ON g.tier='standard'
       WHERE rr.state IN ('queued','failed_retryable') ORDER BY rr.queued_at,rr.run_id LIMIT 1`,
    );
    const row = queued.rows[0];
    if (row) {
      const context: RequestContext = {
        accountId: row.account_id,
        userId: row.requested_by_user_id,
        tier: "standard",
        adminSubRoles: [],
        correlationId: randomUUID(),
        deploymentId: "slice2-local-worker",
      };
      await application.executeSyntheticRun(context, row.run_id);
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
)
  throw new Error("Synthetic worker health port must be exactly 3011.");
const server = createServer((request, response) => {
  if (request.url !== "/health") return void response.writeHead(404).end();
  const snapshot = readiness.snapshot();
  response
    .writeHead(snapshot.status === "ready" ? 200 : 503, {
      "Content-Type": "application/json",
    })
    .end(JSON.stringify(snapshot));
});
server.listen(3011, "127.0.0.1", () => void work());

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
