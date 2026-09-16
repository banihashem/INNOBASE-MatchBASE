import type { Queryable } from "./database.js";
import type { ConsultantWorkflowIdentity } from "./consultant-workflow-jobs.js";
import {
  ExecutionIntegrityFault,
  hashResearchAuthority,
} from "./consultant-execution-integrity.js";

type ParentScope = Pick<
  ConsultantWorkflowIdentity,
  "account_id" | "user_profile_id" | "run_id" | "classification_id"
>;

function withdrawn(): never {
  throw new ExecutionIntegrityFault(
    "MB-409-EVIDENCE-WITHDRAWN",
    "Some source material in this saved result is no longer available for use. Its research history and costs are retained; refresh the research to obtain current evidence.",
  );
}

async function parentRecord(
  client: Queryable,
  scope: ParentScope,
  plan: Record<string, unknown>,
) {
  if (plan.parent_round_id === null || plan.parent_round_id === undefined)
    return null;
  if (
    typeof plan.parent_round_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      plan.parent_round_id,
    )
  )
    withdrawn();
  const result = await client.query(
    `SELECT round_id,execution_id,round_number,output FROM consultant_research_round
     WHERE round_id=$1 AND account_id=$2 AND user_profile_id=$3 AND run_id=$4 AND classification_id=$5
       AND status='completed' AND execution_id IS NOT NULL AND output IS NOT NULL`,
    [
      plan.parent_round_id,
      scope.account_id,
      scope.user_profile_id,
      scope.run_id,
      scope.classification_id,
    ],
  );
  const parent = result.rows[0];
  if (!parent || parent.round_number + 1 !== plan.round_number) withdrawn();
  return parent;
}

/** Only explicit, newly published dependencies are traversed; historical records are not backfilled. */
async function retainedIdentities(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
): Promise<ConsultantWorkflowIdentity[]> {
  const result = await client.query(
    `WITH RECURSIVE dependencies AS (
      SELECT parent_round_id,parent_execution_id,parent_output_sha256 FROM consultant_research_parent_dependency
       WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND classification_id=$5 AND execution_id=$4
      UNION
      SELECT n.parent_round_id,n.parent_execution_id,n.parent_output_sha256
       FROM consultant_research_parent_dependency n JOIN dependencies d ON n.execution_id=d.parent_execution_id
       WHERE n.account_id=$1 AND n.user_profile_id=$2 AND n.run_id=$3 AND n.classification_id=$5
    ) SELECT d.*,r.status,r.account_id,r.user_profile_id,r.run_id,r.classification_id,r.execution_id,r.output
      FROM dependencies d LEFT JOIN consultant_research_round r ON r.round_id=d.parent_round_id`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
    ],
  );
  if (result.rows.length > 4) withdrawn();
  const identities = [identity];
  for (const row of result.rows) {
    if (
      row.status !== "completed" ||
      row.account_id !== identity.account_id ||
      row.user_profile_id !== identity.user_profile_id ||
      row.run_id !== identity.run_id ||
      row.classification_id !== identity.classification_id ||
      row.execution_id !== row.parent_execution_id ||
      row.execution_id === identity.execution_id ||
      !row.output ||
      hashResearchAuthority(row.output) !== row.parent_output_sha256
    )
      withdrawn();
    identities.push({ ...identity, execution_id: row.parent_execution_id });
  }
  return identities;
}

/** Sources are locked before checking rights so withdrawal cannot race paid admission or publication. */
export async function assertRetainedParentAuthority(
  client: Queryable,
  scope: ParentScope,
  plan: Record<string, unknown>,
): Promise<void> {
  const parent = await parentRecord(client, scope, plan);
  if (!parent) return;
  const identity = { ...scope, execution_id: parent.execution_id };
  const identities = await retainedIdentities(client, identity);
  await client.query(
    `SELECT s.source_id FROM consultant_private_source s WHERE s.source_id IN (
       SELECT p.source_id FROM consultant_private_output_provenance p
        WHERE p.account_id=$1 AND p.user_profile_id=$2 AND p.run_id=$3 AND p.classification_id=$4 AND p.execution_id=ANY($5::uuid[])
       UNION SELECT v.source_id FROM consultant_private_observation o JOIN consultant_private_source_version v ON v.source_version_id=o.source_version_id
        WHERE o.account_id=$1 AND o.user_profile_id=$2 AND o.run_id=$3 AND o.classification_id=$4 AND o.execution_id=ANY($5::uuid[])
       UNION SELECT i.source_id FROM consultant_private_evidence_use m JOIN consultant_private_evidence_use_item i ON i.manifest_id=m.manifest_id
        WHERE m.account_id=$1 AND m.user_profile_id=$2 AND m.run_id=$3 AND m.classification_id=$4 AND m.execution_id=ANY($5::uuid[])
     ) ORDER BY s.source_id FOR SHARE OF s`,
    [
      scope.account_id,
      scope.user_profile_id,
      scope.run_id,
      scope.classification_id,
      identities.map((item) => item.execution_id),
    ],
  );
  for (const dependency of identities)
    await assertDirectResearchOutputRights(client, dependency);
}

