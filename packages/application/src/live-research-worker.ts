import { validateResearchRoutePolicy } from "@matchbase/ai-evidence";
import type { ResearchRoutePolicyV1 } from "@matchbase/contracts";
import type { ConnectionPool } from "@matchbase/data";
import {
  LiveResearchCapacityUnavailable,
  LiveResearchExecutionService,
} from "./live-research-execution.js";

export interface QualifiedLiveWorkItem {
  readonly runId: string;
  readonly accountId: string;
  readonly userId: string;
  readonly tier: "demo" | "standard" | "consultant";
}

export type QualifiedLiveServiceFactory = (
  work: QualifiedLiveWorkItem,
  policyId: string,
) => LiveResearchExecutionService;

export class QualifiedLiveResearchWorkerDispatcher {
  private readonly policy: ResearchRoutePolicyV1;

  constructor(
    private readonly options: {
      pool: ConnectionPool;
      policy: ResearchRoutePolicyV1;
      serviceFactory: QualifiedLiveServiceFactory;
      outputSchema: Readonly<Record<string, unknown>>;
      now?: () => Date;
    },
  ) {
    this.policy = validateResearchRoutePolicy(options.policy);
    if (this.policy.liveActivation !== "enabled")
      throw new Error("Live worker requires an enabled closed route policy.");
  }

  async dispatchNext(
    signal: AbortSignal,
    limit = 3,
  ): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3)
      throw new Error("Live worker dispatch limit is invalid.");
    const policy = await this.options.pool.query<{
      research_route_policy_id: string;
    }>(
      `SELECT research_route_policy_id
         FROM research_route_policy
        WHERE policy_version=$1 AND environment=$2 AND activation_state='qualified'
        ORDER BY created_at DESC LIMIT 1`,
      [this.policy.policyVersion, this.policy.environment],
    );
    const policyId = policy.rows[0]?.research_route_policy_id;
    if (!policyId) return Object.freeze([]);
    const queued = await this.options.pool.query<{
      run_id: string;
      account_id: string;
      requested_by_user_id: string;
      tier_at_submission: "demo" | "standard" | "consultant";
    }>(
      `SELECT r.run_id,r.account_id,r.requested_by_user_id,r.tier_at_submission
         FROM research_run r
        WHERE r.research_mode='qualified_live_research'
          AND r.state IN ('queued','failed_retryable')
          AND r.tier_at_submission IN ('demo','standard','consultant')
          AND NOT EXISTS (
            SELECT 1 FROM live_research_terminal t
             WHERE t.account_id=r.account_id AND t.run_id=r.run_id
          )
        ORDER BY r.queued_at,r.run_id LIMIT $1`,
      [limit],
    );
    const completed: string[] = [];
    for (const row of queued.rows) {
      if (signal.aborted) break;
      const work: QualifiedLiveWorkItem = Object.freeze({
        runId: row.run_id,
        accountId: row.account_id,
        userId: row.requested_by_user_id,
        tier: row.tier_at_submission,
      });
      const service = this.options.serviceFactory(work, policyId);
      if (!(service instanceof LiveResearchExecutionService))
        throw new Error("Live worker factory returned an invalid service.");
      try {
        await service.execute({
          policy: this.policy,
          executionId: `LIVE:${this.policy.policyVersion}:${work.runId}`,
          runId: work.runId,
          capturedAt: (this.options.now?.() ?? new Date()).toISOString(),
          outputSchema: this.options.outputSchema,
          signal,
        });
        completed.push(work.runId);
      } catch (error) {
        if (!(error instanceof LiveResearchCapacityUnavailable)) throw error;
      }
    }
    return Object.freeze(completed);
  }
}
