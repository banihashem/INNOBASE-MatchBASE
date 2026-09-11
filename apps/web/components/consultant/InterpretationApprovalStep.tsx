import { InterpretationCorrectionPanel } from "./InterpretationCorrectionPanel";
import { PreparationRecoveryNotice } from "./PreparationRecoveryNotice";

interface InterpretationApprovalStepProps {
  runId?: string | null;
  workflowState: string;
  isLoading: boolean;
  step1Translation: string;
  step1Fidelity: any;
  isFidelityValidating: boolean;
  showFullLedger: boolean;
  setShowFullLedger: (value: boolean) => void;
  onTranslationChange: (value: string) => void;
  onRetryValidation: () => void;
  handleApproveStep1: () => Promise<void>;
}

function evaluatedStatus(requirement: any, result: any): string {
  const id = requirement.requirement_id;
  if (typeof id === "string") {
    if (
      result.mutated_items?.some(
        (item: any) => item.requirement?.requirement_id === id,
      )
    )
      return "mutated";
    if (result.omitted_items?.some((item: any) => item.requirement_id === id))
      return "omitted";
  }
  return requirement.fidelity_status ?? "Not assessed";
}

export function InterpretationApprovalStep({
  runId,
  workflowState,
  isLoading,
  step1Translation,
  step1Fidelity,
  isFidelityValidating,
  showFullLedger,
  setShowFullLedger,
  onTranslationChange,
  onRetryValidation,
  handleApproveStep1,
}: InterpretationApprovalStepProps) {
  return (
    <div className="bg-slate-900/80 p-5 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="bg-sky-900/80 text-sky-300 text-xs font-bold px-2 py-0.5 rounded border border-sky-700">
            Step 1
          </span>
          <h3 className="font-bold text-white text-sm">
            Check your English interpretation
          </h3>
        </div>
      </div>

      <p className="text-xs text-slate-300 mb-2">
        Check that this English version preserves your original requirements.
        Edit it as needed; the approved version will guide the advisory brief
        and supplier research.
      </p>

      <textarea
        id="step1-translation-input"
        aria-label="Editable English Interpretation"
        disabled={isLoading || workflowState !== "prep_step1_awaiting_approval"}
        rows={8}
        value={step1Translation}
        onChange={(e) => onTranslationChange(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 mb-3 focus:ring-2 focus:ring-sky-500"
      />

      <p className="mb-3 text-xs text-slate-300">
        Automated checks cover detected requirements. Review the full English
        interpretation against your original request; a passed check does not
        establish that every requested detail was detected.
      </p>

      {/* Step 1 Explicit Requirement Fidelity Review (N02 & Phase D) */}
      {isFidelityValidating && (
        <p role="status" className="text-xs text-sky-300 my-2">
          Checking the current interpretation against your submitted
          requirements...
        </p>
      )}
      {workflowState === "prep_step1_awaiting_approval" &&
        !isFidelityValidating &&
        !step1Fidelity && (
          <button
            type="button"
            onClick={onRetryValidation}
            className="my-2 px-3 py-2 bg-sky-800 rounded text-xs text-white"
          >
            Retry interpretation check
          </button>
        )}
      {step1Fidelity && !isFidelityValidating && (
        <div className="space-y-3 mb-3">
          {/* Fidelity Failure Gating Warning Banner */}
          {!step1Fidelity.valid && (
            <div
              role="alert"
              className="bg-rose-950/70 border-2 border-rose-500 rounded-lg p-3 text-xs space-y-2 text-rose-200 animate-in fade-in"
            >
              <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                <span className="text-lg" aria-hidden="true">
                  🚫
                </span>
                <span>Review these requirements before continuing</span>
              </div>
              <p className="text-slate-300 text-[11px]">
                The automated check could not match every detected requirement
                to the English wording. Review the flagged items below, request
                a suggested correction, or edit the text yourself. Final
                approval becomes available after the current text passes the
                check.
              </p>

              {/* Mutated Items Details */}
              {Array.isArray(step1Fidelity.mutated_items) &&
                step1Fidelity.mutated_items.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    <div className="font-semibold text-rose-300 text-[11px] uppercase tracking-wider">
                      Requirements with changed meaning (
                      {step1Fidelity.mutated_count}):
                    </div>
                    {step1Fidelity.mutated_items.map(
                      (item: any, idx: number) => (
                        <div
                          key={idx}
                          className="bg-rose-900/40 border border-rose-700/60 p-2 rounded text-[11px]"
                        >
                          <div className="font-bold text-rose-200">
                            ⚠️{" "}
                            {item.requirement?.label ||
                              item.requirement?.normalized_label ||
                              item.requirement?.concept}
                            : {item.explanation}
                          </div>
                          <div className="text-slate-300 text-[10px] mt-0.5">
                            <strong>Your original wording:</strong> "
                            {item.requirement?.source_span_or_reference ||
                              item.requirement?.source_text}
                            "
                          </div>
                          {item.prohibited_value && (
                            <div className="text-rose-400 text-[10px]">
                              <strong>Wording to review:</strong> "
                              {item.prohibited_value}"
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                )}

              {/* Omitted Items Details */}
              {Array.isArray(step1Fidelity.omitted_items) &&
                step1Fidelity.omitted_items.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    <div className="font-semibold text-amber-300 text-[11px] uppercase tracking-wider">
                      Requirements not found in the interpretation (
                      {step1Fidelity.omitted_count}):
                    </div>
                    {step1Fidelity.omitted_items.map(
                      (item: any, idx: number) => (
                        <div
                          key={idx}
                          className="bg-amber-900/30 border border-amber-700/50 p-2 rounded text-[11px]"
                        >
                          <div className="font-bold text-amber-200">
                            Missing:{" "}
                            {item.label ||
                              item.normalized_label ||
                              String(item.concept ?? "Requirement").replaceAll(
                                "_",
                                " ",
                              )}
                          </div>
                          <div className="text-slate-300 text-[10px] mt-0.5">
                            <strong>Your original wording:</strong> "
                            {item.source_span_or_reference || item.source_text}"
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
            </div>
          )}

          {/* Fidelity Status Header & Metrics Summary */}
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-xs space-y-2">
            <div className="flex items-center justify-between">
              {step1Fidelity.valid ? (
                <span className="font-semibold text-emerald-400 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Checked Requirements Passed ({" "}
                  {step1Fidelity.ledger?.total_explicit_count ??
                    step1Fidelity.preserved_count}{" "}
                  detected requirements)
                </span>
              ) : (
                <span className="font-semibold text-rose-400 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
                  Requirements need review ({step1Fidelity.mutated_count ?? 0}{" "}
                  changed &bull; {step1Fidelity.omitted_count ?? 0} missing)
                </span>
              )}
              <span className="text-[10px] text-slate-400">
                Changed: {step1Fidelity.mutated_count ?? 0} &bull; Missing:{" "}
                {step1Fidelity.omitted_count ?? 0}
              </span>
            </div>

            {/* Progressive Disclosure Toggle */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowFullLedger(!showFullLedger)}
                aria-expanded={showFullLedger}
                aria-controls="interpretation-requirement-checks"
                className="text-sky-400 hover:text-sky-300 text-[11px] underline font-medium"
              >
                {showFullLedger
                  ? "Hide requirement checks"
                  : `View requirement checks (${step1Fidelity.ledger?.requirements?.length ?? 0} clauses)`}
              </button>

              {showFullLedger && step1Fidelity.ledger?.requirements && (
                <div
                  id="interpretation-requirement-checks"
                  className="max-h-60 overflow-auto mt-2 border border-slate-800 rounded bg-slate-900/90 text-[10px]"
                >
                  <table className="w-full text-left">
                    <thead className="bg-slate-800/80 text-slate-300 sticky top-0">
                      <tr>
                        <th className="p-1.5">Requirement</th>
                        <th className="p-1.5">Original wording</th>
                        <th className="p-1.5">Interpreted requirement</th>
                        <th className="p-1.5">Operator</th>
                        <th className="p-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {step1Fidelity.ledger.requirements.map(
                        (r: any, idx: number) => {
                          const status = evaluatedStatus(r, step1Fidelity);
                          return (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="p-1.5 font-semibold text-slate-200">
                                {r.label || r.normalized_label || r.concept}
                              </td>
                              <td className="p-1.5 text-slate-400 italic">
                                "{r.source_span_or_reference || r.source_text}"
                              </td>
                              <td className="p-1.5 text-slate-300">
                                {r.normalized_value}
                              </td>
                              <td className="p-1.5 font-mono text-amber-300 font-semibold">
                                {r.comparison_operator || "—"}
                              </td>
                              <td className="p-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                    status === "preserved" ||
                                    status === "normalized_equivalent"
                                      ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                      : status === "mutated" ||
                                          status === "omitted"
                                        ? "bg-rose-950 text-rose-300 border border-rose-800"
                                        : "bg-slate-800 text-slate-300"
                                  }`}
                                >
                                  {status === "mutated"
                                    ? "Changed"
                                    : status === "omitted"
                                      ? "Missing"
                                      : status === "preserved"
                                        ? "Preserved"
                                        : status === "normalized_equivalent"
                                          ? "Same meaning"
                                          : status.replaceAll("_", " ")}
                                </span>
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Model Suggestions (Kept Separate) */}
            {Array.isArray(step1Fidelity.model_suggestions) &&
              step1Fidelity.model_suggestions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/80">
                  <div className="text-amber-300 font-semibold text-[11px] flex items-center gap-1 mb-1">
                    <span>💡</span> Suggestions to consider:
                  </div>
                  {step1Fidelity.model_suggestions.map(
                    (s: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-amber-950/20 border border-amber-800/40 rounded p-2 text-amber-200/90 text-[11px]"
                      >
                        <span className="font-bold text-amber-300">
                          {s.title}:
                        </span>{" "}
                        {s.suggested_value} —{" "}
                        <span className="text-amber-300/80 italic">
                          {s.reasoning}
                        </span>{" "}
                        <span className="text-slate-400 text-[10px] block mt-0.5">
                          This is a suggestion, not an approved requirement.
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
          </div>
        </div>
      )}

      {runId && workflowState === "prep_step1_awaiting_approval" && (
        <InterpretationCorrectionPanel
          key={runId}
          runId={runId}
          translation={step1Translation}
          hasFidelityIssue={step1Fidelity?.valid === false}
          disabled={isLoading || isFidelityValidating}
          onApply={onTranslationChange}
        />
      )}

      {workflowState === "prep_step1_awaiting_approval" && (
        <PreparationRecoveryNotice />
      )}
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <p className="text-xs text-slate-300">
          {workflowState === "prep_step1_awaiting_approval"
            ? "Your approval starts advisory research and prepares the research plan."
            : workflowState === "workflow_failed"
              ? "Your last saved interpretation is shown. Resolve the stopped step to continue."
              : "Your approved interpretation is saved."}
        </p>
        <button
          type="button"
          onClick={handleApproveStep1}
          disabled={
            isLoading ||
            workflowState !== "prep_step1_awaiting_approval" ||
            isFidelityValidating ||
            step1Fidelity?.valid !== true
          }
          title={
            step1Fidelity?.valid === false
              ? "Review the flagged requirements or apply a suggested correction before approving."
              : undefined
          }
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {workflowState === "prep_step1_awaiting_approval"
            ? step1Fidelity?.valid === false
              ? "Review flagged requirements"
              : "Approve interpretation & continue"
            : workflowState === "workflow_failed"
              ? "Approval unavailable while stopped"
              : "Approved \u2713"}
        </button>
      </div>
    </div>
  );
}
