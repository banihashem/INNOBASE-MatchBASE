import crypto from "node:crypto";
import type { Queryable } from "@matchbase/data";
import {
  getResearchRoundForExecution,
  listResearchRounds,
  completeResearchRound,
  recordConsultantProviderCall,
  recordResearchAttemptReceipt,
  readConsultantCostEvents,
  summarizeResearchExecutionAllowance,
  saveConsultantOutputV3,
  saveConsultantWorkflowSession,
  getConsultantWorkflowSessionByRunId,
  getConsultantOutputV3ByRunId,
  saveConsultantIntakeSnapshot,
  admitConsultantDraftSubmission,
  getConsultantDraftSessionByRunId,
  computeIntakeContentHash,
  type ConsultantWorkflowSessionRecord,
  appendConsultantWorkflowEvent,
  enqueueConsultantWorkflowJob,
  lockActiveConsultantExecution,
  assertExecutionFence,
  assertResearchPublicationAuthority,
  assertCompletedResearchPublicationAuthority,
  hashResearchAuthority,
  assertEvidenceUseManifest,
  capturePrivateResearchEvidence,
  registerEvidenceDerivative,
  retainResearchParentDependency,
  type ExecutionFence,
  inTransaction,
  type ConnectionPool,
  type ConsultantWorkflowJob,
  readConsultantProviderRouteRejectionEvents,
} from "@matchbase/data";
import {
  type ConsultantResearchOutputV3,
  type ProductClassificationRecord,
  type Step1FidelityValidationResult,
  validateIntakeSemanticCoherence,
  validateConsultantOutputV3SemanticCoherence,
  validateStep1RequirementFidelity,
  createApprovedRequestSnapshotV3,
  parseConsultantResearchOutputV3,
  validateConsultantOutputV3Integrity,
} from "@matchbase/contracts";
import { ApplicationFault } from "./types.js";
import {
  type ConsultantWorkflowState,
  assertValidWorkflowTransition,
} from "./consultant-workflow-state.js";
import {
  PreparationModelGateway,
  type NormalizedRequirement,
  type Step2AdvisoryResult,
  type ApprovedRequestRevision,
  type Step1InterpretationResult,
} from "./preparation-gateway.js";
import {
  createRoundCallGuard,
  summarizeResearchCosts,
} from "./consultant-research-cost.js";
import { executeDualLaneResearch } from "./dual-lane-orchestrator.js";
import { buildPublicSocialChecks } from "./public-social-review.js";
import { requiresPublicSocialReview } from "./progressive-research-policy.js";
import { synthesizeConsultantOutputV3 } from "./synthesis-engine.js";
import {
  buildResearchReview,
  hydrateResearchContinuation,
  getResearchRoundReview,
} from "./research-review.js";
import {
  LivePreparationModelGateway,
  LIVE_STEP1_SCHEMA,
  parseLiveStep1Interpretation,
  type PreparationCallOptions,
} from "./live-preparation.js";
import { LiveResearchError } from "./openrouter-model-policy.js";
import { parseLiveJson } from "./live-json-schema.js";
import { consultantResearchInput } from "./research-context-preflight.js";
import { createDurableResearchContext } from "./consultant-execution-context.js";
import { retainedProviderRouteRejections } from "./retained-provider-route-rejections.js";
import {
  admitPrivateResearchMemory,
  loadQuotedPrivateMemory,
} from "./consultant-private-memory.js";
import { withQuotedPublicMemory } from "./consultant-public-memory.js";
import { buildSearchDimensionOutput } from "./search-dimension-output.js";

export type ConsultantExecutionMode = "live" | "demonstration" | "hybrid";
export interface ConsultantWorkflowProgress {
  phase: string;
  loop: number;
  max_loops: number;
  message: string;
  updated_at: string;
  recovery_attempt?: number;
  max_recovery_attempts?: number;
  recovery_scheduled?: boolean;
  recovery_message?: string;
  recovery_original_model?: string;
  recovery_next_model?: string;
}

export interface ConsultantIntakeSubmission {
  readonly user_profile_id: string;
  readonly account_id: string;
  readonly product_requirement: string;
  readonly technical_compliance: string;
  readonly order_profile: string;
}

export interface WorkflowSession {
  search_dimensions?: import("@matchbase/contracts").SearchDimensionConfiguration;
  search_dimension_plan?: import("@matchbase/contracts").SearchDimensionPlan;
  search_dimension_revision?: string | null;
  search_dimensions_editable?: boolean;
  readonly draft_id?: string;
  readonly draft_version?: number;
  readonly session_id: string;
  readonly run_id: string;
  readonly user_profile_id: string;
  readonly account_id: string;
  execution_id: string;
  round_number?: number | undefined;
  readonly classification_id: string;
  mode: ConsultantExecutionMode;
  progress?: ConsultantWorkflowProgress | undefined;
  retry_action?: "interpretation" | "prepare" | "research" | null | undefined;
  state: ConsultantWorkflowState;
  readonly intake: ConsultantIntakeSubmission;
  request_revision_id: string;
  draft_revision: {
    revision_id: string;
    english_translation: string;
    created_at: string;
  };
  approved_request_revision: ApprovedRequestRevision | null;
  step1_interpretation: {
    english_translation: string;
    product_category: string;
    product_name: string;
    key_specifications: readonly string[];
    explicit_requirements: readonly NormalizedRequirement[];
    mandatory_requirements: readonly string[];
    preferred_requirements: readonly string[];
    excluded_requirements: readonly string[];
    ambiguities: readonly string[];
    unknowns: readonly string[];
    suggested_clarifications: readonly string[];
    fidelity_validation?: Step1FidelityValidationResult | null;
    is_approved: boolean;
  };
  classification: ProductClassificationRecord | null;
  advisory_version_id: string | null;
  advisory_source_hash?: string;
  step2_advisory: Step2AdvisoryResult | null;
  research_prompt_version_id: string | null;
  step3_deep_prompt: {
    prompt_text: string;
    discovery_criteria: readonly string[];
    evidence_thresholds: readonly string[];
    target_supplier_count: number;
    is_approved: boolean;
  } | null;
  approvals: readonly {
    step: "step1" | "step3";
    approved_revision_id: string;
    approved_at: string;
  }[];
  revealed_count: number;
  output: ConsultantResearchOutputV3 | null;
  error?: string | undefined;
  last_checkpoint?: string;
}

// In-memory active workflow session registry (keyed by run_id)
import { freezeSearchDimensionPlan } from "./consultant-search-dimensions.js";
const activeSessions = new Map<string, WorkflowSession>();

function preparationGateway(
  mode: ConsultantExecutionMode,
  on_checkpoint?: (event: any) => Promise<void>,
  recovery?: PreparationCallOptions,
) {
  return mode === "demonstration"
    ? new PreparationModelGateway()
    : new LivePreparationModelGateway({
        ...(on_checkpoint ? { on_checkpoint } : {}),
        ...recovery,
      });
}

export function getWorkflowSession(runId: string): WorkflowSession | null {
  return activeSessions.get(runId) ?? null;
}

export async function getOrRestoreWorkflowSession(
  db: Queryable,
  accountId: string,
  runId: string,
): Promise<WorkflowSession | null> {
  const dbRow = await getConsultantWorkflowSessionByRunId(db, accountId, runId);
  if (!dbRow || dbRow.is_invalidated) return null;

  const restored = mapRecordToSession(dbRow);
  if (
    restored.round_number ||
    [
      "research_dispatching",
      "lane_gemini_running",
      "lane_openai_running",
      "lanes_converged",
      "verification_loop_running",
      "synthesis_running",
      "progressive_reveal_ready",
      "workflow_complete",
    ].includes(restored.state) ||
    (restored.state === "workflow_failed" &&
      restored.retry_action === "research")
  ) {
    const dbOutput = await getConsultantOutputV3ByRunId(db, accountId, runId);
    if (dbOutput) {
      restored.output = dbOutput;
      restored.revealed_count = Math.min(
        restored.revealed_count,
        dbOutput.supplier_candidates.length,
      );
    }
  }
  activeSessions.set(runId, restored);
  return restored;
}

