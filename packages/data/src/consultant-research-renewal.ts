import { randomUUID } from "node:crypto";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "./database.js";
import {
  ExecutionIntegrityFault,
  hashResearchAuthority,
} from "./consultant-execution-integrity.js";
import {
  saveConsultantWorkflowSession,
  saveProductClassification,
} from "./v3-repository.js";
import type { ProductClassificationRecord } from "@matchbase/contracts";
import { readConsultantCostEvents } from "./consultant-research-rounds.js";

export interface PrivateResearchScope {
  account_id: string;
  user_profile_id: string;
}
export interface LogicalRequestFence {
  logical_request_root_id: string;
  generation: number;
  run_generation: number;
  renewal_ordinal: number;
  latest_run_id: string;
}
function conflict(message: string): never {
  throw new ExecutionIntegrityFault("MB-409-RESEARCH-RENEWAL", message);
}

async function renewalReadiness(
  db: Queryable,
  scope: PrivateResearchScope,
  runId: string,
  latestRunId: string,
) {
  const rows = await db.query(
    `SELECT s.*,
    EXISTS(SELECT 1 FROM consultant_workflow_job j WHERE j.account_id=s.account_id AND j.run_id=s.run_id AND j.status IN ('queued','running')) AS active_job,
    EXISTS(SELECT 1 FROM consultant_research_round r WHERE r.account_id=s.account_id AND r.run_id=s.run_id AND r.status='approved') AS unsettled_round,
    (EXISTS(SELECT 1 FROM consultant_research_round r WHERE r.account_id=s.account_id AND r.run_id=s.run_id AND r.status='completed' AND r.output IS NOT NULL)
      OR EXISTS(SELECT 1 FROM consultant_output_v3 o WHERE o.account_id=s.account_id AND o.run_id=s.run_id AND o.user_profile_id=s.user_profile_id)) AS has_results
    FROM consultant_workflow_session s WHERE s.account_id=$1 AND s.user_profile_id=$2 AND s.run_id=$3`,
    [scope.account_id, scope.user_profile_id, runId],
  );
  const source = rows.rows[0];
  const reason =
    !source || source.is_invalidated
      ? "Research is not available in this profile."
      : runId !== latestRunId
        ? "Open the current request to renew this research history."
        : source.active_job
          ? "Stop or complete the active research job before renewing."
          : source.unsettled_round
            ? "The previous round has not settled. Refresh its status before renewal."
            : !source.has_results
              ? "A retained research result is required before creating a renewal."
              : ![
                    "progressive_reveal_ready",
                    "workflow_complete",
                    "workflow_failed",
                  ].includes(source.current_state)
                ? "Finish or stop the current work before renewing research."
                : !source.approved_request_revision ||
                    !source.deep_prompt_revision?.is_approved ||
                    !source.classification?.classification_id ||
                    !source.classification.code ||
                    !source.classification.version ||
                    !source.classification.scheme
                  ? "The approved scope or classification requires preparation review."
                  : null;
  return { source, can_renew: reason === null, renewal_block_reason: reason };
}

