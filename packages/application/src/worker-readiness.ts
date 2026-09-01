import type { Queryable } from "@matchbase/data";

export type WorkerReadinessReason =
  | "startup_probe_pending"
  | "database_probe_failed"
  | "database_probe_timeout"
  | "database_operation_failed"
  | "live_research_admission_failed"
  | "schema_not_ready"
  | "shutdown";

export interface WorkerReadinessSnapshot {
  readonly status: "ready" | "not_ready";
  readonly reason: WorkerReadinessReason | null;
}

export class WorkerReadiness {
  #snapshot: WorkerReadinessSnapshot = {
    status: "not_ready",
    reason: "startup_probe_pending",
  };

  snapshot(): WorkerReadinessSnapshot {
    return this.#snapshot;
  }

  markReady(): void {
    this.#snapshot = { status: "ready", reason: null };
  }

  markUnready(
    reason: Exclude<WorkerReadinessReason, "startup_probe_pending">,
  ): void {
    this.#snapshot = { status: "not_ready", reason };
  }
}

class DatabaseProbeTimeout extends Error {
  constructor() {
    super("Database readiness probe timed out");
    this.name = "DatabaseProbeTimeout";
  }
}

export async function probeDatabaseReadiness(
  database: Queryable,
  readiness: WorkerReadiness,
  timeoutMilliseconds: number,
  options: Readonly<{ markReadyOnSuccess?: boolean }> = {},
): Promise<boolean> {
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 100 ||
    timeoutMilliseconds > 15_000
  ) {
    throw new Error(
      "Database readiness timeout must be an integer between 100 and 15000 milliseconds",
    );
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      database.query("SELECT 1 AS readiness_probe"),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new DatabaseProbeTimeout()),
          timeoutMilliseconds,
        );
      }),
    ]);
    if (options.markReadyOnSuccess !== false) readiness.markReady();
    return true;
  } catch (error) {
    readiness.markUnready(
      error instanceof DatabaseProbeTimeout
        ? "database_probe_timeout"
        : "database_probe_failed",
    );
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
