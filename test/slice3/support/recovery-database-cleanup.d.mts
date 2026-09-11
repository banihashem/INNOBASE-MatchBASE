import type { Queryable } from "../../../packages/data/dist/index.js";

export function dropDrainedRecoveryDatabase(
  admin: Queryable,
  databaseName: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<void>;