function mapSessionToRecord(
  session: WorkflowSession,
): ConsultantWorkflowSessionRecord {
  return {
    session_id: session.session_id,
    account_id: session.account_id,
    run_id: session.run_id,
    user_profile_id: session.user_profile_id,
    current_state: session.state,
    original_intake: session.intake as unknown as Record<string, unknown>,
    draft_revision: session.draft_revision as unknown as Record<
      string,
      unknown
    >,
    approved_request_revision:
      session.approved_request_revision as unknown as Record<
        string,
        unknown
      > | null,
    advisory_output: session.step2_advisory as unknown as Record<
      string,
      unknown
    > | null,
    advisory_loop_records: session.step2_advisory
      ? [
          { loop: 1, content: session.step2_advisory.loop1_trade_lane },
          { loop: 2, content: session.step2_advisory.loop2_regulatory },
          { loop: 3, content: session.step2_advisory.loop3_supply_structure },
        ]
      : null,
    deep_prompt_revision: session.step3_deep_prompt as unknown as Record<
      string,
      unknown
    > | null,
    approvals: session.approvals,
    classification: session.classification as unknown as Record<
      string,
      unknown
    > | null,
    execution_id: session.execution_id,
    last_checkpoint: session.last_checkpoint ?? session.state,
    workflow_metadata: {
      ...(session.search_dimensions
        ? {
            search_dimensions: session.search_dimensions,
            search_dimension_revision: session.search_dimension_revision,
          }
        : {}),
      ...(session.search_dimension_plan
        ? { search_dimension_plan: session.search_dimension_plan }
        : {}),
      round_number: session.round_number,
      mode: session.mode,
      classification_id: session.classification_id,
      step1_interpretation: session.step1_interpretation,
      advisory_version_id: session.advisory_version_id,
      advisory_source_hash: session.advisory_source_hash,
      research_prompt_version_id: session.research_prompt_version_id,
      revealed_count: session.revealed_count,
      progress: session.progress,
      error: session.error,
      retry_action: session.retry_action,
    },
  };
}

function mapRecordToSession(
  record: ConsultantWorkflowSessionRecord,
): WorkflowSession {
  const intake =
    record.original_intake as unknown as ConsultantIntakeSubmission;
  const draft = (record.draft_revision as any) ?? {
    revision_id: crypto.randomUUID(),
    english_translation: "",
    created_at: new Date().toISOString(),
  };
  const approvedReq =
    record.approved_request_revision as ApprovedRequestRevision | null;
  const classification =
    record.classification as ProductClassificationRecord | null;
  const advisory = record.advisory_output as Step2AdvisoryResult | null;
  const prompt = record.deep_prompt_revision as any | null;
  const metadata = record.workflow_metadata ?? {};

  return {
    session_id: record.session_id,
    ...(metadata.search_dimensions
      ? {
          search_dimensions:
            metadata.search_dimensions as import("@matchbase/contracts").SearchDimensionConfiguration,
          search_dimension_revision: metadata.search_dimension_revision as
            string | null,
        }
      : {}),
    ...(metadata.search_dimension_plan
      ? {
          search_dimension_plan:
            metadata.search_dimension_plan as import("@matchbase/contracts").SearchDimensionPlan,
        }
      : {}),
    run_id: record.run_id,
    user_profile_id: record.user_profile_id,
    account_id: record.account_id,
    execution_id: record.execution_id ?? crypto.randomUUID(),
    classification_id:
      classification?.classification_id ??
      String(metadata.classification_id ?? record.run_id),
    mode:
      (metadata.mode as ConsultantExecutionMode | undefined) ?? "demonstration",
    round_number:
      typeof metadata.round_number === "number"
        ? metadata.round_number
        : undefined,
    progress: metadata.progress as ConsultantWorkflowProgress | undefined,
    error: metadata.error as string | undefined,
    retry_action: metadata.retry_action as WorkflowSession["retry_action"],
    state: record.current_state as ConsultantWorkflowState,
    intake,
    request_revision_id: draft.revision_id,
    draft_revision: draft,
    approved_request_revision: approvedReq,
    step1_interpretation: (metadata.step1_interpretation as
      WorkflowSession["step1_interpretation"] | undefined) ?? {
      english_translation:
        approvedReq?.english_translation ?? draft.english_translation,
      product_category: approvedReq?.product_category ?? "General",
      product_name: approvedReq?.product_name ?? "Product",
      key_specifications: approvedReq?.key_specifications ?? [],
      explicit_requirements: [],
      mandatory_requirements: [],
      preferred_requirements: [],
      excluded_requirements: [],
      ambiguities: [],
      unknowns: [],
      suggested_clarifications: [],
      is_approved: !!approvedReq,
    },
    classification,
    advisory_version_id:
      (metadata.advisory_version_id as string | undefined) ?? null,
    ...(typeof metadata.advisory_source_hash === "string"
      ? { advisory_source_hash: metadata.advisory_source_hash }
      : {}),
    step2_advisory: advisory,
    research_prompt_version_id:
      (metadata.research_prompt_version_id as string | undefined) ?? null,
    step3_deep_prompt: prompt,
    approvals: (record.approvals as any) ?? [],
    revealed_count:
      typeof metadata.revealed_count === "number" ? metadata.revealed_count : 5,
    output: null,
    last_checkpoint: record.last_checkpoint ?? record.current_state,
  };
}

/**
 * Stage 1: Submit Intake and generate Step 1 Interpretation only.
 * Future steps (Step 2 and Step 3) remain ungenerated (stage isolation).
 */
export async function submitConsultantIntake(
  submission: ConsultantIntakeSubmission,
  db?: Queryable,
  options?: {
    mode?: ConsultantExecutionMode;
    draft?: { draft_id: string; expected_version: number };
  },
): Promise<WorkflowSession> {
  submission = Object.freeze({ ...submission });
  if (options?.draft && (!db || !("connect" in db)))
    throw new ApplicationFault(
      503,
      "submission-storage-required",
      "MB-503-SUBMISSION-STORAGE",
      "Draft submission requires transactional storage.",
    );
  const session_id = crypto.randomUUID();
  const run_id = crypto.randomUUID();
  const execution_id = crypto.randomUUID();
  const revision_id = crypto.randomUUID();
  const classification_id = crypto.randomUUID();
  const mode = options?.mode ?? "live";

  // Validate intake semantic coherence (reject cross-request / cross-domain mixing)
  const intakeCoherence = validateIntakeSemanticCoherence({
    product_requirement: submission.product_requirement,
    technical_compliance: submission.technical_compliance,
    order_profile: submission.order_profile,
  });
  if (!intakeCoherence.isCoherent) {
    const err = new Error(
      intakeCoherence.conflicts[0]?.explanation ??
        `Intake semantic coherence violation: ${intakeCoherence.errors.join("; ")}`,
    );
    (err as any).status = 422;
    (err as any).code = "MB-422-COHERENCE";
    (err as any).conflicts = intakeCoherence.conflicts;
    (err as any).recoverable = true;
    throw err;
  }

  const identity = {
    account_id: submission.account_id,
    user_profile_id: submission.user_profile_id,
    run_id,
    execution_id,
    classification_id,
  };
  const initialRecord: ConsultantWorkflowSessionRecord = {
    ...identity,
    session_id,
    current_state: "prep_step1_interpreting",
    original_intake: submission as unknown as Record<string, unknown>,
    draft_revision: {
      revision_id,
      english_translation: "",
      created_at: new Date().toISOString(),
    },
    workflow_metadata: { mode, classification_id, revealed_count: 5 },
  };
  let submittedDraft: { draft_id: string; draft_version: number } | undefined;
  if (db) {
    const snapshot = {
      ...identity,
      snapshot_id: crypto.randomUUID(),
      revision_number: 1,
      product_requirement: submission.product_requirement,
      technical_compliance: submission.technical_compliance,
      order_profile: submission.order_profile,
      content_hash: computeIntakeContentHash(
        submission.product_requirement,
        submission.technical_compliance,
        submission.order_profile,
      ),
    };
    const persist = async (client: Queryable) => {
      if (options?.draft) {
        const admission = await admitConsultantDraftSubmission(client, {
          ...options.draft,
          mode,
          snapshot,
        });
        submittedDraft = {
          draft_id: admission.draft_id,
          draft_version: admission.draft_version,
        };
        if (admission.replay) return admission.run_id;
      } else {
        await saveConsultantIntakeSnapshot(client, snapshot);
      }
      await saveConsultantWorkflowSession(client, initialRecord);
      return null;
    };
    const existingRunId =
      "connect" in db
        ? await inTransaction(db as ConnectionPool, persist)
        : await persist(db);
    if (existingRunId) {
      const existing = await getOrRestoreWorkflowSession(
        db,
        submission.account_id,
        existingRunId,
      );
      if (!existing)
        throw new ApplicationFault(
          409,
          "submitted-run-unavailable",
          "MB-409-SUBMITTED-RUN",
          "The submitted run is unavailable. Its original intake remains locked.",
        );
      return { ...existing, ...submittedDraft };
    }
  }
  return interpretConsultantIntake(
    submission,
    db,
    mode,
    initialRecord,
    submittedDraft,
  );
}

