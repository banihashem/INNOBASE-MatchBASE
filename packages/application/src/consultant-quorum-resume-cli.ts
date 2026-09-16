import {
  createPool,
  resumeFailedConsultantResearchExecution,
} from "@matchbase/data";

// MB-UX-QUALITY-001 L15: operator-only; dry-run by default.
const [accountId, runId, executionId, action] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
if (
  ![accountId, runId, executionId].every((value) => uuid.test(value ?? "")) ||
  (action !== undefined && action !== "--execute")
)
  throw new Error(
    "Usage: consultant-quorum-resume-cli <account-id> <run-id> <execution-id> [--execute]",
  );
const connectionString = process.env.MATCHBASE_DATABASE_URL;
if (!connectionString) throw new Error("MATCHBASE_DATABASE_URL is required.");
const pool = createPool({ connectionString, max: 1 });
try {
  const result = await resumeFailedConsultantResearchExecution(
    pool,
    accountId!,
    runId!,
    executionId!,
    action === "--execute",
  );
  console.log(
    JSON.stringify({
      action: action === "--execute" ? "queued" : "dry-run",
      execution_id: executionId,
      ...result,
    }),
  );
} finally {
  await pool.end();
}
