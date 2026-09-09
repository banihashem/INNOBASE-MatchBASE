import { useEffect, useState } from "react";

export type WorkflowStage = 1 | 2 | 3;

export function useWorkflowStage(
  runId: string | null,
  researchAvailable: boolean,
) {
  const [selection, setSelection] = useState<{
    runId: string | null;
    researchAvailable: boolean;
    stage: WorkflowStage;
  }>({
    runId,
    researchAvailable,
    stage: !runId ? 1 : researchAvailable ? 3 : 2,
  });
  const defaultStage = !runId ? 1 : researchAvailable ? 3 : 2;
  const stage =
    selection.runId === runId &&
    selection.researchAvailable === researchAvailable
      ? selection.stage
      : defaultStage;
  useEffect(() => {
    const next = !runId ? 1 : researchAvailable ? 3 : 2;
    document.getElementById(`workflow-tab-${next}`)?.focus();
  }, [runId, researchAvailable]);
  const setStage = (next: WorkflowStage) =>
    setSelection({ runId, researchAvailable, stage: next });
  return { stage, setStage };
}

export function WorkflowStageTabs({
  stage,
  onChange,
  submitted,
  researchAvailable,
}: {
  stage: WorkflowStage;
  onChange: (stage: WorkflowStage) => void;
  submitted: boolean;
  researchAvailable: boolean;
}) {
  const tabs = [
    { stage: 1, label: "Your request", enabled: true },
    { stage: 2, label: "Review & prepare", enabled: submitted },
    {
      stage: 3,
      label: "Research & results",
      enabled: researchAvailable,
    },
  ] as const;
  return (
    <div
      role="tablist"
      aria-label="Consultant workflow sections"
      className="workflow-stage-tabs"
    >
      {tabs.map((tab) => (
        <button
          key={tab.stage}
          id={`workflow-tab-${tab.stage}`}
          type="button"
          role="tab"
          aria-selected={stage === tab.stage}
          aria-controls={`workflow-panel-${tab.stage}`}
          disabled={!tab.enabled}
          title={
            !tab.enabled
              ? tab.stage === 2
                ? "Submit your request first."
                : "Approve the research plan first."
              : undefined
          }
          tabIndex={stage === tab.stage ? 0 : -1}
          onClick={() => onChange(tab.stage)}
          onKeyDown={(event) => {
            const available = tabs.filter((entry) => entry.enabled);
            const current = available.findIndex(
              (entry) => entry.stage === tab.stage,
            );
            let target;
            if (event.key === "ArrowRight")
              target = available[(current + 1) % available.length];
            else if (event.key === "ArrowLeft")
              target =
                available[(current - 1 + available.length) % available.length];
            else if (event.key === "Home") target = available[0];
            else if (event.key === "End")
              target = available[available.length - 1];
            if (!target) return;
            event.preventDefault();
            onChange(target.stage);
            document.getElementById(`workflow-tab-${target.stage}`)?.focus();
          }}
          className={`rounded-lg border px-4 py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${stage === tab.stage ? "border-sky-500 bg-sky-900 text-white" : "border-slate-700 bg-slate-900 text-slate-300"}`}
        >
          <span className="workflow-stage-number" aria-hidden="true">
            {tab.stage}
          </span>
          {tab.label}
          {tab.stage === 1 && submitted && (
            <span className="ml-2 text-xs">Saved</span>
          )}
        </button>
      ))}
    </div>
  );
}