async function interpretConsultantIntake(
  submission: ConsultantIntakeSubmission,
  db: Queryable | undefined,
  mode: ConsultantExecutionMode,
  initialRecord: ConsultantWorkflowSessionRecord,
  submittedDraft?: { draft_id: string; draft_version: number },
): Promise<WorkflowSession> {
  const { run_id } = initialRecord;
  const execution_id = initialRecord.execution_id!;
  const classification_id = String(
    initialRecord.workflow_metadata!.classification_id,
  );
  const identity = {
    account_id: submission.account_id,
    user_profile_id: submission.user_profile_id,
    run_id,
    execution_id,
    classification_id,
  };
  // An interpretation failure remains traceable even before the first user approval.
  const step1 = await preparationGateway(mode, async (event) => {
    if (db)
      await appendConsultantWorkflowEvent(
        db,
        identity,
        String(event.phase ?? "interpretation"),
        event,
      );
  })
    .extractAndInterpret({
      product_requirement: submission.product_requirement,
      technical_compliance: submission.technical_compliance,
      order_profile: submission.order_profile,
    })
    .then((result) => ({
      ...result,
      classification: { ...result.classification, classification_id },
    }))
    .catch(async (error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "MB-502-INTERPRETATION";
      if (db) {
        await appendConsultantWorkflowEvent(db, identity, "failed", {
          stage: "interpretation",
          code,
        });
        await saveConsultantWorkflowSession(db, {
          ...initialRecord,
          current_state: "workflow_failed",
          workflow_metadata: {
            ...initialRecord.workflow_metadata,
            retry_action: "interpretation",
            error: `Interpretation failed (${code}). Execution ID: ${execution_id}.`,
          },
        });
      }
      throw Object.assign(
        new ApplicationFault(
          Number(code.match(/^MB-(\d{3})/)?.[1] ?? 502),
          "interpretation-failed",
          code,
          `Interpretation could not complete (${code}). Your intake is saved. Execution ID: ${execution_id}.`,
        ),
        {
          run_id,
          execution_id,
          retry_action: "interpretation",
          ...submittedDraft,
        },
      );
    });

  const session = materializeStep1Session(
    initialRecord,
    submission,
    mode,
    step1,
    submittedDraft,
  );
  activeSessions.set(run_id, session);
  if (db) await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
  return session;
}

/** Fresh interpretation and offline recovery share the same human approval boundary. */
function materializeStep1Session(
  initialRecord: ConsultantWorkflowSessionRecord,
  submission: ConsultantIntakeSubmission,
  mode: ConsultantExecutionMode,
  step1: Step1InterpretationResult,
  submittedDraft?: { draft_id: string; draft_version: number },
): WorkflowSession {
  const { session_id, run_id } = initialRecord;
  const execution_id = initialRecord.execution_id!;
  const revision_id = String(initialRecord.draft_revision!.revision_id);
  return {
    ...submittedDraft,
    session_id,
    run_id,
    user_profile_id: submission.user_profile_id,
    account_id: submission.account_id,
    execution_id,
    classification_id: step1.classification.classification_id,
    mode,
    state: "prep_step1_awaiting_approval",
    intake: submission,
    request_revision_id: revision_id,
    draft_revision: {
      revision_id,
      english_translation: step1.english_translation,
      created_at: new Date().toISOString(),
    },
    approved_request_revision: null,
    step1_interpretation: {
      english_translation: step1.english_translation,
      product_category: step1.product_category,
      product_name: step1.product_name,
      key_specifications: step1.mandatory_requirements,
      explicit_requirements: step1.explicit_requirements,
      mandatory_requirements: step1.mandatory_requirements,
      preferred_requirements: step1.preferred_requirements,
      excluded_requirements: step1.excluded_requirements,
      ambiguities: step1.ambiguities,
      unknowns: step1.unknowns,
      suggested_clarifications: step1.suggested_clarifications,
      is_approved: false,
    },
    classification: step1.classification,
    advisory_version_id: null,
    step2_advisory: null, // Isolated until Step 1 approved
    research_prompt_version_id: null,
    step3_deep_prompt: null, // Isolated until Step 2 ready
    approvals: [],
    revealed_count: 5,
    output: null,
    last_checkpoint: "prep_step1_awaiting_approval",
  };
}

export interface RetainedInterpretationRecoveryArgs {
  readonly account_id: string;
  readonly user_profile_id: string;
  readonly run_id: string;
  readonly source_execution_id: string;
  readonly classification_id: string;
  readonly source_event_id: string;
  readonly expected_intake_hash: string;
  readonly reason: string;
  readonly corrections: readonly {
    readonly requirement_index: number;
    readonly source_box:
      "product_requirement" | "technical_compliance" | "order_profile";
    readonly expected_reference: string;
    readonly replacement_reference: string;
  }[];
  readonly execute?: boolean;
  readonly expected_recovery_hash?: string;
}

function rejectRetainedInterpretation(message: string): never {
  throw new ApplicationFault(
    409,
    "retained-interpretation-recovery-unavailable",
    "MB-409-INTERPRETATION-RECOVERY",
    message,
  );
}

function recoveryHash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function isRetainableAuditText(value: string): boolean {
  return !/\0|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(
    value,
  );
}

/**
 * MB-UX-QUALITY-002 L01: operator-only offline repair of one invalid source anchor.
 * Preview is read-only; execution requires its reviewed hash. This function never
 * invokes a gateway, grants approval, creates a quote or enqueues downstream work.
 */
