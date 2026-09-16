import type { Queryable } from "./database.js";
import type { ConsultantWorkflowIdentity } from "./consultant-workflow-jobs.js";
import { ExecutionIntegrityFault } from "./consultant-execution-integrity.js";
import {
  validatePrivateEvidenceSelection,
  type PrivateEvidenceReference,
} from "./consultant-private-evidence.js";

/** MB-ARCH-IMPLEMENT-001 L02. Join the reservation/approval/publication transaction. */
export async function assertQuotedPrivateMemoryAuthority(
  client: Queryable,
  identity: Pick<
    ConsultantWorkflowIdentity,
    "account_id" | "user_profile_id" | "classification_id"
  >,
  plan: Record<string, unknown>,
): Promise<void> {
  const memory = plan.private_memory;
  if (memory === undefined) return; // Historical quotes did not select private memory.
  const reject = (): never => {
    throw new ExecutionIntegrityFault(
      "MB-409-MEMORY-REQUOTE",
      "Saved evidence changed or expired. Review a fresh cost estimate before continuing.",
    );
  };
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) reject();
  const selected = memory as Record<string, unknown>;
  if (
    selected.version !== "private-memory.v1" ||
    typeof selected.valid_until !== "string" ||
    !Number.isFinite(Date.parse(selected.valid_until)) ||
    !Array.isArray(selected.observation_refs) ||
    selected.observation_refs.length > 50
  )
    reject();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  for (const value of selected.observation_refs as unknown[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) reject();
    const ref = value as Record<string, unknown>;
    if (
      typeof ref.observation_id !== "string" ||
      !uuid.test(ref.observation_id) ||
      typeof ref.source_version_id !== "string" ||
      !uuid.test(ref.source_version_id) ||
      (ref.entity_version_id !== null &&
        (typeof ref.entity_version_id !== "string" ||
          !uuid.test(ref.entity_version_id))) ||
      typeof ref.observation_version !== "string" ||
      !/^[a-f0-9]{64}$/u.test(ref.observation_version) ||
      !Number.isSafeInteger(ref.rights_epoch) ||
      Number(ref.rights_epoch) < 1
    )
      reject();
  }
  await validatePrivateEvidenceSelection(
    client,
    identity,
    selected.observation_refs as PrivateEvidenceReference[],
    "discovery",
  );
  // Recheck with database time after source-lock waits; host time is not authority.
  const valid = await client.query<{ valid: boolean }>(
    "SELECT $1::timestamptz>clock_timestamp() AS valid",
    [selected.valid_until],
  );
  if (!valid.rows[0]?.valid) reject();
}
