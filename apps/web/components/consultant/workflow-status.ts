// MB-UX-LIVE-001 L07: labels describe persisted work, never elapsed-time estimates.
export interface ActivityStep {
  phase: string;
  loop: number;
  started: number;
  completed: number;
  failed: number;
  updated_at: string;
}
export interface WorkflowProgress {
  phase?: string;
  loop?: number;
  max_loops?: number;
  message?: string;
  updated_at?: string;
}
export const resultReady = (state: string) =>
  ["progressive_reveal_ready", "workflow_complete"].includes(state);
export function workflowLabel(state: string, stoppedByUser = false): string {
  if (resultReady(state)) return "Results ready";
  if (state === "workflow_failed")
    return stoppedByUser ? "Stopped by you" : "Stopped · review required";
  if (state === "invalidated") return "Unavailable";
  if (state === "intake_draft") return "Draft";
  if (state === "prep_step1_awaiting_approval")
    return "Review English interpretation";
  if (state === "prep_step3_prompt_awaiting_approval")
    return "Review research plan";
  if (state === "prep_step3_prompt_approved") return "Review research cost";
  if (state.startsWith("prep_")) return "Preparing your request";
  if (state === "synthesis_running") return "Combining supplier findings";
  if (state === "verification_loop_running") return "Verifying suppliers";
  if (state === "pdf_generating") return "Preparing PDF";
  return "Research in progress";
}
export function phaseLabel(phase: string, loop = 0): string {
  if (phase === "user_cancelled") return "Stopped by you";
  const lane = phase.includes("gemini")
    ? "Gemini"
    : phase.includes("openai")
      ? "OpenAI"
      : phase.includes("selected")
        ? "Selected model"
        : "";
  const scope = phase.startsWith("verification")
    ? `Verification round ${loop}`
    : lane;
  if (phase.endsWith("extraction_recovery"))
    return `${scope} · Recovering supplier details`;
  if (phase.endsWith("extraction_index"))
    return `${scope} · Organizing discovered suppliers`;
  if (phase.endsWith("extraction_batch"))
    return `${scope} · Extracting supplier details`;
  if (phase.startsWith("discovery"))
    return lane
      ? `${lane} · Searching for suppliers`
      : "Searching for suppliers";
  if (phase === "verification")
    return `Verification round ${loop} · Checking evidence and gaps`;
  if (phase === "source_retrieval")
    return "Reading supplier websites and supporting sources";
  if (phase.includes("advisory"))
    return `Advisory research · Round ${loop} of 3`;
  if (phase.includes("prompt")) return "Preparing your editable research plan";
  if (phase === "step1_translation" || phase.includes("interpret"))
    return "Interpreting and structuring your request in English";
  if (phase.includes("synthesis"))
    return "Combining evidence and ranking suppliers";
  if (phase === "queued") return "Request saved · Waiting for a worker";
  if (phase === "failed") return "Research stopped";
  if (phase === "preparation")
    return "Preparing advisory research and your research plan";
  if (phase.includes("complete") || phase === "progressive_reveal_ready")
    return "Results saved";
  return "Processing your request";
}