export async function recoverRetainedConsultantInterpretation(
  db: ConnectionPool,
  args: RetainedInterpretationRecoveryArgs,
) {
  if (
    typeof args.reason !== "string" ||
    !args.reason.trim() ||
    args.reason.length > 2000 ||
    !isRetainableAuditText(args.reason) ||
    !/^[1-9]\d*$/.test(args.source_event_id) ||
    !/^[a-f0-9]{64}$/.test(args.expected_intake_hash) ||
    !Array.isArray(args.corrections) ||
    args.corrections.length !== 1
  )
    rejectRetainedInterpretation(
      "A reason, exact intake hash, receipt event and one explicit correction are required.",
    );
  const result = await inTransaction(db, async (client) => {
    const rows = await client.query<
      ConsultantWorkflowSessionRecord & {
        original_failed_session: Record<string, unknown>;
      }
    >(
      `SELECT s.*,to_jsonb(s) AS original_failed_session FROM consultant_workflow_session s
       WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 FOR UPDATE`,
      [args.account_id, args.user_profile_id, args.run_id],
    );
    const locked = rows.rows[0];
    if (!locked?.original_failed_session)
      rejectRetainedInterpretation(
        "The original failed session snapshot is unavailable.",
      );
    // Database JSON preserves full timestamp precision; pg Date decoding does not.
    // Keep the typed row for workflow logic and bind this exact JSON to preview/audit.
    const { original_failed_session: originalFailedSession, ...record } =
      locked;
    if (
      !record ||
      record.account_id !== args.account_id ||
      record.user_profile_id !== args.user_profile_id ||
      record.run_id !== args.run_id ||
      record.execution_id !== args.source_execution_id ||
      record.is_invalidated !== false ||
      record.current_state !== "workflow_failed" ||
      record.workflow_metadata?.retry_action !== "interpretation" ||
      record.workflow_metadata?.mode !== "live" ||
      record.workflow_metadata?.stopped_by_user === true ||
      record.last_checkpoint === "user_cancelled" ||
      record.approved_request_revision ||
      record.advisory_output ||
      record.deep_prompt_revision ||
      (record.advisory_loop_records?.length ?? 0) !== 0 ||
      (record.approvals?.length ?? 0) !== 0 ||
      record.workflow_metadata?.advisory_version_id ||
      record.workflow_metadata?.research_prompt_version_id ||
      (
        record.workflow_metadata?.step1_interpretation as
          { is_approved?: unknown } | undefined
      )?.is_approved === true ||
      record.classification ||
      record.workflow_metadata?.classification_id !== args.classification_id ||
      !record.draft_revision?.revision_id
    )
      rejectRetainedInterpretation(
        "The failed interpretation does not match the current unapproved owner, execution and classification.",
      );
    const intake =
      record.original_intake as unknown as ConsultantIntakeSubmission;
    const boxes = [
      "product_requirement",
      "technical_compliance",
      "order_profile",
    ] as const;
    if (
      intake.account_id !== args.account_id ||
      intake.user_profile_id !== args.user_profile_id ||
      boxes.some((box) => typeof intake[box] !== "string") ||
      computeIntakeContentHash(
        intake.product_requirement,
        intake.technical_compliance,
        intake.order_profile,
      ) !== args.expected_intake_hash
    )
      rejectRetainedInterpretation(
        "The original intake no longer matches the reviewed content hash.",
      );
    const snapshots = await client.query(
      `SELECT * FROM consultant_intake_snapshot WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3`,
      [args.account_id, args.user_profile_id, args.run_id],
    );
    const snapshot = snapshots.rows[0];
    if (
      snapshots.rows.length !== 1 ||
      !snapshot ||
      snapshot.content_hash !== args.expected_intake_hash ||
      boxes.some((box) => snapshot[box] !== intake[box])
    )
      rejectRetainedInterpretation(
        "The immutable submitted intake snapshot is missing or differs from this intake.",
      );
    const draft = await getConsultantDraftSessionByRunId(
      client,
      args.account_id,
      args.run_id,
    );
    if (
      draft &&
      (draft.user_profile_id !== args.user_profile_id ||
        draft.snapshot_id !== snapshot.snapshot_id ||
        draft.status !== "submitted")
    )
      rejectRetainedInterpretation(
        "The submitted draft no longer matches the original intake snapshot.",
      );
    const downstream = await client.query(
      `SELECT 'job' AS kind FROM consultant_workflow_job WHERE account_id=$1 AND run_id=$2 AND status IN ('queued','running')
       UNION ALL SELECT 'round' AS kind FROM consultant_research_round WHERE account_id=$1 AND run_id=$2
       UNION ALL SELECT 'output' AS kind FROM consultant_output_v3 WHERE account_id=$1 AND run_id=$2`,
      [args.account_id, args.run_id],
    );
    if (downstream.rows.length)
      rejectRetainedInterpretation(
        "Active work, a research quote or output prevents interpretation recovery.",
      );
    const eventRows = await client.query<{
      event_id: string;
      phase: string;
      detail: Record<string, unknown>;
    }>(
      `SELECT event_id::text,phase,detail FROM consultant_workflow_event
       WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3 AND execution_id=$4 AND classification_id=$5
       ORDER BY event_id`,
      [
        args.account_id,
        args.user_profile_id,
        args.run_id,
        args.source_execution_id,
        args.classification_id,
      ],
    );
    const source = eventRows.rows.find(
      (event) => event.event_id === args.source_event_id,
    );
    const receipt = source?.detail;
    if (
      !source ||
      source.phase !== "step1_translation" ||
      !receipt ||
      receipt.phase !== "step1_translation" ||
      receipt.state !== "completed" ||
      receipt.provider_receipt_received !== true ||
      receipt.is_byok !== true ||
      receipt.native_web !== false ||
      receipt.response_truncated !== false ||
      receipt.storage_content_safety ||
      typeof receipt.response_content !== "string" ||
      !receipt.response_content.trim() ||
      typeof receipt.request_id !== "string" ||
      !receipt.request_id ||
      typeof receipt.request_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.request_hash)
    )
      rejectRetainedInterpretation(
        "A complete, untruncated and verified BYOK Step 1 receipt is required.",
      );
    const started = eventRows.rows.filter(
      (event) =>
        event.phase === "step1_translation" &&
        event.detail.state === "started" &&
        event.detail.request_id === receipt.request_id,
    );
    if (
      started.length !== 1 ||
      BigInt(started[0]!.event_id) >= BigInt(source.event_id) ||
      started[0]!.detail.request_hash !== receipt.request_hash ||
      started[0]!.detail.native_web !== false ||
      !eventRows.rows.some(
        (event) =>
          BigInt(event.event_id) > BigInt(source.event_id) &&
          event.phase === "failed" &&
          event.detail.stage === "interpretation" &&
          event.detail.code === "MB-422-LIVE-LINEAGE",
      )
    )
      rejectRetainedInterpretation(
        "The receipt lacks its matching started request and retained lineage failure.",
      );

    // Strict raw validation happens before correction; no schema repair is permitted.
    const payload = parseLiveJson<{
      explicit_requirements: {
        source_box: (typeof boxes)[number];
        source_text_reference: string;
      }[];
    }>(receipt.response_content, LIVE_STEP1_SCHEMA);
    const correction = args.corrections[0]!;
    if (
      !correction ||
      Object.keys(correction).sort().join(",") !==
        "expected_reference,replacement_reference,requirement_index,source_box" ||
      !Number.isInteger(correction.requirement_index) ||
      correction.requirement_index < 0 ||
      typeof correction.expected_reference !== "string" ||
      typeof correction.replacement_reference !== "string" ||
      !isRetainableAuditText(correction.expected_reference) ||
      !isRetainableAuditText(correction.replacement_reference)
    )
      rejectRetainedInterpretation(
        "Only an explicit source anchor correction is allowed; semantic payload edits are forbidden.",
      );
    const requirement =
      payload.explicit_requirements[correction.requirement_index];
    if (
      !requirement ||
      requirement.source_box !== correction.source_box ||
      requirement.source_text_reference !== correction.expected_reference ||
      (requirement.source_text_reference.trim() &&
        intake[requirement.source_box].includes(
          requirement.source_text_reference,
        )) ||
      !correction.replacement_reference.trim() ||
      !intake[requirement.source_box].includes(correction.replacement_reference)
    )
      rejectRetainedInterpretation(
        "The selected reference must be invalid and its replacement must occur literally in the same original source box.",
      );
    const beforeHash = recoveryHash(payload);
    requirement.source_text_reference = correction.replacement_reference;
    const correctedText = JSON.stringify(payload);
    const afterHash = recoveryHash(payload);
    const step1 = parseLiveStep1Interpretation(
      correctedText,
      {
        product_requirement: intake.product_requirement,
        technical_compliance: intake.technical_compliance,
        order_profile: intake.order_profile,
      },
      {
        requirement_ids: Array.from({ length: 120 }, () => crypto.randomUUID()),
        ledger_id: crypto.randomUUID(),
        classification_id: args.classification_id,
        assigned_at: new Date().toISOString(),
      },
    );
    const recoveryHashValue = recoveryHash({
      record: originalFailedSession,
      snapshot,
      draft,
      source,
      started: started[0],
      corrections: args.corrections,
      reason: args.reason,
      before_hash: beforeHash,
      after_hash: afterHash,
    });
    const summary = {
      executed: false,
      run_id: args.run_id,
      source_execution_id: args.source_execution_id,
      source_event_id: args.source_event_id,
      expected_intake_hash: args.expected_intake_hash,
      recovery_hash: recoveryHashValue,
      before_payload_hash: beforeHash,
      after_payload_hash: afterHash,
      correction_count: 1,
      requirement_count: step1.explicit_requirements.length,
      additional_provider_calls: 0,
      next_state: "prep_step1_awaiting_approval",
    };
    if (args.execute !== true) return { summary, session: null };
    if (args.expected_recovery_hash !== recoveryHashValue)
      rejectRetainedInterpretation(
        "Execution requires the unchanged recovery hash from a reviewed preview.",
      );
    const executionId = crypto.randomUUID();
    const session = materializeStep1Session(
      { ...record, execution_id: executionId },
      intake,
      "live",
      step1,
      draft
        ? { draft_id: draft.draft_id, draft_version: draft.draft_version }
        : undefined,
    );
    const recoveredRecord = mapSessionToRecord(session);
    await appendConsultantWorkflowEvent(
      client,
      {
        account_id: args.account_id,
        user_profile_id: args.user_profile_id,
        run_id: args.run_id,
        execution_id: executionId,
        classification_id: args.classification_id,
      },
      "step1_retained_interpretation_recovery",
      {
        activity: "MB-UX-QUALITY-002 L01",
        state: "completed",
        source_execution_id: args.source_execution_id,
        source_event_id: args.source_event_id,
        source_request_hash: receipt.request_hash,
        source_response_sha256: crypto
          .createHash("sha256")
          .update(receipt.response_content)
          .digest("hex"),
        before_payload_hash: beforeHash,
        after_payload_hash: afterHash,
        recovery_hash: recoveryHashValue,
        corrections: args.corrections,
        reason: args.reason,
        original_failed_session: originalFailedSession,
        additional_provider_calls: 0,
        human_approval_required: true,
      },
    );
    await saveConsultantWorkflowSession(client, {
      ...record,
      ...recoveredRecord,
      workflow_metadata: {
        ...record.workflow_metadata,
        ...recoveredRecord.workflow_metadata,
        retained_interpretation_recovery: {
          source_execution_id: args.source_execution_id,
          source_event_id: args.source_event_id,
          recovery_hash: recoveryHashValue,
        },
      },
    });
    return {
      summary: { ...summary, executed: true, execution_id: executionId },
      session,
    };
  });
  if (result.session) activeSessions.set(args.run_id, result.session);
  return result.summary;
}