/** Register all retained context independently of the child's displayed sources or lexical selection. */
export async function retainResearchParentDependency(
  client: Queryable,
  identity: ConsultantWorkflowIdentity,
  plan: Record<string, unknown>,
): Promise<void> {
  const parent = await parentRecord(client, identity, plan);
  if (!parent) return;
  await assertRetainedParentAuthority(client, identity, plan);
  const child = await client.query(
    `SELECT round_id,plan FROM consultant_research_round WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3
     AND classification_id=$4 AND execution_id=$5 AND status='completed' AND output IS NOT NULL`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.classification_id,
      identity.execution_id,
    ],
  );
  if (
    !child.rows[0] ||
    hashResearchAuthority(child.rows[0].plan) !== hashResearchAuthority(plan)
  )
    withdrawn();
  const parentHash = hashResearchAuthority(parent.output);
  await client.query(
    `INSERT INTO consultant_research_parent_dependency(execution_id,account_id,user_profile_id,run_id,classification_id,round_id,parent_round_id,parent_execution_id,parent_output_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(execution_id) DO NOTHING`,
    [
      identity.execution_id,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.classification_id,
      child.rows[0].round_id,
      parent.round_id,
      parent.execution_id,
      parentHash,
    ],
  );
  const stored = await client.query(
    `SELECT execution_id FROM consultant_research_parent_dependency WHERE execution_id=$1 AND account_id=$2 AND user_profile_id=$3
     AND run_id=$4 AND classification_id=$5 AND round_id=$6 AND parent_round_id=$7 AND parent_execution_id=$8 AND parent_output_sha256=$9`,
    [
      identity.execution_id,
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.classification_id,
      child.rows[0].round_id,
      parent.round_id,
      parent.execution_id,
      parentHash,
    ],
  );
  if (stored.rows.length !== 1) withdrawn();
}

/** Historical dates remain visible; withdrawn or invalidated source material must not be served. */
export async function assertResearchOutputRights(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
): Promise<void> {
  for (const dependency of await retainedIdentities(db, identity))
    await assertDirectResearchOutputRights(db, dependency);
}

async function assertDirectResearchOutputRights(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
): Promise<void> {
  const denied = await db.query<{ denied: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM consultant_private_output_provenance p
      LEFT JOIN consultant_private_source s ON s.source_id=p.source_id
      LEFT JOIN consultant_private_source_version v ON v.source_version_id=p.source_version_id
      WHERE p.account_id=$1 AND p.user_profile_id=$2 AND p.run_id=$3 AND p.execution_id=$4 AND p.classification_id=$5
        AND (s.source_id IS NULL OR v.source_version_id IS NULL OR s.rights_state<>'active' OR s.rights_epoch<>p.rights_epoch
          OR s.account_id<>$1 OR s.user_profile_id<>$2 OR p.event_invalidated_at IS NOT NULL)
      UNION ALL
      SELECT 1 FROM consultant_private_observation o
      JOIN consultant_private_source_version v ON v.source_version_id=o.source_version_id
      JOIN consultant_private_source s ON s.source_id=v.source_id
      WHERE o.account_id=$1 AND o.user_profile_id=$2 AND o.run_id=$3 AND o.execution_id=$4 AND o.classification_id=$5
        AND (s.rights_state<>'active' OR o.event_invalidated_at IS NOT NULL)
      UNION ALL
      SELECT 1 FROM consultant_private_evidence_use m
      LEFT JOIN consultant_private_evidence_use_item i ON i.manifest_id=m.manifest_id
      LEFT JOIN consultant_private_source s ON s.source_id=i.source_id
      LEFT JOIN consultant_private_observation o ON o.observation_id=i.observation_id
      WHERE m.account_id=$1 AND m.user_profile_id=$2 AND m.run_id=$3 AND m.execution_id=$4 AND m.classification_id=$5
        AND (m.invalidated_at IS NOT NULL OR (i.item_id IS NOT NULL AND
          (s.source_id IS NULL OR o.observation_id IS NULL OR s.rights_state<>'active' OR s.rights_epoch<>i.rights_epoch
           OR o.event_invalidated_at IS NOT NULL OR s.account_id<>$1 OR s.user_profile_id<>$2
           OR o.account_id<>$1 OR o.user_profile_id<>$2)))
      UNION ALL
      SELECT 1 FROM consultant_private_evidence_derivative d
      JOIN consultant_private_evidence_use m ON m.manifest_id=d.manifest_id
      WHERE m.account_id=$1 AND m.user_profile_id=$2 AND m.run_id=$3 AND m.execution_id=$4 AND m.classification_id=$5
        AND d.invalidated_at IS NOT NULL
    ) AS denied`,
    [
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
    ],
  );
  if (denied.rows[0]?.denied !== false) withdrawn();
}
