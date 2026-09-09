import { randomUUID } from "node:crypto";
import {
  createPool,
  getResearchRoundForExecution,
  getConsultantWorkflowSessionByRunId,
  recoverFailedResearchRound,
  readConsultantCostEvents,
} from "@matchbase/data";
import { summarizeResearchCosts } from "./consultant-research-cost.js";
import {
  buildFailedResearchRecovery,
  type FailedResearchEvent,
} from "./failed-research-recovery.js";

// MB-UX-LIVE-001 L15: operator-only; no provider/network calls; dry-run by default.
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
    "Usage: consultant-failed-recovery-cli <account-id> <run-id> <source-execution-id> [--execute]",
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
  const source = await getResearchRoundForExecution(
    pool,
    accountId!,
    sourceExecutionId!,
  );
  if (
    !session ||
    !source ||
    source.run_id !== runId ||
    source.status !== "failed"
  )
    throw new Error("Failed saved research is unavailable.");
  const costs = summarizeResearchCosts(
    await readConsultantCostEvents(pool, accountId!, runId!),
    false,
  );
  const build = (
    executionId: string,
    current: typeof session,
    events: readonly FailedResearchEvent[],
  ) => {
    const recovered = buildFailedResearchRecovery({
      session: current,
      source_execution_id: sourceExecutionId!,
      execution_id: executionId,
      events,
    });
    return {
      ...recovered,
      output: {
        ...recovered.output,
        limitations_and_disclosures: [
          ...recovered.output.limitations_and_disclosures,
          {
            title: "Recorded cost through recovered research",
            description: `USD ${costs.recorded_total_usd.toFixed(6)} recorded across this request: preparation USD ${costs.preparation_usd.toFixed(6)}, research attempts USD ${costs.research_usd.toFixed(6)}. OpenRouter USD ${costs.openrouter_charge_usd.toFixed(6)}; BYOK upstream USD ${costs.byok_upstream_usd.toFixed(6)}. ${costs.unpriced_calls} calls have incomplete accounting. Incremental local recovery cost: USD 0. ${costs.disclosure}`,
            severity: "info" as const,
          },
        ],
      },
    };
  };
  const events = await pool.query<{
    phase: string;
    detail: Record<string, unknown>;
    created_at: string | Date;
  }>(
    "SELECT phase,detail,created_at FROM consultant_workflow_event WHERE account_id=$1 AND run_id=$2 AND execution_id=$3 ORDER BY event_id",
    [accountId, runId, sourceExecutionId],
  );
  const result =
    action === "--execute"
      ? await recoverFailedResearchRound(
          pool,
          accountId!,
          runId!,
          sourceExecutionId!,
          (_source, executionId, current, retained) =>
            build(executionId, current, retained),
        )
      : { ...build(randomUUID(), session, events.rows), replayed: false };
  console.log(
    JSON.stringify({
      action: action === "--execute" ? "published" : "dry-run",
      source_execution_id: sourceExecutionId,
      execution_id: result.output.execution_id,
      candidate_count: result.output.supplier_candidates.length,
      candidates: result.output.supplier_candidates.map(
        (candidate) => candidate.legal_name,
      ),
      additional_provider_cost_usd: 0,
      replayed: result.replayed,
    }),
  );
} finally {
  await pool.end();
}
