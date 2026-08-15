import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export * from "./secure-fetch.js";
export * from "./node-live-transport.js";

const SAFE_TELEMETRY_KEYS = new Set([
  "account_id",
  "user_id",
  "run_id",
  "request_id",
  "canonical_version_id",
  "capability_id",
  "provider_id",
  "model_id",
  "route_id",
  "environment",
  "outcome",
  "reason_code",
  "correlation_id",
  "duration_ms",
  "attempt_number",
  "cost_state",
]);

export function allowlistTelemetry(
  input: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_TELEMETRY_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

export interface SafeErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlation_id: string;
    retryable: boolean;
  };
}

export function safeError(input: {
  code: string;
  correlationId: string;
  retryable?: boolean;
}): SafeErrorEnvelope {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Authentication is required.",
    ACCESS_REFUSED: "The protected resource is unavailable.",
    CANONICALIZATION_FAILED: "The request could not be canonicalized.",
    CANONICALIZATION_TIMEOUT: "Canonicalization timed out.",
    CONTRADICTION: "Resolve the canonical contradictions before submission.",
    QUOTA_EXCEEDED: "The rolling account quota is exhausted.",
    RESULT_NOT_READY: "The result is not ready.",
    INTERNAL_ERROR: "The operation could not be completed.",
  };
  return {
    error: {
      code: input.code,
      message: messages[input.code] ?? "The operation could not be completed.",
      correlation_id: input.correlationId,
      retryable: input.retryable ?? false,
    },
  };
}

export function assertNoCanary(
  value: unknown,
  canaries: readonly string[],
): void {
  const serialized =
    typeof value === "string"
      ? value
      : Buffer.isBuffer(value)
        ? value.toString("utf8")
        : JSON.stringify(value);
  for (const canary of canaries) {
    if (!canary) throw new Error("An empty privacy canary is invalid.");
    if (serialized.includes(canary)) {
      throw new Error("Source-language privacy canary detected.");
    }
  }
}

export async function scanFilesForCanaries(input: {
  root: string;
  paths: readonly string[];
  canaries: readonly string[];
}): Promise<void> {
  if (!isAbsolute(input.root))
    throw new Error("Privacy scan root must be absolute.");
  const canonicalRoot = await realpath(input.root);
  for (const path of input.paths) {
    if (!isAbsolute(path))
      throw new Error("Privacy scan paths must be absolute.");
    const resolved = resolve(path);
    const canonical = await realpath(resolved);
    const rel = relative(canonicalRoot, canonical);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Privacy scan path escapes its declared root.");
    }
    const metadata = await lstat(resolved);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("Privacy scan accepts regular files only.");
    }
    assertNoCanary(await readFile(canonical), input.canaries);
  }
}

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function scanPostgresForCanaries(
  database: Queryable,
  canaries: readonly string[],
): Promise<{ tables: number; columns: number }> {
  const catalog = await database.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          data_type IN ('text','character varying','character','json','jsonb')
          OR udt_name IN ('citext','_text','_citext')
        )
      ORDER BY table_name, ordinal_position`,
  );
  for (const column of catalog.rows) {
    const table = quoteIdentifier(column.table_name);
    const field = quoteIdentifier(column.column_name);
    const rows = await database.query<{ value: string | null }>(
      `SELECT ${field}::text AS value FROM ${table} WHERE ${field} IS NOT NULL`,
    );
    for (const row of rows.rows) assertNoCanary(row.value, canaries);
  }
  return {
    tables: new Set(catalog.rows.map((row) => row.table_name)).size,
    columns: catalog.rows.length,
  };
}