/** An explicit retry retains the original run and intake, with a fresh execution ID. */
export async function retryConsultantIntakeInterpretation(
  db: ConnectionPool,
  accountId: string,
  userId: string,
  runId: string,
): Promise<WorkflowSession> {
  const executionId = crypto.randomUUID();
  const record = await inTransaction(db, async (client) => {
    const claimed = await client.query<{ run_id: string }>(
      `UPDATE consultant_workflow_session
          SET current_state='prep_step1_interpreting', execution_id=$4,
              workflow_metadata=(COALESCE(workflow_metadata,'{}'::jsonb) - 'error') ||
                '{"retry_action":"interpretation"}'::jsonb,
              updated_at=clock_timestamp()
        WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3
          AND NOT is_invalidated AND current_state='workflow_failed'
          AND approved_request_revision IS NULL
          AND workflow_metadata->>'retry_action'='interpretation'
        RETURNING run_id`,
      [accountId, userId, runId, executionId],
    );
    if (!claimed.rows[0])
      throw new ApplicationFault(
        409,
        "interpretation-retry-unavailable",
        "MB-409-INTERPRETATION-RETRY",
        "This interpretation cannot be retried in its current state.",
      );
    const stored = await getConsultantWorkflowSessionByRunId(
      client,
      accountId,
      runId,
    );
    if (!stored)
      throw new Error("Claimed interpretation record was not found.");
    return stored;
  });
  const submission = Object.freeze({
    ...(record.original_intake as unknown as ConsultantIntakeSubmission),
    account_id: accountId,
    user_profile_id: userId,
  });
  const draft = await getConsultantDraftSessionByRunId(db, accountId, runId);
  return interpretConsultantIntake(
    submission,
    db,
    (record.workflow_metadata?.mode as ConsultantExecutionMode) ?? "live",
    record,
    draft
      ? { draft_id: draft.draft_id, draft_version: draft.draft_version }
      : undefined,
  );
}

/**
 * Stage 2: Approve Step 1 Interpretation.
 * Accepts human edits, creates approved request revision, and triggers Stage 2 Advisory generation.
 */
export async function approveInterpretationStep(
  runId: string,
  editedTranslation?: string,
  db?: Queryable,
  options?: {
    defer_generation?: boolean;
    transaction_session?: WorkflowSession;
  },
): Promise<WorkflowSession> {
  const session = options?.transaction_session ?? activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);
  if (session.run_id !== runId)
    throw new Error("Approval session identity mismatch.");

  if (editedTranslation !== undefined && !editedTranslation.trim()) {
    throw new ApplicationFault(
      422,
      "translation-required",
      "MB-422-TRANSLATION-REQUIRED",
      "The edited English request must not be empty.",
    );
  }

  if (session.approved_request_revision) {
    if (
      editedTranslation?.trim() &&
      editedTranslation.trim() !==
        session.approved_request_revision.english_translation
    ) {
      throw new ApplicationFault(
        409,
        "revision-approved",
        "MB-409-REVISION-APPROVED",
        "This request revision is already approved. Create a new request to change it.",
      );
    }
    return session;
  }

  assertValidWorkflowTransition(session.state, "prep_step1_approved");

  const effectiveTranslation =
    editedTranslation !== undefined
      ? editedTranslation.trim()
      : session.step1_interpretation.english_translation;

  // Enforce Step 1 explicit requirement fidelity gate
  if (session.intake) {
    const fidelityCheck = validateStep1RequirementFidelity(
      {
        product_requirement: session.intake.product_requirement || "",
        technical_compliance: session.intake.technical_compliance || "",
        order_profile: session.intake.order_profile || "",
      },
      {
        english_translation: effectiveTranslation,
      },
    );

    if (!fidelityCheck.valid) {
      throw new ApplicationFault(
        422,
        "fidelity-failed",
        "MB-422-FIDELITY-FAILED",
        `Cannot approve Step 1: explicit requirement fidelity failed (${fidelityCheck.mutated_count} mutated, ${fidelityCheck.omitted_count} omitted). ${fidelityCheck.explanation || ""}`,
      );
    }
    session.step1_interpretation.fidelity_validation = fidelityCheck;
    session.step1_interpretation.mandatory_requirements =
      fidelityCheck.ledger.requirements
        .filter((r) => r.modality === "mandatory")
        .map((r) => r.normalized_value);
    session.step1_interpretation.explicit_requirements = fidelityCheck.ledger
      .requirements as any;
    session.step1_interpretation.key_specifications =
      session.step1_interpretation.mandatory_requirements;
  }

  session.step1_interpretation.english_translation = effectiveTranslation;
  session.step1_interpretation.is_approved = true;

  const approvedRevisionId = crypto.randomUUID();
  const approvedRevision: ApprovedRequestRevision = {
    revision_id: approvedRevisionId,
    english_translation: effectiveTranslation,
    product_category: session.step1_interpretation.product_category,
    product_name: session.step1_interpretation.product_name,
    key_specifications: session.step1_interpretation.key_specifications,
    approved_at: new Date().toISOString(),
    canonical_snapshot: createApprovedRequestSnapshotV3({
      revision_id: approvedRevisionId,
      approved_translation: effectiveTranslation,
      product_name: session.step1_interpretation.product_name,
      product_category: session.step1_interpretation.product_category,
      intake: session.intake,
      approved_at: new Date().toISOString(),
    }),
  };

  session.approved_request_revision = approvedRevision;
  const approvedDimensionPlan = freezeSearchDimensionPlan(session);
  if (approvedDimensionPlan)
    session.approved_request_revision = {
      ...approvedRevision,
      search_dimension_plan: approvedDimensionPlan,
    };
  session.approvals = [
    ...session.approvals,
    {
      step: "step1",
      approved_revision_id: approvedRevisionId,
      approved_at: approvedRevision.approved_at,
    },
  ];

  session.state = "prep_step1_approved";
  session.last_checkpoint = session.state;
  if (db) await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
  activeSessions.set(runId, session);
  if (options?.defer_generation) return session;
  return generateApprovedConsultantPreparation(runId, db);
}

