import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPool,
  recoverApprovedFocusStage,
  ResearchRoundFault,
} from "../packages/data/dist/index.js";

const fields = [
  "account-id",
  "user-profile-id",
  "run-id",
  "execution-id",
  "classification-id",
  "round-id",
];
const usage =
  "Usage: node scripts/recover-consultant-focus-stage.mjs --account-id UUID --user-profile-id UUID --run-id UUID --execution-id UUID --classification-id UUID --round-id UUID [--local-runtime] [--execute --snapshot-hash SHA256]. Default: transactionally checked dry-run; no model calls. Execution only requeues the same previously approved focus stage within its remaining allowance.";

export function parseFocusRecoveryArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]?.replace(/^--/, "");
    if (
      !args[index]?.startsWith("--") ||
      values.has(key) ||
      ![...fields, "local-runtime", "execute", "snapshot-hash"].includes(key)
    )
      throw new Error(usage);
    values.set(
      key,
      ["local-runtime", "execute"].includes(key) ? true : args[++index],
    );
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    fields.some(
      (key) =>
        typeof values.get(key) !== "string" || !uuid.test(values.get(key)),
    ) ||
    (values.has("snapshot-hash") &&
      !/^[0-9a-f]{64}$/.test(values.get("snapshot-hash"))) ||
    (values.get("execute") && !values.has("snapshot-hash"))
  )
    throw new Error(usage);
  return {
    identity: Object.fromEntries(
      fields.map((key) => [key.replaceAll("-", "_"), values.get(key)]),
    ),
    local_runtime: values.get("local-runtime") === true,
    options: {
      execute: values.get("execute") === true,
      expected_snapshot_hash: values.get("snapshot-hash"),
    },
  };
}

async function main() {
  const args = parseFocusRecoveryArguments(process.argv.slice(2));
  if (args.help) return process.stdout.write(`${usage}\n`);
  if (args.local_runtime) {
    const { loadLocalConfig } = await import("../deployment/local/config.mjs");
    await loadLocalConfig();
  }
  const connectionString =
    process.env.MATCHBASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("The server-side database connection is required.");
  const pool = createPool({ connectionString, max: 1 });
  try {
    const result = await recoverApprovedFocusStage(
      pool,
      args.identity,
      args.options,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const message =
      error instanceof ResearchRoundFault || error.message === usage
        ? error.message
        : "Focus recovery could not be verified. No recovery result is confirmed; inspect the server diagnostics.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
