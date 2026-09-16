import { randomUUID } from "node:crypto";
import type { Queryable } from "./database.js";
import type { ConsultantWorkflowIdentity } from "./consultant-workflow-jobs.js";

export const RESEARCH_RECOVERY_PLAYBOOK_VERSION = "research-recovery.v1";
export const RESEARCH_INCIDENT_DISPOSITIONS = [
  "cancelled",
  "blocked_by_authority",
  "outcome_unknown",
  "bounded_retry",
  "bounded_content_repair",
  "incident_required",
] as const;
export type ResearchIncidentDisposition =
  (typeof RESEARCH_INCIDENT_DISPOSITIONS)[number];
const allowedCodes = new Set([
  "UNCLASSIFIED",
  "execution-lease-lost",
  "user-cancelled",
  "execution-interrupted",
  "MB-503-LIVE-TRANSPORT",
  "MB-503-LIVE-CHECKPOINT",
  "MB-502-LIVE-PROVIDER",
  "MB-502-LIVE-RESPONSE",
  "MB-422-LIVE-JSON",
  "MB-422-LIVE-SCHEMA",
  "MB-422-LIVE-OUTPUT-LIMIT",
  "MB-422-LIVE-INDEX",
  "MB-422-LIVE-EXTRACTION-SCOPE",
  "MB-409-EXECUTION-AUTHORITY",
  "MB-409-EXECUTION-MANIFEST",
  "MB-409-EXECUTION-ATTEMPT",
  "MB-409-STAGE-ALLOWANCE",
  "MB-409-ROUND-ALLOWANCE",
  "MB-409-EXECUTION-AMBIGUOUS",
  "MB-409-MEMORY-REQUOTE",
  "MB-409-PRIVATE-EVIDENCE",
  "MB-409-EVIDENCE-WITHDRAWN",
  "MB-409-RESEARCH-RENEWAL",
  "MB-409-ROUND-APPROVAL",
]);

const incidentAcquisitions = new WeakSet<object>();
const INCIDENT_STORE_DEADLINE_MS = 2_000;
const INCIDENT_CONNECT_DEADLINE_MS = 500;
type IncidentClient = Queryable & { release(destroy?: boolean): void };

/** Optional diagnostics must not consume an unbounded worker, query or pool wait. */
export async function withBoundedResearchIncidentStore<T>(
  db: Queryable,
  operation: (client: Queryable) => Promise<T>,
): Promise<T> {
  const pool = db as Queryable & { connect?: () => Promise<IncidentClient> };
  if (typeof pool.connect !== "function" || incidentAcquisitions.has(pool))
    throw new Error("A bounded diagnostic connection is unavailable.");
  incidentAcquisitions.add(pool);
  let expired = false;
  let client: IncidentClient | undefined;
  let released = false;
  const release = (destroy: boolean) => {
    if (client && !released) {
      released = true;
      client.release(destroy);
    }
  };
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let operationTimer: ReturnType<typeof setTimeout> | undefined;
  // A timed-out acquisition stays registered until it settles. Repeated failures
  // therefore cannot accumulate more pool waits; a late client is destroyed.
  const acquisition = Promise.resolve()
    .then(() => pool.connect!())
    .then(
      (value) => {
        incidentAcquisitions.delete(pool);
        client = value;
        if (expired) release(true);
        return value;
      },
      (error: unknown) => {
        incidentAcquisitions.delete(pool);
        throw error;
      },
    );
  try {
    await Promise.race([
      acquisition,
      new Promise<never>((_, reject) => {
        connectionTimer = setTimeout(() => {
          expired = true;
          reject(new Error("Incident connection deadline exceeded."));
        }, INCIDENT_CONNECT_DEADLINE_MS);
      }),
    ]);
    clearTimeout(connectionTimer);
    const connected = client!;
    const bounded: Queryable = {
      query: (text, values) => {
        if (expired)
          return Promise.reject(new Error("Incident store expired."));
        return connected.query(text, values);
      },
    };
    return await Promise.race([
      (async () => {
        await bounded.query("BEGIN");
        await bounded.query("SET LOCAL statement_timeout = '750ms'");
        await bounded.query("SET LOCAL lock_timeout = '250ms'");
        const result = await operation(bounded);
        await bounded.query("COMMIT");
        return result;
      })(),
      new Promise<never>((_, reject) => {
        operationTimer = setTimeout(() => {
          expired = true;
          // pg release(true) destroys the checked-out socket, cancelling pending
          // work. A Promise.race without this cleanup would leave a live query.
          release(true);
          reject(new Error("Incident persistence deadline exceeded."));
        }, INCIDENT_STORE_DEADLINE_MS);
      }),
    ]);
  } catch (error) {
    expired = true;
    release(true);
    throw error;
  } finally {
    clearTimeout(connectionTimer);
    clearTimeout(operationTimer);
    release(expired);
  }
}
export function safeResearchIncidentCode(value: unknown): string {
  return typeof value === "string" && allowedCodes.has(value)
    ? value
    : "UNCLASSIFIED";
}

/** Late diagnostic recording grants no mutation, dispatch, renewal or publication authority. */
export async function recordResearchIncident(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  incident: {
    stage: "prepare" | "research";
    disposition: ResearchIncidentDisposition;
    code: unknown;
  },
): Promise<string> {
  if (
    !["prepare", "research"].includes(incident.stage) ||
    !RESEARCH_INCIDENT_DISPOSITIONS.includes(incident.disposition)
  )
    throw new Error("Invalid typed research incident.");
  const record = await db.query<{ incident_id: string }>(
    `INSERT INTO consultant_research_incident(incident_id,account_id,user_profile_id,run_id,execution_id,classification_id,stage,disposition,fault_code)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(
       SELECT 1 FROM consultant_workflow_job WHERE account_id=$2 AND user_profile_id=$3 AND run_id=$4 AND execution_id=$5 AND classification_id=$6 AND stage=$7)
     ON CONFLICT(account_id,user_profile_id,run_id,execution_id,classification_id,stage,fault_code,disposition)
     DO UPDATE SET occurrences=consultant_research_incident.occurrences+1,last_seen_at=clock_timestamp() RETURNING incident_id`,
    [
      randomUUID(),
      identity.account_id,
      identity.user_profile_id,
      identity.run_id,
      identity.execution_id,
      identity.classification_id,
      incident.stage,
      incident.disposition,
      safeResearchIncidentCode(incident.code),
    ],
  );
  if (!record.rows[0])
    throw new Error(
      "Incident ownership does not match a retained workflow job.",
    );
  return record.rows[0].incident_id;
}

/** Agent packets omit profile, request, provider payload, URLs, timestamps and source content. */
export async function readResearchIncidentPacket(
  db: Queryable,
  owner: { account_id: string; user_profile_id: string },
  incidentId: string,
) {
  const result = await db.query(
    `SELECT fault_code,disposition,stage,playbook_version FROM consultant_research_incident
    WHERE incident_id=$1 AND account_id=$2 AND user_profile_id=$3`,
    [incidentId, owner.account_id, owner.user_profile_id],
  );
  const item = result.rows[0];
  if (!item) return null;
  return {
    version: "research-incident-packet.v1",
    fault_code: safeResearchIncidentCode(item.fault_code),
    disposition: item.disposition,
    stage: item.stage,
    playbook_version: RESEARCH_RECOVERY_PLAYBOOK_VERSION,
    reproduction: "synthetic-fixture-required" as const,
    authority: {
      tools: [] as string[],
      model_calls: 0,
      may_deploy: false,
      may_change_oracle: false,
    },
  };
}
