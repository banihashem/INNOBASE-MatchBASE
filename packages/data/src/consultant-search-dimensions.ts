import {
  parseCustomSearchDimensionDefinition,
  type SearchDimensionDefinition,
} from "@matchbase/contracts";
import type { Queryable } from "./database.js";
import { hashResearchAuthority } from "./consultant-execution-integrity.js";
import { assertLogicalRequestFence } from "./consultant-research-renewal.js";
import type { ConsultantWorkflowIdentity } from "./consultant-workflow-jobs.js";
import type { ConsultantWorkflowSessionRecord } from "./v3-repository.js";

// MB-SEARCH-DIMENSIONS-002 L01: private, append-only definition revisions.
export interface SearchDimensionCatalogueScope {
  account_id: string;
  user_profile_id: string;
  category_key: string;
}
export interface SearchDimensionDefinitionIdentity
  extends SearchDimensionCatalogueScope, ConsultantWorkflowIdentity {}

export class SearchDimensionPersistenceFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function invalid(message: string): never {
  throw new SearchDimensionPersistenceFault(422, "MB-422-DIMENSIONS", message);
}
function conflict(message: string): never {
  throw new SearchDimensionPersistenceFault(409, "MB-409-DIMENSIONS", message);
}
function validateScope(scope: SearchDimensionCatalogueScope): void {
  if (
    !scope.account_id ||
    !scope.user_profile_id ||
    !scope.category_key.trim() ||
    Buffer.byteLength(scope.category_key, "utf8") > 256
  )
    invalid("A bounded private owner and category scope is required.");
}

/** Call inside the mutation transaction; lock order is logical root, session, catalogue. */
export async function lockSearchDimensionSession(
  db: Queryable,
  accountId: string,
  userProfileId: string,
  runId: string,
): Promise<ConsultantWorkflowSessionRecord> {
  const identity = [accountId, userProfileId, runId];
  const visible = await db.query(
    `SELECT run_id FROM consultant_workflow_session
     WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND NOT is_invalidated`,
    identity,
  );
  if (!visible.rows.length)
    throw new SearchDimensionPersistenceFault(
      404,
      "MB-404-DIMENSIONS",
      "Research not found.",
    );
  await assertLogicalRequestFence(
    db,
    { account_id: accountId, user_profile_id: userProfileId },
    runId,
  );
  const result = await db.query<ConsultantWorkflowSessionRecord>(
    `SELECT * FROM consultant_workflow_session
     WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND NOT is_invalidated FOR UPDATE`,
    identity,
  );
  const session = result.rows[0];
  if (!session)
    throw new SearchDimensionPersistenceFault(
      404,
      "MB-404-DIMENSIONS",
      "Research not found.",
    );
  if (
    ![
      "prep_step1_awaiting_approval",
      "prep_step2_advisory_ready",
      "prep_step3_prompt_awaiting_approval",
    ].includes(session.current_state) ||
    (session.current_state !== "prep_step1_awaiting_approval" &&
      !session.approved_request_revision) ||
    session.deep_prompt_revision?.is_approved === true
  )
    conflict(
      "Search dimensions can only change before research prompt approval.",
    );
  // Separate statement after acquiring the session lock sees newly committed jobs/rounds.
  const busy = await db.query<{ busy: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2
        AND status IN ('queued','running')) OR EXISTS(SELECT 1 FROM consultant_research_round
        WHERE account_id=$1 AND run_id=$2) AS busy`,
    [accountId, runId],
  );
  if (busy.rows[0]?.busy)
    conflict("Research has already been queued or quoted for this request.");
  return session;
}

export async function listOwnedSearchDimensionDefinitions(
  db: Queryable,
  scope: SearchDimensionCatalogueScope,
): Promise<SearchDimensionDefinition[]> {
  validateScope(scope);
  const rows = await db.query<{ definition: unknown }>(
    `SELECT DISTINCT ON (dimension_id) definition FROM consultant_search_dimension_revision
     WHERE account_id=$1 AND user_profile_id=$2 AND category_key=$3
     ORDER BY dimension_id, revision DESC LIMIT 16`,
    [scope.account_id, scope.user_profile_id, scope.category_key],
  );
  return rows.rows.map((row) =>
    parseCustomSearchDimensionDefinition(row.definition, {
      account_id: scope.account_id,
      user_profile_id: scope.user_profile_id,
    }),
  );
}

/** Caller owns BEGIN/COMMIT. Returns effective revisions for the submitted definitions. */
export async function saveOwnedSearchDimensionDefinitions(
  db: Queryable,
  identity: SearchDimensionDefinitionIdentity,
  definitions: readonly SearchDimensionDefinition[],
): Promise<SearchDimensionDefinition[]> {
  validateScope(identity);
  if (!Array.isArray(definitions) || definitions.length > 16)
    invalid("At most sixteen private definitions are permitted per category.");
  const owner = {
    account_id: identity.account_id,
    user_profile_id: identity.user_profile_id,
  };
  const parsed = definitions.map((definition) => {
    if (Buffer.byteLength(JSON.stringify(definition), "utf8") > 8192)
      invalid("Private definition exceeds its storage limit.");
    try {
      return parseCustomSearchDimensionDefinition(definition, owner);
    } catch {
      return invalid("Invalid private search dimension definition.");
    }
  });
  if (new Set(parsed.map((definition) => definition.id)).size !== parsed.length)
    invalid("Private definition IDs must be unique.");
  const session = await lockSearchDimensionSession(
    db,
    identity.account_id,
    identity.user_profile_id,
    identity.run_id,
  );
  if (
    session.execution_id !== identity.execution_id ||
    (session.classification?.classification_id ??
      session.workflow_metadata?.classification_id) !==
      identity.classification_id
  )
    conflict("The research execution or classification changed.");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    JSON.stringify([
      "search-dimensions",
      identity.account_id,
      identity.user_profile_id,
      identity.category_key,
    ]),
  ]);
  const current = await listOwnedSearchDimensionDefinitions(db, identity);
  if (
    new Set([...current, ...parsed].map((definition) => definition.id)).size >
    16
  )
    invalid("At most sixteen private definitions are permitted per category.");
  const retained = new Map(
    current.map((definition) => [definition.id, definition]),
  );
  const effective: SearchDimensionDefinition[] = [];
  for (const definition of parsed) {
    const previous = retained.get(definition.id);
    if (
      previous &&
      hashResearchAuthority(previous) === hashResearchAuthority(definition)
    ) {
      effective.push(previous);
      continue;
    }
    if (definition.revision !== (previous?.revision ?? 1))
      conflict(
        "A private definition changed; reload its current revision before editing.",
      );
    const next = {
      ...definition,
      revision: previous ? previous.revision + 1 : 1,
    };
    await db.query(
      `INSERT INTO consultant_search_dimension_revision
       (account_id,user_profile_id,category_key,dimension_id,revision,run_id,execution_id,classification_id,definition)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        identity.account_id,
        identity.user_profile_id,
        identity.category_key,
        next.id,
        next.revision,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
        JSON.stringify(next),
      ],
    );
    effective.push(next);
  }
  return effective;
}
