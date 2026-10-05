import { workflowMutationHeaders } from "./workflow-request";
import { useEffect, useRef, useState } from "react";
import { useWorkflowSession } from "./WorkflowSessionRecovery";

interface Step1FidelityOptions {
  workflowState: string;
  step1Translation: string;
  productRequirement: string;
  technicalCompliance: string;
  orderProfile: string;
  setWorkflowError: (message: string) => void;
}

export function useStep1Fidelity({
  workflowState,
  step1Translation,
  productRequirement,
  technicalCompliance,
  orderProfile,
  setWorkflowError,
}: Step1FidelityOptions) {
  const { automaticRequest: fetch, automaticWorkPaused } = useWorkflowSession();
  const [step1Fidelity, setStep1Fidelity] = useState<any>(null);
  const [isFidelityValidating, setIsFidelityValidating] = useState(false);
  const [validationRetry, setValidationRetry] = useState(0);
  const validationSequenceRef = useRef(0);
  const revalidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Dynamic Step 1 requirement fidelity revalidation on human edits
  useEffect(() => {
    // Editable content needs a current result even while paused. Read-only
    // approved interpretations retain their persisted fidelity evidence.
    if (workflowState === "prep_step1_awaiting_approval")
      setStep1Fidelity(null);
    const sequence = ++validationSequenceRef.current;
    if (
      automaticWorkPaused ||
      workflowState !== "prep_step1_awaiting_approval" ||
      !step1Translation
    ) {
      setIsFidelityValidating(false);
      return;
    }
    const controller = new AbortController();
    setIsFidelityValidating(true);
    if (revalidateTimeoutRef.current) {
      clearTimeout(revalidateTimeoutRef.current);
    }
    revalidateTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/v1/consultant/workflow", {
          method: "POST",
          signal: controller.signal,
          headers: workflowMutationHeaders(),
          body: JSON.stringify({
            action: "validate_step1_fidelity",
            intake: {
              product_requirement: productRequirement,
              technical_compliance: technicalCompliance,
              order_profile: orderProfile,
            },
            translation: step1Translation,
          }),
        });
        if (!res.ok)
          throw new Error(
            "Interpretation validation could not complete. Retry before approving.",
          );
        if (
          res.ok &&
          sequence === validationSequenceRef.current &&
          !controller.signal.aborted
        ) {
          const d = await res.json();
          if (
            d.success &&
            d.fidelity &&
            sequence === validationSequenceRef.current
          ) {
            setStep1Fidelity(d.fidelity);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setWorkflowError(
            err instanceof Error
              ? err.message
              : "Interpretation validation failed.",
          );
      } finally {
        if (
          sequence === validationSequenceRef.current &&
          !controller.signal.aborted
        )
          setIsFidelityValidating(false);
      }
    }, 400);

    return () => {
      controller.abort();
      if (revalidateTimeoutRef.current) {
        clearTimeout(revalidateTimeoutRef.current);
      }
    };
  }, [
    step1Translation,
    workflowState,
    productRequirement,
    technicalCompliance,
    orderProfile,
    validationRetry,
    automaticWorkPaused,
  ]);

  return {
    step1Fidelity,
    setStep1Fidelity,
    isFidelityValidating,
    setIsFidelityValidating,
    setValidationRetry,
  };
}
