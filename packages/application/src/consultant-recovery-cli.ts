import { randomUUID } from "node:crypto";
import {
  createPool,
  getResearchRoundForExecution,
  getConsultantWorkflowSessionByRunId,
  recoverCompletedResearchRound,
} from "@matchbase/data";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";
import type { ResearchContinuation } from "./dual-lane-orchestrator.js";
import { buildRetainedResearchRecovery } from "./retained-research-recovery.js";

// MB-UX-LIVE-001 L11: operator-only, zero-provider recovery; dry-run by default.
const [accountId, runId, sourceExecutionId, action] = process.argv.slice(2);
if (
  ![accountId, runId, sourceExecutionId].every((value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value ?? "",
    ),
  ) ||
  (action !== undefined && action !== "--execute")
)
  throw new Error(
    "Usage: consultant-recovery-cli <account-id> <run-id> <source-execution-id> [--execute]",
  );
const connectionString = process.env.MATCHBASE_DATABASE_URL;
if (!connectionString) throw new Error("MATCHBASE_DATABASE_URL is required.");
const pool = createPool({ connectionString, max: 1 });
try {
  const session = await getConsultantWorkflowSessionByRunId(
    pool,
    accountId!,
    runId!,
  );
  if (!session || session.is_invalidated)
    throw new Error("Saved request is unavailable.");
  const prompt = session.deep_prompt_revision as {
    discovery_criteria?: string[];
  } | null;
  const approved = session.approved_request_revision as {
    key_specifications?: string[];
  } | null;
  const requirements = prompt?.discovery_criteria?.length
    ? prompt.discovery_criteria
    : (approved?.key_specifications ?? []);
  const build = (
    source: {
      output: Record<string, unknown> | null;
      continuation: Record<string, unknown> | null;
    },
    executionId: string,
  ) => {
    if (!source.output || !source.continuation)
      throw new Error("Completed source evidence is unavailable.");
    return buildRetainedResearchRecovery({
      prior_output: source.output as unknown as ConsultantResearchOutputV3,
      continuation: source.continuation as unknown as ResearchContinuation,
      mandatory_requirements: requirements,
      execution_id: executionId,
    });
  };
  const source = await getResearchRoundForExecution(
    pool,
    accountId!,
    sourceExecutionId!,
  );
  if (!source || source.run_id !== runId || source.status !== "completed")
    throw new Error("Completed source round is unavailable.");
  const result =
    action === "--execute"
      ? await recoverCompletedResearchRound(
          pool,
          accountId!,
          runId!,
          sourceExecutionId!,
          build,
        )
      : { ...build(source, randomUUID()), replayed: false };
  console.log(
    JSON.stringify({
      action: action === "--execute" ? "published" : "dry-run",
      source_execution_id: sourceExecutionId,
      execution_id: result.output.execution_id,
      candidate_count: result.output.supplier_candidates.length,
      candidates: result.output.supplier_candidates.map(
        (candidate: { legal_name: string }) => candidate.legal_name,
      ),
      additional_provider_cost_usd: 0,
      replayed: result.replayed,
    }),
  );
} finally {
  await pool.end();
}
