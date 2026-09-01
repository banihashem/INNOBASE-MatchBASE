import { getMigrationStatus, type ConnectionPool } from "@matchbase/data";

export interface WorkerDatabaseRuntimePolicy {
  readonly connectionTimeoutMilliseconds: number;
  readonly probeTimeoutMilliseconds: number;
}

function boundedInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? defaultValue);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum} milliseconds.`,
    );
  return parsed;
}

export function workerDatabaseRuntimePolicy(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WorkerDatabaseRuntimePolicy {
  return Object.freeze({
    connectionTimeoutMilliseconds: boundedInteger(
      "MATCHBASE_WORKER_DB_CONNECTION_TIMEOUT_MS",
      environment.MATCHBASE_WORKER_DB_CONNECTION_TIMEOUT_MS,
      10_000,
      1_000,
      30_000,
    ),
    probeTimeoutMilliseconds: boundedInteger(
      "MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS",
      environment.MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS,
      5_000,
      100,
      15_000,
    ),
  });
}

export async function workerSchemaIsReady(
  database: ConnectionPool,
): Promise<boolean> {
  try {
    return (await getMigrationStatus(database)).ready;
  } catch {
    return false;
  }
}

const TRANSIENT_DATABASE_CODES = new Set(["57P01", "57P02", "57P03"]);
const TRANSIENT_DATABASE_MESSAGE =
  /^(?:connection terminated due to connection timeout|connection terminated unexpectedly|server closed the connection unexpectedly|database system is (?:starting up|shutting down))\.?$/iu;

export function isTransientDatabaseConnectionFailure(
  error: unknown,
  visited: Set<unknown> = new Set(),
): boolean {
  if (!error || typeof error !== "object" || visited.has(error)) return false;
  visited.add(error);
  const candidate = error as {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly cause?: unknown;
    readonly errors?: unknown;
  };
  if (
    typeof candidate.code === "string" &&
    (TRANSIENT_DATABASE_CODES.has(candidate.code) ||
      /^08[0-9A-Z]{3}$/u.test(candidate.code))
  )
    return true;
  if (
    typeof candidate.message === "string" &&
    TRANSIENT_DATABASE_MESSAGE.test(candidate.message)
  )
    return true;
  if (isTransientDatabaseConnectionFailure(candidate.cause, visited))
    return true;
  return (
    Array.isArray(candidate.errors) &&
    candidate.errors.some((nested) =>
      isTransientDatabaseConnectionFailure(nested, visited),
    )
  );
}

export function workerCycleFailureEvent(input: {
  readonly category: string;
  readonly detail?: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    severity: "ERROR",
    event: "matchbase.worker.cycle_failed",
    category: input.category,
    ...(input.detail ? { detail: input.detail } : {}),
  });
}
