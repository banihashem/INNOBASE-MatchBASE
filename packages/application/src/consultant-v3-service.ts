import crypto from "node:crypto";
import type { Queryable } from "@matchbase/data";
import {
  saveConsultantOutputV3,
  saveConsultantWorkflowSession,
  getConsultantWorkflowSessionByRunId,
  getConsultantOutputV3ByRunId,
  type ConsultantWorkflowSessionRecord,
} from "@matchbase/data";
import type {
  ConsultantResearchOutputV3,
  ProductClassificationRecord,
} from "@matchbase/contracts";
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

export interface ConsultantIntakeSubmission {
  readonly user_profile_id: string;
  readonly account_id: string;
  readonly product_requirement: string;
  readonly technical_compliance: string;
  readonly order_profile: string;
}

export interface WorkflowSession {
  readonly session_id: string;
  readonly run_id: string;
  readonly user_profile_id: string;
  readonly account_id: string;
  readonly execution_id: string;
  readonly classification_id: string;
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
  error?: string;
  last_checkpoint?: string;
}

// In-memory active workflow session registry (keyed by run_id)
const activeSessions = new Map<string, WorkflowSession>();

const gateway = new PreparationModelGateway();

export function getWorkflowSession(runId: string): WorkflowSession | null {
  return activeSessions.get(runId) ?? null;
}

export async function getOrRestoreWorkflowSession(
  db: Queryable,
  accountId: string,
  runId: string,
): Promise<WorkflowSession | null> {
  const existing = activeSessions.get(runId);
  if (existing) return existing;

  const dbRow = await getConsultantWorkflowSessionByRunId(db, accountId, runId);
  if (!dbRow) return null;

  const restored = mapRecordToSession(dbRow);
  if (
    restored.state === "progressive_reveal_ready" ||
    restored.state === "workflow_complete"
  ) {
    const dbOutput = await getConsultantOutputV3ByRunId(db, accountId, runId);
    if (dbOutput) {
      restored.output = dbOutput;
      restored.revealed_count = dbOutput.supplier_candidates.length;
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

  return {
    session_id: record.session_id,
    run_id: record.run_id,
    user_profile_id: record.user_profile_id,
    account_id: record.account_id,
    execution_id: record.execution_id ?? crypto.randomUUID(),
    classification_id: classification?.classification_id ?? crypto.randomUUID(),
    state: record.current_state as ConsultantWorkflowState,
    intake,
    request_revision_id: draft.revision_id,
    draft_revision: draft,
    approved_request_revision: approvedReq,
    step1_interpretation: {
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
    advisory_version_id: advisory ? crypto.randomUUID() : null,
    step2_advisory: advisory,
    research_prompt_version_id: prompt ? crypto.randomUUID() : null,
    step3_deep_prompt: prompt,
    approvals: (record.approvals as any) ?? [],
    revealed_count: 5,
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
): Promise<WorkflowSession> {
  const session_id = crypto.randomUUID();
  const run_id = crypto.randomUUID();
  const execution_id = crypto.randomUUID();
  const revision_id = crypto.randomUUID();

  // Run Step 1 interpretation through PreparationModelGateway
  const step1 = await gateway.extractAndInterpret({
    product_requirement: submission.product_requirement,
    technical_compliance: submission.technical_compliance,
    order_profile: submission.order_profile,
  });

  const session: WorkflowSession = {
    session_id,
    run_id,
    user_profile_id: submission.user_profile_id,
    account_id: submission.account_id,
    execution_id,
    classification_id: step1.classification.classification_id,
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

/**
 * Stage 2: Approve Step 1 Interpretation.
 * Accepts human edits, creates approved request revision, and triggers Stage 2 Advisory generation.
 */
export async function approveInterpretationStep(
  runId: string,
  editedTranslation?: string,
  db?: Queryable,
): Promise<WorkflowSession> {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);

  assertValidWorkflowTransition(session.state, "prep_step1_approved");

  const effectiveTranslation =
    editedTranslation && editedTranslation.trim().length > 0
      ? editedTranslation.trim()
      : session.step1_interpretation.english_translation;

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

  // Transition to Step 2 advisory ready and generate 3 loops based on the approved revision
  session.state = "prep_step2_advisory_ready";
  const advisory = await gateway.generateAdvisoryLoops(
    approvedRevision,
    session.classification!,
  );
  session.advisory_version_id = crypto.randomUUID();
  session.step2_advisory = advisory;

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

  session.last_checkpoint = "prep_step2_advisory_ready";

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
  options?: { mode?: "live" | "demonstration" | "hybrid" },
): Promise<ConsultantResearchOutputV3> {
  const session = activeSessions.get(runId);
  if (!session) throw new Error(`Workflow session ${runId} not found.`);

  assertValidWorkflowTransition(session.state, "research_dispatching");
  session.state = "research_dispatching";

  // Dispatch Dual Lane Research
  session.state = "lane_gemini_running";
  const dualResult = await executeDualLaneResearch(
    {
      product_requirement: session.intake.product_requirement,
      technical_compliance: session.intake.technical_compliance,
      order_profile: session.intake.order_profile,
      deep_prompt: session.step3_deep_prompt?.prompt_text ?? "",
    },
    { mode: options?.mode ?? "demonstration" },
  );

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
  });

  // Persist to PostgreSQL database (consultant_output_v3 + supplier entities)
  await saveConsultantOutputV3(db, {
    account_id: session.account_id,
    output,
  });

  session.output = output;
  session.revealed_count = 5; // Progressive reveal: top 5 revealed first
  session.state = "progressive_reveal_ready";
  session.last_checkpoint = "progressive_reveal_ready";

  // Persist completed session
  await saveConsultantWorkflowSession(db, mapSessionToRecord(session));

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
  const total = session.output?.supplier_candidates.length ?? 20;
  session.revealed_count = Math.min(session.revealed_count + increment, total);
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
