import { randomUUID } from "node:crypto";
import type { NarrativeMapping } from "@matchbase/contracts";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "./database.js";

export interface NarrativeIntakeOperation {
  operation_id: string;
  draft_id: string;
  account_id: string;
  user_profile_id: string;
  reserved_version: number;
  industry: "logistics";
  narrative: string;
  status: "reserved" | "running" | "completed" | "failed";
  proposal: NarrativeMapping | null;
  receipts: Record<string, Record<string, unknown>>;
  error: string | null;
  run_id: string | null;
  created_at: string;
}
function intakeFault(message: string, status = 409) {
  return Object.assign(new Error(message), {
    status,
    code: `MB-${status}-NARRATIVE-INTAKE`,
  });
}
export async function readNarrativeIntake(
  db: Queryable,
  accountId: string,
  profileId: string,
  draftId: string,
) {
  return (
    (
      await db.query<NarrativeIntakeOperation>(
        "SELECT * FROM consultant_narrative_intake WHERE account_id=$1 AND user_profile_id=$2 AND draft_id=$3",
        [accountId, profileId, draftId],
      )
    ).rows[0] ?? null
  );
}
export async function reserveNarrativeIntake(
  pool: ConnectionPool,
  input: {
    account_id: string;
    user_profile_id: string;
    draft_id: string;
    expected_version: number;
  },
) {
  return inTransaction(pool, async (db) => {
    const draft = (
      await db.query<{
        draft_version: number;
        status: string;
        current_run_id: string | null;
        draft_data: Record<string, unknown>;
      }>(
        "SELECT draft_version,status,current_run_id,draft_data FROM consultant_draft_session WHERE draft_id=$1 AND account_id=$2 AND user_profile_id=$3 FOR UPDATE",
        [input.draft_id, input.account_id, input.user_profile_id],
      )
    ).rows[0];
    if (!draft) throw intakeFault("Draft not found.", 404);
    const previous = await readNarrativeIntake(
      db,
      input.account_id,
      input.user_profile_id,
      input.draft_id,
    );
    if (previous) return { operation: previous, dispatch: false };
    if (
      draft.status !== "active" ||
      draft.current_run_id ||
      draft.draft_version !== input.expected_version
    )
      throw intakeFault(
        "The draft changed. Reload before submitting the narrative.",
      );
    const narrative = draft.draft_data.originalNarrative;
    if (
      draft.draft_data.industry !== "logistics" ||
      typeof narrative !== "string" ||
      !narrative.trim() ||
      narrative.length > 12000
    )
      throw intakeFault(
        "Save a logistics request of 1–12000 characters first.",
        400,
      );
    const operation = (
      await db.query<NarrativeIntakeOperation>(
        "INSERT INTO consultant_narrative_intake(operation_id,draft_id,account_id,user_profile_id,reserved_version,industry,narrative,status) VALUES($1,$2,$3,$4,$5,'logistics',$6,'reserved') RETURNING *",
        [
          randomUUID(),
          input.draft_id,
          input.account_id,
          input.user_profile_id,
          input.expected_version,
          narrative,
        ],
      )
    ).rows[0]!;
    return { operation, dispatch: true };
  });
}
export async function admitNarrativeCall(
  pool: ConnectionPool,
  operation: NarrativeIntakeOperation,
  call?: { request_id: string; model: string },
) {
  await inTransaction(pool, async (db) => {
    const draft = (
      await db.query<{
        draft_version: number;
        draft_data: Record<string, unknown>;
        status: string;
      }>(
        "SELECT draft_version,draft_data,status FROM consultant_draft_session WHERE draft_id=$1 AND account_id=$2 AND user_profile_id=$3 FOR UPDATE",
        [operation.draft_id, operation.account_id, operation.user_profile_id],
      )
    ).rows[0];
    if (
      !draft ||
      draft.status !== "active" ||
      draft.draft_version !== operation.reserved_version ||
      draft.draft_data.industry !== operation.industry ||
      draft.draft_data.originalNarrative !== operation.narrative
    )
      throw intakeFault(
        "The saved request changed before preparation. No new conversion is authorized.",
      );
    const admitted = await db.query(
      "UPDATE consultant_narrative_intake SET status='running',receipts=$2,updated_at=clock_timestamp() WHERE operation_id=$1 AND status='reserved' AND created_at > clock_timestamp()-interval '2 minutes' RETURNING operation_id",
      [
        operation.operation_id,
        JSON.stringify(
          call
            ? {
                [call.request_id]: {
                  ...call,
                  state: "started",
                  phase: "narrative_intake",
                  dispatched: false,
                  cost_reported: false,
                  usage_reported: false,
                  started_at: new Date().toISOString(),
                },
              }
            : {},
        ),
      ],
    );
    if (!admitted.rows.length)
      throw intakeFault(
        "Preparation was already admitted or expired. Its outcome must be reviewed; it will not be repeated automatically.",
      );
  });
}
export async function recordNarrativeReceipt(
  db: Queryable,
  operationId: string,
  event: Record<string, unknown>,
) {
  if (typeof event.request_id !== "string")
    throw new Error("Preparation receipt requires a request identity.");
  // Only server checkpoint callbacks can enter this store. Retain unknown costs.
  await db.query(
    `UPDATE consultant_narrative_intake SET receipts=jsonb_set(receipts,ARRAY[$2],COALESCE(receipts->$2,'{}'::jsonb)||$3::jsonb),updated_at=clock_timestamp() WHERE operation_id=$1 AND COALESCE(receipts->$2->>'state','') NOT IN ('completed','failed')`,
    [operationId, event.request_id, JSON.stringify(event)],
  );
}
export async function finishNarrativeIntake(
  db: Queryable,
  operationId: string,
  proposal: NarrativeMapping | null,
  error: string | null,
) {
  await db.query(
    "UPDATE consultant_narrative_intake SET status=$2,proposal=$3,error=$4,updated_at=clock_timestamp() WHERE operation_id=$1 AND status IN ('reserved','running')",
    [
      operationId,
      proposal ? "completed" : "failed",
      proposal ? JSON.stringify(proposal) : null,
      error,
    ],
  );
}

/** Trusted metadata lives separately; clients may edit only ordinary draft input. */
export function editableConsultantDraftData(
  raw: unknown,
): Record<string, unknown> {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const key of [
    "productRequirement",
    "technicalCompliance",
    "orderProfile",
    "product_requirement",
    "technical_compliance",
    "order_profile",
    "originalNarrative",
    "savedAt",
  ])
    if (typeof input[key] === "string") result[key] = input[key];
  if (input.industry === "logistics" || input.industry === "general")
    result.industry = input.industry;
  if (
    typeof result.originalNarrative === "string" &&
    result.originalNarrative.length > 12000
  )
    throw intakeFault("The narrative exceeds 12000 characters.", 400);
  return result;
}
