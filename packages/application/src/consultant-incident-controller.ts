import {
  recordResearchIncident,
  withBoundedResearchIncidentStore,
  type ConsultantWorkflowIdentity,
  type Queryable,
} from "@matchbase/data";
import { researchRecoveryDisposition } from "./research-recovery-policy.js";

export function classifyConsultantIncident(
  error: unknown,
  cancelled = false,
  ambiguous = false,
) {
  const fault =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const details = [fault.provider_http_failure, fault.provider_failure].filter(
    (item) => item && typeof item === "object",
  ) as Record<string, unknown>[];
  const restricted = new Set([
    "authentication",
    "billing",
    "permission",
    "privacy",
    "refusal",
  ]);
  const category =
    details.find((item) => restricted.has(String(item.category)))?.category ??
    details.find((item) => [401, 402, 403].includes(Number(item.http_status)))
      ?.http_status;
  const code = typeof fault.code === "string" ? fault.code : "UNCLASSIFIED";
  const disposition = researchRecoveryDisposition({
    code,
    cancelled,
    retryable: fault.retryable === true,
    dispatched: fault.dispatched === true,
    provider_receipt_received: fault.provider_receipt_received === true,
    ...(category
      ? {
          provider_failure_category:
            typeof category === "string" ? category : "permission",
        }
      : {}),
  });
  return {
    code,
    disposition:
      ambiguous && !["cancelled", "blocked_by_authority"].includes(disposition)
        ? ("outcome_unknown" as const)
        : disposition,
  };
}

/** Containment is deterministic. A diagnostic/repair agent cannot change cost or evidence authority. */
export async function retainConsultantIncident(
  db: Queryable,
  identity: ConsultantWorkflowIdentity,
  stage: "prepare" | "research",
  error: unknown,
  cancelled = false,
): Promise<void> {
  await withBoundedResearchIncidentStore(db, async (client) => {
    const uncertain = await client.query<{ uncertain: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM consultant_research_attempt
    WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND execution_id=$4 AND classification_id=$5
      AND provider_outcome='unknown' AND outcome<>'not_dispatched') AS uncertain`,
      [
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
        identity.execution_id,
        identity.classification_id,
      ],
    );
    const { code, disposition } = classifyConsultantIncident(
      error,
      cancelled,
      uncertain.rows[0]?.uncertain === true,
    );
    await recordResearchIncident(client, identity, {
      stage,
      disposition,
      code,
    });
  });
}
