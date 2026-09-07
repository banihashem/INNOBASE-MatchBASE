import crypto from "node:crypto";
import type { Queryable } from "@matchbase/data";
import {
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
  inTransaction,
  type ConnectionPool,
  type ConsultantWorkflowJob,
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
} from "./preparation-gateway.js";
import { executeDualLaneResearch } from "./dual-lane-orchestrator.js";
import { synthesizeConsultantOutputV3 } from "./synthesis-engine.js";
import { LivePreparationModelGateway } from "./live-preparation.js";
import { LiveResearchError } from "./openrouter-model-policy.js";

export type ConsultantExecutionMode = "live" | "demonstration" | "hybrid";
export interface ConsultantWorkflowProgress {
  phase: string;
  loop: number;
  max_loops: number;
  message: string;
  updated_at: string;
}

export interface ConsultantIntakeSubmission {
  readonly user_profile_id: string;
  readonly account_id: string;
  readonly product_requirement: string;
  readonly technical_compliance: string;
  readonly order_profile: string;
}

export interface WorkflowSession {
  readonly draft_id?: string;
  readonly draft_version?: number;
  readonly session_id: string;
  readonly run_id: string;
  readonly user_profile_id: string;
  readonly account_id: string;
  execution_id: string;
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
const activeSessions = new Map<string, WorkflowSession>();

function preparationGateway(
  mode: ConsultantExecutionMode,
  on_checkpoint?: (event: any) => Promise<void>,
) {
  return mode === "demonstration"
    ? new PreparationModelGateway()
    : new LivePreparationModelGateway(on_checkpoint ? { on_checkpoint } : {});
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
    restored.state === "progressive_reveal_ready" ||
    restored.state === "workflow_complete"
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
      mode: session.mode,
      classification_id: session.classification_id,
      step1_interpretation: session.step1_interpretation,
      advisory_version_id: session.advisory_version_id,
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
    run_id: record.run_id,
    user_profile_id: record.user_profile_id,
    account_id: record.account_id,
    execution_id: record.execution_id ?? crypto.randomUUID(),
    classification_id:
      classification?.classification_id ??
      String(metadata.classification_id ?? record.run_id),
    mode:
      (metadata.mode as ConsultantExecutionMode | undefined) ?? "demonstration",
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
  const { session_id, run_id } = initialRecord;
  const execution_id = initialRecord.execution_id!;
  const classification_id = String(
    initialRecord.workflow_metadata!.classification_id,
  );
  const revision_id = String(initialRecord.draft_revision!.revision_id);
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

  const session: WorkflowSession = {
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

  activeSessions.set(run_id, session);

  if (db) {
    await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
  }

  return session;
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
  options?: { defer_generation?: boolean },
): Promise<WorkflowSession> {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);

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
  if (options?.defer_generation) return session;
  return generateApprovedConsultantPreparation(runId, db);
}

/** Preparation uses only the immutable human-approved revision. */
export async function generateApprovedConsultantPreparation(
  runId: string,
  db?: Queryable,
  assertLease?: () => Promise<void>,
): Promise<WorkflowSession> {
  const session = activeSessions.get(runId);
  if (!session?.approved_request_revision || !session.classification)
    throw new Error("An approved request is required.");
  const approvedRevision = session.approved_request_revision;
  session.state = "prep_step2_advisory_generating";
  session.error = undefined;
  session.retry_action = "prepare";
  const checkpoint = createWorkflowCheckpoint(session, db, assertLease);
  await checkpoint({
    phase: "advisory",
    loop: 0,
    max_loops: 3,
    message: "Researching product and trade guidance.",
  });
  const gateway = preparationGateway(session.mode, checkpoint);
  const advisory = await gateway.generateAdvisoryLoops(
    approvedRevision,
    session.classification!,
  );
  session.advisory_version_id = crypto.randomUUID();
  session.step2_advisory = advisory;
  session.state = "prep_step3_prompt_synthesizing";
  if (db) await saveConsultantWorkflowSession(db, mapSessionToRecord(session));

  // Generate Step 3 prompt using the approved revision (F01: human edit propagates downstream!)
  const promptResult = await gateway.generateDeepResearchPrompt(
    approvedRevision,
    advisory,
    session.classification!,
  );
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
    await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
  }

