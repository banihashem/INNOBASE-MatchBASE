import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
} from "@matchbase/ai-evidence";
import {
  consultantProjectionConfigFromEnvironment,
  createPool,
  recoverExpiredExecutionLeases,
} from "@matchbase/data";
import { MatchBaseApplication } from "./service.js";
import { StandardWorkspaceApplication } from "./standard-workspace.js";
import type { PersistedTier, RequestContext } from "./types.js";
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
    "Combined synthetic worker configuration is invalid or prohibited.",
  );
const probeMs = Number(
  process.env.MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS ?? "1000",
);
if (!Number.isSafeInteger(probeMs) || probeMs < 100 || probeMs > 5_000)
  throw new Error("Synthetic worker database probe timeout is invalid.");
const digestKey = Buffer.from(digestKeyText, "utf8");
const pool = createPool({
  connectionString: databaseUrl,
  max: 6,
  connectionTimeoutMillis: probeMs,
});
const consultantProjectionConfig = consultantProjectionConfigFromEnvironment(
  process.env,
);
const demoApplication = new MatchBaseApplication({
  pool,
  privacyKey: digestKey,
  canonicalizer: new DeterministicFixtureCanonicalizer({
    digestKey,
    digestKeyId: "combined-worker-v1",
    languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
  }),
  consultantProjectionConfig,
});
const standardApplication = new StandardWorkspaceApplication({
  pool,
  privacyKey: digestKey,
  consultantProjectionConfig,
});
const readiness = new WorkerReadiness();
let stopping = false;
let nextCycle: NodeJS.Timeout | undefined;
let lastCycleFailure = "";
const delayMs = Math.max(
  0,
  Math.min(
    Number(process.env.MATCHBASE_SYNTHETIC_WORKER_DELAY_MS ?? 300),
    5_000,
  ),
);

async function work(): Promise<void> {
  if (stopping) return;
  try {
    if (!(await probeDatabaseReadiness(pool, readiness, probeMs))) return;
    if (!(await standardApplication.readiness())) {
      readiness.markUnready("schema_not_ready");
      return;
    }
    await recoverExpiredExecutionLeases(
      pool,
      randomUUID(),
      "slice2-combined-local-worker",
    );
    const queued = await pool.query<{
      run_id: string;
      account_id: string;
      requested_by_user_id: string;
      tier: PersistedTier;
    }>(
      `SELECT rr.run_id,rr.account_id,rr.requested_by_user_id,g.tier
         FROM research_run rr JOIN LATERAL (
           SELECT tier FROM entitlement_grant WHERE account_id=rr.account_id AND user_id=rr.requested_by_user_id
             AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) AND revoked_at IS NULL
           ORDER BY effective_from DESC,created_at DESC LIMIT 1
         ) g ON true
        WHERE rr.research_mode='synthetic_reference'
          AND rr.state IN ('queued','failed_retryable') AND g.tier IN ('demo','standard','consultant')
        ORDER BY rr.queued_at,rr.run_id LIMIT 6`,
    );
    await Promise.all(
      queued.rows.map(async (row) => {
        if (delayMs > 0)
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        const context: RequestContext = {
          accountId: row.account_id,
          userId: row.requested_by_user_id,
          tier: row.tier,
          adminSubRoles: [],
          correlationId: randomUUID(),
          deploymentId: "slice2-combined-local-worker",
        };
        try {
          console.log(
            `Worker processing run ${row.run_id} for tier ${row.tier}...`,
          );
          if (row.tier === "standard")
            await standardApplication.executeSyntheticRun(context, row.run_id);
          else
            await demoApplication.executeSyntheticRun(
              context,
              row.run_id,
              "three",
            );
          console.log(
            `Worker completed run ${row.run_id} for tier ${row.tier}.`,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Run is not claimable"
          )
            return;
          throw error;
        }
      }),
    );
    lastCycleFailure = "";
  } catch (error) {
    readiness.markUnready("database_operation_failed");
    const diagnostic =
      error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : "UnknownError: non-error failure";
    if (diagnostic !== lastCycleFailure) {
      process.stderr.write(
        `combined synthetic worker cycle failed: ${diagnostic}\n`,
      );
      lastCycleFailure = diagnostic;
    }
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
