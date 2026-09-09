export type ConsultantWorkflowState =
  | "intake_draft"
  | "intake_submitted"
  | "prep_step1_interpreting"
  | "prep_step1_awaiting_approval"
  | "prep_step1_approved"
  | "prep_step2_advisory_generating"
  | "prep_step2_advisory_ready"
  | "prep_step3_prompt_synthesizing"
  | "prep_step3_prompt_awaiting_approval"
  | "prep_step3_prompt_approved"
  | "research_dispatching"
  | "lane_gemini_running"
  | "lane_openai_running"
  | "lanes_converged"
  | "verification_loop_running"
  | "synthesis_running"
  | "progressive_reveal_ready"
  | "pdf_generating"
  | "workflow_complete"
  | "workflow_failed"
  | "invalidated";

export const CONSULTANT_WORKFLOW_STATES: readonly ConsultantWorkflowState[] = [
  "intake_draft",
  "intake_submitted",
  "invalidated",
  "prep_step1_interpreting",
  "prep_step1_awaiting_approval",
  "prep_step1_approved",
  "prep_step2_advisory_generating",
  "prep_step2_advisory_ready",
  "prep_step3_prompt_synthesizing",
  "prep_step3_prompt_awaiting_approval",
  "prep_step3_prompt_approved",
  "research_dispatching",
  "lane_gemini_running",
  "lane_openai_running",
  "lanes_converged",
  "verification_loop_running",
  "synthesis_running",
  "progressive_reveal_ready",
  "pdf_generating",
  "workflow_complete",
  "workflow_failed",
] as const;

export const VALID_WORKFLOW_TRANSITIONS: Readonly<
  Record<ConsultantWorkflowState, readonly ConsultantWorkflowState[]>
> = {
  intake_draft: ["intake_submitted", "workflow_failed"],
  intake_submitted: ["prep_step1_interpreting", "workflow_failed"],
  prep_step1_interpreting: ["prep_step1_awaiting_approval", "workflow_failed"],
  prep_step1_awaiting_approval: [
    "prep_step1_approved",
    "prep_step1_interpreting",
    "workflow_failed",
  ],
  prep_step1_approved: ["prep_step2_advisory_generating", "workflow_failed"],
  prep_step2_advisory_generating: [
    "prep_step2_advisory_ready",
    "workflow_failed",
  ],
  prep_step2_advisory_ready: [
    "prep_step3_prompt_synthesizing",
    "workflow_failed",
  ],
  prep_step3_prompt_synthesizing: [
    "prep_step3_prompt_awaiting_approval",
    "workflow_failed",
  ],
  prep_step3_prompt_awaiting_approval: [
    "prep_step3_prompt_approved",
    "prep_step3_prompt_synthesizing",
    "workflow_failed",
  ],
  prep_step3_prompt_approved: ["research_dispatching", "workflow_failed"],
  research_dispatching: [
    "lane_gemini_running",
    "lane_openai_running",
    "lanes_converged",
    "workflow_failed",
  ],
  lane_gemini_running: [
    "lane_openai_running",
    "lanes_converged",
    "workflow_failed",
  ],
  lane_openai_running: ["lanes_converged", "workflow_failed"],
  lanes_converged: ["verification_loop_running", "workflow_failed"],
  verification_loop_running: ["synthesis_running", "workflow_failed"],
  synthesis_running: [
    "progressive_reveal_ready",
    "pdf_generating",
    "workflow_complete",
    "workflow_failed",
  ],
  progressive_reveal_ready: [
    "pdf_generating",
    "workflow_complete",
    "workflow_failed",
  ],
  pdf_generating: ["workflow_complete", "workflow_failed"],
  workflow_complete: ["intake_draft", "invalidated"],
  workflow_failed: ["intake_draft", "research_dispatching", "invalidated"],
  invalidated: [],
};

export function canTransitionWorkflowState(
  from: ConsultantWorkflowState,
  to: ConsultantWorkflowState,
): boolean {
  if (from === to) return true;
  const allowed = VALID_WORKFLOW_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidWorkflowTransition(
  from: ConsultantWorkflowState,
  to: ConsultantWorkflowState,
): void {
  if (!canTransitionWorkflowState(from, to)) {
    throw new Error(
      `Invalid Consultant workflow transition from state '${from}' to '${to}'.`,
    );
  }
}
