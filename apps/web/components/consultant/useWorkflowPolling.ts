import { useEffect, useRef } from "react";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";
import { errorMessage } from "./workflow-response";
import { resultReady } from "./workflow-status";

interface WorkflowPollingOptions {
  runId: string | null;
  workflowState: string;
  acceptProgress: (session: any) => void;
  setOutput: (output: ConsultantResearchOutputV3) => void;
  setRevealedCount: (count: number) => void;
  setConnectionError: (message: string | null) => void;
}

export function useWorkflowPolling({
  runId,
  workflowState,
  ...handlers
}: WorkflowPollingOptions) {
  const callbacks = useRef(handlers);
  callbacks.current = handlers;
  useEffect(() => {
    if (
      !runId ||
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
        callbacks.current.setConnectionError(null);
        if (data.session) callbacks.current.acceptProgress(data.session);
        const result = data.output ?? data.session?.output;
        const state = data.session?.state ?? data.state;
        if (
          result &&
          resultReady(state) &&
          (!data.session?.execution_id ||
            result.execution_id === data.session.execution_id)
        ) {
          callbacks.current.setOutput(result);
          callbacks.current.setRevealedCount(data.session?.revealed_count ?? 5);
          return;
        }
        if (
          state === "workflow_failed" ||
          state === "invalidated" ||
          resultReady(state)
        )
          return;
      } catch (error: any) {
        if (!controller.signal.aborted)
          callbacks.current.setConnectionError(error.message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, workflowState]);
}
