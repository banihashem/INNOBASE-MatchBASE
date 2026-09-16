import type { ResearchRoundPlan } from "@matchbase/contracts";
import type { Queryable, ResearchRoundRecord } from "@matchbase/data";
import type { WorkflowSession } from "./consultant-v3-service.js";
import {
  buildFocusedResearchInstructions,
  type DualLaneExecutionInput,
} from "./dual-lane-orchestrator.js";
import {
  buildFocusedWebContext,
  buildResearchFocusContext,
} from "./research-focus-planner.js";
import { hydrateResearchContinuation } from "./research-review.js";
import { LiveResearchError } from "./openrouter-model-policy.js";
import { ApplicationFault } from "./types.js";

/** The quote and worker must measure the same immutable buyer input. */
export function consultantResearchInput(
  session: WorkflowSession,
): DualLaneExecutionInput {
  if (
    !session.approved_request_revision ||
    !session.step3_deep_prompt?.is_approved
  )
    throw new ApplicationFault(
      409,
      "approval-required",
      "MB-409-APPROVAL-REQUIRED",
      "Approve the request and research prompt before starting research.",
    );
  return {
    product_requirement: session.intake.product_requirement,
    technical_compliance: session.intake.technical_compliance,
    order_profile: session.intake.order_profile,
    deep_prompt: session.step3_deep_prompt.prompt_text,
    mandatory_requirements: session.step3_deep_prompt.discovery_criteria.length
      ? session.step3_deep_prompt.discovery_criteria
      : session.approved_request_revision.key_specifications,
    target_supplier_count: 20,
  };
}

/** Read-only capacity qualification before a follow-up quote becomes approvable. */
export async function preflightResearchRoundContext(
  db: Queryable,
  session: WorkflowSession,
  plan: ResearchRoundPlan,
  parent: ResearchRoundRecord | undefined,
  memoryContext?: DualLaneExecutionInput["private_memory_context"],
): Promise<void> {
  if (session.mode === "demonstration" || !plan.focus_analysis_required) return;
  if (
    !parent ||
    parent.status !== "completed" ||
    parent.round_id !== plan.parent_round_id ||
    parent.round_number + 1 !== plan.round_number ||
    parent.account_id !== session.account_id ||
    parent.user_profile_id !== session.user_profile_id ||
    parent.run_id !== session.run_id ||
    parent.classification_id !== session.classification_id
  )
    throw new ApplicationFault(
      409,
      "focus-parent-required",
      "MB-409-FOCUS-STALE",
      "Review the latest completed research before requesting a new estimate.",
    );
  const input = {
    ...consultantResearchInput(session),
    ...(memoryContext ? { private_memory_context: memoryContext } : {}),
  };
  const prior = await hydrateResearchContinuation(db, parent);
  const known = new Set(
    (prior.indexed_leads ?? []).map((lead) => lead.lead_id),
  );
  if (plan.follow_up?.lead_ids.some((id) => !known.has(id)))
    throw new ApplicationFault(
      409,
      "focus-selection-stale",
      "MB-409-FOCUS-STALE",
      "Select research leads from the latest completed round before requesting an estimate.",
    );
  try {
    buildFocusedWebContext(
      input,
      plan,
      prior,
      undefined,
      buildFocusedResearchInstructions(plan),
    );
    buildResearchFocusContext(input, plan, prior);
  } catch (error) {
    if (
      !(error instanceof LiveResearchError) ||
      error.code !== "MB-409-FOCUS-CONTEXT"
    )
      throw error;
    throw new ApplicationFault(
      409,
      "focus-context-capacity",
      "MB-409-FOCUS-CONTEXT",
      "The saved research cannot yet fit this round's processing allowance. No estimate or research has been started. Your existing findings are retained; this capacity issue requires a system adjustment, not a rewrite of your request.",
    );
  }
}
