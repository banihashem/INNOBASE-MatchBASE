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
import { createEnvironmentLiveResearchDispatcher } from "./live-research-environment-runtime.js";
import type { QualifiedLiveResearchWorkerDispatcher } from "./live-research-worker.js";
import { MatchBaseApplication } from "./service.js";
import { StandardWorkspaceApplication } from "./standard-workspace.js";
import type { PersistedTier, RequestContext } from "./types.js";
import { probeDatabaseReadiness, WorkerReadiness } from "./worker-readiness.js";
import {
  workerCycleFailureEvent,
  workerDatabaseRuntimePolicy,
  workerSchemaIsReady,
} from "./worker-runtime.js";

const databaseUrl = process.env.DATABASE_URL;
const digestKeyText = process.env.MATCHBASE_DIGEST_KEY;
const environment = process.env.MATCHBASE_ENVIRONMENT;
const syntheticEnabled =
  process.env.MATCHBASE_SYNTHETIC_FIXTURE === "true" &&
  ["local", "test"].includes(environment ?? "");
if (!databaseUrl || !digestKeyText || Buffer.byteLength(digestKeyText) < 32)
  throw new Error("Combined worker database or digest-key handle is invalid.");
const databaseRuntimePolicy = workerDatabaseRuntimePolicy(process.env);
const pool = createPool({
  connectionString: databaseUrl,
  max: 6,
  connectionTimeoutMillis: databaseRuntimePolicy.connectionTimeoutMilliseconds,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 30_000,
});
const digestKey = Buffer.from(digestKeyText, "utf8");
const consultantProjectionConfig = consultantProjectionConfigFromEnvironment(
  process.env,
);
const demoApplication = syntheticEnabled
  ? new MatchBaseApplication({
      pool,
      privacyKey: digestKey,
      canonicalizer: new DeterministicFixtureCanonicalizer({
        digestKey,
        digestKeyId: "combined-worker-v1",
        languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
      }),
      consultantProjectionConfig,
    })
  : null;
const standardApplication = syntheticEnabled
  ? new StandardWorkspaceApplication({
      pool,
      privacyKey: digestKey,
      consultantProjectionConfig,
    })
  : null;

async function createLiveDispatcher(): Promise<QualifiedLiveResearchWorkerDispatcher | null> {
  if (process.env.MATCHBASE_LIVE_RESEARCH_RUNTIME === "fixture") {
    if (
      environment !== "test" ||
      process.env.MATCHBASE_LIVE_RESEARCH_TEST_FIXTURE !== "true"
    )
      throw new Error("Live worker fixture runtime is prohibited.");
    const fixtureUrl = new URL(
      "../../../test/slice3/fixtures/live-worker-runtime.mjs",
      import.meta.url,
    ).href;
    const fixture = (await import(fixtureUrl)) as {
      createLiveWorkerFixture(
        poolValue: typeof pool,
      ): Promise<QualifiedLiveResearchWorkerDispatcher>;
    };
    return await fixture.createLiveWorkerFixture(pool);
  }
  if (
    process.env.MATCHBASE_LIVE_RESEARCH_RUNTIME !== undefined &&
    process.env.MATCHBASE_LIVE_RESEARCH_RUNTIME !== "environment"
  )
    throw new Error("Combined worker live runtime selector is invalid.");
  return await createEnvironmentLiveResearchDispatcher({ pool });
}

const liveDispatcher = await createLiveDispatcher();
if (!syntheticEnabled && !liveDispatcher)
  throw new Error("Combined worker has no server-qualified research mode.");
const readiness = new WorkerReadiness();
const shutdownController = new AbortController();
let stopping = false;
let nextCycle: NodeJS.Timeout | undefined;
let activeCycle: Promise<void> = Promise.resolve();
const delayMs = Math.max(
  0,
  Math.min(
    Number(process.env.MATCHBASE_SYNTHETIC_WORKER_DELAY_MS ?? 300),
    5_000,
  ),
);

function workerCycleFailureCategory(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501"
  )
    return "database_permission_denied";
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "40001"
  )
    return "database_serialization_retry";
  return "worker_cycle_failed";
}