/** Root registration is additive; historical sessions, approvals and outputs are not rewritten. */
async function lockLogicalRequest(
  client: Queryable,
  scope: PrivateResearchScope,
  runId: string,
): Promise<LogicalRequestFence> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${scope.account_id}:${scope.user_profile_id}:${runId}`,
  ]);
  const owned = await client.query(
    "SELECT run_id FROM consultant_workflow_session WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND NOT is_invalidated",
    [scope.account_id, scope.user_profile_id, runId],
  );
  if (!owned.rows[0]) conflict("Research is not available in this profile.");
  const membership = await client.query(
    "SELECT logical_request_root_id FROM consultant_research_lineage WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3",
    [scope.account_id, scope.user_profile_id, runId],
  );
  if (!membership.rows[0]) {
    const root = await client.query(
      `INSERT INTO consultant_logical_request(logical_request_root_id,account_id,user_profile_id,original_run_id,latest_run_id)
      VALUES($1,$2,$3,$4,$4) ON CONFLICT(account_id,user_profile_id,original_run_id) DO NOTHING RETURNING logical_request_root_id`,
      [randomUUID(), scope.account_id, scope.user_profile_id, runId],
    );
    const existing = root.rows[0]
      ? root
      : await client.query(
          "SELECT logical_request_root_id FROM consultant_logical_request WHERE account_id=$1 AND user_profile_id=$2 AND original_run_id=$3",
          [scope.account_id, scope.user_profile_id, runId],
        );
    await client.query(
      `INSERT INTO consultant_research_lineage(run_id,account_id,user_profile_id,logical_request_root_id,renewal_ordinal,root_generation)
      VALUES($1,$2,$3,$4,0,0) ON CONFLICT(run_id) DO NOTHING`,
      [
        runId,
        scope.account_id,
        scope.user_profile_id,
        existing.rows[0]!.logical_request_root_id,
      ],
    );
  }
  const rows = await client.query<LogicalRequestFence>(
    `SELECT r.logical_request_root_id,r.generation,r.latest_run_id,
    l.root_generation AS run_generation,l.renewal_ordinal FROM consultant_logical_request r JOIN consultant_research_lineage l
    ON l.logical_request_root_id=r.logical_request_root_id AND l.account_id=r.account_id AND l.user_profile_id=r.user_profile_id
    WHERE l.account_id=$1 AND l.user_profile_id=$2 AND l.run_id=$3 FOR UPDATE OF r`,
    [scope.account_id, scope.user_profile_id, runId],
  );
  if (!rows.rows[0]) conflict("The research lineage could not be established.");
  return rows.rows[0];
}

/** Invoke BEFORE session/job/round locks in the same transaction. */
export async function assertLogicalRequestFence(
  client: Queryable,
  scope: PrivateResearchScope,
  runId: string,
  expectedGeneration?: number,
): Promise<LogicalRequestFence> {
  const root = await lockLogicalRequest(client, scope, runId);
  if (
    root.latest_run_id !== runId ||
    root.generation !== root.run_generation ||
    (expectedGeneration !== undefined && expectedGeneration !== root.generation)
  )
    conflict(
      "A newer renewal owns this research history. Open the current request before continuing.",
    );
  return root;
}

/** Account-level callers remain subject to the profile stored on the owned session. */
export async function assertLogicalRequestRunFence(
  client: Queryable,
  accountId: string,
  runId: string,
  expectedGeneration?: number,
): Promise<LogicalRequestFence | null> {
  const rows = await client.query(
    "SELECT user_profile_id FROM consultant_workflow_session WHERE account_id=$1 AND run_id=$2",
    [accountId, runId],
  );
  if (!rows.rows[0]) return null;
  return assertLogicalRequestFence(
    client,
    { account_id: accountId, user_profile_id: rows.rows[0].user_profile_id },
    runId,
    expectedGeneration,
  );
}

export interface LinkedResearchRenewalCommand {
  parent_run_id: string;
  expected_generation: number;
  idempotency_key: string;
  expected_request_hash: string;
  expected_prompt_hash: string;
  compatibility_version: "renewal.v1";
}

export async function createLinkedResearchRenewal(
  pool: ConnectionPool,
  scope: PrivateResearchScope,
  command: LinkedResearchRenewalCommand,
) {
  if (
    command.compatibility_version !== "renewal.v1" ||
    !Number.isSafeInteger(command.expected_generation) ||
    command.expected_generation < 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      command.idempotency_key,
    )
  )
    conflict("The renewal command is invalid.");
  return inTransaction(pool, async (client) => {
    const root = await lockLogicalRequest(client, scope, command.parent_run_id);
    const commandHash = hashResearchAuthority(command);
    const replay = await client.query(
      `SELECT run_id,root_generation,adoption,command_sha256 FROM consultant_research_lineage
      WHERE logical_request_root_id=$1 AND account_id=$2 AND user_profile_id=$3 AND idempotency_key=$4`,
      [
        root.logical_request_root_id,
        scope.account_id,
        scope.user_profile_id,
        command.idempotency_key,
      ],
    );
    if (replay.rows[0]) {
      const row = replay.rows[0];
      if (row.command_sha256 !== commandHash)
        conflict(
          "This renewal command identifier belongs to a different request.",
        );
      return {
        run_id: row.run_id,
        execution_id: row.adoption.execution_id as string,
        classification_id: row.adoption.classification_id as string,
        logical_request_root_id: root.logical_request_root_id,
        generation: row.root_generation as number,
        replayed: true,
      };
    }
    if (
      root.generation !== command.expected_generation ||
      root.run_generation !== root.generation ||
      root.latest_run_id !== command.parent_run_id
    )
      conflict(
        "A competing or newer renewal already exists. Refresh the research history.",
      );
    const sessions = await client.query(
      "SELECT * FROM consultant_workflow_session WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 FOR UPDATE",
      [scope.account_id, scope.user_profile_id, command.parent_run_id],
    );
    const source = sessions.rows[0];
    if (
      !source ||
      source.is_invalidated ||
      ![
        "progressive_reveal_ready",
        "workflow_complete",
        "workflow_failed",
      ].includes(source.current_state)
    )
      conflict("Finish or stop the current work before renewing research.");
    const active = await client.query(
      `SELECT job_id FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2 AND status IN ('queued','running') FOR UPDATE`,
      [scope.account_id, command.parent_run_id],
    );
    if (active.rows.length)
      conflict(
        "Current research still owns an active job. Stop it before renewing.",
      );
    const rounds = await client.query(
      "SELECT round_id FROM consultant_research_round WHERE account_id=$1 AND run_id=$2 AND status='approved' FOR UPDATE",
      [scope.account_id, command.parent_run_id],
    );
    if (rounds.rows.length)
      conflict(
        "The previous research round has not settled. Refresh its status before renewal.",
      );
    const readiness = await renewalReadiness(
      client,
      scope,
      command.parent_run_id,
      root.latest_run_id,
    );
    if (!readiness.can_renew) conflict(readiness.renewal_block_reason!);
    const classification =
      source.classification as ProductClassificationRecord | null;
    if (
      !source.approved_request_revision ||
      !source.deep_prompt_revision?.is_approved ||
      hashResearchAuthority(source.approved_request_revision) !==
        command.expected_request_hash ||
      hashResearchAuthority(source.deep_prompt_revision) !==
        command.expected_prompt_hash ||
      !classification?.classification_id ||
      !classification.code ||
      !classification.version ||
      !classification.scheme
    )
      conflict(
        "The approved scope or classification is incompatible. Return to preparation.",
      );
    const identity = {
      ...scope,
      run_id: randomUUID(),
      execution_id: randomUUID(),
      classification_id: randomUUID(),
    };
    const nextClassification = {
      ...classification,
      classification_id: identity.classification_id,
      assigned_at: new Date().toISOString(),
    };
    const generation = root.generation + 1;
    const adoption = {
      version: "renewal-adoption.v1",
      origin_run_id: command.parent_run_id,
      original_request_sha256: command.expected_request_hash,
      original_prompt_sha256: command.expected_prompt_hash,
      classification_concept_sha256: hashResearchAuthority({
        scheme: classification.scheme,
        code: classification.code,
        version: classification.version,
        jurisdiction: classification.jurisdiction,
      }),
      compatibility_version: command.compatibility_version,
      execution_id: identity.execution_id,
      classification_id: identity.classification_id,
      fresh_discovery_required: true,
      fresh_cost_approval_required: true,
    };
    await saveProductClassification(
      client,
      scope.account_id,
      nextClassification,
    );
    await saveConsultantWorkflowSession(client, {
      ...identity,
      session_id: randomUUID(),
      current_state: "prep_step3_prompt_approved",
      original_intake: source.original_intake,
      approved_request_revision: source.approved_request_revision,
      deep_prompt_revision: source.deep_prompt_revision,
      advisory_output: source.advisory_output,
      classification: nextClassification as unknown as Record<string, unknown>,
      approvals: [],
      last_checkpoint: "renewal_awaiting_quote",
      workflow_metadata: {
        mode: source.workflow_metadata?.mode ?? "live",
        classification_id: identity.classification_id,
        logical_request_root_id: root.logical_request_root_id,
        root_generation: generation,
        renewal_adoption: adoption,
        fresh_discovery_required: true,
        fresh_cost_approval_required: true,
      },
    });
    await client.query(
      `INSERT INTO consultant_research_lineage(run_id,account_id,user_profile_id,logical_request_root_id,renews_run_id,
      renewal_ordinal,root_generation,idempotency_key,command_sha256,adoption) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        identity.run_id,
        scope.account_id,
        scope.user_profile_id,
        root.logical_request_root_id,
        command.parent_run_id,
        root.renewal_ordinal + 1,
        generation,
        command.idempotency_key,
        commandHash,
        JSON.stringify(adoption),
      ],
    );
    await client.query(
      "UPDATE consultant_logical_request SET generation=$2,latest_run_id=$3 WHERE logical_request_root_id=$1",
      [root.logical_request_root_id, generation, identity.run_id],
    );
    await client.query(
      "UPDATE consultant_private_negative_check SET expires_at=LEAST(expires_at,clock_timestamp()) WHERE account_id=$1 AND user_profile_id=$2",
      [scope.account_id, scope.user_profile_id],
    );
    return {
      run_id: identity.run_id,
      execution_id: identity.execution_id,
      classification_id: identity.classification_id,
      logical_request_root_id: root.logical_request_root_id,
      generation,
      replayed: false,
    };
  });
}