/** Preparation uses only the immutable human-approved revision. */
export async function generateApprovedConsultantPreparation(
  runId: string,
  db?: Queryable,
  assertLease?: () => Promise<void>,
  signal?: AbortSignal,
  executionFence?: ExecutionFence,
): Promise<WorkflowSession> {
  const cachedSession = activeSessions.get(runId);
  if (
    !cachedSession?.approved_request_revision ||
    !cachedSession.classification
  )
    throw new Error("An approved request is required.");
  const session = executionFence ? { ...cachedSession } : cachedSession;
  const approvedRevision = cachedSession.approved_request_revision;
  const executionId = session.execution_id;
  const sourceHash = (current = session) =>
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          {
            approved_request: current.approved_request_revision,
            classification: current.classification,
            mode: current.mode,
          },
          (_key, value: unknown) =>
            value && typeof value === "object" && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.entries(value).sort(([left], [right]) =>
                    left < right ? -1 : left > right ? 1 : 0,
                  ),
                )
              : value,
        ),
      )
      .digest("hex");
  const approvedSourceHash = sourceHash();
  const assertCurrentPreparation = async () => {
    signal?.throwIfAborted();
    if (assertLease) await assertLease();
    const current = activeSessions.get(runId);
    if (
      !current ||
      current.execution_id !== executionId ||
      sourceHash(current) !== approvedSourceHash ||
      session.execution_id !== executionId ||
      sourceHash() !== approvedSourceHash ||
      ![
        "prep_step2_advisory_generating",
        "prep_step3_prompt_synthesizing",
      ].includes(session.state)
    )
      throw new LiveResearchError(
        "MB-409-PREPARATION-STALE",
        "The preparation execution or its approved request changed.",
      );
  };
  const savedAdvisory =
    session.advisory_source_hash === approvedSourceHash &&
    session.advisory_version_id &&
    session.step2_advisory
      ? session.step2_advisory
      : null;
  session.state = "prep_step2_advisory_generating";
  session.error = undefined;
  session.retry_action = "prepare";
  const checkpoint = createWorkflowCheckpoint(
    session,
    db,
    assertLease,
    executionFence,
  );
  await checkpoint({
    phase: "advisory",
    loop: 0,
    max_loops: 3,
    message: savedAdvisory
      ? "Retaining completed advisory research for the same approved request."
      : "Researching product and trade guidance.",
  });
  const gateway = preparationGateway(session.mode, checkpoint, {
    preparation_recovery: true,
    automatic_recovery_attempts: 3,
    before_call: assertCurrentPreparation,
    on_preparation_checkpoint: checkpoint,
    ...(signal ? { signal } : {}),
  });
  const advisory =
    savedAdvisory ??
    (await gateway.generateAdvisoryLoops(
      approvedRevision,
      session.classification!,
    ));
  await assertCurrentPreparation();
  if (!savedAdvisory) session.advisory_version_id = crypto.randomUUID();
  session.advisory_source_hash = approvedSourceHash;
  session.step2_advisory = advisory;
  session.state = "prep_step3_prompt_synthesizing";
  if (db) await persistOwnedWorkflowSession(db, session, executionFence);

  // Generate Step 3 prompt using the approved revision (F01: human edit propagates downstream!)
  const promptResult = await gateway.generateDeepResearchPrompt(
    approvedRevision,
    advisory,
    session.classification!,
  );
  await assertCurrentPreparation();
  session.research_prompt_version_id = crypto.randomUUID();
  session.step3_deep_prompt = {
    prompt_text: promptResult.prompt_text,
    discovery_criteria: promptResult.discovery_criteria,
    evidence_thresholds: promptResult.evidence_thresholds,
    target_supplier_count: promptResult.target_supplier_count,
    is_approved: false,
  };

  session.state = "prep_step3_prompt_awaiting_approval";
  session.last_checkpoint = session.state;
  session.retry_action = null;
  await checkpoint({
    phase: "prompt_ready",
    loop: 3,
    max_loops: 3,
    message: "Review and approve the research prompt.",
  });

  if (db) {
    await persistOwnedWorkflowSession(db, session, executionFence);
  }

  activeSessions.set(runId, session);
  return session;
}

/**
 * Stage 3: Approve Step 3 Prompt.
 */
export async function approveDeepPromptStep(
  runId: string,
  editedPrompt?: string,
  db?: Queryable,
  transactionSession?: WorkflowSession,
): Promise<WorkflowSession> {
  const session = transactionSession ?? activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);
  if (session.run_id !== runId)
    throw new Error("Approval session identity mismatch.");
  if (editedPrompt !== undefined && !editedPrompt.trim()) {
    throw new ApplicationFault(
      422,
      "prompt-required",
      "MB-422-PROMPT-REQUIRED",
      "The edited research prompt must not be empty.",
    );
  }
  if (!session.step3_deep_prompt?.prompt_text.trim()) {
    throw new ApplicationFault(
      409,
      "prompt-not-ready",
      "MB-409-PROMPT-NOT-READY",
      "The research prompt is not ready for approval.",
    );
  }
  if (session.step3_deep_prompt.is_approved) {
    if (
      editedPrompt !== undefined &&
      editedPrompt.trim() !== session.step3_deep_prompt.prompt_text
    ) {
      throw new ApplicationFault(
        409,
        "prompt-approved",
        "MB-409-PROMPT-APPROVED",
        "This research prompt is already approved.",
      );
    }
    return session;
  }

  if (session.state === "prep_step2_advisory_ready") {
    session.state = "prep_step3_prompt_awaiting_approval";
  }
  assertValidWorkflowTransition(session.state, "prep_step3_prompt_approved");

  if (
    editedPrompt &&
    editedPrompt.trim().length > 0 &&
    session.step3_deep_prompt
  ) {
    session.step3_deep_prompt = {
      ...session.step3_deep_prompt,
      prompt_text: editedPrompt.trim(),
    };
  }

  const approvedDimensionPlan = freezeSearchDimensionPlan(session);
  if (approvedDimensionPlan && session.approved_request_revision)
    session.approved_request_revision = {
      ...session.approved_request_revision,
      search_dimension_plan: approvedDimensionPlan,
    };
  if (session.step3_deep_prompt) {
    session.step3_deep_prompt.is_approved = true;
  }

  const promptApprovalId = crypto.randomUUID();
  session.approvals = [
    ...session.approvals,
    {
      step: "step3",
      approved_revision_id:
        session.research_prompt_version_id ?? promptApprovalId,
      approved_at: new Date().toISOString(),
    },
  ];

  session.state = "prep_step3_prompt_approved";
  session.last_checkpoint = "prep_step3_prompt_approved";

  if (db) {
    await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
  }
  activeSessions.set(runId, session);
  return session;
}

/**
 * Stage 4: Execute Research Dispatching and Synthesize V3 Output.
 */
