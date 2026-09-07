import { useEffect, useRef } from "react";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";
import { errorMessage } from "./workflow-response";

interface WorkflowPollingOptions {
  runId: string | null;
  workflowState: string;
  output: ConsultantResearchOutputV3 | null;
  acceptProgress: (session: any) => void;
  setOutput: (output: ConsultantResearchOutputV3) => void;
  setRevealedCount: (count: number) => void;
  setWorkflowError: (message: string) => void;
}

export function useWorkflowPolling({
  runId,
  workflowState,
  output,
  ...handlers
}: WorkflowPollingOptions) {
  const callbacks = useRef(handlers);
  callbacks.current = handlers;
  useEffect(() => {
    if (
      !runId ||
      output ||
      workflowState === "workflow_failed" ||
      workflowState === "invalidated" ||
      workflowState === "workflow_complete" ||
      workflowState === "progressive_reveal_ready" ||
      workflowState === "intake_draft" ||
      workflowState === "prep_step1_awaiting_approval" ||
      workflowState === "prep_step3_prompt_awaiting_approval" ||
      workflowState === "prep_step3_prompt_approved" ||
      workflowState === "prep_step2_advisory_ready"
    )
      return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(
          `/api/v1/consultant/workflow?run_id=${encodeURIComponent(runId!)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok)
          throw new Error(
            errorMessage(data, "Could not refresh workflow progress."),
          );
        if (data.session) callbacks.current.acceptProgress(data.session);
        const result = data.output ?? data.session?.output;
        if (result) {
          callbacks.current.setOutput(result);
          callbacks.current.setRevealedCount(data.session?.revealed_count ?? 5);
          return;
        }
      } catch (error: any) {
        if (!controller.signal.aborted)
          callbacks.current.setWorkflowError(error.message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, workflowState, output]);
}