export async function getLogicalResearchHistory(
  db: Queryable,
  scope: PrivateResearchScope,
  runId: string,
) {
  const owned = await db.query(
    "SELECT run_id FROM consultant_workflow_session WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND NOT is_invalidated",
    [scope.account_id, scope.user_profile_id, runId],
  );
  if (!owned.rows[0]) conflict("Research is not available in this profile.");
  const root = await db.query(
    `SELECT r.* FROM consultant_logical_request r JOIN consultant_research_lineage l ON l.logical_request_root_id=r.logical_request_root_id
    WHERE l.account_id=$1 AND l.user_profile_id=$2 AND l.run_id=$3`,
    [scope.account_id, scope.user_profile_id, runId],
  );
  const rootRow = root.rows[0];
  const readiness = await renewalReadiness(
    db,
    scope,
    runId,
    rootRow?.latest_run_id ?? runId,
  );
  const rows = await db.query(
    `SELECT s.run_id,s.current_state AS state,s.created_at,l.renews_run_id,
    COALESCE(l.renewal_ordinal,0) AS renewal_ordinal,COALESCE(l.root_generation,0) AS root_generation,
    s.approved_request_revision,s.deep_prompt_revision
    FROM consultant_workflow_session s LEFT JOIN consultant_research_lineage l ON l.run_id=s.run_id AND l.account_id=s.account_id AND l.user_profile_id=s.user_profile_id
    WHERE s.account_id=$1 AND s.user_profile_id=$2 AND NOT s.is_invalidated AND
      (($3::uuid IS NOT NULL AND l.logical_request_root_id=$3) OR ($3::uuid IS NULL AND s.run_id=$4)) ORDER BY renewal_ordinal`,
    [
      scope.account_id,
      scope.user_profile_id,
      rootRow?.logical_request_root_id ?? null,
      runId,
    ],
  );
  const runs = [];
  for (const row of rows.rows) {
    const costs = await readConsultantCostEvents(
      db,
      scope.account_id,
      row.run_id,
    );
    runs.push({
      run_id: row.run_id as string,
      state: row.state as string,
      created_at: row.created_at as Date,
      renews_run_id: (row.renews_run_id ?? null) as string | null,
      renewal_ordinal: row.renewal_ordinal as number,
      root_generation: row.root_generation as number,
      request_hash: row.approved_request_revision
        ? hashResearchAuthority(row.approved_request_revision)
        : null,
      prompt_hash: row.deep_prompt_revision
        ? hashResearchAuthority(row.deep_prompt_revision)
        : null,
      cost_events: costs,
    });
  }
  return {
    logical_request_root_id: (rootRow?.logical_request_root_id ?? null) as
      string | null,
    generation: (rootRow?.generation ?? 0) as number,
    current_run_id: (rootRow?.latest_run_id ?? runId) as string,
    runs,
    cost_events: runs.flatMap((row) => row.cost_events),
    can_renew: readiness.can_renew,
    renewal_block_reason: readiness.renewal_block_reason,
    fresh_cost_approval_required: true as const,
  };
}