export async function executeConsultantWorkflowResearch(
  db: Queryable,
  runId: string,
  options?: {
    mode?: ConsultantExecutionMode;
    assertLease?: () => Promise<void>;
    signal?: AbortSignal;
    executionFence?: ExecutionFence;
  },
): Promise<ConsultantResearchOutputV3> {
  options?.signal?.throwIfAborted();
  const cachedSession = activeSessions.get(runId);
  if (!cachedSession) throw new Error(`Workflow session ${runId} not found.`);
  // Do not expose completion in process memory before the durable transaction commits.
  const session = { ...cachedSession };
  if (
    !session.approved_request_revision ||
    !session.step3_deep_prompt?.is_approved
  ) {
    throw new ApplicationFault(
      409,
      "approval-required",
      "MB-409-APPROVAL-REQUIRED",
      "Approve the request and research prompt before starting research.",
    );
  }
  const mode = options?.mode ?? session.mode;
  if (mode !== session.mode)
    throw new Error("Execution mode cannot change after request preparation.");

  const round = await getResearchRoundForExecution(
    db,
    session.account_id,
    session.execution_id,
  );
  if (!round || round.status !== "approved") {
    throw new ApplicationFault(
      409,
      "round-approval-required",
      "MB-409-ROUND-APPROVAL",
      "Review and approve a current cost estimate before starting research.",
    );
  }
  session.round_number = round.round_number;
  const rounds = await listResearchRounds(
    db,
    session.account_id,
    session.run_id,
  );
  const parent = rounds.find(
    (item) => item.round_id === round.plan.parent_round_id,
  );
  const focusedParentRequired =
    mode === "live" && round.plan.focus_analysis_required;
  if (
    focusedParentRequired &&
    (!parent ||
      parent.status !== "completed" ||
      parent.round_number + 1 !== round.plan.round_number ||
      parent.account_id !== session.account_id ||
      parent.user_profile_id !== session.user_profile_id ||
      parent.run_id !== session.run_id ||
      parent.classification_id !== session.classification_id)
  )
    throw new ApplicationFault(
      409,
      "focus-parent-required",
      "MB-409-FOCUS-STALE",
      "Review the latest completed research before continuing this round.",
    );
  // A resumed approved execution retains every earlier dispatch in its allowance.
  const executionEvents = (
    await readConsultantCostEvents(db, session.account_id, session.run_id)
  ).filter((event) => event.execution_id === session.execution_id);
  const previousAllowance =
    summarizeResearchExecutionAllowance(executionEvents);
  const retainedRouteRejections =
    options?.executionFence && "connect" in db
      ? retainedProviderRouteRejections(
          await readConsultantProviderRouteRejectionEvents(
            db as ConnectionPool,
            session,
          ),
        )
      : [];
  if (round.plan.private_memory && !("connect" in db))
    throw new ApplicationFault(
      503,
      "memory-storage-required",
      "MB-503-MEMORY-STORAGE",
      "Private research context requires transactional storage. No research has started.",
    );
  const memoryUse =
    "connect" in db
      ? await admitPrivateResearchMemory(
          db as ConnectionPool,
          session,
          round.plan,
        )
      : undefined;
  const roundOptions = {
    ...(options?.executionFence && "connect" in db
      ? createDurableResearchContext(
          db as ConnectionPool,
          session,
          options.executionFence,
          round,
          memoryUse?.manifest_id,
        )
      : {}),
    round_plan: round.plan,
    automatic_recovery_attempts: round.plan.automatic_recovery_attempts ?? 1,
    previously_consumed_focus_attempts:
      previousAllowance.consumed_focus_attempts,
    ...(retainedRouteRejections.length
      ? { retained_provider_route_rejections: retainedRouteRejections }
      : {}),
    extraction_batch_size: round.plan.extraction_batch_size ?? 5,
    approved_rates: round.plan.rates,
    ...(parent && (parent.continuation || focusedParentRequired)
      ? { continuation: await hydrateResearchContinuation(db, parent) }
      : {}),
    before_call: createRoundCallGuard(
      round.plan,
      previousAllowance.consumed_provider_calls,
      { atomic_admission: Boolean(options?.executionFence && "connect" in db) },
    ),
    max_output_tokens: round.plan.max_output_tokens_per_call,
    max_input_bytes: round.plan.max_input_tokens_per_call,
    reasoning_effort:
      round.plan.depth === "deep" ? ("high" as const) : ("low" as const),
    web_engine: round.plan.search_engine,
  };
  assertValidWorkflowTransition(session.state, "research_dispatching");
  session.state = "research_dispatching";
  session.error = undefined;
  session.retry_action = "research";
  const checkpoint = createWorkflowCheckpoint(
    session,
    db,
    options?.assertLease,
    options?.executionFence,
  );
  await checkpoint({
    phase: "discovery",
    loop: round.round_number,
    max_loops: round.round_number,
    message: `Starting approved round ${round.round_number}. ${round.plan.purpose}`,
  });

  // Dispatch Dual Lane Research
  session.state = "lane_gemini_running";
  const dualResult = await withQuotedPublicMemory(
    session,
    round.plan,
    (publicMemoryContext) =>
      executeDualLaneResearch(
        {
          ...consultantResearchInput(session),
          ...(memoryUse ? { private_memory_context: memoryUse.context } : {}),
          ...(publicMemoryContext
            ? { public_memory_context: publicMemoryContext }
            : {}),
        },
        {
          mode,
          ...roundOptions,
          on_checkpoint: checkpoint,
          ...(options?.signal ? { signal: options.signal } : {}),
        },
      ),
  );
  options?.signal?.throwIfAborted();

  session.state = "lanes_converged";
  session.state = "verification_loop_running";
  session.state = "synthesis_running";

  // Synthesize V3 output
  let output = synthesizeConsultantOutputV3({
    user_profile_id: session.user_profile_id,
    research_run_id: session.run_id,
    execution_id: session.execution_id,
    classification_id: session.classification_id,
    product_name: session.step1_interpretation.product_name,
    product_category: session.step1_interpretation.product_category,
    dual_lane_result: dualResult,
    approved_translation: session.step1_interpretation.english_translation,
    ...(session.approved_request_revision.canonical_snapshot
      ? {
          approved_request_snapshot:
            session.approved_request_revision.canonical_snapshot,
        }
      : {}),
    primary_classification: session.classification!,
    intake: session.intake,
  });

  const costSummary = summarizeResearchCosts(
    await readConsultantCostEvents(db, session.account_id, session.run_id),
    mode === "demonstration",
  );
  const socialChecks = buildPublicSocialChecks(
    round.plan,
    dualResult,
    new Date().toISOString(),
  );
  output = {
    ...output,
    ...(session.search_dimension_plan
      ? buildSearchDimensionOutput(session.search_dimension_plan, output)
      : {}),
    research_review: buildResearchReview(
      dualResult.continuation,
      output.supplier_candidates,
      session.step3_deep_prompt.discovery_criteria,
      round.round_number,
      parent ? await getResearchRoundReview(db, parent) : undefined,
    ),
    ...(requiresPublicSocialReview(round.plan)
      ? { public_social_checks: socialChecks }
      : {}),
    limitations_and_disclosures: [
      ...output.limitations_and_disclosures,
      ...(round.plan.private_memory
        ? [
            {
              title: "Private research memory",
              description: `${round.plan.private_memory.observation_refs.length} source-bound historical observations from this profile informed the search. ${round.plan.private_memory.needs_refresh_count} observations requiring refresh and ${round.plan.private_memory.excluded_by_budget_count} observations outside the input allowance were excluded. Fresh discovery and current source verification were required; prior buyer quantities, fit assessments and rankings were not adopted.`,
              severity: "info" as const,
            },
          ]
        : []),
      ...(round.plan.public_memory
        ? [
            {
              title: "Shared public evidence memory",
              description: `${round.plan.public_memory.observation_refs.length} independently acquired and released public observations informed search discovery. They contained no private buyer profile, request, ranking or fit data and required fresh source verification before any current finding was admitted.`,
              severity: "info" as const,
            },
          ]
        : []),
      {
        title: `Recorded cost through research round ${round.round_number}`,
        description: `USD ${costSummary.recorded_total_usd.toFixed(6)} recorded across this request: preparation USD ${costSummary.preparation_usd.toFixed(6)}, research attempts USD ${costSummary.research_usd.toFixed(6)}. OpenRouter USD ${costSummary.openrouter_charge_usd.toFixed(6)}; BYOK upstream USD ${costSummary.byok_upstream_usd.toFixed(6)}. ${costSummary.unpriced_calls} calls have incomplete accounting. ${costSummary.disclosure}`,
        severity: "info",
      },
      ...(socialChecks.length
        ? [
            {
              title: "Public social evidence review",
              description: socialChecks
                .map(
                  (check) =>
                    `${check.supplier_name}: ${check.status}; ${check.profile_url ?? "no reviewed URL"}. ${check.limitation}`,
                )
                .join("\n"),
              severity: "advisory" as const,
            },
          ]
        : []),
    ],
  };
  parseConsultantResearchOutputV3(output);
  const integrity = validateConsultantOutputV3Integrity(output);
  if (!integrity.isValid)
    throw new Error(
      `Output evidence integrity failed: ${integrity.errors.join("; ")}`,
    );

  // Mode-aware and semantic-coherence validation gate
  const coherence = validateConsultantOutputV3SemanticCoherence(output);
  if (!coherence.isCoherent) {
    const err = new Error(
      `Semantic coherence validation failed: ${coherence.errors.join("; ")}`,
    );
    (err as any).status = 422;
    (err as any).code = "MB-422-COHERENCE";
    throw err;
  }

  if (options?.assertLease) await options.assertLease();

  session.output = output;
  session.revealed_count = Math.min(5, output.supplier_candidates.length);
  session.state = "progressive_reveal_ready";
  session.last_checkpoint = "progressive_reveal_ready";
  session.retry_action = null;
  session.progress = {
    phase: "completed",
    loop: dualResult.verification_loops_completed,
    max_loops: round.round_number,
    message: `Round ${round.round_number} complete: ${output.supplier_candidates.length} supplier dossiers saved. No further research is running.`,
    updated_at: new Date().toISOString(),
  };

  // Persist the complete output and all suppliers atomically, independent of reveal pagination.
  const persist = async (client: Queryable) => {
    if (options?.executionFence) {
      await assertResearchPublicationAuthority(
        client,
        session,
        options.executionFence,
        hashResearchAuthority(round.plan),
      );
    } else if (options?.assertLease) {
      await lockActiveConsultantExecution(
        client,
        session.account_id,
        session.run_id,
        session.execution_id,
      );
    }
    if (memoryUse) {
      await assertEvidenceUseManifest(client, session, memoryUse.manifest_id);
      await loadQuotedPrivateMemory(client, session, round.plan);
    }
    await completeResearchRound(
      client,
      session.account_id,
      session.execution_id,
      output,
      dualResult.continuation,
    );
    await retainResearchParentDependency(
      client,
      session,
      round.plan as unknown as Record<string, unknown>,
    );
    await saveConsultantOutputV3(client, {
      account_id: session.account_id,
      output,
    });
    if (memoryUse) {
      await registerEvidenceDerivative(client, session, memoryUse.manifest_id, {
        kind: "research_round",
        reference: round.round_id,
      });
      await registerEvidenceDerivative(client, session, memoryUse.manifest_id, {
        kind: "research_output",
        reference: session.run_id,
      });
    }
    if (mode === "live")
      await capturePrivateResearchEvidence(client, session, output);
    await saveConsultantWorkflowSession(client, mapSessionToRecord(session));
    // Source locks can wait past the lease or approval deadline. Recheck at the transaction boundary.
    if (options?.executionFence)
      await assertCompletedResearchPublicationAuthority(
        client,
        session,
        options.executionFence,
        hashResearchAuthority(round.plan),
      );
    else if (options?.assertLease) await options.assertLease();
  };
  if ("connect" in db) await inTransaction(db as ConnectionPool, persist);
  else await persist(db);

  activeSessions.set(runId, session);

  return output;
}