  return session;
}

/**
 * Stage 3: Approve Step 3 Prompt.
 */
export async function approveDeepPromptStep(
  runId: string,
  editedPrompt?: string,
  db?: Queryable,
): Promise<WorkflowSession> {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);
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
  },
): Promise<ConsultantResearchOutputV3> {
  options?.signal?.throwIfAborted();
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);
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

  assertValidWorkflowTransition(session.state, "research_dispatching");
  session.state = "research_dispatching";
  session.error = undefined;
  session.retry_action = "research";
  const checkpoint = createWorkflowCheckpoint(
    session,
    db,
    options?.assertLease,
  );
  await checkpoint({
    phase: "discovery",
    loop: 0,
    max_loops: 15,
    message: "Searching Gemini and OpenAI in parallel.",
  });

  // Dispatch Dual Lane Research
  session.state = "lane_gemini_running";
  const dualResult = await executeDualLaneResearch(
    {
      product_requirement: session.intake.product_requirement,
      technical_compliance: session.intake.technical_compliance,
      order_profile: session.intake.order_profile,
      deep_prompt: session.step3_deep_prompt?.prompt_text ?? "",
      mandatory_requirements: session.step3_deep_prompt.discovery_criteria
        .length
        ? session.step3_deep_prompt.discovery_criteria
        : session.approved_request_revision.key_specifications,
      target_supplier_count: 20,
    },
    {
      mode,
      on_checkpoint: checkpoint,
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
  options?.signal?.throwIfAborted();

  session.state = "lanes_converged";
  session.state = "verification_loop_running";
  session.state = "synthesis_running";

  // Synthesize V3 output
  const output = synthesizeConsultantOutputV3({
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
    max_loops: 15,
    message: `${output.supplier_candidates.length} supplier dossiers saved.`,
    updated_at: new Date().toISOString(),
  };

  // Persist the complete output and all suppliers atomically, independent of reveal pagination.
  const persist = async (client: Queryable) => {
    await saveConsultantOutputV3(client, {
      account_id: session.account_id,
      output,
    });
    await saveConsultantWorkflowSession(client, mapSessionToRecord(session));
  };
  if ("connect" in db) await inTransaction(db as ConnectionPool, persist);
  else await persist(db);

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
) {
  let pending = Promise.resolve();
  return (event: any): Promise<void> => {
    pending = pending.then(async () => {
      if (assertLease) await assertLease();
      const phase = String(event.phase ?? event.stage ?? "research");
      const loop = Number(event.loop ?? event.loop_number ?? 0);
      session.progress = {
        phase,
        loop,
        max_loops: Number(
          event.max_loops ?? (phase.includes("advisory") ? 3 : 15),
        ),
        message: String(event.message ?? "Research in progress."),
        updated_at: new Date().toISOString(),
      };
      if (phase.includes("verification"))
        session.state = "verification_loop_running";
      if (phase.includes("synthesis") && !phase.includes("prompt"))
        session.state = "synthesis_running";
      session.last_checkpoint = `${phase}:${loop}`;
      if (db) {
        await appendConsultantWorkflowEvent(db, session, phase, event);
        await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
      }
    });
    return pending;
  };
}

export async function queueConsultantWorkflowStep(
  db: Queryable,
  runId: string,
  stage: "prepare" | "research",
  retry = false,
): Promise<ConsultantWorkflowJob> {
  const session = activeSessions.get(runId);
  if (!session?.approved_request_revision)
    throw new Error("An approved request is required.");
  if (retry) {
    if (session.state !== "workflow_failed" || session.retry_action !== stage)
      throw new Error("This workflow cannot be retried at that stage.");
    session.execution_id = crypto.randomUUID();
    session.error = undefined;
  }
  if (stage === "research" && !session.step3_deep_prompt?.is_approved)
    throw new Error("An approved research prompt is required.");
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
): Promise<void> {
  const session = activeSessions.get(runId);
  if (!session) return;
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
  await appendConsultantWorkflowEvent(db, session, "failed", { stage, code });
  await saveConsultantWorkflowSession(db, mapSessionToRecord(session));
}
