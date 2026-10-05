import { readFile } from "node:fs/promises";
import { createPool } from "@matchbase/data";
import {
  recoverRetainedConsultantInterpretation,
  type RetainedInterpretationRecoveryArgs,
} from "./consultant-v3-service.js";

// MB-UX-QUALITY-002 L01. Input is an operator-owned JSON file outside published source.
// node packages/application/dist/recover-retained-interpretation-cli.js --input <file> [--execute]
// Preview is the default. Copy its recovery_hash to expected_recovery_hash before execute.
// Neither mode reads model credentials or performs a provider request.
let pool: ReturnType<typeof createPool> | undefined;
try {
  const argv = process.argv.slice(2);
  if (
    argv.length < 2 ||
    argv[0] !== "--input" ||
    !argv[1] ||
    (argv.length !== 2 && !(argv.length === 3 && argv[2] === "--execute"))
  )
    throw new Error("invalid-arguments");
  const input = JSON.parse(
    await readFile(argv[1], "utf8"),
  ) as RetainedInterpretationRecoveryArgs;
  const connectionString =
    process.env.MATCHBASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("database-unavailable");
  pool = createPool({ connectionString, max: 1 });
  const summary = await recoverRetainedConsultantInterpretation(pool, {
    ...input,
    execute: argv[2] === "--execute",
  });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  // Avoid printing driver errors, URLs, environment, raw source or provider payloads.
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^MB-\d{3}-[A-Z0-9-]+$/.test(error.code)
      ? error.code
      : "recovery-unavailable";
  console.error(JSON.stringify({ executed: false, code }));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