function stagingWorkerFailureDetail(error: unknown): string | undefined {
  if (
    process.env.MATCHBASE_DEPLOYMENT_ENVIRONMENT !== "staging" ||
    !(error instanceof Error)
  )
    return undefined;
  return error.message
    .replace(/https:\/\/\S+/gu, "[url]")
    .replace(/[A-Za-z0-9_-]{24,}/gu, "[token]")
    .replace(/[^\x20-\x7e]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

async function work(): Promise<void> {
  if (stopping) return;
  try {
    if (
      !(await probeDatabaseReadiness(
        pool,
        readiness,
        databaseRuntimePolicy.probeTimeoutMilliseconds,
        { markReadyOnSuccess: false },
      ))
    )
      return;
    if (!(await workerSchemaIsReady(pool))) {
      readiness.markUnready("schema_not_ready");
      return;
    }
    if (liveDispatcher && !(await liveDispatcher.readiness())) {
      readiness.markUnready("live_research_admission_failed");
      return;
    }
    readiness.markReady();
    await recoverExpiredExecutionLeases(
      pool,
      randomUUID(),
      "combined-worker-v1",
    );
    if (liveDispatcher)
      await liveDispatcher.dispatchNext(shutdownController.signal, 3);
    if (!syntheticEnabled || !standardApplication || !demoApplication) return;
    if (!(await standardApplication.readiness())) {
      readiness.markUnready("schema_not_ready");
      return;
    }
    const queued = await pool.query<{
      run_id: string;
      account_id: string;
      requested_by_user_id: string;
      tier: PersistedTier;
    }>(
      `SELECT rr.run_id,rr.account_id,rr.requested_by_user_id,g.tier
         FROM research_run rr JOIN LATERAL (
           SELECT tier FROM entitlement_grant
            WHERE account_id=rr.account_id AND user_id=rr.requested_by_user_id
              AND effective_from<=clock_timestamp()
              AND (effective_to IS NULL OR effective_to>clock_timestamp())
              AND revoked_at IS NULL
            ORDER BY effective_from DESC,created_at DESC LIMIT 1
         ) g ON true
        WHERE rr.research_mode='synthetic_reference'
          AND rr.state IN ('queued','failed_retryable')
          AND g.tier IN ('demo','standard')
        ORDER BY rr.queued_at,rr.run_id LIMIT 6`,
    );
    await Promise.all(
      queued.rows.map(async (row) => {
        if (delayMs > 0)
          await new Promise<void>((resolveDelay) =>
            setTimeout(resolveDelay, delayMs),
          );
        const context: RequestContext = {
          accountId: row.account_id,
          userId: row.requested_by_user_id,
          tier: row.tier,
          adminSubRoles: [],
          correlationId: randomUUID(),
          deploymentId: "combined-worker-v1",
        };
        if (row.tier === "standard")
          await standardApplication.executeSyntheticRun(context, row.run_id);
        else
          await demoApplication.executeSyntheticRun(
            context,
            row.run_id,
            "three",
          );
      }),
    );
  } catch (error) {
    const detail = stagingWorkerFailureDetail(error);
    console.error(
      JSON.stringify(
        workerCycleFailureEvent({
          category: workerCycleFailureCategory(error),
          ...(detail ? { detail } : {}),
        }),
      ),
    );
    readiness.markUnready("database_operation_failed");
  } finally {
    if (!stopping) nextCycle = setTimeout(runCycle, 50);
  }
}

function runCycle(): void {
  activeCycle = work();
}

if (
  process.env.MATCHBASE_WORKER_HEALTH_PORT !== undefined &&
  process.env.MATCHBASE_WORKER_HEALTH_PORT !== "3011"
)
  throw new Error("Combined worker health port must be exactly 3011.");
const server = createServer((request, response) => {
  if (request.url !== "/health") return void response.writeHead(404).end();
  const snapshot = readiness.snapshot();
  response
    .writeHead(snapshot.status === "ready" ? 200 : 503, {
      "Content-Type": "application/json",
    })
    .end(JSON.stringify(snapshot));
});
server.listen(3011, "127.0.0.1", runCycle);

async function shutdown(): Promise<void> {
  stopping = true;
  shutdownController.abort();
  readiness.markUnready("shutdown");
  if (nextCycle) clearTimeout(nextCycle);
  await activeCycle.catch(() => undefined);
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
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