/**
 * Reveal additional candidates progressively (+5 per activation).
 */
export async function revealMoreCandidates(
  runId: string,
  increment = 5,
  db?: Queryable,
): Promise<number> {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);
  if (!session.output) throw new Error("Research results are not ready.");
  const total = session.output.supplier_candidates.length;
  session.revealed_count = Math.min(
    session.revealed_count + (increment > 0 ? 5 : 0),
    total,
  );
  if (
    session.revealed_count >= total &&
    session.state === "progressive_reveal_ready"
  ) {
    session.state = "workflow_complete";
  }

  if (db) {
    await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
  }

  return session.revealed_count;
}

function createWorkflowCheckpoint(
  session: WorkflowSession,
  db?: Queryable,
  assertLease?: () => Promise<void>,
  executionFence?: ExecutionFence,
) {
  let pending = Promise.resolve();
  return (event: any): Promise<void> => {
    // Do not let a rejected lease/progress promise discard late provider accounting.
    const accounting = db
      ? Promise.all([
          recordConsultantProviderCall(db, session, event),
          recordResearchAttemptReceipt(db, session, event),
        ])
      : Promise.resolve();
    pending = pending.then(async () => {
      await accounting;
      if (assertLease) await assertLease();
      const phase = String(event.phase ?? event.stage ?? "research");
      const loop =
        session.round_number ?? Number(event.loop ?? event.loop_number ?? 0);
      session.progress = {
        phase,
        loop,
        max_loops: Number(
          session.round_number ??
            event.max_loops ??
            (phase.includes("advisory") ? 3 : 15),
        ),
        message: String(event.message ?? "Research in progress."),
        updated_at: new Date().toISOString(),
        ...(Number.isInteger(event.recovery_attempt)
          ? { recovery_attempt: event.recovery_attempt }
          : {}),
        ...(Number.isInteger(event.max_recovery_attempts)
          ? { max_recovery_attempts: event.max_recovery_attempts }
          : {}),
        ...(typeof event.recovery_scheduled === "boolean"
          ? { recovery_scheduled: event.recovery_scheduled }
          : {}),
        ...(typeof event.recovery_message === "string" &&
        event.recovery_message.length > 0 &&
        event.recovery_message.length <= 600 &&
        Array.from(event.recovery_message as string).every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        )
          ? { recovery_message: event.recovery_message }
          : {}),
        ...(typeof event.recovery_original_model === "string" &&
        /^[a-z0-9][a-z0-9._:/-]{0,199}$/i.test(event.recovery_original_model)
          ? { recovery_original_model: event.recovery_original_model }
          : {}),
        ...(typeof event.recovery_next_model === "string" &&
        /^[a-z0-9][a-z0-9._:/-]{0,199}$/i.test(event.recovery_next_model)
          ? { recovery_next_model: event.recovery_next_model }
          : {}),
      };
      if (phase.includes("verification"))
        session.state = "verification_loop_running";
      if (phase.includes("synthesis") && !phase.includes("prompt"))
        session.state = "synthesis_running";
      session.last_checkpoint = `${phase}:${loop}`;
      if (db) {
        const persist = async (client: Queryable) => {
          if (executionFence)
            await assertExecutionFence(client, session, executionFence);
          else if (assertLease)
            await lockActiveConsultantExecution(
              client,
              session.account_id,
              session.run_id,
              session.execution_id,
            );
          await appendConsultantWorkflowEvent(client, session, phase, event);
          await saveConsultantWorkflowSession(
            client,
            mapSessionToRecord(session),
          );
        };
        if ("connect" in db) await inTransaction(db as ConnectionPool, persist);
        else await persist(db);
      }
    });
    return Promise.all([accounting, pending]).then(() => undefined);
  };
}

export async function queueConsultantWorkflowStep(
  db: Queryable,
  runId: string,
  stage: "prepare" | "research",
  retry = false,
): Promise<ConsultantWorkflowJob> {
  if (stage === "research")
    throw new ApplicationFault(
      409,
      "round-approval-required",
      "MB-409-ROUND-APPROVAL",
      "Review and approve a current round estimate in Section 3.",
    );
  const session = activeSessions.get(runId);
  if (!session?.approved_request_revision)
    throw new Error("An approved request is required.");
  if (retry) {
    if (session.state !== "workflow_failed" || session.retry_action !== stage)
      throw new Error("This workflow cannot be retried at that stage.");
    session.execution_id = crypto.randomUUID();
    session.error = undefined;
  }
  const persist = async (client: Queryable) => {
    const job = await enqueueConsultantWorkflowJob(
      client,
      session,
      stage,
      session.mode,
    );
    if (job.stage !== stage) return job;
    if (job.status === "queued") {
      session.execution_id = job.execution_id;
      session.state =
        stage === "prepare"
          ? "prep_step2_advisory_generating"
          : "research_dispatching";
      session.retry_action = stage;
      session.last_checkpoint = "queued";
      session.progress = {
        phase: "queued",
        loop: 0,
        max_loops: stage === "prepare" ? 3 : 15,
        message: "Your request is queued for research.",
        updated_at: new Date().toISOString(),
      };
      await saveConsultantWorkflowSession(client, mapSessionToRecord(session));
    }
    return job;
  };
  return "connect" in db
    ? inTransaction(db as ConnectionPool, persist)
    : persist(db);
}

export async function markConsultantWorkflowFailed(
  db: Queryable,
  runId: string,
  stage: "prepare" | "research",
  error: unknown,
  executionFence?: ExecutionFence,
): Promise<void> {
  const cachedSession = activeSessions.get(runId);
  if (!cachedSession) return;
  const session = { ...cachedSession };
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code).slice(0, 100)
      : "provider-or-execution-failed";
  session.state = "workflow_failed";
  session.retry_action = stage;
  const detail =
    error instanceof LiveResearchError
      ? error.message
      : `Research could not complete (${code}).`;
  session.error = `${detail} Your approved request is saved. Execution ID: ${session.execution_id}.`;
  // Terminal UI must never retain a stale parallel lane's "request started" message.
  session.progress = {
    phase: "failed",
    loop: session.progress?.loop ?? 0,
    max_loops: session.progress?.max_loops ?? (stage === "prepare" ? 3 : 15),
    message:
      "Research stopped. Your approved request is saved; the failed stage can be retried.",
    updated_at: new Date().toISOString(),
  };
  session.last_checkpoint = "workflow_failed";
  const persist = async (client: Queryable) => {
    if (executionFence)
      await assertExecutionFence(client, session, executionFence);
    await appendConsultantWorkflowEvent(client, session, "failed", {
      stage,
      code,
    });
    await saveConsultantWorkflowSession(client, mapSessionToRecord(session));
  };
  if ("connect" in db) await inTransaction(db as ConnectionPool, persist);
  else await persist(db);
  activeSessions.set(runId, session);
}

async function persistOwnedWorkflowSession(
  db: Queryable,
  session: WorkflowSession,
  executionFence?: ExecutionFence,
): Promise<void> {
  const persist = async (client: Queryable) => {
    if (executionFence)
      await assertExecutionFence(client, session, executionFence);
    await saveConsultantWorkflowSession(client, mapSessionToRecord(session));
  };
  if ("connect" in db) await inTransaction(db as ConnectionPool, persist);
  else await persist(db);
  activeSessions.set(session.run_id, session);
}
